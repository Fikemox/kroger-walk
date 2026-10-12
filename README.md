# Kroger Walk

Grocery shopping as an ASCII walking game. You walk a top-down Kroger floor plan, step into an aisle to get a first-person shelf view with real product photos and prices from your store, grab what you want, and send the list to your Kroger pickup cart.

It's a personal side project, not a product: plain HTML/JS with no build step, served by a small Cloudflare Worker that proxies the Kroger API. It runs at **grocerywalk.com** behind a shared password, and every player signs in with their own Kroger account.

> The **`local`** branch is the original single-user version: one Python file, no dependencies, one Kroger login stored on disk.

## Setup

You need Node 22+ (`.nvmrc` says 24) and a free Cloudflare account.

1. Register an app at [developer.kroger.com](https://developer.kroger.com):
   - Enable **Products**, **Locations**, **Cart** and **Profile**.
   - Add a redirect URI for every place the game runs: `http://localhost:8642/callback` for local dev, plus `https://<your-domain>/callback` once it's deployed.
   - Kroger rejects app names that contain "Kroger".
2. Run `npm install`.
3. Copy `.dev.vars.example` to `.dev.vars` and fill it in. `SESSION_KEY` is any long random string. `SITE_PASSWORD` is optional locally.
4. Run `npm run dev` and open **http://localhost:8642**.

## Deploy

The custom domains are in `wrangler.toml` (`grocerywalk.com` and `www.grocerywalk.com`). Change them to yours, then:

```sh
npx wrangler login
npx wrangler secret put KROGER_CLIENT_ID
npx wrangler secret put KROGER_CLIENT_SECRET
npx wrangler secret put SESSION_KEY      # a different random string than dev
npx wrangler secret put SITE_PASSWORD    # the password friends type to get in
npm run deploy
```

**Shared password:** visitors get a password page until they enter `SITE_PASSWORD`. After that, a cookie keeps them in for a year. Changing the password (`wrangler secret put SITE_PASSWORD`) locks everyone out until they enter the new one. After 10 wrong guesses, an IP is locked out for 15 minutes. If `SITE_PASSWORD` is missing in production, the site refuses to serve at all rather than staying open.

**Shared Kroger limits:** every player uses one Kroger app, so everyone shares its daily limits: 10,000 product searches, 1,600 store lookups and 5,000 cart sends.
- **Counting:** a Durable Object counts every call the Worker makes to Kroger.
- **Showing:** the header chip shows how many searches are left today. Hover it for the full breakdown.
- **Caching:** identical product searches at the same store are cached at the edge for 6h, and store lookups for 7 days, so friends mostly reuse each other's results.
- **Running out:** when a limit runs out, the game shows a message and falls back to its sample shelves until the count resets at midnight UTC.

## How it works

| Path | What it does |
|---|---|
| `public/` | The game: `index.html` (page, HUD, modals), `store.js` (104×40 floor plan), `catalog.js` (sections and offline sample products), `game.js` (movement, search, cart, checkout, match & send), `shelf.js` (first-person shelves; live products are cached 12h in localStorage) |
| `src/worker.js` | Kroger OAuth, store search, product search, photo proxy and cart add. Anything that isn't one of these routes is served from `public/` |
| `wrangler.toml` | Worker config: custom domains, the `Quota` Durable Object, and dev port 8642 (matches the registered redirect URI) |

**Ordering:** at checkout, press **K** to match each list item to a product at your store and send everything to your Kroger cart (pickup). Kroger's API **can't place orders**, so you still choose a pickup time and pay in the Kroger app.

## Controls

| Where | Keys |
|---|---|
| Store map | **WASD**/arrows move · **Shift** run · **E** look at a shelf · **/** find an item · **C** checkout · **K** Kroger · **V** toggle auto first-person · **?** help |
| First person | **A/D** product · **W/S** shelf · **Enter** grab · **X** put back · **Tab** turn around · **/** find · **I** label pop-up · **L** list · **Esc** step out |

Walking into an aisle, or bumping into an outside wall (bakery/deli/meat/seafood, dairy, produce, service), switches to first person.

## Security notes

- The Kroger client secret is a Worker secret and never reaches the browser.
- Each player's Kroger tokens and store choice live in an AES-GCM-encrypted, `HttpOnly`, `SameSite=Lax` cookie. The server keeps no user data. Rotating `SESSION_KEY` signs everyone out.
- OAuth uses a `state` cookie to block login CSRF.
- The whole site, game files included, is behind the password gate (`run_worker_first`). `http://` and `www.` redirect to the single `https://` origin.
- `.dev.vars` is git-ignored.
