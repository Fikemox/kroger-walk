# Kroger Walk

Grocery shopping as an ASCII walking game. You walk a top-down Kroger floor plan, step into an aisle to get a first-person shelf view with real product photos and prices from your store, grab what you want, and send the list to your Kroger pickup cart.

It's a personal side project, not a product: plain HTML/JS with no build step, served by a small Cloudflare Worker that proxies the Kroger API. Every player signs in with their own Kroger account.

> The **`local`** branch is the original single-user version: one Python file, no dependencies, one Kroger login stored on disk.

## Setup

You need Node 22+ (`.nvmrc` says 24) and a free Cloudflare account.

1. Register an app at [developer.kroger.com](https://developer.kroger.com):
   - Enable **Products**, **Locations**, **Cart** and **Profile**.
   - Add a redirect URI for every place the game runs: `http://localhost:8642/callback` for local dev, plus `https://kroger-walk.<your-subdomain>.workers.dev/callback` once it's deployed.
   - Kroger rejects app names that contain "Kroger".
2. Run `npm install`.
3. Copy `.dev.vars.example` to `.dev.vars` and fill it in. `SESSION_KEY` is any long random string.
4. Run `npm run dev` and open **http://localhost:8642**.

## Deploy

```sh
npx wrangler login
npx wrangler secret put KROGER_CLIENT_ID
npx wrangler secret put KROGER_CLIENT_SECRET
npx wrangler secret put SESSION_KEY      # a different random string than dev
npm run deploy
```

**Lock it to your friends.** In the Cloudflare dashboard, go to *Workers & Pages → kroger-walk → Domains* (older dashboards: *Settings → Domains & Routes*) and enable **Cloudflare Access** on the workers.dev URL. Then add an Access policy that allows only your friends' email addresses (free for up to 50 users). Anyone not on the list never reaches the game, so they can't spend your Kroger API quota.

## How it works

| Path | What it does |
|---|---|
| `public/` | The game: `index.html` (page, HUD, modals), `store.js` (104×40 floor plan), `catalog.js` (sections and offline sample products), `game.js` (movement, search, cart, checkout, match & send), `shelf.js` (first-person shelves; live products are cached 12h in localStorage) |
| `src/worker.js` | Kroger OAuth, store search, product search, photo proxy and cart add. Anything that isn't one of these routes is served from `public/` |
| `wrangler.toml` | Worker config. The dev server runs on port 8642 so it matches the registered redirect URI |

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
- Everyone shares one Kroger app's daily rate limits. The 12h shelf cache keeps usage low.
- `.dev.vars` is git-ignored.
