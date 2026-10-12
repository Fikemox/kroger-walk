# Kroger Walk

Grocery shopping as an ASCII walking game. You walk a top-down Kroger floor plan, step into an aisle to get a first-person shelf view with real product photos and prices from your store, grab what you want, and send the list to your Kroger pickup cart.

It's a personal side project, not a product: plain HTML/JS with no build step, plus a small Python server with no dependencies beyond the standard library.

## Quick start

1. You need Python 3.10+.
2. Register an app at [developer.kroger.com](https://developer.kroger.com):
   - Enable the **Products**, **Locations**, **Cart** and **Profile** APIs.
   - Set the redirect URI to `http://localhost:8642/callback`.
   - Kroger rejects app names that contain "Kroger".
3. Copy `kroger_config.example.json` to `kroger_config.json` and fill in your client ID and secret.
4. Run `python server.py` and open **http://localhost:8642**. Use `localhost`, not `127.0.0.1`, because the OAuth redirect and localStorage both depend on the origin.
5. Pick your store when the game asks. To send items to your cart, press **K** and sign in.

Without a `kroger_config.json` the game still runs. It uses the built-in sample catalog, and there are no live shelves or cart sync.

## Controls

| Where | Keys |
|---|---|
| Store map | **WASD**/arrows move · **Shift** run · **E** look at a shelf · **/** find an item · **C** checkout · **K** Kroger · **V** toggle auto first-person · **?** help |
| First person | **A/D** product · **W/S** shelf · **Enter** grab · **X** put back · **Tab** turn around · **/** find · **I** label pop-up · **L** list · **Esc** step out |

Walking into an aisle switches to first person automatically. So does bumping into an outside wall (bakery/deli/meat/seafood, dairy, produce, service).

## Ordering

At checkout, press **K** to open *match & send*. Each list item is searched at your store, you confirm or cycle the match, and the items go to your Kroger cart via `PUT /cart/add` (pickup). Kroger's public API **can't place orders**, so you still choose a pickup time and pay in the Kroger app or on the site.

## Files

| File | What it does |
|---|---|
| `index.html` | Page, styles, HUD and modals |
| `store.js` | Builds the 104×40 floor plan: sections, aisles, walls, corridors |
| `catalog.js` | Sections and sample products used offline and for search |
| `game.js` | Movement, NPCs, search with a path trail, cart, checkout, Kroger match & send |
| `shelf.js` | First-person shelf view: live shelves per section (cached 12h in localStorage) and photo layout |
| `server.py` | Serves static files and proxies the Kroger API: OAuth, locations, product search, image proxy, cart add |

## Security notes

- `kroger_config.json` (your client secret) and `kroger_tokens.json` (your login) are git-ignored. The server also refuses to serve any `kroger_*` file.
- The secret never reaches the browser. All Kroger calls go through `server.py`.
- The server stores **one** login. It's meant for one person on their own machine. Before hosting it for others, tokens need to be stored per user (for example, in encrypted cookies), and the OAuth flow needs a `state` check.
