// Tests for the league money. Run with: node test/money.test.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const M = require('../public/js/money.js');

const clubs = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
const players = [{ id: 'paul', name: 'Paul' }, { id: 'greg', name: 'Greg' }, { id: 'aronson', name: 'Aronson' }];
const win = (list) => Object.fromEntries(clubs.map((c) => [c, list.includes(c) ? 1 : 0]));
const season = {
  config: { players, clubs },
  eflResults: {},
  results: { 1: win(['A', 'B', 'C', 'D', 'E']), 2: win(['F', 'G']), 20: win(['A', 'B', 'C', 'D', 'E']) },
  picks: {
    paul: { 1: { standard: ['A', 'B', 'C', 'D'], lock: 'E' }, 2: { standard: ['A', 'B', 'C', 'D'], lock: 'F' }, 20: { standard: ['F', 'G', 'H', 'I'], lock: 'A' } },
    greg: { 1: { standard: ['F', 'G', 'H', 'I'], lock: 'J' }, 2: { standard: ['F', 'G', 'H', 'I'], lock: 'J' }, 20: { standard: ['A', 'B', 'C', 'D'], lock: 'E' } },
    aronson: { 1: { standard: ['A', 'B', 'C', 'D'], lock: 'J' }, 20: { standard: ['A', 'B', 'C', 'J'], lock: 'D' } },
  },
};
let passed = 0;
const t = (name, fn) => { fn(); passed += 1; console.log('ok  ' + name); };

t('greenouts pay $5, picks pay $10 less $5 a missed week, the rest is the pot', () => {
  const m = M.compute(season);
  assert.deepEqual(m.greenouts.map((g) => g.name + ' ' + g.week), ['Paul 1', 'Greg 20']);
  const by = Object.fromEntries(m.players.map((p) => [p.id, p]));
  assert.equal(by.paul.greenoutMoney, 5);
  assert.equal(by.aronson.picksMoney, 5, 'Aronson missed week 2');
  assert.deepEqual(by.aronson.missed, [2]);
  assert.equal(by.paul.picksMoney, 10);
  assert.equal(m.pot, 570 - 10 - 25);
});

t('the pot is split 25 / 50 / 25 between the half champions and the second half runner-up', () => {
  const m = M.compute(season);
  const [first, second, runner] = m.prizes;
  assert.equal(first.amount, 535 * 0.25);
  assert.equal(second.amount, 535 * 0.5);
  assert.equal(runner.amount, 535 * 0.25);
  assert.deepEqual(first.winners.map((w) => w.name), ['Paul'], 'Paul leads the first half on 7 points');
  assert.deepEqual(second.winners.map((w) => w.name), ['Greg'], 'Greg won week 20 with a greenout');
  assert.deepEqual(runner.winners.map((w) => w.name), ['Aronson']);
});

t('a tie shares the money for the places it covers', () => {
  const s = structuredClone(season);
  s.picks.paul['20'] = structuredClone(s.picks.greg['20']);
  const m = M.compute(s);
  const second = m.prizes[1];
  assert.equal(second.winners.length, 2);
  assert.ok(m.prizes[2].sharedWithTop);
  for (const w of second.winners) assert.equal(w.amount, (m.pot * 0.75) / 2);
});

t('the commissioner can change the figures and make adjustments', () => {
  const s = structuredClone(season);
  s.config.money = { fund: 600, greenout: 10, split: { first: 30, second: 40, runnerUp: 30 } };
  s.config.moneyAdjust = { aronson: { amount: 5, note: 'Week 2 was a site problem' } };
  const m = M.compute(s);
  assert.equal(m.fund, 600);
  assert.equal(m.greenoutTotal, 20);
  assert.equal(m.pot, 600 - 20 - 25 - 5);
  assert.equal(m.players.find((p) => p.id === 'aronson').note, 'Week 2 was a site problem');
});

console.log(passed + ' tests passed');
