// Football FWB data layer. The page's charts read data through a small "dash" interface.
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
    for (const [id, weeks] of Object.entries(season.picks)) {
      for (const [w, p] of Object.entries(weeks || {})) {
        const week = Number(w);
        const res = season.results[w] || {};
        const half = R.halfOf(week) === 1 ? '1H' : '2H';
        (p.standard || []).forEach((club, i) => picks.push({ week, slot: i + 1, pick_type: 'Standard', half, player: names[id] || id, club, points: R.pickPoints(res[club], false) }));
        if (p.lock) picks.push({ week, slot: 5, pick_type: 'Lock', half, player: names[id] || id, club: p.lock, points: R.pickPoints(res[p.lock], true) });
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
    return { picks, results };
  }

  function compute(id) {
    try {
      if (calcs[id]) {
        const inputs = calcs[id].inputs.map((name) => window.dash.data(name));
        if (inputs.some((x) => x.status === 'loading')) return { status: 'loading', data: [] };
        if (inputs.some((x) => x.status !== 'ok')) return { status: 'error', data: [] };
        return { status: 'ok', data: calcs[id].fn(...inputs.map((x) => x.data)) };
      }
      if (id in csv) return { status: 'ok', data: parseCsv(csv[id]) };
      if (id in raw) {
        if (Array.isArray(raw[id])) return { status: 'ok', data: raw[id] };
        if (!loaders[id]) return { status: 'ok', data: raw[id] };
        const out = loaders[id].fn({ answer: raw[id] });
        return { status: 'ok', data: Array.isArray(out) ? out : out.rows || out.data || [] };
      }
      return { status: loading ? 'loading' : 'missing', data: [] };
    } catch (err) {
      console.error('Football FWB: could not work out "' + id + '"', err);
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
      loading = false;
      const t = new Date(season.serverTime);
      stamp('Live scores, updated ' + t.toLocaleString('en-US', { month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + '.');
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
        loading = false;
        const d = saved.as_of ? new Date(saved.as_of + 'T12:00:00') : null;
        stamp('The live scores could not be loaded, so this is the saved copy' + (d ? ' from ' + d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' }) : '') + '. Picks cannot be made until the live scores load.');
        seasonListeners.forEach((fn) => run(() => fn(null)));
        redraw();
      }
    },
  };
})();
