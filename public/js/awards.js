// FFWB weekly awards and the kickoff reveal, shared by the website and the tests.
// Awards are only given once a week is final (every club has a result):
//   Top scorer   the most points that week (ties share it)
//   Bottled it   a lock that lost; if several did, the one who scored least that week
//   Lone wolf    a winning pick nobody else made; the player with the most of them
//   Worst week   the fewest points that week (ties share it)
// The reveal is worked out from everyone's picks once a week kicks off.
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const api = factory(isNode ? require('./rules.js') : root.FFWBRules, isNode ? require('./cups.js') : root.FFWBCups);
  if (isNode) module.exports = api;
  else root.FFWBAwards = api;
})(typeof self !== 'undefined' ? self : this, function (R, C) {
  const picksOf = (p) => [...((p && p.standard) || []), ...(p && p.lock ? [p.lock] : [])];
  const names = (season) => Object.fromEntries(season.config.players.map((p) => [p.id, p.name]));

  function week(season, w) {
    if (!C.weekFinal(season, w)) return null;
    const res = season.results[String(w)] || {};
    const nm = names(season);
    const played = season.config.players.filter((p) => ((season.picks || {})[p.id] || {})[String(w)]);
    if (!played.length) return null;
    const rows = played.map((p) => ({ id: p.id, name: p.name, pick: season.picks[p.id][String(w)], ...C.weekScore(season, p.id, w) }));
    const hi = Math.max(...rows.map((r) => r.points));
    const lo = Math.min(...rows.map((r) => r.points));
    const pick = (list) => ({ ids: list.map((r) => r.id), names: list.map((r) => r.name) });
    const top = { ...pick(rows.filter((r) => r.points === hi)), points: hi };
    // Worst week only means something when people scored differently.
    const worst = hi === lo ? null : { ...pick(rows.filter((r) => r.points === lo)), points: lo };
    const lost = rows.filter((r) => r.pick.lock && res[r.pick.lock] === 0);
    let bottled = null;
    if (lost.length) {
      const least = Math.min(...lost.map((r) => r.points));
      const who = lost.filter((r) => r.points === least);
      bottled = { ...pick(who), clubs: who.map((r) => r.pick.lock), points: least, count: lost.length };
    }
    // Lone wolves: winning picks only one person made.
    const count = {};
    for (const r of rows) for (const c of picksOf(r.pick)) count[c] = (count[c] || 0) + 1;
    const solos = rows.map((r) => ({ r, clubs: picksOf(r.pick).filter((c) => count[c] === 1 && res[c] === 1) })).filter((x) => x.clubs.length);
    let lone = null;
    if (solos.length) {
      const most = Math.max(...solos.map((x) => x.clubs.length));
      const who = solos.filter((x) => x.clubs.length === most);
      lone = { ...pick(who.map((x) => x.r)), clubs: who.map((x) => x.clubs) };
    }
    return { week: w, top, bottled, lone, worst, players: rows.length, nm };
  }

  // Every final week's awards this season, and each player's tally.
  function season(season) {
    const weeks = Object.keys(season.results).map(Number).sort((a, b) => a - b).map((w) => week(season, w)).filter(Boolean);
    const tally = {};
    const add = (ids, k) => { for (const id of ids) { const t = tally[id] || (tally[id] = { top: 0, bottled: 0, lone: 0, worst: 0 }); t[k] += 1; } };
    for (const a of weeks) {
      add(a.top.ids, 'top');
      if (a.bottled) add(a.bottled.ids, 'bottled');
      if (a.lone) add(a.lone.ids, 'lone');
      if (a.worst) add(a.worst.ids, 'worst');
    }
    return { weeks, tally };
  }

  const list = (l) => (l.length > 2 ? l.slice(0, -1).join(', ') + ' and ' + l[l.length - 1] : l.join(' and '));
  const fmt = (n) => String(Math.round(n * 10) / 10);
  // One line per award, for recaps and cards.
  function lines(a) {
    if (!a) return [];
    const out = [];
    out.push({ key: 'top', label: 'Top scorer', text: (a.top.names.length > 3 ? a.top.names.length + ' players' : list(a.top.names)) + ', ' + fmt(a.top.points) + ' pts' });
    if (a.bottled) out.push({ key: 'bottled', label: 'Bottled it', text: list(a.bottled.names.map((n, i) => n + ' (' + a.bottled.clubs[i] + ' lock)')) + (a.bottled.count > a.bottled.ids.length ? ', the worst of ' + a.bottled.count + ' lost locks' : '') });
    if (a.lone) out.push({ key: 'lone', label: 'Lone wolf', text: list(a.lone.names.map((n, i) => n + ' (' + a.lone.clubs[i].join(', ') + ')')) });
    if (a.worst) out.push({ key: 'worst', label: 'Worst week', text: (a.worst.names.length > 3 ? a.worst.names.length + ' players' : list(a.worst.names)) + ', ' + fmt(a.worst.points) + ' pts' });
    return out;
  }

  // The reveal: what everyone picked, once the week has kicked off.
  function reveal(season, w, pairsIn) {
    const rows = season.config.players.map((p) => ({ id: p.id, name: p.name, pick: ((season.picks || {})[p.id] || {})[String(w)] })).filter((r) => r.pick);
    if (!rows.length) return null;
    const count = {};
    const locks = {};
    for (const r of rows) {
      for (const c of picksOf(r.pick)) count[c] = (count[c] || 0) + 1;
      if (r.pick.lock) locks[r.pick.lock] = (locks[r.pick.lock] || 0) + 1;
    }
    const byCount = (o) => Object.entries(o).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const clubs = byCount(count).map(([club, n]) => ({ club, n, who: rows.filter((r) => picksOf(r.pick).includes(club)).map((r) => r.name) }));
    const lockList = byCount(locks).map(([club, n]) => ({ club, n, who: rows.filter((r) => r.pick.lock === club).map((r) => r.name) }));
    // Against the crowd: picks nobody else made, and whose picks overlapped least with everyone else's.
    const crowd = rows.map((r) => {
      const mine = picksOf(r.pick);
      const solo = mine.filter((c) => count[c] === 1);
      const overlap = mine.reduce((a, c) => a + (count[c] - 1), 0) / Math.max(1, mine.length) / Math.max(1, rows.length - 1);
      return { id: r.id, name: r.name, solo, overlap };
    }).sort((a, b) => b.solo.length - a.solo.length || a.overlap - b.overlap);
    const contrarians = crowd.filter((x) => x.solo.length).slice(0, 4);
    const shame = pairsIn ? rows.map((r) => ({ name: r.name, pairs: pairsIn(season, w, picksOf(r.pick)) })).filter((x) => x.pairs.length) : [];
    const unanimous = clubs.filter((c) => c.n === rows.length).map((c) => c.club);
    return { week: w, players: rows.length, of: season.config.players.length, clubs, locks: lockList, contrarians, shame, unanimous };
  }

  return { week, season, lines, reveal };
});
