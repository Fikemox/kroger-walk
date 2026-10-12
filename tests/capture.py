"""Record a scripted Kroger Walk tour from headless Chrome as timestamped frames."""
import asyncio, base64, json, os, shutil, sys
from playwright.async_api import async_playwright

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out', 'frames')

TOUR = r"""
async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const ev = (k, type) => document.dispatchEvent(new KeyboardEvent(type, { key: k, bubbles: true }));
  const tap = async (k, gap) => { ev(k, 'keydown'); await sleep(30); ev(k, 'keyup'); await sleep(gap); };
  const taps = async (k, n, gap) => { for (let i = 0; i < n; i++) await tap(k, gap); };
  await sleep(1300);
  await taps('d', 15, 75);        // in from the entrance, past the registers
  await taps('w', 10, 75);        // up into aisle 7 -> first person
  await sleep(3000);
  await taps('d', 3, 700);        // browse condiments
  await tap('Tab', 1700);         // turn around to chips & salsa
  await sleep(800);              // Lay's Classic is already selected
  await tap('Enter', 1500);       // grab one
  await tap('Escape', 900);       // back to the map
  await taps('w', 22, 75);        // walk up the aisle
  await sleep(300);
  await tap('w', 2900);           // bump the meat counter -> back wall
  await taps('d', 15, 330);       // slide along Meat into Seafood
  await sleep(2400);
}
"""


async def run(record):
    async with async_playwright() as p:
        b = await p.chromium.launch(channel='chrome', headless=True, args=['--hide-scrollbars'])
        ctx = await b.new_context(viewport={'width': 1600, 'height': 900}, device_scale_factor=1)
        page = await ctx.new_page()
        await page.goto('http://localhost:8642/')
        await page.evaluate("localStorage.setItem('kw-seen-help','true'); localStorage.setItem('kw-autofp','true'); localStorage.setItem('kw-fp-info','true')")
        await page.reload()
        await page.wait_for_timeout(1500)
        # warm-up pass: loads live shelves + photos into this browser's caches
        await page.evaluate(TOUR)
        await page.evaluate("localStorage.setItem('kw-cart','{}')")
        await page.reload()
        await page.wait_for_timeout(1500)
        frames = []
        cdp = await ctx.new_cdp_session(page)
        loop = asyncio.get_running_loop()

        def on_frame(e):
            fn = os.path.join(OUT, f'f{len(frames):05d}.jpg')
            with open(fn, 'wb') as f:
                f.write(base64.b64decode(e['data']))
            frames.append((fn, e['metadata']['timestamp']))
            loop.create_task(cdp.send('Page.screencastFrameAck', {'sessionId': e['sessionId']}))

        cdp.on('Page.screencastFrame', on_frame)
        await cdp.send('Page.startScreencast', {'format': 'jpeg', 'quality': 92, 'everyNthFrame': 1})
        await page.evaluate(TOUR)
        await cdp.send('Page.stopScreencast')
        await page.wait_for_timeout(300)
        await b.close()
        return frames


if __name__ == '__main__':
    shutil.rmtree(OUT, ignore_errors=True)
    os.makedirs(OUT)
    frames = asyncio.run(run(True))
    with open(os.path.join(OUT, 'list.txt'), 'w') as f:
        for (fn, t), nxt in zip(frames, frames[1:] + [(None, frames[-1][1] + 1.0)]):
            f.write(f"file '{os.path.basename(fn)}'\nduration {max(0.001, nxt[1] - t):.4f}\n")
        f.write(f"file '{os.path.basename(frames[-1][0])}'\n")
    span = frames[-1][1] - frames[0][1]
    gaps = sorted(b[1] - a[1] for a, b in zip(frames, frames[1:]))
    print(f'frames {len(frames)} over {span:.1f}s, avg {len(frames)/span:.1f} fps, median gap {gaps[len(gaps)//2]*1000:.1f}ms')
