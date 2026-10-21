// FFWB badges: small honours on each player card, earned over every season. Only earned badges show.
(function () {
  const get = (id) => { const d = window.dash && window.dash.data(id); return d && d.status === 'ok' ? d.data : []; };
  const R = window.FFWBRules;
  const C = window.FFWBCups;
  function forPlayer(name) {
    const season = window.FFWB && window.FFWB.season;
    const out = [];
    const add = (icon, label, detail, tone) => out.push({ icon, label, detail, tone: tone || '' });
    const cab = get('trophy_cabinet').find((r) => r.player === name);
    if (cab && cab.titles) add('\u{1F3C6}', cab.titles > 1 ? cab.titles + 'x Champion' : 'Champion', 'League titles', 'gold');
    if (cab && cab.first_half + cab.second_half) add('\u{1F947}', (cab.first_half + cab.second_half) + 'x Half winner', 'First or second half won');
    const cups = cab ? cab.fa_cup + cab.league_cup + (cab.festive || 0) + cab.community_shield : 0;
    if (cups) add('\u{1F3C5}', cups > 1 ? cups + 'x Cup winner' : 'Cup winner', 'FA Cup, League Cup, Festive Fixtures or Shield');
    // Perfect weeks: every past season, plus this one.
    const wr = get('week_records').find((r) => r.player === name);
    let perfect = wr ? Number(wr.perfect) || 0 : 0;
    const me = season && season.config.players.find((p) => p.name === name);
    let liveRun = 0;
    if (season && me && R) {
      const weeks = Object.keys(season.results).map(Number).sort((a, b) => a - b);
      for (const w of weeks) {
        const res = season.results[String(w)];
        const p = (season.picks[me.id] || {})[String(w)];
        if (p && season.config.clubs.every((c) => res[c] === 1 || res[c] === 0.5 || res[c] === 0) && R.isPerfect(p, res)) perfect += 1;
        liveRun = p && p.lock && res[p.lock] === 1 ? liveRun + 1 : 0;
      }
    }
    if (perfect) add('✨', perfect > 1 ? perfect + ' perfect weeks' : 'Perfect week', 'Every pick a winner');
    const run = Math.max(wr ? Number(wr.lock_run) || 0 : 0, liveRun);
    if (run >= 10) add('\u{1F512}', run + ' locks in a row', 'Best lock winning run', 'gold');
    // Giant killer: beat someone seeded eight or more places higher in a cup this season.
    if (season && me && C) {
      for (const cup of season.cups || []) {
        const st = C.state(season, cup);
        if (st.format !== 'knockout') continue;
        for (const r of st.bracket.rounds) for (const m of r.matches) {
          if (m.status !== 'final' || !m.a || !m.b || m.winner !== me.id) continue;
          const win = m.a.id === me.id ? m.a : m.b;
          const lose = win === m.a ? m.b : m.a;
          if (win.seed - lose.seed >= 8) add('\u{1FA93}', 'Giant killer', 'Seed ' + win.seed + ' beat seed ' + lose.seed + ' in the ' + st.name);
        }
      }
    }
    const herd = get('vs_herd');
    const h = herd.find((r) => /herd/i.test(r.player));
    const mine = herd.find((r) => r.player === name);
    if (h && mine && mine.points > h.points) add('\u{1F411}', 'Beating the Herd', 'Ahead of the crowd this season');
    const car = get('careers').find((r) => r.player === name);
    if (car && car.seasons >= 8) add('\u{1F396}', 'Veteran', car.seasons + ' seasons played');
    return out;
  }
  window.FFWBBadges = { forPlayer };
})();
