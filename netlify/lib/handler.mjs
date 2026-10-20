// The Football FWB league API. Storage is passed in, so the same code runs on Netlify and in tests.
//
// Store layout:
//   config          { season, players: [{ id, name }], clubs: [...], currentWeek, lockedWeeks: [...],
//                     eflWeeks: [...], eflClubs: [...] }
//   results         { weeks: { "1": { club: 1 | 0.5 | 0 | "P" } }, efl: { "4": { eflClub: ... } }, history: [...] }
//   picks/<player>  { player, weeks: { "1": { standard: [...], lock, efl?, by, at } }, history: [...] }
//   auto/results    results fetched from football-data.org, as suggestions for the commissioner
//   fixtures        { checkedAt, weeks: { "8": { kickoff, games: { club: { vs, home, at, off } } } } }
//   backups/<date>  a full copy of the league, saved by the Tuesday job
import crypto from 'node:crypto';
import rules from '../../public/js/rules.js';
import seed from './seed.mjs';
import { runFetch, fetchTeams, fetchFixtures } from './autoresults.mjs';
import { saveBackup, listBackups } from './backup.mjs';

const HISTORY_KEEP = 150;
const RESULT_VALUES = new Set([1, 0.5, 0, 'P']);

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const fail = (status, error, extra) => json(status, { ok: false, error, ...extra });

function passcodeMatches(given, expected) {
  if (!expected || typeof given !== 'string' || !given) return false;
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(String(expected)).digest();
  return crypto.timingSafeEqual(a, b);
}

// When a week's first game kicks off, or null if the fixtures are not known.
const kickoffOf = (fixtures, week) => (fixtures && fixtures.weeks && fixtures.weeks[String(week)] && fixtures.weeks[String(week)].kickoff) || null;
// Closing at kickoff is a setting the commissioner switches on; it is off unless they do.
export function kickedOff(config, fixtures, week, now = Date.now()) {
  if (!config.autoClose) return false;
  const k = kickoffOf(fixtures, week);
  return !!k && now >= Date.parse(k) && !(config.reopenedWeeks || []).includes(week);
}

// A week is closed to players once its week has passed, its first game kicks off (unless the commissioner
// reopened it), the commissioner closes it, or any result is in.
function isClosed(config, results, week, fixtures) {
  const r = results.weeks[String(week)];
  const hasResults = !!r && Object.values(r).some((v) => v !== null && v !== undefined);
  return week < config.currentWeek || (config.lockedWeeks || []).includes(week) || hasResults || kickedOff(config, fixtures, week);
}
const openWeeks = (config, results, fixtures) => {
  const out = [];
  for (let w = 1; w <= rules.WEEKS; w += 1) if (!isClosed(config, results, w, fixtures)) out.push(w);
  return out;
};
const FIXTURES_STALE_MS = 12 * 60 * 60 * 1000;

export function createHandler(getStore, getPasscode, extras = {}) {
  // Fill an empty store from the sheet snapshot. onlyIfNew means a second, overlapping run changes nothing.
  async function ensureSeeded(store) {
    const config = await store.get('config', { type: 'json' });
    if (config) return config;
    await Promise.all([
      store.setJSON('config', seed.config, { onlyIfNew: true }),
      store.setJSON('results', { weeks: seed.results, history: [] }, { onlyIfNew: true }),
      ...seed.config.players.map((p) =>
        store.setJSON('picks/' + p.id, { player: p.id, weeks: seed.picks[p.id] || {}, history: [] }, { onlyIfNew: true })),
    ]);
    return store.get('config', { type: 'json' });
  }

  async function loadAll(store) {
    const config = await ensureSeeded(store);
    const [results, docs, fixtures] = await Promise.all([
      store.get('results', { type: 'json' }),
      Promise.all(config.players.map((p) => store.get('picks/' + p.id, { type: 'json' }))),
      store.get('fixtures', { type: 'json' }),
    ]);
    const picks = {};
    config.players.forEach((p, i) => { picks[p.id] = docs[i] || { player: p.id, weeks: {}, history: [] }; });
    return { config, results: results || { weeks: {}, history: [] }, picks, fixtures: fixtures || null };
  }

  // Keep kickoff times fresh: if they are more than 12 hours old, fetch them again (one call to the feed).
  // A problem with the feed never stops the page loading.
  async function freshFixtures(store, all) {
    const key = typeof extras.footballKey === 'function' ? extras.footballKey() : extras.footballKey;
    const f = all.fixtures;
    const last = f ? Date.parse(f.attemptedAt || f.checkedAt) : 0;
    if (!key || Date.now() - last < FIXTURES_STALE_MS) return all;
    try {
      all.fixtures = await fetchFixtures(store, all.config, key, extras.fetch || fetch);
    } catch (err) {
      console.error('Fixtures check failed: ' + err.message);
      if (f) await store.setJSON('fixtures', { ...f, attemptedAt: new Date().toISOString(), error: err.message });
    }
    return all;
  }

  // Read, change and write one document, retrying if someone else wrote it in between.
  async function update(store, key, change, fallback) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const current = await store.getWithMetadata(key, { type: 'json' });
      const doc = current ? current.data : fallback();
      const next = change(structuredClone(doc));
      const written = current
        ? await store.setJSON(key, next, { onlyIfMatch: current.etag })
        : await store.setJSON(key, next, { onlyIfNew: true });
      if (written.modified) return next;
    }
    throw new Error('Someone else was saving at the same moment. Please try again.');
  }

  const publicView = ({ config, results, picks, fixtures }) => ({
    ok: true,
    config: { eflWeeks: [], eflClubs: [], reopenedWeeks: [], autoClose: false, ...config },
    openWeeks: openWeeks(config, results, fixtures),
    fixtures: fixtures ? fixtures.weeks : {},
    fixturesCheckedAt: fixtures ? fixtures.checkedAt : null,
    results: results.weeks,
    eflResults: results.efl || {},
    picks: Object.fromEntries(Object.entries(picks).map(([id, d]) => [id, d.weeks])),
    serverTime: new Date().toISOString(),
  });

  return async function handler(req) {
    const url = new URL(req.url);
    const route = url.pathname.replace(/^\/api\/?/, '').replace(/\/$/, '');
    const store = getStore();
    let body = {};
    if (req.method === 'POST') {
      try { body = await req.json(); } catch { return fail(400, 'The request was not valid JSON.'); }
    }
    const passcode = typeof getPasscode === 'function' ? getPasscode() : getPasscode;
    const isAdmin = passcodeMatches(body.passcode, passcode);
    const needAdmin = () => {
      if (!passcode) return fail(503, 'The commissioner passcode has not been set up on Netlify yet.');
      if (!isAdmin) return fail(401, 'That passcode is not right.');
      return null;
    };

    try {
      if (route === 'season' && req.method === 'GET') return json(200, publicView(await freshFixtures(store, await loadAll(store))));

      if (route === 'picks' && req.method === 'POST') {
        const all = await loadAll(store);
        const { config, results, fixtures } = all;
        const player = config.players.find((p) => p.id === body.player);
        if (!player) return fail(400, 'Choose a player.');
        const week = Number(body.week);
        if (!Number.isInteger(week) || week < 1 || week > rules.WEEKS) return fail(400, 'Choose a week from 1 to 38.');
        if (!isAdmin && isClosed(config, results, week, fixtures)) {
          const why = kickedOff(config, fixtures, week) ? 'Week ' + week + "'s first game has kicked off, so its picks are locked." : 'Week ' + week + ' is closed, so its picks can no longer be changed.';
          return fail(403, why + ' Ask the commissioner if something is wrong.');
        }

        const clearing = (!body.standard || body.standard.length === 0) && !body.lock;
        // The EFL pick only exists in weeks the commissioner has switched it on for.
        const eflWeek = (config.eflWeeks || []).includes(week);
        const efl = eflWeek && body.efl ? String(body.efl).trim().slice(0, 60) : null;
        if (efl && (config.eflClubs || []).length && !config.eflClubs.includes(efl)) return fail(400, efl + ' is not on the list of EFL clubs.');
        let next = null;
        if (!clearing) {
          const standard = (body.standard || []).map(String);
          const lock = body.lock ? String(body.lock) : null;
          const verdict = rules.check({ clubs: config.clubs, weekPicks: all.picks[player.id].weeks, week, standard, lock, openWeeks: openWeeks(config, results, fixtures), results: results.weeks });
          if (!verdict.ok && !(isAdmin && body.override)) return fail(400, verdict.errors[0], { errors: verdict.errors, canOverride: isAdmin });
          next = { standard, lock, by: isAdmin ? 'Commissioner' : player.name, at: new Date().toISOString() };
          if (efl) next.efl = efl;
        }
        const doc = await update(store, 'picks/' + player.id, (d) => {
          const before = d.weeks[String(week)] || null;
          if (next) d.weeks[String(week)] = next; else delete d.weeks[String(week)];
          d.history = [{ at: new Date().toISOString(), week, by: isAdmin ? 'Commissioner' : player.name, from: before, to: next }, ...(d.history || [])].slice(0, HISTORY_KEEP);
          return d;
        }, () => ({ player: player.id, weeks: {}, history: [] }));
        return json(200, { ok: true, weeks: doc.weeks });
      }

      if (route === 'admin/check' && req.method === 'POST') {
        const denied = needAdmin();
        return denied || json(200, { ok: true });
      }

      if (route === 'admin/results' && req.method === 'POST') {
        const denied = needAdmin();
        if (denied) return denied;
        const { config } = await loadAll(store);
        const week = Number(body.week);
        if (!Number.isInteger(week) || week < 1 || week > rules.WEEKS) return fail(400, 'Choose a week from 1 to 38.');
        const clean = {};
        for (const [club, v] of Object.entries(body.results || {})) {
          if (!config.clubs.includes(club)) return fail(400, club + ' is not a club this season.');
          if (v === null || v === '') continue;
          if (!RESULT_VALUES.has(v)) return fail(400, 'A result must be a win, draw, loss or postponed.');
          clean[club] = v;
        }
        // EFL results for the clubs players picked that week, if it is an EFL week.
        const eflClean = {};
        for (const [club, v] of Object.entries(body.efl || {})) {
          if (v === null || v === '') continue;
          if (!RESULT_VALUES.has(v)) return fail(400, 'A result must be a win, draw, loss or postponed.');
          eflClean[String(club).slice(0, 60)] = v;
        }
        const doc = await update(store, 'results', (d) => {
          const before = d.weeks[String(week)] || null;
          if (Object.keys(clean).length) d.weeks[String(week)] = clean; else delete d.weeks[String(week)];
          if (body.efl !== undefined) {
            d.efl = d.efl || {};
            if (Object.keys(eflClean).length) d.efl[String(week)] = eflClean; else delete d.efl[String(week)];
          }
          d.history = [{ at: new Date().toISOString(), week, by: 'Commissioner', from: before, to: Object.keys(clean).length ? clean : null }, ...(d.history || [])].slice(0, HISTORY_KEEP);
          return d;
        }, () => ({ weeks: {}, history: [] }));
        // Once every club has a result for the current week, open the next one.
        let cfg = config;
        if (week === config.currentWeek && Object.keys(clean).length === config.clubs.length && week < rules.WEEKS) {
          cfg = await update(store, 'config', (c) => { if (c.currentWeek === week) c.currentWeek = week + 1; return c; }, () => config);
        }
        return json(200, { ok: true, results: doc.weeks, eflResults: doc.efl || {}, config: cfg });
      }

      if (route === 'admin/config' && req.method === 'POST') {
        const denied = needAdmin();
        if (denied) return denied;
        await ensureSeeded(store);
        const cfg = await update(store, 'config', (c) => {
          if (body.currentWeek !== undefined) {
            const w = Number(body.currentWeek);
            if (Number.isInteger(w) && w >= 1 && w <= rules.WEEKS) c.currentWeek = w;
          }
          if (Array.isArray(body.lockedWeeks)) c.lockedWeeks = [...new Set(body.lockedWeeks.map(Number).filter((w) => w >= 1 && w <= rules.WEEKS))].sort((a, b) => a - b);
          if (typeof body.autoClose === 'boolean') c.autoClose = body.autoClose;
          if (Array.isArray(body.reopenedWeeks)) c.reopenedWeeks = [...new Set(body.reopenedWeeks.map(Number).filter((w) => w >= 1 && w <= rules.WEEKS))].sort((a, b) => a - b);
          if (Array.isArray(body.eflWeeks)) c.eflWeeks = [...new Set(body.eflWeeks.map(Number).filter((w) => w >= 1 && w <= rules.WEEKS))].sort((a, b) => a - b);
          if (Array.isArray(body.eflClubs)) c.eflClubs = [...new Set(body.eflClubs.map((x) => String(x).trim().slice(0, 60)).filter(Boolean))].sort((a, b) => a.localeCompare(b));
          return c;
        }, () => seed.config);
        return json(200, { ok: true, config: cfg });
      }

      if (route === 'admin/suggested' && req.method === 'POST') {
        const denied = needAdmin();
        if (denied) return denied;
        const doc = await store.get('auto/results', { type: 'json' });
        const key = typeof extras.footballKey === 'function' ? extras.footballKey() : extras.footballKey;
        return json(200, { ok: true, configured: !!key, suggested: doc || { weeks: {}, checkedAt: null, error: null } });
      }

      if (route === 'admin/fetch-results' && req.method === 'POST') {
        const denied = needAdmin();
        if (denied) return denied;
        const key = typeof extras.footballKey === 'function' ? extras.footballKey() : extras.footballKey;
        if (!key) return fail(503, 'Add your football-data.org key on Netlify as FOOTBALL_DATA_KEY, then redeploy, to fetch results.');
        await ensureSeeded(store);
        const week = body.week ? Number(body.week) : undefined;
        const doc = await runFetch(store, key, extras.fetch || fetch, Number.isInteger(week) ? week : undefined);
        if (doc && doc.error) return fail(502, doc.error, { suggested: doc });
        return json(200, { ok: true, configured: true, suggested: doc });
      }

      if (route === 'admin/efl-clubs' && req.method === 'POST') {
        const denied = needAdmin();
        if (denied) return denied;
        const key = typeof extras.footballKey === 'function' ? extras.footballKey() : extras.footballKey;
        if (!key) return fail(503, 'Add your football-data.org key on Netlify as FOOTBALL_DATA_KEY, then redeploy, to load the Championship clubs.');
        await ensureSeeded(store);
        let names;
        try { names = await fetchTeams('ELC', key, extras.fetch || fetch); } catch (err) { return fail(502, err.message); }
        if (!names.length) return fail(502, 'football-data.org sent no Championship clubs.');
        const cfg = await update(store, 'config', (c) => { c.eflClubs = names; return c; }, () => seed.config);
        return json(200, { ok: true, config: cfg });
      }

      if (route === 'admin/log' && req.method === 'POST') {
        const denied = needAdmin();
        if (denied) return denied;
        const { config, results, picks } = await loadAll(store);
        const names = Object.fromEntries(config.players.map((p) => [p.id, p.name]));
        const entries = [
          ...(results.history || []).map((h) => ({ ...h, kind: 'results', player: null })),
          ...Object.entries(picks).flatMap(([id, d]) => (d.history || []).map((h) => ({ ...h, kind: 'picks', player: names[id] || id }))),
        ].sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 300);
        return json(200, { ok: true, entries });
      }

      if (route === 'admin/backup' && req.method === 'POST') {
        const denied = needAdmin();
        if (denied) return denied;
        if (body.key) {
          if (!/^backups\/[0-9T:.\-Z]+$/.test(String(body.key))) return fail(400, 'That is not a backup.');
          const saved = await store.get(String(body.key), { type: 'json' });
          return saved ? json(200, { ok: true, ...saved }) : fail(404, 'That backup is gone.');
        }
        const all = await loadAll(store);
        return json(200, { ok: true, exportedAt: new Date().toISOString(), ...all });
      }

      if (route === 'admin/backups' && req.method === 'POST') {
        const denied = needAdmin();
        if (denied) return denied;
        if (body.saveNow) await saveBackup(store);
        return json(200, { ok: true, backups: await listBackups(store) });
      }

      return fail(404, 'There is nothing at this address.');
    } catch (err) {
      console.error(err);
      return fail(500, err && err.message ? err.message : 'Something went wrong on the server.');
    }
  };
}
