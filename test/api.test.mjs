// Tests for the league API against the in-memory store. Run with: node test/api.test.mjs
import assert from 'node:assert/strict';
import { createHandler } from '../netlify/lib/handler.mjs';
import { memoryStore } from './memory-store.mjs';

const store = memoryStore();
const api = createHandler(() => store, 'letmein');
const call = async (method, path, body, headers = {}) => {
  const res = await api(new Request('https://x.test/api/' + path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined }));
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
  assert.deepEqual(r.body.openWeeks, [8], 'one week at a time');
  assert.deepEqual(r.body.upcomingWeeks.slice(0, 2), [8, 9]);
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

await t('picks stay hidden from everyone else until the week kicks off', async () => {
  const anon = (await call('GET', 'season')).body;
  assert.equal(anon.picks.jon['8'], undefined, 'hidden from others');
  assert.ok(anon.picks.jon['7'], 'past weeks still show');
  assert.deepEqual(anon.hiddenPicked['8'], ['jon'], 'others see that Jon has picked');
  const mine = (await call('GET', 'season?me=jon')).body;
  assert.equal(mine.picks.jon['8'].lock, 'Man City', 'Jon sees his own');
  const commish = await api(new Request('https://x.test/api/season', { headers: { 'x-ffwb-pass': 'letmein' } }));
  assert.equal((await commish.json()).picks.jon['8'].lock, 'Man City', 'the commissioner sees everything');
  const wrong = await api(new Request('https://x.test/api/season', { headers: { 'x-ffwb-pass': 'nope' } }));
  assert.equal((await wrong.json()).picks.jon['8'], undefined);
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
  const s = (await call('GET', 'season', null, { 'x-ffwb-pass': 'letmein' })).body;
  const cityLocks = Object.values(s.picks.tim).filter((p) => p.lock === 'Man City').length;
  let week = 8;
  for (let i = cityLocks; i < 4; i += 1, week += 1) {
    const r = await call('POST', 'picks', { passcode: 'letmein', player: 'tim', week, standard: ['Coventry City', 'Hull City', 'Sunderland', 'Fulham'], lock: 'Man City' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  }
  const r = await call('POST', 'picks', { passcode: 'letmein', player: 'tim', week, standard: ['Coventry City', 'Hull City', 'Sunderland', 'Fulham'], lock: 'Man City' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /4 times this half/);
});

await t('picks that leave too few weeks to reach 3 of every club are refused', async () => {
  // Kooz fills weeks 8 to 18 with the same five clubs, leaving week 19 alone for everything still owed.
  let refused = null;
  for (let week = 8; week <= 19 && !refused; week += 1) {
    const r = await call('POST', 'picks', { passcode: 'letmein', player: 'kooz', week, standard: ['Arsenal', 'Chelsea', 'Liverpool', 'Brighton'], lock: ['Man City', 'Man U', 'Newcastle', 'Everton', 'Leeds', 'Fulham'][week % 6] });
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

await t('some results keep the week open for unplayed games, and a full set opens the next week', async () => {
  const season = (await call('GET', 'season', null, { 'x-ffwb-pass': 'letmein' })).body;
  const partial = { Arsenal: 1, Chelsea: 0.5 };
  let r = await call('POST', 'admin/results', { passcode: 'letmein', week: 8, results: partial });
  assert.equal(r.status, 200);
  assert.equal(r.body.config.currentWeek, 8);
  assert.equal((await call('POST', 'picks', { ...good, standard: ['Arsenal', 'Chelsea', 'Liverpool', 'Leeds'] })).status, 200, 'played clubs kept, an unplayed one changed');
  assert.equal((await call('POST', 'picks', { ...good, standard: ['Leeds', 'Chelsea', 'Liverpool', 'Brighton'] })).status, 403, 'a played club cannot be dropped');
  const full = Object.fromEntries(season.config.clubs.map((c, i) => [c, [1, 0.5, 0, 'P'][i % 4]]));
  r = await call('POST', 'admin/results', { passcode: 'letmein', week: 8, results: full });
  assert.equal(r.body.config.currentWeek, 9);
  assert.equal((await call('POST', 'admin/results', { passcode: 'letmein', week: 8, results: { Arsenal: 2 } })).status, 400);
});

await t('the commissioner can move the current week and close weeks', async () => {
  const r = await call('POST', 'admin/config', { passcode: 'letmein', currentWeek: 9, lockedWeeks: [10] });
  assert.equal(r.body.config.currentWeek, 9);
  assert.deepEqual(r.body.config.lockedWeeks, [10]);
  assert.equal((await call('POST', 'picks', { ...good, week: 10 })).status, 403, 'a later week is not open');
  assert.equal((await call('POST', 'picks', { ...good, week: 9 })).status, 200, 'the current week is');
  assert.equal((await call('POST', 'admin/config', { passcode: 'letmein', lockedWeeks: [9] })).body.config.lockedWeeks[0], 9);
  assert.equal((await call('POST', 'picks', { ...good, week: 9 })).status, 403, 'closed early by the commissioner');
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
  const s = await (await a(new Request('https://x.test/api/season', { headers: { 'x-ffwb-pass': 'p' } }))).json();
  assert.ok(s.picks.alex['8'] && s.picks.ben['8'] && s.picks.sam['8']);
});

await t('a perfect week earns one bonus pick the next week, and only then', async () => {
  const fresh = memoryStore();
  const h = createHandler(() => fresh, 'p');
  const go = async (body) => { const r = await h(new Request('https://x.test/api/picks', { method: 'POST', body: JSON.stringify(body) })); return { status: r.status, body: await r.json() }; };
  const five = ['Arsenal', 'Chelsea', 'Liverpool', 'Brighton', 'Everton'];
  // Basler won everything in week 7; Brendan did not.
  assert.equal((await go({ player: 'basler', week: 8, standard: five, lock: 'Man City' })).status, 200);
  assert.equal((await go({ player: 'basler', week: 8, standard: five.slice(0, 4), lock: 'Man City' })).status, 200, 'the bonus is optional');
  const six = await go({ player: 'basler', week: 8, standard: [...five, 'Leeds'], lock: 'Man City' });
  assert.equal(six.status, 400);
  assert.match(six.body.error, /4 to 5 clubs/);
  const b = await go({ player: 'brendan', week: 8, standard: five, lock: 'Man City' });
  assert.equal(b.status, 400);
});

await t('a perfect bonus week stacks, and a postponed game means not perfect yet', async () => {
  const fresh = memoryStore();
  const h = createHandler(() => fresh, 'p');
  const post = async (path, body) => { const r = await h(new Request('https://x.test/api/' + path, { method: 'POST', body: JSON.stringify(body) })); return { status: r.status, body: await r.json() }; };
  const five = ['Arsenal', 'Chelsea', 'Liverpool', 'Brighton', 'Everton'];
  assert.equal((await post('picks', { player: 'basler', week: 8, standard: five, lock: 'Man City' })).status, 200);
  const season = await (await h(new Request('https://x.test/api/season', { headers: { 'x-ffwb-pass': 'p' } }))).json();
  const wins = Object.fromEntries(season.config.clubs.map((c) => [c, 1]));
  assert.equal((await post('admin/results', { passcode: 'p', week: 8, results: { ...wins, Everton: 'P' } })).status, 200);
  const notYet = await post('picks', { player: 'basler', week: 9, standard: [...five.slice(0, 4), 'Leeds'], lock: 'Man U' });
  assert.equal(notYet.status, 400, 'week 8 has a postponed game, so no bonus yet');
  assert.equal((await post('admin/results', { passcode: 'p', week: 8, results: wins })).status, 200);
  const stacked = await post('picks', { player: 'basler', week: 9, standard: [...five, 'Leeds'], lock: 'Man U' });
  assert.equal(stacked.status, 200, JSON.stringify(stacked.body));
});

await t('EFL picks only count on weeks the commissioner switches on', async () => {
  const fresh = memoryStore();
  const champ = { teams: [{ shortName: 'Leicester' }, { shortName: 'Hull' }, { name: 'Norwich City FC', shortName: 'Norwich' }] };
  const fakeFetch = async (url) => ({ ok: true, status: 200, json: async () => (url.includes('/teams') ? champ : { matches: [] }) });
  const h = createHandler(() => fresh, 'p', { footballKey: 'k', fetch: fakeFetch });
  const post = async (path, body) => { const r = await h(new Request('https://x.test/api/' + path, { method: 'POST', body: JSON.stringify(body) })); return { status: r.status, body: await r.json() }; };
  const picks = { player: 'jon', week: 8, standard: ['Arsenal', 'Chelsea', 'Liverpool', 'Brighton'], lock: 'Man City' };
  // Not an EFL week: the pick is ignored.
  let r = await post('picks', { ...picks, efl: 'Leicester' });
  assert.equal(r.status, 200);
  assert.equal(r.body.weeks['8'].efl, undefined);
  const clubs = await post('admin/efl-clubs', { passcode: 'p' });
  assert.equal(clubs.status, 200, JSON.stringify(clubs.body));
  assert.deepEqual(clubs.body.config.eflClubs, ['Hull', 'Leicester', 'Norwich']);
  assert.equal((await post('admin/config', { passcode: 'p', eflWeeks: [8] })).status, 200);
  r = await post('picks', { ...picks, efl: 'Wrexham' });
  assert.equal(r.status, 400, 'a club not on the list is refused');
  r = await post('picks', { ...picks, efl: 'Leicester' });
  assert.equal(r.status, 200);
  assert.equal(r.body.weeks['8'].efl, 'Leicester');
  assert.equal((await post('admin/results', { passcode: 'p', week: 8, results: { Arsenal: 1 }, efl: { Leicester: 0.5 } })).status, 200);
  const season = await (await h(new Request('https://x.test/api/season', { headers: { 'x-ffwb-pass': 'p' } }))).json();
  assert.deepEqual(season.config.eflWeeks, [8]);
  assert.equal(season.eflResults['8'].Leicester, 0.5);
  assert.equal(season.picks.jon['8'].efl, 'Leicester');
});

await t('the Shame Club starts with the founders and the commissioner can edit it', async () => {
  const fresh = memoryStore();
  const h = createHandler(() => fresh, 'p');
  const s = await (await h(new Request('https://x.test/api/season', { headers: { 'x-ffwb-pass': 'p' } }))).json();
  assert.equal(s.config.shameClub.length, 6);
  assert.deepEqual(s.config.shameClub[1], { name: 'Greg', note: 'Platinum Member' });
  assert.deepEqual(s.config.shameClub[5], { name: 'Michael', aka: 'Diddler' });
  const r = await h(new Request('https://x.test/api/admin/config', { method: 'POST', body: JSON.stringify({ passcode: 'p', shameClub: [{ name: 'Paul' }, { name: ' ' }, { name: 'Greg', note: 'Platinum Member' }] }) }));
  const out = await r.json();
  assert.deepEqual(out.config.shameClub, [{ name: 'Paul' }, { name: 'Greg', note: 'Platinum Member' }]);
});

await t('the commissioner can add, rename, retire and bring back players', async () => {
  const fresh = memoryStore();
  const h = createHandler(() => fresh, 'p');
  const post = async (path, body) => { const r = await h(new Request('https://x.test/api/' + path, { method: 'POST', body: JSON.stringify(body) })); return { status: r.status, body: await r.json() }; };
  let r = await post('admin/players', { passcode: 'p', action: 'add', name: '  Big  Dave ' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(r.body.config.players.some((x) => x.id === 'big-dave' && x.name === 'Big Dave'));
  assert.equal((await post('admin/players', { passcode: 'p', action: 'add', name: 'big dave' })).status, 400, 'no duplicates');
  assert.equal((await post('picks', { player: 'big-dave', week: 8, standard: ['Arsenal', 'Chelsea', 'Liverpool', 'Brighton'], lock: 'Man City' })).status, 200, 'a new player can pick');
  r = await post('admin/players', { passcode: 'p', action: 'rename', id: 'big-dave', name: 'Dave Two' });
  assert.ok(r.body.config.players.some((x) => x.id === 'big-dave' && x.name === 'Dave Two'));
  r = await post('admin/players', { passcode: 'p', action: 'retire', id: 'big-dave' });
  assert.ok(!r.body.config.players.some((x) => x.id === 'big-dave'));
  assert.ok(r.body.config.retired.some((x) => x.id === 'big-dave'));
  let s = await (await h(new Request('https://x.test/api/season', { headers: { 'x-ffwb-pass': 'p' } }))).json();
  assert.equal(s.picks['big-dave'], undefined, 'a retired player is off the table');
  r = await post('admin/players', { passcode: 'p', action: 'restore', id: 'big-dave' });
  s = await (await h(new Request('https://x.test/api/season', { headers: { 'x-ffwb-pass': 'p' } }))).json();
  assert.equal(s.picks['big-dave']['8'].lock, 'Man City', 'and comes back with their picks');
  assert.equal((await post('admin/players', { passcode: 'wrong', action: 'add', name: 'X' })).status, 401);
});

await t('the commissioner can start a new season, and the old one is kept for History', async () => {
  const fresh = memoryStore();
  const h = createHandler(() => fresh, 'p');
  const post = async (path, body) => { const r = await h(new Request('https://x.test/api/' + path, { method: 'POST', body: JSON.stringify(body) })); return { status: r.status, body: await r.json() }; };
  const get = async () => (await h(new Request('https://x.test/api/season', { headers: { 'x-ffwb-pass': 'p' } }))).json();
  // Michael picks both sides of a match in week 8, so he should join the Shame Club for good.
  await fresh.setJSON('fixtures', { checkedAt: new Date().toISOString(), weeks: { 8: { kickoff: null, games: { Arsenal: { vs: 'Chelsea', home: true }, Chelsea: { vs: 'Arsenal', home: false } } } } });
  await post('picks', { player: 'michael', week: 8, standard: ['Arsenal', 'Chelsea', 'Liverpool', 'Brighton'], lock: 'Man City' });
  const pre = await post('admin/new-season', { passcode: 'p', action: 'preview' });
  assert.equal(pre.body.next, '2027-28');
  const s0 = await get();
  const clubs = [...s0.config.clubs.slice(0, 17), 'Leicester', 'Southampton', 'Norwich City'];
  assert.equal((await post('admin/new-season', { passcode: 'p', action: 'start', season: '2027-28', clubs, confirm: 'nope' })).status, 400, 'must type the name');
  assert.equal((await post('admin/new-season', { passcode: 'p', action: 'start', season: '2027-28', clubs: clubs.slice(0, 19), confirm: '2027-28' })).status, 400, 'needs 20 clubs');
  const keep = s0.config.players.filter((p) => p.id !== 'dave').map((p) => p.id);
  const r = await post('admin/new-season', { passcode: 'p', action: 'start', season: '2027-28', clubs, keep, confirm: '2027-28' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const s = await get();
  assert.equal(s.config.season, '2027-28');
  assert.equal(s.config.currentWeek, 1);
  assert.ok(s.config.clubs.includes('Southampton'));
  assert.ok(!s.config.players.some((p) => p.id === 'dave') && s.config.retired.some((p) => p.id === 'dave'));
  assert.deepEqual(s.picks.jon, {}, 'picks start again');
  assert.deepEqual(s.results, {});
  assert.equal(s.archives.length, 1);
  assert.equal(s.archives[0].season, '2026-27');
  assert.equal(Object.keys(s.archives[0].picks.jon).length, 7, 'the old picks are kept');
  assert.ok(s.config.shameClub.some((m) => m.name === 'Michael'), 'Michael already a founder (aka Diddler)');
  const backups = await post('admin/backups', { passcode: 'p' });
  assert.ok(backups.body.backups.length >= 1, 'a backup was saved first');
});

await t('personal links lock a name to its own phone, and changes alert the player', async () => {
  const fresh = memoryStore();
  const sent = [];
  const h = createHandler(() => fresh, 'p', { pushSender: { sendNotification: async (sub, payload) => { sent.push(JSON.parse(payload)); } } });
  const req = (path, body, headers = {}) => h(new Request('https://x.test/api/' + path, { method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined })).then(async (r) => ({ status: r.status, body: await r.json() }));
  const pick = { player: 'greg', week: 8, standard: ['Arsenal', 'Chelsea', 'Liverpool', 'Brighton'], lock: 'Man City' };
  // Before the link is opened, the name works on trust.
  assert.equal((await req('picks', pick)).status, 200);
  const list = (await req('admin/keys', { passcode: 'p' })).body.players;
  const greg = list.find((x) => x.id === 'greg');
  assert.ok(greg.key && !greg.locked);
  assert.equal((await req('link', { key: 'wrong' })).status, 404);
  const linked = await req('link', { key: greg.key });
  assert.equal(linked.body.player, 'greg');
  // Now only Greg's key can save or see Greg's picks before kickoff.
  const other = await req('picks', { ...pick, lock: 'Arsenal', standard: ['Everton', 'Chelsea', 'Liverpool', 'Brighton'] });
  assert.equal(other.status, 403);
  assert.ok(other.body.needsLink);
  assert.equal((await req('picks', { ...pick, key: greg.key })).status, 200);
  assert.equal((await req('season?me=greg')).body.picks.greg['8'], undefined, 'no key, no peeking');
  assert.equal((await req('season?me=greg', null, { 'x-ffwb-key': greg.key })).body.picks.greg['8'].lock, 'Man City');
  assert.deepEqual((await req('season')).body.linked, ['greg']);
  assert.equal((await req('react', { week: 7, target: 'tim', emoji: '\u{1F525}', by: 'greg' })).status, 403);
  // The commissioner can still change it, and Greg hears about it.
  await req('push/subscribe', { subscription: { endpoint: 'https://push.test/g', keys: { p256dh: 'x', auth: 'y' } }, player: 'greg', key: greg.key });
  sent.length = 0;
  assert.equal((await req('picks', { ...pick, passcode: 'p' })).status, 200);
  assert.equal(sent.length, 1);
  assert.match(sent[0].body, /commissioner changed your week 8/);
  sent.length = 0;
  assert.equal((await req('picks', { ...pick, key: greg.key })).status, 200);
  assert.equal(sent.length, 0, 'no alert when Greg saves from his own phone');
  // A reset kills the old link.
  const reset = (await req('admin/keys', { passcode: 'p', action: 'reset', id: 'greg' })).body.players.find((x) => x.id === 'greg');
  assert.notEqual(reset.key, greg.key);
  assert.equal((await req('picks', { ...pick, key: greg.key })).status, 403);
  assert.equal((await req('picks', { ...pick, key: reset.key })).status, 200);
  const c = (await req('admin/keys', { passcode: 'p', action: 'contact', id: 'greg', phone: '(312) 555-0199', email: 'greg@example.com' })).body.players.find((x) => x.id === 'greg');
  assert.equal(c.phone, '3125550199');
  assert.equal(c.email, 'greg@example.com');
  assert.equal((await req('admin/keys', { passcode: 'p', action: 'contact', id: 'greg', email: 'nope' })).status, 400);
  assert.equal(JSON.stringify((await req('season')).body).includes('greg@example.com'), false, 'never public');
  // Unlock lets the name work on trust again.
  await req('admin/keys', { passcode: 'p', action: 'unlock', id: 'greg' });
  assert.equal((await req('picks', pick)).status, 200);
});

await t('error reports are counted, kept short, and only the commissioner can read them', async () => {
  const fresh = memoryStore();
  const h = createHandler(() => fresh, 'p');
  const post = async (path, body) => { const r = await h(new Request('https://x.test/api/' + path, { method: 'POST', body: JSON.stringify(body) })); return { status: r.status, body: await r.json() }; };
  for (let i = 0; i < 3; i += 1) assert.equal((await post('report', { message: 'x is undefined', source: '/js/picks.js:10:' + i, player: 'jon' })).status, 200);
  await post('report', { message: 'Something else', source: '/js/home.js:1:1' });
  assert.equal((await post('report', {})).status, 400);
  assert.equal((await post('admin/errors', {})).status, 401);
  const list = (await post('admin/errors', { passcode: 'p' })).body.items;
  assert.equal(list.length, 2);
  assert.equal(list.find((x) => x.message === 'x is undefined').count, 3, 'same line, different column: one problem');
  for (let i = 0; i < 70; i += 1) await post('report', { message: 'flood ' + i });
  assert.equal((await post('admin/errors', { passcode: 'p' })).body.items.length, 60);
  assert.equal((await post('admin/errors', { passcode: 'p', action: 'clear' })).body.items.length, 0);
});

await t('The Map syncs between a player\'s own devices and stays private', async () => {
  const fresh = memoryStore();
  const h = createHandler(() => fresh, 'p');
  const post = async (path, body) => { const r = await h(new Request('https://x.test/api/' + path, { method: 'POST', body: JSON.stringify(body) })); return { status: r.status, body: await r.json() }; };
  const key = (await post('admin/keys', { passcode: 'p' })).body.players.find((x) => x.id === 'tim').key;
  assert.equal((await post('plan', { player: 'tim', cells: { '9|Arsenal': { on: true, at: 1 } } })).status, 403, 'no key, no plan');
  assert.equal((await post('plan', { player: 'tim', key: 'nope', cells: {} })).status, 403);
  // Laptop plans Arsenal and Chelsea; phone (offline earlier) clears Arsenal later and adds Wolves.
  let r = await post('plan', { player: 'tim', key, season: '2026-27', cells: { '9|Arsenal': { on: true, at: 100 }, '9|Chelsea': { on: true, at: 100 } } });
  assert.equal(Object.keys(r.body.cells).length, 2);
  r = await post('plan', { player: 'tim', key, season: '2026-27', cells: { '9|Arsenal': { on: false, at: 200 }, '10|Wolves': { on: true, at: 150 }, '9|Chelsea': { on: false, at: 50 } } });
  assert.equal(r.body.cells['9|Arsenal'].on, false, 'the newer change wins');
  assert.equal(r.body.cells['9|Chelsea'].on, true, 'an older change does not undo a newer one');
  assert.equal(r.body.cells['10|Wolves'].on, true);
  r = await post('plan', { player: 'tim', key, season: '2026-27', cells: { 'junk': { on: true, at: 1 } } });
  assert.equal(r.body.cells.junk, undefined, 'bad squares are ignored');
});

await t('the commissioner can set the Kitty figures and adjustments', async () => {
  let r = await call('POST', 'admin/config', { passcode: 'letmein', money: { fund: 570, greenout: 5, picks: 10, missed: 5, split: { first: 25, second: 50, runnerUp: 25 } }, moneyAdjust: { aronson: { amount: 5, note: 'Paid late' }, nobody: { amount: 3 } } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.config.money.split, { first: 25, second: 50, runnerUp: 25 });
  assert.deepEqual(r.body.config.moneyAdjust, { aronson: { amount: 5, note: 'Paid late' } }, 'unknown players are dropped');
  r = await call('POST', 'admin/config', { passcode: 'letmein', money: { split: { first: 30, second: 50, runnerUp: 25 } } });
  assert.equal(r.status, 400, 'the split has to add up to 100');
  assert.equal((await call('POST', 'admin/config', { money: { fund: 1 } })).status, 401);
});

await t('a week stays open after its first results, and played games are fixed', async () => {
  const fresh = memoryStore();
  const h = createHandler(() => fresh, 'p');
  const post = async (path, body) => { const r = await h(new Request('https://x.test/api/' + path, { method: 'POST', body: JSON.stringify(body) })); return { status: r.status, body: await r.json() }; };
  const get = async () => (await h(new Request('https://x.test/api/season', { headers: { 'x-ffwb-pass': 'p' } }))).json();
  const early = { player: 'tim', week: 8, standard: ['Arsenal', 'Chelsea', 'Liverpool', 'Brighton'], lock: 'Man City' };
  assert.equal((await post('picks', early)).status, 200);
  // Friday night: one game is in.
  assert.equal((await post('admin/results', { passcode: 'p', week: 8, results: { 'Ipswich Town': 0.5, 'Nottingham Forest': 0.5, Arsenal: 1 } })).status, 200);
  const s = await get();
  assert.deepEqual(s.openWeeks, [8], 'still open for late picks');
  // A late picker can pick the games still to come.
  assert.equal((await post('picks', { player: 'ben', week: 8, standard: ['Everton', 'Chelsea', 'Liverpool', 'Brighton'], lock: 'Man City' })).status, 200);
  // But not a club whose game is already played.
  let r = await post('picks', { player: 'sam', week: 8, standard: ['Arsenal', 'Chelsea', 'Liverpool', 'Brighton'], lock: 'Man City' });
  assert.equal(r.status, 403);
  assert.match(r.body.error, /Arsenal has already played/);
  // Tim already had Arsenal: he can change his other picks, but not move or drop Arsenal.
  assert.equal((await post('picks', { ...early, standard: ['Arsenal', 'Chelsea', 'Liverpool', 'Everton'] })).status, 200);
  assert.equal((await post('picks', { ...early, standard: ['Wolves', 'Chelsea', 'Liverpool', 'Everton'] })).status, 403, 'cannot drop a played club');
  assert.equal((await post('picks', { ...early, standard: ['Man City', 'Chelsea', 'Liverpool', 'Everton'], lock: 'Arsenal' })).status, 403, 'cannot make a played club the lock');
  assert.equal((await post('picks', { player: 'tim', week: 8, standard: [], lock: null })).status, 403, 'cannot clear picks with a played club in them');
  // The commissioner can still change anything.
  assert.equal((await post('picks', { ...early, passcode: 'p', standard: ['Wolves', 'Chelsea', 'Liverpool', 'Everton'], override: true })).status, 200);
  // Once every result is in, the week closes and the next one opens.
  await post('admin/results', { passcode: 'p', week: 8, results: Object.fromEntries(s.config.clubs.map((c) => [c, 1])) });
  assert.deepEqual((await get()).openWeeks, [9]);
});

console.log(passed + ' tests passed');
