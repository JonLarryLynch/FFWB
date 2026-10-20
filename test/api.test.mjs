// Tests for the league API against the in-memory store. Run with: node test/api.test.mjs
import assert from 'node:assert/strict';
import { createHandler } from '../netlify/lib/handler.mjs';
import { memoryStore } from './memory-store.mjs';

const store = memoryStore();
const api = createHandler(() => store, 'letmein');
const call = async (method, path, body) => {
  const res = await api(new Request('https://x.test/api/' + path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }));
  return { status: res.status, body: await res.json() };
};
let passed = 0;
const t = async (name, fn) => { await fn(); passed += 1; console.log('ok  ' + name); };

await t('season loads and seeds weeks 1 to 7', async () => {
  const r = await call('GET', 'season');
  assert.equal(r.status, 200);
  assert.equal(r.body.config.players.length, 15);
  assert.equal(r.body.config.currentWeek, 8);
  assert.equal(Object.keys(r.body.picks.jon).length, 7);
  assert.equal(Object.keys(r.body.picks.aronson).length, 6);
  assert.deepEqual(r.body.openWeeks.slice(0, 2), [8, 9]);
  assert.equal(Object.keys(r.body.results).length, 7);
});

await t('season totals match the sheet', async () => {
  const r = (await call('GET', 'season')).body;
  const pts = (v, lock) => (v === 1 ? 1 : v === 0.5 ? 0.5 : 0) * (lock ? 2 : 1);
  const total = (id) => Object.entries(r.picks[id]).reduce((s, [w, p]) => s + p.standard.reduce((a, c) => a + pts(r.results[w][c]), 0) + pts(r.results[w][p.lock], true), 0);
  assert.equal(total('basler'), 32.5);
  assert.equal(total('michael'), 25);
  assert.equal(total('jon'), 30);
});

const good = { player: 'jon', week: 8, standard: ['Arsenal', 'Chelsea', 'Liverpool', 'Brighton'], lock: 'Man City' };
await t('a player can save valid picks for an open week', async () => {
  const r = await call('POST', 'picks', good);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.weeks['8'].lock, 'Man City');
  assert.equal(r.body.weeks['8'].by, 'Jon');
});

await t('a closed week is refused', async () => {
  const r = await call('POST', 'picks', { ...good, week: 7 });
  assert.equal(r.status, 403);
});

await t('wrong number of picks and repeats are refused', async () => {
  assert.equal((await call('POST', 'picks', { ...good, standard: ['Arsenal', 'Chelsea', 'Liverpool'] })).status, 400);
  assert.equal((await call('POST', 'picks', { ...good, standard: ['Arsenal', 'Arsenal', 'Liverpool', 'Brighton'] })).status, 400);
  assert.equal((await call('POST', 'picks', { ...good, lock: 'Arsenal' })).status, 400);
  assert.equal((await call('POST', 'picks', { ...good, lock: 'Wrexham' })).status, 400);
});

await t('a fifth lock on the same club in a half is refused', async () => {
  const s = (await call('GET', 'season')).body;
  const cityLocks = Object.values(s.picks.tim).filter((p) => p.lock === 'Man City').length;
  let week = 8;
  for (let i = cityLocks; i < 4; i += 1, week += 1) {
    const r = await call('POST', 'picks', { player: 'tim', week, standard: ['Coventry City', 'Hull City', 'Sunderland', 'Fulham'], lock: 'Man City' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  }
  const r = await call('POST', 'picks', { player: 'tim', week, standard: ['Coventry City', 'Hull City', 'Sunderland', 'Fulham'], lock: 'Man City' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /4 times this half/);
});

await t('picks that leave too few weeks to reach 3 of every club are refused', async () => {
  // Kooz fills weeks 8 to 18 with the same five clubs, leaving week 19 alone for everything still owed.
  let refused = null;
  for (let week = 8; week <= 19 && !refused; week += 1) {
    const r = await call('POST', 'picks', { player: 'kooz', week, standard: ['Arsenal', 'Chelsea', 'Liverpool', 'Brighton'], lock: ['Man City', 'Man U', 'Newcastle', 'Everton', 'Leeds', 'Fulham'][week % 6] });
    if (r.status !== 200) refused = r;
  }
  assert.ok(refused, 'expected a refusal');
  assert.equal(refused.status, 400);
  assert.match(refused.body.error, /not enough weeks|required picks/);
});

await t('the commissioner can override a rule and edit a closed week', async () => {
  const bad = await call('POST', 'picks', { ...good, week: 7, passcode: 'letmein', lock: 'Arsenal' });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.canOverride, true);
  const r = await call('POST', 'picks', { player: 'aronson', week: 6, standard: ['Arsenal', 'Chelsea', 'Brighton', 'Ipswich Town'], lock: 'Man City', passcode: 'letmein' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.weeks['6'].by, 'Commissioner');
});

await t('a player can clear their own open week', async () => {
  const r = await call('POST', 'picks', { player: 'jon', week: 8, standard: [], lock: null });
  assert.equal(r.status, 200);
  assert.equal(r.body.weeks['8'], undefined);
  await call('POST', 'picks', good);
});

await t('admin routes need the passcode', async () => {
  assert.equal((await call('POST', 'admin/check', { passcode: 'nope' })).status, 401);
  assert.equal((await call('POST', 'admin/check', { passcode: 'letmein' })).status, 200);
  assert.equal((await call('POST', 'admin/results', { week: 8, results: {} })).status, 401);
});

await t('entering results closes the week, and a full set opens the next week', async () => {
  const season = (await call('GET', 'season')).body;
  const partial = { Arsenal: 1, Chelsea: 0.5 };
  let r = await call('POST', 'admin/results', { passcode: 'letmein', week: 8, results: partial });
  assert.equal(r.status, 200);
  assert.equal(r.body.config.currentWeek, 8);
  assert.equal((await call('POST', 'picks', { ...good, standard: ['Arsenal', 'Chelsea', 'Liverpool', 'Leeds'] })).status, 403);
  const full = Object.fromEntries(season.config.clubs.map((c, i) => [c, [1, 0.5, 0, 'P'][i % 4]]));
  r = await call('POST', 'admin/results', { passcode: 'letmein', week: 8, results: full });
  assert.equal(r.body.config.currentWeek, 9);
  assert.equal((await call('POST', 'admin/results', { passcode: 'letmein', week: 8, results: { Arsenal: 2 } })).status, 400);
});

await t('the commissioner can move the current week and close weeks', async () => {
  const r = await call('POST', 'admin/config', { passcode: 'letmein', currentWeek: 9, lockedWeeks: [10] });
  assert.equal(r.body.config.currentWeek, 9);
  assert.deepEqual(r.body.config.lockedWeeks, [10]);
  assert.equal((await call('POST', 'picks', { ...good, week: 10 })).status, 403);
  await call('POST', 'admin/config', { passcode: 'letmein', lockedWeeks: [] });
});

await t('the change log records who changed what', async () => {
  const r = await call('POST', 'admin/log', { passcode: 'letmein' });
  assert.equal(r.status, 200);
  assert.ok(r.body.entries.length > 5);
  assert.ok(r.body.entries.some((e) => e.kind === 'results'));
  assert.ok(r.body.entries.some((e) => e.player === 'Aronson' && e.by === 'Commissioner'));
});

await t('a backup includes everything', async () => {
  const r = await call('POST', 'admin/backup', { passcode: 'letmein' });
  assert.equal(Object.keys(r.body.picks).length, 15);
  assert.ok(r.body.results.weeks['8']);
});

await t('no passcode set means the commissioner page says so', async () => {
  const open = createHandler(() => memoryStore(), undefined);
  const res = await open(new Request('https://x.test/api/admin/check', { method: 'POST', body: JSON.stringify({ passcode: 'x' }) }));
  assert.equal(res.status, 503);
});

await t('two saves at once for different players both land', async () => {
  const fresh = memoryStore();
  const a = createHandler(() => fresh, 'p');
  const mk = (player) => a(new Request('https://x.test/api/picks', { method: 'POST', body: JSON.stringify({ ...good, player }) }));
  const res = await Promise.all(['alex', 'ben', 'sam'].map(mk));
  assert.deepEqual(res.map((x) => x.status), [200, 200, 200]);
  const s = await (await a(new Request('https://x.test/api/season'))).json();
  assert.ok(s.picks.alex['8'] && s.picks.ben['8'] && s.picks.sam['8']);
});

console.log(passed + ' tests passed');
