// Per-store map. Built once per store from a few hundred Kroger searches, saved on the server
// and shared by everyone shopping that store. Kroger tells us each product's aisle, side, bay
// and shelf at the store, but not the floor plan, so the numbered aisles run left to right by
// number and the departments around the edge follow a standard Kroger template.

// broad enough to touch every aisle in a typical Kroger; each is one search (50 products)
const STORE_TERMS = [...new Set([
  // produce & floral
  'apples', 'bananas', 'oranges', 'grapes', 'berries', 'melon', 'lemons', 'avocado', 'tomatoes', 'potatoes',
  'onions', 'garlic', 'carrots', 'broccoli', 'lettuce', 'salad kit', 'spinach', 'bell peppers', 'cucumber',
  'mushrooms', 'fresh herbs', 'celery', 'corn on the cob', 'sweet potatoes', 'squash', 'cut fruit', 'flowers', 'bouquet',
  // bakery & deli
  'bakery bread', 'donuts', 'muffins', 'bagels', 'cake', 'cookies bakery', 'pie', 'croissant', 'rolls',
  'deli meat', 'deli cheese', 'rotisserie chicken', 'potato salad', 'hummus', 'fried chicken', 'sushi', 'pizza deli',
  // meat & seafood
  'ground beef', 'chicken breast', 'chicken thighs', 'pork chops', 'pork', 'steak', 'roast beef', 'ground turkey',
  'bacon', 'sausage', 'hot dogs', 'ham', 'meatballs', 'salmon', 'shrimp', 'fish fillet', 'tilapia', 'crab', 'plant based meat',
  // dairy & refrigerated
  'milk', 'oat milk', 'almond milk', 'coffee creamer', 'half and half', 'heavy cream', 'butter', 'margarine',
  'eggs', 'shredded cheese', 'sliced cheese', 'cream cheese', 'cottage cheese', 'sour cream', 'yogurt', 'greek yogurt',
  'string cheese', 'whipped topping', 'refrigerated dough', 'biscuits', 'orange juice', 'lemonade', 'pudding', 'dips', 'tofu',
  // frozen
  'frozen pizza', 'frozen meals', 'frozen vegetables', 'frozen fruit', 'frozen potatoes', 'french fries', 'ice cream',
  'frozen novelties', 'popsicles', 'frozen waffles', 'frozen breakfast', 'frozen burritos', 'frozen chicken', 'frozen fish',
  'frozen shrimp', 'pot pie', 'frozen snacks', 'ice', 'frozen desserts', 'frozen bread',
  // bread & breakfast
  'sandwich bread', 'buns', 'tortillas', 'english muffins', 'cereal', 'oatmeal', 'granola', 'pancake mix', 'syrup',
  'toaster pastries', 'breakfast bars', 'peanut butter', 'jelly', 'honey', 'nutella',
  // coffee, tea, drinks
  'coffee', 'ground coffee', 'coffee pods', 'instant coffee', 'tea', 'tea bags', 'hot cocoa', 'soda', 'diet soda',
  'sparkling water', 'bottled water', 'sports drink', 'energy drink', 'juice', 'apple juice', 'cranberry juice',
  'drink mix', 'iced tea', 'kombucha', 'protein shake', 'coconut water', 'tonic water',
  // baking & spices
  'flour', 'sugar', 'brown sugar', 'baking mix', 'cake mix', 'frosting', 'brownie mix', 'chocolate chips', 'baking soda',
  'baking powder', 'yeast', 'vanilla extract', 'sprinkles', 'pie filling', 'cornmeal', 'powdered milk', 'evaporated milk',
  'spices', 'seasoning', 'salt', 'pepper', 'cinnamon', 'taco seasoning', 'gravy mix', 'bouillon',
  // oils, condiments, sauces
  'cooking oil', 'olive oil', 'cooking spray', 'vinegar', 'salad dressing', 'ketchup', 'mustard', 'mayonnaise', 'relish',
  'pickles', 'olives', 'bbq sauce', 'hot sauce', 'steak sauce', 'soy sauce', 'teriyaki', 'marinade', 'salsa', 'queso',
  // pasta, rice, canned, soup
  'pasta', 'spaghetti', 'macaroni and cheese', 'pasta sauce', 'alfredo sauce', 'rice', 'instant rice', 'quinoa',
  'canned beans', 'refried beans', 'canned vegetables', 'canned corn', 'green beans', 'canned tomatoes', 'tomato paste',
  'canned fruit', 'applesauce', 'canned tuna', 'canned chicken', 'chili', 'spam', 'soup', 'ramen', 'broth', 'stuffing',
  'instant potatoes', 'boxed dinner', 'hamburger helper',
  // international
  'taco shells', 'enchilada sauce', 'tortilla chips', 'asian noodles', 'curry', 'coconut milk', 'indian food',
  'kosher', 'hispanic foods', 'rice noodles', 'salsa verde',
  // snacks & candy
  'chips', 'potato chips', 'pretzels', 'popcorn', 'crackers', 'cookies', 'snack cakes', 'trail mix', 'nuts', 'peanuts',
  'jerky', 'fruit snacks', 'granola bars', 'protein bars', 'rice cakes', 'pork rinds', 'candy', 'chocolate', 'gum', 'mints',
  'gummy candy', 'halloween candy', 'pumpkin',
  // beer & wine
  'beer', 'craft beer', 'hard seltzer', 'wine', 'red wine', 'white wine', 'sparkling wine', 'mixers',
  // household & paper
  'toilet paper', 'paper towels', 'napkins', 'tissues', 'paper plates', 'plastic cups', 'plastic utensils', 'trash bags',
  'aluminum foil', 'plastic wrap', 'storage bags', 'food storage containers', 'laundry detergent', 'fabric softener',
  'dryer sheets', 'bleach', 'dish soap', 'dishwasher detergent', 'cleaner', 'disinfecting wipes', 'sponges',
  'air freshener', 'light bulbs', 'batteries', 'candles', 'charcoal', 'lighter', 'kitchen tools', 'cookware', 'insect spray',
  // health & beauty
  'toothpaste', 'toothbrush', 'mouthwash', 'floss', 'shampoo', 'conditioner', 'body wash', 'bar soap', 'hand soap',
  'deodorant', 'razors', 'shaving cream', 'lotion', 'sunscreen', 'makeup', 'nail polish', 'hair color', 'hair care',
  'feminine care', 'cotton swabs', 'pain reliever', 'cold medicine', 'allergy medicine', 'antacid', 'vitamins',
  'first aid', 'bandages', 'eye drops', 'contact solution', 'sleep aid', 'incontinence', 'reading glasses',
  // baby & pet
  'diapers', 'baby wipes', 'baby food', 'infant formula', 'baby snacks', 'dog food', 'cat food', 'dog treats',
  'cat litter', 'pet supplies', 'bird seed',
  // front of store & general merchandise
  'greeting cards', 'gift card', 'magazines', 'phone charger', 'school supplies', 'party supplies', 'gift wrap', 'toys',
])];

// where Kroger says a product sits: a numbered aisle (and side), or an area around the store
const AREA_RULES = [
  [/PRODUCE|VEGETABLE|FRUIT|VALUE ADDED|FLORAL/, 'produce'], [/BAKERY/, 'bakery'], [/DELI|PACKAGED MEAT/, 'deli'],
  [/SEAFOOD/, 'seafood'], [/MEAT/, 'meat'], [/DAIRY/, 'dairy'], [/LEFT WALL/, 'leftwall'],
  [/FRONT|CHECKLANE|FUEL/, 'front'], [/DRUG|PHARM|GM\b/, 'pharmacy'], [/GREETING|CARD/, 'cards'],
];
const AREAS = {
  produce: 'Produce', bakery: 'Bakery', deli: 'Deli', meat: 'Meat', seafood: 'Seafood', dairy: 'Dairy',
  leftwall: 'Left Wall', front: 'Front End', pharmacy: 'Pharmacy & Health', cards: 'Cards & Gifts', misc: 'More Around the Store',
};
function placeOf(p) {
  const a = (p.aisle || '').toUpperCase().trim();
  const m = a.match(/^AISLE\s+(\d+)/);
  if (m) return { aisle: +m[1], side: p.loc && p.loc.side === 'R' ? 'R' : 'L' };
  const rule = AREA_RULES.find(([re]) => re.test(a));
  return { area: rule ? rule[1] : 'misc' };
}

// products (as returned by /api/products, deduped) -> the layout saved on the server
function assembleLayout(loc, name, products) {
  const aisles = {}, areas = {};
  const toArea = (id, list) => (areas[id] = areas[id] || []).push(...list);
  for (const p of products) {
    const at = placeOf(p);
    if (at.aisle != null) { const a = aisles[at.aisle] = aisles[at.aisle] || { num: at.aisle, L: [], R: [] }; a[at.side].push(p); }
    else toArea(at.area, [p]);
  }
  // a numbered "aisle" with only a stray product or two is usually a data glitch
  for (const [num, a] of Object.entries(aisles)) if (a.L.length + a.R.length < 6) { toArea('misc', [...a.L, ...a.R]); delete aisles[num]; }
  const n = v => parseInt(v, 10) || 0;
  // real planogram order: bay along the aisle, top shelf first, then position on the shelf
  const order = list => list.sort((a, b) => (!!b.loc - !!a.loc)
    || (a.loc && b.loc && (n(a.loc.bay) - n(b.loc.bay) || n(b.loc.shelf) - n(a.loc.shelf) || n(a.loc.pos) - n(b.loc.pos))) || 0);
  Object.values(aisles).forEach(a => { order(a.L); order(a.R); });
  Object.values(areas).forEach(order);
  return { v: 1, loc, name, built: Date.now(), count: products.length,
    aisles: Object.values(aisles).sort((a, b) => a.num - b.num), areas };
}

// "Baking Goods & Spices": the one or two Kroger categories that make up most of a shelf
function labelFor(list, fallback) {
  const count = {};
  for (const p of list) if (p.category && p.category !== 'Natural & Organic') count[p.category] = (count[p.category] || 0) + 1;
  const top = Object.entries(count).sort((a, b) => b[1] - a[1]);
  if (!top.length) return fallback;
  const keep = top.filter(([, c], i) => i < 2 && c >= Math.max(2, list.length * 0.25)).map(([c]) => c);
  return (keep.length ? keep : [top[0][0]]).join(' & ');
}

const STORE_COLORS = ['#ffd84a', '#ff9a4d', '#ff6b6b', '#ff7ab8', '#c88cff', '#6aa8ff', '#4fd2e8', '#8be36f', '#e8d38a', '#f4a3a3'];

// layout -> the same shape buildStore() returns, plus the store's sections (registered into SEC)
function buildStoreFromLayout(layout, SEC) {
  const N = layout.aisles.length;
  const has = id => layout.areas[id] && layout.areas[id].length;
  const PX = has('produce') || has('leftwall') ? 20 : 6;          // produce floor left of the aisles
  const unitX = k => PX + 5 * k;                                   // back-to-back shelf unit k
  const W = Math.max(64, unitX(N) + 2 + 3 + 2), H = 40;
  const C = { floor: '#262b38', wall: '#4d5873', sign: '#ffd84a', label: '#c9d4ea' };
  const grid = new Array(W * H);
  const put = (x, y, ch, color, walk, sec = null) => { if (x >= 0 && y >= 0 && x < W && y < H) grid[y * W + x] = { ch, color, walk, sec }; };
  const text = (x, y, s, color, walk) => [...s].forEach((ch, i) => put(x + i, y, ch, color, walk));
  const center = (x1, x2, y, s, color, walk) => text(Math.floor((x1 + x2 + 1 - s.length) / 2), y, s, color, walk);
  const pat = s => (x, y) => s[(x * 7 + y * 3) % s.length];

  // sections: each aisle side, and each area around the store
  const secs = [];
  const addSec = (id, name, list, color, extra = {}) => {
    const items = list.map(p => {
      const price = (p.promo && p.promo < p.price ? p.promo : p.price) || 0;
      return { key: 'kr:' + p.upc, name: p.size ? `${p.name} (${p.size})` : p.name, price, was: price < p.price ? p.price : 0, sec: id, product: p };
    });
    SEC[id] = { id, name, color, items, products: list, dept: extra.dept || 'Store', storeSec: true, ...extra };
    secs.push(id);
  };
  layout.aisles.forEach((a, i) => {
    const color = STORE_COLORS[i % STORE_COLORS.length];
    addSec(`a${a.num}L`, labelFor(a.L, `Aisle ${a.num} left`), a.L, color, { dept: `Aisle ${a.num}` });
    addSec(`a${a.num}R`, labelFor(a.R, `Aisle ${a.num} right`), a.R, color, { dept: `Aisle ${a.num}` });
  });
  const AREA_COLORS = { produce: '#8be36f', bakery: '#e8b86a', deli: '#ff9a4d', meat: '#ff6b6b', seafood: '#6aa8ff', dairy: '#f4f4f4',
    leftwall: '#4fd2e8', front: '#ff7ab8', pharmacy: '#c88cff', cards: '#ffd84a', misc: '#9aa4b8' };
  for (const id of Object.keys(AREAS)) if (has(id)) addSec(`z_${id}`, AREAS[id], layout.areas[id], AREA_COLORS[id], { dept: AREAS[id] });
  const colorOf = id => (SEC[id] ? SEC[id].color : '#cccccc');
  const block = (x1, y1, x2, y2, sec, glyph) => {
    for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) put(x, y, typeof glyph === 'function' ? glyph(x, y) : glyph, colorOf(sec), false, sec);
  };

  // floor and outer walls
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) put(x, y, '.', C.floor, true);
  for (let x = 0; x < W; x++) { put(x, 0, '#', C.wall, false); put(x, H - 1, '#', C.wall, false); }
  for (let y = 0; y < H; y++) { put(0, y, '#', C.wall, false); put(W - 1, y, '#', C.wall, false); }

  // back wall: service counters left to right, dairy cooler in the back-right corner
  const back = ['bakery', 'deli', 'meat', 'seafood'].filter(has);
  const dairyW = has('dairy') ? 22 : 0;
  const span = W - 2 - dairyW;
  back.forEach((id, i) => {
    const x1 = 1 + Math.floor(i * span / back.length), x2 = Math.floor((i + 1) * span / back.length);
    block(x1, 1, x2, 1, `z_${id}`, pat({ bakery: 'o%o=', deli: '=-', meat: '=', seafood: '~' }[id]));
    center(x1, x2, 0, ` ${AREAS[id].toUpperCase()} `, C.label, false);
  });
  if (has('dairy')) {
    block(W - 1 - dairyW, 1, W - 2, 1, 'z_dairy', '[');
    block(W - 2, 2, W - 2, 27, 'z_dairy', '[');
    center(W - 1 - dairyW, W - 2, 0, ' DAIRY ', C.label, false);
  }
  // left wall rack, and produce islands on the floor beside it
  if (has('leftwall')) block(1, 3, 1, 28, 'z_leftwall', pat('[]'));
  if (has('produce')) {
    for (const [x1, y1] of [[5, 6], [12, 6], [5, 14], [12, 14], [5, 22], [12, 22]]) block(x1, y1, x1 + 3, y1 + 4, 'z_produce', pat('oO6*Y%'));
    text(6, 3, 'PRODUCE', C.sign, true);
  }

  // numbered aisles: N corridors between N+1 back-to-back shelf units, cross-aisle at y=16
  const shelfRows = [[6, 15], [17, 27]];
  const aisleOf = {};
  for (let k = 0; k <= N; k++) {
    const xs = unitX(k);
    const left = k > 0 ? `a${layout.aisles[k - 1].num}R` : null;   // right side of the aisle to its left
    const right = k < N ? `a${layout.aisles[k].num}L` : null;      // left side of the aisle to its right
    for (const [y1, y2] of shelfRows) {
      if (left) block(xs, y1, xs, y2, left, '|'); else block(xs, y1, xs, y2, null, '|');
      if (right) block(xs + 1, y1, xs + 1, y2, right, '|'); else block(xs + 1, y1, xs + 1, y2, null, '|');
    }
  }
  // plain wall pieces for the outermost unit faces that have no aisle
  for (let y = 6; y <= 27; y++) for (const x of [unitX(0), unitX(N) + 1]) if (grid[y * W + x] && !grid[y * W + x].sec && y !== 16) put(x, y, '|', C.wall, false);
  const corridors = layout.aisles.map((a, i) => {
    aisleOf[`a${a.num}L`] = a.num; aisleOf[`a${a.num}R`] = a.num;
    const label = String(a.num), cx = unitX(i) + 3;
    text(cx - Math.floor((label.length - 1) / 2), 5, label, C.sign, true);
    text(cx - Math.floor((label.length - 1) / 2), 28, label, C.sign, true);
    return { name: `Aisle ${a.num}`, x1: unitX(i) + 2, x2: unitX(i) + 4, y1: 6, y2: 27, secs: [`a${a.num}L`, `a${a.num}R`] };
  });
  const corridorAt = (x, y) => (y >= 6 && y <= 27 && y !== 16 && corridors.find(c => x >= c.x1 && x <= c.x2)) || null;

  // front of store: displays, pharmacy in the corner, registers on the right
  let fx = PX + 2;
  for (const id of ['front', 'cards', 'misc'].filter(has)) {
    if (fx + 11 > W - 50) break;
    block(fx, 31, fx + 10, 33, `z_${id}`, pat({ front: 'oO^', cards: '[]=', misc: '#%&' }[id]));
    center(fx, fx + 10, 30, { front: 'FRONT END', cards: 'CARDS', misc: 'MORE ITEMS' }[id], colorOf(`z_${id}`), true);
    fx += 14;
  }
  if (has('pharmacy')) { block(2, 38, 16, 38, 'z_pharmacy', '='); center(2, 16, H - 1, ' PHARMACY ', C.label, false); }
  const lanes = Math.max(3, Math.min(7, Math.floor((W - 60) / 6)));
  const lx = W - 6 - 6 * (lanes - 1) - 2;
  for (let i = 0; i < lanes; i++) {
    const x = lx + 6 * i;
    put(x, 32, '$', colorOf('checkout'), false, 'checkout');
    block(x, 33, x, 35, 'checkout', '=');
    text(x, 31, String(i + 1), C.sign, true);
  }
  center(lx - 2, W - 2, H - 1, ' CHECKOUT ', C.label, false);
  const ex = Math.floor((fx + lx) / 2);
  center(ex - 7, ex + 7, H - 1, ' ENTRANCE ', C.sign, false);

  const cellsOf = {};
  grid.forEach((c, i) => { if (c.sec) (cellsOf[c.sec] = cellsOf[c.sec] || []).push(i); });
  for (const id of secs) if (!cellsOf[id]) cellsOf[id] = [];

  const walls = [
    { name: 'BACK WALL', secs: back.map(id => `z_${id}`) },
    { name: 'DAIRY', secs: has('dairy') ? ['z_dairy'] : [] },
    { name: 'LEFT WALL', secs: has('leftwall') ? ['z_leftwall'] : [] },
    { name: 'PHARMACY', secs: has('pharmacy') ? ['z_pharmacy'] : [] },
  ].filter(w => w.secs.length);
  const wallOf = sec => walls.find(w => w.secs.includes(sec)) || null;

  const locationName = (x, y) => {
    const cor = corridorAt(x, y);
    if (cor) return `${cor.name}: ${SEC[cor.secs[0]].name} | ${SEC[cor.secs[1]].name}`;
    if (x < unitX(0) && y <= 29) return 'Produce';
    if (x > unitX(N) + 1 && y <= 28) return 'Dairy side';
    if (y <= 4) return 'Back of store';
    if (y >= 30) return 'Front of store';
    return 'Main floor';
  };

  return { W, H, grid, cellsOf, aisleOf, AISLES: [], corridors, corridorAt, walls, wallOf, start: { x: ex, y: H - 3 },
    store: true, storeSecs: secs, layout, locationName };
}

if (typeof module !== 'undefined') module.exports = { STORE_TERMS, assembleLayout, buildStoreFromLayout, placeOf };
