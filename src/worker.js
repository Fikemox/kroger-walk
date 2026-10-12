// Kroger Walk on Cloudflare Workers: serves the game (public/) and proxies the Kroger API.
//
// Each player has their own Kroger login and store. Both live in an AES-GCM-encrypted,
// HttpOnly cookie, so the server stores no user data. The client secret is a Worker
// secret and never reaches the browser.
//
// Everyone shares one Kroger app, and so its daily rate limits. The Quota Durable Object
// counts real calls to Kroger, and product and store searches are cached at the edge so
// friends browsing the same store mostly reuse each other's results.
//
// Secrets (wrangler secret put, or .dev.vars for local dev):
//   KROGER_CLIENT_ID, KROGER_CLIENT_SECRET, SESSION_KEY (32+ random chars)
//   SITE_PASSWORD (optional): the shared password friends type once to get in
import { DurableObject } from 'cloudflare:workers';

const API = 'https://api.kroger.com/v1';
const USER_SCOPES = 'product.compact cart.basic:write profile.compact';
const SESSION_COOKIE = 'kw_session';
const STATE_COOKIE = 'kw_state';
const GATE_COOKIE = 'kw_gate';
const SESSION_DAYS = 180;
const IMG_SIZES = new Set(['thumbnail', 'small', 'medium', 'large', 'xlarge']);
// developer.kroger.com public API limits, per app per day
const LIMITS = { products: 10000, locations: 1600, cart: 5000 };
const EDGE_TTL = { products: 6 * 3600, locations: 7 * 86400 };
const GATE_TRIES = 10;  // wrong passwords allowed per IP per 15 minutes

class ApiError extends Error {
  constructor(status, body) { super(`${status}: ${body.slice(0, 300)}`); this.status = status; this.body = body; }
}

const json = (obj, status = 200, headers = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } });
const redirect = (location, headers = {}) => new Response(null, { status: 302, headers: { Location: location, ...headers } });

// ---- encrypted session cookie ----
const b64u = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));

let keyCache = null;
async function sessionKey(env) {
  if (!keyCache || keyCache.src !== env.SESSION_KEY) {
    const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(env.SESSION_KEY));
    keyCache = { src: env.SESSION_KEY, key: await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']) };
  }
  return keyCache.key;
}

async function seal(env, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await sessionKey(env), new TextEncoder().encode(JSON.stringify(obj))));
  return b64u(iv) + '.' + b64u(ct);
}

async function unseal(env, token) {
  try {
    const [iv, ct] = token.split('.').map(unb64u);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, await sessionKey(env), ct);
    return JSON.parse(new TextDecoder().decode(pt));
  } catch { return null; }  // tampered, old key, or garbage: start fresh
}

function cookies(req) {
  const out = {};
  for (const part of (req.headers.get('Cookie') || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

function cookie(url, name, value, maxAge) {
  const secure = url.protocol === 'https:' ? '; Secure' : '';
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

// ---- Kroger API ----
async function http(method, url, headers = {}, body) {
  const r = await fetch(url, { method, headers, body });
  const text = await r.text();
  if (!r.ok) throw new ApiError(r.status, text);
  return text ? JSON.parse(text) : {};
}

function tokenRequest(env, form) {
  return http('POST', API + '/connect/oauth2/token', {
    'Content-Type': 'application/x-www-form-urlencoded',
    Authorization: 'Basic ' + btoa(`${env.KROGER_CLIENT_ID}:${env.KROGER_CLIENT_SECRET}`),
  }, new URLSearchParams(form).toString());
}

// client-credentials token for product + store search; shared by everyone, cached per isolate
let appToken = { token: null, exp: 0 };
async function getAppToken(env) {
  if (Date.now() / 1000 > appToken.exp - 60) {
    const t = await tokenRequest(env, { grant_type: 'client_credentials', scope: 'product.compact' });
    appToken = { token: t.access_token, exp: Date.now() / 1000 + (t.expires_in || 1800) };
  }
  return appToken.token;
}

const apiGet = (path, params, token) =>
  http('GET', `${API}${path}?${new URLSearchParams(params)}`, { Authorization: 'Bearer ' + token, Accept: 'application/json' });

function simplifyProduct(p) {
  const item = (p.items || [{}])[0] || {};
  const price = item.price || {};
  const aisle = (p.aisleLocations || [])[0];
  return {
    upc: p.upc,
    name: p.description || '',
    brand: p.brand || '',
    size: item.size || '',
    price: price.regular || 0,
    promo: price.promo || 0,
    aisle: aisle?.description || '',
    stock: item.inventory?.stockLevel || '',
    pickup: item.fulfillment?.curbside,
    productId: p.productId,
    img: !!(p.images && p.images.length),
    loc: aisle ? {
      aisle: aisle.number || '', side: aisle.side || '', bay: aisle.bayNumber || '',
      shelf: aisle.shelfNumber || '', pos: aisle.shelfPositionInBay || '', facings: aisle.numberOfFacings || '',
    } : null,
    temp: p.temperature?.indicator || '',
    category: (p.categories || [''])[0],
  };
}

// ---- shared daily quota ----
// One Durable Object counts every call the Worker makes to Kroger, per UTC day.
export class Quota extends DurableObject {
  today() { return new Date().toISOString().slice(0, 10); }

  async counts() {
    const day = this.today();
    if (this.day !== day) {
      // new day: forget yesterday's counts and lockouts
      const old = [...(await this.ctx.storage.list()).keys()].filter(k => !k.startsWith(day));
      if (old.length) await this.ctx.storage.delete(old);
      this.day = day;
    }
    const out = {};
    for (const api of Object.keys(LIMITS)) {
      const used = (await this.ctx.storage.get(`${day}:${api}`)) || 0;
      const spent = !!(await this.ctx.storage.get(`${day}:${api}:out`));
      out[api] = { used, limit: LIMITS[api], left: spent ? 0 : Math.max(0, LIMITS[api] - used) };
    }
    return out;
  }

  // take one call from the budget; false once it's gone
  async reserve(api) {
    const c = await this.counts();
    if (!c[api].left) return false;
    await this.ctx.storage.put(`${this.today()}:${api}`, c[api].used + 1);
    return true;
  }

  // Kroger said 429: trust that over our count until tomorrow
  async exhaust(api) { await this.ctx.storage.put(`${this.today()}:${api}:out`, true); }

  // wrong-password throttle, per IP per 15-minute window
  async gateFail(ip) {
    const k = `${this.today()}:gate:${ip}:${Math.floor(Date.now() / 900e3)}`;
    const n = ((await this.ctx.storage.get(k)) || 0) + 1;
    await this.ctx.storage.put(k, n);
    return n;
  }
  async gateTries(ip) {
    return (await this.ctx.storage.get(`${this.today()}:gate:${ip}:${Math.floor(Date.now() / 900e3)}`)) || 0;
  }
}

const quota = env => env.QUOTA.get(env.QUOTA.idFromName('kroger'));

class QuotaError extends Error {}

// a Kroger call that counts against the shared budget, with an edge cache in front
async function budgeted(env, api, cacheKey, ttl, call) {
  const cache = caches.default;
  const key = new Request(`https://kroger-walk.cache/${api}?${cacheKey}`);
  const hit = await cache.match(key);
  if (hit) return hit.json();
  if (!(await quota(env).reserve(api))) throw new QuotaError(api);
  let data;
  try {
    data = await call();
  } catch (e) {
    if (e instanceof ApiError && e.status === 429) { await quota(env).exhaust(api); throw new QuotaError(api); }
    throw e;
  }
  await cache.put(key, new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${ttl}` } }));
  return data;
}

// ---- shared-password gate ----
async function gateToken(env) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.SESSION_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  // changing SITE_PASSWORD changes the token, which locks out everyone until they type the new one
  return b64u(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('gate:' + env.SITE_PASSWORD)))).slice(0, 32);
}

function sameString(a, b) {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

const gatePage = (msg = '') => new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Kroger Walk</title>
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0b0d13; color: #c9d4ea;
         font: 16px Consolas, 'Cascadia Mono', 'Courier New', monospace; }
  form { border: 1px solid #2a3246; background: #11151f; padding: 28px 32px; width: min(360px, calc(100vw - 32px)); box-sizing: border-box; }
  .logo { color: #fff; background: #2f7df6; padding: 0 8px; font-weight: bold; letter-spacing: 2px; }
  pre { color: #ffd84a; margin: 18px 0; line-height: 1.15; }
  input, button { font: inherit; width: 100%; box-sizing: border-box; padding: 8px 10px; margin-top: 10px;
                  background: #0b0d13; color: #c9d4ea; border: 1px solid #2a3246; }
  button { background: #2f7df6; color: #fff; border-color: #2f7df6; cursor: pointer; }
  .msg { color: #ff6b6b; min-height: 1.2em; margin-top: 10px; font-size: 14px; }
  .dim { color: #6b7690; font-size: 14px; }
</style></head><body>
<form method="post" action="/gate">
  <div><span class="logo">KROGER</span> WALK</div>
  <pre>  ___________
 |  |  |  |  |
 |__|__|__|__|
  \\_________/
    o     o</pre>
  <div class="dim">Friends only. What's the password?</div>
  <input type="password" name="password" autocomplete="current-password" autofocus required>
  <button>Walk in</button>
  <div class="msg">${msg}</div>
</form></body></html>`, { status: 401, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });

async function gate(req, env, url) {
  if (!env.SITE_PASSWORD) {
    // no password: fine for local dev, but never leave the real site open by accident
    return url.hostname === 'localhost' ? null : new Response('SITE_PASSWORD is not set.', { status: 503 });
  }
  const ok = sameString(cookies(req)[GATE_COOKIE] || '', await gateToken(env));
  if (req.method === 'POST' && url.pathname === '/gate') {
    if (ok) return redirect('/');
    const ip = req.headers.get('CF-Connecting-IP') || 'local';
    if ((await quota(env).gateTries(ip)) >= GATE_TRIES) return gatePage('Too many tries. Wait 15 minutes.');
    const form = await req.formData().catch(() => null);
    if (!form || !sameString(String(form.get('password') || ''), env.SITE_PASSWORD)) {
      await quota(env).gateFail(ip);
      return gatePage('Nope, try again.');
    }
    return redirect('/', { 'Set-Cookie': cookie(url, GATE_COOKIE, await gateToken(env), 365 * 86400) });
  }
  if (ok || url.pathname === '/favicon.svg') return null;
  return url.pathname.startsWith('/api/') ? json({ error: 'Password required', gate: true }, 401) : gatePage();
}

// ---- routes ----
// ctx.session is the decrypted cookie ({} if none); set ctx.dirty to write it back
const routes = {
  'GET /api/status': async (req, env, ctx) => json({
    configured: !!(env.KROGER_CLIENT_ID && env.KROGER_CLIENT_SECRET && env.SESSION_KEY),
    loggedIn: !!ctx.session.rt,
    locationId: ctx.session.loc || '',
    locationName: ctx.session.locName || '',
    quota: await quota(env).counts(),
  }),

  'GET /auth/login': async (req, env, ctx) => {
    if (!env.KROGER_CLIENT_ID) return redirect('/?kroger=notconfigured');
    const state = b64u(crypto.getRandomValues(new Uint8Array(16)));
    return redirect(API + '/connect/oauth2/authorize?' + new URLSearchParams({
      scope: USER_SCOPES, response_type: 'code', client_id: env.KROGER_CLIENT_ID,
      redirect_uri: ctx.url.origin + '/callback', state,
    }), { 'Set-Cookie': cookie(ctx.url, STATE_COOKIE, state, 600) });
  },

  'GET /callback': async (req, env, ctx) => {
    const q = ctx.url.searchParams;
    const clearState = cookie(ctx.url, STATE_COOKIE, '', 0);
    if (!q.get('code') || !q.get('state') || q.get('state') !== cookies(req)[STATE_COOKIE])
      return redirect('/?kroger=loginfailed', { 'Set-Cookie': clearState });
    let t;
    try {
      t = await tokenRequest(env, { grant_type: 'authorization_code', code: q.get('code'), redirect_uri: ctx.url.origin + '/callback' });
    } catch { return redirect('/?kroger=loginfailed', { 'Set-Cookie': clearState }); }
    Object.assign(ctx.session, { at: t.access_token, rt: t.refresh_token, exp: Date.now() / 1000 + (t.expires_in || 1800) });
    const headers = new Headers({ Location: '/?kroger=connected' });
    headers.append('Set-Cookie', clearState);
    headers.append('Set-Cookie', cookie(ctx.url, SESSION_COOKIE, await seal(env, ctx.session), SESSION_DAYS * 86400));
    return new Response(null, { status: 302, headers });
  },

  'POST /auth/logout': async (req, env, ctx) => {
    delete ctx.session.at; delete ctx.session.rt; delete ctx.session.exp;
    ctx.dirty = true;
    return json({ ok: true });
  },

  'GET /api/locations': async (req, env, ctx) => {
    const zip = (ctx.url.searchParams.get('zip') || '').replace(/[^\d-]/g, '').slice(0, 10);
    if (zip.length < 5) return json({ locations: [] });
    const locations = await budgeted(env, 'locations', `zip=${zip}`, EDGE_TTL.locations, async () => {
      const res = await apiGet('/locations', { 'filter.zipCode.near': zip, 'filter.limit': 10, 'filter.radiusInMiles': 25 }, await getAppToken(env));
      return (res.data || []).map(l => {
        const a = l.address || {};
        return { id: l.locationId, name: l.name || '', chain: l.chain || '', address: `${a.addressLine1 || ''}, ${a.city || ''} ${a.zipCode || ''}` };
      });
    });
    return json({ locations });
  },

  'POST /api/location': async (req, env, ctx) => {
    const body = await req.json().catch(() => ({}));
    ctx.session.loc = String(body.id || '').slice(0, 16);
    ctx.session.locName = String(body.name || '').slice(0, 80);
    ctx.dirty = true;
    return json({ ok: true });
  },

  'GET /api/products': async (req, env, ctx) => {
    const q = ctx.url.searchParams;
    const term = (q.get('term') || '').split(/\s+/).filter(Boolean).slice(0, 8).join(' ');
    if (term.length < 3) return json({ products: [] });
    const params = { 'filter.term': term.toLowerCase(), 'filter.limit': Math.max(1, Math.min(50, parseInt(q.get('limit')) || 6)) };
    if (ctx.session.loc) params['filter.locationId'] = ctx.session.loc;
    const products = await budgeted(env, 'products', new URLSearchParams(params).toString(), EDGE_TTL.products, async () =>
      ((await apiGet('/products', params, await getAppToken(env))).data || []).map(simplifyProduct));
    return json({ products });
  },

  'GET /api/img': async (req, env, ctx) => {
    const id = ctx.url.searchParams.get('id') || '', size = ctx.url.searchParams.get('size') || 'medium';
    if (!/^\d{6,14}$/.test(id) || !IMG_SIZES.has(size)) return new Response('bad request', { status: 400 });
    const src = `https://www.kroger.com/product/images/${size}/front/${id}`;
    try {
      const r = await fetch(src, { headers: { 'User-Agent': 'Mozilla/5.0' }, cf: { cacheEverything: true, cacheTtl: 604800 } });
      if (r.ok && (r.headers.get('Content-Type') || '').startsWith('image/'))
        return new Response(r.body, { headers: { 'Content-Type': r.headers.get('Content-Type'), 'Cache-Control': 'public, max-age=604800' } });
    } catch { /* fall through */ }
    // if kroger.com won't serve the Worker, let the browser fetch the photo itself
    return redirect(src, { 'Cache-Control': 'public, max-age=86400' });
  },

  'POST /api/cart': async (req, env, ctx) => {
    const token = await userToken(env, ctx);
    if (!token) return json({ error: 'Not logged in to Kroger', login: true }, 401);
    const body = await req.json().catch(() => ({}));
    const items = (body.items || []).filter(i => i && i.upc).slice(0, 200)
      .map(i => ({ upc: String(i.upc), quantity: Math.max(1, Math.min(99, parseInt(i.quantity) || 1)), modality: 'PICKUP' }));
    if (!items.length) return json({ error: 'Nothing to add' }, 400);
    if (!(await quota(env).reserve('cart'))) throw new QuotaError('cart');
    try {
      await http('PUT', API + '/cart/add', { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, JSON.stringify({ items }));
    } catch (e) {
      if (e instanceof ApiError && e.status === 429) { await quota(env).exhaust('cart'); throw new QuotaError('cart'); }
      throw e;
    }
    return json({ ok: true, added: items.length });
  },
};

// authorization-code token for cart writes; refreshed automatically
async function userToken(env, ctx) {
  const s = ctx.session;
  if (!s.rt) return null;
  if (Date.now() / 1000 > (s.exp || 0) - 60) {
    try {
      const t = await tokenRequest(env, { grant_type: 'refresh_token', refresh_token: s.rt });
      Object.assign(s, { at: t.access_token, rt: t.refresh_token || s.rt, exp: Date.now() / 1000 + (t.expires_in || 1800) });
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      delete s.at; delete s.rt; delete s.exp;
    }
    ctx.dirty = true;
  }
  return s.at || null;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.hostname === '127.0.0.1') {
      // localStorage (the cart) is per-origin; keep local dev on the same origin as the OAuth redirect
      url.hostname = 'localhost';
      return redirect(url.toString());
    }
    if (url.hostname !== 'localhost' && (url.hostname.startsWith('www.') || url.protocol === 'http:')) {
      // one https origin, so cookies, the cart and the OAuth redirect all line up
      url.hostname = url.hostname.replace(/^www\./, '');
      url.protocol = 'https:';
      return Response.redirect(url.toString(), 301);
    }
    const locked = await gate(req, env, url);
    if (locked) return locked;
    const route = routes[`${req.method} ${url.pathname}`];
    if (!route) return env.ASSETS.fetch(req);

    const ctx = { url, session: {}, dirty: false };
    const raw = cookies(req)[SESSION_COOKIE];
    if (raw && env.SESSION_KEY) ctx.session = (await unseal(env, raw)) || {};
    let res;
    try {
      res = await route(req, env, ctx);
    } catch (e) {
      res = e instanceof QuotaError
        ? json({ error: `Kroger's daily ${e.message} limit is used up for everyone. It resets around midnight UTC.`, quotaOut: e.message }, 429)
        : e instanceof ApiError
          ? json({ error: `Kroger API error ${e.status}`, detail: e.body.slice(0, 500) }, 502)
          : json({ error: String(e.message || e) }, 500);
    }
    if (ctx.dirty) {
      res = new Response(res.body, res);
      res.headers.append('Set-Cookie', cookie(url, SESSION_COOKIE, await seal(env, ctx.session), SESSION_DAYS * 86400));
    }
    return res;
  },
};
