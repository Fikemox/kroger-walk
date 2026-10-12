(() => {
'use strict';

// ---------- data ----------
const SEC = {};
CATALOG.forEach(s => { SEC[s.id] = s; });
SEC.checkout = { id: 'checkout', name: 'Checkout Lanes', color: '#ffd84a', items: [] };
const S = buildStore(id => (SEC[id] && SEC[id].color) || '#cccccc');
const { W, H, grid } = S;
for (const [id, n] of Object.entries(S.aisleOf)) if (SEC[id]) SEC[id].aisle = n;
const title = s => (s.aisle ? `Aisle ${s.aisle} · ${s.name}` : s.name);
const ORDER = CATALOG.map(s => s.id);

// weekly "digital deals": ~10% of items 20% off, rotating each week
const WEEK = Math.floor(Date.now() / 6048e5);
const hash = s => { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
CATALOG.forEach(s => s.items.forEach(it => {
  if (hash(it.key + '|' + WEEK) % 10 === 0) {
    it.was = it.price;
    it.price = Math.max(0.19, Math.round(it.price * 8) / 10 - 0.01);
  }
}));

const $ = id => document.getElementById(id);
const money = n => '$' + n.toFixed(2);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const persist = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

// ---------- state ----------
const player = { ...S.start };
let facing = [0, -1];
let cart = persist.get('kw-cart', {}); // key -> {key,name,price,sec,qty,custom}
let mode = 'walk';                     // walk | browse | search | checkout | help
let target = null, targetItem = null, path = [];
let dirty = true, blink = false;
const logLines = [];

function addLog(msg) {
  logLines.push(msg);
  if (logLines.length > 4) logLines.shift();
  $('log').innerHTML = logLines.map(l => `<div>${esc(l)}</div>`).join('');
}
function toast(msg, ms = 1400) {
  const t = $('toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), ms);
}

// ---------- NPCs ----------
const DIR4 = [[0, -1], [0, 1], [-1, 0], [1, 0]];
const rnd = n => Math.floor(Math.random() * n);
function randomFloor() {
  for (;;) {
    const x = 20 + rnd(80), y = 2 + rnd(30);
    if (grid[y * W + x].walk) return { x, y };
  }
}
const npcs = [];
['#ffb3b3', '#b3ffcc', '#ffd59e', '#c9b3ff', '#9ee7ff', '#ffe08a', '#ff9ecf'].forEach(color =>
  npcs.push({ ...randomFloor(), dir: DIR4[rnd(4)], ch: '&', color }));
npcs.push({ ...randomFloor(), dir: DIR4[rnd(4)], ch: 'K', color: '#4da3ff', staff: true });

setInterval(() => {
  for (const n of npcs) {
    if (Math.random() < 0.3) continue;            // dawdling, reading labels
    if (Math.random() < 0.15) n.dir = DIR4[rnd(4)];
    const nx = n.x + n.dir[0], ny = n.y + n.dir[1];
    if (grid[ny * W + nx].walk && !(nx === player.x && ny === player.y)) { n.x = nx; n.y = ny; }
    else n.dir = DIR4[rnd(4)];
  }
  dirty = true;
}, 330);

const TIPS = [
  'Need something? Press / and I\'ll point the way.',
  'Yellow SALE tags are this week\'s digital deals.',
  'Can\'t find it? Browse any shelf and write it in with N.',
  'Hold Shift to speed-walk. We won\'t tell.',
  'The ↗ in your cart opens that item on kroger.com.',
];
const PA = [
  'Attention shoppers: cleanup on aisle 5.',
  'Fresh rotisserie chickens just came out in the Deli.',
  'Don\'t forget to clip your digital coupons!',
  'Price check on register 3. Price check, register 3.',
  'Halloween candy is up front by the entrance. Boo.',
  'Associate to the Seafood counter, please.',
  'Now playing: soft rock you vaguely recognize.',
];
let lastTalk = 0, lastBump = 0;
(function pa() {
  setTimeout(() => { addLog('📢 ' + PA[rnd(PA.length)]); pa(); }, 45000 + rnd(45000));
})();

function socialize() {
  const now = Date.now();
  for (const n of npcs) {
    const d = Math.abs(n.x - player.x) + Math.abs(n.y - player.y);
    if (n.staff && d <= 1 && now - lastTalk > 9000) { lastTalk = now; addLog(`Associate: "${TIPS[rnd(TIPS.length)]}"`); }
    if (!n.staff && d === 0 && now - lastBump > 4000) {
      lastBump = now; addLog(['"Oh — excuse me!"', '"Sorry, go ahead."', 'You squeeze past a shopper.', '"Are you in line?"'][rnd(4)]);
    }
  }
}

// ---------- navigation ----------
function interactCell() {
  for (const [dx, dy] of [facing, ...DIR4]) {
    const i = (player.y + dy) * W + player.x + dx;
    if (grid[i] && grid[i].sec) return i;
  }
  return -1;
}
function interactSection() {
  const i = interactCell();
  return i < 0 ? null : grid[i].sec;
}

function computePath() {
  path = [];
  if (!target) return false;
  const goal = new Uint8Array(W * H);
  // aisle shelves: arrive inside the aisle (not at the endcap) so you step into first person
  const inAisle = S.corridors.some(c => c.secs.includes(target));
  for (const i of S.cellsOf[target]) for (const d of inAisle ? [1, -1] : [1, -1, W, -W]) if (grid[i + d] && grid[i + d].walk) goal[i + d] = 1;
  const start = player.y * W + player.x;
  if (goal[start]) return true; // arrived
  const prev = new Int32Array(W * H).fill(-1);
  prev[start] = start;
  const q = [start];
  for (let h = 0; h < q.length; h++) {
    const i = q[h];
    if (goal[i]) {
      for (let j = i; j !== start; j = prev[j]) path.push(j);
      return false;
    }
    for (const d of [1, -1, W, -W]) {
      const n = i + d;
      if (prev[n] === -1 && grid[n].walk) { prev[n] = i; q.push(n); }
    }
  }
  return false;
}

function navigate(sec, idx = null) {
  if (fp.active) {
    closeModal();
    if (fp.has(sec)) { fp.goto(sec, idx == null ? null : SEC[sec].items[idx].key); return; }
    pendingNav = [sec, idx];
    return fp.exit();
  }
  target = sec;
  targetItem = idx == null ? null : { sec, idx };
  const here = computePath();
  closeModal();
  if (here) addLog(`${title(SEC[sec])} is right here — press E.`);
  else addLog(`Follow the pink trail to ${title(SEC[sec])} (${path.length} steps).`);
  updateHud();
}

function step(dx, dy) {
  facing = [dx, dy];
  const nx = player.x + dx, ny = player.y + dy;
  const bumped = grid[ny * W + nx];
  if (bumped.walk) { player.x = nx; player.y = ny; socialize(); }
  else if (autoFP && mode === 'walk' && bumped.sec && S.wallOf(bumped.sec)) { dirty = true; return enterWall(S.wallOf(bumped.sec), ny * W + nx); }
  if (target && computePath()) {
    // arrived: face the target so E opens it
    for (const d of DIR4) {
      const c = grid[(player.y + d[1]) * W + player.x + d[0]];
      if (c.sec === target) { facing = d; break; }
    }
  }
  let cor = S.corridorAt(player.x, player.y);
  // crossing the middle cross-aisle while walking along the same aisle isn't leaving it
  if (!cor && player.y === 16 && lastCorridor && player.x >= lastCorridor.x1 && player.x <= lastCorridor.x2) cor = lastCorridor;
  if (cor !== lastCorridor) {
    lastCorridor = cor;
    if (cor && autoFP && (!target || cor.secs.includes(target))) enterCorridor(cor);
  }
  dirty = true;
  updateHud();
}

// ---------- first person ----------
let lastCorridor = null;
let autoFP = persist.get('kw-autofp', true);
function openFP(opts) {
  held.clear();
  if (kr.configured && !kr.locationId) { addLog('Pick your Kroger store first. Shelves stock from it.'); return openKroger(); }
  mode = 'fp'; fp.enter(opts); updateHud();
}
function focusKeyFor(secs) {
  return targetItem && secs.includes(targetItem.sec) ? SEC[targetItem.sec].items[targetItem.idx].key : null;
}
function enterCorridor(cor, sideSec) {
  const want = sideSec || (target && cor.secs.includes(target) ? target : (targetItem && targetItem.sec));
  const side = Math.max(0, cor.secs.indexOf(want));
  const focusKey = focusKeyFor(cor.secs);
  if (target && cor.secs.includes(target)) { target = null; targetItem = null; path = []; }
  openFP({ kind: 'aisle', sides: cor.secs.map(s => [s]), side, startSec: cor.secs[side], bayFrac: (player.y - 6) / 21, focusKey, label: cor.name.toUpperCase() });
}
function enterWall(wall, cell) {
  const sec = grid[cell].sec, cells = S.cellsOf[sec];
  const focusKey = focusKeyFor(wall.secs);
  if (target && wall.secs.includes(target)) { target = null; targetItem = null; path = []; }
  openFP({ kind: 'wall', sides: [wall.secs], startSec: sec, bayFrac: Math.max(0, cells.indexOf(cell)) / cells.length, focusKey, label: wall.name });
}
let pendingNav = null;
function onExitFP({ bayFrac, sec, kind }) {
  mode = 'walk';
  const cor = S.corridorAt(player.x, player.y);
  if (kind === 'wall') {
    // step out in front of the stretch of wall you were looking at
    const cells = S.cellsOf[sec], cell = cells[Math.min(cells.length - 1, Math.floor(bayFrac * cells.length))];
    for (const d of DIR4) {
      const n = cell - d[0] - d[1] * W;
      if (grid[n] && grid[n].walk) { player.x = n % W; player.y = Math.floor(n / W); facing = d; break; }
    }
  } else if (cor) {
    let y = 6 + Math.round(Math.min(0.999, bayFrac) * 21);
    if (y === 16) y = 15;
    player.y = y;
    facing = cor.secs.indexOf(sec) === 1 ? [1, 0] : [-1, 0];
    lastCorridor = S.corridorAt(player.x, player.y);
  }
  lastCorridor = S.corridorAt(player.x, player.y);
  dirty = true;
  updateHud();
  if (pendingNav) { const [s, i] = pendingNav; pendingNav = null; navigate(s, i); }
}

function locationName() {
  const { x, y } = player;
  if (y >= 6 && y <= 27 && x >= 26 && x <= 78 && (x - 26) % 5 <= 2) {
    const [l, r] = S.AISLES[Math.floor((x - 26) / 5)];
    return `Aisle ${Math.floor((x - 26) / 5) + 1}: ${SEC[l].name} | ${SEC[r].name}`;
  }
  if (x <= 23 && y <= 29) return 'Produce';
  if (x >= 81 && y >= 5 && y <= 28) return 'Frozen & Dairy';
  if (y <= 4) return 'Back of store';
  if (y >= 30) return 'Front of store';
  return 'Main floor';
}

function updateHud() {
  const sec = interactSection();
  const lines = [`<div>📍 ${esc(locationName())}</div>`];
  if (sec === 'checkout') lines.push(`<div>🧾 Checkout lane — <span class="k">[E]</span> check out</div>`);
  else if (sec) lines.push(`<div>👀 ${esc(title(SEC[sec]))} — <span class="k">[E]</span> look closer</div>`);
  else lines.push(`<div style="color:var(--dim)">Walk up to a shelf, bin, or counter to browse it.</div>`);
  if (target) lines.push(`<div class="t">➜ ${esc(title(SEC[target]))}${path.length ? ` · ${path.length} steps` : ' · you\'re here!'} <span style="color:var(--dim)">(Esc cancels)</span></div>`);
  $('hud').innerHTML = lines.join('');
}

// ---------- rendering ----------
const mapEl = $('map');
function render() {
  const pathSet = new Set(path);
  const npcAt = new Map(npcs.map(n => [n.y * W + n.x, n]));
  const active = mode === 'walk' ? interactSection() : (br && br.id);
  const pIdx = player.y * W + player.x;
  let html = '', run = '', style = null;
  const flush = () => { if (run) html += style ? `<span style="${style}">${run}</span>` : run; run = ''; };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x, c = grid[i];
      let ch = c.ch, st = `color:${c.color}`;
      if (c.sec && c.sec === active) st += ';background:#2a3858;font-weight:bold';
      else if (c.sec && c.sec === target && blink) st += ';background:#5a1f5a';
      if (pathSet.has(i)) { ch = '·'; st = 'color:#ff5cf0;font-weight:bold'; }
      const n = npcAt.get(i);
      if (n) { ch = n.ch; st = `color:${n.color};font-weight:bold`; }
      if (i === pIdx) {
        flush(); style = null;
        html += `<span class="p">@</span>`;
        continue;
      }
      if (st !== style) { flush(); style = st; }
      run += esc(ch);
    }
    flush(); style = null;
    html += '\n';
  }
  mapEl.innerHTML = html;
}
setInterval(() => { blink = !blink; if (target) dirty = true; }, 450);

function fit() {
  const wrap = $('mapwrap');
  const probe = document.createElement('span');
  probe.style.cssText = 'position:absolute;visibility:hidden;font-size:100px;white-space:pre;font-family:' + getComputedStyle(mapEl).fontFamily;
  probe.textContent = 'M'.repeat(50);
  document.body.appendChild(probe);
  const cw = probe.getBoundingClientRect().width / 5000;
  probe.remove();
  const size = w => Math.max(6, Math.floor(Math.min(w / (W * cw), (wrap.clientHeight - 16) / (H * 1.12)) * 10) / 10) + 'px';
  mapEl.style.fontSize = size(wrap.clientWidth - 16);
  // first person shares the row with the details panel on its right
  const info = $('fpInfo');
  $('fp').style.fontSize = size(wrap.clientWidth - 16 - (info.hidden ? 0 : info.offsetWidth + 14));
}
window.addEventListener('resize', fit);

// ---------- cart ----------
const qty = key => (cart[key] ? cart[key].qty : 0);
function addItem(it, d) {
  const e = cart[it.key] || { key: it.key, name: it.name, price: it.price, sec: it.sec, qty: 0, custom: !!it.custom, product: it.product };
  e.qty += d;
  if (e.qty <= 0) delete cart[it.key]; else cart[it.key] = e;
  persist.set('kw-cart', cart);
  renderCart();
  if (d > 0) addLog(`🛒 + ${it.name}${e.qty > 1 ? ` (×${e.qty})` : ''}`);
  else addLog(`↩ put back ${it.name}`);
}

function grouped() {
  const groups = {};
  for (const e of Object.values(cart)) (groups[e.sec] = groups[e.sec] || []).push(e);
  return ORDER.filter(id => groups[id]).map(id => [SEC[id], groups[id]]);
}
const totals = () => Object.values(cart).reduce((t, e) => ({ n: t.n + e.qty, sum: t.sum + e.qty * (e.price || 0) }), { n: 0, sum: 0 });
const krogerUrl = name => 'https://www.kroger.com/search?query=' + encodeURIComponent(name.replace(/\(.*?\)/g, '').trim()) + '&searchType=default_search';

function renderCart() {
  const g = grouped();
  const t = totals();
  $('cartCount').textContent = t.n ? `(${t.n})` : '';
  $('cartList').innerHTML = g.length ? g.map(([s, items]) =>
    `<div class="grp">${esc(title(s))}</div>` + items.map(e => `
      <div class="ci"><span class="q">${e.qty}×</span><span class="n" title="${esc(e.name)}">${esc(e.name)}${e.sentQty && e.sentQty >= e.qty ? ' <span style="color:var(--green)" title="in your Kroger cart">✓</span>' : ''}</span>
      <span class="pr">${e.price ? money(e.price * e.qty) : '—'}</span>
      <button data-k="${esc(e.key)}" data-d="1">+</button><button data-k="${esc(e.key)}" data-d="-1">−</button>
      <a href="${krogerUrl(e.name)}" target="_blank" title="Find on kroger.com">↗</a></div>`).join('')).join('')
    : `<div class="empty">  _______\n |       |   your cart is empty.\n |_______|   go walk around!\n  o     o</div>`;
  $('cartTotals').innerHTML = `<span>${t.n} item${t.n === 1 ? '' : 's'}</span><span>est. <b>${money(t.sum)}</b></span>`;
  $('cart').classList.add('flash'); clearTimeout(renderCart.t); renderCart.t = setTimeout(() => $('cart').classList.remove('flash'), 120);
}
$('cartList').addEventListener('click', e => {
  const b = e.target.closest('button[data-k]');
  if (b && cart[b.dataset.k]) addItem(cart[b.dataset.k], +b.dataset.d);
});

function listText() {
  const t = totals();
  const out = [`KROGER LIST — ${new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}`,
    `${t.n} items · est. ${money(t.sum)}`, ''];
  for (const [s, items] of grouped()) {
    out.push(title(s).toUpperCase());
    for (const e of items) out.push(`[ ] ${e.qty} × ${e.name}`);
    out.push('');
  }
  return out.join('\n');
}
async function copyList() {
  if (!totals().n) return toast('Cart is empty');
  try { await navigator.clipboard.writeText(listText()); }
  catch {
    const ta = document.createElement('textarea'); ta.value = listText(); document.body.appendChild(ta);
    ta.select(); document.execCommand('copy'); ta.remove();
  }
  toast('List copied to clipboard');
}
function downloadList() {
  if (!totals().n) return toast('Cart is empty');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([listText()], { type: 'text/plain' }));
  a.download = `kroger-list-${new Date().toISOString().slice(0, 10)}.txt`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

$('btnCopy').onclick = copyList;
$('btnDl').onclick = downloadList;
$('btnCheckout').onclick = () => navigate('checkout');
$('btnClear').onclick = () => {
  if (totals().n && confirm('Put everything back on the shelves?')) { cart = {}; persist.set('kw-cart', cart); renderCart(); addLog('You abandon your cart in the middle of aisle 7.'); }
};
// keep keyboard focus on the game after clicking buttons
document.addEventListener('click', () => setTimeout(() => {
  if (document.activeElement && document.activeElement.tagName === 'BUTTON') document.activeElement.blur();
}));

// ---------- directory ----------
(function renderDir() {
  const rows = [];
  S.AISLES.forEach(([l, r], i) => rows.push([`<span class="num">${i + 1}</span>${esc(SEC[l].name)} · ${esc(SEC[r].name)}`, l]));
  for (const s of CATALOG) if (!s.aisle) rows.push([`<span class="num">·</span>${esc(s.name)} <span style="color:var(--dim)">${esc(s.dept)}</span>`, s.id]);
  $('dir').innerHTML = rows.map(([h, id]) => `<div data-sec="${id}">${h}</div>`).join('');
  $('dir').addEventListener('click', e => { const d = e.target.closest('[data-sec]'); if (d) navigate(d.dataset.sec); });
})();

// ---------- modal plumbing ----------
const modal = $('modal');
function openModal(html, accent, width) {
  modal.innerHTML = `<div class="box" style="--accent:${accent || 'var(--blue)'}${width ? `;width:min(${width}px,96%)` : ''}">${html}</div>`;
  modal.hidden = false;
}
function closeModal() {
  modal.hidden = true; modal.innerHTML = '';
  mode = fp.active ? 'fp' : 'walk'; br = null; dirty = true; updateHud();
  if (fp.active) fp.refresh();
}
modal.addEventListener('mousedown', e => { if (e.target === modal) closeModal(); });

// ---------- browsing a shelf ----------
let br = null; // { id, idx, writing }
const SHELF_ART = {
  produce: ' (o) (O) (6) (*) (o) (O) (*) (6) (o) (O) (*) (o) (6) (O)\n \\___________________________________________________/',
  frozen: ' |[==]|[==]|[==]|[==]|[==]|[==]|[==]|[==]|[==]|[==]|\n |____|____|____|____|____|____|____|____|____|____|',
  counter: ' .---------------------------------------------------.\n |  please take a number    [ NOW SERVING:  42 ]     |',
  shelf: ' |#| |##| |#| |###| |#| |##| |##| |#| |###| |##| |#|\n =====================================================',
};
function artFor(s) {
  if (s.dept === 'Produce') return SHELF_ART.produce;
  if (s.dept === 'Frozen' || s.dept === 'Dairy') return SHELF_ART.frozen;
  if (['Bakery', 'Deli', 'Meat & Seafood', 'Service'].includes(s.dept)) return SHELF_ART.counter;
  return SHELF_ART.shelf;
}
function browseRows(id) {
  const customs = Object.values(cart).filter(e => e.custom && e.sec === id);
  return [...SEC[id].items, ...customs, { writein: true, name: 'Write in something not listed…' }];
}

function openBrowse(id) {
  let idx = 0;
  if (targetItem && targetItem.sec === id) idx = targetItem.idx;
  if (target === id) { target = null; targetItem = null; path = []; }
  br = { id, idx, writing: false };
  mode = 'browse';
  const s = SEC[id];
  openModal(`
    <div class="ttl"><span>╡ ${esc(title(s))} ╞</span><span style="color:var(--dim)">${esc(s.dept)}</span></div>
    <div class="art">${esc(artFor(s))}</div>
    <div class="rows" id="brRows"></div>
    <div class="pad" id="brWrite" hidden><input id="brInput" placeholder="e.g. Fairlife chocolate milk — Enter to add, Esc to cancel" maxlength="80"></div>
    <div class="foot"><b>W/S</b> ↑↓ select · <b>D</b>/<b>Enter</b> add · <b>A</b> put back · <b>N</b> write-in · <b>Esc</b> walk away</div>`, s.color);
  renderBrowse();
  $('brRows').addEventListener('click', e => {
    const row = e.target.closest('.row'); if (!row) return;
    br.idx = +row.dataset.i;
    const b = e.target.closest('button');
    if (b) browseAct(+b.dataset.d); else if (browseRows(br.id)[br.idx].writein) startWritein(); else renderBrowse();
  });
  $('brInput').addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Escape') { endWritein(); }
    if (e.key === 'Enter') {
      const name = e.target.value.trim();
      if (name) addItem({ key: `custom:${br.id}:${name.toLowerCase()}`, name, price: 0, sec: br.id, custom: true }, 1);
      endWritein();
      br.idx = browseRows(br.id).length - 1;
      renderBrowse();
    }
  });
  dirty = true;
  updateHud();
}

function renderBrowse() {
  const rows = browseRows(br.id);
  br.idx = (br.idx + rows.length) % rows.length;
  $('brRows').innerHTML = rows.map((it, i) => {
    if (it.writein) return `<div class="row write ${i === br.idx ? 'sel' : ''}" data-i="${i}"><span class="cur">${i === br.idx ? '▶' : ''}</span><span class="nm">✎ ${esc(it.name)}</span></div>`;
    const q = qty(it.key);
    const price = it.custom ? '<span style="color:var(--dim)">write-in</span>'
      : it.was ? `<span class="sale">SALE ${money(it.price)}</span> <s>${money(it.was)}</s>` : money(it.price);
    return `<div class="row ${i === br.idx ? 'sel' : ''}" data-i="${i}">
      <span class="cur">${i === br.idx ? '▶' : ''}</span><span class="nm">${esc(it.name)}</span><span class="dots"></span>
      <span class="pr">${price}</span>
      <span class="qty">${q ? `<button data-d="-1">−</button><b>${q}</b>` : ''}<button data-d="1">+</button></span></div>`;
  }).join('');
  const sel = $('brRows').querySelector('.sel');
  if (sel) sel.scrollIntoView({ block: 'nearest' });
}
function browseAct(d) {
  const it = browseRows(br.id)[br.idx];
  if (it.writein) { if (d > 0) startWritein(); return; }
  if (d < 0 && !qty(it.key)) return;
  addItem(it, d);
  renderBrowse();
}
function startWritein() { br.writing = true; $('brWrite').hidden = false; $('brInput').value = ''; $('brInput').focus(); }
function endWritein() { br.writing = false; $('brWrite').hidden = true; $('brInput').blur(); }

function browseKey(e, k) {
  const act = {
    ArrowUp: () => { br.idx--; renderBrowse(); }, w: () => { br.idx--; renderBrowse(); },
    ArrowDown: () => { br.idx++; renderBrowse(); }, s: () => { br.idx++; renderBrowse(); },
    ArrowRight: () => browseAct(1), d: () => browseAct(1), Enter: () => browseAct(1), ' ': () => browseAct(1), '+': () => browseAct(1), '=': () => browseAct(1),
    ArrowLeft: () => browseAct(-1), a: () => browseAct(-1), '-': () => browseAct(-1), Backspace: () => browseAct(-1), Delete: () => browseAct(-1),
    n: startWritein,
    Escape: closeModal, e: closeModal, q: closeModal,
  }[k];
  if (act) { e.preventDefault(); act(); }
}

// ---------- find (search) ----------
const INDEX = [];
CATALOG.forEach(s => {
  INDEX.push({ sec: s.id, section: true, name: title(s), text: `${s.name} ${s.dept}`.toLowerCase() });
  s.items.forEach((it, i) => INDEX.push({ sec: s.id, idx: i, it, name: it.name, text: `${it.name} ${s.name}`.toLowerCase() }));
});
let sr = { results: [], idx: 0 };
function search(q) {
  const toks = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!toks.length) return [];
  return INDEX.filter(e => toks.every(t => e.text.includes(t)))
    .map(e => ({ e, score: (e.section ? -2 : 0) + (e.name.toLowerCase().startsWith(toks[0]) ? -1 : 0) + (e.name.toLowerCase().includes(toks[0]) ? 0 : 3) }))
    .sort((a, b) => a.score - b.score).slice(0, 14).map(r => r.e);
}
function openSearch() {
  mode = 'search';
  sr = { results: [], idx: 0 };
  openModal(`
    <div class="ttl"><span>╡ Where is it? ╞</span><span style="color:var(--dim)">${INDEX.length - CATALOG.length} products</span></div>
    <div class="pad"><input id="sInput" placeholder="milk, salsa, paper towels, aisle stuff…" autocomplete="off"></div>
    <div class="rows" id="sRows"><div class="pad" style="color:var(--dim)">Type to search. Enter = walk me there. Shift+Enter = just add it.</div></div>
    <div class="foot"><b>↑↓</b> select · <b>Enter</b> get directions · <b>Shift+Enter</b> add to cart · <b>Esc</b> close</div>`, '#ff5cf0');
  const input = $('sInput');
  input.focus();
  input.addEventListener('input', () => { sr.results = search(input.value); sr.idx = 0; renderSearch(); });
  input.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Escape') return closeModal();
    if (e.key === 'ArrowDown') { e.preventDefault(); sr.idx = Math.min(sr.idx + 1, sr.results.length - 1); renderSearch(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); sr.idx = Math.max(sr.idx - 1, 0); renderSearch(); }
    if (e.key === 'Enter') pickResult(sr.results[sr.idx], e.shiftKey);
  });
  $('sRows').addEventListener('click', e => {
    const row = e.target.closest('.row'); if (row) pickResult(sr.results[+row.dataset.i], e.shiftKey);
  });
}
function renderSearch() {
  const el = $('sRows');
  if (!sr.results.length) { el.innerHTML = `<div class="pad" style="color:var(--dim)">${$('sInput').value ? 'Nothing on the shelves by that name. Try another word, or write it in at a shelf.' : ''}</div>`; return; }
  el.innerHTML = sr.results.map((r, i) => {
    const s = SEC[r.sec];
    return `<div class="row res ${i === sr.idx ? 'sel' : ''}" data-i="${i}"><span class="cur">${i === sr.idx ? '▶' : ''}</span>
      <span class="nm" style="${r.section ? `color:${s.color}` : ''}">${r.section ? '➜ ' : ''}${esc(r.name)}</span><span class="dots"></span>
      <span class="sec">${r.section ? 'go to section' : esc(title(s))}</span>${r.it && qty(r.it.key) ? `<b style="color:var(--green);font-weight:normal">×${qty(r.it.key)}</b>` : ''}</div>`;
  }).join('');
  const sel = el.querySelector('.sel'); if (sel) sel.scrollIntoView({ block: 'nearest' });
}
function pickResult(r, quickAdd) {
  if (!r) return;
  if (quickAdd && r.it) { addItem(r.it, 1); renderSearch(); return; }
  navigate(r.sec, r.section ? null : r.idx);
}

// ---------- checkout ----------
function openCheckout() {
  mode = 'checkout';
  if (target === 'checkout') { target = null; path = []; }
  const t = totals();
  const w = 44, line = '-'.repeat(w);
  const ctr = s => ' '.repeat(Math.max(0, Math.floor((w - s.length) / 2))) + s;
  const row = (l, r) => l + ' '.repeat(Math.max(1, w - l.length - r.length)) + r;
  const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
  const lane = 1 + rnd(7);
  const out = [ctr('K R O G E R   W A L K'), ctr('~ virtual pick list ~'), ctr(new Date().toLocaleString()), ctr(`LANE ${lane}   CASHIER: DEB`), line];
  if (!t.n) out.push('', ctr('your cart is empty.'), ctr('the cashier stares at you.'), '');
  for (const [s, items] of grouped()) {
    out.push(trunc(title(s).toUpperCase(), w));
    for (const e of items) out.push(row(` ${String(e.qty).padStart(2)} ${trunc(e.name, w - 13)}`, e.price ? (e.price * e.qty).toFixed(2) : '--'));
  }
  out.push(line, row(`ITEMS ${t.n}`, `EST TOTAL ${money(t.sum)}`), '',
    ctr('prices are rough guesses'), ctr('saves: your sanity'), '', ctr('|| ||| | || ||| || | ||| | ||'), ctr('THANK YOU FOR SHOPPING'));
  openModal(`
    <div class="ttl"><span>╡ Checkout ╞</span><span style="color:var(--dim)">lane ${lane}</span></div>
    <div class="pad"><pre class="receipt">${esc(out.join('\n'))}</pre></div>
    <div class="pad btns">${kr.online ? '<button id="rcKroger" style="border-color:var(--blue);color:#fff">Send to my Kroger cart (K)</button>' : ''}<button id="rcCopy">Copy list (C)</button><button id="rcDl">Download .txt (D)</button><button id="rcClose">Keep shopping (Esc)</button></div>
    <div class="foot">${kr.online ? '<b>K</b> matches each item to a real product at your store and adds it to your Kroger pickup cart.' : 'The Kroger connection is offline right now. Use the <b>↗</b> links.'}</div>`, '#ffd84a');
  if ($('rcKroger')) $('rcKroger').onclick = openMatch;
  $('rcCopy').onclick = copyList; $('rcDl').onclick = downloadList; $('rcClose').onclick = closeModal;
}

// ---------- help ----------
function openHelp() {
  mode = 'help';
  openModal(`
    <div class="ttl"><span>╡ Welcome to Kroger Walk ╞</span></div>
    <div class="help">
      You are <b style="background:var(--blue);color:#fff">@</b>. Walk the store, browse shelves, and fill your cart like it's a real trip,
      minus the parking lot.<br><br>
      <b>WASD / arrows</b>  walk  ·  hold <b>Shift</b> to speed-walk<br>
      <b>E / Space</b>  look closer at the shelf, bin, or counter you're facing (first person)<br>
      Walking into an aisle, or bumping into an outside wall (bakery, deli, meat, seafood, dairy), drops you into first person too (<b>V</b> toggles that)<br>
      <b>/ or F</b>  "where is it?" search, then follow the <span style="color:var(--pink)">pink trail</span><br>
      <b>C</b>  head to checkout  ·  <b>K</b>  Kroger store &amp; sign-in  ·  <b>Esc</b>  cancel directions<br>
      <b>?</b>  this screen<br><br>
      In first person: <b>/</b> find, <b>A/D</b> products, <b>W/S</b> shelves, <b>Enter</b> grab, <b>X</b> put back, <b>Tab</b> turn around, <b>L</b> list &amp; write-ins, <b>Esc</b> step out.<br>
      <span style="color:var(--dim)">&amp; = other shoppers · <span style="color:#4da3ff">K</span> = a helpful associate · your cart saves automatically.</span>
    </div>
    <div class="foot">Press <b>Esc</b> or <b>Enter</b> to start shopping.</div>`);
}

// ---------- input ----------
const MOVES = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0], w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0] };
const held = new Map();
let lastKey = null, lastStep = 0, repeating = false, sprint = false;

document.addEventListener('keydown', e => {
  sprint = e.shiftKey;
  if (e.target.tagName === 'INPUT') return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (mode === 'fp') return fp.key(e, k);
  if (mode === 'browse') return browseKey(e, k);
  if (mode === 'match') return matchKey(e, k);
  if (mode === 'kroger') { if (k === 'Escape' || k === 'q') { e.preventDefault(); closeModal(); } return; }
  if (mode === 'checkout' || mode === 'help' || mode === 'done') {
    if (mode === 'checkout' && k === 'k' && kr.online) return openMatch();
    if (mode === 'checkout' && k === 'c') return copyList();
    if (mode === 'checkout' && k === 'd') return downloadList();
    if (['Escape', 'Enter', ' ', 'e', 'q', '?'].includes(k)) { e.preventDefault(); closeModal(); }
    return;
  }
  if (mode !== 'walk') return;
  if (MOVES[k]) {
    e.preventDefault();
    if (e.repeat || held.has(k)) return;
    held.set(k, MOVES[k]); lastKey = k;
    step(...MOVES[k]); lastStep = performance.now(); repeating = false;
    return;
  }
  const act = {
    e: interact, ' ': interact, Enter: interact,
    '/': openSearch, f: openSearch,
    c: () => navigate('checkout'),
    '?': openHelp, h: openHelp,
    k: openKroger,
    v: () => { autoFP = !autoFP; persist.set('kw-autofp', autoFP); addLog(autoFP ? 'Walking into an aisle now switches to first person.' : 'Aisles stay top-down. Press E at a shelf to look closer.'); },
    Escape: () => { if (target) { target = null; targetItem = null; path = []; dirty = true; updateHud(); addLog('Directions cancelled.'); } },
  }[k];
  if (act) { e.preventDefault(); act(); }
});
document.addEventListener('keyup', e => {
  sprint = e.shiftKey;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  held.delete(k);
  if (k === lastKey) lastKey = [...held.keys()].pop() || null;
  if (!held.size) repeating = false;
});
window.addEventListener('blur', () => { held.clear(); repeating = false; });

function interact() {
  const id = interactSection();
  if (!id) return addLog('Nothing here but floor. Walk up to a shelf, bin, or counter.');
  if (id === 'checkout') return openCheckout();
  const cor = S.corridorAt(player.x, player.y);
  if (cor && cor.secs.includes(id)) return enterCorridor(cor, id);
  if (S.wallOf(id)) return enterWall(S.wallOf(id), interactCell());
  const focusKey = focusKeyFor([id]);
  if (target === id) { target = null; targetItem = null; path = []; }
  openFP({ kind: 'single', sides: [[id]], startSec: id, focusKey, label: title(SEC[id]).toUpperCase() });
}

function loop(now) {
  if (mode === 'walk' && held.size && lastKey) {
    const delay = repeating ? (sprint ? 32 : 72) : 160;
    if (now - lastStep >= delay) { step(...held.get(lastKey)); lastStep = now; repeating = true; }
  }
  if (dirty && !fp.active) { render(); dirty = false; }
  requestAnimationFrame(loop);
}

// ---------- Kroger: real store, real cart ----------
const kr = { online: false, configured: false, loggedIn: false, locationId: '', locationName: '', quota: null };
async function api(path, body) {
  const r = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && j.gate) location.reload();  // password cookie expired or changed
  if (j.quotaOut) {
    if (kr.quota && kr.quota[j.quotaOut]) kr.quota[j.quotaOut].left = 0;
    drawKrChip();
    if (!api.warned) { api.warned = true; toast(j.error + ' Shelves show sample items until then.', 6000); }
  }
  if (!r.ok) throw Object.assign(new Error(j.error || r.statusText), j);
  // these spend the shared Kroger budget; refresh the counter shortly after
  if (/^\/api\/(products|locations|cart)/.test(path)) { clearTimeout(api.t); api.t = setTimeout(refreshKroger, 2500); }
  return j;
}
async function refreshKroger() {
  try { Object.assign(kr, await api('/api/status'), { online: true }); } catch { kr.online = false; }
  drawKrChip();
}
// shared daily Kroger budget: product searches are what friends actually burn through
function quotaText() {
  const q = kr.quota && kr.quota.products;
  if (!q) return '';
  const pct = q.left / q.limit;
  const color = !q.left ? 'var(--red)' : pct < 0.2 ? 'var(--yellow)' : 'var(--dim)';
  return ` · <span style="color:${color}">${q.left ? `${q.left.toLocaleString()} searches left` : 'out of searches today'}</span>`;
}
function drawKrChip() {
  const el = $('krChip');
  el.hidden = !kr.online;
  el.innerHTML = !kr.configured ? '⚠ Kroger: not set up'
    : `🏪 ${kr.locationName ? esc(kr.locationName) : 'pick a store'} · ${kr.loggedIn ? '<span style="color:var(--green)">signed in</span>' : 'not signed in'}${quotaText()}`;
  const q = kr.quota;
  if (q) {
    const reset = new Date(); reset.setUTCHours(24, 0, 0, 0);
    el.title = `Everyone playing shares one Kroger app's daily limits (approximate):
`
      + `  product searches  ${q.products.left.toLocaleString()} / ${q.products.limit.toLocaleString()} left
`
      + `  store lookups     ${q.locations.left.toLocaleString()} / ${q.locations.limit.toLocaleString()} left
`
      + `  cart sends        ${q.cart.left.toLocaleString()} / ${q.cart.limit.toLocaleString()} left
`
      + `Resets around ${reset.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} your time. Shelves you've seen are cached for 12h and cost nothing to revisit.`;
  }
}
$('krChip').onclick = () => openKroger();

function openKroger() {
  if (!kr.online) return toast('Cannot reach the Kroger connection. Try reloading.', 3000);
  mode = 'kroger';
  const setup = `<div class="help">To connect your real Kroger account (one-time, ~5 min):
    <ol>
      <li>Go to <a href="https://developer.kroger.com" target="_blank">developer.kroger.com</a>, sign in, and <b>create an app</b>.</li>
      <li>Use the <b>Production</b> environment, enable the <b>Products</b>, <b>Cart</b>, <b>Locations</b> and <b>Identity/Profile</b> APIs.</li>
      <li>Add the redirect URI <code>${esc(location.origin)}/callback</code></li>
      <li>Put the client ID &amp; secret in <code>.dev.vars</code> (local) or <code>wrangler secret put</code> (deployed), then reload.</li>
    </ol></div>`;
  const ready = `
    <div class="pad">Store: ${kr.locationName ? `<b>${esc(kr.locationName)}</b>` : '<span style="color:var(--dim)">none yet, so look one up</span>'}</div>
    <div class="pad"><input id="zipIn" placeholder="ZIP code, then Enter to list nearby stores" maxlength="10" inputmode="numeric"></div>
    <div class="rows" id="locRows"></div>
    <div class="pad btns">${kr.loggedIn
      ? '<span style="color:var(--green);align-self:center">✓ signed in to Kroger</span><button id="krOut">Sign out</button>'
      : '<button id="krIn" style="border-color:var(--blue);color:#fff">Sign in to Kroger</button>'}<button id="krClose">Close (Esc)</button></div>`;
  openModal(`<div class="ttl"><span>╡ Kroger account ╞</span></div>${kr.configured ? ready : setup}
    <div class="foot">Your store sets real prices, aisles &amp; stock. Signing in lets the game add to your real pickup cart.
    The API can't check out, so you'll still pick a time &amp; pay in the Kroger app.</div>`, '#2f7df6');
  if (!kr.configured) return;
  $('krClose').onclick = closeModal;
  if ($('krIn')) $('krIn').onclick = () => { location.href = '/auth/login'; };
  if ($('krOut')) $('krOut').onclick = async () => { await api('/auth/logout', {}); await refreshKroger(); openKroger(); };
  const zip = $('zipIn');
  zip.focus();
  zip.addEventListener('keydown', async e => {
    e.stopPropagation();
    if (e.key === 'Escape') return closeModal();
    if (e.key !== 'Enter') return;
    $('locRows').innerHTML = '<div class="pad" style="color:var(--dim)">looking up stores…</div>';
    try {
      const { locations } = await api('/api/locations?zip=' + encodeURIComponent(zip.value.trim()));
      $('locRows').innerHTML = locations.length ? locations.map((l, i) =>
        `<div class="row" data-i="${i}"><span class="nm">${esc(l.name)}</span><span class="dots"></span><span class="sec" style="color:var(--dim)">${esc(l.address)}</span></div>`).join('')
        : '<div class="pad" style="color:var(--dim)">No Kroger-family stores within 25 miles.</div>';
      $('locRows').onclick = async ev => {
        const row = ev.target.closest('.row'); if (!row) return;
        const l = locations[+row.dataset.i];
        await api('/api/location', { id: l.id, name: l.name });
        await refreshKroger();
        addLog(`🏪 Shopping at ${l.name}.`);
        openKroger();
      };
    } catch (err) { $('locRows').innerHTML = `<div class="pad" style="color:var(--red)">${esc(err.message)} ${esc(err.detail || '')}</div>`; }
  });
}

// match each list line to a real product, then PUT them into the Kroger cart
const memo = persist.get('kw-match', {}); // cart key -> chosen real product
let mt = null;
const searchTerm = name => name.replace(/\(.*?\)/g, ' ').replace(/[^\p{L}\p{N}&' -]/gu, ' ').replace(/\s+/g, ' ').trim();
const realPrice = c => (c.promo && c.promo < c.price ? c.promo : c.price) || 0;
const toSend = e => Math.max(0, Math.ceil(e.qty) - (e.sentQty || 0));

async function openMatch() {
  if (!kr.online) return toast('Cannot reach the Kroger connection. Try reloading.', 3000);
  if (!kr.configured || !kr.locationId) { addLog('Pick your Kroger store first.'); return openKroger(); }
  const entries = grouped().flatMap(([, items]) => items);
  if (!entries.length) return toast('Cart is empty');
  mode = 'match';
  const my = mt = {
    idx: 0, sending: false,
    rows: entries.map(e => ({ e, cands: e.product ? [e.product] : memo[e.key] ? [memo[e.key]] : [], sel: 0, skip: !toSend(e), loading: !e.product, err: '' })),
  };
  openModal(`<div class="ttl"><span>╡ Send to Kroger · ${esc(kr.locationName)} ╞</span><span id="mtSum" style="color:var(--dim)"></span></div>
    <div class="rows" id="mtRows"></div>
    <div class="pad btns" id="mtBtns"></div>
    <div class="foot"><b>W/S</b> row · <b>A/D</b> try another product · <b>X</b> skip/include · <b>Enter</b> add to Kroger cart · <b>Esc</b> back to the store</div>`, '#2f7df6', 820);
  $('mtRows').addEventListener('click', e => {
    const row = e.target.closest('.mrow'); if (!row) return;
    mt.idx = +row.dataset.i;
    const a = e.target.closest('button');
    if (a) matchAct(a.dataset.a); else renderMatch();
  });
  $('mtBtns').addEventListener('click', e => {
    const a = e.target.closest('button'); if (!a) return;
    if (a.dataset.a === 'send') sendMatch();
    if (a.dataset.a === 'login') location.href = '/auth/login';
    if (a.dataset.a === 'back') closeModal();
  });
  renderMatch();
  let next = 0;
  const worker = async () => {
    while (next < my.rows.length) {
      const r = my.rows[next++];
      if (r.e.product) continue;
      try {
        const { products } = await api('/api/products?limit=6&term=' + encodeURIComponent(searchTerm(r.e.name)));
        const seen = new Set(r.cands.map(c => c.upc));
        r.cands.push(...products.filter(p => p.upc && !seen.has(p.upc)));
        if (!r.cands.length) { r.err = 'no match at this store, skipped'; r.skip = true; }
      } catch (err) {
        r.err = err.message;
        if (!r.cands.length) r.skip = true;
      }
      r.loading = false;
      if (mt === my && mode === 'match') renderMatch();
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
}

function renderMatch() {
  const rows = mt.rows;
  mt.idx = (mt.idx + rows.length) % rows.length;
  $('mtRows').innerHTML = rows.map((r, i) => {
    const c = r.cands[r.sel];
    let bot;
    if (!c) bot = r.loading ? '<span class="dim">checking the shelves…</span>' : `<span style="color:var(--red)">${esc(r.err || 'no match')}</span>`;
    else {
      const price = c.promo && c.promo < c.price ? `<span style="color:var(--yellow)">SALE $${c.promo.toFixed(2)}</span> <s class="dim">$${c.price.toFixed(2)}</s>`
        : c.price ? `$${c.price.toFixed(2)}` : '<span class="dim">no price</span>';
      const stock = /OUT_OF_STOCK/.test(c.stock || '') ? ' <span style="color:var(--red)">out of stock</span>'
        : /LOW/.test(c.stock || '') ? ' <span style="color:var(--yellow)">low stock</span>' : '';
      bot = `↳ ${esc(c.name)} <span class="dim">${esc(c.size)}</span> · ${price}${c.aisle ? ` <span class="dim">· ${esc(c.aisle)}</span>` : ''}${stock}`;
    }
    const sent = r.e.sentQty ? `<span class="tag">${r.e.sentQty} already in Kroger cart</span>` : '';
    return `<div class="mrow ${i === mt.idx ? 'sel' : ''} ${r.skip ? 'skip' : ''}" data-i="${i}">
      <div class="mtop"><span class="cur" style="color:var(--blue)">▶</span><span class="q">${toSend(r.e) || r.e.qty}×</span><span class="nm">${esc(r.e.name)}</span>${sent}<span class="dots"></span>
        <button data-a="prev">◀</button><span class="cnt">${r.cands.length ? `${r.sel + 1}/${r.cands.length}` : r.loading ? '…' : '0'}</span><button data-a="next">▶</button>
        <button data-a="skip">${r.skip ? 'include' : 'skip'}</button></div>
      <div class="mbot">${bot}</div></div>`;
  }).join('');
  const inc = rows.filter(r => !r.skip && r.cands[r.sel]);
  const total = inc.reduce((t, r) => t + realPrice(r.cands[r.sel]) * toSend(r.e), 0);
  const pending = rows.some(r => r.loading);
  $('mtSum').textContent = mt.sending ? 'sending…' : `${inc.length}/${rows.length} items · ~$${total.toFixed(2)}${pending ? ' · searching…' : ''}`;
  $('mtBtns').innerHTML = (kr.loggedIn
    ? `<button data-a="send" style="border-color:var(--blue);color:#fff">Add ${inc.length} item${inc.length === 1 ? '' : 's'} to my Kroger cart (Enter)</button>`
    : '<button data-a="login" style="border-color:var(--blue);color:#fff">Sign in to Kroger to send (Enter)</button>')
    + '<button data-a="back">Back to the store (Esc)</button>';
  const sel = $('mtRows').querySelector('.sel'); if (sel) sel.scrollIntoView({ block: 'nearest' });
}

function matchAct(a) {
  const r = mt.rows[mt.idx];
  if ((a === 'prev' || a === 'next') && r.cands.length) {
    r.sel = (r.sel + (a === 'next' ? 1 : -1) + r.cands.length) % r.cands.length;
    r.skip = !toSend(r.e);
    memo[r.e.key] = r.cands[r.sel]; persist.set('kw-match', memo);
  }
  if (a === 'skip') r.skip = !r.skip || !r.cands[r.sel] || !toSend(r.e);
  renderMatch();
}

function matchKey(e, k) {
  const act = {
    ArrowUp: () => { mt.idx--; renderMatch(); }, w: () => { mt.idx--; renderMatch(); },
    ArrowDown: () => { mt.idx++; renderMatch(); }, s: () => { mt.idx++; renderMatch(); },
    ArrowLeft: () => matchAct('prev'), a: () => matchAct('prev'),
    ArrowRight: () => matchAct('next'), d: () => matchAct('next'),
    x: () => matchAct('skip'), ' ': () => matchAct('skip'),
    Enter: () => (kr.loggedIn ? sendMatch() : (location.href = '/auth/login')),
    Escape: closeModal, q: closeModal,
  }[k];
  if (act) { e.preventDefault(); act(); }
}

async function sendMatch() {
  if (mt.sending) return;
  const inc = mt.rows.filter(r => !r.skip && r.cands[r.sel] && toSend(r.e));
  if (!inc.length) return toast('Nothing to send');
  mt.sending = true; renderMatch();
  try {
    await api('/api/cart', { items: inc.map(r => ({ upc: r.cands[r.sel].upc, quantity: toSend(r.e) })) });
    const total = inc.reduce((t, r) => t + realPrice(r.cands[r.sel]) * toSend(r.e), 0);
    for (const r of inc) { memo[r.e.key] = r.cands[r.sel]; r.e.sentQty = Math.ceil(r.e.qty); }
    persist.set('kw-match', memo); persist.set('kw-cart', cart); renderCart();
    addLog(`✅ Added ${inc.length} items to your real Kroger cart.`);
    mode = 'done';
    openModal(`<div class="ttl"><span>╡ Order staged ╞</span></div>
      <div class="pad"><pre class="receipt" style="display:table">
   _____________________________
  |  ${String(inc.length).padStart(3)} items  -->  KROGER CART |
  |   ~$${total.toFixed(2).padEnd(9)} est. total     |
  |_____________________________|
     o                       o
</pre></div>
      <div class="help">Last step, in Kroger: pick a pickup time and pay.<br>
      Everything is waiting at <a href="https://www.kroger.com/cart" target="_blank">kroger.com/cart</a> and in the Kroger app.<br>
      <span style="color:var(--dim)">Sending again only sends what you've added since. A ✓ in your list means it's already in the Kroger cart.</span></div>
      <div class="pad btns"><button id="dnOpen" style="border-color:var(--blue);color:#fff">Open Kroger cart</button><button id="dnNew">Start a fresh list</button><button id="dnClose">Back to the store (Esc)</button></div>`, '#8be36f');
    $('dnOpen').onclick = () => window.open('https://www.kroger.com/cart', '_blank');
    $('dnClose').onclick = closeModal;
    $('dnNew').onclick = () => { cart = {}; persist.set('kw-cart', cart); renderCart(); closeModal(); addLog('Fresh cart. Same left-pulling wheel.'); };
  } catch (err) {
    mt.sending = false;
    if (err.login) { await refreshKroger(); renderMatch(); return toast('Sign in to Kroger first'); }
    renderMatch();
    $('mtSum').innerHTML = `<span style="color:var(--red)">${esc(err.message)}</span>`;
    addLog(`Kroger said no: ${err.message} ${err.detail || ''}`.slice(0, 200));
  }
}

// ---------- go ----------
const fp = createFirstPerson({
  W, H, SEC, title, mapEl, fpEl: $('fp'), infoEl: $('fpInfo'), fit, persist, memo, qty, addItem, api,
  get kr() { return kr; },
  customs: id => Object.values(cart).filter(e => e.custom && e.sec === id).map(e => (
    { key: e.key, name: e.name, label: e.name, size: '', price: 0, was: 0, stock: '', loc: null, sec: id, imgId: null, item: e })),
  openList: id => openBrowse(id),
  openSearch: () => openSearch(),
  onExit: onExitFP,
});
fit();
renderCart();
updateHud();
addLog('You grab a cart that only slightly pulls to the left.');
addLog('Press / to find anything, or just wander.');
if (!persist.get('kw-seen-help', false)) { persist.set('kw-seen-help', true); openHelp(); }
const krParam = new URLSearchParams(location.search).get('kroger');
if (krParam) history.replaceState(null, '', location.pathname);
refreshKroger().then(() => {
  if (krParam === 'connected') { addLog('🔗 Signed in to Kroger.'); if (totals().n && mode === 'walk') openMatch(); }
  if (krParam === 'loginfailed') addLog('Kroger sign-in failed. Press K to try again.');
  if (krParam === 'notconfigured') openKroger();
  if (kr.configured && !kr.locationId && mode === 'walk') { addLog('Welcome! Pick your Kroger store to stock the shelves.'); openKroger(); }
});
requestAnimationFrame(loop);
window.kw = { player, step, navigate, interact, openMatch, openCheckout, refreshKroger, kr, get path() { return path; } }; // console poking
})();
