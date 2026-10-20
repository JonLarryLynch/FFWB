(function () {
// FFWB dashboard. Data first (loaders, calculations), then drawing.

// ---------- Loaders: the sheet's grids as rows ----------
dash.loader('picks_2026', {
  description: 'Turns the 2026-2027 tab into one row per pick: week, player, club, pick type, half and the points entered beside it. A pick row with a mistyped week label stays in the week above it.',
  fn: ({ answer }) => {
    const a = typeof answer === 'string' ? JSON.parse(answer) : answer;
    const grid = a && a.values;
    if (!Array.isArray(grid)) throw new Error((a && a.error && (a.error.message || String(a.error))) || 'The sheet returned no values.');
    const at = grid.findIndex((r) => r[0] === 'First Half Pts');
    if (at < 0) throw new Error('The 2026-2027 tab has no "First Half Pts" row.');
    const head = grid[at];
    const players = [];
    for (let c = 1; c < head.length; c += 2) if (head[c]) players.push({ label: head[c], col: c });
    const rows = [];
    let week = null;
    let slot = 0;
    for (const r of grid.slice(at + 1)) {
      const type = r.find((x) => x === 'Standard' || x === 'Lock');
      if (!type) continue;
      const m = /^Week (\d+)/.exec(r[0] || '');
      const w = m ? Number(m[1]) : week;
      if (w == null) continue;
      slot = w === week ? slot + 1 : 1;
      week = w;
      const half = r.find((x) => x === '1H' || x === '2H') || '';
      for (const p of players) {
        const club = String(r[p.col] || '').trim();
        if (club) rows.push({ week: w, slot, pick_type: type, half, player: p.label, club, points: Number(r[p.col + 1] || 0) });
      }
    }
    return { columns: ['week', 'slot', 'pick_type', 'half', 'player', 'club', 'points'], rows };
  },
});

dash.loader('results_2026', {
  description: 'Reads the Results tab as one row per club and week. A blank Points cell stays blank.',
  fn: ({ answer }) => {
    const a = typeof answer === 'string' ? JSON.parse(answer) : answer;
    const grid = a && a.values;
    if (!Array.isArray(grid)) throw new Error((a && a.error && (a.error.message || String(a.error))) || 'The sheet returned no values.');
    const rows = [];
    for (const r of grid.slice(1)) {
      const m = /^Week (\d+)/.exec(r[0] || '');
      if (!m || !r[1]) continue;
      rows.push({ week: Number(m[1]), club: String(r[1]).trim(), points: r[2] == null || r[2] === '' ? null : Number(r[2]) });
    }
    return { columns: ['week', 'club', 'points'], rows };
  },
});

// ---------- Calculations: this season ----------
dash.calc('season_picks', {
  title: 'Season picks, scored',
  description: 'Each pick with the player’s short name and its result. A week counts as scored once any pick in it has points; in a scored week a pick with no points is a loss.',
  inputs: ['picks_2026'],
  fn: (picks_2026) => {
    const alias = { 'Big Head': 'Jon', 'Danny B': 'Basler', 'Chelsea B': 'Chelsea Brian' };
    const scored = new Set(picks_2026.filter((p) => Number(p.points) > 0).map((p) => Number(p.week)));
    return picks_2026.map((p) => {
      const short = String(p.player).replace(/\s*\(.*$/, '').trim();
      const points = Number(p.points);
      const unit = p.pick_type === 'Lock' ? points / 2 : points;
      const isScored = scored.has(Number(p.week));
      return {
        week: Number(p.week), player: alias[short] || short, club: p.club, pick_type: p.pick_type, half: p.half,
        points, scored: isScored, result: !isScored ? '' : unit >= 1 ? 'W' : unit > 0 ? 'D' : 'L',
      };
    });
  },
});

dash.calc('standings', {
  title: 'Standings',
  description: 'Points per player over scored weeks, ranked by points, then total wins, lock wins and lock points (the league’s tiebreaks).',
  inputs: ['season_picks', 'efl_2026'],
  fn: (season_picks, efl_2026) => {
    const by = new Map();
    const alias = { 'Big Head': 'Jon', 'Danny B': 'Basler', 'Chelsea B': 'Chelsea Brian' };
    const scoredWeeks = new Set(season_picks.filter((p) => p.scored).map((p) => p.week));
    for (const p of season_picks) {
      if (!p.scored) continue;
      if (!by.has(p.player)) by.set(p.player, { rank: 0, player: p.player, points: 0, wins: 0, lock_wins: 0, lock_points: 0 });
      const s = by.get(p.player);
      s.points += p.points;
      s['w' + p.week] = (s['w' + p.week] || 0) + p.points;
      if (p.result === 'W') s.wins += 1;
      if (p.pick_type === 'Lock') {
        s.lock_points += p.points;
        if (p.result === 'W') s.lock_wins += 1;
      }
    }
    // EFL picks add their points (never doubled) to the player's total and that week.
    for (const e of efl_2026 || []) {
      const s = by.get(alias[e.player] || e.player);
      if (!s || !scoredWeeks.has(Number(e.week)) || !e.points) continue;
      s.points += e.points;
      s.efl = (s.efl || 0) + e.points;
      s['w' + e.week] = (s['w' + e.week] || 0) + e.points;
    }
    const order = (a, b) => b.points - a.points || b.wins - a.wins || b.lock_wins - a.lock_wins || b.lock_points - a.lock_points;
    const rows = [...by.values()].sort((a, b) => order(a, b) || a.player.localeCompare(b.player));
    rows.forEach((r, i) => { r.rank = i && order(rows[i - 1], r) === 0 ? rows[i - 1].rank : i + 1; });
    return rows;
  },
});

dash.calc('season_summary', {
  title: 'Season summary',
  description: 'Weeks scored, the leading score and who holds it after tiebreaks, the gap from first to last, and the share of locks won.',
  inputs: ['season_picks', 'standings'],
  fn: (season_picks, standings) => {
    const done = season_picks.filter((p) => p.scored);
    const locks = done.filter((p) => p.pick_type === 'Lock');
    const lockWins = locks.filter((p) => p.result === 'W').length;
    const top = standings.length ? standings[0].points : 0;
    const last = standings.length ? standings[standings.length - 1].points : 0;
    const leaders = standings.filter((s) => s.rank === 1).map((s) => s.player);
    return [{
      weeks_scored: new Set(done.map((p) => p.week)).size,
      latest_week: done.reduce((m, p) => Math.max(m, p.week), 0),
      top_points: top,
      leaders: leaders.length > 1 ? leaders.slice(0, -1).join(', ') + ' and ' + leaders[leaders.length - 1] : leaders.join(''),
      leader_count: leaders.length,
      spread: top - last,
      players: standings.length,
      locks: locks.length,
      lock_wins: lockWins,
      lock_win_rate: locks.length ? lockWins / locks.length : 0,
    }];
  },
});

dash.calc('club_picks', {
  title: 'Picks by club',
  description: 'How the league’s picks on each club landed in scored weeks, beside the club’s own results. On the Results tab a blank in a scored week counts as a loss.',
  inputs: ['season_picks', 'results_2026'],
  fn: (season_picks, results_2026) => {
    const weeks = new Set(season_picks.filter((p) => p.scored).map((p) => p.week));
    const by = new Map();
    const get = (club) => {
      if (!by.has(club)) by.set(club, { club, picks: 0, wins: 0, draws: 0, losses: 0, locks: 0, points: 0, club_games: 0, club_points: 0 });
      return by.get(club);
    };
    for (const r of results_2026) {
      if (!weeks.has(Number(r.week))) continue;
      const c = get(r.club);
      c.club_games += 1;
      c.club_points += Number(r.points) || 0;
    }
    for (const p of season_picks) {
      if (!p.scored) continue;
      const c = get(p.club);
      c.picks += 1;
      c.points += p.points;
      if (p.pick_type === 'Lock') c.locks += 1;
      c[p.result === 'W' ? 'wins' : p.result === 'D' ? 'draws' : 'losses'] += 1;
    }
    return [...by.values()]
      .map((c) => ({ ...c, per_pick: c.picks ? (c.wins + c.draws / 2) / c.picks : null, club_per_game: c.club_games ? c.club_points / c.club_games : null }))
      .sort((a, b) => b.picks - a.picks || a.club.localeCompare(b.club));
  },
});

dash.calc('picks_used', {
  title: 'Picks used this half',
  description: 'Times each player has picked each club in the current half, counting picks already entered for weeks not yet played. Each club is owed 3 picks a half.',
  inputs: ['season_picks', 'results_2026'],
  fn: (season_picks, results_2026) => {
    const latest = season_picks.reduce((m, p) => Math.max(m, p.week), 0);
    const half = (season_picks.find((p) => p.week === latest) || {}).half || '1H';
    const clubs = [...new Set(results_2026.map((r) => r.club))].sort();
    const players = [...new Set(season_picks.map((p) => p.player))];
    const n = new Map();
    for (const p of season_picks) {
      if (p.half !== half) continue;
      const k = p.club + '|' + p.player;
      const c = n.get(k) || { picks: 0, locks: 0 };
      c.picks += 1;
      if (p.pick_type === 'Lock') c.locks += 1;
      n.set(k, c);
    }
    const rows = [];
    for (const club of clubs) {
      for (const player of players) {
        const c = n.get(club + '|' + player) || { picks: 0, locks: 0 };
        rows.push({ half, club, player, picks: c.picks, locks: c.locks, owed: Math.max(0, 3 - c.picks) });
      }
    }
    return rows;
  },
});

dash.calc('picks_owed', {
  title: 'Required picks still owed',
  description: 'Per player, the picks still needed to reach 3 on every club this half.',
  inputs: ['picks_used'],
  fn: (picks_used) => {
    const by = new Map();
    for (const r of picks_used) {
      const s = by.get(r.player) || { player: r.player, made: 0, owed: 0 };
      s.made += r.picks;
      s.owed += r.owed;
      by.set(r.player, s);
    }
    return [...by.values()];
  },
});

// ---------- Calculations: all-time ----------
dash.calc('careers', {
  title: 'Career records',
  description: 'Per player across completed seasons: titles and top-three finishes on full-season points, average points against that season’s league average, and the share of locks won.',
  inputs: ['history_seasons', 'history_picks'],
  fn: (history_seasons, history_picks) => {
    const by = new Map();
    for (const r of history_seasons) {
      if (r.full_season === '' || r.full_season == null) continue;
      if (!by.has(r.player)) by.set(r.player, { player: r.player, seasons: 0, titles: 0, top3: 0, best: null, diff: 0, locks: 0, lock_wins: 0 });
      const c = by.get(r.player);
      const finish = Number(r.finish);
      c.seasons += 1;
      if (finish === 1) c.titles += 1;
      if (finish <= 3) c.top3 += 1;
      c.best = c.best == null ? finish : Math.min(c.best, finish);
      c.diff += Number(r.full_season) - Number(r.league_avg);
    }
    for (const r of history_picks) {
      const c = by.get(r.player);
      if (!c || r.pick_type !== 'Lock') continue;
      c.locks += Number(r.picks);
      c.lock_wins += Number(r.wins);
    }
    return [...by.values()]
      .map((c) => ({ player: c.player, seasons: c.seasons, titles: c.titles, top3: c.top3, best: c.best, vs_avg: Math.round((c.diff / c.seasons) * 10) / 10, lock_win_rate: c.locks ? c.lock_wins / c.locks : null }))
      .sort((a, b) => b.vs_avg - a.vs_avg);
  },
});

dash.calc('club_history', {
  title: 'Clubs, all-time',
  description: 'Every scored pick on a club across completed seasons, for clubs picked at least 100 times. Points per pick counts a win as 1 and a draw as a half, a lock counted once. Lock win rate shows from 20 locks.',
  inputs: ['history_picks'],
  fn: (history_picks) => {
    const by = new Map();
    for (const r of history_picks) {
      const c = by.get(r.club) || { club: r.club, picks: 0, wins: 0, draws: 0, locks: 0, lock_wins: 0 };
      c.picks += Number(r.picks);
      c.wins += Number(r.wins);
      c.draws += Number(r.draws);
      if (r.pick_type === 'Lock') {
        c.locks += Number(r.picks);
        c.lock_wins += Number(r.wins);
      }
      by.set(r.club, c);
    }
    return [...by.values()]
      .filter((c) => c.picks >= 100)
      .map((c) => ({ club: c.club, picks: c.picks, win_rate: c.wins / c.picks, per_pick: (c.wins + c.draws / 2) / c.picks, locks: c.locks, lock_win_rate: c.locks >= 20 ? c.lock_wins / c.locks : null }))
      .sort((a, b) => b.picks - a.picks);
  },
});

// ---------- Drawing ----------
const root = document.querySelector('.ffwb');
root.style.setProperty('--ffwb-a', dash.colors[0]);

const fmtPts = d3.format('.1~f');
const fmtInt = d3.format(',');
const fmtPct = d3.format('.0%');
const fmt2 = d3.format('.2f');
const fmtDiff = d3.format('+.1f');
const ordinal = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
};
const tint = (share) => 'color-mix(in srgb, var(--ffwb-heat, var(--ffwb-a)) ' + Math.round(Math.max(0, Math.min(1, share)) * 100) + '%, transparent)';

// One block of the page: draws when every source is ready, shows a failed line when one errors.
function block(id, sources, draw) {
  const box = document.getElementById(id);
  if (!box) return;
  const plot = box.querySelector('.ffwb-plot');
  const got = sources.map((s) => dash.data(s));
  try {
    if (got.every((g) => g.status === 'ok')) {
      plot.classList.remove('dash-skeleton');
      draw(plot, ...got.map((g) => g.data || []));
    } else if (got.some((g) => g.status === 'error')) {
      plot.classList.remove('dash-skeleton');
      const line = el('div', 'ffwb-failed');
      line.append(el('span', 'ffwb-failed-dot'), el('span', null, 'Failed to load'));
      plot.replaceChildren(line);
    } else {
      if (got.some((g) => g.status !== 'loading' && g.status !== 'ok')) plot.classList.remove('dash-skeleton');
      plot.replaceChildren();
    }
  } catch (err) {
    plot.classList.remove('dash-skeleton');
    plot.replaceChildren(el('div', 'ffwb-note', 'This part could not be drawn.'));
    setTimeout(() => { throw err; });
  }
}

// A tooltip that stays inside its chart box. Cells carry their lines in data-tip.
function hover(boxId) {
  const box = document.getElementById(boxId);
  if (!box) return;
  const tip = el('div', 'ffwb-tip');
  tip.hidden = true;
  box.append(tip);
  const hide = () => { tip.hidden = true; };
  box.addEventListener('mousemove', (event) => {
    const cell = event.target.closest('[data-tip]');
    if (!cell || !box.contains(cell)) return hide();
    const lines = JSON.parse(cell.dataset.tip);
    tip.replaceChildren(...lines.map((t, i) => el('div', i ? null : 'ffwb-tip-head', t)));
    tip.hidden = false;
    const b = box.getBoundingClientRect();
    let x = event.clientX - b.left + 14;
    let y = event.clientY - b.top + 14;
    x = Math.max(4, Math.min(x, b.width - tip.offsetWidth - 4));
    if (y + tip.offsetHeight > b.height - 4) y = event.clientY - b.top - tip.offsetHeight - 10;
    tip.style.left = x + 'px';
    tip.style.top = Math.max(4, y) + 'px';
  });
  box.addEventListener('mouseleave', hide);
}
['club-chart', 'lock-chart', 'used-chart', 'finish-chart'].forEach(hover);

// A table whose every body cell cites its own value: headers carry the field, rows the key.
function table(plot, source, key, cols, rows) {
  const t = el('table', 'ffwb-table');
  t.dataset.source = source;
  t.dataset.rowKey = key;
  const hr = el('tr');
  for (const c of cols) {
    const th = el('th', c.num ? 'ffwb-num' : null, c.label);
    th.dataset.field = c.field;
    th.scope = 'col';
    hr.append(th);
  }
  const thead = el('thead');
  thead.append(hr);
  const tbody = el('tbody');
  for (const r of rows) {
    const tr = el('tr');
    const keys = key.split(',');
    tr.dataset.key = keys.length === 1 ? r[key] : keys.map((k) => String(r[k]).replace(/[%,&=]/g, (ch) => '%' + ch.charCodeAt(0).toString(16).toUpperCase())).join(',');
    for (const c of cols) {
      const v = r[c.field];
      const td = el('td', (c.num ? 'ffwb-num ' : '') + (c.cls || ''), v == null || v === '' ? '' : c.fmt ? c.fmt(v) : String(v));
      if (c.shade && v != null && v !== '') td.style.background = c.shade(v);
      tr.append(td);
    }
    tbody.append(tr);
  }
  t.append(thead, tbody);
  plot.replaceChildren(t);
}

function setText(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = value;
}

function drawSeason() {
  // Headline figures and the takeaway
  const sum = dash.data('season_summary');
  const s = sum.status === 'ok' && sum.data && sum.data[0];
  document.querySelectorAll('.ffwb [data-source="season_summary"]').forEach((n) => n.classList.toggle('dash-skeleton', sum.status === 'loading'));
  setText('k-weeks', s ? fmtInt(s.weeks_scored) : '-');
  setText('k-top', s ? fmtPts(s.top_points) : '-');
  setText('k-leaders', s ? s.leaders : '-');
  setText('k-spread', s ? fmtPts(s.spread) : '-');
  setText('k-players', s ? fmtInt(s.players) : '-');
  setText('k-lockrate', s ? fmtPct(s.lock_win_rate) : '-');
  setText('k-lockwins', s ? fmtInt(s.lock_wins) : '-');
  setText('k-locks', s ? fmtInt(s.locks) : '-');
  setText('t-week', s ? fmtInt(s.latest_week) : '-');
  setText('t-leaders', s ? s.leaders : '-');
  setText('t-verb', s && s.leader_count === 1 ? 'leads' : 'are level');
  setText('t-top', s ? fmtPts(s.top_points) : '-');
  setText('t-spread', s ? fmtPts(s.spread) : '-');
  setText('t-players', s ? fmtInt(s.players) : '-');

  block('standings-box', ['standings'], (plot, standings) => {
    if (!standings.length) return plot.replaceChildren(el('div', 'ffwb-note', 'No weeks have been scored yet.'));
    const weeks = [...new Set(standings.flatMap((r) => Object.keys(r).filter((k) => /^w\d+$/.test(k))))].sort((a, b) => a.slice(1) - b.slice(1)).slice(-5);
    const cols = [
      { field: 'rank', label: '#', num: true },
      { field: 'player', label: 'Player', cls: 'ffwb-strong' },
      { field: 'points', label: 'Pts', num: true, fmt: fmtPts, cls: 'ffwb-strong' },
      { field: 'wins', label: 'Wins', num: true, fmt: fmtInt },
      { field: 'lock_wins', label: 'Lock wins', num: true, fmt: fmtInt },
      { field: 'lock_points', label: 'Lock pts', num: true, fmt: fmtPts },
      ...(standings.some((r) => r.efl) ? [{ field: 'efl', label: 'EFL', num: true, fmt: (v) => fmtPts(v || 0) }] : []),
      ...weeks.map((w) => ({ field: w, label: 'W' + w.slice(1), num: true, fmt: fmtPts, shade: (v) => tint((v / 6) * 0.5) })),
    ];
    table(plot, 'standings', 'player', cols, standings);
  });

  block('club-chart', ['club_picks'], (plot, clubs) => {
    const shown = clubs.filter((c) => c.picks > 0);
    if (!shown.length) return plot.replaceChildren(el('div', 'ffwb-note', 'No weeks have been scored yet.'));
    const max = Math.max(...shown.map((c) => c.picks));
    const grid = el('div', 'ffwb-clubs');
    grid.append(el('div', 'ffwb-colhead', 'Club'), el('div', 'ffwb-colhead', 'Picks, by how they landed'), el('div', 'ffwb-colhead ffwb-num', 'Per pick'), el('div', 'ffwb-colhead ffwb-num', 'Club per game'));
    for (const c of shown) {
      const bar = el('div', 'ffwb-bar');
      bar.style.width = (c.picks / max) * 100 + '%';
      for (const [n, cls] of [[c.wins, 'ffwb-w'], [c.draws, 'ffwb-d'], [c.losses, 'ffwb-l']]) {
        if (!n) continue;
        const seg = el('span', cls);
        seg.style.flexGrow = n;
        bar.append(seg);
      }
      const wrap = el('div', 'ffwb-barwrap');
      wrap.append(bar);
      const track = el('div', 'ffwb-track');
      track.append(wrap, el('span', 'ffwb-barlabel', fmtInt(c.picks)));
      track.dataset.tip = JSON.stringify([
        c.club,
        fmtInt(c.picks) + ' picks, ' + fmtInt(c.locks) + ' as lock',
        'Won ' + fmtInt(c.wins) + ', drew ' + fmtInt(c.draws) + ', lost ' + fmtInt(c.losses),
        fmtPts(c.points) + ' points to the league',
        'Club itself: ' + fmtPts(c.club_points) + ' from ' + fmtInt(c.club_games) + ' games',
      ]);
      grid.append(el('div', 'ffwb-rowlabel', c.club), track, el('div', 'ffwb-num', c.per_pick == null ? '' : fmt2(c.per_pick)), el('div', 'ffwb-num ffwb-muted', c.club_per_game == null ? '' : fmt2(c.club_per_game)));
    }
    plot.replaceChildren(grid);
  });

  block('lock-chart', ['season_picks', 'standings'], (plot, picks, standings) => {
    const locks = picks.filter((p) => p.scored && p.pick_type === 'Lock');
    const weeks = [...new Set(locks.map((p) => p.week))].sort((a, b) => a - b);
    if (!weeks.length) return plot.replaceChildren(el('div', 'ffwb-note', 'No locks have been scored yet.'));
    const every = weeks.length > 12 ? 5 : 1;
    const grid = el('div', 'ffwb-locks');
    grid.style.gridTemplateColumns = 'minmax(4.5rem, 7.5rem) repeat(' + weeks.length + ', minmax(0, 1.75rem)) minmax(2.5rem, auto)';
    grid.append(el('div', 'ffwb-colhead', ''));
    for (const w of weeks) grid.append(el('div', 'ffwb-colhead ffwb-center', w % every === 0 || every === 1 ? String(w) : ''));
    grid.append(el('div', 'ffwb-colhead ffwb-num', 'Won'));
    for (const s of standings) {
      grid.append(el('div', 'ffwb-rowlabel', s.player));
      for (const w of weeks) {
        const p = locks.find((x) => x.player === s.player && x.week === w);
        const cell = el('div', 'ffwb-sq ' + (p ? (p.result === 'W' ? 'ffwb-w' : p.result === 'D' ? 'ffwb-d' : 'ffwb-l') : 'ffwb-none'), p && every === 1 ? p.result : '');
        if (p) cell.dataset.tip = JSON.stringify([s.player + ', week ' + w, p.club + ': ' + (p.result === 'W' ? 'won' : p.result === 'D' ? 'drew' : 'lost'), fmtPts(p.points) + ' points']);
        grid.append(cell);
      }
      grid.append(el('div', 'ffwb-num', fmtInt(s.lock_wins)));
    }
    plot.replaceChildren(grid);
  });

  block('used-chart', ['picks_used', 'picks_owed'], (plot, used, owed) => {
    if (!used.length) return plot.replaceChildren(el('div', 'ffwb-note', 'No picks entered yet.'));
    const clubs = [...new Set(used.map((r) => r.club))];
    const players = [...new Set(used.map((r) => r.player))];
    const grid = el('div', 'ffwb-used');
    grid.style.gridTemplateColumns = 'minmax(6.5rem, 9rem) repeat(' + players.length + ', minmax(1.9rem, 1fr))';
    grid.append(el('div', 'ffwb-colhead', ''));
    for (const p of players) {
      const h = el('div', 'ffwb-vhead');
      h.append(el('span', null, p));
      grid.append(h);
    }
    for (const club of clubs) {
      grid.append(el('div', 'ffwb-rowlabel', club));
      for (const player of players) {
        const r = used.find((x) => x.club === club && x.player === player);
        const n = r ? r.picks : 0;
        const cell = el('div', 'ffwb-cell' + (n >= 3 ? ' ffwb-met' : n === 0 ? ' ffwb-zero' : ''), n ? String(n) : '·');
        if (n > 0 && n < 3) cell.style.background = tint(n * 0.14);
        cell.dataset.tip = JSON.stringify([player + ', ' + club, fmtInt(n) + (n === 1 ? ' pick' : ' picks') + ' this half, ' + fmtInt(r ? r.locks : 0) + ' as lock', r && r.owed ? fmtInt(r.owed) + ' still owed' : 'Requirement met']);
        grid.append(cell);
      }
    }
    grid.append(el('div', 'ffwb-rowlabel ffwb-total', 'Still owed'));
    for (const player of players) {
      const o = owed.find((x) => x.player === player);
      grid.append(el('div', 'ffwb-cell ffwb-total', o ? fmtInt(o.owed) : ''));
    }
    plot.replaceChildren(grid);
  });
}

function drawAllTime() {
  block('honours-box', ['honours'], (plot, honours) => {
    table(plot, 'honours', 'season', [
      { field: 'season', label: 'Season', cls: 'ffwb-strong' },
      { field: 'champion', label: 'Champion', cls: 'ffwb-strong' },
      { field: 'first_half', label: 'First half' },
      { field: 'second_half', label: 'Second half' },
      { field: 'fa_cup', label: 'FA Cup' },
      { field: 'league_cup', label: 'League Cup' },
      { field: 'community_shield', label: 'Community Shield' },
    ], honours);
  });

  block('careers-box', ['careers'], (plot, careers) => {
    table(plot, 'careers', 'player', [
      { field: 'player', label: 'Player', cls: 'ffwb-strong' },
      { field: 'seasons', label: 'Seasons', num: true, fmt: fmtInt },
      { field: 'titles', label: 'Titles', num: true, fmt: fmtInt },
      { field: 'top3', label: 'Top 3', num: true, fmt: fmtInt },
      { field: 'best', label: 'Best', num: true, fmt: ordinal },
      { field: 'vs_avg', label: 'Pts vs league avg', num: true, fmt: fmtDiff, cls: 'ffwb-strong' },
      { field: 'lock_win_rate', label: 'Locks won', num: true, fmt: fmtPct },
    ], careers);
  });

  block('finish-chart', ['history_seasons', 'careers'], (plot, seasons, careers) => {
    const done = seasons.filter((r) => r.full_season !== '' && r.full_season != null);
    const cols = [...new Set(done.map((r) => r.season))].sort();
    const grid = el('div', 'ffwb-finish');
    grid.style.gridTemplateColumns = 'minmax(5rem, 8rem) repeat(' + cols.length + ', minmax(2.1rem, 1fr))';
    grid.append(el('div', 'ffwb-colhead', ''));
    for (const c of cols) grid.append(el('div', 'ffwb-colhead ffwb-center', c.slice(2)));
    for (const c of careers) {
      grid.append(el('div', 'ffwb-rowlabel', c.player));
      for (const season of cols) {
        const r = done.find((x) => x.season === season && x.player === c.player);
        if (!r) { grid.append(el('div', 'ffwb-cell ffwb-zero', '')); continue; }
        const finish = Number(r.finish);
        const of = Number(r.players);
        const cell = el('div', 'ffwb-cell' + (finish === 1 ? ' ffwb-met' : ''), String(finish));
        if (finish > 1) cell.style.background = tint(of > 1 ? ((of - finish) / (of - 1)) * 0.4 : 0);
        cell.dataset.tip = JSON.stringify([c.player + ', ' + season, ordinal(finish) + ' of ' + fmtInt(of), fmtPts(Number(r.full_season)) + ' points, league average ' + fmtPts(Number(r.league_avg))]);
        grid.append(cell);
      }
    }
    plot.replaceChildren(grid);
  });

  block('clubs-box', ['club_history'], (plot, clubs) => {
    table(plot, 'club_history', 'club', [
      { field: 'club', label: 'Club', cls: 'ffwb-strong' },
      { field: 'picks', label: 'Picks', num: true, fmt: fmtInt },
      { field: 'win_rate', label: 'Won', num: true, fmt: fmtPct, shade: (v) => tint(v * 0.45) },
      { field: 'per_pick', label: 'Per pick', num: true, fmt: fmt2 },
      { field: 'locks', label: 'Locks', num: true, fmt: fmtInt },
      { field: 'lock_win_rate', label: 'Locks won', num: true, fmt: fmtPct, shade: (v) => tint(v * 0.45) },
    ], clubs);
  });
}

// Shared with the page's other script.
window.ffwb = { el, tint, block, hover, table, fmtPts, fmtInt, fmtPct, fmt2, fmtDiff, ordinal, redraws: [drawSeason, drawAllTime] };

// ---------- Tabs ----------
const tabs = [...document.querySelectorAll('.ffwb-tab')];
function show(name, link) {
  for (const t of tabs) t.setAttribute('aria-selected', String(t.dataset.tab === name));
  for (const page of document.querySelectorAll('.ffwb-page')) page.hidden = page.id !== name;
  if (link) dash.setLink(name);
  for (const draw of window.ffwb.redraws) draw();
}
for (const t of tabs) t.addEventListener('click', () => show(t.dataset.tab, true));
const asked = location.hash.slice(1);
if (tabs.some((t) => t.dataset.tab === asked) && asked !== 'picks') show(asked, false);

dash.onData(() => {
  drawSeason();
  drawAllTime();
});

})();
