(function () {
// FFWB: the race chart, the awards and the record book.

// ---------- Calculations: this season ----------
dash.calc('race', {
  title: 'Title race by week',
  description: 'Running points and league position after each scored week. Ties are split on wins, lock wins and lock points to date, then alphabetically so every player has a place.',
  inputs: ['season_picks', 'efl_2026'],
  fn: (season_picks, efl_2026) => {
    const weeks = [...new Set(season_picks.filter((p) => p.scored).map((p) => p.week))].sort((a, b) => a - b);
    const players = [...new Set(season_picks.filter((p) => p.scored).map((p) => p.player))];
    const tot = new Map(players.map((p) => [p, { player: p, points: 0, wins: 0, lock_wins: 0, lock_points: 0 }]));
    const rows = [];
    for (const week of weeks) {
      const got = new Map(players.map((p) => [p, 0]));
      for (const p of season_picks) {
        if (p.week !== week) continue;
        const t = tot.get(p.player);
        t.points += p.points;
        got.set(p.player, got.get(p.player) + p.points);
        if (p.result === 'W') t.wins += 1;
        if (p.pick_type === 'Lock') {
          t.lock_points += p.points;
          if (p.result === 'W') t.lock_wins += 1;
        }
      }
      for (const e of efl_2026 || []) {
        if (Number(e.week) !== week || !e.points || !tot.has(e.player)) continue;
        tot.get(e.player).points += e.points;
        got.set(e.player, got.get(e.player) + e.points);
      }
      const order = [...tot.values()].sort((a, b) => b.points - a.points || b.wins - a.wins || b.lock_wins - a.lock_wins || b.lock_points - a.lock_points || a.player.localeCompare(b.player));
      order.forEach((t, i) => rows.push({ week, player: t.player, position: i + 1, points: t.points, week_points: got.get(t.player) }));
    }
    return rows;
  },
});

dash.calc('herd', {
  title: 'Sheep and mavericks',
  description: 'For each scored pick, the share of the other players who picked the same club that week, averaged per player. A solo pick is one nobody else made that week.',
  inputs: ['season_picks'],
  fn: (season_picks) => {
    const done = season_picks.filter((p) => p.scored);
    const takers = new Map();
    const playing = new Map();
    for (const p of done) {
      const k = p.week + '|' + p.club;
      if (!takers.has(k)) takers.set(k, new Set());
      takers.get(k).add(p.player);
      if (!playing.has(p.week)) playing.set(p.week, new Set());
      playing.get(p.week).add(p.player);
    }
    const by = new Map();
    for (const p of done) {
      const s = by.get(p.player) || { player: p.player, picks: 0, sum: 0, solo_picks: 0, solo_points: 0 };
      const others = playing.get(p.week).size - 1;
      const same = takers.get(p.week + '|' + p.club).size - 1;
      s.picks += 1;
      s.sum += others ? same / others : 0;
      if (same === 0) {
        s.solo_picks += 1;
        s.solo_points += p.points;
      }
      by.set(p.player, s);
    }
    return [...by.values()]
      .map((s) => ({ player: s.player, herd: s.picks ? s.sum / s.picks : 0, solo_picks: s.solo_picks, solo_points: s.solo_points }))
      .sort((a, b) => b.herd - a.herd || a.player.localeCompare(b.player));
  },
});

dash.calc('awards', {
  title: 'Season awards',
  description: 'This season’s bragging rights, worked out again each time a week is scored. A tie shares the award. What happened in the latest week is in the weekly report above.',
  inputs: ['race', 'herd'],
  fn: (race, herd) => {
    const names = (list) => (list.length > 3 ? list.length + ' players' : list.length > 1 ? list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1] : list[0] || '');
    const num = (v) => String(Math.round(v * 10) / 10);
    const pick = (rows, value, best) => {
      const target = best(...rows.map(value));
      return rows.filter((r) => value(r) === target);
    };
    const weeks = [...new Set(race.map((r) => r.week))].sort((a, b) => a - b);
    const out = [];
    if (!weeks.length) return out;
    const last = weeks[weeks.length - 1];
    const now = race.filter((r) => r.week === last);

    const span = weeks.slice(-3);
    const form = now.map((r) => ({ player: r.player, points: race.filter((x) => x.player === r.player && span.includes(x.week)).reduce((s, x) => s + x.week_points, 0) }));
    const hot = pick(form, (r) => r.points, Math.max);
    out.push({ award: 'Hot streak', winner: names(hot.map((r) => r.player)), detail: num(hot[0].points) + ' points from the last ' + span.length + ' weeks' });
    const cold = pick(form, (r) => r.points, Math.min);
    out.push({ award: 'Gone cold', winner: names(cold.map((r) => r.player)), detail: num(cold[0].points) + ' points from the last ' + span.length + ' weeks' });

    // The weekly awards, added up over the season.
    const live = typeof window !== 'undefined' && window.FFWB && window.FFWB.season;
    if (live && window.FFWBAwards) {
      const tally = window.FFWBAwards.season(live).tally;
      const nameOf = Object.fromEntries(live.config.players.map((p) => [p.id, p.name]));
      const rows = Object.entries(tally).map(([id, t]) => ({ player: nameOf[id] || id, ...t }));
      const most = (k, award, what) => {
        const best = rows.length ? Math.max(...rows.map((r) => r[k])) : 0;
        if (best > 0) out.push({ award, winner: names(rows.filter((r) => r[k] === best).map((r) => r.player)), detail: what(best) });
      };
      most('top', 'Most weeks on top', (n) => 'Top scorer in ' + n + ' week' + (n === 1 ? '' : 's'));
      most('bottled', 'Serial bottler', (n) => 'Bottled it ' + n + ' time' + (n === 1 ? '' : 's') + ', the worst lost lock of the week');
    }

    const best = pick(race, (r) => r.week_points, Math.max);
    out.push({ award: 'Best single week', winner: names([...new Set(best.map((r) => r.player))]), detail: num(best[0].week_points) + ' points' + (best.length === 1 ? ' in week ' + best[0].week : '') });

    if (herd.length) {
      const sheep = pick(herd, (r) => r.herd, Math.max);
      out.push({ award: 'The sheep', winner: names(sheep.map((r) => r.player)), detail: Math.round(sheep[0].herd * 100) + '% of the league on the same picks' });
      const maverick = pick(herd, (r) => r.herd, Math.min);
      out.push({ award: 'The maverick', winner: names(maverick.map((r) => r.player)), detail: 'Only ' + Math.round(maverick[0].herd * 100) + '% of the league on the same picks' });
      const wolf = pick(herd, (r) => r.solo_points, Math.max);
      if (wolf[0].solo_points > 0) out.push({ award: 'Lone wolf of the season', winner: names(wolf.map((r) => r.player)), detail: num(wolf[0].solo_points) + ' points from picks nobody else made' });
    }
    return out;
  },
});

// ---------- Calculations: the record book ----------
dash.calc('week_records', {
  title: 'Big weeks and lock runs',
  description: 'Per player across completed seasons: perfect weeks (every pick won, from at least 5 picks), weeks with the top score or a share of it, weeks of 1.5 points or fewer, and the longest runs of lock wins and of locks without a win.',
  inputs: ['history_weeks'],
  fn: (history_weeks) => {
    const rows = history_weeks
      .map((r) => ({ season: r.season, week: Number(r.week), player: r.player, points: Number(r.points), picks: Number(r.picks), wins: Number(r.wins), lock: r.lock_result }))
      .sort((a, b) => a.season.localeCompare(b.season) || a.week - b.week);
    const top = new Map();
    for (const r of rows) {
      const k = r.season + '|' + r.week;
      top.set(k, Math.max(top.has(k) ? top.get(k) : -1, r.points));
    }
    const by = new Map();
    for (const r of rows) {
      if (!by.has(r.player)) by.set(r.player, { player: r.player, weeks: 0, perfect: 0, topped: 0, shockers: 0, run: 0, from: '', to: '', drought: 0, w: 0, wFrom: '', l: 0 });
      const s = by.get(r.player);
      s.weeks += 1;
      if (r.picks >= 5 && r.wins === r.picks) s.perfect += 1;
      if (r.points === top.get(r.season + '|' + r.week)) s.topped += 1;
      if (r.picks >= 5 && r.points <= 1.5) s.shockers += 1;
      if (!r.lock) continue;
      if (r.lock === 'W') {
        if (!s.w) s.wFrom = r.season;
        s.w += 1;
        s.l = 0;
        if (s.w > s.run) {
          s.run = s.w;
          s.from = s.wFrom;
          s.to = r.season;
        }
      } else {
        s.w = 0;
        s.l += 1;
        if (s.l > s.drought) s.drought = s.l;
      }
    }
    return [...by.values()]
      .map((s) => ({ player: s.player, weeks: s.weeks, perfect: s.perfect, perfect_rate: s.weeks ? s.perfect / s.weeks : 0, topped: s.topped, shockers: s.shockers, lock_run: s.run, lock_run_when: s.from === s.to ? s.from : s.from + ' to ' + s.to, drought: s.drought }))
      .sort((a, b) => b.perfect - a.perfect || b.topped - a.topped);
  },
});

dash.calc('records', {
  title: 'Record book',
  description: 'League records across completed seasons, from the season totals and weekly scores. A tie names everyone who shares the record.',
  inputs: ['history_seasons', 'week_records', 'history_weeks'],
  fn: (history_seasons, week_records, history_weeks) => {
    const names = (list) => (list.length > 3 ? list.length + ' players' : list.length > 1 ? list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1] : list[0] || '');
    const num = (v) => String(Math.round(v * 10) / 10);
    const full = history_seasons
      .filter((r) => r.full_season !== '' && r.full_season != null)
      .map((r) => ({ season: r.season, player: r.player, points: Number(r.full_season), finish: Number(r.finish) }));
    const out = [];
    if (!full.length) return out;

    const hi = full.reduce((a, b) => (b.points > a.points ? b : a));
    out.push({ record: 'Highest season score', holder: hi.player, detail: num(hi.points) + ' points in ' + hi.season });
    const lo = full.reduce((a, b) => (b.points < a.points ? b : a));
    out.push({ record: 'Lowest season score', holder: lo.player, detail: num(lo.points) + ' points in ' + lo.season });

    const halves = [];
    for (const r of history_seasons) {
      for (const [field, label] of [['first_half', 'first half'], ['second_half', 'second half']]) {
        if (r[field] !== '' && r[field] != null) halves.push({ player: r.player, season: r.season, points: Number(r[field]), label });
      }
    }
    const half = halves.reduce((a, b) => (b.points > a.points ? b : a));
    out.push({ record: 'Best half', holder: half.player, detail: num(half.points) + ' points in the ' + half.label + ' of ' + half.season });

    const margins = [...new Set(full.map((r) => r.season))].map((season) => {
      const t = full.filter((r) => r.season === season).sort((a, b) => b.points - a.points);
      return { season, winner: t[0].player, second: t[1].player, margin: t[0].points - t[1].points };
    });
    const big = margins.reduce((a, b) => (b.margin > a.margin ? b : a));
    out.push({ record: 'Biggest title margin', holder: big.winner, detail: num(big.margin) + ' points clear of ' + big.second + ' in ' + big.season });
    const tight = margins.reduce((a, b) => (b.margin < a.margin ? b : a));
    out.push({ record: 'Tightest title race', holder: tight.winner, detail: num(tight.margin) + ' ahead of ' + tight.second + ' in ' + tight.season });

    const seconds = new Map();
    for (const r of full) if (r.finish === 2) seconds.set(r.player, (seconds.get(r.player) || 0) + 1);
    const mostSeconds = Math.max(...seconds.values());
    out.push({ record: 'Serial runner-up', holder: names([...seconds].filter(([, n]) => n === mostSeconds).map(([p]) => p)), detail: mostSeconds + ' runner-up finishes' });

    const lead = (field) => {
      const target = Math.max(...week_records.map((r) => r[field]));
      return { value: target, rows: week_records.filter((r) => r[field] === target) };
    };
    const perfect = lead('perfect');
    out.push({ record: 'Most perfect weeks', holder: names(perfect.rows.map((r) => r.player)), detail: perfect.value + ' weeks with every pick a winner' });
    const topped = lead('topped');
    out.push({ record: 'Most weeks on top', holder: names(topped.rows.map((r) => r.player)), detail: topped.value + ' weeks with the top score or a share of it' });
    const run = lead('lock_run');
    out.push({ record: 'Longest lock winning run', holder: names(run.rows.map((r) => r.player)), detail: run.value + ' in a row, ' + run.rows[0].lock_run_when });

    const weeks = history_weeks.filter((r) => Number(r.picks) >= 5).map((r) => ({ player: r.player, season: r.season, week: Number(r.week), points: Number(r.points) }));
    const worst = Math.min(...weeks.map((r) => r.points));
    const worstRows = weeks.filter((r) => r.points === worst);
    out.push({ record: 'Worst week on record', holder: names(worstRows.map((r) => r.player)), detail: num(worst) + ' points' + (worstRows.length === 1 ? ' in week ' + worstRows[0].week + ' of ' + worstRows[0].season : '') });
    return out;
  },
});

dash.calc('trophy_cabinet', {
  title: 'Trophy cabinet',
  description: 'Honours per player. League titles are counted from full-season points. The rest come from the Trophies & Statistics tab, with a shared honour counted for each name.',
  inputs: ['honours', 'history_seasons'],
  fn: (honours, history_seasons) => {
    const by = new Map();
    const get = (p) => {
      if (!by.has(p)) by.set(p, { player: p, titles: 0, first_half: 0, second_half: 0, fa_cup: 0, league_cup: 0, festive: 0, community_shield: 0, total: 0 });
      return by.get(p);
    };
    for (const r of history_seasons) if (r.full_season !== '' && Number(r.finish) === 1) get(r.player).titles += 1;
    for (const r of honours) {
      for (const field of ['first_half', 'second_half', 'fa_cup', 'league_cup', 'festive', 'community_shield']) {
        for (const raw of String(r[field] || '').split('/')) {
          const name = raw.replace(/\*/g, '').trim();
          if (name) get(name)[field] += 1;
        }
      }
    }
    return [...by.values()]
      .map((c) => ({ ...c, total: c.titles + c.first_half + c.second_half + c.fa_cup + c.league_cup + c.festive + c.community_shield }))
      .filter((c) => c.total > 0)
      .sort((a, b) => b.total - a.total || b.titles - a.titles || a.player.localeCompare(b.player));
  },
});

dash.calc('club_edges', {
  title: 'Lucky clubs and bogey clubs',
  description: 'For each player, the club where their points per pick most beats, and most trails, what the rest of the league got on that club in the same seasons. Only clubs they have picked at least 40 times.',
  inputs: ['history_picks'],
  fn: (history_picks) => {
    const mine = new Map();
    const all = new Map();
    for (const r of history_picks) {
      const n = Number(r.picks);
      const v = Number(r.wins) + Number(r.draws) / 2;
      const a = r.player + '|' + r.club + '|' + r.season;
      const x = mine.get(a) || { player: r.player, club: r.club, season: r.season, n: 0, v: 0 };
      x.n += n;
      x.v += v;
      mine.set(a, x);
      const b = r.club + '|' + r.season;
      const y = all.get(b) || { n: 0, v: 0 };
      y.n += n;
      y.v += v;
      all.set(b, y);
    }
    const pair = new Map();
    for (const x of mine.values()) {
      const y = all.get(x.club + '|' + x.season);
      const k = x.player + '|' + x.club;
      const e = pair.get(k) || { player: x.player, club: x.club, n: 0, v: 0, on: 0, ov: 0 };
      e.n += x.n;
      e.v += x.v;
      e.on += y.n - x.n;
      e.ov += y.v - x.v;
      pair.set(k, e);
    }
    const by = new Map();
    for (const e of pair.values()) {
      if (e.n < 40 || !e.on) continue;
      const row = { club: e.club, per_pick: e.v / e.n, others: e.ov / e.on, edge: e.v / e.n - e.ov / e.on };
      const s = by.get(e.player) || { player: e.player, best: row, worst: row };
      if (row.edge > s.best.edge) s.best = row;
      if (row.edge < s.worst.edge) s.worst = row;
      by.set(e.player, s);
    }
    return [...by.values()]
      .map((s) => ({ player: s.player, lucky_club: s.best.club, lucky_per_pick: s.best.per_pick, lucky_others: s.best.others, bogey_club: s.worst.club, bogey_per_pick: s.worst.per_pick, bogey_others: s.worst.others }))
      .sort((a, b) => a.player.localeCompare(b.player));
  },
});

dash.calc('loyalty', {
  title: 'Heart or head',
  description: 'Picks on the club beside each player’s name, in the seasons it was there: how much more often they pick it than everyone else does, and their points per pick against the rest of the league on the same club. Players with at least 40 such picks.',
  inputs: ['history_picks', 'supporters'],
  fn: (history_picks, supporters) => {
    const total = new Map();
    const on = new Map();
    for (const r of history_picks) {
      const n = Number(r.picks);
      const v = Number(r.wins) + Number(r.draws) / 2;
      const t = r.season + '|' + r.player;
      total.set(t, (total.get(t) || 0) + n);
      const k = t + '|' + r.club;
      const x = on.get(k) || { season: r.season, player: r.player, club: r.club, n: 0, v: 0 };
      x.n += n;
      x.v += v;
      on.set(k, x);
    }
    const by = new Map();
    for (const s of supporters) {
      const c = by.get(s.player) || { player: s.player, clubs: [], seasons: new Set(), n: 0, v: 0, on: 0, ov: 0 };
      if (!c.clubs.includes(s.club)) c.clubs.push(s.club);
      c.seasons.add(s.season);
      for (const x of on.values()) {
        if (x.season !== s.season || x.club !== s.club) continue;
        if (x.player === s.player) {
          c.n += x.n;
          c.v += x.v;
        } else {
          c.on += x.n;
          c.ov += x.v;
        }
      }
      by.set(s.player, c);
    }
    const out = [];
    for (const c of by.values()) {
      if (c.n < 40 || !c.on) continue;
      let mine = 0;
      let rest = 0;
      for (const [k, n] of total) {
        const [season, player] = k.split('|');
        if (!c.seasons.has(season)) continue;
        if (player === c.player) mine += n;
        else rest += n;
      }
      out.push({ player: c.player, club: c.clubs.join(' / '), picks: c.n, times_as_often: c.n / mine / (c.on / rest), per_pick: c.v / c.n, others_per_pick: c.ov / c.on, edge: c.v / c.n - c.ov / c.on });
    }
    return out.sort((a, b) => b.times_as_often - a.times_as_often);
  },
});

dash.calc('head_to_head', {
  title: 'Head to head',
  description: 'Every week two players both played, across completed seasons, and who scored more. Share is of the weeks that were not level. Players are ordered by their overall share.',
  inputs: ['history_weeks'],
  fn: (history_weeks) => {
    const weeks = new Map();
    for (const r of history_weeks) {
      const k = r.season + '|' + r.week;
      if (!weeks.has(k)) weeks.set(k, []);
      weeks.get(k).push({ player: r.player, points: Number(r.points) });
    }
    const pair = new Map();
    for (const list of weeks.values()) {
      for (const a of list) {
        for (const b of list) {
          if (a.player === b.player) continue;
          const k = a.player + '|' + b.player;
          const x = pair.get(k) || { player: a.player, opponent: b.player, won: 0, lost: 0, level: 0 };
          if (a.points > b.points) x.won += 1;
          else if (a.points < b.points) x.lost += 1;
          else x.level += 1;
          pair.set(k, x);
        }
      }
    }
    const tally = new Map();
    for (const x of pair.values()) {
      const t = tally.get(x.player) || { won: 0, lost: 0 };
      t.won += x.won;
      t.lost += x.lost;
      tally.set(x.player, t);
    }
    const overall = (p) => {
      const t = tally.get(p);
      return t.won + t.lost ? t.won / (t.won + t.lost) : 0;
    };
    return [...pair.values()]
      .map((x) => ({ ...x, share: x.won + x.lost ? x.won / (x.won + x.lost) : null, overall: overall(x.player) }))
      .sort((a, b) => b.overall - a.overall || a.player.localeCompare(b.player) || overall(b.opponent) - overall(a.opponent));
  },
});

// ---------- Drawing ----------
const { el, tint, block, hover, table, fmtPts, fmtInt, fmtPct, fmt2, fmtDiff, ordinal } = window.ffwb;
const fmtTimes = d3.format('.2f');
const fmtEdge = d3.format('+.2f');
['race-chart', 'h2h-chart'].forEach(hover);

// A wall of cards, one per row: a label, a name, a line of detail. Each part cites its own cell.
function cards(plot, source, key, nameField, rows) {
  const wall = el('div', 'ffwb-wall');
  for (const r of rows) {
    const where = key + '=' + String(r[key]).replace(/[%&=]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
    const card = el('div', 'ffwb-award');
    const name = el('div', 'ffwb-award-name', r[nameField]);
    name.dataset.source = source;
    name.dataset.field = nameField;
    name.dataset.where = where;
    const detail = el('div', 'ffwb-award-detail', r.detail);
    detail.dataset.source = source;
    detail.dataset.field = 'detail';
    detail.dataset.where = where;
    card.append(el('div', 'ffwb-award-title', r[key]), name, detail);
    wall.append(card);
  }
  plot.replaceChildren(wall);
}

// A bump chart: one line per player, league position by week.
function bump(plot, race) {
    const weeks = [...new Set(race.map((r) => r.week))].sort((a, b) => a - b);
    if (weeks.length < 2) return plot.replaceChildren(el('div', 'ffwb-note', 'The race chart starts once two weeks are scored.'));
    const width = plot.clientWidth;
    if (!width) return;
    const last = weeks[weeks.length - 1];
    const finish = race.filter((r) => r.week === last).sort((a, b) => a.position - b.position);
    const n = finish.length;
    const rowH = 24;
    const top = 26;
    const height = top + n * rowH + 6;
    const svg = d3.create('svg').attr('class', 'ffwb-race').attr('width', '100%').attr('viewBox', '0 0 ' + width + ' ' + height).attr('role', 'img')
      .attr('aria-label', 'League position after each scored week, one line per player');
    plot.replaceChildren(svg.node());
    plot.style.minHeight = height + 'px';

    // Margins from the labels as drawn.
    const write = (text, r) => {
      text.text(null);
      text.append('tspan').text(r.player);
      text.append('tspan').attr('class', 'ffwb-race-pts').attr('dx', 6).text(fmtPts(r.points));
      return text;
    };
    const probe = svg.append('text').attr('class', 'ffwb-race-label');
    let widest = 0;
    for (const r of finish) {
      const drawn = write(probe, r).node().getComputedTextLength();
      widest = Math.max(widest, drawn ? drawn + 6 : (r.player.length + 5) * 7);
    }
    probe.remove();
    const left = 26;
    const right = Math.min(widest + 14, width * 0.45);
    const x = d3.scalePoint(weeks, [left + 8, Math.max(left + 9, width - right - 8)]);
    const y = (position) => top + (position - 0.5) * rowH;
    const every = weeks.length > 20 ? 5 : weeks.length > 10 ? 2 : 1;

    const axis = svg.append('g').attr('class', 'ffwb-race-axis');
    for (const w of weeks) {
      if (w % every && w !== weeks[0]) continue;
      axis.append('text').attr('x', x(w)).attr('y', 12).attr('text-anchor', 'middle').text('W' + w);
    }
    for (let i = 1; i <= n; i += 1) axis.append('text').attr('x', left - 8).attr('y', y(i)).attr('dy', '0.35em').attr('text-anchor', 'end').text(i);

    const line = d3.line().x((d) => x(d.week)).y((d) => y(d.position));
    finish.forEach((f, i) => {
      const rows = race.filter((r) => r.player === f.player).sort((a, b) => a.week - b.week);
      const color = i < 3 ? dash.colors[i] : 'var(--cds-chart-muted, var(--color-fg-muted))';
      const g = svg.append('g').attr('class', 'ffwb-racer' + (i < 3 ? ' ffwb-racer-top' : ''));
      g.append('path').attr('d', line(rows)).attr('fill', 'none').attr('stroke-width', 2).attr('stroke-linecap', 'round').attr('stroke-linejoin', 'round').attr('style', 'stroke: ' + color);
      for (const r of rows) {
        g.append('circle').attr('cx', x(r.week)).attr('cy', y(r.position)).attr('r', 3.5).attr('style', 'fill: ' + color);
        g.append('circle').attr('cx', x(r.week)).attr('cy', y(r.position)).attr('r', 10).attr('fill', 'transparent')
          .attr('data-tip', JSON.stringify([r.player + ', week ' + r.week, ordinal(r.position) + ' on ' + fmtPts(r.points) + ' points', fmtPts(r.week_points) + ' that week']));
      }
      write(g.append('text').attr('class', 'ffwb-race-label').attr('x', width - right + 4).attr('y', y(f.position)).attr('dy', '0.35em'), f);
    });
}
window.ffwb.bump = bump;

function drawRace() {
  block('race-chart', ['race'], bump);
}

function drawAwards() {
  block('awards-box', ['awards'], (plot, awards) => {
    if (!awards.length) return plot.replaceChildren(el('div', 'ffwb-note', 'Awards appear once a week is scored.'));
    cards(plot, 'awards', 'award', 'winner', awards);
  });

  block('herd-box', ['herd'], (plot, herd) => {
    if (!herd.length) return plot.replaceChildren(el('div', 'ffwb-note', 'No weeks have been scored yet.'));
    table(plot, 'herd', 'player', [
      { field: 'player', label: 'Player', cls: 'ffwb-strong' },
      { field: 'herd', label: 'League on the same picks', num: true, fmt: fmtPct, shade: (v) => tint(v * 0.5) },
      { field: 'solo_picks', label: 'Solo picks', num: true, fmt: fmtInt },
      { field: 'solo_points', label: 'Points from them', num: true, fmt: fmtPts },
    ], herd);
  });
}

function drawRecords() {
  block('records-box', ['records'], (plot, records) => cards(plot, 'records', 'record', 'holder', records));

  block('cabinet-box', ['trophy_cabinet'], (plot, cabinet) => {
    const shade = (v) => (v ? tint(Math.min(v, 3) * 0.14) : 'transparent');
    // A shelf of the most decorated players: a cup per title, a medal per half won.
    const shelf = document.createElement('div');
    shelf.className = 'ffwb-shelf';
    for (const c of cabinet.slice(0, 6)) {
      const row = document.createElement('div');
      row.className = 'ffwb-shelf-row';
      const name = document.createElement('div');
      name.className = 'ffwb-shelf-name';
      name.textContent = c.player;
      const items = document.createElement('div');
      items.className = 'ffwb-shelf-items';
      const add = (n, file, label) => { for (let i = 0; i < n; i += 1) { const im = document.createElement('img'); im.src = '/brand/' + file + '.svg'; im.alt = label; im.title = label; im.className = 'ffwb-shelf-' + (file === 'trophy-champion' ? 'cup' : 'medal'); items.append(im); } };
      add(c.titles, 'trophy-champion', 'League title');
      add(c.first_half, 'medal-first', 'First half');
      add(c.second_half, 'medal-second', 'Second half');
      const cups = c.fa_cup + c.league_cup + c.festive + c.community_shield;
      if (cups) { const more = document.createElement('span'); more.className = 'ffwb-shelf-more'; more.textContent = '+' + cups + ' cup' + (cups === 1 ? '' : 's'); items.append(more); }
      row.append(name, items);
      shelf.append(row);
    }
    const tableBox = document.createElement('div');
    plot.replaceChildren(shelf, tableBox);
    table(tableBox, 'trophy_cabinet', 'player', [
      { field: 'player', label: 'Player', cls: 'ffwb-strong' },
      { field: 'total', label: 'Total', num: true, fmt: fmtInt, cls: 'ffwb-strong' },
      { field: 'titles', label: 'League', num: true, fmt: fmtInt, shade },
      { field: 'first_half', label: 'First half', num: true, fmt: fmtInt, shade },
      { field: 'second_half', label: 'Second half', num: true, fmt: fmtInt, shade },
      { field: 'fa_cup', label: 'FA Cup', num: true, fmt: fmtInt, shade },
      { field: 'league_cup', label: 'League Cup', num: true, fmt: fmtInt, shade },
      { field: 'festive', label: 'Festive', num: true, fmt: fmtInt, shade },
      { field: 'community_shield', label: 'Shield', num: true, fmt: fmtInt, shade },
    ], cabinet);
  });

  block('weeks-box', ['week_records'], (plot, rows) => {
    table(plot, 'week_records', 'player', [
      { field: 'player', label: 'Player', cls: 'ffwb-strong' },
      { field: 'weeks', label: 'Weeks played', num: true, fmt: fmtInt },
      { field: 'perfect', label: 'Perfect weeks', num: true, fmt: fmtInt, cls: 'ffwb-strong' },
      { field: 'perfect_rate', label: 'How often', num: true, fmt: d3.format('.1%'), shade: (v) => tint(v * 5) },
      { field: 'topped', label: 'Weeks on top', num: true, fmt: fmtInt },
      { field: 'shockers', label: 'Shockers', num: true, fmt: fmtInt },
      { field: 'lock_run', label: 'Best lock run', num: true, fmt: fmtInt },
      { field: 'lock_run_when', label: 'When' },
      { field: 'drought', label: 'Longest lock drought', num: true, fmt: fmtInt },
    ], rows);
  });

  block('edges-box', ['club_edges'], (plot, rows) => {
    table(plot, 'club_edges', 'player', [
      { field: 'player', label: 'Player', cls: 'ffwb-strong' },
      { field: 'lucky_club', label: 'Lucky club', cls: 'ffwb-strong' },
      { field: 'lucky_per_pick', label: 'Per pick', num: true, fmt: fmt2 },
      { field: 'lucky_others', label: 'Everyone else', num: true, fmt: fmt2, cls: 'ffwb-muted' },
      { field: 'bogey_club', label: 'Bogey club', cls: 'ffwb-strong' },
      { field: 'bogey_per_pick', label: 'Per pick', num: true, fmt: fmt2 },
      { field: 'bogey_others', label: 'Everyone else', num: true, fmt: fmt2, cls: 'ffwb-muted' },
    ], rows);
  });

  block('loyalty-box', ['loyalty'], (plot, rows) => {
    table(plot, 'loyalty', 'player', [
      { field: 'player', label: 'Player', cls: 'ffwb-strong' },
      { field: 'club', label: 'Their club' },
      { field: 'picks', label: 'Picks on it', num: true, fmt: fmtInt },
      { field: 'times_as_often', label: 'Times as often', num: true, fmt: fmtTimes, cls: 'ffwb-strong', shade: (v) => tint((v - 0.8) * 0.4) },
      { field: 'per_pick', label: 'Per pick', num: true, fmt: fmt2 },
      { field: 'others_per_pick', label: 'Everyone else', num: true, fmt: fmt2, cls: 'ffwb-muted' },
      { field: 'edge', label: 'Edge', num: true, fmt: fmtEdge },
    ], rows);
  });

  block('h2h-chart', ['head_to_head'], (plot, rows) => {
    const players = [...new Set(rows.map((r) => r.player))];
    const grid = el('div', 'ffwb-h2h');
    grid.style.gridTemplateColumns = 'minmax(5.5rem, 8rem) repeat(' + players.length + ', minmax(2.1rem, 1fr)) minmax(3rem, auto)';
    grid.append(el('div', 'ffwb-colhead', ''));
    for (const p of players) {
      const h = el('div', 'ffwb-vhead');
      h.append(el('span', null, p));
      grid.append(h);
    }
    const all = el('div', 'ffwb-vhead');
    all.append(el('span', 'ffwb-strong', 'Overall'));
    grid.append(all);
    for (const p of players) {
      grid.append(el('div', 'ffwb-rowlabel', p));
      let overall = null;
      for (const o of players) {
        const r = rows.find((x) => x.player === p && x.opponent === o);
        if (r) overall = r.overall;
        if (!r || r.share == null) {
          grid.append(el('div', 'ffwb-cell ffwb-zero', p === o ? '' : '·'));
          continue;
        }
        const cell = el('div', 'ffwb-cell' + (r.share > 0.5 ? ' ffwb-strong' : ' ffwb-zero'), String(Math.round(r.share * 100)));
        cell.style.background = tint(Math.min(0.45, (r.share - 0.4) * 1.5));
        cell.dataset.tip = JSON.stringify([p + ' v ' + o, 'Won ' + fmtInt(r.won) + ', lost ' + fmtInt(r.lost) + ', level ' + fmtInt(r.level), fmtPct(r.share) + ' of the weeks that were not level']);
        grid.append(cell);
      }
      grid.append(el('div', 'ffwb-cell ffwb-strong', overall == null ? '' : fmtPct(overall)));
    }
    plot.replaceChildren(grid);
  });
}

window.ffwb.redraws.push(drawRace);
dash.onData(() => {
  drawRace();
  drawAwards();
  drawRecords();
});

})();
