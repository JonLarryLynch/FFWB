// FFWB money: where the league fund goes, worked out from the picks and results. Shared by the site and tests.
//   The fund starts at $570 (the commissioner can change the figures).
//   Every greenout (a perfect week: every pick, lock included, won) pays that player $5 from the fund.
//   Make all your picks all season and you get $10 back; each week you miss takes $5 off that (never below $0).
//   Whatever is left is the prize pot: 25% to the first half champion, 50% to the second half champion and
//   25% to the second half runner-up. The overall champion plays for pride.
//   A tie for a place shares the money for the places the tied players fill.
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const api = factory(isNode ? require('./rules.js') : root.FFWBRules, isNode ? require('./cups.js') : root.FFWBCups);
  if (isNode) module.exports = api;
  else root.FFWBMoney = api;
})(typeof self !== 'undefined' ? self : this, function (R, C) {
  const DEFAULTS = { fund: 570, greenout: 5, picks: 10, missed: 5, split: { first: 25, second: 50, runnerUp: 25 } };
  const settings = (season) => {
    const m = (season.config && season.config.money) || {};
    return { ...DEFAULTS, ...m, split: { ...DEFAULTS.split, ...(m.split || {}) } };
  };
  const round2 = (n) => Math.round(n * 100) / 100;

  // A half's table, ranked the same way as the league table.
  function halfTable(season, half) {
    const weeks = R.weeksInHalf(half);
    const rows = season.config.players.map((p) => ({ id: p.id, name: p.name, points: 0, wins: 0, lockWins: 0, lockPoints: 0 }));
    for (const r of rows) {
      for (const w of weeks) {
        if (!C.weekStarted(season, w)) continue;
        const s = C.weekScore(season, r.id, w);
        r.points += s.points; r.wins += s.wins; r.lockPoints += s.lock; if (s.lock === 2) r.lockWins += 1;
      }
    }
    rows.sort((a, b) => b.points - a.points || b.wins - a.wins || b.lockWins - a.lockWins || b.lockPoints - a.lockPoints || a.name.localeCompare(b.name));
    const same = (a, b) => a.points === b.points && a.wins === b.wins && a.lockWins === b.lockWins && a.lockPoints === b.lockPoints;
    const started = weeks.some((w) => C.weekStarted(season, w));
    const done = weeks.every((w) => C.weekFinal(season, w));
    return { rows, same, started, done };
  }

  // Pay out places from a half table: shares[i] is the money for place i+1. Tied players share their places.
  function placeMoney(table, shares) {
    const out = [];
    let i = 0;
    while (i < shares.length && i < table.rows.length) {
      let j = i;
      while (j + 1 < table.rows.length && table.same(table.rows[i], table.rows[j + 1])) j += 1;
      const covered = shares.slice(i, j + 1).reduce((a, b) => a + b, 0);
      const each = covered / (j - i + 1);
      for (let k = i; k <= j; k += 1) out.push({ id: table.rows[k].id, name: table.rows[k].name, place: i + 1, amount: each, tied: j > i, points: table.rows[k].points });
      i = j + 1;
    }
    return out;
  }

  function compute(season) {
    const st = settings(season);
    const players = season.config.players;
    const weeks = Object.keys(season.results).map(Number).filter((w) => C.weekFinal(season, w)).sort((a, b) => a - b);
    const adjust = (season.config.moneyAdjust) || {};
    const greenouts = [];
    const by = Object.fromEntries(players.map((p) => [p.id, { id: p.id, name: p.name, greenouts: 0, greenoutMoney: 0, missed: [], picksMoney: st.picks, adjust: 0, note: '', prize: 0 }]));
    for (const w of weeks) {
      const res = season.results[String(w)];
      for (const p of players) {
        const pk = ((season.picks || {})[p.id] || {})[String(w)];
        if (!pk) { by[p.id].missed.push(w); continue; }
        if (R.isPerfect(pk, res)) { by[p.id].greenouts += 1; greenouts.push({ week: w, id: p.id, name: p.name }); }
      }
    }
    for (const r of Object.values(by)) {
      r.greenoutMoney = r.greenouts * st.greenout;
      r.picksMoney = Math.max(0, st.picks - st.missed * r.missed.length);
      const a = adjust[r.id];
      if (a && Number.isFinite(Number(a.amount))) { r.adjust = Number(a.amount); r.note = String(a.note || ''); }
    }
    const greenoutTotal = greenouts.length * st.greenout;
    const picksTotal = Object.values(by).reduce((s, r) => s + r.picksMoney, 0);
    const adjustTotal = Object.values(by).reduce((s, r) => s + r.adjust, 0);
    const pot = Math.max(0, st.fund - greenoutTotal - picksTotal - adjustTotal);
    const pct = st.split;
    const pctTotal = (pct.first + pct.second + pct.runnerUp) || 100;
    const firstShare = pot * (pct.first / pctTotal);
    const secondShares = [pot * (pct.second / pctTotal), pot * (pct.runnerUp / pctTotal)];
    const h1 = halfTable(season, 1);
    const h2 = halfTable(season, 2);
    const first = h1.started ? placeMoney(h1, [firstShare]) : [];
    const second = h2.started ? placeMoney(h2, secondShares) : [];
    for (const w of [...first, ...second]) by[w.id].prize += w.amount;
    const rows = Object.values(by).map((r) => ({ ...r, total: round2(r.greenoutMoney + r.picksMoney + r.adjust + r.prize) }))
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
    return {
      settings: st,
      fund: st.fund,
      weeksCounted: weeks.length,
      greenouts,
      greenoutTotal,
      picksTotal,
      adjustTotal,
      pot: round2(pot),
      prizes: [
        { key: 'first', label: 'First half champion', pct: pct.first, amount: round2(firstShare), winners: first.filter((x) => x.place === 1), done: h1.done, started: h1.started },
        { key: 'second', label: 'Second half champion', pct: pct.second, amount: round2(secondShares[0]), winners: second.filter((x) => x.place === 1), done: h2.done, started: h2.started },
        { key: 'runnerUp', label: 'Second half runner-up', pct: pct.runnerUp, amount: round2(secondShares[1]), winners: second.filter((x) => x.place === 2), sharedWithTop: second.filter((x) => x.place === 1).length > 1, done: h2.done, started: h2.started },
      ],
      players: rows,
    };
  }

  const dollars = (n) => '$' + (Math.round(n * 100) % 100 ? (Math.round(n * 100) / 100).toFixed(2) : String(Math.round(n)));
  return { DEFAULTS, settings, compute, halfTable, dollars };
});
