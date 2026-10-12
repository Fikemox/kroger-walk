// First-person shelf view. You face one side of an aisle (or a department case) and
// read it bay by bay. Shelves are stocked from your real Kroger store when connected
// (photos turned into ASCII art), otherwise from the game catalog with drawn packages.
function createFirstPerson(ctx) {
  'use strict';
  // the shelf grid is W x H characters with SHELVES x SLOTS products per bay. Desktop always uses
  // the map's 104x40 and 7x4; touch phones call setGeometry() for a smaller, bigger-print shelf.
  let { W, H } = ctx;
  let SLOTS = 7, SHELVES = 4, compact = false;
  const SLOT_W = 12, SLOT_STEP = 13, SHELF_H = 8, TOP = 3, LEFT = 6, ART_H = 6;
  const el = ctx.fpEl;
  const DIM = '#6b7690', TEXT = '#e6ecff', EDGE = '#56627e', HILITE = '#24324f';
  let st = null;
  // product details live in a side panel to the right of the shelves, never on top of them
  let info = ctx.persist.get('kw-fp-panel', true);
  const infoEl = ctx.infoEl;

  // ---------- section search terms for live stocking ----------
  const TERMS = {
    fruit: ['apples', 'bananas', 'oranges'], berries: ['berries', 'melon'], salad: ['salad kit', 'lettuce', 'spinach'],
    veg: ['broccoli', 'carrots', 'fresh vegetables'], roots: ['potatoes', 'onions', 'garlic'],
    peppers: ['tomatoes', 'bell peppers', 'avocado'], herbs: ['fresh herbs', 'mushrooms', 'tofu'],
    bakery: ['bakery bread', 'donuts', 'muffins'], deli: ['deli meat', 'deli cheese', 'rotisserie chicken'],
    meat: ['ground beef', 'chicken breast', 'pork'], seafood: ['salmon', 'shrimp', 'fish fillet'],
    bread: ['sandwich bread', 'buns', 'tortillas'], cereal: ['cereal', 'oatmeal'], coffee: ['coffee', 'tea'],
    spreads: ['peanut butter', 'jelly', 'syrup'], baking: ['flour', 'sugar', 'baking mix'],
    spices: ['spices', 'seasoning'], oils: ['cooking oil', 'vinegar', 'salad dressing'],
    pasta: ['pasta', 'pasta sauce'], rice: ['rice', 'canned beans', 'quinoa'],
    soup: ['soup', 'broth', 'canned tuna'], canned: ['canned vegetables', 'canned tomatoes', 'canned fruit'],
    mexican: ['taco shells', 'refried beans', 'enchilada sauce'], asian: ['soy sauce', 'asian noodles', 'curry'],
    condiments: ['ketchup', 'mustard', 'pickles'], chips: ['chips', 'salsa'], crackers: ['crackers', 'cookies'],
    candy: ['candy', 'nuts', 'granola bars'], soda: ['soda', 'juice'], water: ['bottled water', 'sports drink', 'sparkling water'],
    beer: ['beer', 'wine'], paper: ['toilet paper', 'paper towels', 'trash bags'],
    cleaning: ['laundry detergent', 'dish soap', 'cleaner'], health: ['toothpaste', 'shampoo', 'pain reliever'],
    pet: ['dog food', 'cat food', 'diapers'], 'frozen-meals': ['frozen meals', 'frozen potatoes'],
    'frozen-pizza': ['frozen pizza', 'frozen snacks'], 'ice-cream': ['ice cream', 'frozen novelties'],
    'frozen-veg': ['frozen vegetables', 'frozen waffles'], milk: ['milk', 'coffee creamer', 'orange juice'],
    cheese: ['shredded cheese', 'sliced cheese', 'sour cream'], yogurt: ['yogurt', 'refrigerated dough'],
    eggs: ['eggs', 'butter'], floral: ['flowers', 'bouquet'], seasonal: ['halloween candy', 'pumpkin'], service: ['gift card'],
  };
  const termsFor = s => TERMS[s.id] || s.name.split(/\s*(?:,|&)\s*/).filter(t => t.length >= 3).slice(0, 3);

  // ---------- products ----------
  const shortName = n => n.replace(/\s*\(.*?\)/g, '').trim();
  const realPrice = p => (p.promo && p.promo < p.price ? p.promo : p.price) || 0;
  const hash = s => { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

  function fromCatalog(it, sec) {
    const m = ctx.memo[it.key];
    return {
      key: it.key, name: it.name, label: shortName(it.name), size: (it.name.match(/\(([^)]*)\)/) || [])[1] || '',
      price: it.price, was: it.was || 0, stock: '', loc: null, sec: sec.id,
      imgId: m && m.img !== false ? (m.productId || m.upc || null) : null, item: it,
    };
  }
  function fromLive(p, sec) {
    const name = p.size ? `${p.name} (${p.size})` : p.name;
    const price = realPrice(p);
    return {
      key: 'kr:' + p.upc, name: p.name, label: p.name, size: p.size, price, was: price < p.price ? p.price : 0,
      stock: p.stock, loc: p.loc, sec: sec.id, imgId: p.img ? (p.productId || p.upc) : null, live: p,
      item: { key: 'kr:' + p.upc, name, price, sec: sec.id, product: p },
    };
  }

  // Kroger counts requests, not products, so every term asks for its max page of 50
  const PER_TERM = 50;

  // Kroger's search is fuzzy ("sugar" finds Monster Zero Sugar), but it also says which aisle
  // each product sits in at your store. Keep products from the aisles where that search term,
  // and the section as a whole, mostly lives; drop the strays from other aisles.
  const SHARE_OF_TERM = 0.2, SHARE_OF_SECTION = 0.1, MIN_AISLE = 3;
  const DISPLAYS = new Set(['seasonal', 'floral', 'service']);            // spread across the store on purpose
  const VAGUE = new Set(['', 'GROCERY', 'VIRTUAL PLANOGRAM', 'ROLLING FIXTURES']);   // no real location: keep
  const CROSS_CATS = new Set(['Natural & Organic', 'International']);
  // Kroger numbers produce tables, deli and bakery counters separately; treat each as one area
  const area = a => /^AISLE \d+/.test(a) ? a : /PRODUCE|VEGETABLE|FRUIT|VALUE ADDED/.test(a) ? 'PRODUCE'
    : /DELI|PACKAGED MEAT/.test(a) ? 'DELI' : /BAKERY/.test(a) ? 'BAKERY' : a.replace(/[\s\d-]+$/, '');
  function mainAisles(products, share) {
    const count = {};
    for (const p of products) { const a = (p.aisle || '').toUpperCase(); if (!VAGUE.has(a)) count[area(a)] = (count[area(a)] || 0) + 1; }
    const top = Math.max(0, ...Object.values(count));
    return new Set(Object.keys(count).filter(a => count[a] >= Math.max(MIN_AISLE, top * share)));
  }
  function inItsAisle(lists, secId) {
    if (DISPLAYS.has(secId)) return lists;
    const section = mainAisles(lists.flat(), SHARE_OF_SECTION);
    const kept = lists.map(list => {
      const term = mainAisles(list, SHARE_OF_TERM);
      return list.filter(p => {
        const a = (p.aisle || '').toUpperCase();
        return VAGUE.has(a) || (term.has(area(a)) && section.has(area(a)));
      });
    });
    // products with no location fall back to Kroger's category: keep them only if it's one
    // the located products in this section share (sugar-free gum isn't "Baking Goods").
    // Some categories span the whole store and say nothing about where a product goes.
    const catOf = p => (CROSS_CATS.has(p.category) ? '' : p.category || '');
    const cats = {};
    for (const p of kept.flat()) if (!VAGUE.has((p.aisle || '').toUpperCase()) && catOf(p)) cats[catOf(p)] = (cats[catOf(p)] || 0) + 1;
    const top = Math.max(0, ...Object.values(cats));
    const sectionCats = new Set(Object.keys(cats).filter(c => cats[c] >= Math.max(2, top * SHARE_OF_SECTION)));
    return kept.map(list => list.filter(p => !VAGUE.has((p.aisle || '').toUpperCase()) || !sectionCats.size || !catOf(p) || sectionCats.has(catOf(p))));
  }

  // older shelf caches (48 products, then unfiltered) are superseded; free their space
  try { Object.keys(localStorage).filter(k => /^kw-shelf2?:/.test(k)).forEach(k => localStorage.removeItem(k)); } catch { /* storage blocked */ }

  // shelves are cached per store for 12h; if the browser's storage fills up, drop the oldest
  function saveShelf(key, value) {
    const json = JSON.stringify(value);
    for (let tries = 0; tries < 50; tries++) {
      try { localStorage.setItem(key, json); return; } catch { /* full: evict below */ }
      let oldest = null, oldestT = Infinity;
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k.startsWith('kw-shelf') || k === key) continue;
        const t = (ctx.persist.get(k, {}) || {}).t || 0;
        if (t < oldestT) { oldestT = t; oldest = k; }
      }
      if (!oldest) return;
      localStorage.removeItem(oldest);
    }
  }

  async function loadLive(sec) {
    const kr = ctx.kr;
    if (!kr.online || !kr.configured || !kr.locationId) return null;
    const ck = `kw-shelf3:${kr.locationId}:${sec.id}`;
    const cached = ctx.persist.get(ck, null);
    if (cached && Date.now() - cached.t < 12 * 3600e3) return cached.products;
    const terms = termsFor(sec);
    const lists = await Promise.all(terms.map(t =>
      ctx.api(`/api/products?limit=${PER_TERM}&term=${encodeURIComponent(t)}`).then(r => r.products).catch(() => [])));
    const seen = new Set(), products = [];
    for (const list of inItsAisle(lists, sec.id)) for (const p of list) if (p.upc && !seen.has(p.upc)) { seen.add(p.upc); products.push(p); }
    if (!products.length) return null;
    // real planogram order where Kroger knows it: bay, top shelf first, then position on the shelf
    const n = v => parseInt(v, 10) || 0;
    products.sort((a, b) => (!!b.loc - !!a.loc) || (a.loc && b.loc && (n(a.loc.bay) - n(b.loc.bay) || n(b.loc.shelf) - n(a.loc.shelf) || n(a.loc.pos) - n(b.loc.pos))) || 0);
    saveShelf(ck, { t: Date.now(), products });
    return products;
  }

  // flow products onto bays of SHELVES x SLOTS, each product taking 1-3 facings
  function layout(products, defaultFacings) {
    const bays = [];
    let bay, shelf, slot;
    const newBay = () => { bay = Array.from({ length: SHELVES }, () => []); bays.push(bay); shelf = 0; slot = 0; };
    newBay();
    for (const p of products) {
      let f = Math.max(1, Math.min(3, parseInt(p.loc && p.loc.facings, 10) || defaultFacings));
      if (slot >= SLOTS) { shelf++; slot = 0; if (shelf >= SHELVES) newBay(); }
      f = Math.min(f, SLOTS - slot);
      for (let i = 0; i < f; i++) bay[shelf].push(p);
      slot += f;
    }
    return bays;
  }
  function stockSeg(seg, products) {
    seg.products = products;
    seg.bays = layout(products, products.length <= 14 ? 2 : 1);
  }
  function flatten(sd) {
    sd.bays = []; sd.segAt = []; sd.start = [];
    sd.segs.forEach((seg, i) => { sd.start.push(sd.bays.length); seg.bays.forEach(b => { sd.bays.push(b); sd.segAt.push(i); }); });
  }
  const catalogFor = id => ctx.SEC[id].items.map(it => fromCatalog(it, ctx.SEC[id])).concat(ctx.customs(id));

  // ---------- real product photos ----------
  // The shelf is still a text grid, but each product's photo is an <img> laid exactly over
  // its slot. Photos that fail to load fall back to a drawn package.
  const failed = new Set();
  const layer = document.createElement('div');
  layer.className = 'fp-photos';
  el.parentNode.appendChild(layer);
  const nodes = new Map();
  let photos = [];
  let redrawQueued = false;
  function queueRedraw() {
    if (redrawQueued) return;
    redrawQueued = true;
    setTimeout(() => { redrawQueued = false; if (st && !st.anim) draw(); }, 30);
  }
  const hasPhoto = p => p.imgId && !failed.has(p.imgId);
  function placePhotos() {
    layer.style.display = '';
    const keep = new Set();
    for (const p of photos) {
      const k = `${p.id}|${p.x}|${p.y}|${p.size}`;
      keep.add(k);
      let im = nodes.get(k);
      if (!im) {
        im = new Image();
        im.alt = '';
        im.onerror = () => { failed.add(p.id); queueRedraw(); };
        im.src = `/api/img?id=${encodeURIComponent(p.id)}&size=${p.size}`;
        nodes.set(k, im);
        layer.appendChild(im);
      }
      Object.assign(im.style, { left: `${p.x / W * 100}%`, top: `${p.y / H * 100}%`, width: `${p.w / W * 100}%`, height: `${p.h / H * 100}%` });
      im.className = (p.sel ? 'sel ' : '') + (p.big ? 'big' : '');
    }
    for (const [k, im] of nodes) if (!keep.has(k)) { im.remove(); nodes.delete(k); }
  }
  function clearPhotos() { layer.style.display = 'none'; }

  // ---------- character grid ----------
  const newGrid = () => ({ ch: new Array(W * H).fill(' '), fg: new Array(W * H).fill(TEXT), bg: new Array(W * H).fill('') });
  function put(g, x, y, c, fg, bg) {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = y * W + x;
    g.ch[i] = c;
    if (fg) g.fg[i] = fg;
    if (bg !== undefined) g.bg[i] = bg;
  }
  const text = (g, x, y, s, fg, bg) => [...s].forEach((c, i) => put(g, x + i, y, c, fg, bg));
  function fillRect(g, x, y, w, h, c, fg, bg) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) put(g, x + i, y + j, c, fg, bg); }
  function wrap(s, w, lines) {
    const out = []; let cur = '';
    for (const word of s.split(/\s+/)) {
      if ((cur + ' ' + word).trim().length <= w) cur = (cur + ' ' + word).trim();
      else { if (cur) out.push(cur); cur = word.slice(0, w); }
      if (out.length === lines) break;
    }
    if (cur && out.length < lines) out.push(cur);
    return out;
  }
  const center = (s, w) => ' '.repeat(Math.max(0, Math.floor((w - s.length) / 2))) + s;
  function toHtml(g, shift = 0) {
    let html = '', run = '', style = null;
    const flush = () => { if (run) html += style ? `<span style="${style}">${run}</span>` : run; run = ''; };
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const sx = x + shift;
        const i = y * W + sx;
        const inside = sx >= 0 && sx < W;
        const c = inside ? g.ch[i] : ' ';
        const s = inside ? `color:${g.fg[i]}${g.bg[i] ? ';background:' + g.bg[i] : ''}` : '';
        if (s !== style) { flush(); style = s; }
        run += c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : c;
      }
      flush(); style = null; html += '\n';
    }
    return html;
  }

  // ---------- color helpers ----------
  function rgb(hex) { const n = parseInt(hex.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
  function shade(hex, f) { const [r, g, b] = rgb(hex); return `rgb(${r * f | 0},${g * f | 0},${b * f | 0})`; }
  const PACK = ['#ff6b6b', '#ffd84a', '#6aa8ff', '#8be36f', '#ff9a4d', '#c88cff', '#4fd2e8', '#f4f4f4', '#ff7ab8'];

  // ---------- drawn packaging (no photo) ----------
  const SHAPE = {
    bag: ['chips', 'candy', 'frozen-veg', 'pet', 'baking'],
    can: ['soup', 'canned', 'mexican', 'spreads', 'yogurt', 'ice-cream', 'spices'],
    bottle: ['soda', 'water', 'beer', 'oils', 'condiments', 'asian', 'cleaning', 'health', 'milk'],
    pile: ['fruit', 'berries', 'veg', 'roots', 'peppers', 'herbs', 'salad', 'bakery', 'deli', 'meat', 'seafood', 'floral', 'seasonal'],
  };
  const shapeOf = secId => Object.keys(SHAPE).find(k => SHAPE[k].includes(secId)) || 'box';
  const FRAMES = {
    box: ['.----------.', "'----------'"],
    bag: [' /~~~~~~~~\\ ', ' \\________/ '],
    can: [' ,--------, ', " `--------` "],
    bottle: ['   .|__|.   ', " '--------' "],
  };
  const PILES = { fruit: 'oO6o', berries: '*o*:', veg: 'Y%vY', roots: 'O0oO', peppers: 'o()o', herbs: 'Y*"Y', salad: '&%&%',
    bakery: 'o%o=', deli: '=-=-', meat: '=#=#', seafood: '<><~', floral: '*+*@', seasonal: 'oO^o' };

  function drawPackage(g, x, y, p, w) {
    const color = PACK[hash(p.label) % PACK.length];
    const shape = shapeOf(p.sec);
    if (shape === 'pile') {
      const pat = PILES[p.sec] || 'oO';
      const secColor = ctx.SEC[p.sec].color;
      for (let j = 0; j < 3; j++) for (let i = 0; i < w; i++) {
        if (j === 0 && (i === 0 || i === w - 1)) continue;
        put(g, x + i, y + j + 1, pat[(i * 3 + j * 5 + hash(p.label)) % pat.length], j === 1 ? secColor : shade(secColor, 0.8));
      }
      put(g, x, y + 4, '\\', DIM); fillRect(g, x + 1, y + 4, w - 2, 1, '_', DIM); put(g, x + w - 1, y + 4, '/', DIM);
      const l = wrap(p.label, w, 1)[0] || '';
      text(g, x, y + 5, center(l, w).padEnd(w), TEXT);
      return;
    }
    const [top, bottom] = FRAMES[shape];
    text(g, x, y, top.slice(0, w).padEnd(w), color);
    for (let j = 1; j <= 4; j++) { put(g, x, y + j, shape === 'bag' ? '(' : '|', color); put(g, x + w - 1, y + j, shape === 'bag' ? ')' : '|', color); }
    const lines = wrap(p.label.toUpperCase(), w - 2, 3);
    lines.forEach((l, j) => text(g, x + 1, y + 1 + j, center(l, w - 2), j === 0 ? '#ffffff' : TEXT));
    if (p.size) text(g, x + 1, y + 4, center(p.size.slice(0, w - 2), w - 2), DIM);
    text(g, x, y + 5, bottom.slice(0, w).padEnd(w), color);
  }

  // ---------- selection helpers ----------
  const side = () => st.sides[st.side];
  const curSeg = () => side().segs[side().segAt[st.bay]];
  const segStart = seg => side().start[side().segs.indexOf(seg)];
  const bayOf = () => side().bays[st.bay] || [];
  const row = () => bayOf()[st.shelf] || [];
  const current = () => row()[st.slot] || null;
  function snap() {
    const r = row();
    if (!r.length) { st.slot = 0; return; }
    st.slot = Math.max(0, Math.min(st.slot, r.length - 1));
    while (st.slot > 0 && r[st.slot - 1] === r[st.slot]) st.slot--;
  }
  function moveH(d) {
    const r = row();
    let s = st.slot;
    if (d > 0) { while (s < r.length && r[s] === r[st.slot]) s++; }
    else s--;
    if (s >= 0 && s < r.length) { st.slot = s; snap(); return draw(); }
    const nb = st.bay + d;
    if (nb < 0 || nb >= side().bays.length) return draw();
    st.bay = nb;
    if (!row().length) st.shelf = bayOf().reduce((m, rr, i) => (rr.length ? i : m), 0);
    st.slot = d > 0 ? 0 : row().length - 1;
    snap();
    slide(d);
  }
  function moveV(d) {
    for (let s = st.shelf + d; s >= 0 && s < SHELVES; s += d) {
      if (bayOf()[s] && bayOf()[s].length) { st.shelf = s; snap(); break; }
    }
    draw();
  }
  function applyWant() {
    const w = st.want;
    if (!w) return false;
    const words = (w.name || '').toLowerCase().replace(/\(.*?\)/g, ' ').split(/[^a-z0-9']+/).filter(t => t.length >= 3);
    let best = null;
    st.sides.forEach((sd, si) => sd.bays.forEach((bay, b) => bay.forEach((r, s) => r.forEach((p, i) => {
      if (p.sec !== w.sec || (i > 0 && r[i - 1] === p)) return;
      const score = p.key === w.key ? 1e6 : words.filter(t => p.name.toLowerCase().includes(t)).length;
      if (score > 0 && (!best || score > best.score)) best = { score, si, b, s, i };
    }))));
    const pending = st.sides.some(sd => sd.segs.some(seg => seg.sec === w.sec && seg.loading));
    if (best) { st.side = best.si; st.bay = best.b; st.shelf = best.s; st.slot = best.i; }
    else {   // not found: at least stand at the start of that section
      st.sides.forEach((sd, si) => sd.segs.forEach((seg, gi) => { if (seg.sec === w.sec) { st.side = si; st.bay = sd.start[gi]; st.shelf = 0; st.slot = 0; } }));
    }
    if (!pending) st.want = null;
    snap();
    return !!best;
  }

  // ---------- shelf view ----------
  function shelfGrid() {
    const g = newGrid();
    photos = [];
    const sd = side(), seg = curSeg(), gi = sd.segs.indexOf(seg);
    const sec = ctx.SEC[seg.sec];
    // header
    const within = st.bay - sd.start[gi];
    const bayTxt = `${st.bay > 0 ? '<' : ' '} bay ${within + 1}/${seg.bays.length} ${st.bay < sd.bays.length - 1 ? '>' : ' '}`;
    const head = ` ${ctx.title(sec).toUpperCase()} `;
    text(g, 1, 0, compact ? head.slice(0, W - bayTxt.length - 4) : head, '#0b0d13', sec.color);
    const nb = (i, arrow) => (sd.segs[i] ? `${arrow} ${ctx.SEC[sd.segs[i].sec].name}` : '');
    const sideTxt = st.sides.length > 1 ? `${st.side === 0 ? 'LEFT' : 'RIGHT'} SIDE  [Tab] turn to ${ctx.SEC[st.sides[1 - st.side].segs[0].sec].name}`
      : [st.label, nb(gi - 1, '<'), nb(gi + 1, '>')].filter(Boolean).join('   ');
    if (!compact) text(g, 3 + ctx.title(sec).length + 2, 0, sideTxt, DIM);
    text(g, W - bayTxt.length - 2, 0, bayTxt, '#ffd84a');
    const status = seg.loading ? 'stocking shelves from your Kroger store...'
      : seg.live ? (compact ? `live · ${seg.products.length} products${st.sides.length > 1 ? ` · ${st.side === 0 ? 'left' : 'right'} side` : ''}` : `live: ${ctx.kr.locationName} (${seg.products.length} products)`)
      : ctx.kr.quota && !ctx.kr.quota.products.left ? 'game catalog (Kroger searches used up for today)'
        : ctx.kr.configured && ctx.kr.locationId ? 'game catalog (store had no matches)' : 'game catalog. Connect Kroger (K) to see your store\'s real shelves';
    text(g, 2, 1, status, seg.live ? '#8be36f' : DIM);

    // shelving unit
    fillRect(g, 3, 2, W - 6, 1, '_', EDGE);
    for (let y = TOP; y < TOP + SHELVES * SHELF_H; y++) { put(g, 3, y, '#', EDGE); put(g, W - 4, y, '#', EDGE); }
    const cur = current();
    bayOf().forEach((r, s) => {
      const y0 = TOP + s * SHELF_H;
      fillRect(g, 4, y0 + ART_H, W - 8, 1, '=', EDGE);
      for (let i = 0; i < r.length; i++) {
        const p = r[i];
        if (i > 0 && r[i - 1] === p) continue;
        let n = 1; while (r[i + n] === p) n++;
        const x = LEFT + i * SLOT_STEP, wAll = n * SLOT_STEP - 1;
        const sel = p === cur && s === st.shelf;
        if (sel) fillRect(g, x - 1, y0, wAll + 2, ART_H + 2, ' ', TEXT, HILITE);
        for (let f = 0; f < n; f++) {
          const fx = x + f * SLOT_STEP;
          if (hasPhoto(p)) photos.push({ id: p.imgId, x: fx, y: y0, w: SLOT_W, h: ART_H, size: 'medium', sel });
          else drawPackage(g, fx, y0, p, SLOT_W);
        }
        const q = ctx.qty(p.key);
        if (q) text(g, x + wAll - 3, y0, `x${q}`.padStart(3), '#0b0d13', '#8be36f');
        const tag = p.item.custom ? 'write-in' : !p.price ? (wAll >= 16 ? 'price at store' : 'at store')
          : p.was ? `$${p.price.toFixed(2)}!` : `$${p.price.toFixed(2)}`;
        text(g, x + Math.max(0, Math.floor((wAll - tag.length - 2) / 2)), y0 + ART_H, `[${tag}]`, p.was ? '#0b0d13' : '#ffd84a', p.was ? '#ffd84a' : (sel ? HILITE : undefined));
        const label = (wrap(p.label, wAll, 1)[0] || '');
        text(g, x, y0 + ART_H + 1, center(label, wAll).padEnd(wAll), sel ? '#0b0d13' : DIM, sel ? '#ffd84a' : undefined);
      }
      if (!r.length) text(g, LEFT, y0 + 2, '(empty shelf)', '#3a4258');
    });
    fillRect(g, 3, TOP + SHELVES * SHELF_H, W - 6, 1, '.', '#2a3042');
    if (!compact) text(g, 2, H - 3, 'A/D product  W/S shelf  Enter grab  X put back  Tab turn  / find  I details  L list  Esc step out', DIM);
    if (!compact && sd.bays.length > 1) text(g, 2, H - 2, `More bays this way: ${st.bay > 0 ? '‹ ' : ''}${st.bay < sd.bays.length - 1 ? '›' : ''}`, '#3f4a66');
    return g;
  }

  // ---------- details panel (right of the shelves) ----------
  const escHtml = v => String(v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // the photo element is kept between renders so moving along the shelf never flashes
  infoEl.innerHTML = '<div class="fi-sec"></div><div class="fi-img"><img alt=""><pre>  .------.\n  |      |\n  |  ??  |\n  |      |\n  \'------\'</pre></div><div class="fi-body"></div>';
  const fiSec = infoEl.querySelector('.fi-sec'), fiImg = infoEl.querySelector('.fi-img'), fiBody = infoEl.querySelector('.fi-body');
  const bigImg = fiImg.querySelector('img');
  bigImg.onerror = () => { if (bigImg.dataset.id) failed.add(bigImg.dataset.id); queueRedraw(); };
  function showPanel(on) {
    const want = !!(on && info);
    if (infoEl.hidden === !want) return;
    infoEl.hidden = !want;
    ctx.fit();
  }
  function renderInfo() {
    if (!st || infoEl.hidden) return;
    const p = current();
    const sec = ctx.SEC[curSeg().sec];
    infoEl.style.setProperty('--accent', sec.color);
    fiSec.textContent = ctx.title(sec);
    fiImg.hidden = !p;
    if (!p) { fiBody.innerHTML = '<div class="fi-empty">Nothing on this shelf.<br>W/S to look up and down.</div>'; return; }
    const photo = hasPhoto(p);
    fiImg.classList.toggle('none', !photo);
    if (photo && bigImg.dataset.id !== p.imgId) {
      bigImg.dataset.id = p.imgId;
      bigImg.src = `/api/img?id=${encodeURIComponent(p.imgId)}&size=large`;
    }
    const q = ctx.qty(p.key);
    const stock = p.stock && ({ HIGH: ['in stock', 'ok'], LOW: ['low stock', 'low'], TEMPORARILY_OUT_OF_STOCK: ['out of stock', 'out'] }[p.stock] || [p.stock.toLowerCase(), '']);
    const where = p.loc && p.loc.aisle
      ? `aisle ${p.loc.aisle}${p.loc.side ? ' ' + p.loc.side : ''}${p.loc.bay ? ' · bay ' + p.loc.bay : ''}${p.loc.shelf ? ' · shelf ' + p.loc.shelf : ''}` : '';
    const price = p.item.custom ? '<span class="fi-dim">your write-in</span>'
      : !p.price ? '<span class="fi-dim" title="Kroger has no online price for this item at your store">price at store</span>'
      : p.was ? `<span class="fi-sale">SALE $${p.price.toFixed(2)}</span> <s>$${p.was.toFixed(2)}</s>` : `$${p.price.toFixed(2)}`;
    fiBody.innerHTML = `
      <div class="fi-name">${escHtml(p.name)}</div>
      ${p.size ? `<div class="fi-dim">${escHtml(p.size)}</div>` : ''}
      <div class="fi-price">${price}</div>
      ${stock ? `<div class="fi-stock ${stock[1]}">${escHtml(stock[0])}</div>` : ''}
      ${where ? `<div class="fi-dim">your store: ${escHtml(where)}</div>` : ''}
      <div class="fi-cart ${q ? 'in' : ''}">${q ? `in your cart: ${q}` : 'not in your cart'}</div>
      <div class="fi-keys"><b>Enter</b> grab one<br><b>X</b> put one back<br><b>I</b> hide details</div>`;
  }

  // ---------- walking-in corridor (pseudo-3D) ----------
  function corridorGrid(t, colors, label) {
    const g = newGrid();
    const cx = (W - 1) / 2, cy = (H - 1) / 2;
    const travel = t * 2.2;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const u = (x - cx) / cx, v = (y - cy) / cy;
        const au = Math.abs(u), av = Math.abs(v) * 1.15;
        if (au < 0.07 && av < 0.07) { put(g, x, y, ' ', '#000', '#05070c'); continue; }
        if (au >= av) {                                   // shelving walls
          const z = 1 / Math.max(au, 0.03);
          const fade = Math.max(0.12, Math.min(1, 1.8 / z));
          const Y = (v * z + 1) * 2;                        // 0..4 across the 4 shelves
          const zz = z + travel;
          const col = colors[u < 0 ? 0 : 1];
          if (Y - Math.floor(Y) < z / cy * 1.1) put(g, x, y, '=', shade('#8090b0', fade));
          else if ((zz * 1.6) % 4 < z / cx * 3.5) put(g, x, y, '|', shade('#9aa4b8', fade));
          else {
            const h = hash(`${Math.floor(zz * 1.6)}|${Math.floor(Y)}|${u < 0}`);
            put(g, x, y, '#%&8@$'[h % 6], shade(h % 3 ? col : PACK[h % PACK.length], fade * 0.9));
          }
        } else {                                          // floor & ceiling
          const z = 1.15 / Math.max(av, 0.03);
          const zz = z + travel, fade = Math.max(0.1, Math.min(1, 1.6 / z));
          if (v > 0) put(g, x, y, (zz % 1.5) < z / cy * 1.5 ? '_' : '.', shade('#56627e', fade));
          else if ((zz % 2.5) < z / cy * 2 && au * z < 0.5) put(g, x, y, '=', shade('#fff6c0', fade));
        }
      }
    }
    const sign = ` ${label} `;
    text(g, Math.round(cx - sign.length / 2), Math.round(cy - 4 - t * 6), sign, '#0b0d13', '#ffd84a');
    return g;
  }

  // ---------- animation & draw ----------
  function play(kind, ms, frame, done) {
    const t0 = performance.now();
    st.anim = kind;
    clearPhotos();
    const tick = () => {
      if (!st) return;
      const t = Math.min(1, (performance.now() - t0) / ms);
      el.innerHTML = frame(t);
      if (t < 1) setTimeout(tick, 16);
      else { st.anim = null; done(); }
    };
    tick();
  }
  const ease = t => 1 - (1 - t) * (1 - t);
  // photos ride along with the sliding text grid (shift is in characters)
  function shiftPhotos(sh) { placePhotos(); layer.style.transform = sh ? `translateX(${-sh / W * 100}%)` : ''; }
  function slide(d) {
    const g = shelfGrid();
    play('slide', 160, t => { const sh = Math.round(d * (1 - ease(t)) * W * 0.6); shiftPhotos(sh); return toHtml(g, sh); }, () => { shiftPhotos(0); draw(); });
  }
  function draw() { if (st && !st.anim) { el.innerHTML = toHtml(shelfGrid()); placePhotos(); renderInfo(); if (ctx.onDraw) ctx.onDraw(); } }

  // ---------- public ----------
  // sides: [[secId, ...], ...]  one list per side you can face (Tab turns between them)
  // kind: 'aisle' | 'wall' | 'single'   startSec/bayFrac: where you're standing
  function enter({ sides, kind = 'single', side: sideIdx = 0, startSec, bayFrac = 0, focusKey = null, label }) {
    st = { sides: [], kind, side: sideIdx, bay: 0, shelf: 0, slot: 0, anim: null, label, want: null };
    const live = !!(ctx.kr.online && ctx.kr.configured && ctx.kr.locationId);
    for (const ids of sides) {
      // a store map's sections already hold that store's products, in planogram order
      const pre = id => (ctx.storeShelf ? ctx.storeShelf(id) : null);
      const sd = { segs: ids.map(id => ({ sec: id, loading: live && !pre(id), live: !!pre(id) })) };
      sd.segs.forEach(seg => stockSeg(seg, pre(seg.sec) ? pre(seg.sec).map(p => fromLive(p, ctx.SEC[seg.sec])).concat(ctx.customs(seg.sec)) : catalogFor(seg.sec)));
      flatten(sd);
      st.sides.push(sd);
      for (const seg of sd.segs) if (live && !pre(seg.sec)) loadLive(ctx.SEC[seg.sec]).then(list => {
        seg.loading = false;
        if (!st || !st.sides.includes(sd)) return;
        if (list) {
          const here = side() === sd ? curSeg() : null, off = here ? st.bay - segStart(here) : 0;
          stockSeg(seg, list.map(p => fromLive(p, ctx.SEC[seg.sec])).concat(ctx.customs(seg.sec)));
          seg.live = true;
          flatten(sd);
          if (here) st.bay = segStart(here) + Math.min(off, here.bays.length - 1);
        }
        applyWant();
        snap();
        draw();
      });
    }
    const sd = side(), gi = Math.max(0, sd.segs.findIndex(seg => seg.sec === startSec));
    st.bay = sd.start[gi] + Math.min(sd.segs[gi].bays.length - 1, Math.floor(bayFrac * sd.segs[gi].bays.length));
    if (focusKey) { const sec = secOfKey(focusKey, sides); st.want = { key: focusKey, sec, name: nameOf(focusKey, sec) }; applyWant(); }
    snap();
    el.hidden = false; ctx.mapEl.hidden = true;
    showPanel(true);
    const ids = sides.map(s => s[0]);
    const colors = ids.length > 1 ? ids.map(id => ctx.SEC[id].color) : [ctx.SEC[startSec || ids[0]].color, ctx.SEC[startSec || ids[0]].color];
    const final = shelfGrid();
    const finalPhotos = photos;
    play('in', 650, t => {
      if (t < 0.8) return toHtml(corridorGrid(ease(t / 0.8), colors, label));
      const sh = Math.round((1 - (t - 0.8) / 0.2) * W * (sideIdx ? -1 : 1));
      photos = finalPhotos; shiftPhotos(sh);
      return toHtml(final, sh);
    }, () => { shiftPhotos(0); draw(); });
  }

  function exit() {
    const seg = curSeg(), frac = (st.bay - segStart(seg) + 0.5) / seg.bays.length, kind = st.kind;
    const colors = st.sides.length > 1 ? st.sides.map(s => ctx.SEC[s.segs[0].sec].color) : [ctx.SEC[seg.sec].color, ctx.SEC[seg.sec].color];
    play('out', 280, t => toHtml(corridorGrid(1 - ease(t), colors, st.label)), () => {
      st = null; el.hidden = true; ctx.mapEl.hidden = false; photos = []; placePhotos(); clearPhotos(); showPanel(false);
      ctx.onExit({ bayFrac: frac, sec: seg.sec, kind });
    });
  }
  // catalog keys start with their section ("milk:2pct"); a store map's real products are
  // "kr:<upc>", so look them up in the sections you're facing
  function secOfKey(key, sides) {
    const [pre] = key.split(':');
    if (ctx.SEC[pre]) return pre;
    for (const ids of sides) for (const id of ids) if (ctx.SEC[id] && ctx.SEC[id].items.some(i => i.key === key)) return id;
    return pre;
  }
  function nameOf(key, sec = key.split(':')[0]) {
    const it = ctx.SEC[sec] && ctx.SEC[sec].items.find(i => i.key === key);
    return it ? it.name : '';
  }
  function goto(sec, key) {
    st.want = { sec, key, name: key ? nameOf(key, sec) : '' };
    const before = st.side;
    applyWant();
    if (st.side !== before) slide(st.side ? 1 : -1); else draw();
  }

  function key(e, k) {
    if (!st || st.anim === 'in' || st.anim === 'out') { e.preventDefault(); return; }
    const p = current();
    const act = {
      ArrowLeft: () => moveH(-1), a: () => moveH(-1),
      ArrowRight: () => moveH(1), d: () => moveH(1),
      ArrowUp: () => moveV(-1), w: () => moveV(-1),
      ArrowDown: () => moveV(1), s: () => moveV(1),
      Enter: () => p && (ctx.addItem(p.item, 1), draw()), ' ': () => p && (ctx.addItem(p.item, 1), draw()),
      e: () => p && (ctx.addItem(p.item, 1), draw()), '+': () => p && (ctx.addItem(p.item, 1), draw()),
      x: () => p && ctx.qty(p.key) && (ctx.addItem(p.item, -1), draw()),
      Backspace: () => p && ctx.qty(p.key) && (ctx.addItem(p.item, -1), draw()),
      '-': () => p && ctx.qty(p.key) && (ctx.addItem(p.item, -1), draw()),
      Tab: () => {
        if (st.sides.length < 2) return;
        st.side = 1 - st.side;
        st.bay = Math.max(0, side().bays.length - 1 - st.bay);   // you turned around: the far end swaps
        snap();
        slide(st.side ? 1 : -1);
      },
      i: () => { info = !info; ctx.persist.set('kw-fp-panel', info); showPanel(info); draw(); },
      l: () => ctx.openList(curSeg().sec), n: () => ctx.openList(curSeg().sec),
      '/': () => ctx.openSearch(), f: () => ctx.openSearch(),
      Escape: exit, q: exit,
    }[k];
    if (act) { e.preventDefault(); act(); }
  }

  // ---------- touch (phones) ----------
  // a tap on the shelf grid at character (x, y): first tap selects a product, a second tap grabs it
  function tap(x, y) {
    if (!st || st.anim) return null;
    const s = Math.floor((y - TOP) / SHELF_H), i = Math.floor((x - LEFT) / SLOT_STEP);
    const r = bayOf()[s] || [];
    if (s < 0 || s >= SHELVES || i < 0 || i >= r.length) return null;
    const p = r[i];
    if (p === current() && s === st.shelf) { ctx.addItem(p.item, 1); draw(); return 'add'; }
    st.shelf = s; st.slot = i; snap(); draw();
    return 'select';
  }
  // swipe: straight to the next or previous bay
  function jumpBay(d) {
    if (!st || st.anim) return;
    const nb = st.bay + d;
    if (nb < 0 || nb >= side().bays.length) return;
    st.bay = nb;
    if (!row().length) st.shelf = bayOf().reduce((m, rr, i) => (rr.length ? i : m), 0);
    st.slot = 0; snap(); slide(d);
  }
  // phones: restock the same products onto a smaller shelf, keeping the selected product selected
  function setGeometry(slots, shelves) {
    if (slots === SLOTS && shelves === SHELVES && compact) return false;
    const keep = st && current() ? current().key : null;
    SLOTS = slots; SHELVES = shelves; compact = true;
    W = LEFT + SLOTS * SLOT_STEP + 6; H = TOP + SHELVES * SHELF_H + 1;
    if (!st) return true;
    st.sides.forEach(sd => { sd.segs.forEach(seg => stockSeg(seg, seg.products)); flatten(sd); });
    st.bay = Math.min(st.bay, side().bays.length - 1); st.shelf = Math.min(st.shelf, SHELVES - 1);
    if (keep) st.sides.forEach((sd, si) => sd.bays.forEach((bay, b) => bay.forEach((r, sh) => {
      const i = r.findIndex(p => p.key === keep);
      if (i >= 0 && si === st.side) { st.bay = b; st.shelf = sh; st.slot = i; }
    })));
    snap(); if (!st.anim) draw();
    return true;
  }

  return {
    get active() { return !!st; },
    get size() { return { W, H }; },
    get otherSide() { return st && st.sides.length > 1 ? ctx.SEC[st.sides[1 - st.side].segs[0].sec].name : null; },
    tap, jumpBay, setGeometry,
    enter, exit, key, draw, goto,
    has: sec => !!st && st.sides.some(sd => sd.segs.some(seg => seg.sec === sec)),
    refresh: () => {
      if (!st) return;
      st.sides.forEach(sd => { sd.segs.forEach(seg => { if (!seg.live) stockSeg(seg, catalogFor(seg.sec)); }); flatten(sd); });
      st.bay = Math.min(st.bay, side().bays.length - 1);
      snap(); draw();
    },
  };
}
