// Tests for the half-season pick planner. Run with: node test/planner.test.mjs
import assert from 'node:assert/strict';
import rules from '../public/js/rules.js';
globalThis.window = { FFWBRules: rules };
await import('../public/js/planner.js');
const P = globalThis.window.FFWBPlanner;
let passed = 0;
const t = (name, fn) => { fn(); passed += 1; console.log('ok  ' + name); };
const clubs = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T'];
// A player who has picked weeks 1-16 using only some clubs, so others are owed late in the half.
function season(currentWeek, picks, fixtures = {}) {
  return { config: { clubs, currentWeek, players: [{ id: 'x', name: 'X' }] }, picks: { x: picks }, results: {}, fixtures };
}
const fill = (weeks, rot) => Object.fromEntries(weeks.map((w, i) => { const c = rot(i); return [w, { standard: c.slice(0, 4), lock: c[4] }]; }));

t('plenty of room is on track', () => {
  // Seven weeks of picks spread across all 20 clubs: 35 picks, 25 still owed, 60 left.
  const picks = fill([1, 2, 3, 4, 5, 6, 7], (i) => [0, 1, 2, 3, 4].map((k) => clubs[(i * 5 + k) % 20]));
  const p = P.plan(season(8, picks), 'x', 8, null);
  assert.equal(p.level, 'ok');
  assert.equal(p.left.length, 12);
  assert.equal(p.owed, 25);
  assert.equal(p.slots, 60);
  // Nothing picked at all by week 8 leaves no room to spare.
  assert.equal(P.plan(season(8, {}), 'x', 8, null).level, 'tight');
});
t('a club that must be picked every week from now on is tight', () => {
  // Weeks 1-16 cover every club 3 times except T (twice owed... make T 0).
  const pool = clubs.filter((c) => c !== 'T');
  const picks = fill(Array.from({ length: 16 }, (_, i) => i + 1), (i) => [0, 1, 2, 3, 4].map((k) => pool[(i * 5 + k) % pool.length]));
  const s = season(17, picks);
  const p = P.plan(s, 'x', 17, null);
  assert.equal(p.left.length, 3);
  assert.equal(p.clubs.find((c) => c.club === 'T').need, 3);
  assert.equal(p.level, 'tight');
  assert.match(p.text, /T must be picked every week/);
});
t('a club owed more than the weeks left is flagged', () => {
  const pool = clubs.filter((c) => c !== 'T');
  const picks = fill(Array.from({ length: 17 }, (_, i) => i + 1), (i) => [0, 1, 2, 3, 4].map((k) => pool[(i * 5 + k) % pool.length]));
  const p = P.plan(season(18, picks), 'x', 18, null);
  assert.equal(p.level, 'bad');
  assert.match(p.text, /T needs 3 more and only 2 weeks are left/);
});
t('a clash is flagged only when two owed clubs must share weeks', () => {
  const pool = clubs.filter((c) => c !== 'S' && c !== 'T');
  const picks = fill(Array.from({ length: 16 }, (_, i) => i + 1), (i) => [0, 1, 2, 3, 4].map((k) => pool[(i * 5 + k) % pool.length]));
  const fx = { 18: { games: { S: { vs: 'T', home: true }, T: { vs: 'S', home: false } } } };
  const p = P.plan(season(17, picks, fx), 'x', 17, null);
  assert.equal(p.clashes.length, 1);
  assert.deepEqual(p.clashes[0], { week: 18, a: 'S', b: 'T' });
  // Early in the half, the same fixture is no worry.
  const early = P.plan(season(8, {}, { 9: fx[18] }), 'x', 8, null);
  assert.equal(early.clashes.length, 0);
});
console.log(passed + ' tests passed');
