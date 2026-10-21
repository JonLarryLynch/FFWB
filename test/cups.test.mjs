// Tests for the cups. Run with: node test/cups.test.mjs
import assert from 'node:assert/strict';
import cups from '../public/js/cups.js';
import { createHandler } from '../netlify/lib/handler.mjs';
import { memoryStore } from './memory-store.mjs';

let passed = 0;
const t = async (name, fn) => { await fn(); passed += 1; console.log('ok  ' + name); };

await t('seeding puts 1 against the lowest seed and keeps 1 and 2 apart until the final', async () => {
  const o = cups.seedOrder(16);
  assert.deepEqual(o.slice(0, 2), [1, 16]);
  assert.ok(o.indexOf(1) < 8 && o.indexOf(2) >= 8);
  assert.equal(cups.roundsFor(15), 4);
});

// A tiny season to check the tiebreaks.
const clubs = ['A', 'B', 'C', 'D', 'E', 'F'];
const mini = (picks, res) => ({ config: { players: [{ id: 'x', name: 'X' }, { id: 'y', name: 'Y' }], clubs }, picks, results: { 1: res }, eflResults: {} });
const all = (v) => Object.fromEntries(clubs.map((c) => [c, v]));
const cup = { id: 'c', type: 'league', weeks: [1], seeds: ['x', 'y'], overrides: {} };

await t('a level game goes to wins, then the lock, then the higher seed', async () => {
  // Same points (2): X has 2 wins, Y has 1 win + lock draw... X: A win, B win, lock C loss = 2 pts, 2 wins. Y: lock D win = 2 pts, 1 win.
  let s = mini({ x: { 1: { standard: ['A', 'B'], lock: 'C' } }, y: { 1: { standard: ['E', 'F'], lock: 'D' } } }, { ...all(0), A: 1, B: 1, D: 1 });
  let m = cups.bracket(s, cup).rounds[0].matches[0];
  assert.equal(m.winner, 'x');
  assert.match(m.how, /winning picks/);
  // Same points and wins, better lock: X lock win (2) vs Y two wins + nothing... make both 2 pts, 1 win.
  s = mini({ x: { 1: { standard: ['A', 'B'], lock: 'C' } }, y: { 1: { standard: ['D', 'E'], lock: 'F' } } }, { ...all(0), C: 1, D: 1, E: 0.5, F: 0.5 });
  // X: lock C win = 2 pts, 1 win. Y: D 1 + E .5 + lock F draw 1 = 2.5. Adjust: E loss.
  s.results[1].E = 0; s.results[1].F = 0.5;
  // Y: D 1 + lock F draw 1 = 2 pts, 1 win, lock 1. X: lock 2.
  m = cups.bracket(s, cup).rounds[0].matches[0];
  assert.equal(m.winner, 'x');
  assert.match(m.how, /lock/);
  s = mini({ x: { 1: { standard: ['A', 'B'], lock: 'C' } }, y: { 1: { standard: ['D', 'E'], lock: 'F' } } }, all(0));
  m = cups.bracket(s, cup).rounds[0].matches[0];
  assert.equal(m.winner, 'x', 'dead level goes to seed 1');
  assert.match(m.how, /higher seed/);
  // Not decided while a game is postponed.
  s.results[1].A = 'P';
  assert.equal(cups.bracket(s, cup).rounds[0].matches[0].winner, null);
});

function setup() {
  const store = memoryStore();
  const sent = [];
  const sender = { sendNotification: async (sub, payload) => { sent.push({ to: sub.endpoint, msg: JSON.parse(payload) }); } };
  const api = createHandler(() => store, 'p', { pushSender: sender });
  const post = async (path, body) => { const r = await api(new Request('https://x.test/api/' + path, { method: 'POST', body: JSON.stringify(body) })); return { status: r.status, body: await r.json() }; };
  const get = async () => (await api(new Request('https://x.test/api/season'))).json();
  return { store, sent, post, get };
}

await t('the commissioner draws a League Cup seeded from the table, top of the table gets the bye', async () => {
  const { post, get, sent } = setup();
  await post('push/subscribe', { subscription: { endpoint: 'https://push.example/basler', keys: { p256dh: 'p', auth: 'a' } }, player: 'basler' });
  await post('push/subscribe', { subscription: { endpoint: 'https://push.example/tim', keys: { p256dh: 'p', auth: 'a' } }, player: 'tim' });
  const prev = await post('admin/cups', { passcode: 'p', action: 'preview', type: 'league', firstWeek: 8 });
  assert.deepEqual(prev.body.weeks, [8, 9, 10, 11]);
  assert.equal(prev.body.seeds[0], 'Basler');
  const made = await post('admin/cups', { passcode: 'p', action: 'create', type: 'league', firstWeek: 8 });
  assert.equal(made.status, 200, JSON.stringify(made.body));
  assert.equal((await post('admin/cups', { passcode: 'p', action: 'create', type: 'league', firstWeek: 8 })).status, 400, 'one League Cup a season');
  const s = await get();
  const st = cups.state(s, s.cups[0]);
  const r0 = st.bracket.rounds[0];
  assert.equal(r0.name, 'First round');
  assert.equal(r0.matches.filter((m) => m.bye).length, 1);
  assert.equal(r0.matches.find((m) => m.bye).a.name, 'Basler');
  assert.equal(st.bracket.rounds[3].name, 'Final');
  assert.ok(sent.some((x) => x.to.endsWith('/basler') && /bye/.test(x.msg.body)));
  assert.ok(sent.some((x) => x.to.endsWith('/tim') && /You play Michael in week 8/.test(x.msg.body)), JSON.stringify(sent));
});

await t('results move winners on, a round can be pushed back, and the commissioner can override', async () => {
  const { post, get, sent } = setup();
  await post('admin/cups', { passcode: 'p', action: 'create', type: 'league', firstWeek: 8 });
  await post('push/subscribe', { subscription: { endpoint: 'https://push.example/tim', keys: { p256dh: 'p', auth: 'a' } }, player: 'tim' });
  let s = await get();
  const clubs8 = s.config.clubs;
  // Everyone picks; Tim's clubs all win, so Tim beats Michael.
  for (const p of s.config.players) {
    const std = p.id === 'tim' ? clubs8.slice(0, 4) : clubs8.slice(10, 14);
    await post('picks', { passcode: 'p', override: true, player: p.id, week: 8, standard: std, lock: p.id === 'tim' ? clubs8[4] : clubs8[14] });
  }
  const res = Object.fromEntries(clubs8.map((c, i) => [c, i < 5 ? 1 : 0]));
  await post('admin/results', { passcode: 'p', week: 8, results: res });
  s = await get();
  let st = cups.state(s, s.cups[0]);
  const timGame = st.bracket.rounds[0].matches.find((m) => [m.a, m.b].some((x) => x && x.id === 'tim'));
  assert.equal(timGame.winner, 'tim');
  assert.equal(st.current.name, 'Quarter-finals');
  assert.ok(sent.some((x) => /You're through! You play/.test(x.msg.body)), 'next round alert');
  // Push the quarter-finals back a week.
  await post('admin/cups', { passcode: 'p', action: 'push-back', id: s.cups[0].id, round: 1 });
  s = await get();
  assert.deepEqual(s.cups[0].weeks, [8, 10, 11, 12]);
  // Override the first-round game Tim won.
  await post('admin/cups', { passcode: 'p', action: 'override', id: s.cups[0].id, key: timGame.key, winner: timGame.a.id === 'tim' ? timGame.b.id : timGame.a.id });
  s = await get();
  st = cups.state(s, s.cups[0]);
  assert.notEqual(st.bracket.rounds[0].matches.find((m) => m.key === timGame.key).winner, 'tim');
  await post('admin/cups', { passcode: 'p', action: 'delete', id: s.cups[0].id });
  assert.equal((await get()).cups.length, 0);
});

await t('Festive Fixtures is a points table over the chosen weeks', async () => {
  const { post, get } = setup();
  const r = await post('admin/cups', { passcode: 'p', action: 'create', type: 'festive', firstWeek: 8, length: 2 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  let s = await get();
  assert.deepEqual(s.cups[0].weeks, [8, 9]);
  for (const w of [8, 9]) {
    for (const p of s.config.players) await post('picks', { passcode: 'p', override: true, player: p.id, week: w, standard: s.config.clubs.slice(p.id === 'greg' ? 0 : 10, p.id === 'greg' ? 4 : 14), lock: s.config.clubs[p.id === 'greg' ? 4 : 14] });
    await post('admin/results', { passcode: 'p', week: w, results: Object.fromEntries(s.config.clubs.map((c, i) => [c, i < 5 ? 1 : 0])) });
  }
  s = await get();
  const st = cups.state(s, s.cups[0]);
  assert.equal(st.status, 'done');
  assert.equal(st.champion.name, 'Greg');
  assert.equal(st.mini.rows[0].points, 12);
});

console.log(passed + ' tests passed');
