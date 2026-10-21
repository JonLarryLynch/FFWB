// FFWB polish: the light/dark switch, numbers that count up, who moved in the table, a celebration for
// saving picks after a perfect week, and offline caching through the service worker.
(function () {
  const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (err) { return null; } },
    set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (err) { /* fine */ } },
  };

  // ---------- Light / dark ----------
  const btn = document.getElementById('theme-toggle');
  const MODES = ['auto', 'light', 'dark'];
  function applyTheme(mode) {
    if (mode === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = mode;
    if (btn) btn.textContent = 'Theme: ' + mode[0].toUpperCase() + mode.slice(1);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = '#1c2945';
    window.dispatchEvent(new Event('resize'));
  }
  let mode = store.get('ffwb-theme') || 'auto';
  applyTheme(mode);
  if (btn) btn.addEventListener('click', () => {
    mode = MODES[(MODES.indexOf(mode) + 1) % MODES.length];
    store.set('ffwb-theme', mode === 'auto' ? null : mode);
    applyTheme(mode);
  });

  // ---------- Numbers that count up when they change ----------
  const last = new WeakMap();
  function countUp(node) {
    const text = node.textContent.trim();
    const to = Number(text);
    if (!Number.isFinite(to)) return;
    const from = last.has(node) ? last.get(node) : 0;
    last.set(node, to);
    if (reduce || from === to) return;
    const start = performance.now();
    const dur = 700;
    const step = (t) => {
      const k = Math.min(1, (t - start) / dur);
      const v = from + (to - from) * (1 - Math.pow(1 - k, 3));
      node.textContent = String(Math.round(v * 2) / 2);
      if (k < 1) requestAnimationFrame(step); else node.textContent = text;
    };
    requestAnimationFrame(step);
  }

  // ---------- Who moved: arrows beside the standings ----------
  function arrows() {
    const box = document.getElementById('standings-box');
    const race = window.dash && window.dash.data('race');
    if (!box || !race || race.status !== 'ok' || !race.data.length) return;
    const weeks = [...new Set(race.data.map((r) => r.week))].sort((a, b) => a - b);
    if (weeks.length < 2) return;
    const now = Object.fromEntries(race.data.filter((r) => r.week === weeks[weeks.length - 1]).map((r) => [r.player, r.position]));
    const before = Object.fromEntries(race.data.filter((r) => r.week === weeks[weeks.length - 2]).map((r) => [r.player, r.position]));
    for (const tr of box.querySelectorAll('tbody tr')) {
      const cell = tr.children[1];
      if (!cell || cell.querySelector('.mv')) continue;
      const name = (cell.dataset.player || cell.textContent).trim();
      if (!(name in now) || !(name in before)) continue;
      const d = before[name] - now[name];
      if (!d) continue;
      const s = document.createElement('span');
      s.className = 'mv ' + (d > 0 ? 'mv-up' : 'mv-down');
      s.textContent = (d > 0 ? '▲' : '▼') + Math.abs(d);
      s.title = (d > 0 ? 'Up ' : 'Down ') + Math.abs(d) + ' since last week';
      cell.append(s);
    }
  }

  // The table is redrawn whenever data changes, so add the arrows each time it is.
  const sb = document.getElementById('standings-box');
  let at = null;
  if (sb) new MutationObserver(() => { clearTimeout(at); at = setTimeout(arrows, 60); }).observe(sb, { childList: true, subtree: true });
  if (window.dash) window.dash.onData(() => {
    requestAnimationFrame(() => {
      arrows();
      for (const n of document.querySelectorAll('#t-top, .pk-g-pts-n')) countUp(n);
    });
  });

  // ---------- A celebration for saving picks after a perfect week ----------
  function confetti() {
    if (reduce) return;
    const box = document.createElement('div');
    box.className = 'cf-box';
    box.setAttribute('aria-hidden', 'true');
    const colours = ['#c8a04a', '#f1e8d4', '#7b1f2c', '#1c2945', '#f0d48a'];
    for (let i = 0; i < 70; i += 1) {
      const p = document.createElement('i');
      p.style.left = 50 + (Math.random() - 0.5) * 30 + '%';
      p.style.background = colours[i % colours.length];
      p.style.setProperty('--x', ((Math.random() - 0.5) * 900).toFixed(0) + 'px');
      p.style.setProperty('--y', (-200 - Math.random() * 500).toFixed(0) + 'px');
      p.style.setProperty('--r', (Math.random() * 900 - 450).toFixed(0) + 'deg');
      p.style.animationDelay = (Math.random() * 0.15).toFixed(2) + 's';
      box.append(p);
    }
    document.body.append(box);
    setTimeout(() => box.remove(), 2600);
  }
  document.addEventListener('ffwb:picks-saved', (e) => { if (e.detail && e.detail.bonus) confetti(); });
  // The saved copy for bad signal (and phone alerts) both live in the service worker.
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  window.FFWBPolish = { confetti };
})();
