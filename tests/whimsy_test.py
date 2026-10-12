import asyncio, json, os, sys
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out', 'whimsy')
os.makedirs(OUT, exist_ok=True)
from playwright.async_api import async_playwright
DEV = sys.argv[1] if len(sys.argv) > 1 else None
TAG = sys.argv[2] if len(sys.argv) > 2 else 'desk'
async def m():
    async with async_playwright() as p:
        b = await p.chromium.launch(channel='chrome')
        ctx = await b.new_context(**(p.devices[DEV] if DEV else {'viewport': {'width': 1600, 'height': 900}}))
        pg = await ctx.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://localhost:8642/')
        if await pg.query_selector('input[name=password]'):
            await pg.fill('input[name=name]', 'Tester'); await pg.fill('input[name=password]', 'localtest-pw'); await pg.click('button'); await pg.wait_for_timeout(800)
        await pg.evaluate("fetch('/api/location',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:'01400925',name:'Kroger Springboro'})})")
        await pg.evaluate("localStorage.clear(); localStorage.setItem('kw-seen-help','true'); localStorage.setItem('kw-cart', JSON.stringify({'kr:1': {key:'kr:1', name:'Kraft Mac & Cheese Original (7.25 oz)', price: 1.29, sec:'pasta', qty: 2}}))")
        await pg.reload(); await pg.wait_for_timeout(1500)
        tap = (lambda sel: pg.tap(sel)) if DEV else (lambda sel: pg.click(sel))
        # put a shopper right in front of us and walk into it
        await pg.evaluate("(() => { const n = kw.npcs.find(n => !n.staff); n.x = kw.player.x; n.y = kw.player.y - 1; })()")
        await pg.evaluate("kw.step(0, -1)")
        for t, name in [(250, 'flash'), (850, 'bars'), (1700, 'scene')]:
            await pg.wait_for_timeout(t - (0 if name == 'flash' else [250, 850][['bars', 'scene'].index(name)]))
            await pg.screenshot(path=os.path.join(OUT, f'enc_{TAG}_{name}.png'))
            print(name, '->', await pg.evaluate("[kw.mode, document.querySelector('#battle').className]"))
        await pg.wait_for_timeout(800)
        lines = []
        for i in range(3):
            lines.append(await pg.inner_text('#bText'))
            if DEV: await pg.tap('#battle')
            else: await pg.keyboard.press('Enter')
            await pg.wait_for_timeout(1300)
            if i == 1: await pg.screenshot(path=os.path.join(OUT, f'enc_{TAG}_quote.png'))
        print('lines:', lines)
        for _ in range(4):
            if await pg.evaluate("kw.mode") != 'battle': break
            if DEV: await pg.tap('#battle')
            else: await pg.keyboard.press('Enter')
            await pg.wait_for_timeout(1300)
        await pg.wait_for_timeout(600)
        print('after:', await pg.evaluate("[kw.mode, document.querySelector('#battle').hidden, document.querySelector('#log').innerText.split(String.fromCharCode(10)).pop()]"))
        # cooldown: bumping again right away just squeezes past
        await pg.evaluate("(() => { const n = kw.npcs.find(n => !n.staff); n.x = kw.player.x; n.y = kw.player.y - 1; })()")
        before = await pg.evaluate("kw.player.y"); await pg.evaluate("kw.step(0, -1)")
        print('cooldown bump: mode', await pg.evaluate("kw.mode"), '| moved', before, '->', await pg.evaluate("kw.player.y"))

        # the wheel: force the squeak to start, then walk
        await pg.evaluate("kw.player.x = 43; kw.player.y = 37; kw.wheel.slowing = 1")
        drags = []
        for i in range(10):
            await pg.evaluate("kw.step(%d, 0)" % (1 if i % 2 == 0 else -1))
            drags.append(await pg.evaluate("kw.wheel.drag"))
        print('drag while slowing:', drags, '| locked:', await pg.evaluate("kw.wheel.locked"), '| mode', await pg.evaluate("kw.mode"))
        await pg.screenshot(path=os.path.join(OUT, f'wheel_{TAG}_locked.png'))
        x0 = await pg.evaluate("kw.player.x"); await pg.evaluate("kw.step(1, 0)")
        print('try to move while locked: x', x0, '->', await pg.evaluate("kw.player.x"))
        await tap('#trail [data-w="wiggle"]'); await pg.wait_for_timeout(300)
        print('wiggle:', (await pg.inner_text('#trail p')).replace('\n', ' ')[:90])
        await tap('#trail [data-w="kick"]'); await pg.wait_for_timeout(250)
        await pg.screenshot(path=os.path.join(OUT, f'wheel_{TAG}_clang.png'))
        print('kick shake:', await pg.evaluate("document.body.classList.contains('shake')"))
        await pg.wait_for_timeout(800)
        await pg.screenshot(path=os.path.join(OUT, f'wheel_{TAG}_fixed.png'))
        print('after kick:', (await pg.inner_text('#trail')).replace('\n', ' ')[:80])
        if DEV: await pg.tap('#trail')
        else: await pg.keyboard.press('Enter')
        await pg.wait_for_timeout(300)
        x0 = await pg.evaluate("kw.player.x"); await pg.evaluate("kw.step(1, 0)")
        print('moving again: mode', await pg.evaluate("kw.mode"), '| x', x0, '->', await pg.evaluate("kw.player.x"), '| kw-wheel stamped:', await pg.evaluate("!!localStorage.getItem('kw-wheel')"))
        # once an hour: with every roll a "yes", walking still won't start another squeak
        await pg.evaluate("Math.random = () => 0")
        for i in range(30): await pg.evaluate("kw.step(%d, 0)" % (1 if i % 2 else -1))
        print('second lock within the hour blocked:', await pg.evaluate("kw.wheel.slowing === 0 && !kw.wheel.locked"))
        print('errors:', errs)
        await b.close()
asyncio.run(m())
