// Tests for the weekly awards and the reveal. Run with: node test/awards.test.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const A = require('../public/js/awards.js');

const clubs = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
const season = {
  config: { players: [{ id: 'p1', name: 'Paul' }, { id: 'p2', name: 'Greg' }, { id: 'p3', name: 'Tim' }], clubs },
  results: { 1: { A: 1, B: 1, C: 0, D: 0.5, E: 1, F: 0, G: 1, H: 0 } },
  eflResults: {},
  picks: {
    p1: { 1: { standard: ['A', 'B', 'D', 'E'], lock: 'G' } }, // 1+1+.5+1+2 = 5.5
    p2: { 1: { standard: ['A', 'B', 'D', 'F'], lock: 'C' } }, // 1+1+.5+0+0 = 2.5, lost lock
    p3: { 1: { standard: ['A', 'B', 'D', 'H'], lock: 'F' } }, // 1+1+.5+0+0 = 2.5, lost lock
  },
};
let passed = 0;
const t = (name, fn) => { fn(); passed += 1; console.log('ok  ' + name); };

t('awards for a final week', () => {
  const a = A.week(season, 1);
  assert.deepEqual(a.top.names, ['Paul']);
  assert.equal(a.top.points, 5.5);
  assert.deepEqual(a.worst.names, ['Greg', 'Tim']);
  assert.equal(a.bottled.count, 2);
  assert.deepEqual(a.bottled.names, ['Greg', 'Tim'], 'both lost locks and scored least');
  assert.deepEqual(a.lone.names, ['Paul'], 'E and G won and only Paul had them');
  assert.deepEqual(a.lone.clubs[0], ['E', 'G']);
  assert.equal(A.lines(a).length, 4);
});

t('no awards while a week is still being played', () => {
  const s = structuredClone(season);
  delete s.results['1'].H;
  assert.equal(A.week(s, 1), null);
});

t('season tally', () => {
  const { tally } = A.season(season);
  assert.equal(tally.p1.top, 1);
  assert.equal(tally.p2.bottled, 1);
  assert.equal(tally.p3.worst, 1);
});

t('the reveal', () => {
  const r = A.reveal(season, 1, () => []);
  assert.equal(r.players, 3);
  assert.deepEqual(r.unanimous, ['A', 'B', 'D']);
  assert.equal(r.clubs[0].n, 3);
  assert.ok(r.contrarians[0].name === 'Paul', 'Paul had two picks nobody else made');
});

console.log(passed + ' tests passed');
