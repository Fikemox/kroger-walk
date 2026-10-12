"""Kroger Walk local server: serves the game and proxies the Kroger public API.

Keeps the client secret and your login tokens on this machine (kroger_config.json,
kroger_tokens.json) instead of in the browser. Stdlib only.

    python server.py      then open http://localhost:8642
"""
import base64
import json
import os
import secrets
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

PORT = 8642
ROOT = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(ROOT, 'kroger_config.json')
TOKENS_PATH = os.path.join(ROOT, 'kroger_tokens.json')
API = 'https://api.kroger.com/v1'
USER_SCOPES = 'product.compact cart.basic:write profile.compact'


def load(path, default):
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def save(path, value):
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(value, f, indent=2)


if not os.path.exists(CONFIG_PATH):
    save(CONFIG_PATH, {
        'client_id': '',
        'client_secret': '',
        'redirect_uri': f'http://localhost:{PORT}/callback',
        'location_id': '',
        'location_name': '',
    })


def config():
    return load(CONFIG_PATH, {})


def configured():
    c = config()
    return bool(c.get('client_id') and c.get('client_secret'))


class ApiError(Exception):
    def __init__(self, status, body):
        super().__init__(f'{status}: {body[:300]}')
        self.status, self.body = status, body


def http(method, url, headers=None, data=None):
    req = urllib.request.Request(url, data=data, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            raw = r.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raise ApiError(e.code, e.read().decode('utf-8', 'replace'))


def token_request(form):
    c = config()
    basic = base64.b64encode(f"{c['client_id']}:{c['client_secret']}".encode()).decode()
    return http('POST', API + '/connect/oauth2/token',
                {'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': 'Basic ' + basic},
                urllib.parse.urlencode(form).encode())


_app_token = {'token': None, 'exp': 0}


def app_token():
    """Client-credentials token: enough for product + store search, no login needed."""
    if time.time() > _app_token['exp'] - 60:
        t = token_request({'grant_type': 'client_credentials', 'scope': 'product.compact'})
        _app_token.update(token=t['access_token'], exp=time.time() + t.get('expires_in', 1800))
    return _app_token['token']


def user_token():
    """Authorization-code token for cart writes; refreshed automatically."""
    t = load(TOKENS_PATH, None)
    if not t:
        return None
    if time.time() > t.get('expires_at', 0) - 60:
        try:
            n = token_request({'grant_type': 'refresh_token', 'refresh_token': t['refresh_token']})
        except ApiError:
            os.remove(TOKENS_PATH)
            return None
        t = store_tokens(n, t.get('refresh_token'))
    return t['access_token']


def store_tokens(t, old_refresh=None):
    data = {
        'access_token': t['access_token'],
        'refresh_token': t.get('refresh_token') or old_refresh,
        'expires_at': time.time() + t.get('expires_in', 1800),
    }
    save(TOKENS_PATH, data)
    return data


def api_get(path, params, token):
    return http('GET', f'{API}{path}?{urllib.parse.urlencode(params)}',
                {'Authorization': 'Bearer ' + token, 'Accept': 'application/json'})


def simplify_product(p):
    item = (p.get('items') or [{}])[0]
    price = item.get('price') or {}
    aisle = (p.get('aisleLocations') or [{}])[0]
    return {
        'upc': p.get('upc'),
        'name': p.get('description', ''),
        'brand': p.get('brand', ''),
        'size': item.get('size', ''),
        'price': price.get('regular') or 0,
        'promo': price.get('promo') or 0,
        'aisle': aisle.get('description', ''),
        'stock': (item.get('inventory') or {}).get('stockLevel', ''),
        'pickup': (item.get('fulfillment') or {}).get('curbside'),
        'productId': p.get('productId'),
        'img': bool(p.get('images')),
        'loc': {
            'aisle': aisle.get('number', ''), 'side': aisle.get('side', ''), 'bay': aisle.get('bayNumber', ''),
            'shelf': aisle.get('shelfNumber', ''), 'pos': aisle.get('shelfPositionInBay', ''),
            'facings': aisle.get('numberOfFacings', ''),
        } if aisle else None,
        'temp': (p.get('temperature') or {}).get('indicator', ''),
        'category': (p.get('categories') or [''])[0],
    }


IMG_SIZES = {'thumbnail', 'small', 'medium', 'large', 'xlarge'}
_img_cache = {}


def product_image(product_id, size):
    """Kroger product photo, fetched server-side so the page can read its pixels for ASCII art."""
    key = (product_id, size)
    if key not in _img_cache:
        if len(_img_cache) > 2000:
            _img_cache.clear()
        req = urllib.request.Request(f'https://www.kroger.com/product/images/{size}/front/{product_id}',
                                     headers={'User-Agent': 'Mozilla/5.0'})
        try:
            with urllib.request.urlopen(req, timeout=15) as r:
                _img_cache[key] = (r.headers.get('Content-Type', 'image/jpeg'), r.read())
        except (urllib.error.URLError, TimeoutError):
            _img_cache[key] = None
    return _img_cache[key]


_oauth_states = set()


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def log_message(self, fmt, *args):
        if '/api/' in self.path or '/callback' in self.path:
            super().log_message(fmt, *args)

    def end_headers(self):
        # product photos never change; let the browser keep them so shelves redraw instantly
        self.send_header('Cache-Control', 'max-age=604800' if self.path.startswith('/api/img') else 'no-store')
        super().end_headers()

    def send_json(self, obj, status=200):
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def redirect(self, url):
        self.send_response(302)
        self.send_header('Location', url)
        self.end_headers()

    def read_json(self):
        n = int(self.headers.get('Content-Length') or 0)
        return json.loads(self.rfile.read(n) or b'{}')

    def do_GET(self):
        url = urllib.parse.urlparse(self.path)
        q = dict(urllib.parse.parse_qsl(url.query))
        if (self.headers.get('Host') or '').startswith('127.0.0.1'):
            # the cart lives in localStorage, which is per-origin; keep everyone on the
            # same origin as the OAuth redirect so signing in doesn't "lose" the cart
            return self.redirect(f'http://localhost:{PORT}{self.path}')
        if os.path.basename(url.path).startswith('kroger_'):
            return self.send_error(404)  # never serve secrets/tokens
        routes = {
            '/api/status': self.status,
            '/auth/login': self.login,
            '/callback': self.callback,
            '/api/locations': self.locations,
            '/api/products': self.products,
            '/api/img': self.image,
        }
        if url.path in routes:
            return self.guard(routes[url.path], q)
        return super().do_GET()

    def do_POST(self):
        url = urllib.parse.urlparse(self.path)
        routes = {'/api/location': self.set_location, '/api/cart': self.add_to_cart, '/auth/logout': self.logout}
        if url.path in routes:
            return self.guard(routes[url.path], self.read_json())
        self.send_error(404)

    def guard(self, fn, arg):
        try:
            fn(arg)
        except ApiError as e:
            self.send_json({'error': f'Kroger API error {e.status}', 'detail': e.body[:500]}, 502)
        except Exception as e:  # keep the game alive no matter what
            self.send_json({'error': str(e)}, 500)

    # ---- routes ----
    def status(self, _):
        c = config()
        self.send_json({
            'configured': configured(),
            'loggedIn': bool(load(TOKENS_PATH, None)),
            'locationId': c.get('location_id', ''),
            'locationName': c.get('location_name', ''),
        })

    def login(self, _):
        if not configured():
            return self.redirect('/?kroger=notconfigured')
        c = config()
        state = secrets.token_urlsafe(16)
        _oauth_states.add(state)
        self.redirect(API + '/connect/oauth2/authorize?' + urllib.parse.urlencode({
            'scope': USER_SCOPES, 'response_type': 'code', 'client_id': c['client_id'],
            'redirect_uri': c['redirect_uri'], 'state': state,
        }))

    def callback(self, q):
        if q.get('state') not in _oauth_states or 'code' not in q:
            return self.redirect('/?kroger=loginfailed')
        _oauth_states.discard(q['state'])
        t = token_request({'grant_type': 'authorization_code', 'code': q['code'],
                           'redirect_uri': config()['redirect_uri']})
        store_tokens(t)
        self.redirect('/?kroger=connected')

    def logout(self, _):
        if os.path.exists(TOKENS_PATH):
            os.remove(TOKENS_PATH)
        self.send_json({'ok': True})

    def locations(self, q):
        res = api_get('/locations', {'filter.zipCode.near': q.get('zip', ''), 'filter.limit': 10,
                                     'filter.radiusInMiles': 25}, app_token())
        self.send_json({'locations': [{
            'id': l['locationId'],
            'name': l.get('name', ''),
            'chain': l.get('chain', ''),
            'address': '{addressLine1}, {city} {zipCode}'.format_map(
                {'addressLine1': '', 'city': '', 'zipCode': '', **l.get('address', {})}),
        } for l in res.get('data', [])]})

    def set_location(self, body):
        c = config()
        c['location_id'], c['location_name'] = body.get('id', ''), body.get('name', '')
        save(CONFIG_PATH, c)
        self.send_json({'ok': True})

    def products(self, q):
        term = ' '.join(q.get('term', '').split()[:8])
        if len(term) < 3:
            return self.send_json({'products': []})
        params = {'filter.term': term, 'filter.limit': max(1, min(50, int(q.get('limit') or 6)))}
        if config().get('location_id'):
            params['filter.locationId'] = config()['location_id']
        res = api_get('/products', params, app_token())
        self.send_json({'products': [simplify_product(p) for p in res.get('data', [])]})

    def image(self, q):
        pid, size = q.get('id', ''), q.get('size', 'medium')
        if not (pid.isdigit() and 6 <= len(pid) <= 14) or size not in IMG_SIZES:
            return self.send_error(400)
        img = product_image(pid, size)
        if not img:
            return self.send_error(404)
        self.send_response(200)
        self.send_header('Content-Type', img[0])
        self.send_header('Content-Length', str(len(img[1])))
        self.end_headers()
        self.wfile.write(img[1])

    def add_to_cart(self, body):
        token = user_token()
        if not token:
            return self.send_json({'error': 'Not logged in to Kroger', 'login': True}, 401)
        items = [{'upc': i['upc'], 'quantity': max(1, int(i['quantity'])), 'modality': 'PICKUP'}
                 for i in body.get('items', []) if i.get('upc')]
        if not items:
            return self.send_json({'error': 'Nothing to add'}, 400)
        http('PUT', API + '/cart/add',
             {'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'},
             json.dumps({'items': items}).encode())
        self.send_json({'ok': True, 'added': len(items)})


if __name__ == '__main__':
    print(f'Kroger Walk on http://localhost:{PORT}  (Kroger API {"configured" if configured() else "NOT configured - edit kroger_config.json"})')
    ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
