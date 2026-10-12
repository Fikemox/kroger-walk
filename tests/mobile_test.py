"""Phone test: real touch taps in device emulation. usage: python mobile_test.py <device name> <tag>"""
import asyncio, json, os, sys
from playwright.async_api import async_playwright

DEV, TAG = sys.argv[1], sys.argv[2]
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out', 'mobile')
os.makedirs(OUT, exist_ok=True)
log = lambda *a: print(TAG, '|', *a)


async def cell_xy(pg, x, y):
    """screen point of map cell (x, y) through the follow camera"""
    return await pg.evaluate("""([x, y]) => {
      const c = kw.cam, r = document.querySelector('#map').getBoundingClientRect();
      if (x < c.x0 || x >= c.x0 + c.w || y < c.y0 || y >= c.y0 + c.h) return null;
      return [r.left + (x - c.x0 + 0.5) * r.width / c.w, r.top + (y - c.y0 + 0.5) * r.height / c.h];
    }""", [x, y])


async def until(pg, js, ms=15000):
    await pg.wait_for_function(js, timeout=ms)


async def snap(pg, name):
    await pg.wait_for_timeout(400)
    await pg.screenshot(path=os.path.join(OUT, f'{TAG}_{name}.png'))


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(channel='chrome')
        ctx = await b.new_context(**p.devices[DEV])
        pg = await ctx.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://localhost:8642/')
        await pg.fill('input[name=password]', 'localtest-pw')
        await pg.tap('button')
        await pg.wait_for_timeout(1000)
        await pg.evaluate("fetch('/api/location',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:'01400925',name:'Kroger Springboro'})})")
        await pg.evaluate("localStorage.clear(); localStorage.setItem('kw-cart','{}')")
        await pg.reload()
        await pg.wait_for_timeout(1500)
        info = await pg.evaluate("() => ({ M: kw.M, vw: innerWidth, vh: innerHeight, scrollW: document.documentElement.scrollWidth, scrollH: document.documentElement.scrollHeight, cam: kw.cam, mapFont: document.querySelector('#map').style.fontSize })")
        log('setup', json.dumps(info))
        await snap(pg, '01_help')
        await pg.tap('#hlpGo')
        await snap(pg, '02_map')

        # tap a floor cell a few steps away: should walk there
        start = await pg.evaluate("[kw.player.x, kw.player.y]")
        xy = await cell_xy(pg, start[0] - 6, start[1] - 3)
        await pg.touchscreen.tap(*xy)
        await pg.wait_for_timeout(1200)
        log('tap-walk', start, '->', await pg.evaluate("[kw.player.x, kw.player.y]"), '(wanted', [start[0] - 6, start[1] - 3], ')')

        # tap a condiments shelf cell in aisle 7: walk there and drop into first person
        await pg.evaluate("kw.navigate('condiments')")  # also what tapping does; then verify a real tap too below
        await until(pg, "kw.mode === 'fp'", 20000)
        await until(pg, "/live/.test(document.querySelector('#fp').textContent)", 20000)
        await pg.wait_for_timeout(1500)
        g = await pg.evaluate("() => ({ size: (() => { const t = document.querySelector('#fp').innerText.split('\\n'); return [t[0].length, t.length]; })(), font: document.querySelector('#fp').style.fontSize, bar: getComputedStyle(document.querySelector('#mBar')).display, head: document.querySelector('#fp').innerText.split('\\n').slice(0, 2) })")
        log('first person', json.dumps(g))
        await snap(pg, '03_fp')

        # tap the second product on the top shelf: select it; tap again: add it
        fpr = await pg.evaluate("(() => { const r = document.querySelector('#fp').getBoundingClientRect(); const t = document.querySelector('#fp').innerText.split('\\n'); return [r.left, r.top, r.width / t[0].length, r.height / t.length]; })()")
        px, py = fpr[0] + (6 + 13 + 6) * fpr[2], fpr[1] + (3 + 3) * fpr[3]
        before = await pg.inner_text('#fpInfo .fi-name')
        await pg.touchscreen.tap(px, py)
        await pg.wait_for_timeout(300)
        after = await pg.inner_text('#fpInfo .fi-name')
        log('tap select:', before[:30], '->', after[:30])
        await pg.touchscreen.tap(px, py)
        await pg.wait_for_timeout(300)
        log('tap again -> cart tab', repr(await pg.inner_text('#mCartN')), '| panel:', (await pg.inner_text('#fpInfo .fi-cart')))
        await pg.tap('#mBar .add')
        await pg.wait_for_timeout(300)
        log('+ Add button -> cart', repr(await pg.inner_text('#mCartN')))
        await pg.tap('#mBar [data-k="x"]')
        await pg.wait_for_timeout(300)
        log('- button -> cart', repr(await pg.inner_text('#mCartN')))
        await snap(pg, '04_fp_added')

        # swipe left: next bay
        bay0 = await pg.evaluate("document.querySelector('#fp').innerText.match(/bay \\d+\\/\\d+/)[0]")
        await pg.evaluate("""() => { const b = document.querySelector('.fp-box'), r = b.getBoundingClientRect(), y = r.top + r.height / 2;
          b.dispatchEvent(new PointerEvent('pointerdown', { clientX: r.right - 30, clientY: y, bubbles: true }));
          b.dispatchEvent(new PointerEvent('pointerup', { clientX: r.left + 30, clientY: y, bubbles: true })); }""")
        await pg.wait_for_timeout(600)
        bay1 = await pg.evaluate("document.querySelector('#fp').innerText.match(/bay \\d+\\/\\d+/)[0]")
        log('swipe:', bay0, '->', bay1)

        # turn around
        turn = await pg.inner_text('#mBar [data-k="Tab"]')
        await pg.tap('#mBar [data-k="Tab"]')
        await pg.wait_for_timeout(900)
        log('turn button', repr(turn), '-> now facing', (await pg.evaluate("document.querySelector('#fp').innerText.split('\\n')[0]")).strip()[:40])
        await snap(pg, '05_fp_turned')

        # back to the map
        await pg.tap('#mBar [data-k="Escape"]')
        await until(pg, "kw.mode === 'walk'")
        await pg.wait_for_timeout(400)
        log('back -> mode', await pg.evaluate("kw.mode"), '| bar shown:', await pg.evaluate("getComputedStyle(document.querySelector('#mBar')).display"))

        # a real tap on a shelf on the map
        await pg.evaluate("kw.player.x = 43; kw.player.y = 30; kw.step(0, 1)")
        await pg.wait_for_timeout(300)
        xy = await cell_xy(pg, 46, 32)  # halloween island
        if xy:
            await pg.touchscreen.tap(*xy)
            await until(pg, "kw.mode === 'fp'", 15000)
            await pg.wait_for_timeout(1200)
            log('tapped Halloween display on the map -> first person:', (await pg.evaluate("document.querySelector('#fp').innerText.split('\\n')[0]")).strip()[:40])
            await pg.tap('#mBar [data-k="Escape"]')
            await until(pg, "kw.mode === 'walk'")
        else:
            log('halloween cell not on screen')

        # cart sheet
        await pg.tap('#mTabs [data-tab="cart"]')
        await snap(pg, '06_cart')
        log('cart sheet open:', await pg.evaluate("document.documentElement.classList.contains('sheet')"))
        await pg.tap('#mTabs [data-tab="cart"]')
        await pg.wait_for_timeout(300)

        # find: search milk, tap first product result -> walks there
        await pg.tap('#mTabs [data-tab="find"]')
        await pg.fill('#sInput', 'milk')
        await pg.wait_for_timeout(300)
        await snap(pg, '07_find')
        await pg.tap('#sRows .row[data-i="1"] .nm')
        await until(pg, "kw.mode === 'fp'", 20000)
        await pg.wait_for_timeout(1500)
        log('find milk -> first person at', (await pg.evaluate("document.querySelector('#fp').innerText.split('\\n')[0]")).strip()[:40], '| selected:', (await pg.inner_text('#fpInfo .fi-name'))[:40])
        await snap(pg, '08_find_fp')

        # kroger tab (step out of the aisle first; landscape hides the tabs in first person)
        await pg.tap('#mBar [data-k="Escape"]')
        await until(pg, "kw.mode === 'walk'")
        await pg.wait_for_timeout(400)
        await pg.tap('#mTabs [data-tab="kroger"]')
        await snap(pg, '09_kroger')
        await pg.tap('#mTabs [data-tab="map"]')
        await pg.wait_for_timeout(800)
        sw = await pg.evaluate("[document.documentElement.scrollWidth, innerWidth]")
        log('no sideways scroll:', sw[0] <= sw[1], sw)
        log('errors:', errs)
        await b.close()

asyncio.run(main())
