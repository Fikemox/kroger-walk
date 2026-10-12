// Builds the store floor plan as a W x H grid of cells:
// { ch, color, walk, sec }  — sec is the catalog section id a shelf belongs to.
//
//  y=0  #### BAKERY ### DELI ### MEAT ### SEAFOOD ### DAIRY ####
//  y=1  counters along the back wall .......................... [
//  y=6+ produce | 11 double-sided aisles | 2 freezer units     [ dairy
//  y=31 halloween island, floral, registers
//  y=39 ### SERVICE ### ENTRANCE ### CHECKOUT ###
function buildStore(colorOf) {
  const W = 104, H = 40;
  const C = { floor: '#262b38', wall: '#4d5873', sign: '#ffd84a', label: '#c9d4ea' };
  const grid = new Array(W * H);
  const put = (x, y, ch, color, walk, sec = null) => { grid[y * W + x] = { ch, color, walk, sec }; };
  const pat = s => (x, y) => s[(x * 7 + y * 3) % s.length];
  const block = (x1, y1, x2, y2, sec, glyph) => {
    for (let y = y1; y <= y2; y++)
      for (let x = x1; x <= x2; x++)
        put(x, y, typeof glyph === 'function' ? glyph(x, y) : glyph, colorOf(sec), false, sec);
  };
  const text = (x, y, s, color, walk) => [...s].forEach((ch, i) => put(x + i, y, ch, color, walk));
  const center = (x1, x2, y, s, color, walk) => text(Math.floor((x1 + x2 + 1 - s.length) / 2), y, s, color, walk);
  const vtext = (x, y, s, color) => [...s].forEach((ch, i) => put(x, y + i, ch, color, false));

  // floor + outer walls
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) put(x, y, '.', C.floor, true);
  for (let x = 0; x < W; x++) { put(x, 0, '#', C.wall, false); put(x, H - 1, '#', C.wall, false); }
  for (let y = 0; y < H; y++) { put(0, y, '#', C.wall, false); put(W - 1, y, '#', C.wall, false); }

  // back wall service counters
  const counters = [
    ['bakery', 1, 18, 'o%o=', ' BAKERY '],
    ['deli', 19, 40, '=-', ' DELI '],
    ['meat', 41, 64, '=', ' MEAT '],
    ['seafood', 65, 80, '~', ' SEAFOOD '],
    ['milk', 81, 102, '[', ' DAIRY '],
  ];
  for (const [sec, x1, x2, g, label] of counters) {
    block(x1, 1, x2, 1, sec, pat(g));
    center(x1, x2, 0, label, C.label, false);
  }

  // dairy cooler doors down the right wall
  block(102, 2, 102, 8, 'milk', '[');
  block(102, 9, 102, 14, 'cheese', '[');
  block(102, 15, 102, 20, 'yogurt', '[');
  block(102, 21, 102, 27, 'eggs', '[');
  vtext(W - 1, 11, 'DAIRY', C.label);

  // produce: wet rack on the left wall + six display islands
  block(1, 3, 1, 28, 'salad', pat('&%'));
  block(5, 6, 8, 10, 'fruit', pat('oO6*'));
  block(13, 6, 16, 10, 'berries', pat('*o:'));
  block(5, 14, 8, 18, 'veg', pat('Y%v'));
  block(13, 14, 16, 18, 'roots', pat('O0o'));
  block(5, 22, 8, 26, 'peppers', pat('o()'));
  block(13, 22, 16, 26, 'herbs', pat('Y*"'));
  vtext(0, 11, 'PRODUCE', C.label);
  text(7, 3, 'PRODUCE', C.sign, true);

  // center store: 12 back-to-back shelf units -> 11 aisles, cross-aisle at y=16
  const AISLES = [
    ['cereal', 'coffee'], ['spreads', 'baking'], ['spices', 'oils'], ['pasta', 'rice'],
    ['soup', 'canned'], ['mexican', 'asian'], ['condiments', 'chips'], ['crackers', 'candy'],
    ['soda', 'water'], ['beer', 'paper'], ['cleaning', 'health'],
  ];
  const aisleOf = {};
  AISLES.forEach(([l, r], i) => { aisleOf[l] = i + 1; aisleOf[r] = i + 1; });
  const shelfRows = [[6, 15], [17, 27]];
  for (let k = 0; k <= 11; k++) {
    const xs = 24 + 5 * k;
    const left = k === 0 ? 'bread' : AISLES[k - 1][1];
    const right = k === 11 ? 'pet' : AISLES[k][0];
    for (const [y1, y2] of shelfRows) {
      block(xs, y1, xs, y2, left, '|');
      block(xs + 1, y1, xs + 1, y2, right, '|');
    }
  }
  for (let n = 1; n <= 11; n++) {
    const cx = 27 + 5 * (n - 1);
    text(cx, 5, String(n), C.sign, true);
    text(cx, 28, String(n), C.sign, true);
  }

  // frozen: two freezer units, doors on both faces
  for (const [xs, left, right] of [[86, 'frozen-meals', 'frozen-pizza'], [93, 'ice-cream', 'frozen-veg']]) {
    for (const [y1, y2] of shelfRows) {
      block(xs, y1, xs, y2, left, '[');
      block(xs + 1, y1, xs + 1, y2, right, ']');
    }
  }
  text(88, 5, 'FROZEN', C.sign, true);

  // front of store
  block(34, 31, 46, 33, 'seasonal', pat('oO^'));
  center(34, 46, 30, 'HALLOWEEN', '#ff8a1f', true);
  block(4, 32, 9, 34, 'floral', pat('*+*'));
  text(4, 31, 'FLORAL', C.sign, true);
  block(2, 38, 14, 38, 'service', '=');
  center(2, 14, H - 1, ' SERVICE ', C.label, false);
  for (let i = 0; i < 7; i++) {
    const x = 56 + 6 * i;
    put(x, 32, '$', colorOf('checkout'), false, 'checkout');
    block(x, 33, x, 35, 'checkout', '=');
    text(x, 31, String(i + 1), C.sign, true);
  }
  center(54, 98, H - 1, ' CHECKOUT ', C.label, false);
  center(36, 50, H - 1, ' ENTRANCE ', C.sign, false);

  const cellsOf = {};
  grid.forEach((c, i) => { if (c.sec) (cellsOf[c.sec] = cellsOf[c.sec] || []).push(i); });

  // walkways that count as "being in an aisle" (first-person view); the y=16 cross-aisle doesn't
  const corridors = AISLES.map(([l, r], i) => ({ name: `Aisle ${i + 1}`, x1: 26 + 5 * i, x2: 28 + 5 * i, secs: [l, r] }));
  corridors.push({ name: 'Frozen A', x1: 81, x2: 85, secs: ['pet', 'frozen-meals'] });
  corridors.push({ name: 'Frozen B', x1: 88, x2: 92, secs: ['frozen-pizza', 'ice-cream'] });
  const corridorAt = (x, y) => (y >= 6 && y <= 27 && y !== 16 && corridors.find(c => x >= c.x1 && x <= c.x2)) || null;

  // outside walls you can walk up to and face like an aisle; sections in walking order
  const walls = [
    { name: 'BACK WALL', secs: ['bakery', 'deli', 'meat', 'seafood'] },
    { name: 'DAIRY WALL', secs: ['milk', 'cheese', 'yogurt', 'eggs'] },
    { name: 'PRODUCE WALL', secs: ['salad'] },
    { name: 'CUSTOMER SERVICE', secs: ['service'] },
  ];
  const wallOf = sec => walls.find(w => w.secs.includes(sec)) || null;

  return { W, H, grid, cellsOf, aisleOf, AISLES, corridors, corridorAt, walls, wallOf, start: { x: 43, y: 37 } };
}

if (typeof module !== 'undefined') module.exports = { buildStore };
