import asyncio, json, os, sys
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out', 'storemap')
os.makedirs(OUT, exist_ok=True)
from playwright.async_api import async_playwright
async def run(p, b, dev, tag):
    ctx = await b.new_context(**p.devices[dev]); pg = await ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    await pg.goto('http://localhost:8642/')
    if await pg.query_selector('input[name=password]'):
        await pg.fill('input[name=name]', 'Tester'); await pg.fill('input[name=password]', 'localtest-pw'); await pg.tap('button'); await pg.wait_for_timeout(800)
    await pg.evaluate("fetch('/api/location',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:'01400925',name:'Kroger Springboro'})})")
    await pg.evaluate("localStorage.clear(); localStorage.setItem('kw-seen-help','true'); localStorage.setItem('kw-map','01400925')")
    await pg.reload(); await pg.wait_for_timeout(2500)
    print(tag, 'camera', json.dumps(await pg.evaluate("kw.cam")), '| scrollW', await pg.evaluate("[document.documentElement.scrollWidth, innerWidth]"))
    await pg.screenshot(path=os.path.join(OUT, f'{tag}_map.png'))
    # tap a shelf in the visible window
    xy = await pg.evaluate("""() => { const c = kw.cam, r = document.querySelector('#map').getBoundingClientRect(), L = document.querySelector('#map').innerText.split(String.fromCharCode(10));
      for (let y = 0; y < c.h; y++) { const x = L[y].indexOf('|'); if (x >= 0) return [r.left + (x + 0.5) * r.width / c.w, r.top + (y + 0.5) * r.height / c.h]; } return null; }""")
    await pg.touchscreen.tap(*xy)
    await pg.wait_for_function("kw.mode === 'fp'", timeout=20000); await pg.wait_for_timeout(1500)
    print(tag, 'tapped shelf ->', (await pg.evaluate("document.querySelector('#fp').innerText.split(String.fromCharCode(10)).slice(0,2).map(s=>s.trim()).join(' / ')")), '| font', await pg.evaluate("document.querySelector('#fp').style.fontSize"))
    await pg.screenshot(path=os.path.join(OUT, f'{tag}_fp.png'))
    await pg.tap('#mBar [data-k="Escape"]'); await pg.wait_for_function("kw.mode === 'walk'")
    await pg.tap('#mTabs [data-tab="find"]'); await pg.fill('#sInput', 'pop tarts'); await pg.wait_for_timeout(400)
    await pg.tap('#sRows .row[data-i="0"] .nm'); await pg.wait_for_function("kw.mode === 'fp'", timeout=30000); await pg.wait_for_timeout(1500)
    print(tag, 'find pop tarts ->', (await pg.evaluate("document.querySelector('#fp').innerText.split(String.fromCharCode(10))[0].trim()")), '| selected:', (await pg.inner_text('#fpInfo .fi-name'))[:50])
    print(tag, 'errors:', errs)
    await ctx.close()
async def m():
    async with async_playwright() as p:
        b = await p.chromium.launch(channel='chrome')
        await run(p, b, 'iPhone 13', 'ip13'); await run(p, b, 'iPhone 13 landscape', 'ip13L')
        await b.close()
asyncio.run(m())
