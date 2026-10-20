(function () {
// FFWB: the Herd, title odds, the weekly report, player cards, black weekends and the archive.

// ---------- Calculations: this season ----------
dash.calc('herd_bot', {
  title: 'The Herd’s picks',
  description: 'A phantom sixteenth player. Each scored week it locks the club most players locked and takes the four other clubs picked most often, ties going alphabetically. It scores from the Results tab, where a blank in a scored week is a loss.',
  inputs: ['season_picks', 'results_2026'],
  fn: (season_picks, results_2026) => {
    const res = new Map(results_2026.map((r) => [r.week + '|' + r.club, Number(r.points) || 0]));
    const weeks = [...new Set(season_picks.filter((p) => p.scored).map((p) => p.week))].sort((a, b) => a - b);
    const rank = (m) => [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const rows = [];
    for (const week of weeks) {
      const all = new Map();
      const locks = new Map();
      for (const p of season_picks) {
        if (p.week !== week) continue;
        all.set(p.club, (all.get(p.club) || 0) + 1);
        if (p.pick_type === 'Lock') locks.set(p.club, (locks.get(p.club) || 0) + 1);
      }
      const lock = rank(locks)[0];
      if (!lock) continue;
      const others = rank(all).filter(([club]) => club !== lock[0]).slice(0, 4).map(([club]) => club);
      const points = 2 * (res.get(week + '|' + lock[0]) || 0) + others.reduce((s, club) => s + (res.get(week + '|' + club) || 0), 0);
      rows.push({ week, lock: lock[0], lock_backers: lock[1], others: others.join(', '), points });
    }
    return rows;
  },
});

dash.calc('vs_herd', {
  title: 'Beating the Herd',
  description: 'The standings with the Herd dropped in as a sixteenth entry, and each player’s points against it.',
  inputs: ['standings', 'herd_bot'],
  fn: (standings, herd_bot) => {
    const herd = herd_bot.reduce((s, r) => s + r.points, 0);
    const rows = standings.map((s) => ({ player: s.player, points: s.points, margin: s.points - herd }));
    rows.push({ player: 'The Herd', points: herd, margin: 0 });
    rows.sort((a, b) => b.points - a.points || (a.player === 'The Herd' ? 1 : b.player === 'The Herd' ? -1 : 0));
    return rows.map((r, i) => ({ place: 1 + rows.filter((x) => x.points > r.points).length, ...r }));
  },
});

dash.calc('title_odds', {
  title: 'Title odds',
  description: 'A simulation for fun. The rest of the season is played 4,000 times by drawing past league weeks at random from 2020-21 onward and giving each player the score they got that week, or their usual gap to the league average if they were not playing then. A tie at the top splits the win.',
  inputs: ['season_picks', 'history_weeks'],
  fn: (season_picks, history_weeks) => {
    const now = new Map();
    let played = 0;
    for (const p of season_picks) {
      if (!p.scored) continue;
      played = Math.max(played, p.week);
      const s = now.get(p.player) || { first: 0, total: 0 };
      s.total += p.points;
      if (p.week <= 19) s.first += p.points;
      now.set(p.player, s);
    }
    const players = [...now.keys()];
    if (!players.length) return [];
    const past = new Map();
    for (const r of history_weeks) {
      if (Number(r.picks) < 5 || r.season < '2020-21') continue;
      const k = r.season + '|' + r.week;
      if (!past.has(k)) past.set(k, new Map());
      past.get(k).set(r.player, Number(r.points));
    }
    const weeks = [...past.values()].map((scores) => {
      let sum = 0;
      for (const v of scores.values()) sum += v;
      return { scores, mean: sum / scores.size };
    });
    if (!weeks.length) return [];
    const draws = weeks.map((w) => players.map((p) => {
      if (w.scores.has(p)) return w.scores.get(p);
      let gap = 0;
      let n = 0;
      for (const x of weeks) {
        if (!x.scores.has(p)) continue;
        gap += x.scores.get(p) - x.mean;
        n += 1;
      }
      return Math.max(0, w.mean + (n ? gap / n : 0));
    }));
    let seed = 20262027;
    const rand = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const runs = 4000;
    const firstWins = players.map(() => 0);
    const titleWins = players.map(() => 0);
    const sums = players.map(() => 0);
    const credit = (scores, wins) => {
      const best = Math.max(...scores);
      const share = 1 / scores.filter((v) => v === best).length;
      scores.forEach((v, j) => { if (v === best) wins[j] += share; });
    };
    for (let i = 0; i < runs; i += 1) {
      const first = players.map((p) => now.get(p).first);
      const total = players.map((p) => now.get(p).total);
      for (let w = played + 1; w <= 38; w += 1) {
        const draw = draws[Math.floor(rand() * draws.length)];
        for (let j = 0; j < players.length; j += 1) {
          total[j] += draw[j];
          if (w <= 19) first[j] += draw[j];
        }
      }
      credit(first, firstWins);
      credit(total, titleWins);
      total.forEach((v, j) => { sums[j] += v; });
    }
    return players
      .map((p, j) => ({ player: p, points: now.get(p).total, projected: Math.round((sums[j] / runs) * 10) / 10, first_half_odds: firstWins[j] / runs, title_odds: titleWins[j] / runs }))
      .sort((a, b) => b.title_odds - a.title_odds || b.first_half_odds - a.first_half_odds || a.player.localeCompare(b.player));
  },
});

dash.calc('recap', {
  title: 'Weekly report',
  description: 'A short report on the latest scored week, written from the picks: the week’s best and worst, the movers, the top of the table, how the locks went, and the pick that burned the most people.',
  inputs: ['season_picks', 'race', 'season_summary'],
  fn: (season_picks, race, season_summary) => {
    const names = (list) => (list.length > 3 ? list.length + ' players' : list.length > 1 ? list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1] : list[0] || '');
    const num = (v) => String(Math.round(v * 10) / 10);
    const weeks = [...new Set(race.map((r) => r.week))].sort((a, b) => a - b);
    if (!weeks.length || !season_summary.length) return [];
    const week = weeks[weeks.length - 1];
    const now = race.filter((r) => r.week === week);
    const hi = Math.max(...now.map((r) => r.week_points));
    const lo = Math.min(...now.map((r) => r.week_points));
    const out = [];
    out.push('Week ' + week + ' report.');
    out.push(names(now.filter((r) => r.week_points === hi).map((r) => r.player)) + ' took the week with ' + num(hi) + ' points, while ' + names(now.filter((r) => r.week_points === lo).map((r) => r.player)) + ' propped it up on ' + num(lo) + '.');

    if (weeks.length > 1) {
      const prev = weeks[weeks.length - 2];
      const moves = now.map((r) => {
        const before = race.find((x) => x.week === prev && x.player === r.player);
        return { player: r.player, move: (before ? before.position : r.position) - r.position };
      });
      const up = Math.max(...moves.map((m) => m.move));
      const down = Math.min(...moves.map((m) => m.move));
      const places = (n) => n + (n === 1 ? ' place' : ' places');
      if (up > 0 && down < 0) out.push(names(moves.filter((m) => m.move === up).map((m) => m.player)) + ' climbed ' + places(up) + ' and ' + names(moves.filter((m) => m.move === down).map((m) => m.player)) + ' dropped ' + places(-down) + '.');
    }

    const s = season_summary[0];
    out.push('At the top, ' + s.leaders + (s.leader_count === 1 ? ' leads on ' : ' are level on ') + num(s.top_points) + ' points, with ' + num(s.spread) + ' covering all ' + s.players + '.');

    const picks = season_picks.filter((p) => p.week === week);
    const locks = picks.filter((p) => p.pick_type === 'Lock');
    if (locks.length) {
      const count = new Map();
      for (const p of locks) count.set(p.club, (count.get(p.club) || 0) + 1);
      const [club, backers] = [...count].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
      const result = locks.find((p) => p.club === club).result;
      out.push('Locks: ' + locks.filter((p) => p.result === 'W').length + ' of ' + locks.length + ' came in. ' + club + ' was the popular one, backed by ' + backers + ', and it ' + (result === 'W' ? 'won' : result === 'D' ? 'only drew' : 'lost') + '.');
    }

    const burned = new Map();
    for (const p of picks) {
      const c = burned.get(p.club) || { club: p.club, n: 0, got: 0 };
      c.n += 1;
      c.got += p.points;
      burned.set(p.club, c);
    }
    const skin = [...burned.values()].filter((c) => c.got === 0 && c.n >= 3).sort((a, b) => b.n - a.n || a.club.localeCompare(b.club))[0];
    if (skin) out.push('Banana skin of the week: ' + skin.club + ', picked ' + skin.n + ' times for nothing.');

    const solo = picks.filter((p) => p.result === 'W' && picks.filter((x) => x.club === p.club).length === 1);
    if (solo.length) out.push('Nobody else fancied ' + solo[0].club + ', but ' + solo[0].player + ' did, and it won.');
    return [{ week, text: out.join(' ') }];
  },
});

// ---------- Calculations: all-time ----------
dash.calc('black_weekends', {
  title: 'Black weekends',
  description: 'Every week across completed seasons in which no lock in the league won, with the club most players had locked. If there were fewer than eight such weeks, the eight worst by share of locks won.',
  inputs: ['history_weeks'],
  fn: (history_weeks) => {
    const by = new Map();
    for (const r of history_weeks) {
      if (!r.lock_result) continue;
      const k = r.season + '|' + r.week;
      if (!by.has(k)) by.set(k, { season: r.season, week: Number(r.week), locks: 0, won: 0, clubs: new Map() });
      const w = by.get(k);
      w.locks += 1;
      if (r.lock_result === 'W') w.won += 1;
      const c = w.clubs.get(r.lock_club) || { club: r.lock_club, n: 0, result: r.lock_result };
      c.n += 1;
      w.clubs.set(r.lock_club, c);
    }
    return [...by.values()]
      .filter((w) => w.locks >= 5)
      .map((w) => {
        const top = [...w.clubs.values()].sort((a, b) => b.n - a.n || a.club.localeCompare(b.club))[0];
        return { season: w.season, week: w.week, locks: w.locks, won: w.won, share: w.won / w.locks, club: top.club, backers: top.n, outcome: top.result === 'W' ? 'Won' : top.result === 'D' ? 'Drew' : 'Lost' };
      })
      .sort((a, b) => a.share - b.share || b.locks - a.locks || a.season.localeCompare(b.season) || a.week - b.week)
      .filter((w, i) => i < 8 || w.won === 0);
  },
});

dash.calc('archive_race', {
  title: 'Past title races',
  description: 'Running points and position after each week of every completed season, from the weekly picks plus EFL bonus picks in the week they were made. A points deduction is not in these lines.',
  inputs: ['history_weeks'],
  fn: (history_weeks) => {
    const seasons = new Map();
    for (const r of history_weeks) {
      if (!seasons.has(r.season)) seasons.set(r.season, new Map());
      const weeks = seasons.get(r.season);
      const w = Number(r.week);
      if (!weeks.has(w)) weeks.set(w, []);
      weeks.get(w).push({ player: r.player, points: Number(r.points) + (Number(r.bonus) || 0) });
    }
    const rows = [];
    for (const [season, weeks] of seasons) {
      const total = new Map();
      for (const week of [...weeks.keys()].sort((a, b) => a - b)) {
        const got = new Map(weeks.get(week).map((x) => [x.player, x.points]));
        for (const [player, points] of got) total.set(player, (total.get(player) || 0) + points);
        [...total]
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .forEach(([player, points], i) => rows.push({ season, week, player, position: i + 1, points, week_points: got.get(player) || 0 }));
      }
    }
    return rows;
  },
});

dash.calc('player_cards', {
  title: 'Player cards',
  description: 'One row per player, gathering their career record, trophies, big weeks, clubs and rivals from the other calculations. Rivals need at least 40 weeks that were not level.',
  inputs: ['careers', 'trophy_cabinet', 'week_records', 'club_edges', 'head_to_head', 'history_seasons', 'history_picks', 'supporters', 'standings'],
  fn: (careers, trophy_cabinet, week_records, club_edges, head_to_head, history_seasons, history_picks, supporters, standings) => {
    const ordinal = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
    const num = (v) => String(Math.round(v * 10) / 10);
    const pct = (v) => Math.round(v * 100) + '%';
    return careers.map((c) => {
      const p = c.player;
      const seasons = history_seasons.filter((r) => r.player === p && r.full_season !== '' && r.full_season != null).map((r) => ({ season: r.season, points: Number(r.full_season), finish: Number(r.finish) }));
      const bestScore = seasons.reduce((a, b) => (b.points > a.points ? b : a));
      const worst = seasons.reduce((a, b) => (b.finish > a.finish ? b : a));
      const bestIn = seasons.filter((s) => s.finish === c.best).map((s) => s.season.slice(2));
      const cabinet = trophy_cabinet.find((r) => r.player === p);
      const weeks = week_records.find((r) => r.player === p);
      const edges = club_edges.find((r) => r.player === p);
      const clubs = new Map();
      for (const r of history_picks) if (r.player === p) clubs.set(r.club, (clubs.get(r.club) || 0) + Number(r.picks));
      const top = [...clubs].sort((a, b) => b[1] - a[1])[0];
      const rivals = head_to_head.filter((r) => r.player === p && r.won + r.lost >= 40).sort((a, b) => b.share - a.share);
      const latest = supporters.reduce((s, r) => (r.season > s ? r.season : s), '');
      const club = [...new Set(supporters.filter((r) => r.player === p && r.season === latest).map((r) => r.club))].join(' and ');
      const now = standings.find((r) => r.player === p);
      return {
        player: p,
        club,
        seasons: c.seasons,
        titles: c.titles,
        trophies: cabinet ? cabinet.total : 0,
        best_finish: ordinal(c.best) + ' in ' + bestIn.join(', '),
        worst_finish: ordinal(worst.finish) + ' in ' + worst.season.slice(2),
        best_score: num(bestScore.points) + ' in ' + bestScore.season.slice(2),
        vs_avg: c.vs_avg,
        lock_win_rate: c.lock_win_rate,
        perfect: weeks ? weeks.perfect : 0,
        lock_run: weeks ? weeks.lock_run : 0,
        shockers: weeks ? weeks.shockers : 0,
        top_club: top ? top[0] + ', ' + top[1] + ' picks' : '',
        lucky_club: edges ? edges.lucky_club : '',
        bogey_club: edges ? edges.bogey_club : '',
        owns: rivals.length ? rivals[0].opponent + ', ' + pct(rivals[0].share) : '',
        owned_by: rivals.length ? rivals[rivals.length - 1].opponent + ', ' + pct(rivals[rivals.length - 1].share) : '',
        this_season: now ? ordinal(now.rank) + ' on ' + num(now.points) + ' points' : '',
      };
    });
  },
});

// ---------- Drawing ----------
const { el, tint, block, table, bump, fmtPts, fmtInt, fmtPct, fmtDiff } = window.ffwb;
window.ffwb.hover('archive-chart');
const fmtOdds = (v) => (v < 0.01 ? '<1%' : fmtPct(v));
const picked = { player: null, season: null };

// A row of pill buttons, one per choice, that keeps the page's pick in view.
function pills(box, choices, current, onPick) {
  if (box.tagName === 'SELECT') {
    // A dropdown takes one line where a row of buttons can take several.
    if (box.dataset.choices !== choices.join('|')) {
      box.replaceChildren(...choices.map((c) => new Option(c, c)));
      box.dataset.choices = choices.join('|');
      box.onchange = () => onPick(box.value);
    }
    box.value = current;
    return;
  }
  box.replaceChildren(...choices.map((c) => {
    const b = el('button', 'ffwb-pill', c);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(c === current));
    b.addEventListener('click', () => onPick(c));
    return b;
  }));
}

function drawSeasonExtras() {
  block('odds-box', ['title_odds'], (plot, odds) => {
    if (!odds.length) return plot.replaceChildren(el('div', 'ffwb-note', 'Odds appear once a week is scored.'));
    table(plot, 'title_odds', 'player', [
      { field: 'player', label: 'Player', cls: 'ffwb-strong' },
      { field: 'points', label: 'Pts now', num: true, fmt: fmtPts },
      { field: 'projected', label: 'Projected finish', num: true, fmt: fmtPts },
      { field: 'first_half_odds', label: 'First half', num: true, fmt: fmtOdds, shade: (v) => tint(v * 1.5) },
      { field: 'title_odds', label: 'Title', num: true, fmt: fmtOdds, cls: 'ffwb-strong', shade: (v) => tint(v * 1.5) },
    ], odds);
  });
}

function drawAwardsExtras() {
  const recap = dash.data('recap');
  const text = document.getElementById('recap-text');
  const row = recap.status === 'ok' && recap.data && recap.data[0];
  text.classList.toggle('dash-skeleton', recap.status === 'loading');
  text.textContent = row ? row.text : recap.status === 'ok' ? 'The report appears once a week is scored.' : '-';

  block('herd-table-box', ['vs_herd'], (plot, rows) => {
    if (rows.length < 2) return plot.replaceChildren(el('div', 'ffwb-note', 'No weeks have been scored yet.'));
    table(plot, 'vs_herd', 'player', [
      { field: 'place', label: '#', num: true, fmt: fmtInt },
      { field: 'player', label: 'Player', cls: 'ffwb-strong' },
      { field: 'points', label: 'Pts', num: true, fmt: fmtPts },
      { field: 'margin', label: 'Against the Herd', num: true, fmt: fmtDiff, shade: (v) => tint(Math.max(0, v) * 0.12) },
    ], rows);
    for (const tr of plot.querySelectorAll('tr[data-key="The Herd"]')) tr.classList.add('ffwb-herd-row');
  });

  block('herd-picks-box', ['herd_bot'], (plot, rows) => {
    if (!rows.length) return plot.replaceChildren();
    table(plot, 'herd_bot', 'week', [
      { field: 'week', label: 'Week', num: true, fmt: fmtInt },
      { field: 'lock', label: 'Its lock', cls: 'ffwb-strong' },
      { field: 'lock_backers', label: 'Backers', num: true, fmt: fmtInt },
      { field: 'others', label: 'Its other four', cls: 'ffwb-wrap' },
      { field: 'points', label: 'Pts', num: true, fmt: fmtPts, cls: 'ffwb-strong' },
    ], rows);
  });
}

const cardStats = [
  ['this_season', 'This season'],
  ['seasons', 'Seasons played'],
  ['titles', 'League titles'],
  ['trophies', 'Trophies in all'],
  ['best_finish', 'Best finish'],
  ['worst_finish', 'Worst finish'],
  ['best_score', 'Best season score'],
  ['vs_avg', 'Pts a season vs league avg'],
  ['lock_win_rate', 'Locks won'],
  ['lock_run', 'Best lock run'],
  ['perfect', 'Perfect weeks'],
  ['shockers', 'Shockers'],
  ['top_club', 'Most picked club'],
  ['lucky_club', 'Lucky club'],
  ['bogey_club', 'Bogey club'],
  ['owns', 'Best record against'],
  ['owned_by', 'Worst record against'],
];

function drawPlayers() {
  block('player-box', ['player_cards'], (plot, cards) => {
    if (!cards.length) return plot.replaceChildren();
    const names = cards.map((c) => c.player).sort((a, b) => a.localeCompare(b));
    if (!names.includes(picked.player)) picked.player = names.includes('Jon') ? 'Jon' : names[0];
    pills(document.getElementById('player-pills'), names, picked.player, (name) => { picked.player = name; drawPlayers(); });
    const c = cards.find((x) => x.player === picked.player);
    const where = 'player=' + String(c.player).replace(/[%&=]/g, (ch) => '%' + ch.charCodeAt(0).toString(16).toUpperCase());
    const cite = (node, field) => {
      node.dataset.source = 'player_cards';
      node.dataset.field = field;
      node.dataset.where = where;
      return node;
    };
    const head = el('div', 'ffwb-pc-head');
    head.append(cite(el('div', 'ffwb-pc-name', c.player), 'player'));
    const sub = el('div', 'ffwb-pc-sub');
    if (c.club) sub.append(el('span', null, 'Flies the flag for '), cite(el('span', 'ffwb-strong', c.club), 'club'));
    else sub.append(el('span', null, 'No club beside the name'));
    head.append(sub);
    const grid = el('div', 'ffwb-pc-grid');
    for (const [field, label] of cardStats) {
      const v = c[field];
      const shown = v == null || v === '' ? 'None yet' : field === 'vs_avg' ? fmtDiff(v) : field === 'lock_win_rate' ? fmtPct(v) : typeof v === 'number' ? fmtInt(v) : v;
      const stat = el('div', 'ffwb-pc-stat');
      const value = el('div', 'ffwb-pc-value', shown);
      if (!(v == null || v === '')) cite(value, field);
      stat.append(el('div', 'ffwb-pc-label', label), value);
      grid.append(stat);
    }
    const card = el('div', 'ffwb-pc');
    card.append(head, grid);
    plot.replaceChildren(card);
  });
}

function drawRecordExtras() {
  block('black-box', ['black_weekends'], (plot, rows) => {
    table(plot, 'black_weekends', 'season,week', [
      { field: 'season', label: 'Season', cls: 'ffwb-strong' },
      { field: 'week', label: 'Week', num: true, fmt: fmtInt },
      { field: 'won', label: 'Locks won', num: true, fmt: fmtInt, cls: 'ffwb-strong' },
      { field: 'locks', label: 'Of', num: true, fmt: fmtInt },
      { field: 'club', label: 'Most locked', cls: 'ffwb-strong' },
      { field: 'backers', label: 'Backers', num: true, fmt: fmtInt },
      { field: 'outcome', label: 'It' },
    ], rows);
  });
}

function drawArchive() {
  const seasons = dash.data('history_seasons');
  const list = seasons.status === 'ok' ? [...new Set(seasons.data.map((r) => r.season))].sort() : [];
  const races = dash.data('archive_race');
  if (list.length && !list.includes(picked.season)) {
    // Open on the latest season with a full run of weekly scores.
    const full = races.status === 'ok' ? list.filter((s) => races.data.some((r) => r.season === s && r.week >= 30)) : [];
    picked.season = full.length ? full[full.length - 1] : list[list.length - 1];
  }
  pills(document.getElementById('season-pills'), list, picked.season, (season) => { picked.season = season; drawArchive(); });

  const short = document.getElementById('archive-short');
  short.hidden = true;
  block('archive-chart', ['archive_race'], (plot, race) => {
    const rows = race.filter((r) => r.season === picked.season);
    bump(plot, rows);
    // Say so when the sheet has weekly scores for only part of the season.
    const lastWeek = rows.reduce((m, r) => Math.max(m, r.week), 0);
    if (lastWeek && lastWeek < 38) {
      short.textContent = 'The sheet only has weekly scores for this season up to week ' + lastWeek + ', so the race stops there. The final table below is complete.';
      short.hidden = false;
    }
  });

  block('archive-table-box', ['history_seasons'], (plot, rows) => {
    const final = rows
      .filter((r) => r.season === picked.season)
      .sort((a, b) => (a.finish === '' ? 99 : Number(a.finish)) - (b.finish === '' ? 99 : Number(b.finish)) || Number(b.second_half) - Number(a.second_half));
    const pts = (v) => fmtPts(Number(v));
    table(plot, 'history_seasons', 'season,player', [
      { field: 'finish', label: '#', num: true, fmt: (v) => fmtInt(Number(v)) },
      { field: 'player', label: 'Player', cls: 'ffwb-strong' },
      { field: 'first_half', label: 'First half', num: true, fmt: pts },
      { field: 'second_half', label: 'Second half', num: true, fmt: pts },
      { field: 'full_season', label: 'Season', num: true, fmt: pts, cls: 'ffwb-strong' },
    ], final);
  });
}

// Copy the weekly report for the group chat.
const copy = document.getElementById('recap-copy');
copy.addEventListener('click', () => {
  const text = document.getElementById('recap-text');
  const done = (label) => {
    copy.textContent = label;
    setTimeout(() => { copy.textContent = 'Copy'; }, 2000);
  };
  const select = () => {
    const range = document.createRange();
    range.selectNodeContents(text);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    done('Selected, now copy');
  };
  try {
    navigator.clipboard.writeText(text.textContent).then(() => done('Copied'), select);
  } catch (err) {
    select();
  }
});

window.ffwb.redraws.push(drawArchive);
dash.onData(() => {
  drawSeasonExtras();
  drawAwardsExtras();
  drawPlayers();
  drawRecordExtras();
  drawArchive();
});

})();
