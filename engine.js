'use strict';
/*
 * VICE engine: pure game data and economy math. No DOM access.
 * Loaded by the browser before game.js, and by Node for tests (module.exports).
 */

const SAVE_VERSION = 3;
const BASE_RATE = 0.5;      // batches / sec for one worker before bonuses
const GROWTH = 1.15;        // each extra hire of the same role costs 15% more
const MILESTONES = [25, 50, 100, 150, 200, 250, 300, 400, 500];
const HEAT_DECAY = 0.4;     // heat points lost per second
const RAID_RESET = 20;      // heat after a raid
const MAX_OFFLINE = 8 * 3600;
// Each product line costs more than it pays relative to the last, so climbing slows down.
const PRICE_STEP = Number(globalThis.VICE_PRICE_STEP || 8);
const COST_STEP = Number(globalThis.VICE_COST_STEP || 17);
const HEAT_BASE = 0.05, HEAT_STEP = 1.6;

// Round to two significant figures so prices look hand-picked.
const nice = n => {
  if (n < 100) return Math.round(n);
  const p = Math.pow(10, Math.floor(Math.log10(n)) - 1);
  return Math.round(n / p) * p;
};

const LINE_INFO = [
  { id: 'cannabis', name: 'Cannabis', icon: '🌿', color: '#8ee05f', cook: 'Grower', dealer: 'Corner Dealer', upg: ['Grow Lights', 'Corner Network', 'Top-Shelf Strains'], blurb: 'Where every empire starts. Cheap, cheerful, everywhere.' },
  { id: 'mushrooms', name: 'Mushrooms', icon: '🍄', color: '#c49bf2', cook: 'Spore Farmer', dealer: 'Festival Vendor', upg: ['Humidity Tents', 'Festival Circuit', 'Golden Strain'], blurb: 'Grown in the dark, sold under the stars.' },
  { id: 'hashish', name: 'Hashish', icon: '🍫', color: '#d9a55b', cook: 'Presser', dealer: 'Café Contact', upg: ['Hydraulic Presses', 'Coffee-Shop Deals', 'Moroccan Gold'], blurb: 'Old-world product with a loyal crowd.' },
  { id: 'lsd', name: 'LSD', icon: '🌈', color: '#ff7ac8', cook: 'Chemist', dealer: 'Rave Promoter', upg: ['Blotter Art Studio', 'Warehouse Raves', 'Crystal Clear Batch'], blurb: 'Tiny squares. Enormous margins.' },
  { id: 'mdma', name: 'MDMA', icon: '💊', color: '#6fb7ff', cook: 'Pill Presser', dealer: 'Club Doorman', upg: ['Custom Pill Molds', 'VIP Lists', 'Designer Logos'], blurb: 'The weekend runs on it.' },
  { id: 'ketamine', name: 'Ketamine', icon: '🌀', color: '#7de3d6', cook: 'Lab Tech', dealer: 'Afterparty Host', upg: ['Bulk Supplier', 'Underground Clubs', 'Clinical Grade'], blurb: 'The afterparty never ends.' },
  { id: 'cocaine', name: 'Cocaine', icon: '❄️', color: '#e8eef7', cook: 'Jungle Lab', dealer: 'Smuggler', upg: ['Hidden Airstrips', 'Speedboat Fleet', 'Fish-Scale Grade'], blurb: 'Big money, bigger enemies.' },
  { id: 'meth', name: 'Methamphetamine', icon: '💎', color: '#4fd1ff', cook: 'Cook', dealer: 'Biker Gang', upg: ['Superlab', 'Trucking Routes', 'Sky-Blue Purity'], blurb: 'Say my name.' },
  { id: 'opium', name: 'Opium', icon: '🌺', color: '#ff6b6b', cook: 'Poppy Farmer', dealer: 'Caravan', upg: ['Terraced Fields', 'Mountain Passes', 'Aged Resin'], blurb: 'An ancient trade, now under new management.' },
  { id: 'heroin', name: 'Heroin', icon: '🥀', color: '#c9905a', cook: 'Refinery', dealer: 'Port Contact', upg: ['Refinery Expansion', 'Container Ships', 'Premium Grade'], blurb: 'The darkest corner of the market.' },
  { id: 'nebula', name: 'Nebula', icon: '🌌', color: '#9d7bff', cook: 'Synth Lab', dealer: 'Darknet Vendor', upg: ['Quantum Reactor', 'Encrypted Markets', 'Stable Formula'], blurb: 'A designer compound nobody can identify. Yet.' },
  {
    id: 'darkmatter', name: 'Dark Matter', icon: '🌑', color: '#a77bff', cook: 'Containment Lab', dealer: 'Void Courier',
    upg: ['Event Horizon Reactor', 'Wormhole Routes', 'Pure Void'],
    blurb: 'Not from here. Not from anywhere. Extremely potent.',
    // Alien product: sells for 3× a normal tier step, and draws 3× the heat.
    potency: 3, heatMult: 3, monopoly: 'Galactic Monopoly',
    lore: {
      file: 'FILE 0-Ω · "THE QUIET"',
      origin: 'Unknown. Non-terrestrial.',
      street: 'The Quiet, Black Sugar, Void, Knock-Knock',
      paragraphs: [
        'Eleven years ago something came down in the desert outside the city. No sound, no crater, no shadow. The military fenced off the site within the hour. By morning the fence was gone, and so were the soldiers.',
        'What came out of that desert is a fine black powder that doesn’t reflect light. It doesn’t reflect anything. Instruments read it as empty space that somehow has weight. The physicists who were brought in called it dark matter. The people who’ve tried it call it <b>the Quiet</b>.',
        'One grain is ten thousand times stronger than anything on Earth. Users say they see the night sideways: every version of the evening at once. Doses are measured in micro-grains. Nobody measures overdoses, because nobody who takes one is around to describe it.',
        'It can’t be grown or cooked. It can only be <i>coaxed</i>. Your containment labs hold a seed sample in a magnetic cage, and new matter condenses out of the vacuum around it, a little more every hour, as if something on the other side is <i>feeding</i> it through.',
        'Every regular user reports the same thing eventually: a slow, patient knocking that comes from no particular direction. Three knocks, a pause, three knocks.',
        'Whoever left it here hasn’t come back to collect. <span class="redact">██████████</span> Yet.',
      ],
    },
  },
];

const LINES = LINE_INFO.map((l, i) => ({
  ...l,
  i,
  price: nice(2 * PRICE_STEP ** i * (l.potency || 1)),
  cookCost: nice(12 * COST_STEP ** i),
  dealCost: nice(15 * COST_STEP ** i),
  unlock: i === 0 ? 0 : nice(100 * COST_STEP ** i),
  heat: HEAT_BASE * HEAT_STEP ** i * (l.heatMult || 1),
}));
const N = LINES.length;

/* ---------- upgrades (one-time purchases) ---------- */
const UPGRADES = [];
LINES.forEach((l, i) => {
  UPGRADES.push({ id: l.id + '_c', group: 'line', line: i, name: l.upg[0], cost: nice(l.cookCost * 120), effect: { cook: 2 }, req: { cooks: 10 }, desc: `${l.cook}s work twice as fast.` });
  UPGRADES.push({ id: l.id + '_d', group: 'line', line: i, name: l.upg[1], cost: nice(l.dealCost * 120), effect: { deal: 2 }, req: { dealers: 10 }, desc: `${l.dealer}s sell twice as fast.` });
  UPGRADES.push({ id: l.id + '_p', group: 'line', line: i, name: l.upg[2], cost: nice(l.cookCost * 3000), effect: { price: 2 }, req: { cooks: 25, dealers: 25 }, desc: `${l.name} sells for twice the price.` });
  UPGRADES.push({ id: l.id + '_m', group: 'line', line: i, name: l.monopoly || `${l.name} Monopoly`, cost: nice(l.cookCost * 4e6), effect: { price: 3 }, req: { cooks: 100, dealers: 100 }, desc: `You own the ${l.name.toLowerCase()} market. Price ×3.` });
});
[
  // manual cooking
  { id: 'hands1', name: 'Steady Hands', cost: 50, effect: { clickFlat: 1 }, desc: '+1 batch per Cook click.' },
  { id: 'hands2', name: 'Work Gloves', cost: 600, effect: { clickFlat: 4 }, desc: '+4 batches per Cook click.' },
  { id: 'hands3', name: 'Hustle Mindset', cost: 9000, effect: { clickFlat: 20 }, desc: '+20 batches per Cook click.' },
  { id: 'pct1', name: 'Lead by Example', cost: 30000, effect: { clickPct: 0.1 }, desc: 'Cook clicks also add 10% of the line\'s automatic production per second.' },
  { id: 'pct2', name: 'Hands-On Boss', cost: 3e6, effect: { clickPct: 0.2 }, desc: 'Cook clicks add another 20% of production per second.' },
  { id: 'pct3', name: 'Workaholic', cost: 5e8, effect: { clickPct: 0.4 }, desc: 'Cook clicks add another 40% of production per second.' },
  { id: 'pct4', name: 'Obsessed', cost: 1e11, effect: { clickPct: 0.8 }, desc: 'Cook clicks add another 80% of production per second.' },
  { id: 'pct5', name: 'Legendary Hands', cost: 3e13, effect: { clickPct: 1.6 }, desc: 'Cook clicks add another 160% of production per second.' },
  // manual selling
  { id: 'sell1', name: 'Loud Mouth', cost: 200, effect: { sellMult: 2 }, desc: 'Sell clicks move twice as much.' },
  { id: 'fence', name: 'The Fence', cost: 15000, effect: { sellAll: 1 }, desc: 'Sell clicks clear the selected line\'s entire stock.' },
  // global speed
  { id: 'speed1', name: 'Shift Schedules', cost: 1.5e5, effect: { speed: 1.5 }, desc: 'All workers ×1.5 speed.', req: { lines: 3 } },
  { id: 'speed2', name: 'Staff Loyalty', cost: 6e7, effect: { speed: 1.5 }, desc: 'All workers ×1.5 speed.', req: { lines: 5 } },
  { id: 'speed3', name: 'Corporate Structure', cost: 3e10, effect: { speed: 1.5 }, desc: 'All workers ×1.5 speed.', req: { lines: 7 } },
  { id: 'speed4', name: 'Full Automation', cost: 2e13, effect: { speed: 2 }, desc: 'All workers ×2 speed.', req: { lines: 9 } },
  // global price
  { id: 'brand1', name: 'Brand Recognition', cost: 1e6, effect: { gprice: 1.5 }, desc: 'All products sell for ×1.5.', req: { lines: 4 } },
  { id: 'brand2', name: 'Street Legend', cost: 1e9, effect: { gprice: 1.5 }, desc: 'All products sell for ×1.5.', req: { lines: 6 } },
  { id: 'brand3', name: 'Household Name', cost: 1e12, effect: { gprice: 1.5 }, desc: 'All products sell for ×1.5.', req: { lines: 8 } },
  { id: 'brand4', name: 'Mythic Status', cost: 1e15, effect: { gprice: 2 }, desc: 'All products sell for ×2.', req: { lines: 11 } },
  // heat
  { id: 'heat1', name: 'Burner Phones', cost: 2500, effect: { heat: 0.85 }, desc: 'Heat builds 15% slower.', req: { lines: 2 } },
  { id: 'heat2', name: 'Encrypted Chats', cost: 2.5e5, effect: { heat: 0.8 }, desc: 'Heat builds 20% slower.', req: { lines: 3 } },
  { id: 'heat3', name: 'Lawyer on Retainer', cost: 2e7, effect: { heat: 0.75 }, desc: 'Heat builds 25% slower.', req: { lines: 5 } },
  { id: 'heat4', name: 'Inside Informant', cost: 4e9, effect: { heat: 0.7 }, desc: 'Heat builds 30% slower.', req: { lines: 7 } },
  { id: 'heat5', name: 'Judge in Your Pocket', cost: 8e11, effect: { heat: 0.65 }, desc: 'Heat builds 35% slower.', req: { lines: 9 } },
  { id: 'heat6', name: 'Friends in High Places', cost: 3e14, effect: { heat: 0.6 }, desc: 'Heat builds 40% slower.', req: { lines: 11 } },
  // briefcases, rush, bribes, offline
  { id: 'luck1', name: 'Lucky Charm', cost: 77777, effect: { briefFreq: 2 }, desc: 'Mystery briefcases show up twice as often.' },
  { id: 'luck2', name: 'Eagle Eye', cost: 7.7e7, effect: { briefLife: 2 }, desc: 'Briefcases stay on screen twice as long.' },
  { id: 'rush1', name: 'Energy Drinks', cost: 40000, effect: { rushDur: 2 }, desc: 'Rush Hour lasts twice as long.' },
  { id: 'rush2', name: 'Double Shifts', cost: 4e7, effect: { rushMult: 1.5 }, desc: 'Rush Hour is ×3 instead of ×2.' },
  { id: 'bribe1', name: 'Smooth Talker', cost: 1.5e6, effect: { bribe: 0.5 }, desc: 'Bribes cost half as much.' },
  { id: 'night1', name: 'Night Shift', cost: 5e6, effect: { offline: 2 }, desc: 'Offline earnings cap doubled to 16 hours.' },
].forEach(u => UPGRADES.push({ group: 'global', ...u }));
UPGRADES.forEach(u => { u.cost = nice(u.cost); });
const UPGRADE_BY_ID = Object.fromEntries(UPGRADES.map(u => [u.id, u]));

/* ---------- fronts (repeatable, cut heat, small price bonus) ---------- */
const FRONTS = [
  { id: 'laundromat', name: 'Laundromat', icon: '🧺', cost: 2000, cover: 1 },
  { id: 'carwash', name: 'Car Wash', icon: '🚗', cost: 30000, cover: 4 },
  { id: 'salon', name: 'Nail Salon', icon: '💅', cost: 4.5e5, cover: 15 },
  { id: 'restaurant', name: 'Family Restaurant', icon: '🍝', cost: 7e6, cover: 50 },
  { id: 'nightclub', name: 'Nightclub', icon: '🪩', cost: 1.1e8, cover: 170 },
  { id: 'casino', name: 'Casino', icon: '🎰', cost: 1.8e9, cover: 600 },
  { id: 'realestate', name: 'Real Estate Agency', icon: '🏢', cost: 3e10, cover: 2000 },
  { id: 'bank', name: 'Offshore Bank', icon: '🏦', cost: 5e11, cover: 7000 },
  { id: 'shipping', name: 'Shipping Company', icon: '🚢', cost: 9e12, cover: 25000 },
  { id: 'media', name: 'Media Empire', icon: '📺', cost: 1.5e14, cover: 90000 },
];
const FRONT_GROWTH = 1.2;

/* ---------- reputation perks (bought with reputation, kept forever) ---------- */
const PERKS = [
  { id: 'seed', name: 'Seed Money', cost: 3, desc: 'Start every run with $5,000.' },
  { id: 'crew', name: 'Loyal Crew', cost: 5, desc: 'Start every run with 10 Growers and 10 Corner Dealers.' },
  { id: 'contacts', name: 'Old Contacts', cost: 10, desc: 'Mushrooms and Hashish start unlocked.' },
  { id: 'hands', name: 'Muscle Memory', cost: 12, desc: 'Manual Cook and Sell clicks are 5× stronger.' },
  { id: 'discount', name: 'Bulk Discount', cost: 15, desc: 'All hires cost 10% less.' },
  { id: 'nightowl', name: 'Night Owl', cost: 15, desc: 'Offline earnings cap ×3.' },
  { id: 'ghost', name: 'Ghost Protocol', cost: 20, desc: 'Heat builds 30% slower.' },
  { id: 'lawyer', name: 'Lawyered Up', cost: 25, desc: 'Raids only take half as much.' },
  { id: 'luck', name: 'Golden Touch', cost: 30, desc: 'Briefcases appear twice as often.' },
  { id: 'headstart', name: 'Head Start', cost: 60, desc: 'Start every run with $10M and the first five lines unlocked.' },
  { id: 'aura', name: 'Kingpin Aura', cost: 100, desc: 'All sale prices ×1.5.' },
  { id: 'legend', name: 'Living Legend', cost: 300, desc: 'All workers ×2 speed.' },
  { id: 'myth', name: 'Myth', cost: 1000, desc: 'All sale prices ×3.' },
];
const PERK_BY_ID = Object.fromEntries(PERKS.map(p => [p.id, p]));

/* ---------- state ---------- */
function freshLine(i) {
  return { unlocked: i === 0, stock: 0, cooks: 0, dealers: 0, made: 0, sold: 0, earned: 0 };
}

function fresh(now = Date.now()) {
  return {
    v: SAVE_VERSION,
    cash: 0, lifetime: 0, runEarned: 0,
    runStart: now, created: now, last: now,
    selected: 0,
    lines: LINES.map((_, i) => freshLine(i)),
    upgrades: [], fronts: FRONTS.map(() => 0),
    heat: 0, raids: 0, bribes: 0, bribeReady: 0,
    rushEnd: 0, rushReady: 0,
    buffs: [],
    briefcases: 0,
    rep: 0, repSpent: 0, perks: [], prestiges: 0,
    achievements: [],
    stats: { cookClicks: 0, sellClicks: 0, bestIncome: 0, maxHeat: 0 },
    settings: { sound: true, particles: true, buy: 1 },
    events: [],
  };
}

// Applies perk starting bonuses to a fresh run.
function startRun(s) {
  const p = new Set(s.perks);
  if (p.has('seed')) s.cash += 5000;
  if (p.has('crew')) { s.lines[0].cooks += 10; s.lines[0].dealers += 10; }
  if (p.has('contacts')) { s.lines[1].unlocked = true; s.lines[2].unlocked = true; }
  if (p.has('headstart')) { s.cash += 1e7; for (let i = 0; i < 5; i++) s.lines[i].unlocked = true; }
  return s;
}

/* ---------- modifiers ---------- */
function activeBuffs(s, now) { return s.buffs.filter(b => b.end > now); }

function mods(s, now = Date.now()) {
  const m = {
    cook: Array(N).fill(1), deal: Array(N).fill(1), price: Array(N).fill(1),
    speed: 1, gprice: 1, heat: 1, clickFlat: 0, clickPct: 0, clickMult: 1,
    sellMult: 1, sellAll: false, briefFreq: 1, briefLife: 1, rushDur: 1, rushMult: 1,
    bribe: 1, offline: 1, discount: 1, raidLoss: 1,
  };
  for (const id of s.upgrades) {
    const u = UPGRADE_BY_ID[id];
    if (!u) continue;
    const e = u.effect;
    if (u.group === 'line') {
      if (e.cook) m.cook[u.line] *= e.cook;
      if (e.deal) m.deal[u.line] *= e.deal;
      if (e.price) m.price[u.line] *= e.price;
      continue;
    }
    for (const k of ['speed', 'gprice', 'heat', 'sellMult', 'briefFreq', 'briefLife', 'rushDur', 'rushMult', 'bribe', 'offline']) if (e[k]) m[k] *= e[k];
    if (e.clickFlat) m.clickFlat += e.clickFlat;
    if (e.clickPct) m.clickPct += e.clickPct;
    if (e.sellAll) m.sellAll = true;
  }
  const p = new Set(s.perks);
  if (p.has('hands')) m.clickMult *= 5;
  if (p.has('discount')) m.discount = 0.9;
  if (p.has('nightowl')) m.offline *= 3;
  if (p.has('ghost')) m.heat *= 0.7;
  if (p.has('lawyer')) m.raidLoss = 0.5;
  if (p.has('luck')) m.briefFreq *= 2;
  if (p.has('aura')) m.gprice *= 1.5;
  if (p.has('legend')) m.speed *= 2;
  if (p.has('myth')) m.gprice *= 3;

  // permanent multipliers
  const frontCount = s.fronts.reduce((a, b) => a + b, 0);
  m.gprice *= (1 + 0.02 * s.rep) * (1 + 0.01 * s.achievements.length) * (1 + 0.01 * frontCount);
  const cover = s.fronts.reduce((a, n, i) => a + n * FRONTS[i].cover, 0);
  m.cover = cover;
  m.heat *= 1 / (1 + cover / 10);

  // temporary buffs: rush hour, briefcase frenzies, hot markets
  if (now < s.rushEnd) m.speed *= 2 * m.rushMult;
  for (const b of activeBuffs(s, now)) {
    if (b.type === 'frenzy') m.speed *= b.mult;
    if (b.type === 'click') m.clickMult *= b.mult;
    if (b.type === 'demand') m.gprice *= b.mult;
    if (b.type === 'hot') m.price[b.line] *= b.mult;
  }
  return m;
}

const milestoneCount = n => MILESTONES.reduce((a, t) => a + (n >= t ? 1 : 0), 0);
const nextMilestone = n => MILESTONES.find(t => t > n) || null;

function cookRate(s, i, m) { return BASE_RATE * 2 ** milestoneCount(s.lines[i].cooks) * m.cook[i] * m.speed; }
function dealRate(s, i, m) { return BASE_RATE * 2 ** milestoneCount(s.lines[i].dealers) * m.deal[i] * m.speed; }
function makeCap(s, i, m) { return s.lines[i].cooks * cookRate(s, i, m); }
function sellCap(s, i, m) { return s.lines[i].dealers * dealRate(s, i, m); }
function price(s, i, m) { return LINES[i].price * m.price[i] * m.gprice; }

// Batches actually sold per second right now (limited by stock and production).
function actualSell(s, i, m) {
  const line = s.lines[i];
  if (!line.unlocked) return 0;
  const sc = sellCap(s, i, m);
  return line.stock > 1e-6 ? sc : Math.min(makeCap(s, i, m), sc);
}

function income(s, m) {
  let total = 0;
  for (let i = 0; i < N; i++) total += actualSell(s, i, m) * price(s, i, m);
  return total;
}

function lineHeat(i, soldPerSec) {
  return soldPerSec > 0 ? LINES[i].heat * (1 + Math.log10(1 + soldPerSec)) : 0;
}

function heatRate(s, m) {
  let h = 0;
  for (let i = 0; i < N; i++) h += lineHeat(i, actualSell(s, i, m));
  return h * m.heat;
}

/* ---------- costs ---------- */
function hireCost(s, i, role, count = 1, m = mods(s)) {
  const line = s.lines[i];
  const base = (role === 'cook' ? LINES[i].cookCost : LINES[i].dealCost) * m.discount;
  const owned = role === 'cook' ? line.cooks : line.dealers;
  return Math.ceil(base * GROWTH ** owned * (GROWTH ** count - 1) / (GROWTH - 1));
}

function maxAffordable(s, i, role, m = mods(s)) {
  const line = s.lines[i];
  const base = (role === 'cook' ? LINES[i].cookCost : LINES[i].dealCost) * m.discount;
  const owned = role === 'cook' ? line.cooks : line.dealers;
  const first = base * GROWTH ** owned;
  if (s.cash < first) return 0;
  let n = Math.floor(Math.log(s.cash * (GROWTH - 1) / first + 1) / Math.log(GROWTH));
  while (n > 0 && hireCost(s, i, role, n, m) > s.cash) n--;
  return n;
}

function frontCost(s, f) { return Math.ceil(FRONTS[f].cost * FRONT_GROWTH ** s.fronts[f]); }

function bribeCost(s, m = mods(s)) {
  return Math.ceil(Math.max(100, income(s, m) * 90 + s.cash * 0.05) * m.bribe);
}

/* ---------- requirements ---------- */
function unlockedCount(s) { return s.lines.filter(l => l.unlocked).length; }

function upgradeReqMet(s, u) {
  const r = u.req || {};
  if (u.group === 'line') {
    const l = s.lines[u.line];
    if (!l.unlocked) return false;
    if (r.cooks && l.cooks < r.cooks) return false;
    if (r.dealers && l.dealers < r.dealers) return false;
    return true;
  }
  if (r.lines && unlockedCount(s) < r.lines) return false;
  return s.lifetime >= u.cost * 0.25 || s.runEarned >= u.cost * 0.25;
}

/* ---------- actions (return true on success) ---------- */
function hire(s, i, role, count = 1, m = mods(s)) {
  const line = s.lines[i];
  if (!line || !line.unlocked || count < 1) return false;
  const c = hireCost(s, i, role, count, m);
  if (s.cash < c) return false;
  s.cash -= c;
  if (role === 'cook') line.cooks += count; else line.dealers += count;
  return true;
}

function unlockLine(s, i) {
  const line = s.lines[i];
  if (!line || line.unlocked || s.cash < LINES[i].unlock) return false;
  if (i > 0 && !s.lines[i - 1].unlocked) return false;
  s.cash -= LINES[i].unlock;
  line.unlocked = true;
  return true;
}

function buyUpgrade(s, id) {
  const u = UPGRADE_BY_ID[id];
  if (!u || s.upgrades.includes(id) || s.cash < u.cost || !upgradeReqMet(s, u)) return false;
  s.cash -= u.cost;
  s.upgrades.push(id);
  return true;
}

function buyFront(s, f) {
  if (!FRONTS[f]) return false;
  const c = frontCost(s, f);
  if (s.cash < c) return false;
  s.cash -= c;
  s.fronts[f]++;
  return true;
}

function buyPerk(s, id) {
  const p = PERK_BY_ID[id];
  if (!p || s.perks.includes(id) || s.rep - s.repSpent < p.cost) return false;
  s.repSpent += p.cost;
  s.perks.push(id);
  return true;
}

function addCash(s, n) { s.cash += n; s.lifetime += n; s.runEarned += n; }

function cookAmount(s, m = mods(s)) {
  return ((1 + m.clickFlat) + m.clickPct * makeCap(s, s.selected, m)) * m.clickMult;
}

function sellAmount(s, m = mods(s)) {
  const stock = s.lines[s.selected].stock;
  if (m.sellAll) return stock;
  return Math.min(stock, 3 * cookAmount(s, m) * m.sellMult);
}

function manualCook(s, m = mods(s)) {
  const n = cookAmount(s, m), line = s.lines[s.selected];
  line.stock += n; line.made += n;
  s.stats.cookClicks++;
  return n;
}

function manualSell(s, m = mods(s)) {
  const i = s.selected, line = s.lines[i];
  const n = sellAmount(s, m);
  if (n <= 0) return { n: 0, cash: 0 };
  line.stock = Math.max(0, line.stock - n);
  line.sold += n;
  const cash = n * price(s, i, m);
  line.earned += cash;
  addCash(s, cash);
  s.heat = Math.min(100, s.heat + LINES[i].heat * 0.3 * m.heat);
  s.stats.sellClicks++;
  return { n, cash };
}

function bribe(s, now = Date.now(), m = mods(s, now)) {
  const c = bribeCost(s, m);
  if (now < s.bribeReady || s.cash < c || s.heat < 1) return false;
  s.cash -= c;
  s.heat = Math.max(0, s.heat - 50);
  s.bribes++;
  s.bribeReady = now + 60000;
  return true;
}

function rush(s, now = Date.now(), m = mods(s, now)) {
  if (now < s.rushReady) return false;
  s.rushEnd = now + 30000 * m.rushDur;
  s.rushReady = now + 180000;
  return true;
}

// A raid takes a share of cash and stock and resets heat.
function raid(s, m = mods(s)) {
  const cashLost = s.cash * 0.25 * m.raidLoss;
  s.cash -= cashLost;
  let stockLost = 0;
  for (const l of s.lines) { const lost = l.stock * 0.5 * m.raidLoss; l.stock -= lost; stockLost += lost; }
  s.heat = RAID_RESET;
  s.raids++;
  return { cashLost, stockLost };
}

/*
 * Simulate `seconds` of automatic production and sales with fixed rates.
 * Exact for constant rates, so one long step equals many short ones.
 * opts.offline: heat is capped below raid level instead of triggering one.
 */
function advance(s, seconds, now = Date.now(), opts = {}) {
  if (!(seconds > 0)) return { earned: 0, raid: null };
  const m = mods(s, now);
  let earned = 0, heatGain = 0;
  for (let i = 0; i < N; i++) {
    const line = s.lines[i];
    if (!line.unlocked) continue;
    const made = makeCap(s, i, m) * seconds;
    const supply = line.stock + made;
    const sold = Math.min(supply, sellCap(s, i, m) * seconds);
    line.stock = Math.max(0, supply - sold);
    line.made += made;
    line.sold += sold;
    const cash = sold * price(s, i, m);
    line.earned += cash;
    earned += cash;
    heatGain += lineHeat(i, sold / seconds) * seconds;
  }
  addCash(s, earned);
  s.heat = Math.max(0, s.heat + heatGain * m.heat - HEAT_DECAY * seconds);
  s.stats.maxHeat = Math.max(s.stats.maxHeat, Math.min(100, s.heat));
  let raidResult = null;
  if (opts.offline) s.heat = Math.min(s.heat, 95);
  else if (s.heat >= 100) raidResult = raid(s, m);
  return { earned, raid: raidResult };
}

/* ---------- prestige ---------- */
const repFor = lifetime => Math.floor(10 * Math.cbrt(Math.max(0, lifetime) / 1e9));
function repGain(s) { return Math.max(0, repFor(s.lifetime) - s.rep); }
function lifetimeForRep(r) { return 1e9 * (r / 10) ** 3; }

function prestige(s, now = Date.now()) {
  const gain = repGain(s);
  if (gain < 1) return null;
  const keep = {
    rep: s.rep + gain, repSpent: s.repSpent, perks: s.perks, prestiges: s.prestiges + 1,
    lifetime: s.lifetime, achievements: s.achievements, settings: s.settings, stats: s.stats,
    raids: s.raids, bribes: s.bribes, briefcases: s.briefcases, created: s.created,
  };
  const n = Object.assign(fresh(now), keep);
  startRun(n);
  return { state: n, gain };
}

/* ---------- briefcases ---------- */
function briefcaseReward(s, m, rng = Math.random) {
  const pool = [
    { type: 'cash', w: 5 },
    { type: 'frenzy', w: 3 },
    { type: 'click', w: 2 },
    { type: 'demand', w: 2 },
  ];
  if (s.heat > 30) pool.push({ type: 'heat', w: 3 });
  const total = pool.reduce((a, p) => a + p.w, 0);
  let r = rng() * total;
  for (const p of pool) { r -= p.w; if (r <= 0) return p.type; }
  return 'cash';
}

function briefcaseCash(s, m) {
  return Math.min(s.cash * 0.2, income(s, m) * 900) + income(s, m) * 30 + 25;
}

/* ---------- achievements ---------- */
const fmtShort = n => {
  const units = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];
  let u = 0;
  while (n >= 1000 && u < units.length - 1) { n /= 1000; u++; }
  return (Math.round(n * 10) / 10) + units[u];
};

const ACHIEVEMENTS = [];
const ach = (id, name, desc, test, secret = false) => ACHIEVEMENTS.push({ id, name, desc, test, secret });
[[1, 'First Batch'], [100, 'Getting the Hang'], [1000, 'Carpal Tunnel'], [10000, 'Click Machine'], [50000, 'Human Factory']]
  .forEach(([n, name], k) => ach('click' + k, name, `Cook manually ${n.toLocaleString('en-US')} time${n > 1 ? 's' : ''}.`, s => s.stats.cookClicks >= n));
[[100, 'Pocket Money'], [1e4, 'Side Hustle'], [1e6, 'Millionaire'], [1e8, 'Big Fish'], [1e10, 'Shark'], [1e12, 'Trillionaire'], [1e14, 'Untouchable'], [1e16, 'Beyond Money']]
  .forEach(([n, name], k) => ach('earn' + k, name, `Earn $${fmtShort(n)} in total.`, s => s.lifetime >= n));
const LINE_ACH = ['Green Thumb', 'Spore Lord', 'Old School', 'Mind Bender', 'Party Starter', 'Down the Hole', 'Snow Storm', 'The One Who Knocks', 'Silk Road', 'Point of No Return', 'Star Child', 'First Contact'];
LINES.forEach((l, i) => i > 0 && ach('line' + i, LINE_ACH[i], `Unlock ${l.name}.`, s => s.lines[i].unlocked));
[[10, 'Small Crew'], [100, 'Organization'], [500, 'Syndicate'], [1500, 'Cartel'], [4000, 'Empire']]
  .forEach(([n, name], k) => ach('staff' + k, name, `Employ ${n.toLocaleString('en-US')} workers in total.`, s => s.lines.reduce((a, l) => a + l.cooks + l.dealers, 0) >= n));
ach('mile100', 'Centurion', 'Have 100 of one role on a single line.', s => s.lines.some(l => l.cooks >= 100 || l.dealers >= 100));
ach('mile250', 'Legion', 'Have 250 of one role on a single line.', s => s.lines.some(l => l.cooks >= 250 || l.dealers >= 250));
[[1, 'Clean Hands'], [25, 'Respectable Citizen'], [100, 'Pillar of the Community']]
  .forEach(([n, name], k) => ach('front' + k, name, `Own ${n} front business${n > 1 ? 'es' : ''}.`, s => s.fronts.reduce((a, b) => a + b, 0) >= n));
ach('raid1', 'Busted', 'Get raided.', s => s.raids >= 1);
ach('raid10', 'Frequent Flyer', 'Get raided 10 times.', s => s.raids >= 10);
ach('heat95', 'Close Call', 'Let heat climb past 95%.', s => s.stats.maxHeat >= 95);
ach('bribe1', 'Grease the Wheels', 'Pay your first bribe.', s => s.bribes >= 1);
[[1, 'Finders Keepers'], [10, 'Treasure Hunter'], [50, 'Briefcase Collector']]
  .forEach(([n, name], k) => ach('brief' + k, name, `Open ${n} mystery briefcase${n > 1 ? 's' : ''}.`, s => s.briefcases >= n));
[[1e3, 'Steady Income'], [1e6, 'Money Printer'], [1e9, 'Cash Flood'], [1e12, 'Tsunami']]
  .forEach(([n, name], k) => ach('inc' + k, name, `Reach $${fmtShort(n)} per second.`, s => s.stats.bestIncome >= n));
[[10, 'Investor'], [30, 'Strategist'], [UPGRADES.length, 'Fully Loaded']]
  .forEach(([n, name], k) => ach('upg' + k, name, `Buy ${n === UPGRADES.length ? 'every' : n} upgrade${n > 1 ? 's' : ''}.`, s => s.upgrades.length >= n));
[[1, 'Fresh Start'], [5, 'Serial Entrepreneur'], [15, 'Eternal Return']]
  .forEach(([n, name], k) => ach('pres' + k, name, `Retire ${n} time${n > 1 ? 's' : ''}.`, s => s.prestiges >= n));
ach('hoard', 'Hoarder', 'Hold 1M batches of a single product.', s => s.lines.some(l => l.stock >= 1e6));
ach('secret', 'Who\'s Asking?', 'Poke the logo until it talks back.', s => !!s.stats.secret, true);

function checkAchievements(s) {
  const have = new Set(s.achievements), got = [];
  for (const a of ACHIEVEMENTS) if (!have.has(a.id) && a.test(s)) { s.achievements.push(a.id); got.push(a); }
  return got;
}

/* ---------- validation & migration ---------- */
const isNum = x => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x < 1e300;

function valid(x) {
  if (!x || typeof x !== 'object' || x.v !== SAVE_VERSION) return false;
  for (const k of ['cash', 'lifetime', 'runEarned', 'heat', 'rep', 'repSpent', 'last']) if (!isNum(x[k])) return false;
  if (!Number.isInteger(x.selected) || x.selected < 0 || x.selected >= N) return false;
  if (!Array.isArray(x.lines) || x.lines.length !== N) return false;
  for (const l of x.lines) {
    if (!l || typeof l.unlocked !== 'boolean' || !isNum(l.stock)) return false;
    if (!Number.isInteger(l.cooks) || !Number.isInteger(l.dealers) || l.cooks < 0 || l.dealers < 0 || l.cooks > 5000 || l.dealers > 5000) return false;
  }
  if (!x.lines[0].unlocked || !x.lines[x.selected].unlocked) return false;
  if (!Array.isArray(x.upgrades) || new Set(x.upgrades).size !== x.upgrades.length || !x.upgrades.every(id => UPGRADE_BY_ID[id])) return false;
  if (!Array.isArray(x.fronts) || x.fronts.length !== FRONTS.length || !x.fronts.every(n => Number.isInteger(n) && n >= 0)) return false;
  if (!Array.isArray(x.perks) || !x.perks.every(id => PERK_BY_ID[id])) return false;
  if (x.repSpent > x.rep) return false;
  return true;
}

// Fill in any fields missing from older v3 saves, then validate.
function normalize(x) {
  if (!x || x.v !== SAVE_VERSION) return x;
  const d = fresh();
  for (const k of Object.keys(d)) if (x[k] === undefined) x[k] = d[k];
  x.stats = { ...d.stats, ...x.stats };
  x.settings = { ...d.settings, ...x.settings };
  if (Array.isArray(x.lines)) x.lines = x.lines.map((l, i) => ({ ...freshLine(i), ...l }));
  if (!Array.isArray(x.buffs)) x.buffs = [];
  if (!Array.isArray(x.events)) x.events = [];
  if (!Array.isArray(x.achievements)) x.achievements = [];
  x.achievements = x.achievements.filter(id => ACHIEVEMENTS.some(a => a.id === id));
  // The final product line used to be Ambrosia; its upgrades now belong to Dark Matter.
  if (Array.isArray(x.upgrades)) x.upgrades = x.upgrades.map(id => (typeof id === 'string' ? id.replace(/^ambrosia_/, 'darkmatter_') : id));
  return x;
}

/*
 * Convert a save from the original VICE (schema v2, 9 products, 4 worker tiers).
 * Cash, earnings and unlocks carry over by product name; staff and upgrades are
 * refunded at what they originally cost; reputation keeps its value (10% -> 2% each).
 */
const OLD = {
  names: ['Cannabis', 'Mushrooms', 'Hashish', 'LSD', 'MDMA', 'Cocaine', 'Ketamine', 'Methamphetamine', 'Heroin'],
  crew: [15, 100, 600, 2500, 10000, 45000, 180000, 750000, 3000000],
  makers: [15, 160, 1800, 24000], sellers: [15, 180, 2100, 28000],
  upgrades: { workbench: 50, ledger: 75, training: 200, dealer: 250, tools: 1500, sales: 1800, station: 3000, counter: 3500, supervisor: 15000, district: 18000, factory: 160000, wholesale: 190000, bench: 75000, orders: 90000 },
};

function migrate(x, now = Date.now()) {
  if (!x || typeof x !== 'object') return null;
  if (x.v === SAVE_VERSION) return normalize(x);
  if (x.v !== 2 || !Array.isArray(x.unlocked) || !Array.isArray(x.makers) || !Array.isArray(x.sellers)) return null;
  const s = fresh(now);
  const num = v => (isNum(v) ? v : 0);
  let refund = 0;
  for (let o = 0; o < 9; o++) {
    const scale = Math.max(1, OLD.crew[o] / 15);
    for (const [list, counts] of [[OLD.makers, x.makers[o]], [OLD.sellers, x.sellers[o]]]) {
      if (!Array.isArray(counts)) continue;
      counts.forEach((c, t) => { for (let k = 0; k < Math.min(c | 0, 1000); k++) refund += Math.ceil(list[t] * scale * 1.18 ** k); });
    }
    const ni = LINES.findIndex(l => l.name === OLD.names[o]);
    if (x.unlocked[o]) s.lines[ni].unlocked = true;
    s.lines[ni].stock = num(x.inventory && x.inventory[o]);
  }
  // keep unlocks contiguous: every line before the highest unlocked one is unlocked
  const top = s.lines.reduce((a, l, i) => (l.unlocked ? i : a), 0);
  for (let i = 0; i <= top; i++) s.lines[i].unlocked = true;
  for (const id of Array.isArray(x.upgrades) ? x.upgrades : []) refund += OLD.upgrades[id] || 0;
  s.cash = num(x.cash) + refund;
  s.lifetime = Math.max(num(x.lifetime), s.cash);
  s.runEarned = num(x.runEarned);
  s.rep = Math.floor(num(x.rep) * 5);
  s.stats.cookClicks = num(x.clicks);
  s.events = [{ text: 'Welcome to the new VICE. Your old staff and upgrades were refunded as cash.', time: now }];
  return s;
}

const VICE = {
  SAVE_VERSION, BASE_RATE, GROWTH, MILESTONES, HEAT_DECAY, MAX_OFFLINE, LINES, N, UPGRADES, UPGRADE_BY_ID, FRONTS, PERKS, PERK_BY_ID, ACHIEVEMENTS,
  nice, fresh, startRun, mods, activeBuffs, milestoneCount, nextMilestone, cookRate, dealRate, makeCap, sellCap, price, actualSell, income,
  lineHeat, heatRate, hireCost, maxAffordable, frontCost, bribeCost, unlockedCount, upgradeReqMet, hire, unlockLine, buyUpgrade, buyFront,
  buyPerk, addCash, cookAmount, sellAmount, manualCook, manualSell, bribe, rush, raid, advance, repFor, repGain, lifetimeForRep, prestige,
  briefcaseReward, briefcaseCash, checkAchievements, valid, normalize, migrate,
};
if (typeof module !== 'undefined') module.exports = VICE;
