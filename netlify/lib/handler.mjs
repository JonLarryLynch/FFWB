// The FFWB league API. Storage is passed in, so the same code runs on Netlify and in tests.
//
// Store layout:
//   config          { season, players: [{ id, name }], clubs: [...], currentWeek, lockedWeeks: [...],
//                     eflWeeks: [...], eflClubs: [...] }
//   results         { weeks: { "1": { club: 1 | 0.5 | 0 | "P" } }, efl: { "4": { eflClub: ... } }, history: [...] }
//   picks/<player>  { player, weeks: { "1": { standard: [...], lock, efl?, by, at } }, history: [...] }
//   auto/results    results fetched from football-data.org, as suggestions for the commissioner
//   fixtures        { checkedAt, weeks: { "8": { kickoff, games: { club: { vs, home, at, off } } } } }
//   backups/<date>  a full copy of the league, saved by the Tuesday job
//   cups            { cups: [{ id, type, season, weeks: [...], seeds: [player ids], overrides, drawnAt }] }
//   push/*          phone notification keys, subscriptions and which reminders have gone out
import crypto from 'node:crypto';
import rules from '../../public/js/rules.js';
import cupsLib from '../../public/js/cups.js';
import seed from './seed.mjs';
import { runFetch, fetchTeams, fetchFixtures } from './autoresults.mjs';
import { saveBackup, listBackups } from './backup.mjs';
import * as push from './push.mjs';

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

// Players pick one week at a time: only the current week is open. It closes once the commissioner closes it,
// any result is in, or (if that setting is on) its first game kicks off and it has not been reopened.
function isClosed(config, results, week, fixtures) {
  const r = results.weeks[String(week)];
  const hasResults = !!r && Object.values(r).some((v) => v !== null && v !== undefined);
  return week !== config.currentWeek || (config.lockedWeeks || []).includes(week) || hasResults || kickedOff(config, fixtures, week);
}
const openWeeks = (config, results, fixtures) => {
  const out = [];
  for (let w = 1; w <= rules.WEEKS; w += 1) if (!isClosed(config, results, w, fixtures)) out.push(w);
  return out;
};
// Weeks still to be picked this season (the current one and every later one without results). The rules use
// these to judge whether a player can still reach 3 picks of every club, since only one week is open at a time.
const upcomingWeeks = (config, results) => {
  const out = [];
  for (let w = config.currentWeek; w <= rules.WEEKS; w += 1) if (!Object.keys(results.weeks[String(w)] || {}).length) out.push(w);
  return out;
};
// The season in the shape the shared cup code expects.
const seasonOf = ({ config, results, picks }) => ({
  config, results: results.weeks, eflResults: results.efl || {},
  picks: Object.fromEntries(Object.entries(picks).map(([id, d]) => [id, d.weeks])),
});
const FIXTURES_STALE_MS = 12 * 60 * 60 * 1000;
// The Shame Club as it stood in the group chat (Dec 2025). New members are also found automatically
// from picks and fixtures; this list is for the ones before that, and the commissioner can edit it.
const SHAME_CLUB = [{ name: 'Paul' }, { name: 'Greg', note: 'Platinum Member' }, { name: 'Ben' }, { name: 'Alex' }, { name: 'Shep' }, { name: 'Michael', aka: 'Diddler' }];

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
    const [results, docs, fixtures, cups] = await Promise.all([
      store.get('results', { type: 'json' }),
      Promise.all(config.players.map((p) => store.get('picks/' + p.id, { type: 'json' }))),
      store.get('fixtures', { type: 'json' }),
      store.get('cups', { type: 'json' }),
    ]);
    const picks = {};
    config.players.forEach((p, i) => { picks[p.id] = docs[i] || { player: p.id, weeks: {}, history: [] }; });
    return { config, results: results || { weeks: {}, history: [] }, picks, fixtures: fixtures || null, cups: (cups && cups.cups) || [] };
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

  const publicView = ({ config, results, picks, fixtures, cups }) => ({
    cups: (cups || []).filter((c) => c.season === config.season),
    ok: true,
    config: { eflWeeks: [], eflClubs: [], reopenedWeeks: [], autoClose: false, shameClub: SHAME_CLUB, ...config },
    openWeeks: openWeeks(config, results, fixtures),
    upcomingWeeks: upcomingWeeks(config, results),
    fixtures: fixtures ? fixtures.weeks : {},
    fixturesCheckedAt: fixtures ? fixtures.checkedAt : null,
    results: results.weeks,
    eflResults: results.efl || {},
    picks: Object.fromEntries(Object.entries(picks).map(([id, d]) => [id, d.weeks])),
    serverTime: new Date().toISOString(),
  });

  // After a cup week is final, tell everyone still in a knockout who they play next, once.
  async function cupAlerts(store, week) {
    const all = await loadAll(store);
    const season = seasonOf(all);
    for (const cup of all.cups.filter((c) => c.season === all.config.season)) {
      const st = cupsLib.state(season, cup);
      if (st.format !== 'knockout') continue;
      const r = st.bracket.rounds.findIndex((x) => x.week === week);
      if (r < 0) continue;
      // Dead level: the two players settle it with a penalty shootout in FIFA.
      for (const m of st.bracket.rounds[r].matches.filter((x) => x.status === 'shootout')) {
        for (const [me, them] of [[m.a, m.b], [m.b, m.a]]) {
          await push.once(store, 'cup-' + cup.id + '-pk-' + m.key + '-' + me.id, () => push.send(store, {
            title: st.name + ': penalties!', body: 'Dead level with ' + them.name + ' on points, lock and wins. Settle it with a penalty shootout in FIFA and tell the commissioner who won.', tag: 'cup',
          }, { players: [me.id], sender: extras.pushSender }));
        }
      }
      if (!st.bracket.rounds[r].matches.every((m) => m.status === 'final' || m.status === 'bye')) continue;
      const next = st.bracket.rounds[r + 1];
      if (!next) {
        if (st.champion) await push.once(store, 'cup-' + cup.id + '-won', () => push.send(store, { title: st.name, body: st.champion.name + ' wins the ' + st.name + '!', tag: 'cup' }, { sender: extras.pushSender }));
        continue;
      }
      for (const m of next.matches) {
        if (!m.a || !m.b) continue;
        for (const [me, them] of [[m.a, m.b], [m.b, m.a]]) {
          await push.once(store, 'cup-' + cup.id + '-' + next.index + '-' + me.id, () => push.send(store, {
            title: st.name + ': ' + next.name,
            body: "You're through! You play " + them.name + ' in week ' + next.week + '.',
            tag: 'cup',
          }, { players: [me.id], sender: extras.pushSender }));
        }
      }
    }
  }

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
          const why = week > config.currentWeek ? 'Week ' + week + " isn't open yet. You can pick it once week " + config.currentWeek + ' is done.'
            : kickedOff(config, fixtures, week) ? 'Week ' + week + "'s first game has kicked off, so its picks are locked." : 'Week ' + week + ' is closed, so its picks can no longer be changed.';
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
          const verdict = rules.check({ clubs: config.clubs, weekPicks: all.picks[player.id].weeks, week, standard, lock, openWeeks: upcomingWeeks(config, results), results: results.weeks });
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

      if (route === 'push/key' && req.method === 'GET') {
        return json(200, { ok: true, publicKey: (await push.vapidKeys(store)).publicKey });
      }

      if (route === 'push/subscribe' && req.method === 'POST') {
        if (!push.validSubscription(body.subscription)) return fail(400, 'That phone did not send a usable subscription.');
        const { config } = await loadAll(store);
        const player = config.players.some((p) => p.id === body.player) ? body.player : null;
        await push.subscribe(store, body.subscription, player);
        return json(200, { ok: true });
      }

      if (route === 'push/unsubscribe' && req.method === 'POST') {
        if (body.endpoint) await push.unsubscribe(store, String(body.endpoint));
        return json(200, { ok: true });
      }

      if (route === 'admin/push' && req.method === 'POST') {
        const denied = needAdmin();
        if (denied) return denied;
        const subs = await push.subscriptions(store);
        if (!body.body) {
          const { config } = await loadAll(store);
          const names = Object.fromEntries(config.players.map((p) => [p.id, p.name]));
          const who = [...new Set(Object.values(subs).map((s) => names[s.player] || 'someone who has not chosen a name'))];
          return json(200, { ok: true, count: Object.keys(subs).length, who });
        }
        const msg = String(body.body).slice(0, 240);
        const r = await push.send(store, { title: body.title ? String(body.title).slice(0, 60) : 'FFWB', body: msg }, { sender: extras.pushSender });
        return json(200, { ok: true, ...r });
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
        // Once every club has a result for the current week, open the next one and tell everyone.
        let cfg = config;
        if (week === config.currentWeek && Object.keys(clean).length === config.clubs.length && week < rules.WEEKS) {
          cfg = await update(store, 'config', (c) => { if (c.currentWeek === week) c.currentWeek = week + 1; return c; }, () => config);
          try {
            await push.once(store, 'open-' + config.season + '-' + (week + 1), () => push.send(store, { title: 'Week ' + (week + 1) + ' is open', body: 'Week ' + week + ' results are in. Make your week ' + (week + 1) + ' picks.', tag: 'open' }, { sender: extras.pushSender }));
          } catch (err) { console.error('Could not send the week open notice: ' + err.message); }
        }
        try { await cupAlerts(store, week); } catch (err) { console.error('Could not send cup alerts: ' + err.message); }
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
          if (Array.isArray(body.shameClub)) {
            c.shameClub = body.shameClub.slice(0, 60).map((m) => {
              const out = { name: String((m && m.name) || '').trim().slice(0, 40) };
              if (m && m.aka) out.aka = String(m.aka).trim().slice(0, 40);
              if (m && m.note) out.note = String(m.note).trim().slice(0, 60);
              return out;
            }).filter((m) => m.name);
          }
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

      if (route === 'admin/cups' && req.method === 'POST') {
        const denied = needAdmin();
        if (denied) return denied;
        const all = await loadAll(store);
        const { config } = all;
        const season = seasonOf(all);
        const type = String(body.type || '');
        const T = cupsLib.TYPES[type];
        // The seeds and weeks a new cup would get, from the table before its first week.
        const plan = () => {
          const first = Number(body.firstWeek);
          if (!T) return { error: 'Choose a cup.' };
          if (!Number.isInteger(first) || first < 1 || first > rules.WEEKS) return { error: 'Choose a first week from 1 to 38.' };
          const seeds = cupsLib.table(season, first).map((r) => r.id);
          let weeks;
          if (T.format === 'league') {
            const n = Math.max(1, Math.min(8, Number(body.length) || 3));
            weeks = Array.from({ length: n }, (_, i) => first + i);
          } else {
            weeks = Array.from({ length: cupsLib.roundsFor(seeds.length) }, (_, i) => first + i);
          }
          if (weeks[weeks.length - 1] > rules.WEEKS) return { error: 'That cup would run past week 38. Start it earlier.' };
          return { seeds, weeks };
        };
        const names = Object.fromEntries(config.players.map((p) => [p.id, p.name]));
        if (body.action === 'preview') {
          const p = plan();
          if (p.error) return fail(400, p.error);
          return json(200, { ok: true, weeks: p.weeks, seeds: p.seeds.map((id) => names[id]) });
        }
        let made = null;
        let overridden = null;
        const doc = await update(store, 'cups', (d) => {
          d.cups = d.cups || [];
          const find = (id) => d.cups.find((c) => c.id === id);
          if (body.action === 'create') {
            const p = plan();
            if (p.error) throw Object.assign(new Error(p.error), { status: 400 });
            const id = type + '-' + config.season;
            if (find(id)) throw Object.assign(new Error('There is already a ' + T.name + ' this season. Delete it first to draw again.'), { status: 400 });
            made = { id, type, season: config.season, weeks: p.weeks, seeds: p.seeds, overrides: {}, drawnAt: new Date().toISOString() };
            d.cups.push(made);
          } else {
            const cup = find(String(body.id));
            if (!cup) throw Object.assign(new Error('That cup is gone.'), { status: 404 });
            if (body.action === 'delete') d.cups = d.cups.filter((c) => c !== cup);
            if (body.action === 'push-back') {
              const from = Math.max(0, Number(body.round) || 0);
              if (cup.weeks[cup.weeks.length - 1] >= rules.WEEKS) throw Object.assign(new Error('The cup already ends in week 38.'), { status: 400 });
              cup.weeks = cup.weeks.map((w, i) => (i >= from ? w + 1 : w));
            }
            if (body.action === 'override') {
              cup.overrides = cup.overrides || {};
              const key = String(body.key);
              if (body.winner && config.players.some((p) => p.id === body.winner)) cup.overrides[key] = body.winner; else delete cup.overrides[key];
              made = null;
              overridden = { cup, round: key === 'winner' ? cup.weeks.length - 1 : Number(key.split('-')[0]) };
            }
          }
          return d;
        }, () => ({ cups: [] }));
        if (made) {
          // Tell everyone the draw is out, with their own first game.
          try {
            const st = cupsLib.state(season, made);
            if (st.format === 'knockout') {
              const r0 = st.bracket.rounds[0];
              for (const m of r0.matches) {
                for (const [me, them] of [[m.a, m.b], [m.b, m.a]]) {
                  if (!me) continue;
                  await push.send(store, { title: 'The ' + st.name + ' draw is out', body: them ? 'You play ' + them.name + ' in week ' + r0.week + '.' : 'You have a bye into round 2 as top of the table.', tag: 'cup' }, { players: [me.id], sender: extras.pushSender });
                }
              }
            } else {
              await push.send(store, { title: st.name + ' starts week ' + made.weeks[0], body: 'Most points over weeks ' + made.weeks.join(', ') + ' wins it.', tag: 'cup' }, { sender: extras.pushSender });
            }
          } catch (err) { console.error('Could not send the draw alert: ' + err.message); }
        }
        // A shootout result can complete a round, so send the next-round alerts now.
        if (overridden && overridden.cup.weeks[overridden.round]) {
          try { await cupAlerts(store, overridden.cup.weeks[overridden.round]); } catch (err) { console.error('Could not send cup alerts: ' + err.message); }
        }
        return json(200, { ok: true, cups: doc.cups.filter((c) => c.season === config.season) });
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
      if (err && err.status) return fail(err.status, err.message);
      console.error(err);
      return fail(500, err && err.message ? err.message : 'Something went wrong on the server.');
    }
  };
}
