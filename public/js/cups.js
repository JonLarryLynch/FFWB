// FFWB cups, shared by the website and the server. No extra picks: every cup game is decided by that week's
// normal league points (EFL pick included).
//   Knockout (League Cup, FA Cup): seeded from the table at the draw, the top seeds get byes, one round a week.
//     A level game goes to the better lock, then more winning picks, then a penalty shootout played in FIFA,
//     which the commissioner enters.
//   Mini-league (Festive Fixtures): most points over the chosen weeks wins, split the same way.
(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./rules.js') : root.FFWBRules);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FFWBCups = api;
})(typeof self !== 'undefined' ? self : this, function (R) {
  const TYPES = {
    league: { name: 'League Cup', format: 'knockout', season: 'Autumn', honour: 'league_cup' },
    festive: { name: 'Festive Fixtures', format: 'league', season: 'Christmas', honour: 'festive' },
    fa: { name: 'FA Cup', format: 'knockout', season: 'Spring', honour: 'fa_cup' },
  };
  const FINAL = new Set([1, 0.5, 0]);

  // A week is final once every club has a win, draw or loss (a postponed game keeps it open).
  function weekFinal(season, week) {
    const res = season.results[String(week)] || {};
    return season.config.clubs.every((c) => FINAL.has(res[c]));
  }
  const weekStarted = (season, week) => Object.keys(season.results[String(week)] || {}).length > 0;

  // One player's week: points (lock doubled, EFL added), winning picks, and the lock's own points.
  function weekScore(season, id, week) {
    const p = ((season.picks || {})[id] || {})[String(week)];
    const res = season.results[String(week)] || {};
    if (!p) return { points: 0, wins: 0, lock: 0, picked: false };
    const eres = ((season.eflResults || {})[String(week)]) || {};
    const std = p.standard || [];
    const lock = p.lock ? R.pickPoints(res[p.lock], true) : 0;
    const points = std.reduce((a, c) => a + R.pickPoints(res[c], false), 0) + lock + (p.efl ? R.pickPoints(eres[p.efl], false) : 0);
    const wins = [...std, p.lock].filter((c) => c && res[c] === 1).length;
    return { points, wins, lock, picked: true };
  }

  // The league table from every week with results before `beforeWeek`, ranked by the league's tiebreaks.
  function table(season, beforeWeek = Infinity) {
    const rows = season.config.players.map((p) => ({ id: p.id, name: p.name, points: 0, wins: 0, lockWins: 0, lockPoints: 0 }));
    for (const r of rows) {
      for (const w of Object.keys(season.results).map(Number)) {
        if (w >= beforeWeek || !weekStarted(season, w)) continue;
        const s = weekScore(season, r.id, w);
        r.points += s.points; r.wins += s.wins; r.lockPoints += s.lock; if (s.lock === 2) r.lockWins += 1;
      }
    }
    return rows.sort((a, b) => b.points - a.points || b.wins - a.wins || b.lockWins - a.lockWins || b.lockPoints - a.lockPoints || a.name.localeCompare(b.name));
  }

  // Bracket slots for a power-of-two draw: seed 1 meets the lowest seed, and 1 and 2 can only meet in the final.
  function seedOrder(size) {
    let order = [1];
    while (order.length < size) { const n = order.length * 2; order = order.flatMap((s) => [s, n + 1 - s]); }
    return order;
  }
  const roundName = (i, total) => (i === total - 1 ? 'Final' : i === total - 2 ? 'Semi-finals' : i === total - 3 ? 'Quarter-finals' : i === 0 ? 'First round' : 'Round ' + (i + 1));
  const roundsFor = (n) => Math.max(1, Math.ceil(Math.log2(Math.max(2, n))));

  // Decide one game. Returns the winner's id, or null while the week is still being played.
  function decide(season, cup, key, a, b, week) {
    if (cup.overrides && cup.overrides[key]) {
      const level = weekFinal(season, week) && a && b && (() => { const x = weekScore(season, a.id, week); const y = weekScore(season, b.id, week); return x.points === y.points && x.lock === y.lock && x.wins === y.wins; })();
      return { winner: cup.overrides[key], how: level ? 'Won the penalty shootout' : 'Set by the commissioner' };
    }
    if (!a || !b) return { winner: a || b, how: 'Bye' };
    if (!weekFinal(season, week)) return { winner: null };
    const sa = weekScore(season, a.id, week);
    const sb = weekScore(season, b.id, week);
    if (sa.points !== sb.points) return { winner: sa.points > sb.points ? a.id : b.id, how: '' };
    if (sa.lock !== sb.lock) return { winner: sa.lock > sb.lock ? a.id : b.id, how: 'Level on points, through on the lock' };
    if (sa.wins !== sb.wins) return { winner: sa.wins > sb.wins ? a.id : b.id, how: 'Level on points and the lock, through on winning picks' };
    return { winner: null, shootout: true };
  }

  // The whole knockout, round by round, from the seeds fixed at the draw.
  function bracket(season, cup) {
    const names = Object.fromEntries(season.config.players.map((p) => [p.id, p.name]));
    const seeds = cup.seeds.map((id, i) => ({ id, name: names[id] || id, seed: i + 1 }));
    const total = roundsFor(seeds.length);
    const size = 2 ** total;
    let slots = seedOrder(size).map((s) => seeds[s - 1] || null);
    const rounds = [];
    for (let r = 0; r < total; r += 1) {
      const week = cup.weeks[r];
      const matches = [];
      const next = [];
      for (let i = 0; i < slots.length; i += 2) {
        const a = slots[i];
        const b = slots[i + 1];
        const key = r + '-' + (i / 2);
        // Byes only happen in the first round; later on, an empty slot is a game still to be decided.
        const bye = r === 0 && (!a || !b);
        const m = { key, round: r, week, a, b, bye, scoreA: null, scoreB: null, winner: null, how: '', status: 'upcoming' };
        if (a && b && weekStarted(season, week)) {
          m.scoreA = weekScore(season, a.id, week);
          m.scoreB = weekScore(season, b.id, week);
        }
        if (bye) { m.status = 'bye'; m.winner = (a || b) ? (a || b).id : null; }
        else if (!a || !b) { m.status = 'waiting'; }
        else {
          const d = decide(season, cup, key, a, b, week);
          m.winner = d.winner; m.how = d.how || '';
          m.status = d.winner ? 'final' : d.shootout ? 'shootout' : weekStarted(season, week) ? 'live' : 'upcoming';
        }
        matches.push(m);
        next.push(m.winner ? (m.winner === (a && a.id) ? a : b) : null);
      }
      rounds.push({ index: r, name: roundName(r, total), week, matches });
      slots = next;
    }
    const last = rounds[rounds.length - 1].matches[0];
    const champion = last && last.status === 'final' ? (last.winner === (last.a && last.a.id) ? last.a : last.b) : null;
    return { rounds, champion, total };
  }

  // Festive Fixtures: a points table over the chosen weeks.
  function miniLeague(season, cup) {
    const names = Object.fromEntries(season.config.players.map((p) => [p.id, p.name]));
    const ids = cup.seeds && cup.seeds.length ? cup.seeds : season.config.players.map((p) => p.id);
    const rows = ids.map((id) => {
      const weeks = cup.weeks.map((w) => (weekStarted(season, w) ? weekScore(season, id, w) : null));
      return {
        id, name: names[id] || id, weeks,
        points: weeks.reduce((a, s) => a + (s ? s.points : 0), 0),
        wins: weeks.reduce((a, s) => a + (s ? s.wins : 0), 0),
        lockWins: weeks.reduce((a, s) => a + (s && s.lock === 2 ? 1 : 0), 0),
        lockPoints: weeks.reduce((a, s) => a + (s ? s.lock : 0), 0),
      };
    }).sort((x, y) => y.points - x.points || y.lockPoints - x.lockPoints || y.wins - x.wins || x.name.localeCompare(y.name));
    const done = cup.weeks.every((w) => weekFinal(season, w));
    const override = cup.overrides && cup.overrides.winner;
    // Level at the top on points, locks and wins: a penalty shootout in FIFA decides it.
    const top = rows[0];
    const shootout = done && !override && rows.length > 1 && rows[1].points === top.points && rows[1].lockPoints === top.lockPoints && rows[1].wins === top.wins
      ? rows.filter((r) => r.points === top.points && r.lockPoints === top.lockPoints && r.wins === top.wins) : null;
    const champion = override ? rows.find((r) => r.id === override) : done && !shootout ? top : null;
    return { rows, champion, done, shootout };
  }

  // A cup's state in one go: what stage it is at, and its winner.
  function state(season, cup) {
    const t = TYPES[cup.type] || TYPES.league;
    if (t.format === 'league') {
      const m = miniLeague(season, cup);
      const started = cup.weeks.some((w) => weekStarted(season, w));
      return { ...t, cup, mini: m, champion: m.champion, status: m.champion ? 'done' : started ? 'live' : 'upcoming' };
    }
    const b = bracket(season, cup);
    const current = b.rounds.find((r) => r.matches.some((m) => m.status === 'live' || m.status === 'upcoming' || m.status === 'waiting' || m.status === 'shootout')) || null;
    const started = b.rounds.some((r) => r.matches.some((m) => m.status === 'final' || m.status === 'live'));
    return { ...t, cup, bracket: b, champion: b.champion, current, status: b.champion ? 'done' : started ? 'live' : 'upcoming' };
  }

  // A player's cup game in a given week, if they have one.
  function gameFor(season, cups, id, week) {
    for (const cup of cups || []) {
      const s = state(season, cup);
      if (s.format === 'league') {
        if (cup.weeks.includes(week) && (!cup.seeds || cup.seeds.includes(id))) {
          const pos = s.mini.rows.findIndex((r) => r.id === id) + 1;
          return { cup: s, kind: 'league', label: s.name, detail: 'Week ' + (cup.weeks.indexOf(week) + 1) + ' of ' + cup.weeks.length, pos };
        }
        continue;
      }
      for (const r of s.bracket.rounds) {
        if (r.week !== week) continue;
        const m = r.matches.find((x) => (x.a && x.a.id === id) || (x.b && x.b.id === id));
        if (!m) continue;
        const me = m.a && m.a.id === id ? m.a : m.b;
        const them = m.a && m.a.id === id ? m.b : m.a;
        return { cup: s, kind: 'knockout', label: s.name, round: r.name, match: m, me, them };
      }
    }
    return null;
  }

  return { TYPES, weekFinal, weekStarted, weekScore, table, seedOrder, roundsFor, roundName, bracket, miniLeague, state, gameFor };
});
