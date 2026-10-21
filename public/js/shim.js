// FFWB data layer. The page's charts read data through a small "dash" interface.
// This season comes live from the league API (/api/season); history is the saved files in data/.
// If the API cannot be reached, the page falls back to the saved copy in data/season.js.
(function () {
  const csv = window.FFWB_CSV || {};
  const saved = window.FFWB_RAW || {};
  const raw = {};
  const loaders = {};
  const calcs = {};
  let cache = {};
  const listeners = [];
  let loading = true;

  // CSV text to row objects, with quoted cells handled.
  function parseCsv(text) {
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 1; }
        else if (ch === '"') quoted = false;
        else cell += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ',') { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i += 1;
        row.push(cell);
        cell = '';
        if (row.length > 1 || row[0] !== '') rows.push(row);
        row = [];
      } else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    const head = rows.shift() || [];
    return rows.map((r) => Object.fromEntries(head.map((name, i) => [name, r[i] == null ? '' : r[i]])));
  }

  // The API's season into the row shapes the charts were written for.
  function rowsFromSeason(season) {
    const R = window.FFWBRules;
    const names = Object.fromEntries(season.config.players.map((p) => [p.id, p.name]));
    const picks = [];
    const efl = [];
    for (const [id, weeks] of Object.entries(season.picks)) {
      for (const [w, p] of Object.entries(weeks || {})) {
        const week = Number(w);
        const res = season.results[w] || {};
        const half = R.halfOf(week) === 1 ? '1H' : '2H';
        (p.standard || []).forEach((club, i) => picks.push({ week, slot: i + 1, pick_type: 'Standard', half, player: names[id] || id, club, points: R.pickPoints(res[club], false) }));
        if (p.lock) picks.push({ week, slot: 5, pick_type: 'Lock', half, player: names[id] || id, club: p.lock, points: R.pickPoints(res[p.lock], true) });
        // EFL picks are kept apart: they add to points but are not Premier League clubs.
        if (p.efl) {
          const r = (season.eflResults || {})[w] || {};
          efl.push({ week, player: names[id] || id, club: p.efl, points: R.pickPoints(r[p.efl], false), result: r[p.efl] == null ? '' : r[p.efl] === 'P' ? 'P' : r[p.efl] === 1 ? 'W' : r[p.efl] === 0.5 ? 'D' : 'L' });
        }
      }
    }
    const results = [];
    for (let week = 1; week <= R.WEEKS; week += 1) {
      const res = season.results[String(week)] || {};
      for (const club of season.config.clubs) {
        const v = res[club];
        results.push({ week, club, points: v === 1 || v === 0.5 || v === 0 ? v : null });
      }
    }
    return { picks, results, efl };
  }

  // ---------- End of season ----------
  // A half is finished once every week in it has a final result for every club.
  function halfDone(season, half) {
    const R = window.FFWBRules;
    return R.weeksInHalf(half).every((w) => {
      const res = season.results[String(w)] || {};
      return season.config.clubs.every((c) => res[c] === 1 || res[c] === 0.5 || res[c] === 0);
    });
  }

  // Each player's points per week, split into Premier League picks and EFL picks.
  function weekly(season) {
    const R = window.FFWBRules;
    const out = [];
    for (const p of season.config.players) {
      for (const [w, wp] of Object.entries(season.picks[p.id] || {})) {
        const res = season.results[w] || {};
        if (!Object.keys(res).length) continue;
        const eres = (season.eflResults || {})[w] || {};
        const std = (wp.standard || []).map((c) => ({ club: c, type: 'Standard', v: res[c], pts: R.pickPoints(res[c], false) }));
        const lock = wp.lock ? [{ club: wp.lock, type: 'Lock', v: res[wp.lock], pts: R.pickPoints(res[wp.lock], true) }] : [];
        const all = [...std, ...lock];
        const efl = wp.efl ? R.pickPoints(eres[wp.efl], false) : 0;
        out.push({ player: p.name, week: Number(w), all, lock: lock[0] || null, points: all.reduce((a, x) => a + x.pts, 0), efl });
      }
    }
    return out;
  }

  // Ranked totals for a set of weeks, with the league's tiebreaks: wins, lock wins, lock points.
  function table(rows, weeks) {
    const by = new Map();
    for (const r of rows) {
      if (!weeks.has(r.week)) continue;
      if (!by.has(r.player)) by.set(r.player, { player: r.player, points: 0, wins: 0, lock_wins: 0, lock_points: 0 });
      const t = by.get(r.player);
      t.points += r.points + r.efl;
      t.wins += r.all.filter((x) => x.v === 1).length;
      if (r.lock) { t.lock_points += r.lock.pts; if (r.lock.v === 1) t.lock_wins += 1; }
    }
    return [...by.values()].sort((a, b) => b.points - a.points || b.wins - a.wins || b.lock_wins - a.lock_wins || b.lock_points - a.lock_points || a.player.localeCompare(b.player));
  }

  const n1 = (x) => (Math.round(x * 10) / 10).toFixed(1);
  // The season's winners so far, and once it is over, the rows it adds to the history datasets.
  function wrapUp(season) {
    const R = window.FFWBRules;
    const rows = weekly(season);
    const range = (half) => new Set(R.weeksInHalf(half));
    const firstDone = halfDone(season, 1);
    const allDone = firstDone && halfDone(season, 2);
    const first = firstDone ? table(rows, range(1)) : null;
    const second = allDone ? table(rows, range(2)) : null;
    const full = allDone ? table(rows, new Set([...range(1), ...range(2)])) : null;
    const crowns = { season: season.config.season, first: first && first[0], second: second && second[0], champion: full && full[0], full };
    if (!allDone) return { crowns, history: null };
    const label = season.config.season;
    const f1 = new Map(first.map((t) => [t.player, t.points]));
    const f2 = new Map(second.map((t) => [t.player, t.points]));
    const avg = full.reduce((a, t) => a + t.points, 0) / full.length;
    const history = {
      history_seasons: full.map((t, i) => ({ season: label, player: t.player, first_half: n1(f1.get(t.player) || 0), second_half: n1(f2.get(t.player) || 0), full_season: n1(t.points), finish: String(i + 1), players: String(full.length), league_avg: n1(avg), source_tab: 'League site' })),
      honours: [{ season: label, first_half: first[0].player, second_half: second[0].player, champion: full[0].player, fa_cup: '', league_cup: '', festive: '', community_shield: '' }],
      history_weeks: rows.map((r) => ({ season: label, week: String(r.week), player: r.player, points: n1(r.points), picks: String(r.all.length), wins: String(r.all.filter((x) => x.v === 1).length), lock_club: r.lock ? r.lock.club : '', lock_result: r.lock ? (r.lock.v === 1 ? 'W' : r.lock.v === 0.5 ? 'D' : 'L') : '', bonus: r.efl ? n1(r.efl) : '' })),
      history_picks: [],
    };
    const agg = new Map();
    for (const r of rows) for (const x of r.all) {
      const k = r.player + '|' + x.club + '|' + x.type;
      if (!agg.has(k)) agg.set(k, { season: label, player: r.player, club: x.club, pick_type: x.type, picks: 0, wins: 0, draws: 0, losses: 0, points: 0 });
      const a = agg.get(k);
      a.picks += 1;
      if (x.v === 1) a.wins += 1; else if (x.v === 0.5) a.draws += 1; else a.losses += 1;
      a.points += x.pts;
    }
    history.history_picks = [...agg.values()].map((a) => ({ ...a, picks: String(a.picks), wins: String(a.wins), draws: String(a.draws), losses: String(a.losses), points: n1(a.points) }));
    return { crowns, history };
  }

  // Draw the winners on the Table tab: the first half after week 19, everything after week 38.
  function drawCrowns(crowns) {
    const box = document.getElementById('crowns');
    if (!box) return;
    const items = [];
    const fmt = (t) => t.player + ', ' + (Math.round(t.points * 10) / 10) + ' pts';
    if (crowns.champion) items.push(['Champion', fmt(crowns.champion)]);
    if (crowns.first) items.push(['First half', fmt(crowns.first)]);
    if (crowns.second) items.push(['Second half', fmt(crowns.second)]);
    box.hidden = !items.length;
    if (!items.length) return;
    const title = document.createElement('h2');
    title.className = 'ffwb-h';
    title.textContent = crowns.champion ? crowns.season + ' is in the books' : 'First half winner';
    const list = document.createElement('div');
    list.className = 'ffwb-crowns';
    for (const [what, who] of items) {
      const d = document.createElement('div');
      d.className = 'ffwb-crown' + (what === 'Champion' ? ' ffwb-crown-top' : '');
      const art = document.createElement('img');
      art.className = 'ffwb-crown-art';
      art.alt = '';
      art.src = '/brand/' + (what === 'Champion' ? 'trophy-champion' : what === 'First half' ? 'medal-first' : 'medal-second') + '.svg';
      const txt = document.createElement('div');
      const a = document.createElement('div'); a.className = 'ffwb-crown-what'; a.textContent = what;
      const b = document.createElement('div'); b.className = 'ffwb-crown-who'; b.textContent = who;
      txt.append(a, b);
      d.append(art, txt);
      list.append(d);
    }
    const parts = [title, list];
    if (crowns.champion) {
      const note = document.createElement('p');
      note.className = 'ffwb-note';
      const podium = crowns.full.slice(1, 3).map((t) => t.player);
      const last = crowns.full[crowns.full.length - 1];
      note.textContent = (podium.length ? 'Runners-up: ' + podium.join(' and ') + '. ' : '') + 'Bottom of the table: ' + last.player + '. The season is now part of the History tab, so it counts in the records and past seasons.';
      parts.push(note);
    }
    box.replaceChildren(...parts);
  }

  let extra = {};

  function compute(id) {
    try {
      if (calcs[id]) {
        const inputs = calcs[id].inputs.map((name) => window.dash.data(name));
        if (inputs.some((x) => x.status === 'loading')) return { status: 'loading', data: [] };
        if (inputs.some((x) => x.status !== 'ok')) return { status: 'error', data: [] };
        return { status: 'ok', data: calcs[id].fn(...inputs.map((x) => x.data)) };
      }
      if (id in csv) return { status: 'ok', data: extra[id] ? parseCsv(csv[id]).concat(extra[id]) : parseCsv(csv[id]) };
      if (id in raw) {
        if (Array.isArray(raw[id])) return { status: 'ok', data: raw[id] };
        if (!loaders[id]) return { status: 'ok', data: raw[id] };
        const out = loaders[id].fn({ answer: raw[id] });
        return { status: 'ok', data: Array.isArray(out) ? out : out.rows || out.data || [] };
      }
      return { status: loading ? 'loading' : 'missing', data: [] };
    } catch (err) {
      console.error('FFWB: could not work out "' + id + '"', err);
      return { status: 'error', data: [], message: String(err) };
    }
  }

  const run = (fn) => { try { fn(); } catch (err) { console.error(err); } };
  const redraw = () => { cache = {}; listeners.forEach(run); };
  let timer = null;
  window.addEventListener('resize', () => {
    clearTimeout(timer);
    timer = setTimeout(() => listeners.forEach(run), 150);
  });

  window.dash = {
    colors: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => 'var(--series-' + n + ')'),
    loader(id, def) { loaders[id] = def; },
    calc(id, def) { calcs[id] = def; },
    data(id) {
      if (!(id in cache)) cache[id] = compute(id);
      return cache[id];
    },
    onData(fn) { listeners.push(fn); run(fn); },
    setLink(name) { try { history.replaceState(null, '', '#' + name); } catch (err) { /* the link is a nicety */ } },
    params() { return {}; },
    setParams() {},
    resetParams() {},
    refresh() { window.FFWB.reload(); },
  };

  const stamp = (text) => {
    const el = document.getElementById('as-of');
    if (el) el.textContent = text;
  };
  const seasonListeners = [];

  window.FFWB = {
    season: null,
    live: false,
    onSeason(fn) { seasonListeners.push(fn); if (this.season) run(() => fn(this.season)); },
    // Use a season from the API: hand it to the picks page and redraw every chart.
    useSeason(season) {
      this.season = season;
      this.live = true;
      const rows = rowsFromSeason(season);
      raw.picks_2026 = rows.picks;
      raw.results_2026 = rows.results;
      raw.efl_2026 = rows.efl;
      try {
        const w = wrapUp(season);
        // Only add the season to History if it is not already there from the saved files.
        const known = (csv.honours || '').split('\n').some((l) => l.startsWith(season.config.season + ','));
        extra = w.history && !known ? { ...w.history } : {};
        // This season's honours so far, cups included, go into the honours table and trophy cabinet as they are won.
        if (!known) {
          const row = { season: season.config.season, first_half: w.crowns.first ? w.crowns.first.player : '', second_half: w.crowns.second ? w.crowns.second.player : '', champion: w.crowns.champion ? w.crowns.champion.player : '', fa_cup: '', league_cup: '', festive: '', community_shield: '' };
          if (window.FFWBCups) {
            for (const cup of season.cups || []) {
              const st = window.FFWBCups.state(season, cup);
              if (st.champion) row[st.honour] = st.champion.name;
            }
          }
          if (Object.entries(row).some(([k, v]) => k !== 'season' && v)) extra.honours = [row];
        }
        drawCrowns(w.crowns);
      } catch (err) { console.error('FFWB: could not work out the season winners', err); extra = {}; }
      loading = false;
      const t = new Date(season.serverTime);
      stamp('Live scores, updated ' + t.toLocaleString('en-US', { month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + '.');
      const banner = document.getElementById('offline');
      if (banner) banner.hidden = true;
      seasonListeners.forEach((fn) => run(() => fn(season)));
      redraw();
    },
    async reload() {
      try {
        const res = await fetch('/api/season', { cache: 'no-store' });
        if (!res.ok) throw new Error('The league server answered ' + res.status);
        const season = await res.json();
        if (!season.ok) throw new Error(season.error || 'The league server could not load the season.');
        this.useSeason(season);
      } catch (err) {
        console.error(err);
        if (this.live) return;
        // Fall back to the saved copy so the standings still show.
        raw.picks_2026 = saved.picks_2026;
        raw.results_2026 = saved.results_2026;
        raw.efl_2026 = saved.efl_2026 || [];
        loading = false;
        const d = saved.as_of ? new Date(saved.as_of + 'T12:00:00') : null;
        const text = 'The live scores could not be loaded, so this is the saved copy' + (d ? ' from ' + d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' }) : '') + '. Picks cannot be made until the live scores load.';
        stamp(text);
        const banner = document.getElementById('offline');
        if (banner) { banner.textContent = text; banner.hidden = false; }
        seasonListeners.forEach((fn) => run(() => fn(null)));
        redraw();
      }
    },
  };
})();
