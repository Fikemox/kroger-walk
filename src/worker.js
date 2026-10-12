// Kroger Walk on Cloudflare Workers: serves the game (public/) and proxies the Kroger API.
//
// Each player has their own Kroger login and store. Both live in an AES-GCM-encrypted,
// HttpOnly cookie. The server keeps only player names, for 24h. The client secret is a Worker
// secret and never reaches the browser.
//
// Everyone shares one Kroger app, and so its daily rate limits. The Quota Durable Object
// counts real calls to Kroger, and product and store searches are cached at the edge so
// friends browsing the same store mostly reuse each other's results.
//
// Secrets (wrangler secret put, or .dev.vars for local dev):
//   KROGER_CLIENT_ID, KROGER_CLIENT_SECRET, SESSION_KEY (32+ random chars)
//   SITE_PASSWORD (optional): the shared password friends type once to get in
//   SITE_PASSWORD_FAMILY, SITE_PASSWORD_WORK (optional): more groups, each with its own password.
//     Changing one group's password signs out only that group
//   DEV_ORIGIN (.dev.vars only): http://localhost:8642. `wrangler dev` rewrites every request
//     to the production hostname, so this is how the Worker knows it's local
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
// password groups: group -> the secret holding its password
const GROUPS = { friends: 'SITE_PASSWORD', family: 'SITE_PASSWORD_FAMILY', work: 'SITE_PASSWORD_WORK' };
const NAME_MAX = 16;
const SEEN_MS = 24 * 3600e3;  // a player's name shows up on other people's shoppers for 24h

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
      // new day: forget yesterday's counts and lockouts (dated keys only)
      const old = [...(await this.ctx.storage.list()).keys()].filter(k => /^\d{4}-\d\d-\d\d:/.test(k) && !k.startsWith(day));
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
  // ---- per-store maps (kept in their own instance, see layouts()) ----
  // stored in chunks: Durable Object values are size-limited, a store map is a few MB
  async putLayout(loc, json, meta) {
    const old = (await this.ctx.storage.get(`layout:${loc}:meta`)) || { chunks: 0 };
    const size = 120000, chunks = Math.ceil(json.length / size);
    for (let i = 0; i < chunks; i++) await this.ctx.storage.put(`layout:${loc}:${i}`, json.slice(i * size, (i + 1) * size));
    for (let i = chunks; i < old.chunks; i++) await this.ctx.storage.delete(`layout:${loc}:${i}`);
    await this.ctx.storage.put(`layout:${loc}:meta`, { ...meta, chunks });
  }
  async layoutMeta(loc) { return (await this.ctx.storage.get(`layout:${loc}:meta`)) || null; }
  async getLayout(loc) {
    const meta = await this.layoutMeta(loc);
    if (!meta) return null;
    let json = '';
    for (let i = 0; i < meta.chunks; i++) json += (await this.ctx.storage.get(`layout:${loc}:${i}`)) || '';
    return json;
  }

  // ---- who's been shopping (kept in their own instance, see presence()) ----
  async seen(name) {
    await this.ctx.storage.put('seen:' + name.toLowerCase(), { name, t: Date.now() });
  }
  async recent() {
    const cutoff = Date.now() - SEEN_MS, old = [], out = [];
    for (const [k, v] of await this.ctx.storage.list({ prefix: 'seen:' })) {
      if (v.t < cutoff) old.push(k); else out.push(v);
    }
    if (old.length) await this.ctx.storage.delete(old);
    return out.sort((a, b) => b.t - a.t);
  }
  async forget(name) { await this.ctx.storage.delete('seen:' + name.toLowerCase()); }

  // ---- one store-map build per person per day, Eastern midnight to midnight ----
  // (not under the dated-key cleanup in counts(), which runs on UTC days)
  async buildState(name) {
    const day = easternDay(), key = `build:${day}:${name.toLowerCase()}`;
    const stale = [...(await this.ctx.storage.list({ prefix: 'build:' })).keys()].filter(k => !k.startsWith(`build:${day}:`));
    if (stale.length) await this.ctx.storage.delete(stale);
    return { key, state: (await this.ctx.storage.get(key)) || '' };   // '' | 'building' | 'built'
  }
  async buildStart(name) {
    const { key, state } = await this.buildState(name);
    if (state) return false;
    await this.ctx.storage.put(key, 'building');
    return true;
  }
  async buildEnd(name, saved) {
    const { key, state } = await this.buildState(name);
    if (state !== 'building') return false;
    if (saved) await this.ctx.storage.put(key, 'built');
    else await this.ctx.storage.delete(key);  // cancelled or failed: they can try again today
    return true;
  }

  async gateTries(ip) {
    return (await this.ctx.storage.get(`${this.today()}:gate:${ip}:${Math.floor(Date.now() / 900e3)}`)) || 0;
  }
}

const quota = env => env.QUOTA.get(env.QUOTA.idFromName('kroger'));
const layouts = env => env.QUOTA.get(env.QUOTA.idFromName('layouts'));
const presence = env => env.QUOTA.get(env.QUOTA.idFromName('presence'));
const easternDay = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
const MAX_LAYOUT = 8 * 1024 * 1024;

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

// ---- password gate ----
// Each group has its own password. The gate cookie carries the group and the player's name,
// signed with that group's password, so changing one group's password signs out only that
// group. (Cookies from before names existed don't parse, which signed everyone out once.)
async function gateSig(env, group, name) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.SESSION_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const msg = `gate2|${group}|${env[GROUPS[group]]}|${name}`;
  return b64u(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg)))).slice(0, 32);
}
const gateCookie = async (env, group, name) => `g2.${group}.${b64u(new TextEncoder().encode(name))}.${await gateSig(env, group, name)}`;

async function readGate(env, raw) {
  const [v, group, n, sig] = (raw || '').split('.');
  if (v !== 'g2' || !Object.hasOwn(GROUPS, group) || !env[GROUPS[group]] || !n || !sig) return null;
  let name;
  try { name = new TextDecoder('utf-8', { fatal: true }).decode(unb64u(n)); } catch { return null; }
  return sameString(sig, await gateSig(env, group, name)) ? { group, name } : null;
}

function sameString(a, b) {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

// Names show up on other people's screens, so they're short and plain. Anything that smells
// like markup or script gets turned away with a joke. (The game also only ever renders names
// as text, so this is the belt to those suspenders.)
const XSSY = /[<>"`\\{}=]|&#|%3[ce]|javascript:|vbscript:|data:|script|\bon[a-z]+\s*=|alert\s*\(|eval\s*\(|prompt\s*\(|document\.|window\.|\$\{/i;
function checkName(raw) {
  const name = String(raw || '').normalize('NFC').replace(/\s+/g, ' ').trim();
  if (XSSY.test(name)) return { xss: true };
  if (!name) return { error: 'Tell us who\'s shopping.' };
  if ([...name].length > NAME_MAX) return { error: `Keep your name to ${NAME_MAX} characters.` };
  if (!/^[\p{L}\p{N}][\p{L}\p{M}\p{N} .'_-]*$/u.test(name)) return { error: 'Letters, numbers, spaces and . \' - _ only.' };
  return { name };
}

const escHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const CART_ART = `  ___________
 |  |  |  |  |
 |__|__|__|__|
  \\_________/
    o     o`;
const COP_ART = `   _____
  |_____|   WEE-OO
  ( o_o)    WEE-OO
  /|_|\\ ]=[]
  / \\    o o`;

// msg is always one of our own constant strings. The only input echoed back is the name,
// escaped, and never after it looked like an attack.
const gatePage = ({ msg = '', name = '', xss = false } = {}) => new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Kroger Walk</title>
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0b0d13; color: #c9d4ea;
         font: 16px Consolas, 'Cascadia Mono', 'Courier New', monospace; }
  form { border: 1px solid #2a3246; background: #11151f; padding: 28px 32px; width: min(360px, calc(100vw - 32px)); box-sizing: border-box; }
  .logo { color: #fff; background: #2f7df6; padding: 0 8px; font-weight: bold; letter-spacing: 2px; }
  pre { color: #ffd84a; margin: 18px 0; line-height: 1.15; }
  pre.cop { color: #ff6b6b; }
  label { display: block; margin-top: 14px; font-size: 14px; color: #6b7690; }
  input, button { font: inherit; width: 100%; box-sizing: border-box; padding: 8px 10px; margin-top: 6px;
                  background: #0b0d13; color: #c9d4ea; border: 1px solid #2a3246; }
  button { background: #2f7df6; color: #fff; border-color: #2f7df6; cursor: pointer; margin-top: 16px; }
  .msg { color: #ff6b6b; min-height: 1.2em; margin-top: 10px; font-size: 14px; }
  .xss { color: #ffd84a; border: 1px dashed #ff6b6b; padding: 8px 10px; line-height: 1.45; }
  .dim { color: #6b7690; font-size: 14px; }
</style></head><body>
<form method="post" action="/gate">
  <div><span class="logo">KROGER</span> WALK</div>
  <pre${xss ? ' class="cop"' : ''}>${xss ? COP_ART : CART_ART}</pre>
  <div class="dim">Who's shopping? Your name pops up as a shopper in other players' stores for 24 hours.</div>
  <label for="nm">Your name</label>
  <input id="nm" name="name" maxlength="${NAME_MAX}" autocomplete="nickname" value="${xss ? '' : escHtml(name)}" ${name && !xss ? '' : 'autofocus '}required>
  <label for="pw">Password</label>
  <input id="pw" type="password" name="password" autocomplete="current-password" ${name && !xss ? 'autofocus ' : ''}required>
  <button>Walk in</button>
  <div class="msg">${xss
    ? '<div class="xss">🚨 Security to the front, please. Security to the front.<br><br>Nice try, Little Bobby &lt;/script&gt;. That name has been bagged with the raw chicken and left in a hot car. Pick one a cashier could say out loud.</div>'
    : msg}</div>
</form></body></html>`, { status: 401, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });

// { res } answers right away (the password page, a redirect); { who } carries on with the
// player's { group, name }
async function gate(req, env, url) {
  if (!env.SITE_PASSWORD) {
    // no password: fine for local dev, but never leave the real site open by accident
    return env.DEV_ORIGIN ? { who: null } : { res: new Response('SITE_PASSWORD is not set.', { status: 503 }) };
  }
  const who = await readGate(env, cookies(req)[GATE_COOKIE]);
  if (req.method === 'POST' && url.pathname === '/gate') {
    if (who) return { res: redirect('/') };
    const ip = req.headers.get('CF-Connecting-IP') || 'local';
    if ((await quota(env).gateTries(ip)) >= GATE_TRIES) return { res: gatePage({ msg: 'Too many tries. Wait 15 minutes.' }) };
    const form = await req.formData().catch(() => null);
    const n = checkName(form && form.get('name'));
    if (n.xss) { await quota(env).gateFail(ip); return { res: gatePage({ xss: true }) }; }
    const pw = String((form && form.get('password')) || '');
    const group = Object.keys(GROUPS).find(g => env[GROUPS[g]] && sameString(pw, env[GROUPS[g]]));
    if (!group) { await quota(env).gateFail(ip); return { res: gatePage({ msg: 'Nope, try again.', name: n.name || '' }) }; }
    if (n.error) return { res: gatePage({ msg: n.error }) };
    await presence(env).seen(n.name);
    return { res: redirect('/', { 'Set-Cookie': cookie(url, GATE_COOKIE, await gateCookie(env, group, n.name), 365 * 86400) }) };
  }
  if (who) return { who };
  if (url.pathname === '/favicon.svg') return { who: null };
  return { res: url.pathname.startsWith('/api/') ? json({ error: 'Password required', gate: true }, 401) : gatePage() };
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
    me: ctx.who && { name: ctx.who.name, group: ctx.who.group },
    buildLeft: !(await quota(env).buildState(buildName(ctx))).state,
  }),

  // the game says hello when it loads and every few minutes: keeps your name on other people's
  // shoppers, and returns everyone else seen in the last 24 hours. Names only, never carts.
  'POST /api/hello': async (req, env, ctx) => {
    if (!ctx.who) return json({ me: null, players: [] });
    await presence(env).seen(ctx.who.name);
    const me = ctx.who.name.toLowerCase(), now = Date.now();
    const players = (await presence(env).recent()).filter(p => p.name.toLowerCase() !== me).slice(0, 50)
      .map(p => ({ name: p.name, ago: Math.round((now - p.t) / 60e3) }));
    return json({ me: { name: ctx.who.name, group: ctx.who.group }, players });
  },

  // take my name off everyone's screens and sign this device out of the site
  'POST /api/forget': async (req, env, ctx) => {
    if (ctx.who) await presence(env).forget(ctx.who.name);
    return json({ ok: true }, 200, { 'Set-Cookie': cookie(ctx.url, GATE_COOKIE, '', 0) });
  },

  // one store-map build per person per day (resets at midnight Eastern); {end: true} gives
  // back a build that was cancelled or failed before it saved
  'POST /api/build': async (req, env, ctx) => {
    const body = await req.json().catch(() => ({}));
    const name = buildName(ctx);
    if (body.end) return json({ ok: await quota(env).buildEnd(name, false) });
    if (!(await quota(env).buildStart(name)))
      return json({ error: 'You\'ve already built a store map today. Everyone gets one a day; yours unlocks again at midnight Eastern.', buildUsed: true }, 429);
    return json({ ok: true });
  },

  'GET /auth/login': async (req, env, ctx) => {
    if (!env.KROGER_CLIENT_ID) return redirect('/?kroger=notconfigured');
    const state = b64u(crypto.getRandomValues(new Uint8Array(16)));
    return redirect(API + '/connect/oauth2/authorize?' + new URLSearchParams({
      scope: USER_SCOPES, response_type: 'code', client_id: env.KROGER_CLIENT_ID,
      redirect_uri: ctx.origin + '/callback', state,
    }), { 'Set-Cookie': cookie(ctx.url, STATE_COOKIE, state, 600) });
  },

  'GET /callback': async (req, env, ctx) => {
    const q = ctx.url.searchParams;
    const clearState = cookie(ctx.url, STATE_COOKIE, '', 0);
    if (!q.get('code') || !q.get('state') || q.get('state') !== cookies(req)[STATE_COOKIE])
      return redirect('/?kroger=loginfailed', { 'Set-Cookie': clearState });
    let t;
    try {
      t = await tokenRequest(env, { grant_type: 'authorization_code', code: q.get('code'), redirect_uri: ctx.origin + '/callback' });
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

  // per-store maps, shared by everyone who shops that store
  'GET /api/layout': async (req, env, ctx) => {
    const loc = (ctx.url.searchParams.get('loc') || '').slice(0, 16);
    if (!/^\w+$/.test(loc)) return json({ error: 'bad store' }, 400);
    if (ctx.url.searchParams.get('meta')) {
      const meta = await layouts(env).layoutMeta(loc);
      return meta ? json({ built: meta.built, count: meta.count, aisles: meta.aisles, name: meta.name }) : json({ error: 'no map yet' }, 404);
    }
    const body = await layouts(env).getLayout(loc);
    return body ? new Response(body, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }) : json({ error: 'no map yet' }, 404);
  },

  'POST /api/layout': async (req, env, ctx) => {
    const text = await req.text();
    if (text.length > MAX_LAYOUT) return json({ error: 'map too large' }, 413);
    let layout;
    try { ({ layout } = JSON.parse(text)); } catch { return json({ error: 'bad map' }, 400); }
    // only for the store you're shopping, and only something shaped like a map
    if (!layout || layout.v !== 1 || !ctx.session.loc || layout.loc !== ctx.session.loc || !Array.isArray(layout.aisles) || typeof layout.areas !== 'object')
      return json({ error: 'map must be for your current store' }, 400);
    // saving is what spends today's build, so it has to follow POST /api/build
    if (!(await quota(env).buildEnd(buildName(ctx), true))) return json({ error: 'Start the build from the store picker first.', buildUsed: true }, 409);
    const out = JSON.stringify(layout);
    await layouts(env).putLayout(layout.loc, out, { built: layout.built, count: layout.count, aisles: layout.aisles.length, name: String(layout.name || '').slice(0, 80) });
    return json({ ok: true, bytes: out.length });
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

const buildName = ctx => (ctx.who ? ctx.who.name : 'anyone');

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
    if (!env.DEV_ORIGIN && (url.hostname.startsWith('www.') || url.protocol === 'http:')) {
      // one https origin, so cookies, the cart and the OAuth redirect all line up
      url.hostname = url.hostname.replace(/^www\./, '');
      url.protocol = 'https:';
      return Response.redirect(url.toString(), 301);
    }
    const { res: locked, who } = await gate(req, env, url);
    if (locked) return locked;
    const route = routes[`${req.method} ${url.pathname}`];
    if (!route) return env.ASSETS.fetch(req);

    const ctx = { url, origin: env.DEV_ORIGIN || url.origin, session: {}, dirty: false, who };
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
