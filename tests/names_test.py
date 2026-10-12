"""Names, password groups, Forget me and the daily build limit, in the browser.
usage: python names_test.py   (local dev; .dev.vars needs SITE_PASSWORD_FAMILY=localtest-family)
Two players log in (friends + family) and see each other on shoppers; an XSS name gets the joke;
Forget me takes a name off the list; a used build shows up as a disabled Build button. No Kroger searches."""
import asyncio, os
from playwright.async_api import async_playwright
B = 'http://localhost:8642'
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out', 'names'); os.makedirs(OUT, exist_ok=True)
shot = lambda pg, n: pg.screenshot(path=os.path.join(OUT, n + '.png'))

async def player(br, name, pw, device=None):
    ctx = await br.new_context(**(device or {'viewport': {'width': 1400, 'height': 860}}))
    pg = await ctx.new_page()
    errs, dialogs = [], []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('dialog', lambda d: (dialogs.append(d.message), asyncio.ensure_future(d.dismiss())))
    await pg.goto(B)
    await pg.evaluate("localStorage.setItem('kw-seen-help', 'true')")
    await pg.fill('input[name=name]', name); await pg.fill('input[name=password]', pw)
    await pg.click('button'); await pg.wait_for_timeout(1500)
    if await pg.query_selector('#zipIn'): await pg.keyboard.press('Escape'); await pg.wait_for_timeout(300)  # no store yet: close the picker
    return pg, errs, dialogs

async def main():
    async with async_playwright() as p:
        br = await p.chromium.launch(channel='chrome')

        # the login page itself, desktop and phone
        pg = await (await br.new_context(viewport={'width': 1400, 'height': 860})).new_page(); await pg.goto(B); await shot(pg, '01_login')
        ph = await (await br.new_context(**p.devices['iPhone 13'])).new_page(); await ph.goto(B); await shot(ph, '01_login_iphone')

        # XSS name: the joke, nothing runs, nothing reflected
        x, xerrs, xd = await player(br, '<img src=x onerror=alert(1)>', 'localtest-pw')
        html = await x.content()
        print('xss: joke shown', 'Little Bobby' in html, '| payload reflected', 'onerror=alert' in html, '| dialogs', xd, '| still on login', await x.query_selector('input[name=password]') is not None)
        await shot(x, '02_xss')
        x2, _, xd2 = await player(br, '"><svg/onload=alert(1)>', 'localtest-pw')
        print('xss 2: joke', 'Little Bobby' in await x2.content(), '| dialogs', xd2)

        alice, aerr, _ = await player(br, 'Alice', 'localtest-pw')
        bob, berr, _ = await player(br, 'Bob', 'localtest-family')
        print('alice in game', await alice.query_selector('#map') is not None, '| bob in game', await bob.query_selector('#map') is not None)

        # Bob's shoppers wear Alice's name
        await bob.evaluate('kw.hello()'); await bob.wait_for_timeout(600)
        named = await bob.evaluate("kw.npcs.filter(n => n.who).map(n => n.who + ' ' + n.ago + 'm')")
        print('bob sees named shoppers:', named)
        assert any(n.startswith('Alice') for n in named)
        await bob.evaluate("kw.encounter(kw.npcs.find(n => n.who === 'Alice'))"); await bob.wait_for_timeout(1500)
        lines = []
        for _ in range(4):
            await bob.wait_for_timeout(1400); lines.append(await bob.inner_text('#bText')); await shot(bob, f'03_battle_{len(lines)}')
            await bob.keyboard.press('Enter')
        print('battle:', lines)
        await bob.keyboard.press('Escape'); await bob.wait_for_timeout(600)

        # who you are + Forget me in the Kroger box
        await alice.keyboard.press('k'); await alice.wait_for_timeout(700)
        print('alice modal:', (await alice.inner_text('#meRow')).replace('\n', ' '))
        await shot(alice, '04_kroger_me')
        await alice.click('#forget'); await alice.wait_for_timeout(300); await shot(alice, '05_forget_confirm')
        await alice.click('#forgetYes'); await alice.wait_for_timeout(1500)
        print('alice after forget is on login:', await alice.query_selector('input[name=password]') is not None)
        await shot(alice, '06_after_forget')
        await bob.evaluate('kw.hello()'); await bob.wait_for_timeout(600)
        print('bob after Alice forgot:', await bob.evaluate("kw.npcs.filter(n => n.who).map(n => n.who)"))

        # build limit: spend Bob's build for today, then the Build button says so
        await bob.evaluate("fetch('/api/location', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({id: 'NOMAP1', name: 'Test Store'})})")
        print('give back any build left over from an earlier run:', await bob.evaluate("fetch('/api/build', {method: 'POST', body: JSON.stringify({end: true})}).then(r => r.text())"))
        print('start build:', await bob.evaluate("fetch('/api/build', {method: 'POST', body: '{}'}).then(r => r.text())"))
        await bob.evaluate('kw.refreshKroger()'); await bob.wait_for_timeout(500)
        print('kr.buildLeft', await bob.evaluate('kw.kr.buildLeft'))
        await bob.keyboard.press('k'); await bob.wait_for_timeout(1200)
        await bob.click('[data-m=build]'); await bob.wait_for_timeout(400)
        print('build button:', await bob.inner_text('#bdGo'), '| disabled', await bob.is_disabled('#bdGo'))
        await shot(bob, '07_build_used')
        print('give back:', await bob.evaluate("fetch('/api/build', {method: 'POST', body: JSON.stringify({end: true})}).then(r => r.text())"))
        print('errors', aerr, berr, xerrs)
        await br.close()

asyncio.run(main())
