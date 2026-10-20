// Tests for fetching results from football-data.org, using week 7's real scores (17-19 Oct 2026)
// in the feed's documented format. Run with: node test/autoresults.test.mjs
import assert from 'node:assert/strict';
import { matchClub, weekFromMatches, weeksToCheck, fetchEflWeek } from '../netlify/lib/autoresults.mjs';
import { createHandler } from '../netlify/lib/handler.mjs';
import { memoryStore } from './memory-store.mjs';
import seed from '../netlify/lib/seed.mjs';

const clubs = seed.config.clubs;
const team = (name, shortName) => ({ name, shortName });
const game = (home, away, h, a, status = 'FINISHED') => ({ status, matchday: 7, homeTeam: home, awayTeam: away, score: { fullTime: { home: h, away: a } } });
const T = {
  spurs: team('Tottenham Hotspur FC', 'Tottenham'), coventry: team('Coventry City FC', 'Coventry'), forest: team('Nottingham Forest FC', 'Nottingham'),
  arsenal: team('Arsenal FC', 'Arsenal'), brighton: team('Brighton & Hove Albion FC', 'Brighton Hove'), palace: team('Crystal Palace FC', 'Crystal Palace'),
  leeds: team('Leeds United FC', 'Leeds United'), manu: team('Manchester United FC', 'Man United'), bournemouth: team('AFC Bournemouth', 'Bournemouth'),
  sunderland: team('Sunderland AFC', 'Sunderland'), newcastle: team('Newcastle United FC', 'Newcastle'), villa: team('Aston Villa FC', 'Aston Villa'),
  city: team('Manchester City FC', 'Man City'), ipswich: team('Ipswich Town FC', 'Ipswich Town'), brentford: team('Brentford FC', 'Brentford'),
  liverpool: team('Liverpool FC', 'Liverpool'), fulham: team('Fulham FC', 'Fulham'), hull: team('Hull City AFC', 'Hull City'),
  everton: team('Everton FC', 'Everton'), chelsea: team('Chelsea FC', 'Chelsea'),
};
const week7 = [
  game(T.spurs, T.coventry, 3, 1), game(T.forest, T.arsenal, 0, 1), game(T.brighton, T.palace, 5, 0), game(T.leeds, T.manu, 1, 1),
  game(T.bournemouth, T.sunderland, 2, 0), game(T.newcastle, T.villa, 0, 1), game(T.city, T.ipswich, 3, 2), game(T.brentford, T.liverpool, 1, 2),
  game(T.fulham, T.hull, 1, 0), game(T.everton, T.chelsea, 0, 2),
];
let passed = 0;
const t = async (name, fn) => { await fn(); passed += 1; console.log('ok  ' + name); };

await t('every feed team name maps to one of the 20 clubs', async () => {
  for (const tm of Object.values(T)) assert.ok(matchClub(tm, clubs), tm.name);
  assert.equal(matchClub(T.manu, clubs), 'Man U');
  assert.equal(matchClub(T.city, clubs), 'Man City');
  assert.equal(matchClub(T.brighton, clubs), 'Brighton');
  assert.equal(matchClub(T.leeds, clubs), 'Leeds');
  assert.equal(new Set(Object.values(T).map((x) => matchClub(x, clubs))).size, 20);
});

await t("week 7's real scores give exactly the results already in the sheet", async () => {
  const w = weekFromMatches(week7, clubs);
  assert.equal(w.finished, 10);
  assert.deepEqual(w.unmatched, []);
  const sheet = seed.results['7'];
  for (const c of clubs) assert.equal(w.results[c], sheet[c], c);
});

await t('postponed and unplayed games', async () => {
  const w = weekFromMatches([game(T.spurs, T.coventry, null, null, 'POSTPONED'), game(T.city, T.ipswich, null, null, 'TIMED'), game(T.fulham, T.hull, 1, 0, 'IN_PLAY')], clubs);
  assert.equal(w.results.Tottenham, 'P');
  assert.equal(w.results['Coventry City'], 'P');
  assert.equal(w.results['Man City'], undefined);
  assert.equal(w.results.Fulham, undefined, 'a game in progress is not a result yet');
  assert.equal(w.pending, 2);
  assert.equal(w.postponed, 1);
});

await t('it checks the current week, an incomplete previous week, and weeks with postponed games', async () => {
  const full = Object.fromEntries(clubs.map((c) => [c, 1]));
  assert.deepEqual(weeksToCheck({ currentWeek: 8, clubs }, { 7: full }), [8]);
  assert.deepEqual(weeksToCheck({ currentWeek: 8, clubs }, { 7: { Arsenal: 1 } }), [7, 8]);
  assert.deepEqual(weeksToCheck({ currentWeek: 9, clubs }, { 3: { ...full, Chelsea: 'P' }, 8: full }), [3, 9]);
});

await t('the commissioner can fetch results, which are saved as suggestions only', async () => {
  const store = memoryStore();
  const calls = [];
  const fakeFetch = async (url, opts) => {
    calls.push({ url, key: opts.headers['X-Auth-Token'] });
    return new Response(JSON.stringify({ matches: week7.slice(0, 6) }), { status: 200 });
  };
  const api = createHandler(() => store, 'p', { footballKey: 'KEY', fetch: fakeFetch });
  const post = async (path, body) => { const r = await api(new Request('https://x.test/api/' + path, { method: 'POST', body: JSON.stringify(body) })); return { status: r.status, body: await r.json() }; };
  const r = await post('admin/fetch-results', { passcode: 'p', week: 8 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(calls[0].url, 'https://api.football-data.org/v4/competitions/PL/matches', 'kickoff times first');
  assert.equal(calls[1].url, 'https://api.football-data.org/v4/competitions/PL/matches?matchday=8');
  assert.equal(calls[0].key, 'KEY');
  assert.equal(r.body.suggested.weeks['8'].finished, 6);
  const season = await (await api(new Request('https://x.test/api/season'))).json();
  assert.equal(season.results['8'], undefined, 'nothing is saved as a result until the commissioner saves');
  const s = await post('admin/suggested', { passcode: 'p' });
  assert.equal(s.body.configured, true);
  assert.equal(s.body.suggested.weeks['8'].results.Arsenal, 1);
});

await t('a refused key or no key gives a clear message', async () => {
  const store = memoryStore();
  const denied = createHandler(() => store, 'p', { footballKey: 'BAD', fetch: async () => new Response('{}', { status: 403 }) });
  const r1 = await denied(new Request('https://x.test/api/admin/fetch-results', { method: 'POST', body: JSON.stringify({ passcode: 'p' }) }));
  assert.equal(r1.status, 502);
  assert.match((await r1.json()).error, /refused the API key/);
  const none = createHandler(() => memoryStore(), 'p', {});
  const r2 = await none(new Request('https://x.test/api/admin/fetch-results', { method: 'POST', body: JSON.stringify({ passcode: 'p' }) }));
  assert.equal(r2.status, 503);
  assert.match((await r2.json()).error, /FOOTBALL_DATA_KEY/);
});

await t('EFL results come from Championship games on the same dates', async () => {
  const pl = [{ utcDate: '2026-10-24T11:30:00Z' }, { utcDate: '2026-10-26T19:00:00Z' }];
  let asked = '';
  const elc = { matches: [
    { status: 'FINISHED', homeTeam: team('Leicester City FC', 'Leicester'), awayTeam: team('Hull City AFC', 'Hull'), score: { fullTime: { home: 2, away: 2 } } },
    { status: 'FINISHED', homeTeam: team('Norwich City FC', 'Norwich'), awayTeam: team('Stoke City FC', 'Stoke'), score: { fullTime: { home: 0, away: 1 } } },
    { status: 'TIMED', homeTeam: team('Stoke City FC', 'Stoke'), awayTeam: team('Hull City AFC', 'Hull'), score: { fullTime: { home: null, away: null } } },
  ] };
  const out = await fetchEflWeek(pl, ['Hull', 'Leicester', 'Norwich', 'Stoke'], 'k', async (url) => { asked = url; return { ok: true, status: 200, json: async () => elc }; });
  assert.match(asked, /ELC\/matches\?dateFrom=2026-10-24&dateTo=2026-10-26/);
  assert.equal(out.results.Leicester, 0.5);
  assert.equal(out.results.Norwich, 0);
  assert.equal(out.results.Hull, undefined, 'Hull plays twice in the window, so the commissioner decides');
  assert.deepEqual(out.twice.sort(), ['Hull', 'Stoke']);
});

await t('a week closes at its first kickoff, and the commissioner can reopen it', async () => {
  const store = memoryStore();
  const soon = new Date(Date.now() - 60000).toISOString();
  const later = new Date(Date.now() + 86400000).toISOString();
  const fixtures = { matches: [
    { matchday: 8, status: 'TIMED', utcDate: soon, homeTeam: team('Arsenal FC', 'Arsenal'), awayTeam: team('Chelsea FC', 'Chelsea') },
    { matchday: 8, status: 'POSTPONED', utcDate: new Date(Date.now() - 864e5).toISOString(), homeTeam: team('Wolverhampton Wanderers FC', 'Wolves'), awayTeam: team('Everton FC', 'Everton') },
    { matchday: 9, status: 'TIMED', utcDate: later, homeTeam: team('Liverpool FC', 'Liverpool'), awayTeam: team('Brentford FC', 'Brentford') },
  ] };
  let calls = 0;
  const api = createHandler(() => store, 'p', { footballKey: 'K', fetch: async () => { calls += 1; return new Response(JSON.stringify(fixtures), { status: 200 }); } });
  const get = async () => (await api(new Request('https://x.test/api/season'))).json();
  const post = async (path, body) => { const r = await api(new Request('https://x.test/api/' + path, { method: 'POST', body: JSON.stringify(body) })); return { status: r.status, body: await r.json() }; };
  let s = await get();
  assert.equal(calls, 1, 'fixtures fetched on the first visit');
  await get();
  assert.equal(calls, 1, 'and not again for 12 hours');
  assert.equal(s.fixtures['8'].kickoff, soon, 'a postponed game does not set the kickoff');
  assert.deepEqual(s.fixtures['8'].games.Arsenal, { vs: 'Chelsea', home: true, at: soon, off: false });
  assert.equal(s.fixtures['9'].games.Brentford.vs, 'Liverpool');
  assert.ok(s.openWeeks.includes(8), 'closing at kickoff is off unless the commissioner turns it on');
  const picks = { player: 'ben', week: 8, standard: ['Arsenal', 'Chelsea', 'Liverpool', 'Brighton'], lock: 'Man City' };
  assert.equal((await post('picks', picks)).status, 200, 'late picks are fine by default');
  assert.equal((await post('admin/config', { passcode: 'p', autoClose: true })).status, 200);
  s = await get();
  assert.ok(!s.openWeeks.includes(8) && s.openWeeks.includes(9));
  const r = await post('picks', picks);
  assert.equal(r.status, 403);
  assert.match(r.body.error, /kicked off/);
  assert.equal((await post('admin/config', { passcode: 'p', reopenedWeeks: [8] })).status, 200);
  s = await get();
  assert.ok(s.openWeeks.includes(8));
  assert.equal((await post('picks', picks)).status, 200);
});

await t('backups are saved, listed and downloadable, newest 12 kept', async () => {
  const { saveBackup, listBackups } = await import('../netlify/lib/backup.mjs');
  const store = memoryStore();
  const api = createHandler(() => store, 'p');
  await api(new Request('https://x.test/api/season'));
  for (let i = 0; i < 14; i += 1) { await saveBackup(store); await new Promise((r) => setTimeout(r, 2)); }
  const keys = await listBackups(store);
  assert.equal(keys.length, 12);
  const post = async (path, body) => { const r = await api(new Request('https://x.test/api/' + path, { method: 'POST', body: JSON.stringify(body) })); return { status: r.status, body: await r.json() }; };
  const list = await post('admin/backups', { passcode: 'p' });
  assert.deepEqual(list.body.backups, keys);
  const one = await post('admin/backup', { passcode: 'p', key: keys[0] });
  assert.equal(one.status, 200);
  assert.equal(one.body.config.players.length, 15);
  assert.equal((await post('admin/backup', { passcode: 'p', key: 'config' })).status, 400);
});

console.log(passed + ' tests passed');
