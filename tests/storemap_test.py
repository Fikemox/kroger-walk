"""End to end: build the Springboro map, walk it, search it, toggle back and forth. usage: storemap_test.py <base url> <password> [skipbuild]"""
import asyncio, json, os, sys, time
from playwright.async_api import async_playwright

BASE, PW = sys.argv[1], sys.argv[2]
SKIP = len(sys.argv) > 3
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out', 'storemap')
os.makedirs(OUT, exist_ok=True)


async def snap(pg, name):
    await pg.wait_for_timeout(400)
    await pg.screenshot(path=os.path.join(OUT, name + '.png'))


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(channel='chrome')
        ctx = await b.new_context(viewport={'width': 1600, 'height': 900})
        pg = await ctx.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(BASE)
        if await pg.query_selector('input[name=password]'):
            await pg.fill('input[name=password]', PW); await pg.click('button'); await pg.wait_for_timeout(1000)
        await pg.evaluate("fetch('/api/location',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:'01400925',name:'Kroger Springboro'})})")
        await pg.evaluate("localStorage.clear(); localStorage.setItem('kw-seen-help','true'); localStorage.setItem('kw-cart','{}')")
        await pg.reload(); await pg.wait_for_timeout(1500)
        print('generic map:', await pg.evaluate("document.querySelector('#map').innerText.split('\\n')[0].length"), 'cols')

        await pg.keyboard.press('k'); await pg.wait_for_timeout(1500)
        print('map row:', (await pg.inner_text('#mapRow')).replace('\n', ' '))
        if not SKIP:
            await pg.click('#mapRow [data-m]')
            await pg.wait_for_timeout(500)
            await snap(pg, '01_confirm')
            print('confirm:', (await pg.inner_text('#modal .help'))[:160].replace('\n', ' '), '...')
            t0 = time.time()
            await pg.click('#bdGo')
            await pg.wait_for_timeout(4000)
            await snap(pg, '02_progress')
            print('progress:', await pg.inner_text('#bdMsg'))
            await pg.wait_for_event('load', timeout=300000)
            print(f'built and reloaded in {time.time() - t0:.0f}s')
        else:
            await pg.evaluate("localStorage.setItem('kw-map', '01400925')"); await pg.reload()
        await pg.wait_for_timeout(2500)
        info = await pg.evaluate("""() => ({ cols: document.querySelector('#map').innerText.split('\\n')[0].length, rows: document.querySelector('#map').innerText.split('\\n').length,
          pref: localStorage.getItem('kw-map'), font: document.querySelector('#map').style.fontSize, dir: [...document.querySelectorAll('#dir div')].slice(0, 6).map(d => d.innerText) })""")
        print('store map:', json.dumps(info, ensure_ascii=False))
        await snap(pg, '03_store_map')

        # walk into aisle 13 by directions
        await pg.evaluate("kw.navigate('a13L')")
        print('directions:', (await pg.inner_text('#log')).split('\n')[-1])
        await pg.evaluate("""async () => { const sleep = ms => new Promise(r => setTimeout(r, ms));
          for (let i = 0; i < 400 && kw.mode !== 'fp'; i++) { const n = kw.path[kw.path.length - 1]; if (n == null) break;
            const W = document.querySelector('#map').innerText.split('\\n')[0].length;
            kw.step(Math.sign(n % W - kw.player.x), Math.sign(Math.floor(n / W) - kw.player.y)); await sleep(15); } }""")
        await pg.wait_for_timeout(2000)
        fp = await pg.evaluate("document.querySelector('#fp').innerText.split('\\n').slice(0, 2).join(' / ')")
        print('first person:', fp)
        print('selected:', await pg.inner_text('#fpInfo .fi-name'), '|', (await pg.inner_text('#fpInfo')).split('\n')[-1][:60])
        await snap(pg, '04_aisle13')
        await pg.keyboard.press('Enter'); await pg.wait_for_timeout(300)
        await pg.keyboard.press('Tab'); await pg.wait_for_timeout(1300)
        print('turned:', await pg.evaluate("document.querySelector('#fp').innerText.split('\\n')[0].trim()"))
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(900)

        # search the store's real products
        await pg.keyboard.press('/'); await pg.wait_for_timeout(300)
        await pg.keyboard.type("frank's red hot"); await pg.wait_for_timeout(500)
        rows = await pg.locator('#sRows .row').all_inner_texts()
        print('search:', [r.replace('\n', ' ')[:70] for r in rows[:4]], '| header:', await pg.inner_text('#modal .ttl'))
        await pg.keyboard.press('Enter'); await pg.wait_for_timeout(500)
        print('trail:', (await pg.inner_text('#log')).split('\n')[-1])
        await pg.keyboard.press('Escape')

        # cart groups store sections
        print('cart:', (await pg.inner_text('#cartList')).replace('\n', ' ')[:120])

        # toggle back to generic, then to store again
        await pg.keyboard.press('k'); await pg.wait_for_timeout(1500)
        print('map row (store on):', (await pg.inner_text('#mapRow')).replace('\n', ' '))
        await pg.click('#mapRow [data-m="generic"]'); await pg.wait_for_load_state('load'); await pg.wait_for_timeout(1500)
        print('after Generic:', await pg.evaluate("[document.querySelector('#map').innerText.split('\\n')[0].length, localStorage.getItem('kw-map')]"))
        await pg.keyboard.press('k'); await pg.wait_for_timeout(1500)
        await pg.click('#mapRow [data-m="store"]'); await pg.wait_for_load_state('load'); await pg.wait_for_timeout(2500)
        print('after Store:', await pg.evaluate("[document.querySelector('#map').innerText.split('\\n')[0].length, localStorage.getItem('kw-map')]"))
        print('errors:', errs)
        await b.close()

asyncio.run(main())
