// FFWB planning helpers for the Picks tab: the half-season pick planner, "you at a glance", club form, and
// the 38-week calendar strip. Shared by the picks editor (players and commissioner).
(function () {
  const R = window.FFWBRules;
  const C = window.FFWBCups;
  const ABBR = {
    Arsenal: 'ARS', 'Aston Villa': 'AVL', Bournemouth: 'BOU', Brentford: 'BRE', Brighton: 'BHA', Burnley: 'BUR', Chelsea: 'CHE', 'Coventry City': 'COV',
    'Crystal Palace': 'CRY', Everton: 'EVE', Fulham: 'FUL', 'Hull City': 'HUL', 'Ipswich Town': 'IPS', Leeds: 'LEE', Leicester: 'LEI', Liverpool: 'LIV', 'Man City': 'MCI',
    'Man U': 'MUN', Newcastle: 'NEW', 'Nottingham Forest': 'NFO', Southampton: 'SOU', Sunderland: 'SUN', Tottenham: 'TOT', 'West Ham': 'WHU', Wolves: 'WOL',
  };
  const abbr = (c) => ABBR[c] || String(c).replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase();
  const hasResults = (season, w) => Object.keys(season.results[String(w)] || {}).length > 0;

  // The plan for a player's half: what is still owed, how many picks are left, and anything to worry about.
  // draft: the picks on screen for `week` (not saved yet), counted as if saved.
  function plan(season, id, week, draft) {
    const half = R.halfOf(week);
    const weeks = R.weeksInHalf(half);
    const saved = (season.picks[id] || {});
    const counts = {};
    const locks = {};
    const done = new Set();
    for (const w of weeks) {
      const p = w === week && draft ? draft : saved[String(w)];
      if (!p) continue;
      const clubs = [...(p.standard || []), ...(p.lock ? [p.lock] : [])];
      if (!clubs.length) continue;
      done.add(w);
      for (const c of clubs) counts[c] = (counts[c] || 0) + 1;
      if (p.lock) locks[p.lock] = (locks[p.lock] || 0) + 1;
    }
    // Weeks still to pick in this half: the current week onwards, not already picked, without results.
    const left = weeks.filter((w) => w >= season.config.currentWeek && !done.has(w) && !hasResults(season, w));
    const slots = left.length * (R.STANDARD_PICKS + 1);
    const clubs = season.config.clubs.map((c) => ({ club: c, have: counts[c] || 0, locks: locks[c] || 0, need: Math.max(0, R.MIN_PER_HALF - (counts[c] || 0)) }));
    const owed = clubs.reduce((a, c) => a + c.need, 0);
    const stuck = clubs.filter((c) => c.need > left.length);
    const edge = clubs.filter((c) => c.need > 0 && c.need === left.length);
    // Weeks where two clubs you still owe play each other, when you owe them so much between them that they
    // will have to share weeks. Picking both in the week they meet is a Shame Club week.
    const clashes = [];
    for (const w of left) {
      const games = (((season.fixtures || {})[String(w)] || {}).games) || {};
      const seen = new Set();
      for (const c of clubs) {
        const g = games[c.club];
        if (!c.need || !g || seen.has(c.club)) continue;
        const o = clubs.find((x) => x.club === g.vs);
        if (o && o.need && c.need + o.need >= left.length) { clashes.push({ week: w, a: g.home ? c.club : g.vs, b: g.home ? g.vs : c.club }); seen.add(c.club); seen.add(g.vs); }
      }
    }
    let level = 'ok';
    let text;
    if (stuck.length || owed > slots) {
      level = 'bad';
      text = stuck.length
        ? stuck[0].club + ' needs ' + stuck[0].need + ' more and only ' + left.length + ' week' + (left.length === 1 ? ' is' : 's are') + ' left this half.'
        : 'You owe ' + owed + ' picks with only ' + slots + ' left this half.';
    } else if (edge.length || slots - owed <= R.STANDARD_PICKS + 1) {
      level = 'tight';
      text = edge.length
        ? edge.map((c) => c.club).slice(0, 2).join(' and ') + ' must be picked every week from now on.'
        : 'Tight: ' + owed + ' picks still owed with ' + slots + ' left. Only ' + (slots - owed) + ' free picks to spare.';
    } else {
      text = owed ? owed + ' picks still owed, ' + (slots - owed) + ' free picks to spare this half.' : 'Every club has its 3 picks this half. Pick whoever you like.';
    }
    return { half, weeks, left, slots, owed, clubs, stuck, edge, clashes, level, text };
  }

  // Each club's last five results this season, oldest first, and how many players picked it last week.
  function form(season, club, beforeWeek) {
    const out = [];
    for (let w = beforeWeek - 1; w >= 1 && out.length < 5; w -= 1) {
      const v = (season.results[String(w)] || {})[club];
      if (v === 1 || v === 0.5 || v === 0) out.unshift(v === 1 ? 'W' : v === 0.5 ? 'D' : 'L');
    }
    return out;
  }
  function pickedLastWeek(season, beforeWeek) {
    let w = beforeWeek - 1;
    while (w >= 1 && !hasResults(season, w)) w -= 1;
    const counts = {};
    if (w < 1) return { week: null, counts };
    for (const weeks of Object.values(season.picks)) {
      const p = weeks[String(w)];
      if (!p) continue;
      for (const c of [...(p.standard || []), ...(p.lock ? [p.lock] : [])]) counts[c] = (counts[c] || 0) + 1;
    }
    return { week: w, counts };
  }

  // You at a glance: rank, points, movement, lock streak and cup status.
  function glance(season, id) {
    if (!C) return null;
    const scored = Object.keys(season.results).map(Number).filter((w) => hasResults(season, w)).sort((a, b) => a - b);
    if (!scored.length) return null;
    const now = C.table(season);
    const before = C.table(season, scored[scored.length - 1]);
    const pos = (t) => { const i = t.findIndex((r) => r.id === id); if (i < 0) return null; let k = i; while (k > 0 && t[k - 1].points === t[i].points && t[k - 1].wins === t[i].wins) k -= 1; return k + 1; };
    const rank = pos(now);
    const was = scored.length > 1 ? pos(before) : null;
    const me = now.find((r) => r.id === id);
    let streak = 0;
    for (let i = scored.length - 1; i >= 0; i -= 1) {
      const p = (season.picks[id] || {})[String(scored[i])];
      const v = p && p.lock ? season.results[String(scored[i])][p.lock] : null;
      if (v === 1) streak += 1; else break;
    }
    let cup = null;
    for (const cupDoc of season.cups || []) {
      const st = C.state(season, cupDoc);
      if (st.status === 'done') { if (st.champion && st.champion.id === id) cup = st.name + ' winner'; continue; }
      if (st.format === 'league') { const r = st.mini.rows.findIndex((x) => x.id === id); if (r >= 0 && st.status === 'live') cup = st.name + ': ' + (r + 1) + (['th', 'st', 'nd', 'rd'][((r + 1) % 100 >> 3 ^ 1) && (r + 1) % 10] || 'th'); continue; }
      const cur = st.current;
      if (!cur) continue;
      const inRound = cur.matches.find((m) => (m.a && m.a.id === id) || (m.b && m.b.id === id));
      if (inRound) { const them = inRound.a && inRound.a.id === id ? inRound.b : inRound.a; cup = st.name + ' ' + cur.name.replace('Quarter-finals', 'QF').replace('Semi-finals', 'SF').replace('First round', 'R1') + (them ? ' v ' + them.name : ', bye'); }
      else if (cur.index > 0) cup = 'Out of the ' + st.name;
    }
    return { rank, was, points: me ? me.points : 0, streak, cup, players: now.length };
  }

  // What is on each week of the season, for the calendar strip.
  function calendar(season) {
    const out = [];
    for (let w = 1; w <= R.WEEKS; w += 1) {
      const marks = [];
      for (const cup of season.cups || []) {
        const i = cup.weeks.indexOf(w);
        if (i < 0) continue;
        const t = C ? C.TYPES[cup.type] : { name: cup.type, format: 'knockout' };
        marks.push({ type: cup.type, text: t.name + (t.format === 'knockout' && C ? ', ' + C.roundName(i, cup.weeks.length) : '') });
      }
      out.push({ week: w, done: hasResults(season, w), current: w === season.config.currentWeek, efl: (season.config.eflWeeks || []).includes(w), marks, halfEnd: w === R.HALF_END });
    }
    return out;
  }

  // Planning marks on The Map: "I mean to take this club that week". Kept on this phone only, never sent.
  const markKey = (season, id) => 'ffwb-map-' + season.config.season + '-' + id;
  function marks(season, id) {
    try { return new Set(JSON.parse(localStorage.getItem(markKey(season, id)) || '[]')); } catch (err) { return new Set(); }
  }
  function saveMarks(season, id, set) {
    try { localStorage.setItem(markKey(season, id), JSON.stringify([...set])); } catch (err) { /* only a convenience */ }
  }
  function toggleMark(season, id, week, club) {
    const m = marks(season, id);
    const k = week + '|' + club;
    if (m.has(k)) m.delete(k); else m.add(k);
    saveMarks(season, id, m);
    return m;
  }
  function clearMarks(season, id, weeks) {
    const keep = new Set([...marks(season, id)].filter((k) => !weeks.includes(Number(k.split('|')[0]))));
    saveMarks(season, id, keep);
  }

  window.FFWBPlanner = { plan, form, pickedLastWeek, glance, calendar, abbr, marks, toggleMark, clearMarks };
})();
