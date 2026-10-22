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
//   reactions/<season> { "8": { target player: { "🔥": [player ids] } } }
//   archive/<season> a finished season, kept whole when a new one starts (shown in History)
//   cups            { cups: [{ id, type, season, weeks: [...], seeds: [player ids], overrides, drawnAt }] }
//   keys            { players: { id: { key, locked, linkedAt, lastSeen, phone, email } } } personal links (and
//                   contact details for sending them, seen only by the commissioner). Once a player opens
//                   theirs, only a phone holding that key can save their picks or see them before kickoff.
//   plans/<season>/<player> { cells: { "9|Arsenal": { on, at } } } The Map's planning squares, private to the
//                   player: read and written only with their personal link's key
//   errors          { items: [{ key, message, source, stack, page, player, ua, count, first, last }] } site errors
//                   sent from phones, for the commissioner
//   push/*          phone notification keys, subscriptions and which reminders have gone out
import crypto from 'node:crypto';
import rules from '../../public/js/rules.js';
import cupsLib from '../../public/js/cups.js';
import seed from './seed.mjs';
import { runFetch, fetchTeams, fetchFixtures, matchClub, ALIASES } from './autoresults.mjs';
import { saveBackup, listBackups } from './backup.mjs';
import * as push from './push.mjs';

const HISTORY_KEEP = 150;
const RESULT_VALUES = new Set([1, 0.5, 0, 'P']);
const REACTIONS = new Set(['\u{1F525}', '\u{1F62C}', '\u{1F602}']);

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
// Personal links: a key per player, never shown publicly. keyOk compares without leaking timing.
const newKey = () => crypto.randomBytes(9).toString('base64url');
const keyOk = (given, k) => !!k && passcodeMatches(typeof given === 'string' ? given : '', k.key);
// A player whose link has been opened needs the key; until then the site takes the name on trust.
const keyNeeded = (keys, id) => !!(keys.players[id] && keys.players[id].locked);

// Everyone's picks for a week stay secret until its first game kicks off (or any result is in, or the week is
// in the past). Before then the site only says who has picked, not what.
export function picksRevealed(config, results, fixtures, week, now = Date.now()) {
  const r = (results.weeks || {})[String(week)];
  if (r && Object.values(r).some((v) => v !== null && v !== undefined)) return true;
  if (week < config.currentWeek) return true;
  const k = kickoffOf(fixtures, week);
  return !!k && now >= Date.parse(k);
}
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
    const [results, docs, fixtures, cups, reactions, archives] = await Promise.all([
      store.get('results', { type: 'json' }),
      Promise.all(config.players.map((p) => store.get('picks/' + p.id, { type: 'json' }))),
      store.get('fixtures', { type: 'json' }),
      store.get('cups', { type: 'json' }),
      store.get('reactions/' + config.season, { type: 'json' }),
      loadArchives(store),
    ]);
    const picks = {};
    config.players.forEach((p, i) => { picks[p.id] = docs[i] || { player: p.id, weeks: {}, history: [] }; });
    // Cup weeks the commissioner has saved but not drawn yet, by cup type.
    const cupSchedule = (cups && cups.schedule && cups.schedule[config.season]) || {};
    return { config, results: results || { weeks: {}, history: [] }, picks, fixtures: fixtures || null, cups: (cups && cups.cups) || [], cupSchedule, reactions: reactions || {}, archives };
  }

  async function loadArchives(store) {
    const { blobs } = await store.list({ prefix: 'archive/' });
    const docs = await Promise.all(blobs.map((b) => store.get(b.key, { type: 'json' })));
    return docs.filter(Boolean).sort((a, b) => a.season.localeCompare(b.season));
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

  // me: the player asking, who always sees their own picks. full: the commissioner, who sees everything.
  function hidePicks({ config, results, picks, fixtures }, me, full) {
    const shown = {};
    const pickedIn = {};
    for (const [id, d] of Object.entries(picks)) {
      shown[id] = {};
      for (const [w, p] of Object.entries(d.weeks || {})) {
        if (full || id === me || picksRevealed(config, results, fixtures, Number(w))) shown[id][w] = p;
        else (pickedIn[w] || (pickedIn[w] = [])).push(id);
      }
    }
    return { shown, pickedIn };
  }

  async function loadKeys(store) {
    return (await store.get('keys', { type: 'json' })) || { players: {} };
  }
  // Make sure every current player has a key. Returns the (maybe updated) keys document.
  async function ensureKeys(store, config) {
    const keys = await loadKeys(store);
    if (config.players.every((p) => keys.players[p.id])) return keys;
    return update(store, 'keys', (d) => {
      for (const p of config.players) if (!d.players[p.id]) d.players[p.id] = { key: newKey(), locked: false, linkedAt: null, lastSeen: null };
      return d;
    }, () => ({ players: {} }));
  }
  // Is this phone allowed to act as this player?
  const actsAs = (keys, id, given) => !keyNeeded(keys, id) || keyOk(given, keys.players[id]);

  const publicView = ({ config, results, picks, fixtures, cups, cupSchedule, reactions, archives }, me = null, full = false, linked = []) => ({
    linked,
    cupSchedule: cupSchedule || {},
    archives: archives || [],
    reactions: reactions || {},
    cups: [
      ...(cups || []).filter((c) => c.season === config.season),
      // Saved weeks, not drawn yet: shown as they would be drawn if the cup started now. Fixed when it starts.
      ...Object.entries(cupSchedule || {}).filter(([type, weeks]) => cupsLib.TYPES[type] && weeks && weeks.length && !(cups || []).some((c) => c.season === config.season && c.type === type)).map(([type, weeks]) => ({
        id: type + '-' + config.season, type, season: config.season, weeks, overrides: {}, provisional: true,
        seeds: cupsLib.table(seasonOf({ config, results, picks }), Math.min(weeks[0], config.currentWeek + 1)).map((r) => r.id),
      })),
    ],
    ok: true,
    config: { eflWeeks: [], eflClubs: [], reopenedWeeks: [], autoClose: false, shameClub: SHAME_CLUB, ...config },
    openWeeks: openWeeks(config, results, fixtures),
    upcomingWeeks: upcomingWeeks(config, results),
    fixtures: fixtures ? fixtures.weeks : {},
    fixturesCheckedAt: fixtures ? fixtures.checkedAt : null,
    results: results.weeks,
    eflResults: results.efl || {},
    picks: hidePicks({ config, results, picks, fixtures }, me, full).shown,
    hiddenPicked: hidePicks({ config, results, picks, fixtures }, me, full).pickedIn,
    serverTime: new Date().toISOString(),
  });

  // Tell everyone a cup has been drawn, with their own first game. Once per cup.
  async function announceDraw(store, season, cup) {
    await push.once(store, 'draw-' + cup.id, async () => {
      const st = cupsLib.state(season, cup);
      if (st.format === 'knockout') {
        const r0 = st.bracket.rounds[0];
        for (const m of r0.matches) {
          for (const [me, them] of [[m.a, m.b], [m.b, m.a]]) {
            if (!me) continue;
            await push.send(store, { title: 'The ' + st.name + ' draw is out', body: them ? 'You play ' + them.name + ' in week ' + r0.week + '.' : 'You have a bye into round 2 as top of the table.', tag: 'cup' }, { players: [me.id], sender: extras.pushSender });
          }
        }
      } else {
        await push.send(store, { title: st.name + ' starts this week', body: 'Most points over weeks ' + cup.weeks.join(', ') + ' wins it. Everyone is in.', tag: 'cup' }, { sender: extras.pushSender });
      }
      return { sent: true };
    });
  }

  // Cups draw themselves: once a cup's first week is the current week, it is seeded from the table as it stands
  // going into that week (every earlier week counted) and fixed. The commissioner only sets the weeks.
  async function autoDraw(store, all) {
    const { config } = all;
    const due = Object.entries(all.cupSchedule || {}).filter(([type, weeks]) => cupsLib.TYPES[type] && weeks && weeks.length && weeks[0] <= config.currentWeek && !all.cups.some((c) => c.season === config.season && c.type === type));
    if (!due.length) return all;
    const season = seasonOf(all);
    const made = [];
    const doc = await update(store, 'cups', (d) => {
      d.cups = d.cups || [];
      const sched = ((d.schedule = d.schedule || {})[config.season] = (d.schedule[config.season] || {}));
      for (const [type, saved] of due) {
        const id = type + '-' + config.season;
        if (d.cups.some((c) => c.id === id) || !sched[type]) continue;
        const seeds = cupsLib.table(season, saved[0]).map((r) => r.id);
        let weeks = sched[type];
        // A knockout needs one week per round; if players came or went since the weeks were saved, adjust.
        if (cupsLib.TYPES[type].format === 'knockout') weeks = Array.from({ length: cupsLib.roundsFor(seeds.length) }, (_, i) => weeks[0] + i).filter((w) => w <= rules.WEEKS);
        const cup = { id, type, season: config.season, weeks, seeds, overrides: {}, drawnAt: new Date().toISOString(), auto: true };
        d.cups.push(cup);
        delete sched[type];
        made.push(cup);
      }
      return d;
    }, () => ({ cups: [] }));
    for (const cup of made) { try { await announceDraw(store, season, cup); } catch (err) { console.error('Could not send the draw alert: ' + err.message); } }
    return { ...all, cups: doc.cups || [], cupSchedule: ((doc.schedule || {})[config.season]) || {} };
  }

  // A save that did not come from the player's own linked phone gets a heads-up on their phone, so anything
  // sneaky is spotted (and undone from the change log) before kickoff. Saves from a phone the player has alerts
  // on are theirs, so no alert for those either.
  async function changeAlert(store, player, week, { isAdmin, withKey, endpoint, clearing }) {
    try {
      if (withKey && !isAdmin) return;
      if (!isAdmin && endpoint) {
        const subs = await push.subscriptions(store);
        if (Object.values(subs).some((s) => s.player === player.id && s.sub && s.sub.endpoint === endpoint)) return;
      }
      const what = clearing ? 'cleared' : 'changed';
      const body = isAdmin ? 'The commissioner ' + what + ' your week ' + week + ' picks.'
        : 'Your week ' + week + ' picks were just ' + what + '. If that was not you, tell the commissioner and it can be undone.';
      await push.send(store, { title: 'Your picks were ' + what, body, tag: 'picks-' + week }, { players: [player.id], sender: extras.pushSender });
    } catch (err) { console.error('Change alert failed: ' + err.message); }
  }

  // Badges earned this week, once each: a perfect week, and a lock streak reaching 10 (then every 5 after).
  async function badgeAlerts(store, week) {
    const all = await loadAll(store);
    const res = all.results.weeks[String(week)] || {};
    if (!all.config.clubs.every((c) => res[c] === 1 || res[c] === 0.5 || res[c] === 0)) return;
    for (const p of all.config.players) {
      const weeks = all.picks[p.id].weeks;
      const mine = weeks[String(week)];
      if (!mine) continue;
      if (rules.isPerfect(mine, res)) {
        await push.once(store, 'badge-perfect-' + all.config.season + '-' + week + '-' + p.id, () => push.send(store, { title: 'Badge: Perfect week', body: 'Every pick won in week ' + week + '. You get a bonus pick in week ' + (week + 1) + '.', tag: 'badge' }, { players: [p.id], sender: extras.pushSender }));
      }
      let streak = 0;
      for (let w = week; w >= 1; w -= 1) {
        const pk = weeks[String(w)];
        const r = all.results.weeks[String(w)] || {};
        if (pk && pk.lock && r[pk.lock] === 1) streak += 1; else break;
      }
      if (streak >= 10 && streak % 5 === 0) {
        await push.once(store, 'badge-locks-' + all.config.season + '-' + streak + '-' + p.id, () => push.send(store, { title: 'Badge: ' + streak + ' locks in a row', body: 'Your lock has won ' + streak + ' weeks running. Keep it going.', tag: 'badge' }, { players: [p.id], sender: extras.pushSender }));
      }
    }
  }

  // After a cup week is final, tell everyone still in a knockout who they play next, once.
  // A competition's teams with both their names, for matching to the league's own club names.
  async function fetchTeamsRaw(code, key) {
    const res = await (extras.fetch || fetch)('https://api.football-data.org/v4/competitions/' + code + '/teams', { headers: { 'X-Auth-Token': key } });
    if (!res.ok) throw new Error('football-data.org answered ' + res.status + '.');
    return ((await res.json()).teams || []).map((t) => ({ name: t.name, shortName: t.shortName }));
  }

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
        await push.once(store, 'commish-pk-' + cup.id + '-' + m.key, () => push.toCommissioner(store, { title: st.name + ': shootout to enter', body: m.a.name + ' v ' + m.b.name + ' is dead level. Enter the penalty shootout winner on the Cups tab.', tag: 'commish' }, { sender: extras.pushSender }));
        for (const [me, them] of [[m.a, m.b], [m.b, m.a]]) {
          await push.once(store, 'cup-' + cup.id + '-pk-' + m.key + '-' + me.id, () => push.send(store, {
            title: st.name + ': penalties!', body: 'Dead level with ' + them.name + ' on points, lock and wins. Settle it with a penalty shootout in FIFA and tell the commissioner who won.', tag: 'cup',
          }, { players: [me.id], sender: extras.pushSender }));
        }
      }
      // Giant killers: knocking out someone seeded at least eight places higher.
      for (const m of st.bracket.rounds[r].matches.filter((x) => x.status === 'final' && x.a && x.b)) {
        const win = m.winner === m.a.id ? m.a : m.b;
        const lose = win === m.a ? m.b : m.a;
        if (win.seed - lose.seed >= 8) {
          await push.once(store, 'badge-giant-' + cup.id + '-' + m.key, () => push.send(store, { title: 'Badge: Giant killer', body: 'Seed ' + win.seed + ' knocks out seed ' + lose.seed + ' (' + lose.name + ') in the ' + st.name + '.', tag: 'badge' }, { players: [win.id], sender: extras.pushSender }));
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
      if (route === 'season' && req.method === 'GET') {
        const full = passcodeMatches(req.headers.get('x-ffwb-pass') || '', passcode);
        const keys = await loadKeys(store);
        const asked = url.searchParams.get('me');
        // Your own picks before kickoff need your key once your link has been opened.
        const me = asked && actsAs(keys, asked, req.headers.get('x-ffwb-key')) ? asked : null;
        const linked = Object.entries(keys.players).filter(([, k]) => k.locked).map(([id]) => id);
        return json(200, publicView(await autoDraw(store, await freshFixtures(store, await loadAll(store))), me, full, linked));
      }

      // An error from someone's phone. The same problem is counted, not stored twice, and the list stays short.
      if (route === 'report' && req.method === 'POST') {
        const clip = (v, n) => String(v == null ? '' : v).slice(0, n);
        const message = clip(body.message, 300);
        if (!message) return fail(400, 'Nothing to report.');
        const source = clip(body.source, 200);
        const key = crypto.createHash('sha1').update(message + '|' + source.replace(/:\d+:\d+$/, '')).digest('hex').slice(0, 16);
        const now = new Date().toISOString();
        await update(store, 'errors', (d) => {
          const hit = d.items.find((x) => x.key === key);
          if (hit) { hit.count = Math.min(hit.count + 1, 99999); hit.last = now; hit.page = clip(body.page, 200); hit.player = clip(body.player, 40) || hit.player; hit.ua = clip(body.ua, 200); }
          else d.items.unshift({ key, message, source, stack: clip(body.stack, 1500), page: clip(body.page, 200), player: clip(body.player, 40), ua: clip(body.ua, 200), count: 1, first: now, last: now });
          d.items = d.items.slice(0, 60);
          return d;
        }, () => ({ items: [] }));
        return json(200, { ok: true });
      }

      if (route === 'admin/errors' && req.method === 'POST') {
        const denied = needAdmin();
        if (denied) return denied;
        if (body.action === 'clear') await store.setJSON('errors', { items: [], clearedAt: new Date().toISOString() });
        const doc = (await store.get('errors', { type: 'json' })) || { items: [] };
        return json(200, { ok: true, items: doc.items, clearedAt: doc.clearedAt || null });
      }

      // The Map's planning squares, synced between a player's own devices. Their key is required, so nobody else
      // can read or change someone's plan. Each square keeps the time it changed, and the newest wins.
      if (route === 'plan' && req.method === 'POST') {
        const keys = await loadKeys(store);
        const id = String(body.player || '');
        if (!keys.players[id] || !keyOk(body.key, keys.players[id])) return fail(403, 'Open your personal link on this device to sync your plan.', { needsLink: true });
        const season = String(body.season || '').replace(/[^\w-]/g, '').slice(0, 12) || 'season';
        const incoming = {};
        for (const [k, v] of Object.entries(body.cells && typeof body.cells === 'object' ? body.cells : {}).slice(0, 3000)) {
          if (!/^\d{1,2}\|[^|]{1,40}$/.test(k) || !v || typeof v.at !== 'number') continue;
          incoming[k] = { on: !!v.on, at: Math.min(v.at, Date.now() + 60e3) };
        }
        const device = String(body.device || '').slice(0, 40);
        const doc = await update(store, 'plans/' + season + '/' + id, (d) => {
          for (const [k, v] of Object.entries(incoming)) {
            if (d.cells[k] && v.at <= d.cells[k].at) continue;
            d.cells[k] = v;
            // Where and when the newest change came from, so each device can show the sync really happened.
            if (!d.lastAt || v.at >= d.lastAt) { d.lastAt = v.at; d.lastDevice = device || d.lastDevice || null; }
          }
          return d;
        }, () => ({ cells: {} }));
        return json(200, { ok: true, cells: doc.cells, lastAt: doc.lastAt || null, lastDevice: doc.lastDevice || null });
      }

      // A phone opening a personal link: tie it to that player from now on.
      if (route === 'link' && req.method === 'POST') {
        const keys = await loadKeys(store);
        const id = Object.keys(keys.players).find((p) => keyOk(body.key, keys.players[p]));
        const { config } = await loadAll(store);
        const player = config.players.find((p) => p.id === id);
        if (!player) return fail(404, 'That link is not right, or it has been replaced. Ask the commissioner for a new one.');
        const now = new Date().toISOString();
        await update(store, 'keys', (d) => {
          const k = d.players[id];
          if (k) { k.locked = true; k.linkedAt = k.linkedAt || now; k.lastSeen = now; }
          return d;
        }, () => ({ players: {} }));
        return json(200, { ok: true, player: id, name: player.name });
      }

      if (route === 'admin/keys' && req.method === 'POST') {
        const denied = needAdmin();
        if (denied) return denied;
        const { config } = await loadAll(store);
        let keys = await ensureKeys(store, config);
        if (body.action === 'contact') {
          if (!keys.players[body.id]) return fail(404, 'That player is gone.');
          const phone = String(body.phone || '').replace(/[^\d+]/g, '').slice(0, 16);
          const email = String(body.email || '').trim().slice(0, 100);
          if (phone && !/^\+?\d{7,15}$/.test(phone)) return fail(400, 'That phone number does not look right.');
          if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(400, 'That email address does not look right.');
          keys = await update(store, 'keys', (d) => { Object.assign(d.players[body.id], { phone: phone || null, email: email || null }); return d; }, () => ({ players: {} }));
        }
        if (body.action === 'reset' || body.action === 'unlock') {
          if (!keys.players[body.id]) return fail(404, 'That player is gone.');
          keys = await update(store, 'keys', (d) => {
            const k = d.players[body.id];
            if (body.action === 'reset') { k.key = newKey(); k.lastSeen = null; } else { k.locked = false; k.linkedAt = null; }
            return d;
          }, () => ({ players: {} }));
        }
        const list = config.players.map((p) => ({ id: p.id, name: p.name, ...keys.players[p.id] }));
        return json(200, { ok: true, players: list });
      }

      if (route === 'picks' && req.method === 'POST') {
        const all = await loadAll(store);
        const { config, results, fixtures } = all;
        const player = config.players.find((p) => p.id === body.player);
        if (!player) return fail(400, 'Choose a player.');
        const keys = await loadKeys(store);
        const withKey = keyOk(body.key, keys.players[player.id]);
        if (!isAdmin && keyNeeded(keys, player.id) && !withKey) {
          return fail(403, player.name + "'s picks can only be made from " + player.name + "'s own phone or laptop. If this is you, open your personal link on this device (the commissioner can send it again).", { needsLink: true });
        }
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
        // Tell the player when their picks change from somewhere other than their own linked phone.
        await changeAlert(store, player, week, { isAdmin, withKey, endpoint: body.endpoint, clearing });
        return json(200, { ok: true, weeks: doc.weeks });
      }

      if (route === 'react' && req.method === 'POST') {
        const { config } = await loadAll(store);
        const ids = new Set(config.players.map((p) => p.id));
        const week = Number(body.week);
        const emoji = String(body.emoji || '');
        if (!ids.has(body.by) || !ids.has(body.target)) return fail(400, 'Choose your name first.');
        if (!actsAs(await loadKeys(store), body.by, body.key)) return fail(403, 'Open your personal link on this device to react as yourself.');
        if (!REACTIONS.has(emoji)) return fail(400, 'That reaction is not one of ours.');
        if (!Number.isInteger(week) || week < 1 || week > rules.WEEKS) return fail(400, 'Choose a week from 1 to 38.');
        const doc = await update(store, 'reactions/' + config.season, (d) => {
          const w = d[String(week)] || (d[String(week)] = {});
          const t = w[body.target] || (w[body.target] = {});
          const list = new Set(t[emoji] || []);
          if (list.has(body.by)) list.delete(body.by); else list.add(body.by);
          if (list.size) t[emoji] = [...list]; else delete t[emoji];
          return d;
        }, () => ({}));
        return json(200, { ok: true, reactions: doc });
      }

      if (route === 'push/key' && req.method === 'GET') {
        return json(200, { ok: true, publicKey: (await push.vapidKeys(store)).publicKey });
      }

      if (route === 'push/subscribe' && req.method === 'POST') {
        if (!push.validSubscription(body.subscription)) return fail(400, 'That phone did not send a usable subscription.');
        const { config } = await loadAll(store);
        if (body.commissioner !== undefined) {
          const denied = needAdmin();
          if (denied) return denied;
          await push.subscribe(store, body.subscription, undefined, { commissioner: !!body.commissioner });
          return json(200, { ok: true });
        }
        // A linked player's own alerts (pick reminders, change alerts) only go to a phone holding their key.
        const named = config.players.some((p) => p.id === body.player) ? body.player : null;
        const player = named && actsAs(await loadKeys(store), named, body.key) ? named : null;
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
          const players = Object.values(subs).filter((s) => s.player);
          const who = [...new Set(players.map((s) => names[s.player] || s.player))];
          const mine = body.endpoint ? subs[Object.keys(subs).find((k) => subs[k].sub.endpoint === body.endpoint)] : null;
          return json(200, { ok: true, count: players.length, who, commissionerPhones: Object.values(subs).filter((s) => s.commish).length, thisPhone: mine ? !!mine.commish : false });
        }
        const msg = String(body.body).slice(0, 240);
        // Only links back into the site: a path like /?whatsnew=1, never another website.
        const url = typeof body.url === 'string' && /^\/(?!\/)[\w\-./?=&#]*$/.test(body.url) ? body.url : '/';
        const r = await push.send(store, { title: body.title ? String(body.title).slice(0, 60) : 'FFWB', body: msg, url, tag: body.tag ? String(body.tag).slice(0, 40) : undefined }, { sender: extras.pushSender });
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
        try { await badgeAlerts(store, week); } catch (err) { console.error('Could not send badge alerts: ' + err.message); }
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
        // Each cup has its own weeks: a week can only belong to one cup, so two cups never get in each other's way.
        // Every other cup's weeks: the drawn ones, and the ones saved but not drawn yet.
        const others = (d, exceptId) => {
          const drawn = ((d && d.cups) || all.cups || []).filter((c) => c.season === config.season && c.id !== exceptId);
          const sched = d ? ((d.schedule || {})[config.season] || {}) : all.cupSchedule;
          const saved = Object.entries(sched).filter(([t]) => t + '-' + config.season !== exceptId && !drawn.some((c) => c.type === t)).map(([t, weeks]) => ({ type: t, weeks, saved: true }));
          return [...drawn, ...saved];
        };
        const clash = (weeks, list) => {
          for (const c of list) {
            const hit = weeks.find((w) => c.weeks.includes(w));
            if (hit) {
              const ct = cupsLib.TYPES[c.type];
              const i = c.weeks.indexOf(hit);
              const what = ct.format === 'knockout' ? ' (' + cupsLib.roundName(i, c.weeks.length).toLowerCase() + ')' : '';
              return 'Week ' + hit + ' is already part of the ' + ct.name + what + (c.saved ? ', saved but not drawn yet' : '') + '. Each week can only belong to one cup.';
            }
          }
          return null;
        };
        // Knockouts run one round a week, in a row, from the first week. Festive Fixtures can be any weeks you
        // choose, in a row or not (say 17 and 19).
        const plan = (list) => {
          if (!T) return { error: 'Choose a cup.' };
          let weeks;
          let seedWeek;
          if (T.format === 'league') {
            const raw = Array.isArray(body.weeks) ? body.weeks.map(Number) : [];
            weeks = [...new Set(raw)].filter((w) => Number.isInteger(w)).sort((a, b) => a - b);
            if (weeks.length !== raw.length || weeks.some((w) => w < 1 || w > rules.WEEKS)) return { error: 'Choose weeks from 1 to 38.' };
            if (weeks.length < 2 || weeks.length > 8) return { error: 'Choose between 2 and 8 weeks for Festive Fixtures.' };
            seedWeek = weeks[0];
          } else {
            const first = Number(body.firstWeek);
            if (!Number.isInteger(first) || first < 1 || first > rules.WEEKS) return { error: 'Choose a first week from 1 to 38.' };
            const n = cupsLib.roundsFor(body.seedCount || config.players.length);
            weeks = Array.from({ length: n }, (_, i) => first + i);
            if (weeks[weeks.length - 1] > rules.WEEKS) return { error: 'The ' + T.name + ' needs ' + n + ' weeks in a row, so it cannot start after week ' + (rules.WEEKS - n + 1) + '.' };
            seedWeek = first;
          }
          const c = clash(weeks, list);
          if (c) return { error: c };
          return { seeds: cupsLib.table(season, seedWeek).map((r) => r.id), weeks };
        };
        const names = Object.fromEntries(config.players.map((p) => [p.id, p.name]));
        if (body.action === 'preview') {
          const p = plan(others(null, type + '-' + config.season));
          if (p.error) return fail(400, p.error);
          return json(200, { ok: true, weeks: p.weeks, seeds: p.seeds.map((id) => names[id]) });
        }
        let made = null;
        let overridden = null;
        let savedWeeks = null;
        const doc = await update(store, 'cups', (d) => {
          d.cups = d.cups || [];
          d.schedule = d.schedule || {};
          const sched = d.schedule[config.season] || (d.schedule[config.season] = {});
          const find = (id) => d.cups.find((c) => c.id === id);
          // Save a cup's weeks: before the draw they are kept for it; a drawn cup moves, until it has started.
          if (body.action === 'save-weeks') {
            const id = type + '-' + config.season;
            const cup = find(id);
            if (cup) {
              if (cup.weeks.some((w) => cupsLib.weekStarted(season, w))) throw Object.assign(new Error('The ' + T.name + ' has started, so its weeks cannot move now. Use Push back a week on a round still to come.'), { status: 400 });
              body.seedCount = cup.seeds.length;
              const p = plan(others(d, id));
              if (p.error) throw Object.assign(new Error(p.error), { status: 400 });
              cup.weeks = p.weeks;
              savedWeeks = p.weeks;
            } else {
              const p = plan(others(d, id));
              if (p.error) throw Object.assign(new Error(p.error), { status: 400 });
              sched[type] = p.weeks;
              savedWeeks = p.weeks;
            }
            return d;
          }
          if (body.action === 'unschedule') {
            delete sched[type];
            return d;
          }
          if (body.action === 'create') {
            const id = type + '-' + config.season;
            const p = plan(others(d, id));
            if (p.error) throw Object.assign(new Error(p.error), { status: 400 });
            if (find(id)) throw Object.assign(new Error('There is already a ' + T.name + ' this season. Delete it first to draw again.'), { status: 400 });
            made = { id, type, season: config.season, weeks: p.weeks, seeds: p.seeds, overrides: {}, drawnAt: new Date().toISOString() };
            d.cups.push(made);
            delete sched[type];
          } else {
            const cup = find(String(body.id));
            // A cup that is only saved (not drawn yet) can be deleted too: that just removes its weeks.
            if (!cup && body.action === 'delete') { for (const t of Object.keys(sched)) if (t + '-' + config.season === String(body.id)) delete sched[t]; return d; }
            if (!cup) throw Object.assign(new Error('That cup is gone.'), { status: 404 });
            // Deleting a draw keeps its weeks saved, so drawing it again starts from the same dates.
            if (body.action === 'delete') { d.cups = d.cups.filter((c) => c !== cup); delete sched[cup.type]; }
            if (body.action === 'push-back') {
              const from = Math.max(0, Number(body.round) || 0);
              if (cup.weeks[cup.weeks.length - 1] >= rules.WEEKS) throw Object.assign(new Error('The cup already ends in week 38.'), { status: 400 });
              const moved = cup.weeks.map((w, i) => (i >= from ? w + 1 : w));
              const c = clash(moved.filter((w, i) => i >= from), others(d, cup.id));
              if (c) throw Object.assign(new Error('Cannot push back: ' + c.charAt(0).toLowerCase() + c.slice(1)), { status: 400 });
              cup.weeks = moved;
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
        if (made) { try { await announceDraw(store, season, made); } catch (err) { console.error('Could not send the draw alert: ' + err.message); } }
        // A shootout result can complete a round, so send the next-round alerts now.
        if (overridden && overridden.cup.weeks[overridden.round]) {
          try { await cupAlerts(store, overridden.cup.weeks[overridden.round]); } catch (err) { console.error('Could not send cup alerts: ' + err.message); }
        }
        return json(200, { ok: true, cups: doc.cups.filter((c) => c.season === config.season), schedule: (doc.schedule || {})[config.season] || {}, weeks: savedWeeks });
      }

      if (route === 'admin/players' && req.method === 'POST') {
        const denied = needAdmin();
        if (denied) return denied;
        await ensureSeeded(store);
        const clean = (n) => String(n || '').replace(/\s+/g, ' ').trim().slice(0, 30);
        const slug = (n) => clean(n).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'player';
        let added = null;
        const cfg = await update(store, 'config', (c) => {
          c.retired = c.retired || [];
          const taken = (name, except) => [...c.players, ...c.retired].some((p) => p.id !== except && p.name.toLowerCase() === name.toLowerCase());
          if (body.action === 'add') {
            const name = clean(body.name);
            if (!name) throw Object.assign(new Error('Type a name.'), { status: 400 });
            if (taken(name)) throw Object.assign(new Error('There is already a ' + name + '.'), { status: 400 });
            let id = slug(name);
            for (let i = 2; [...c.players, ...c.retired].some((p) => p.id === id); i += 1) id = slug(name) + '-' + i;
            c.players.push({ id, name });
            added = id;
          } else if (body.action === 'rename') {
            const p = c.players.find((x) => x.id === body.id) || c.retired.find((x) => x.id === body.id);
            const name = clean(body.name);
            if (!p) throw Object.assign(new Error('That player is gone.'), { status: 404 });
            if (!name) throw Object.assign(new Error('Type a name.'), { status: 400 });
            if (taken(name, p.id)) throw Object.assign(new Error('There is already a ' + name + '.'), { status: 400 });
            p.name = name;
          } else if (body.action === 'retire') {
            const i = c.players.findIndex((x) => x.id === body.id);
            if (i < 0) throw Object.assign(new Error('That player is gone.'), { status: 404 });
            c.retired.push(c.players.splice(i, 1)[0]);
          } else if (body.action === 'restore') {
            const i = c.retired.findIndex((x) => x.id === body.id);
            if (i < 0) throw Object.assign(new Error('That player is gone.'), { status: 404 });
            c.players.push(c.retired.splice(i, 1)[0]);
          }
          return c;
        }, () => seed.config);
        if (added) await store.setJSON('picks/' + added, { player: added, weeks: {}, history: [] }, { onlyIfNew: true });
        return json(200, { ok: true, config: cfg });
      }

      if (route === 'admin/new-season' && req.method === 'POST') {
        const denied = needAdmin();
        if (denied) return denied;
        const all = await loadAll(store);
        const { config } = all;
        const [a, b] = String(config.season).split('-').map(Number);
        const next = a ? (a + 1) + '-' + String((b || a + 1) + 1).slice(-2).padStart(2, '0') : '';
        if (body.action === 'preview') return json(200, { ok: true, current: config.season, next, clubs: config.clubs, players: config.players });
        if (body.action === 'feed-clubs') {
          const key = typeof extras.footballKey === 'function' ? extras.footballKey() : extras.footballKey;
          if (!key) return fail(503, 'Add your football-data.org key on Netlify as FOOTBALL_DATA_KEY to load the clubs.');
          let teams;
          try { teams = await fetchTeamsRaw('PL', key); } catch (err) { return fail(502, err.message); }
          // Use the league's own names for clubs it has had before, like Man U and Wolves.
          const known = [...new Set([...config.clubs, ...Object.keys(ALIASES)])];
          const names = [...new Set(teams.map((t) => matchClub(t, known) || t.shortName || t.name))].sort((x, y) => x.localeCompare(y));
          return json(200, { ok: true, clubs: names });
        }
        if (body.action !== 'start') return fail(400, 'Unknown action.');
        const label = String(body.season || '').trim();
        if (!/^\d{4}-\d{2}$/.test(label) || label === config.season) return fail(400, 'Give the new season a name like ' + next + '.');
        if (String(body.confirm || '').trim() !== label) return fail(400, 'Type ' + label + ' to confirm.');
        const clubs = [...new Set((body.clubs || []).map((c) => String(c).trim()).filter(Boolean))];
        if (clubs.length !== 20) return fail(400, 'A season needs 20 clubs. You have ' + clubs.length + '.');
        const keep = new Set(Array.isArray(body.keep) ? body.keep : config.players.map((p) => p.id));
        if (!config.players.some((p) => keep.has(p.id))) return fail(400, 'Keep at least one player.');
        // 1. A backup of everything as it stands.
        await saveBackup(store);
        // 2. This season, kept whole for History.
        const season = seasonOf(all);
        await store.setJSON('archive/' + config.season, {
          season: config.season, archivedAt: new Date().toISOString(),
          config: { season: config.season, players: config.players, clubs: config.clubs },
          results: season.results, eflResults: season.eflResults, picks: season.picks,
          cups: all.cups.filter((c) => c.season === config.season), fixtures: all.fixtures ? all.fixtures.weeks : {},
        });
        // 3. Anyone who picked both teams from one match this season joins the Shame Club for good.
        const shame = [...(config.shameClub || SHAME_CLUB)];
        const fx = (all.fixtures && all.fixtures.weeks) || {};
        for (const p of config.players) {
          for (const [w, pk] of Object.entries(season.picks[p.id] || {})) {
            const games = (fx[w] && fx[w].games) || {};
            const mine = [...(pk.standard || []), pk.lock].filter(Boolean);
            if (mine.some((c) => games[c] && mine.includes(games[c].vs)) && !shame.some((m) => m.name.toLowerCase() === p.name.toLowerCase())) shame.push({ name: p.name, note: 'Joined ' + config.season });
          }
        }
        // 4. A clean slate.
        const players = config.players.filter((p) => keep.has(p.id));
        const left = config.players.filter((p) => !keep.has(p.id));
        const cfg = await update(store, 'config', (c) => ({
          ...c, season: label, clubs, players, retired: [...(c.retired || []), ...left], currentWeek: 1,
          lockedWeeks: [], reopenedWeeks: [], eflWeeks: [], eflClubs: [], shameClub: shame,
        }), () => config);
        await store.setJSON('results', { weeks: {}, efl: {}, history: [] });
        for (const p of [...players, ...left]) await store.setJSON('picks/' + p.id, { player: p.id, weeks: {}, history: [] });
        await store.setJSON('auto/results', { weeks: {}, checkedAt: null, error: null });
        await store.delete('fixtures');
        return json(200, { ok: true, config: cfg, archived: config.season });
      }

      if (route === 'admin/log' && req.method === 'POST') {
        const denied = needAdmin();
        if (denied) return denied;
        const { config, results, picks } = await loadAll(store);
        const names = Object.fromEntries(config.players.map((p) => [p.id, p.name]));
        const entries = [
          ...(results.history || []).map((h) => ({ ...h, kind: 'results', player: null })),
          ...Object.entries(picks).flatMap(([id, d]) => (d.history || []).map((h) => ({ ...h, kind: 'picks', player: names[id] || id, pid: id }))),
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
