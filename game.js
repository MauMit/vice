'use strict';
/* VICE game: state, rendering, input, events, saving. Economy math lives in engine.js. */
const E = VICE;
const KEY = 'vice-empire-v3';
const OLD_KEY = 'vice-empire-v1';
const $ = id => document.getElementById(id);

/* ---------- formatting ---------- */
const UNITS = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc', 'UDc', 'DDc', 'TDc', 'QaDc', 'QiDc', 'SxDc', 'SpDc', 'OcDc', 'NoDc', 'Vg'];
function fmt(n, decimals = false) {
  if (!Number.isFinite(n)) return '∞';
  if (n < 0) return '-' + fmt(-n, decimals);
  if (n < 1000) {
    if (decimals && n < 100 && n % 1 > 1e-9) return n < 10 ? String(+n.toFixed(2)) : String(+n.toFixed(1));
    return Math.floor(n).toLocaleString('en-US');
  }
  const u = Math.floor(Math.log10(n) / 3);
  if (u >= UNITS.length) return n.toExponential(2).replace('+', '');
  const v = Math.floor(n / 10 ** (u * 3) * 100) / 100;
  return (v < 10 ? v.toFixed(2) : v < 100 ? v.toFixed(1) : v.toFixed(0)) + UNITS[u];
}
const money = n => '$' + fmt(n, true);
const pad = n => String(n).padStart(2, '0');
function dur(sec) {
  sec = Math.max(0, Math.floor(sec));
  if (sec < 60) return sec + 's';
  if (sec < 3600) return Math.floor(sec / 60) + 'm ' + pad(sec % 60) + 's';
  if (sec < 86400) return Math.floor(sec / 3600) + 'h ' + pad(Math.floor(sec / 60) % 60) + 'm';
  return Math.floor(sec / 86400) + 'd ' + Math.floor(sec / 3600) % 24 + 'h';
}
const plural = w => (/[^aeiou]y$/.test(w) ? w.slice(0, -1) + 'ies' : w + 's');
const esc = t => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function setText(el, t) { if (el && el.textContent !== t) el.textContent = t; }

/* ---------- state & saving ---------- */
function load() {
  let data = null;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      data = E.migrate(JSON.parse(raw));
      if (!E.valid(data)) { localStorage.setItem(KEY + '-corrupt', raw); data = null; }
    }
  } catch { data = null; }
  if (!data) {
    // carry over a save from the original VICE
    try {
      const old = localStorage.getItem(OLD_KEY);
      if (old) {
        const m = E.migrate(JSON.parse(old));
        if (E.valid(m)) { data = m; localStorage.setItem(OLD_KEY + '-backup', old); }
      }
    } catch { /* ignore */ }
  }
  return data || E.fresh();
}

let s = load();
let saveOk = true;
function save() {
  s.last = Date.now();
  try { localStorage.setItem(KEY, JSON.stringify(s)); saveOk = true; } catch { saveOk = false; }
}

/* ---------- sound (synthesised, no files) ---------- */
const Sound = (() => {
  let ctx = null, lastCook = 0;
  function ac() {
    if (!ctx) { const C = window.AudioContext || window.webkitAudioContext; if (!C) return null; ctx = new C(); }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  function tone(freq, len, type = 'sine', vol = 0.05, slide = 0, delay = 0) {
    if (!s.settings.sound) return;
    const c = ac(); if (!c) return;
    const t = c.currentTime + delay, o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + len);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(g).connect(c.destination);
    o.start(t); o.stop(t + len + 0.05);
  }
  return {
    cook() { const n = performance.now(); if (n - lastCook < 35) return; lastCook = n; tone(480 + Math.random() * 120, 0.08, 'sine', 0.05, -200); },
    sell() { tone(880, 0.06, 'triangle', 0.045); tone(1320, 0.12, 'triangle', 0.045, 0, 0.05); },
    buy() { tone(420, 0.07, 'square', 0.02, 260); },
    unlock() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.2, 'triangle', 0.05, 0, i * 0.08)); },
    brief() { [784, 988, 1175, 1568].forEach((f, i) => tone(f, 0.14, 'sine', 0.05, 0, i * 0.06)); },
    ach() { [659, 831, 988, 1319].forEach((f, i) => tone(f, 0.4, 'sine', 0.035, 0, i * 0.04)); },
    raid() { for (let i = 0; i < 3; i++) { tone(650, 0.28, 'sawtooth', 0.035, 350, i * 0.56); tone(1000, 0.28, 'sawtooth', 0.035, -350, i * 0.56 + 0.28); } },
    warn() { tone(320, 0.18, 'square', 0.03, -120); tone(320, 0.18, 'square', 0.03, -120, 0.25); },
    error() { tone(160, 0.12, 'square', 0.025); },
  };
})();

/* ---------- visual effects ---------- */
const fx = $('fx');
function floatText(x, y, text, cls = '') {
  if (!s.settings.particles || fx.childElementCount > 80) return;
  const el = document.createElement('div');
  el.className = 'float ' + cls;
  el.textContent = text;
  el.style.left = x + (Math.random() * 40 - 20) + 'px';
  el.style.top = y + 'px';
  fx.append(el);
  setTimeout(() => el.remove(), 900);
}
function burst(x, y, emoji, n = 10) {
  if (!s.settings.particles) return;
  for (let k = 0; k < n && fx.childElementCount < 120; k++) {
    const el = document.createElement('div');
    el.className = 'particle';
    el.textContent = emoji;
    const a = Math.random() * Math.PI * 2, d = 60 + Math.random() * 90;
    el.style.left = x + 'px'; el.style.top = y + 'px';
    el.style.setProperty('--dx', Math.cos(a) * d + 'px');
    el.style.setProperty('--dy', Math.sin(a) * d + 'px');
    el.style.setProperty('--rot', (Math.random() * 720 - 360) + 'deg');
    fx.append(el);
    setTimeout(() => el.remove(), 820);
  }
}
function centerOf(el) { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }

function toast(icon, title, text = '', cls = '') {
  const box = $('toasts');
  const el = document.createElement('div');
  el.className = 'toast ' + cls;
  el.innerHTML = '<span class="t-ico"></span><div><b></b><span></span></div>';
  el.querySelector('.t-ico').textContent = icon;
  el.querySelector('b').textContent = title;
  el.querySelector(':scope > div > span').textContent = text;
  box.append(el);
  while (box.childElementCount > 4) box.firstElementChild.remove();
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, 4200);
}

/* ---------- the wire (event feed) ---------- */
function log(text, cls = '') {
  s.events.unshift({ text, time: Date.now(), cls });
  if (s.events.length > 30) s.events.length = 30;
  renderFeed();
}
function renderFeed() {
  $('feed').innerHTML = s.events.map(e =>
    `<div class="ev ${esc(e.cls || '')}">${esc(e.text)}<small>${new Date(e.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small></div>`).join('');
}

const NEWS = [
  [1, 'Local man insists his basement grow lights are "for tomatoes."'],
  [1, 'Police chief: "Drug problem? In THIS town?"'],
  [1, 'Snack aisle sales up 300%. Economists baffled.'],
  [1, 'Neighbourhood watch reports "a weird smell, but like, a nice one."'],
  [1, 'Rival crew spotted crying outside your warehouse.'],
  [2, 'Forest rangers puzzled by suspiciously tidy mushroom patches.'],
  [2, 'Festival-goers report seeing "every colour, plus a few new ones."'],
  [3, 'Coffee shop owners deny everything, offer brownies.'],
  [3, 'Stock market dips. Your cash pile does not.'],
  [4, 'Art critics praise mysterious tiny square paintings.'],
  [4, 'Rave attendance triples. Nobody can explain why the music is "so good."'],
  [5, 'Club bouncers report record water bottle sales.'],
  [5, 'Dentists warn of a jaw-clenching epidemic.'],
  [5, 'Documentary crew requests interview. Your lawyer says no.'],
  [6, 'Afterparty enters its fourth day. Neighbours file complaint.'],
  [6, 'Federal task force formed. Codename: "Operation Probably Nothing."'],
  [7, 'Coast guard spots speedboat doing 90 knots. "Probably fishing."'],
  [7, 'Your accountant asks why the car wash made $40M last quarter.'],
  [8, 'RV sales spike in the desert. Dealers ask no questions.'],
  [8, 'Chemistry teacher job applications at an all-time high.'],
  [9, 'Historians remind everyone the opium trade is "basically half of history."'],
  [10, 'Port authority inspects 1% of containers, thanks you for the other 99%.'],
  [11, 'Scientists unable to identify Nebula. Users unable to identify Tuesday.'],
  [12, 'Observatory reports a patch of sky where the stars "just stopped." Funding cut.'],
  [12, 'Dark Matter users report a knocking sound. Landlords report no doors.'],
  [12, 'Physicists: "It weighs more when nobody is looking at it." Then they stopped looking.'],
  [12, 'Desert town population drops to zero overnight. Every clock in town stopped at 3:33.'],
];
const HOT_NEWS = ['Unmarked van parked outside for the third day in a row.', 'Detectives seen photographing your "laundromat."', 'Your phone makes a strange clicking noise. Probably nothing.'];

/* ---------- lookups ---------- */
const DISTRICTS = ['The Backstreets', 'Back Alleys', 'The Docks', 'Downtown', 'The Neon Mile', 'The Strip', 'Uptown', 'Financial District', 'The Whole City', 'The State', 'The Continent', 'The World'];
const RANKS = [[0, 'Nobody'], [100, 'Corner Hustler'], [1e4, 'Street Dealer'], [1e6, 'Block Boss'], [1e8, 'Supplier'], [1e10, 'Distributor'], [1e12, 'Kingpin'], [1e14, 'Cartel Lord'], [1e16, 'Shadow Emperor'], [1e19, 'Legend']];
const rankOf = lt => RANKS.filter(r => lt >= r[0]).pop()[1];
const ACH_ICON = { click: '👆', earn: '💰', staff: '👥', mile: '🎖️', front: '🏪', raid: '🚨', heat: '🔥', bribe: '🤝', brief: '💼', inc: '📈', upg: '⬆️', pres: '👑', hoard: '📦', secret: '🕵️' };
function achIcon(a) {
  if (a.id.startsWith('line')) return E.LINES[+a.id.slice(4)].icon;
  return ACH_ICON[a.id.replace(/\d+$/, '')] || '🏆';
}
function upgradeKind(u) {
  if (u.group === 'line') { const L = E.LINES[u.line]; return [L.icon, L.name.toUpperCase(), L.color]; }
  const e = u.effect;
  if (e.clickFlat || e.clickPct) return ['👆', 'MANUAL COOKING'];
  if (e.sellMult || e.sellAll) return ['💰', 'MANUAL SALES'];
  if (e.speed) return ['⚙️', 'ALL WORKERS'];
  if (e.gprice) return ['🏷️', 'ALL PRICES'];
  if (e.heat) return ['🕶️', 'HEAT'];
  if (e.briefFreq || e.briefLife) return ['💼', 'BRIEFCASES'];
  if (e.rushDur || e.rushMult) return ['⚡', 'RUSH HOUR'];
  if (e.bribe) return ['🤝', 'BRIBES'];
  return ['🌙', 'OFFLINE'];
}
const roleName = (i, r) => (r === 'cook' ? E.LINES[i].cook : E.LINES[i].dealer);
const roleCount = (i, r) => (r === 'cook' ? s.lines[i].cooks : s.lines[i].dealers);

function buyCount(i, r, m) {
  const b = s.settings.buy;
  if (b === 'max') return Math.max(1, E.maxAffordable(s, i, r, m));
  return b;
}

/* ---------- rendering: operation panel ---------- */
function applyTheme() {
  document.documentElement.style.setProperty('--c', E.LINES[s.selected].color);
  document.body.dataset.line = E.LINES[s.selected].id;
}
function renderOp() {
  const L = E.LINES[s.selected];
  applyTheme();
  $('chips').innerHTML = E.LINES.map((l, i) => {
    const unlocked = s.lines[i].unlocked;
    return `<button class="chip ${i === s.selected ? 'active' : ''} ${unlocked ? '' : 'locked'}" style="--cc:${l.color}" ${unlocked ? `data-select="${i}" title="${esc(l.name)}"` : 'disabled aria-hidden="true"'}>${unlocked ? l.icon : '🔒'}</button>`;
  }).join('');
  setText($('tierLabel'), 'TIER ' + pad(s.selected + 1));
  setText($('productName'), L.name);
  setText($('productBlurb'), L.blurb);
  setText($('orbIcon'), L.icon);
  $('orb').setAttribute('aria-label', `Cook ${L.name} (Space)`);
}

/* ---------- rendering: tabs ---------- */
let tab = 'empire', binds = [], structKey = '';

function seg() {
  const opts = [1, 10, 25, 100, 'max'];
  return `<div class="seg" role="group" aria-label="Buy amount">${opts.map(o => `<button data-buy="${o}" class="${s.settings.buy === o ? 'on' : ''}">${o === 'max' ? 'MAX' : '×' + o}</button>`).join('')}</div>`;
}

function roleBox(i, r) {
  const name = roleName(i, r);
  return `<div class="role">
    <div class="role-top"><span>${r === 'cook' ? '🧪' : '💵'} ${esc(plural(name))}</span><b data-b="n:${i}:${r}"></b></div>
    <div class="role-rate"><span data-b="rate:${i}:${r}"></span><span data-b="msl:${i}:${r}"></span></div>
    <div class="ms"><i data-b="ms:${i}:${r}"></i></div>
    <button class="btn hire" data-hire="${i}:${r}" data-b="hire:${i}:${r}"><b></b><span></span></button>
  </div>`;
}

function lineCard(i) {
  const L = E.LINES[i], sel = i === s.selected;
  return `<article class="line ${sel ? 'selected' : ''}" style="--lc:${L.color}">
    <button class="line-head" data-select="${i}" aria-label="Work ${esc(L.name)}">
      <span class="ico">${L.icon}</span>
      <div class="line-title"><h3>${esc(L.name)}${sel ? '<span class="sel">ACTIVE</span>' : ''}${L.potency ? `<span class="potent">☢ ×${L.potency} POTENCY</span>` : ''}</h3><small data-b="price:${i}"></small></div>
      <div class="line-stock"><b data-b="stock:${i}"></b><span class="line-earn" data-b="earn:${i}"></span></div>
    </button>
    <div class="roles">${roleBox(i, 'cook')}${roleBox(i, 'deal')}</div>
    <div class="flowline"><span>make</span><div class="bal" data-b="bal:${i}"><em></em><i></i></div><span>sell</span><span data-b="balt:${i}"></span></div>
    ${L.lore ? `<button class="lore-btn" data-lore="${i}">📁 Read classified ${esc(L.lore.file.split(' ·')[0])}</button>` : ''}
  </article>`;
}

function renderEmpire() {
  $('toolbar').innerHTML = `<div><h2>Your Empire</h2><p>Cooks fill your stock. Dealers sell it. Click a product to work it by hand.</p></div>${seg()}`;
  let html = '';
  let shownLocked = 0;
  for (let i = 0; i < E.N; i++) {
    const L = E.LINES[i];
    if (s.lines[i].unlocked) { html += lineCard(i); continue; }
    if (shownLocked === 0) {
      html += `<article class="line" style="--lc:${L.color}"><div class="locked-card"><span class="ico">${L.icon}</span>
        <div><h3>${esc(L.name)}</h3><p>${esc(L.blurb)}</p><small>${money(L.price)} per batch · Tier ${pad(i + 1)}</small></div>
        <button class="btn primary" data-unlock="${i}" data-b="unlock:${i}">Unlock · ${money(L.unlock)}</button></div></article>`;
    } else if (shownLocked === 1) {
      html += L.lore
        ? `<article class="line mystery signal" style="--lc:${L.color}"><div class="locked-card"><span class="ico">📡</span>
          <div><h3>Unidentified signal</h3><p>Something fell out of the sky over the desert. Three knocks, a pause, three knocks.</p></div></div></article>`
        : `<article class="line mystery" style="--lc:#555"><div class="locked-card"><span class="ico">❔</span>
          <div><h3>Classified</h3><p>${E.N - i} more product line${E.N - i > 1 ? 's' : ''} waiting further up the ladder.</p></div></div></article>`;
    }
    shownLocked++;
  }
  $('content').innerHTML = html;
}

function upgradeCard(u, locked = false) {
  const [icon, kind, color] = upgradeKind(u);
  let req = '';
  if (locked) {
    const r = u.req || {}, parts = [];
    if (r.cooks) parts.push(`${r.cooks} ${plural(E.LINES[u.line].cook)}`);
    if (r.dealers) parts.push(`${r.dealers} ${plural(E.LINES[u.line].dealer)}`);
    req = `<span class="req">Needs ${parts.join(' + ')}</span>`;
  }
  return `<div class="card ${locked ? 'locked' : ''}" ${color ? `style="--cc:${color}"` : ''}>
    <div class="k">${icon} ${kind}</div><h4>${esc(u.name)}</h4><p>${esc(u.desc)}</p>${req}
    ${locked ? '' : `<button class="btn primary" data-upgrade="${u.id}" data-b="upg:${u.id}"><b>Buy</b><span>${money(u.cost)}</span></button>`}
  </div>`;
}

function upgradeLists() {
  const avail = E.UPGRADES.filter(u => !s.upgrades.includes(u.id) && E.upgradeReqMet(s, u)).sort((a, b) => a.cost - b.cost);
  const soon = E.UPGRADES.filter(u => u.group === 'line' && !s.upgrades.includes(u.id) && s.lines[u.line].unlocked && !E.upgradeReqMet(s, u)).sort((a, b) => a.cost - b.cost).slice(0, 4);
  return { avail, soon };
}

function renderUpgrades() {
  const { avail, soon } = upgradeLists();
  $('toolbar').innerHTML = `<div><h2>Upgrades</h2><p>One-time investments. New ones appear as your empire grows.</p></div><p>${s.upgrades.length} / ${E.UPGRADES.length} owned</p>`;
  let html = avail.length ? `<div class="cards">${avail.map(u => upgradeCard(u)).join('')}</div>` : '<div class="empty">Nothing on offer right now. Keep growing and new upgrades will show up.</div>';
  if (soon.length) html += `<div class="section-title">Coming up</div><div class="cards">${soon.map(u => upgradeCard(u, true)).join('')}</div>`;
  if (s.upgrades.length) html += `<div class="section-title">Owned</div><div class="owned-list">${s.upgrades.map(id => `<span title="${esc(E.UPGRADE_BY_ID[id].desc)}">✓ ${esc(E.UPGRADE_BY_ID[id].name)}</span>`).join('')}</div>`;
  $('content').innerHTML = html;
}

function renderFronts() {
  $('toolbar').innerHTML = `<div><h2>Front Businesses</h2><p>Legit-looking businesses give you cover, so heat builds more slowly. Each one also adds +1% to all sale prices.</p></div>`;
  let html = `<div class="summary">
    <div><small>TOTAL COVER</small><b data-b="fsum:cover"></b></div>
    <div><small>HEAT REDUCTION</small><b data-b="fsum:red"></b></div>
    <div><small>PRICE BONUS</small><b data-b="fsum:bonus"></b></div>
    <div><small>HEAT TREND</small><b data-b="fsum:trend"></b></div></div><div class="panel">`;
  let hidden = 0;
  E.FRONTS.forEach((f, k) => {
    const visible = k === 0 || s.fronts[k] > 0 || s.fronts[k - 1] > 0 || s.lifetime >= f.cost * 0.2;
    if (!visible) { hidden++; return; }
    html += `<div class="front"><span class="ico">${f.icon}</span><div class="info"><h4>${esc(f.name)}</h4><small>+${fmt(f.cover)} cover each</small></div>
      <span class="count" data-b="frontn:${k}"></span>
      <button class="btn" data-front="${k}" data-b="front:${k}"><b>Buy</b><span></span></button></div>`;
  });
  html += '</div>';
  if (hidden) html += `<div class="empty">${hidden} more front business${hidden > 1 ? 'es' : ''} to discover.</div>`;
  $('content').innerHTML = html;
}

function renderLegacy() {
  const free = s.rep - s.repSpent;
  $('toolbar').innerHTML = `<div><h2>Legacy</h2><p>Retire to cash in your reputation. Reputation is permanent and makes every future run faster.</p></div>`;
  let html = `<div class="panel legacy-hero">
    <div><h3>Retire &amp; Rebuild</h3>
      <p>Each reputation point adds <b>+2%</b> to all sale prices, forever. Retiring resets cash, stock, staff, product lines, fronts and upgrades. You keep reputation, perks, trophies and lifetime earnings.</p>
      <p data-b="leg:next"></p></div>
    <div class="gain"><small>REPUTATION ON RETIRE</small><b data-b="leg:gain"></b><button class="btn primary" id="prestigeBtn" data-b="leg:btn">Retire now</button></div>
  </div>
  <div class="summary">
    <div><small>REPUTATION</small><b>${fmt(s.rep)}</b></div>
    <div><small>PRICE BONUS</small><b>+${fmt(s.rep * 2)}%</b></div>
    <div><small>UNSPENT</small><b>${fmt(free)}</b></div>
    <div><small>TIMES RETIRED</small><b>${s.prestiges}</b></div>
  </div>
  <div class="section-title">Connections · spend reputation on permanent perks (spending doesn't reduce your bonus)</div>
  <div class="cards">${E.PERKS.map(p => {
    const owned = s.perks.includes(p.id);
    return `<div class="card ${owned ? '' : free >= p.cost ? 'can' : ''}" style="--cc:var(--gold)"><div class="k">👑 ${owned ? 'OWNED' : p.cost + ' REP'}</div><h4>${esc(p.name)}</h4><p>${esc(p.desc)}</p>
      ${owned ? '<span class="req" style="color:var(--money)">✓ Active</span>' : `<button class="btn primary" data-perk="${p.id}" data-b="perk:${p.id}"><b>Acquire</b><span>${p.cost} rep</span></button>`}</div>`;
  }).join('')}</div>`;
  $('content').innerHTML = html;
}

function renderTrophies() {
  const got = new Set(s.achievements);
  $('toolbar').innerHTML = `<div><h2>Trophies</h2><p>Each trophy adds +1% to all sale prices.</p></div><p>${got.size} / ${E.ACHIEVEMENTS.length} · +${got.size}%</p>`;
  $('content').innerHTML = `<div class="trophies">${E.ACHIEVEMENTS.map(a => {
    const has = got.has(a.id), hide = a.secret && !has;
    return `<div class="trophy ${has ? 'got' : ''}" title="${esc(hide ? 'Secret' : a.desc)}"><div class="t-ico">${hide ? '❓' : achIcon(a)}</div><b>${esc(hide ? '???' : a.name)}</b><small>${esc(hide ? 'A secret trophy.' : a.desc)}</small></div>`;
  }).join('')}</div>`;
}

function renderStats() {
  const m = E.mods(s), staff = s.lines.reduce((a, l) => a + l.cooks + l.dealers, 0);
  const rows = [
    ['Cash on hand', money(s.cash)], ['Earned this run', money(s.runEarned)], ['Lifetime earnings', money(s.lifetime)],
    ['Income right now', money(E.income(s, m)) + '/s'], ['Best income', money(s.stats.bestIncome) + '/s'],
    ['Run time', dur((Date.now() - s.runStart) / 1000)], ['Empire age', dur((Date.now() - s.created) / 1000)],
    ['Workers employed', fmt(staff)], ['Front businesses', fmt(s.fronts.reduce((a, b) => a + b, 0))],
    ['Manual cooks', fmt(s.stats.cookClicks)], ['Manual sales', fmt(s.stats.sellClicks)],
    ['Briefcases opened', fmt(s.briefcases)], ['Raids suffered', fmt(s.raids)], ['Bribes paid', fmt(s.bribes)],
    ['Highest heat', Math.floor(s.stats.maxHeat) + '%'], ['Times retired', fmt(s.prestiges)],
  ];
  $('toolbar').innerHTML = '<div><h2>Statistics</h2><p>The numbers behind the empire.</p></div>';
  $('content').innerHTML = `<table class="stats-table"><tbody>${rows.map(r => `<tr><td>${r[0]}</td><td>${r[1]}</td></tr>`).join('')}</tbody></table>
    <div class="table-wrap"><table class="stats-table"><thead><tr><th>PRODUCT</th><th>STAFF</th><th>MADE</th><th>SOLD</th><th>EARNED</th></tr></thead><tbody>
    ${s.lines.map((l, i) => l.unlocked ? `<tr><td>${E.LINES[i].icon} ${esc(E.LINES[i].name)}</td><td>${l.cooks} / ${l.dealers}</td><td>${fmt(l.made)}</td><td>${fmt(l.sold)}</td><td>${money(l.earned)}</td></tr>` : '').join('')}
    </tbody></table></div>`;
}

function computeStructKey() {
  switch (tab) {
    case 'empire': return 'e' + s.lines.map(l => (l.unlocked ? 1 : 0)).join('') + s.selected + s.settings.buy;
    case 'upgrades': { const { avail, soon } = upgradeLists(); return 'u' + avail.map(u => u.id).join() + '|' + soon.map(u => u.id).join() + s.upgrades.length; }
    case 'fronts': return 'f' + E.FRONTS.map((f, k) => (s.lifetime >= f.cost * 0.2 || s.fronts[k] > 0 ? 1 : 0)).join('');
    case 'legacy': return 'l' + s.perks.join() + s.rep + '|' + s.repSpent + '|' + (s.rep - s.repSpent >= Math.min(...E.PERKS.filter(p => !s.perks.includes(p.id)).map(p => p.cost), Infinity));
    case 'trophies': return 't' + s.achievements.length;
    case 'stats': return 's' + Math.floor(Date.now() / 1000);
  }
  return '';
}

function render() {
  document.querySelectorAll('.tab').forEach(b => { const on = b.dataset.tab === tab; b.classList.toggle('active', on); b.setAttribute('aria-selected', on); });
  ({ empire: renderEmpire, upgrades: renderUpgrades, fronts: renderFronts, legacy: renderLegacy, trophies: renderTrophies, stats: renderStats })[tab]();
  binds = [...document.querySelectorAll('#content [data-b]')].map(el => ({ el, k: el.dataset.b.split(':') }));
  structKey = computeStructKey();
  update(true);
}

function renderAll() {
  renderOp();
  buildSkyline();
  renderFeed();
  render();
}

/* ---------- skyline ---------- */
let windows = [], skylineLevel = -1;
function buildSkyline() {
  let seed = 11;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  let html = '';
  for (let k = 0; k < 40; k++) html += `<circle cx="${(rnd() * 320).toFixed(1)}" cy="${(rnd() * 70).toFixed(1)}" r="${(rnd() * 0.8 + 0.2).toFixed(2)}" fill="#fff" opacity="${(rnd() * 0.6 + 0.2).toFixed(2)}"/>`;
  html += '<circle cx="268" cy="30" r="13" fill="#f2eedb" opacity=".9"/><circle cx="263" cy="27" r="13" fill="#0e1020" opacity=".55"/>';
  let x = -4;
  while (x < 324) {
    const w = 16 + rnd() * 26, h = 35 + rnd() * 95, y = 150 - h;
    html += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="#0c0e17" stroke="#1d2135" stroke-width=".6"/>`;
    if (rnd() < 0.3) html += `<rect x="${(x + w / 2 - 0.5).toFixed(1)}" y="${(y - 8).toFixed(1)}" width="1" height="8" fill="#2a2f45"/><circle cx="${(x + w / 2).toFixed(1)}" cy="${(y - 8).toFixed(1)}" r="1.2" fill="#ff4d5e" class="flick"/>`;
    for (let wy = y + 5; wy < 146; wy += 8) for (let wx = x + 3.5; wx < x + w - 4; wx += 6.5) {
      html += `<rect class="win${rnd() < 0.03 ? ' flick' : ''}" x="${wx.toFixed(1)}" y="${wy.toFixed(1)}" width="3" height="4" data-t="${rnd().toFixed(3)}" data-k="${Math.floor(rnd() * 12)}" fill="#151827"/>`;
    }
    x += w + 1.5;
  }
  $('skyline').innerHTML = html;
  windows = [...$('skyline').querySelectorAll('.win')];
  skylineLevel = -1;
}
function updateSkyline() {
  const n = E.unlockedCount(s);
  if (n === skylineLevel) return;
  skylineLevel = n;
  const frac = 0.05 + 0.075 * n;
  for (const w of windows) {
    const t = +w.dataset.t, k = +w.dataset.k;
    w.setAttribute('fill', t < frac ? (k < n && t < frac * 0.35 ? E.LINES[k].color : '#ffd56b') : '#151827');
  }
  setText($('district'), DISTRICTS[n - 1]);
  setText($('linesCount'), `${n} / ${E.N} lines`);
}

/* ---------- live updates ---------- */
let lastBuffKey = '';
function renderBuffs(now) {
  const list = [];
  if (now < s.rushEnd) list.push({ type: 'rush', label: '⚡ Rush Hour', end: s.rushEnd });
  for (const b of E.activeBuffs(s, now)) list.push(b);
  const key = list.map(b => b.type + b.end).join();
  if (key !== lastBuffKey) {
    lastBuffKey = key;
    $('buffs').innerHTML = list.map((b, k) => `<span class="buff ${b.type}">${esc(b.label)} <b data-buff="${k}"></b></span>`).join('');
  }
  list.forEach((b, k) => setText(document.querySelector(`[data-buff="${k}"]`), Math.ceil((b.end - now) / 1000) + 's'));
}

function lineStatus(i, m) {
  const l = s.lines[i], mk = E.makeCap(s, i, m), sl = E.sellCap(s, i, m);
  if (!l.cooks && !l.dealers) return ['No crew yet', ''];
  if (!l.dealers) return ['No dealers: stock piles up', 'warn'];
  if (mk > sl * 1.05) return [`+${fmt(mk - sl, true)}/s piling up`, 'warn'];
  if (sl > mk * 1.05) return l.stock > 1 ? [`Stock lasts ${dur(l.stock / (sl - mk))}`, 'good'] : ['Dealers waiting on stock', 'bad'];
  return ['Balanced', 'good'];
}

function tipText(m) {
  const l = s.lines[0], cur = s.lines[s.selected], L = E.LINES[s.selected];
  if (s.stats.cookClicks < 3 && !l.cooks) return 'Click the <b>product</b> (or press <b>Space</b>) to cook your first batch.';
  if (!l.cooks && !l.dealers && s.cash < E.LINES[0].cookCost) return cur.stock >= 1 ? 'Now hit <b>SELL</b> to turn your stock into cash.' : 'Keep cooking, then sell. You need cash to hire help.';
  if (!l.cooks) return `You can afford a <b>${L.cook}</b>. Hire one in the Empire tab and they cook for you.`;
  if (!l.dealers) return `Cooks only make stock. Hire a <b>${E.LINES[0].dealer}</b> to sell it automatically.`;
  if (s.heat > 60 && !s.fronts.some(Boolean)) return 'Heat is climbing! Buy a <b>front business</b> or pay a <b>bribe</b> before the cops raid you.';
  if (s.heat > 80) return 'Heat is dangerously high. <b>Bribe</b> now or lose 25% of your cash in a raid.';
  const next = s.lines.findIndex(x => !x.unlocked);
  if (next > 0 && s.cash >= E.LINES[next].unlock) return `You can unlock <b>${E.LINES[next].name}</b>! Bigger product, bigger money.`;
  if (E.repGain(s) >= 10 && s.prestiges === 0) return 'You could <b>retire</b> for reputation in the Legacy tab. Your next run will be much faster.';
  if (E.sellCap(s, s.selected, m) < E.makeCap(s, s.selected, m) && cur.stock > 50) return 'Stock is piling up. Hire more <b>dealers</b>, or sell by hand.';
  const tips = ['A <b>💼 briefcase</b> sometimes appears on screen. Click it fast!', 'Every <b>25, 50, 100…</b> of one role doubles their speed.', 'Use <b>Rush Hour</b> (R) to double all workers for a while.', 'Trophies each add <b>+1%</b> to sale prices.', 'Fronts cut heat <i>and</i> raise prices. Win-win.'];
  return tips[Math.floor(Date.now() / 12000) % tips.length];
}

let lastUpdate = 0;
function update(force = false) {
  const now = Date.now(), m = E.mods(s, now);
  const inc = E.income(s, m);
  setText($('cash'), money(s.cash));
  setText($('ips'), money(inc));

  // heat
  const heat = Math.min(100, s.heat), trend = E.heatRate(s, m) - E.HEAT_DECAY;
  $('heatFill').style.width = heat + '%';
  setText($('heatPct'), Math.floor(heat) + '%');
  setText($('heatRate'), trend > 0.005 ? `+${trend.toFixed(2)}/s` : s.heat > 0.5 ? 'cooling' : 'cold');
  $('heatBox').className = 'heat' + (heat >= 85 ? ' danger' : heat >= 60 ? ' warn' : '');
  const bc = E.bribeCost(s, m), bribeBtn = $('bribe');
  setText($('bribeCost'), now < s.bribeReady ? dur((s.bribeReady - now) / 1000) : money(bc));
  bribeBtn.disabled = now < s.bribeReady || s.cash < bc || s.heat < 1;

  // operation panel
  const i = s.selected, l = s.lines[i];
  setText($('productPrice'), money(E.price(s, i, m)));
  setText($('stock'), fmt(l.stock));
  setText($('makeRate'), fmt(E.makeCap(s, i, m), true));
  setText($('sellRate'), fmt(E.sellCap(s, i, m), true));
  const [st, cls] = lineStatus(i, m);
  setText($('statusPill'), st);
  $('statusPill').className = 'status-pill ' + cls;
  setText($('cookAmt'), '+' + fmt(E.cookAmount(s, m), true));
  const sa = E.sellAmount(s, m);
  setText($('sellAmt'), sa >= 0.01 ? `${fmt(sa, true)} · ${money(sa * E.price(s, i, m))}` : 'no stock');
  $('sellBtn').disabled = sa < 0.01;
  const rushOn = now < s.rushEnd;
  $('rushBtn').classList.toggle('active', rushOn);
  $('rushBtn').disabled = !rushOn && now < s.rushReady;
  setText($('rushState'), rushOn ? Math.ceil((s.rushEnd - now) / 1000) + 's' : now < s.rushReady ? dur((s.rushReady - now) / 1000) : 'READY');
  setText($('rushDesc'), `All workers ×${2 * m.rushMult} for ${30 * m.rushDur}s`);
  renderBuffs(now);

  // bound elements inside the current tab
  for (const { el, k } of binds) {
    const [kind, a, r] = k, j = +a;
    switch (kind) {
      case 'price': setText(el, `${money(E.price(s, j, m))} / batch · Tier ${pad(j + 1)}`); break;
      case 'stock': setText(el, fmt(s.lines[j].stock) + ' stock'); break;
      case 'earn': setText(el, money(E.actualSell(s, j, m) * E.price(s, j, m)) + '/s'); break;
      case 'n': setText(el, '×' + roleCount(j, r)); break;
      case 'rate': {
        const each = r === 'cook' ? E.cookRate(s, j, m) : E.dealRate(s, j, m);
        setText(el, `${fmt(each * roleCount(j, r), true)}/s (${fmt(each, true)} ea)`);
        break;
      }
      case 'msl': { const nm = E.nextMilestone(roleCount(j, r)); setText(el, nm ? `×2 at ${nm}` : 'MAXED'); break; }
      case 'ms': {
        const c = roleCount(j, r), nm = E.nextMilestone(c), prev = [0, ...E.MILESTONES].filter(t => t <= c).pop();
        el.style.width = (nm ? ((c - prev) / (nm - prev)) * 100 : 100) + '%';
        break;
      }
      case 'hire': {
        const n = buyCount(j, r, m), cost = E.hireCost(s, j, r, n, m);
        setText(el.firstChild, `Hire ×${n}`);
        setText(el.lastChild, money(cost));
        el.disabled = s.cash < cost;
        break;
      }
      case 'bal': {
        const mk = E.makeCap(s, j, m), sl = E.sellCap(s, j, m), tot = mk + sl;
        el.firstChild.style.cssText = `left:0;width:${tot ? (mk / tot) * 100 : 50}%`;
        break;
      }
      case 'balt': setText(el, lineStatus(j, m)[0]); break;
      case 'unlock': el.disabled = s.cash < E.LINES[j].unlock; break;
      case 'upg': {
        const u = E.UPGRADE_BY_ID[a];
        el.disabled = s.cash < u.cost;
        el.closest('.card').classList.toggle('can', s.cash >= u.cost);
        break;
      }
      case 'front': { const c = E.frontCost(s, j); setText(el.lastChild, money(c)); el.disabled = s.cash < c; break; }
      case 'frontn': setText(el, '×' + s.fronts[j]); break;
      case 'fsum': {
        const cover = m.cover, fc = s.fronts.reduce((x, y) => x + y, 0);
        if (a === 'cover') setText(el, fmt(cover));
        if (a === 'red') setText(el, '−' + (100 - 100 / (1 + cover / 10)).toFixed(1) + '%');
        if (a === 'bonus') setText(el, '+' + fc + '%');
        if (a === 'trend') setText(el, trend > 0.005 ? `+${trend.toFixed(2)}/s` : 'cooling');
        break;
      }
      case 'perk': el.disabled = s.rep - s.repSpent < E.PERK_BY_ID[a].cost; break;
      case 'leg': {
        const gain = E.repGain(s);
        if (a === 'gain') setText(el, '+' + fmt(gain));
        if (a === 'btn') el.disabled = gain < 1;
        if (a === 'next') setText(el, `Next reputation point at ${money(E.lifetimeForRep(E.repFor(s.lifetime) + 1))} lifetime earnings (now ${money(s.lifetime)}).`);
        break;
      }
    }
  }

  // slower updates
  if (force || now - lastUpdate > 500) {
    lastUpdate = now;
    setText($('rank'), rankOf(s.lifetime));
    const tip = tipText(m);
    if ($('tip').innerHTML !== tip) $('tip').innerHTML = tip;
    const affordable = E.UPGRADES.filter(u => !s.upgrades.includes(u.id) && E.upgradeReqMet(s, u) && s.cash >= u.cost).length;
    setText($('upgBadge'), affordable ? String(affordable) : '');
    const rg = E.repGain(s);
    setText($('repBadge'), rg >= 1 ? '+' + fmt(rg) : '');
    updateGoal();
    updateSkyline();
    const key = computeStructKey();
    if (!force && key !== structKey) render();
  }
}

function updateGoal() {
  const next = s.lines.findIndex(l => !l.unlocked);
  let text, have, need;
  if (next > 0) {
    text = `Unlock ${E.LINES[next].icon} ${E.LINES[next].name}`;
    have = s.cash; need = E.LINES[next].unlock;
  } else {
    const r = E.repFor(s.lifetime);
    text = `Reach ${r + 1} total reputation`;
    have = s.lifetime - E.lifetimeForRep(r); need = E.lifetimeForRep(r + 1) - E.lifetimeForRep(r);
  }
  setText($('goalText'), text);
  $('goalFill').style.width = Math.min(100, (have / need) * 100) + '%';
  setText($('goalSub'), `${money(Math.max(0, have))} / ${money(need)}`);
}

/* ---------- game loop ---------- */
let lastTick = Date.now(), lastHeatBand = 0, nextBrief = Date.now() + 45000, briefTimer = null, nextMarket = Date.now() + 120000, nextNews = Date.now() + 20000, lastSlow = 0;

function tick() {
  const now = Date.now();
  const dt = (now - lastTick) / 1000;
  lastTick = now;
  if (dt <= 0) return;
  if (dt > 60) { catchUp(dt, dt > 300); return; }
  const r = E.advance(s, dt, now);
  if (r.raid) onRaid(r.raid);
  s.buffs = E.activeBuffs(s, now);
}

function slowTick() {
  const now = Date.now(), m = E.mods(s, now);
  s.stats.bestIncome = Math.max(s.stats.bestIncome, E.income(s, m));
  for (const a of E.checkAchievements(s)) {
    toast(achIcon(a), 'Trophy: ' + a.name, a.desc + ' (+1% prices)', 'gold');
    log(`🏆 Trophy unlocked: ${a.name}`, 'gold');
    Sound.ach();
  }
  // heat warnings
  const band = s.heat >= 90 ? 2 : s.heat >= 70 ? 1 : 0;
  if (band > lastHeatBand) {
    if (band === 1) toast('🚔', 'The cops are sniffing around', 'Heat over 70%. Buy fronts or pay a bribe.', 'bad');
    if (band === 2) { toast('🚨', 'Raid imminent!', 'Heat over 90%. Bribe now or lose cash and stock.', 'bad'); Sound.warn(); }
  }
  lastHeatBand = band;
  // briefcase
  if (now >= nextBrief && $('briefcase').hidden && !document.hidden) spawnBriefcase(m);
  // market events
  if (now >= nextMarket) { marketEvent(); nextMarket = now + (150 + Math.random() * 180) * 1000; }
  // news
  if (now >= nextNews) {
    const n = E.unlockedCount(s);
    let pool = NEWS.filter(x => x[0] <= n).map(x => x[1]);
    if (s.heat > 60) pool = pool.concat(HOT_NEWS, HOT_NEWS);
    if (s.fronts[0] > 0) pool.push('Your laundromat wins "Cleanest Business" award. Ironic.');
    log('📰 ' + pool[Math.floor(Math.random() * pool.length)], 'news');
    nextNews = now + (40 + Math.random() * 50) * 1000;
  }
}

function catchUp(sec, announce) {
  const m = E.mods(s);
  const cap = E.MAX_OFFLINE * m.offline;
  const t = Math.min(sec, cap);
  const stockBefore = s.lines.reduce((a, l) => a + l.stock, 0);
  const r = E.advance(s, t, Date.now(), { offline: true });
  const stockAfter = s.lines.reduce((a, l) => a + l.stock, 0);
  if (r.earned > 0 || stockAfter > stockBefore + 1) {
    log(`🌙 While you were away (${dur(sec)}): ${money(r.earned)} in sales.`, 'good');
    if (announce) {
      notice('🌙', 'Welcome back, boss',
        `<p>You were gone for <b>${dur(sec)}</b>. Your crew kept working.</p>
         <span class="big-num">+${money(r.earned)}</span>
         <p>${stockAfter > stockBefore + 1 ? `Stock grew by ${fmt(stockAfter - stockBefore)} batches. ` : ''}${sec > cap ? `Offline earnings are capped at ${dur(cap)}.` : ''}${s.heat > 50 ? ' The cops stayed away, but heat is up to ' + Math.floor(s.heat) + '%.' : ''}</p>`);
    } else toast('🌙', 'Welcome back', `+${money(r.earned)} while you were away.`, 'good');
  }
}

function onRaid(r) {
  Sound.raid();
  $('flash').classList.remove('raid'); void $('flash').offsetWidth; $('flash').classList.add('raid');
  log(`🚨 RAID! Lost ${money(r.cashLost)} and ${fmt(r.stockLost)} batches.`, 'bad');
  const body = `<p>The cops kicked in the doors of your stash houses.</p><span class="big-num bad">−${money(r.cashLost)}</span>
    <p>${fmt(r.stockLost)} batches seized. Heat is back down to 20%.<br>Buy <b>front businesses</b> and keep an eye on the heat meter.</p>`;
  if (document.querySelector('dialog[open]')) toast('🚨', 'RAID!', `Lost ${money(r.cashLost)} and ${fmt(r.stockLost)} batches.`, 'bad');
  else notice('🚨', 'Raid!', body);
}

/* ---------- briefcases & market events ---------- */
function spawnBriefcase(m) {
  const b = $('briefcase');
  const w = window.innerWidth, h = window.innerHeight;
  b.style.left = 30 + Math.random() * Math.max(10, w - 130) + 'px';
  b.style.top = 110 + Math.random() * Math.max(10, h - 230) + 'px';
  b.classList.remove('leaving');
  b.hidden = false;
  const life = 13000 * m.briefLife;
  clearTimeout(briefTimer);
  briefTimer = setTimeout(() => hideBriefcase(m), life);
}
function hideBriefcase(m = E.mods(s)) {
  const b = $('briefcase');
  b.classList.add('leaving');
  setTimeout(() => { b.hidden = true; b.classList.remove('leaving'); }, 450);
  nextBrief = Date.now() + (90 + Math.random() * 150) * 1000 / m.briefFreq;
}
function openBriefcase() {
  tick();
  const now = Date.now(), m = E.mods(s, now);
  const [x, y] = centerOf($('briefcase'));
  clearTimeout(briefTimer);
  s.briefcases++;
  const type = E.briefcaseReward(s, m);
  if (type === 'cash') {
    const amt = E.briefcaseCash(s, m);
    E.addCash(s, amt);
    toast('💰', 'Briefcase full of cash!', `+${money(amt)}`, 'gold');
    log(`💼 Found a briefcase with ${money(amt)} inside.`, 'gold');
    floatText(x, y, '+' + money(amt), 'money');
  } else if (type === 'frenzy') {
    s.buffs.push({ type: 'frenzy', mult: 7, end: now + 30000, label: '🔥 Frenzy ×7' });
    toast('🔥', 'Supply frenzy!', 'All workers ×7 speed for 30 seconds.', 'gold');
    log('💼 Briefcase: supply frenzy! Workers ×7 for 30s.', 'gold');
  } else if (type === 'click') {
    s.buffs.push({ type: 'click', mult: 25, end: now + 15000, label: '👆 Adrenaline ×25' });
    toast('👆', 'Adrenaline rush!', 'Manual clicks ×25 for 15 seconds. Go go go!', 'gold');
    log('💼 Briefcase: adrenaline! Clicks ×25 for 15s.', 'gold');
  } else if (type === 'demand') {
    s.buffs.push({ type: 'demand', mult: 3, end: now + 40000, label: '📈 Demand ×3' });
    toast('📈', 'Demand surge!', 'All prices ×3 for 40 seconds.', 'gold');
    log('💼 Briefcase: demand surge! Prices ×3 for 40s.', 'gold');
  } else if (type === 'heat') {
    s.heat = 0;
    toast('🗂️', 'Evidence "lost"', 'Someone shredded your file. Heat wiped.', 'gold');
    log('💼 Briefcase: your police file went missing. Heat wiped.', 'gold');
  }
  burst(x, y, '💵', 14);
  Sound.brief();
  hideBriefcase(m);
  update(true);
}

function marketEvent() {
  const lines = s.lines.map((l, i) => i).filter(i => s.lines[i].unlocked && s.lines[i].dealers > 0);
  if (!lines.length) return;
  const now = Date.now();
  const i = lines[Math.floor(Math.random() * lines.length)], L = E.LINES[i];
  if (Math.random() < 0.75 || E.unlockedCount(s) < 3) {
    s.buffs.push({ type: 'hot', line: i, mult: 2, end: now + 60000, label: `${L.icon} ${L.name} ×2` });
    toast(L.icon, `Hot market: ${L.name}`, `${L.name} prices doubled for 60 seconds.`, 'good');
    log(`📈 ${L.name} demand is through the roof. Prices ×2 for 60s.`, 'good');
  } else {
    s.heat = Math.min(99, s.heat + 15);
    toast('🚓', 'Crackdown!', `Police sweep the ${L.name.toLowerCase()} scene. Heat +15.`, 'bad');
    log(`🚓 Police crackdown on the ${L.name.toLowerCase()} scene. Heat +15.`, 'bad');
  }
}

/* ---------- actions ---------- */
function doCook(x, y) {
  tick();
  const n = E.manualCook(s);
  Sound.cook();
  const orb = $('orb');
  orb.classList.remove('pop'); void orb.offsetWidth; orb.classList.add('pop');
  if (x === undefined) [x, y] = centerOf(orb);
  floatText(x, y - 20, '+' + fmt(n, true));
  update();
}
function doSell() {
  tick();
  const r = E.manualSell(s);
  if (r.n <= 0) { Sound.error(); return; }
  Sound.sell();
  const [x, y] = centerOf($('sellBtn'));
  floatText(x, y - 30, '+' + money(r.cash), 'money');
  update();
}
function doRush() {
  tick();
  if (!E.rush(s)) return;
  const m = E.mods(s);
  toast('⚡', 'Rush Hour!', `All workers ×${2 * m.rushMult} for ${30 * m.rushDur} seconds.`, 'gold');
  Sound.unlock();
  update(true);
}
function doBribe() {
  tick();
  const c = E.bribeCost(s);
  if (!E.bribe(s)) { Sound.error(); return; }
  toast('🤝', 'Palms greased', `Paid ${money(c)}. Heat −50.`, 'good');
  log(`🤝 Paid a ${money(c)} bribe. Heat drops.`, '');
  Sound.sell();
  update(true);
}
function selectLine(i) {
  if (!s.lines[i] || !s.lines[i].unlocked) return;
  s.selected = i;
  renderOp();
  update(true);
  if (tab === 'empire') render();
}
function cycleLine(dir) {
  const unlocked = s.lines.map((l, i) => i).filter(i => s.lines[i].unlocked);
  const k = unlocked.indexOf(s.selected);
  selectLine(unlocked[(k + dir + unlocked.length) % unlocked.length]);
}

function onHire(i, r, btn) {
  tick();
  const m = E.mods(s), n = buyCount(i, r, m), before = E.milestoneCount(roleCount(i, r));
  if (!E.hire(s, i, r, n, m)) { Sound.error(); return; }
  Sound.buy();
  const after = E.milestoneCount(roleCount(i, r));
  if (after > before) {
    const [x, y] = centerOf(btn);
    burst(x, y, E.LINES[i].icon, 12);
    toast('🎖️', 'Milestone reached!', `${plural(roleName(i, r))} on ${E.LINES[i].name} now work ${2 ** (after - before) > 2 ? 2 ** (after - before) + '×' : 'twice as'} fast.`, 'gold');
  }
  update(true);
}

/* ---------- dialogs ---------- */
function showLore(i) {
  const L = E.LINES[i], lore = L.lore;
  notice(L.icon, L.name, `<div class="lore">
    <div class="lore-head"><span>CLASSIFIED</span><span>${esc(lore.file)}</span></div>
    <dl><dt>Origin</dt><dd>${esc(lore.origin)}</dd><dt>Street names</dt><dd>${esc(lore.street)}</dd>
      <dt>Potency</dt><dd>Off the scale. Sells for ×${L.potency} a normal step up, draws ×${L.heatMult} the heat.</dd></dl>
    ${lore.paragraphs.map(p => `<p>${p}</p>`).join('')}
  </div>`);
  $('notice').classList.add('lore-open');
  $('notice').addEventListener('close', () => $('notice').classList.remove('lore-open'), { once: true });
}

let pending = null;
function confirmAction(title, text, fn) {
  setText($('confirmTitle'), title);
  setText($('confirmText'), text);
  pending = fn;
  $('confirm').showModal();
}
function notice(icon, title, html) {
  setText($('noticeIcon'), icon);
  setText($('noticeTitle'), title);
  $('noticeBody').innerHTML = html;
  if (!$('notice').open) $('notice').showModal();
}
$('confirmNo').onclick = () => { $('confirm').close(); pending = null; };
$('confirmYes').onclick = () => { $('confirm').close(); const fn = pending; pending = null; if (fn) fn(); };
document.querySelectorAll('[data-close]').forEach(b => { b.onclick = () => b.closest('dialog').close(); });
document.querySelectorAll('dialog').forEach(d => d.addEventListener('click', e => { if (e.target === d) d.close(); }));

/* ---------- events ---------- */
$('orb').addEventListener('click', e => doCook(e.detail ? e.clientX : undefined, e.detail ? e.clientY : undefined));
$('cookBtn').onclick = () => doCook();
$('sellBtn').onclick = doSell;
$('rushBtn').onclick = doRush;
$('bribe').onclick = doBribe;
$('briefcase').onclick = openBriefcase;
$('chips').onclick = e => { const b = e.target.closest('[data-select]'); if (b) selectLine(+b.dataset.select); };
$('tabs').onclick = e => { const b = e.target.closest('.tab'); if (b) { tick(); tab = b.dataset.tab; render(); } };
$('toolbar').onclick = e => {
  const b = e.target.closest('[data-buy]');
  if (b) { s.settings.buy = b.dataset.buy === 'max' ? 'max' : +b.dataset.buy; render(); }
};

$('content').onclick = e => {
  const t = e.target;
  let b;
  if ((b = t.closest('[data-hire]'))) { const [i, r] = b.dataset.hire.split(':'); onHire(+i, r, b); return; }
  if ((b = t.closest('[data-select]'))) { selectLine(+b.dataset.select); return; }
  if ((b = t.closest('[data-unlock]'))) {
    tick();
    const i = +b.dataset.unlock;
    if (!E.unlockLine(s, i)) { Sound.error(); return; }
    const [x, y] = centerOf(b);
    burst(x, y, E.LINES[i].icon, 18);
    Sound.unlock();
    toast(E.LINES[i].icon, `${E.LINES[i].name} unlocked!`, `Hire ${plural(E.LINES[i].cook)} and ${plural(E.LINES[i].dealer)} to get it moving.`, 'good');
    log(`🔓 Expanded into ${E.LINES[i].name}.`, 'good');
    s.selected = i;
    renderOp(); render(); save();
    if (E.LINES[i].lore) showLore(i);
    return;
  }
  if ((b = t.closest('[data-lore]'))) { showLore(+b.dataset.lore); return; }
  if ((b = t.closest('[data-upgrade]'))) {
    tick();
    const u = E.UPGRADE_BY_ID[b.dataset.upgrade];
    if (!E.buyUpgrade(s, u.id)) { Sound.error(); return; }
    Sound.buy();
    const [x, y] = centerOf(b);
    burst(x, y, '⬆️', 8);
    log(`⬆️ Bought ${u.name}.`);
    render();
    return;
  }
  if ((b = t.closest('[data-front]'))) {
    tick();
    const k = +b.dataset.front;
    if (!E.buyFront(s, k)) { Sound.error(); return; }
    Sound.buy();
    if (s.fronts[k] === 1) log(`🏪 Opened your first ${E.FRONTS[k].name}.`);
    update(true);
    return;
  }
  if ((b = t.closest('[data-perk]'))) {
    const p = E.PERK_BY_ID[b.dataset.perk];
    if (!E.buyPerk(s, p.id)) { Sound.error(); return; }
    Sound.unlock();
    const later = ['seed', 'crew', 'contacts', 'headstart'].includes(p.id);
    toast('👑', p.name, later ? 'Kicks in from your next run.' : 'Active now.', 'gold');
    render(); save();
    return;
  }
  if (t.closest('#prestigeBtn')) {
    tick();
    const gain = E.repGain(s);
    if (gain < 1) return;
    confirmAction('Retire and rebuild?', `You'll gain ${fmt(gain)} reputation (+${fmt(gain * 2)}% prices, permanently). Cash, stock, staff, product lines, fronts and upgrades reset.`, () => {
      const r = E.prestige(s);
      if (!r) return;
      s = r.state;
      lastTick = Date.now();
      log(`👑 Retired with +${fmt(r.gain)} reputation. A new empire begins.`, 'gold');
      notice('👑', 'A legend retires', `<p>You walked away with</p><span class="big-num" style="color:var(--gold)">+${fmt(r.gain)} REP</span><p>All sale prices are now <b>+${fmt(s.rep * 2)}%</b>. Spend reputation on Connections for permanent perks.</p>`);
      tab = 'legacy';
      renderAll(); save();
    });
  }
};

// secret: poke the logo
let logoPokes = 0, logoTimer;
$('logo').onclick = () => {
  logoPokes++;
  clearTimeout(logoTimer);
  logoTimer = setTimeout(() => { logoPokes = 0; }, 2000);
  if (logoPokes >= 10 && !s.stats.secret) { s.stats.secret = true; toast('🕵️', '"Who\'s asking?"', 'Some questions are better left alone.', 'gold'); }
};

window.addEventListener('keydown', e => {
  if (document.querySelector('dialog[open]') || ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName) || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.code === 'Space') {
    e.preventDefault();
    if (document.activeElement.tagName === 'BUTTON') document.activeElement.blur();
    if (!e.repeat) doCook();
  } else if (e.code === 'KeyS') doSell();
  else if (e.code === 'KeyR') doRush();
  else if (e.code === 'KeyB') doBribe();
  else if (e.code === 'BracketLeft') cycleLine(-1);
  else if (e.code === 'BracketRight') cycleLine(1);
});

/* ---------- settings ---------- */
function toCode(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  let bin = '';
  for (let k = 0; k < bytes.length; k++) bin += String.fromCharCode(bytes[k]);
  return btoa(bin);
}
function fromCode(text) {
  text = text.trim();
  if (text.startsWith('{')) return JSON.parse(text);
  const bin = atob(text.replace(/\s+/g, ''));
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0))));
}
function tryImport(text) {
  try {
    if (text.length > 500000) throw Error('too big');
    const data = E.migrate(fromCode(text));
    if (!E.valid(data)) throw Error('invalid');
    confirmAction('Load this empire?', 'This replaces your current progress with the imported save.', () => {
      data.last = Date.now();
      s = data;
      lastTick = Date.now();
      renderAll(); save();
      $('settings').close();
      toast('💾', 'Save loaded', 'Welcome back.', 'good');
    });
  } catch {
    setText($('settingsMsg'), 'That save code is not valid. Your progress is unchanged.');
  }
}
$('settingsBtn').onclick = () => {
  $('optSound').checked = s.settings.sound;
  $('optParticles').checked = s.settings.particles;
  setText($('settingsMsg'), '');
  $('saveCode').value = '';
  $('settings').showModal();
};
$('optSound').onchange = e => { s.settings.sound = e.target.checked; updateSoundBtn(); };
$('optParticles').onchange = e => { s.settings.particles = e.target.checked; };
function updateSoundBtn() { setText($('soundBtn'), s.settings.sound ? '🔊' : '🔇'); }
$('soundBtn').onclick = () => { s.settings.sound = !s.settings.sound; updateSoundBtn(); Sound.buy(); };
$('exportBtn').onclick = async () => {
  tick(); save();
  const code = toCode(s);
  $('saveCode').value = code;
  $('saveCode').select();
  try { await navigator.clipboard.writeText(code); setText($('settingsMsg'), 'Save code copied to clipboard.'); } catch { setText($('settingsMsg'), 'Save code is in the box above. Copy it somewhere safe.'); }
};
$('downloadBtn').onclick = () => {
  tick(); save();
  const url = URL.createObjectURL(new Blob([JSON.stringify(s)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url; a.download = `vice-save-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  setText($('settingsMsg'), 'Save downloaded.');
};
$('importBtn').onclick = () => tryImport($('saveCode').value);
$('importFile').onchange = async e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  if (f.size > 500000) { setText($('settingsMsg'), 'That file is too large to be a save.'); return; }
  tryImport(await f.text());
};
$('resetBtn').onclick = () => confirmAction('Wipe everything?', 'This deletes ALL progress, including reputation, perks and trophies. Copy a save code first if you might want it back.', () => {
  s = E.fresh();
  s.events = [];
  lastTick = Date.now();
  tab = 'empire';
  save();
  $('settings').close();
  log('A fresh start. Click the product to cook your first batch.');
  renderAll();
});

/* ---------- boot ---------- */
const away = (Date.now() - s.last) / 1000;
if (away > 30) catchUp(away, away > 120);
lastTick = Date.now();
if (!s.events.length) log('Every empire starts with one plant. Click it to cook your first batch.');
updateSoundBtn();
renderAll();
setInterval(() => { tick(); update(); }, 100);
setInterval(() => { tick(); slowTick(); }, 1000);
setInterval(save, 5000);
window.addEventListener('pagehide', () => { tick(); save(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) { tick(); save(); } });
