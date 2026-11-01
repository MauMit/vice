// Economy invariants for VICE. Run: node tests/economy.cjs
const assert = require('node:assert/strict');
const E = require('../engine.js');
const near = (a, b, msg) => assert(Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b)), `${msg}: ${a} vs ${b}`);
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('  ✓ ' + name); };

test('cooks make stock but never cash', () => {
  const s = E.fresh(0); s.lines[0].cooks = 2;
  E.advance(s, 10, 0);
  near(s.lines[0].stock, 10, 'stock');
  assert.equal(s.cash, 0);
});

test('sales are limited by stock plus production', () => {
  const s = E.fresh(0); s.lines[0].cooks = 2; s.lines[0].stock = 10; s.lines[0].dealers = 4;
  E.advance(s, 20, 0); // supply 10 + 20, capacity 40
  assert.equal(s.lines[0].stock, 0);
  near(s.cash, 30 * E.LINES[0].price, 'cash');
});

test('dealers with no stock earn nothing', () => {
  const s = E.fresh(0); s.lines[0].dealers = 50;
  E.advance(s, 3600, 0, { offline: true });
  assert.equal(s.cash, 0);
});

test('hire costs escalate and bulk cost equals the sum of singles', () => {
  const s = E.fresh(0); s.cash = 1e12;
  const single = [];
  const t = structuredClone(s);
  for (let k = 0; k < 10; k++) { single.push(E.hireCost(t, 0, 'cook')); E.hire(t, 0, 'cook'); }
  for (let k = 1; k < 10; k++) assert(single[k] > single[k - 1]);
  const bulk = E.hireCost(s, 0, 'cook', 10);
  assert(Math.abs(bulk - single.reduce((a, b) => a + b, 0)) <= 10, 'bulk ≈ sum');
});

test('max affordable never overspends', () => {
  for (const cash of [0, 11, 12, 100, 12345, 9.9e9]) {
    const s = E.fresh(0); s.cash = cash; s.lines[0].cooks = 7;
    const n = E.maxAffordable(s, 0, 'cook');
    if (n > 0) assert(E.hireCost(s, 0, 'cook', n) <= cash);
    assert(E.hireCost(s, 0, 'cook', n + 1) > cash);
  }
});

test('upgrades need their requirement and can only be bought once', () => {
  const s = E.fresh(0); s.cash = 1e9;
  assert.equal(E.buyUpgrade(s, 'cannabis_c'), false, 'needs 10 growers');
  s.lines[0].cooks = 10;
  assert(E.buyUpgrade(s, 'cannabis_c'));
  const cash = s.cash;
  assert.equal(E.buyUpgrade(s, 'cannabis_c'), false);
  assert.equal(s.cash, cash, 'failed purchase costs nothing');
  assert.equal(new Set(s.upgrades).size, s.upgrades.length);
});

test('line upgrades only affect their own line', () => {
  const s = E.fresh(0);
  s.lines[1].unlocked = true; s.lines[0].cooks = 10; s.upgrades.push('cannabis_c');
  const m = E.mods(s, 0);
  assert.equal(E.cookRate(s, 0, m), E.BASE_RATE * 2);
  assert.equal(E.cookRate(s, 1, m), E.BASE_RATE);
});

test('milestones double a role\'s speed', () => {
  const s = E.fresh(0);
  s.lines[0].cooks = 24; const a = E.cookRate(s, 0, E.mods(s, 0));
  s.lines[0].cooks = 25; const b = E.cookRate(s, 0, E.mods(s, 0));
  assert.equal(b, a * 2);
});

test('one long step equals many short steps', () => {
  const a = E.fresh(0), b = E.fresh(0);
  for (const x of [a, b]) { x.lines[0].cooks = 30; x.lines[0].dealers = 20; x.lines[1].unlocked = true; x.lines[1].cooks = 5; x.lines[1].dealers = 9; }
  E.advance(a, 3600, 0, { offline: true });
  for (let k = 0; k < 3600; k++) E.advance(b, 1, 0, { offline: true });
  near(a.cash, b.cash, 'cash');
  near(a.lines[0].stock, b.lines[0].stock, 'stock');
});

test('stock never goes negative', () => {
  const s = E.fresh(0); s.cash = 1e9; s.lines[0].stock = 3.7; s.upgrades.push('fence');
  E.manualSell(s); assert.equal(s.lines[0].stock, 0);
  E.manualSell(s); assert.equal(s.lines[0].stock, 0);
  s.lines[0].dealers = 100; E.advance(s, 100, 0);
  assert(s.lines.every(l => l.stock >= 0));
});

test('heat over 100 triggers a raid online but never offline', () => {
  const s = E.fresh(0); s.cash = 1000; s.lines[6].stock = 100; s.heat = 99.99;
  s.lines[6].unlocked = true; s.lines[6].cooks = 50; s.lines[6].dealers = 50; // cocaine runs hot
  const r = E.advance(s, 10, 0);
  assert(r.raid, 'raid happened');
  near(s.cash, (1000 + r.earned) * 0.75, 'raid takes 25% of cash');
  assert.equal(s.heat, 20);
  assert.equal(s.raids, 1);
  const o = E.fresh(0); o.heat = 99; o.lines[6].unlocked = true; o.lines[6].cooks = 50; o.lines[6].dealers = 50;
  const ro = E.advance(o, 3600, 0, { offline: true });
  assert.equal(ro.raid, null);
  assert(o.heat <= 95);
});

test('fronts reduce heat gain', () => {
  const s = E.fresh(0); s.lines[0].cooks = 50; s.lines[0].dealers = 50;
  const before = E.heatRate(s, E.mods(s, 0));
  s.fronts[0] = 10;
  const after = E.heatRate(s, E.mods(s, 0));
  near(after, before / 2, 'cover 10 halves heat');
});

test('retiring grants reputation, keeps perks and resets the run', () => {
  const s = E.fresh(0); s.lifetime = 8e9; s.runEarned = 8e9; s.cash = 5e9; s.upgrades.push('hands1'); s.lines[3].unlocked = true;
  assert.equal(E.repGain(s), 20);
  const { state, gain } = E.prestige(s, 0);
  assert.equal(gain, 20);
  assert.equal(state.rep, 20);
  assert.equal(state.cash, 0);
  assert.deepEqual(state.upgrades, []);
  assert.equal(state.lines[3].unlocked, false);
  assert.equal(state.lifetime, 8e9);
  assert.equal(E.prestige(state, 0), null, 'no double retire');
  assert(E.buyPerk(state, 'contacts'));
  assert.equal(E.buyPerk(state, 'contacts'), false, 'perks are one-time');
  const next = E.prestige(Object.assign(state, { lifetime: 64e9 }), 0).state;
  assert(next.lines[1].unlocked && next.lines[2].unlocked, 'Old Contacts unlocks lines');
  assert(E.valid(next));
});

test('saves validate and reject tampering', () => {
  const s = E.fresh();
  assert(E.valid(s));
  assert(E.valid(JSON.parse(JSON.stringify(s))));
  assert(!E.valid({ ...s, cash: -1 }));
  assert(!E.valid({ ...s, upgrades: ['hands1', 'hands1'] }));
  assert(!E.valid({ ...s, upgrades: ['nope'] }));
  assert(!E.valid({ ...s, repSpent: 5 }));
});

test('older v3 saves missing new fields are filled in', () => {
  const s = JSON.parse(JSON.stringify(E.fresh()));
  delete s.stats.maxHeat; delete s.buffs; delete s.settings.particles;
  const m = E.migrate(s);
  assert(E.valid(m));
  assert.equal(m.settings.particles, true);
});

test('original VICE (v2) saves convert with refunds', () => {
  const old = {
    v: 2, cash: 500, lifetime: 20000, runEarned: 20000, clicks: 77, selected: 1, rep: 2, boostEnd: 0, boostReady: 0, last: 0,
    unlocked: [true, true, false, false, false, true, false, false, false],
    inventory: [5, 6, 0, 0, 0, 0, 0, 0, 0],
    makers: Array.from({ length: 9 }, (_, i) => (i === 0 ? [2, 0, 0, 0] : [0, 0, 0, 0])),
    sellers: Array.from({ length: 9 }, () => [0, 0, 0, 0]),
    upgrades: ['workbench'], events: [],
  };
  const s = E.migrate(old, 0);
  assert(E.valid(s));
  assert.equal(s.cash, 500 + 15 + 18 + 50); // two makers (15, 18) + workbench (50)
  assert.equal(s.rep, 10);
  assert(s.lines[6].unlocked, 'old Cocaine maps to new Cocaine');
  assert(s.lines.slice(0, 7).every(l => l.unlocked), 'unlocks are contiguous');
  assert.equal(s.lines[1].stock, 6);
  assert.equal(E.migrate({ v: 1 }), null);
});

test('every upgrade, front and perk has sane data', () => {
  assert.equal(new Set(E.UPGRADES.map(u => u.id)).size, E.UPGRADES.length);
  assert(E.UPGRADES.every(u => u.cost > 0 && u.name && u.desc));
  assert(E.FRONTS.every((f, i) => i === 0 || f.cost > E.FRONTS[i - 1].cost));
  assert.equal(new Set(E.ACHIEVEMENTS.map(a => a.id)).size, E.ACHIEVEMENTS.length);
  for (let i = 1; i < E.N; i++) assert(E.LINES[i].unlock > E.LINES[i - 1].unlock && E.LINES[i].price > E.LINES[i - 1].price);
});

test('saves from before Dark Matter keep their final-line upgrades', () => {
  const s = JSON.parse(JSON.stringify(E.fresh()));
  s.upgrades = ['ambrosia_c', 'hands1'];
  const m = E.migrate(s);
  assert(E.valid(m));
  assert.deepEqual(m.upgrades, ['darkmatter_c', 'hands1']);
  assert.equal(E.LINES[E.N - 1].name, 'Dark Matter');
  assert(E.LINES[E.N - 1].heat > E.LINES[E.N - 2].heat * 3, 'Dark Matter runs extra hot');
});

console.log(`\nAll ${passed} tests passed.`);
