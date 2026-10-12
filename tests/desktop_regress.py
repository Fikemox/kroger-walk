"""Desktop regression: same scripted scenarios, deterministic data, screenshots + DOM text.
usage: python desktop_regress.py <name> [record]   (writes tests/out/<name>)"""
import asyncio, json, os, sys, hashlib
from playwright.async_api import async_playwright
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out', sys.argv[1]); RECORD = len(sys.argv) > 2
FIX = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures')
os.makedirs(OUT, exist_ok=True)
SEED = """(() => { const si = window.setInterval; window.setInterval = (f, ms, ...a) => (ms === 330 || ms === 450 ? 0 : si(f, ms, ...a)); let s = 1234567; Math.random = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; }; })();"""
KEYS = """async (seq) => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const ev = (k, t, o={}) => document.dispatchEvent(new KeyboardEvent(t, { key: k, bubbles: true, ...o }));
  for (const [k, n, gap] of seq) for (let i = 0; i < n; i++) { ev(k, 'keydown'); await sleep(30); ev(k, 'keyup'); await sleep(gap); }
}"""
def fx(url):
    return os.path.join(FIX, hashlib.md5(url.split('/api/', 1)[1].encode()).hexdigest() + '.json')
async def route_api(route):
    url = route.request.url
    if '/api/products' in url or '/api/locations' in url:
        f = fx(url)
        if RECORD or not os.path.exists(f):
            resp = await route.fetch(); body = await resp.text()
            open(f, 'w', encoding='utf-8').write(body)
        await route.fulfill(status=200, content_type='application/json', body=open(f, encoding='utf-8').read())
    elif '/api/status' in url:
        await route.fulfill(status=200, content_type='application/json', body=json.dumps({
            'configured': True, 'loggedIn': False, 'locationId': '01400925', 'locationName': 'Kroger Springboro',
            'quota': {'products': {'used': 10, 'limit': 10000, 'left': 9990}, 'locations': {'used': 0, 'limit': 1600, 'left': 1600}, 'cart': {'used': 0, 'limit': 5000, 'left': 5000}}}))
    elif '/api/hello' in url:   # no other players, so named shoppers don't touch the seeded randomness
        await route.fulfill(status=200, content_type='application/json', body=json.dumps({'me': None, 'players': []}))
    else:
        await route.continue_()
async def shot(pg, name):
    await pg.wait_for_timeout(300)
    await pg.wait_for_function("[...document.images].every(i => i.complete)", timeout=15000)
    await pg.wait_for_timeout(200)
    await pg.screenshot(path=os.path.join(OUT, name + '.png'))
    txt = await pg.evaluate("""() => ({ header: document.querySelector('header').innerText, map: document.querySelector('#map').hidden ? null : document.querySelector('#map').innerText.length,
      fp: document.querySelector('#fp').hidden ? null : document.querySelector('#fp').innerText, modal: document.querySelector('#modal').hidden ? null : document.querySelector('#modal').innerText,
      cart: document.querySelector('#cartList').innerText, totals: document.querySelector('#cartTotals').innerText,
      info: document.querySelector('#fpInfo') && !document.querySelector('#fpInfo').hidden ? document.querySelector('#fpInfo').innerText : null,
      sizes: [...document.querySelectorAll('header, main, footer, #mapwrap, #map, #fp, #modal, #fpInfo, aside, .side')].map(e => e.id + '.' + e.className + ':' + JSON.stringify(e.getBoundingClientRect())) })""")
    json.dump(txt, open(os.path.join(OUT, name + '.json'), 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
async def run(p, w, h):
    b = await p.chromium.launch(channel='chrome')
    ctx = await b.new_context(viewport={'width': w, 'height': h})
    await ctx.add_init_script(SEED)
    pg = await ctx.new_page()
    errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    await pg.goto('http://localhost:8642/')
    if await pg.query_selector('input[name=password]'):
        await pg.fill('input[name=name]', 'Tester'); await pg.fill('input[name=password]', 'localtest-pw'); await pg.click('button'); await pg.wait_for_timeout(800)
    await pg.route('**/api/**', route_api)
    await pg.evaluate("localStorage.clear()")
    await pg.reload(); await pg.wait_for_timeout(1500)
    t = f'{w}'
    await shot(pg, t + '_01_help')
    await pg.keyboard.press('Escape'); await pg.wait_for_timeout(400)
    await shot(pg, t + '_02_map')
    await pg.evaluate(KEYS, [['d', 15, 75], ['w', 10, 75]]); await pg.wait_for_timeout(4500)
    await shot(pg, t + '_03_fp')
    await pg.evaluate(KEYS, [['d', 2, 300], ['s', 1, 300], ['Enter', 2, 300]]); await pg.wait_for_timeout(500)
    await shot(pg, t + '_04_fp_grab')
    await pg.evaluate(KEYS, [['Tab', 1, 1500]]); await shot(pg, t + '_05_fp_turn')
    await pg.evaluate(KEYS, [['i', 1, 500]]); await shot(pg, t + '_06_fp_noinfo')
    await pg.evaluate(KEYS, [['i', 1, 500], ['Escape', 1, 900]]); await shot(pg, t + '_07_back_map')
    await pg.evaluate(KEYS, [['/', 1, 400]]); await pg.keyboard.type('milk'); await pg.wait_for_timeout(800)
    await shot(pg, t + '_08_search')
    await pg.keyboard.press('Escape'); await pg.wait_for_timeout(300)
    await pg.evaluate(KEYS, [['k', 1, 600]]); await shot(pg, t + '_09_kroger')
    await pg.keyboard.press('Escape'); await pg.wait_for_timeout(300)
    await pg.evaluate(KEYS, [['?', 1, 400]]); await shot(pg, t + '_10_help_again')
    await pg.keyboard.press('Escape'); await pg.wait_for_timeout(300)
    print(w, 'errors:', errs)
    await b.close()
async def main():
    async with async_playwright() as p:
        await run(p, 1600, 900)
        await run(p, 1280, 720)
asyncio.run(main())
