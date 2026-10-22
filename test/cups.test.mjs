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

await t('a level game goes to the lock, then wins, then a FIFA shootout the commissioner enters', async () => {
  // Level on 2: X has two winning picks and a lost lock, Y a winning lock. The lock comes first, so Y.
  let s = mini({ x: { 1: { standard: ['A', 'B'], lock: 'C' } }, y: { 1: { standard: ['E', 'F'], lock: 'D' } } }, { ...all(0), A: 1, B: 1, D: 1 });
  let m = cups.bracket(s, cup).rounds[0].matches[0];
  assert.equal(m.winner, 'y');
  assert.match(m.how, /through on the lock/);
  // Level on 2.5 with the same lock (a draw each): X has one winning pick, Y none, so X.
  s = mini({ x: { 1: { standard: ['A', 'B', 'E'], lock: 'C' } }, y: { 1: { standard: ['D', 'F', 'A'], lock: 'C' } } }, { A: 0.5, B: 1, C: 0.5, D: 0.5, E: 0, F: 0.5 });
  m = cups.bracket(s, cup).rounds[0].matches[0];
  assert.equal(m.winner, 'x');
  assert.match(m.how, /winning picks/);
  // Dead level on everything: a penalty shootout, and nobody goes through until the commissioner says.
  s = mini({ x: { 1: { standard: ['A', 'B'], lock: 'C' } }, y: { 1: { standard: ['D', 'E'], lock: 'F' } } }, all(0));
  m = cups.bracket(s, cup).rounds[0].matches[0];
  assert.equal(m.status, 'shootout');
  assert.equal(m.winner, null);
  m = cups.bracket(s, { ...cup, overrides: { '0-0': 'y' } }).rounds[0].matches[0];
  assert.equal(m.winner, 'y');
  assert.match(m.how, /penalty shootout/);
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
  await post('push/subscribe', { subscription: { endpoint: 'https://push.example/sam', keys: { p256dh: 'p', auth: 'a' } }, player: 'sam' });
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
  // Everyone else picked the same clubs, so their games are dead level: penalties, settled by the commissioner.
  const pks = st.bracket.rounds[0].matches.filter((m) => m.status === 'shootout');
  assert.ok(pks.length > 0);
  assert.ok(sent.some((x) => x.to.endsWith('/sam') && /penalty shootout in FIFA/.test(x.msg.body)), 'shootout alert');
  assert.equal(st.current.name, 'First round', 'the round is not over until the shootouts are in');
  for (const m of pks) await post('admin/cups', { passcode: 'p', action: 'override', id: s.cups[0].id, key: m.key, winner: m.a.id });
  s = await get();
  st = cups.state(s, s.cups[0]);
  assert.equal(st.current.name, 'Quarter-finals');
  assert.ok(sent.some((x) => /You're through! You play/.test(x.msg.body)), 'next round alert once the shootouts are in');
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
  const r = await post('admin/cups', { passcode: 'p', action: 'create', type: 'festive', weeks: [10, 8] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  let s = await get();
  assert.deepEqual(s.cups[0].weeks, [8, 10], 'weeks do not need to be in a row, and are kept in order');
  for (const w of [8, 9, 10]) {
    for (const p of s.config.players) await post('picks', { passcode: 'p', override: true, player: p.id, week: w, standard: s.config.clubs.slice(p.id === 'greg' ? 0 : 10, p.id === 'greg' ? 4 : 14), lock: s.config.clubs[p.id === 'greg' ? 4 : 14] });
    await post('admin/results', { passcode: 'p', week: w, results: Object.fromEntries(s.config.clubs.map((c, i) => [c, i < 5 ? 1 : 0])) });
  }
  s = await get();
  const st = cups.state(s, s.cups[0]);
  assert.equal(st.status, 'done');
  assert.equal(st.champion.name, 'Greg');
  assert.equal(st.mini.rows[0].points, 12, 'only weeks 8 and 10 count, not week 9 in between');
});

await t('each cup keeps its own weeks', async () => {
  const { post, get } = setup();
  const league = await post('admin/cups', { passcode: 'p', action: 'create', type: 'league', firstWeek: 9 });
  assert.equal(league.status, 200, JSON.stringify(league.body));
  const lw = (await get()).cups[0].weeks;
  assert.deepEqual(lw, [9, 10, 11, 12]);
  let r = await post('admin/cups', { passcode: 'p', action: 'preview', type: 'festive', weeks: [12, 14] });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /Week 12 is already part of the League Cup \(final\)/);
  r = await post('admin/cups', { passcode: 'p', action: 'create', type: 'fa', firstWeek: 11 });
  assert.equal(r.status, 400, 'a knockout cannot overlap another cup either');
  assert.equal((await post('admin/cups', { passcode: 'p', action: 'create', type: 'festive', weeks: [13, 15] })).status, 200, 'the week straight after is fine');
  assert.equal((await post('admin/cups', { passcode: 'p', action: 'create', type: 'fa', firstWeek: 36 })).status, 400, 'a knockout cannot run past week 38');
  assert.equal((await post('admin/cups', { passcode: 'p', action: 'create', type: 'festive', weeks: [20] })).status, 400, 'Festive needs at least 2 weeks');
  // Pushing the League Cup final back into a Festive week is refused.
  const s = await get();
  const lc = s.cups.find((c) => c.type === 'league');
  r = await post('admin/cups', { passcode: 'p', action: 'push-back', id: lc.id, round: 3 });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /week 13 is already part of the Festive Fixtures/);
});

console.log(passed + ' tests passed');
