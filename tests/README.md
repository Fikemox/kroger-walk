# Browser tests

Playwright scripts that drive installed Chrome against local dev. They're not a test suite with assertions. Each one plays a scripted session, prints what happened, and saves screenshots to `tests/out/`, which is git-ignored, so you read the output and look at the pictures.

**Setup:** `pip install playwright pillow` and have Chrome installed. Start the game with `npm run dev`; the scripts expect http://localhost:8642. `.dev.vars` must include `SITE_PASSWORD=localtest-pw` (the scripts type it) and `DEV_ORIGIN=http://localhost:8642`.

Run everything from this folder. Set `PYTHONIOENCODING=utf-8` on Windows, because the output includes emoji.

| Script | What it checks |
|---|---|
| `desktop_regress.py <name>` | **Desktop regression.** Ten desktop scenarios at 1600 and 1280 wide: map, first person, grab, turn, details panel, search, Kroger pop-up and help. Shoppers are frozen, randomness is seeded, and Kroger data is served from `fixtures/` so runs repeat. Writes `out/<name>/`. Add `record` to refresh the fixtures from live Kroger. |
| `compare.py out/<a> out/<b>` | Diffs two regression runs pixel by pixel, plus the text and layout of each screen. Expect small differences inside product photos even between two runs of the same code, because of image decoding. |
| `mobile_test.py "<device>" <tag>` | **Touch layout.** Uses real touch taps in device emulation: tap-to-walk, entering an aisle, tap to select and add, swiping between bays, turning around, Back, the cart sheet, Find and Kroger, and checks for sideways scrolling. Devices used so far: `"iPhone 13"`, `"iPhone 13 landscape"`, `"iPhone SE"`, `"Pixel 7"`, `"iPad (gen 7)"`. |
| `storemap_test.py <url> <password> [skip]` | **Store maps** on desktop: build the Springboro map (about 340 real Kroger searches; pass `skip` to reuse an existing map), walk to an aisle, turn around, use Find on real products, and switch between Generic and the store map. Works against local dev or https://grocerywalk.com. |
| `storemap_mobile.py` | The store map on iPhone, in portrait and landscape: the follow camera, tapping a shelf, and Find. Needs a map already built locally. |
| `whimsy_test.py ["<device>" <tag>]` | **Shopper encounter and wheel lock.** Covers the flash, stripes and battle scene, advancing the text, the cooldown, the wheel slowing and locking, the menu choices, the kick, and the once-an-hour rule. Desktop by default; pass a device for touch. |
| `capture.py` | Records the demo video: a scripted tour captured as timestamped frames in `out/frames/` (a warm-up pass, then the recorded pass). Turn the frames into 60 fps video with ffmpeg: `ffmpeg -f concat -i out/frames/list.txt -vf fps=60 demo.mp4`. |

**Proving desktop is unchanged after a change:** check out the previous commit into a separate worktree and serve it with `npx wrangler dev --cwd <worktree>`. Run `desktop_regress.py before` against it, then run `desktop_regress.py after` against your change and `python compare.py out/before out/after`. Any difference outside product photos is a real change.

**Shortcuts in the browser console:** the game exposes `window.kw` for testing. For example, `kw.navigate('dairy')`, `kw.encounter(kw.npcs[0])`, `kw.lockWheel()`, `kw.player`, `kw.mode`, `kw.cam`.
