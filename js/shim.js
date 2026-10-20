// Football FWB, standalone copy. The page's scripts were written against a small "dash" data
// interface; this file provides it from the data saved alongside the page, so nothing here
// needs a sign-in or a connection to the spreadsheet.
(function () {
  const raw = window.FFWB_RAW || {};
  const csv = window.FFWB_CSV || {};
  const loaders = {};
  const calcs = {};
  const cache = {};
  const listeners = [];

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

  function compute(id) {
    try {
      if (calcs[id]) {
        const inputs = calcs[id].inputs.map((name) => window.dash.data(name));
        if (inputs.some((x) => x.status !== 'ok')) return { status: 'error', data: [] };
        return { status: 'ok', data: calcs[id].fn(...inputs.map((x) => x.data)) };
      }
      if (id in csv) return { status: 'ok', data: parseCsv(csv[id]) };
      if (id in raw) {
        if (!loaders[id]) return { status: 'ok', data: raw[id] };
        const out = loaders[id].fn({ answer: raw[id] });
        return { status: 'ok', data: Array.isArray(out) ? out : out.rows || out.data || [] };
      }
      return { status: 'missing', data: [] };
    } catch (err) {
      console.error('Football FWB: could not work out "' + id + '"', err);
      return { status: 'error', data: [], message: String(err) };
    }
  }

  const run = (fn) => { try { fn(); } catch (err) { console.error(err); } };
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
    refresh() {},
  };

  const stamp = document.getElementById('as-of');
  if (stamp && raw.as_of) {
    const d = new Date(raw.as_of + 'T12:00:00');
    stamp.textContent = 'Scores as of ' + d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) + '.';
  }
})();
