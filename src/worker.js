// Kroger Walk on Cloudflare Workers: serves the game (public/) and proxies the Kroger API.
//
// Each player has their own Kroger login and store. Both live in an AES-GCM-encrypted,
// HttpOnly cookie, so the server stores no user data. The client secret is a Worker
// secret and never reaches the browser.
//
// Secrets (wrangler secret put, or .dev.vars for local dev):
//   KROGER_CLIENT_ID, KROGER_CLIENT_SECRET, SESSION_KEY (32+ random chars)

const API = 'https://api.kroger.com/v1';
const USER_SCOPES = 'product.compact cart.basic:write profile.compact';
const SESSION_COOKIE = 'kw_session';
const STATE_COOKIE = 'kw_state';
const SESSION_DAYS = 180;
const IMG_SIZES = new Set(['thumbnail', 'small', 'medium', 'large', 'xlarge']);

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

// ---- routes ----
// ctx.session is the decrypted cookie ({} if none); set ctx.dirty to write it back
const routes = {
  'GET /api/status': async (req, env, ctx) => json({
    configured: !!(env.KROGER_CLIENT_ID && env.KROGER_CLIENT_SECRET && env.SESSION_KEY),
    loggedIn: !!ctx.session.rt,
    locationId: ctx.session.loc || '',
    locationName: ctx.session.locName || '',
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
    const zip = (ctx.url.searchParams.get('zip') || '').slice(0, 10);
    const res = await apiGet('/locations', { 'filter.zipCode.near': zip, 'filter.limit': 10, 'filter.radiusInMiles': 25 }, await getAppToken(env));
    return json({ locations: (res.data || []).map(l => {
      const a = l.address || {};
      return { id: l.locationId, name: l.name || '', chain: l.chain || '', address: `${a.addressLine1 || ''}, ${a.city || ''} ${a.zipCode || ''}` };
    }) });
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
    const params = { 'filter.term': term, 'filter.limit': Math.max(1, Math.min(50, parseInt(q.get('limit')) || 6)) };
    if (ctx.session.loc) params['filter.locationId'] = ctx.session.loc;
    const res = await apiGet('/products', params, await getAppToken(env));
    return json({ products: (res.data || []).map(simplifyProduct) });
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
    await http('PUT', API + '/cart/add', { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, JSON.stringify({ items }));
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
    const route = routes[`${req.method} ${url.pathname}`];
    if (!route) return env.ASSETS.fetch(req);

    const ctx = { url, session: {}, dirty: false };
    const raw = cookies(req)[SESSION_COOKIE];
    if (raw && env.SESSION_KEY) ctx.session = (await unseal(env, raw)) || {};
    let res;
    try {
      res = await route(req, env, ctx);
    } catch (e) {
      res = e instanceof ApiError
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
