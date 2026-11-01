// Balance simulator: a greedy bot plays VICE and logs when it reaches each line.
// Usage: node tests/simulate.cjs [hours] [clicksPerSec]
const E = require('../engine.js');
const hours = Number(process.argv[2] || 6), cps = Number(process.argv[3] || 4);
let s = E.fresh(0);
const fmt = n => (n < 1000 ? n.toFixed(0) : n.toExponential(2));
const clock = t => `${Math.floor(t / 3600)}h${String(Math.floor(t / 60) % 60).padStart(2, '0')}m`;
const seen = new Set();
let fronts = 0;

function candidates(m) {
  const out = [];
  const inc0 = E.income(s, m) + 1e-9;
  const value = (apply) => {
    const c = structuredClone(s); apply(c); const mm = E.mods(c, 0);
    // a line with no stock sells min(make, sell); value the steady-state flow
    let v = 0; for (let i = 0; i < E.N; i++) if (c.lines[i].unlocked) v += Math.min(E.makeCap(c, i, mm), E.sellCap(c, i, mm)) * E.price(c, i, mm);
    return v;
  };
  const base = value(() => {});
  for (let i = 0; i < E.N; i++) {
    const l = s.lines[i];
    if (!l.unlocked) {
      if (i > 0 && s.lines[i - 1].unlocked) out.push({ kind: 'unlock', i, cost: E.LINES[i].unlock, gain: base * 0.6 + 1 });
      continue;
    }
    const mk = E.makeCap(s, i, m), sl = E.sellCap(s, i, m);
    const roles = mk < sl ? ['cook'] : sl < mk ? ['deal'] : ['cook', 'deal'];
    const cost = roles.reduce((a, r) => a + E.hireCost(s, i, r, 1, m), 0);
    const gain = value(c => { for (const r of roles) if (r === 'cook') c.lines[i].cooks++; else c.lines[i].dealers++; }) - base;
    out.push({ kind: 'hire', i, roles, cost, gain });
  }
  for (const u of E.UPGRADES) {
    if (s.upgrades.includes(u.id) || !E.upgradeReqMet(s, u)) continue;
    let gain = value(c => c.upgrades.push(u.id)) - base;
    if (gain <= 0) gain = u.cost < inc0 * 120 ? inc0 * 0.05 : 0; // utility upgrades: buy when cheap
    if (gain > 0) out.push({ kind: 'upgrade', id: u.id, cost: u.cost, gain });
  }
  for (const c of out) c.score = c.cost / c.gain + Math.max(0, c.cost - s.cash) / inc0;
  return out.sort((a, b) => a.score - b.score);
}

const T = hours * 3600;
let manualUntil = 1800; // active clicking for the first 30 minutes
for (let t = 0; t < T; t++) {
  const m = E.mods(s, t * 1000);
  if (t < manualUntil) {
    for (let k = 0; k < cps; k++) E.manualCook(s, m);
    for (let k = 0; k < Math.ceil(cps / 2); k++) E.manualSell(s, m);
  }
  const r = E.advance(s, 1, t * 1000);
  if (r.raid) console.log(`${clock(t)} RAID lost $${fmt(r.raid.cashLost)}`);
  // heat management
  const hr = E.heatRate(s, m);
  if (!process.env.NOBRIBE && s.heat > 80) E.bribe(s, t * 1000, m);
  if (!process.env.NOFRONTS && hr > E.HEAT_DECAY * 0.9) {
    let best = -1, bestV = 0;
    E.FRONTS.forEach((f, k) => { const v = f.cover / E.frontCost(s, k); if (v > bestV && E.frontCost(s, k) <= s.cash) { bestV = v; best = k; } });
    if (best >= 0 && E.frontCost(s, best) < s.cash * 0.5) { E.buyFront(s, best); fronts++; }
  }
  // purchases
  for (let guard = 0; guard < 50; guard++) {
    const mm = E.mods(s, t * 1000);
    const c = candidates(mm)[0];
    if (!c || c.cost > s.cash) break;
    if (c.kind === 'unlock') E.unlockLine(s, c.i);
    else if (c.kind === 'hire') c.roles.forEach(r => E.hire(s, c.i, r, 1, mm));
    else E.buyUpgrade(s, c.id);
  }
  s.stats.bestIncome = Math.max(s.stats.bestIncome, E.income(s, E.mods(s, t * 1000)));
  E.checkAchievements(s);
  s.lines.forEach((l, i) => { if (l.unlocked && !seen.has(i)) { seen.add(i); console.log(`${clock(t)} unlocked ${E.LINES[i].name.padEnd(16)} lifetime $${fmt(s.lifetime)} income $${fmt(E.income(s, m))}/s heat ${s.heat.toFixed(0)} rate ${hr.toFixed(2)}`); } });
  if (t % 1800 === 0 && t) console.log(`${clock(t)} .. income $${fmt(E.income(s, m))}/s lifetime $${fmt(s.lifetime)} heat ${s.heat.toFixed(0)} (+${hr.toFixed(2)}/s) fronts ${fronts} upg ${s.upgrades.length} ach ${s.achievements.length} rep ${E.repFor(s.lifetime)} staff ${s.lines.map(l => l.cooks + '/' + l.dealers).filter(x => x !== '0/0').join(' ')}`);
}
console.log(`END raids ${s.raids} bribes ${s.bribes} rep available ${E.repGain(s)}`);
