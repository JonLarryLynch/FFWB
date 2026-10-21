// FFWB cups on the site: the banner on the Table tab, the Cups tile's hook, and the full view in the sheet
// (a bracket for the knockouts, a table for Festive Fixtures).
(function () {
  const C = window.FFWBCups;
  if (!C) return;
  const ORDER = ['league', 'festive', 'fa'];
  const ART = { league: '/brand/cup-league.svg', festive: '/brand/cup-festive.svg', fa: '/brand/cup-fa.svg' };
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const fmt = (n) => String(Math.round(n * 10) / 10);
  const me = () => { try { return localStorage.getItem('ffwb-player'); } catch (err) { return null; } };
  let season = null;
  let chosen = null;
  const chosenRound = {};

  const states = () => (season && season.cups ? season.cups : []).map((cup) => C.state(season, cup)).sort((a, b) => ORDER.indexOf(a.cup.type) - ORDER.indexOf(b.cup.type));
  // The cup to lead with: one being played, else one about to start, else the latest finished.
  function lead(list) {
    return list.find((s) => s.status === 'live') || list.find((s) => s.status === 'upcoming') || [...list].reverse().find((s) => s.status === 'done') || null;
  }
  function stage(s) {
    if (s.status === 'done') return 'Winner: ' + s.champion.name;
    if (s.format === 'league') {
      const next = s.cup.weeks.find((w) => !C.weekFinal(season, w));
      return 'Weeks ' + s.cup.weeks.join(', ') + (next ? ' · week ' + next + ' next' : '');
    }
    const r = s.current;
    if (!r) return '';
    const left = r.matches.reduce((n, m) => n + (m.a ? 1 : 0) + (m.b ? 1 : 0), 0);
    const pks = r.matches.filter((m) => m.status === 'shootout').length;
    if (pks) return r.name + ' · ' + pks + ' penalty shootout' + (pks === 1 ? '' : 's') + ' to settle';
    return r.name + ' · week ' + r.week + (r.index > 0 ? ' · ' + left + ' left' : '');
  }

  // ---------- The tile's hook ----------
  function teaser() {
    const s = lead(states());
    if (!s) return { big: 'Three cups', sub: 'League Cup in the autumn, Festive Fixtures at Christmas, FA Cup in the spring' };
    if (s.status === 'done') return { big: s.champion.name, sub: 'won the ' + s.name };
    return { big: s.name, sub: stage(s) };
  }

  // ---------- The banner on the Table tab ----------
  function banner() {
    const box = document.getElementById('cup-banner');
    if (!box) return;
    const list = states();
    const s = lead(list);
    // Show while a cup is drawn or being played, and for a while after it is won (until the next week starts).
    const recent = s && s.status === 'done' && Math.max(...s.cup.weeks) >= season.config.currentWeek - 2;
    if (!s || (s.status === 'done' && !recent)) { box.hidden = true; return; }
    box.hidden = false;
    box.className = 'cup-banner cup-' + s.cup.type;
    const art = el('img', 'cup-banner-art');
    art.src = ART[s.cup.type]; art.alt = '';
    const text = el('div', 'cup-banner-text');
    text.append(el('div', 'cup-banner-kicker', s.name), el('div', 'cup-banner-stage', stage(s)));
    const mine = me();
    if (mine && s.status !== 'done') {
      const g = C.gameFor(season, [s.cup], mine, s.format === 'league' ? (s.cup.weeks.find((w) => !C.weekFinal(season, w)) || s.cup.weeks[0]) : (s.current && s.current.week));
      if (g && g.kind === 'knockout') text.append(el('div', 'cup-banner-me', g.them ? 'Your game: you v ' + g.them.name : 'You have a bye this round'));
      else if (g && g.kind === 'league') text.append(el('div', 'cup-banner-me', g.pos ? "You're " + ordinal(g.pos) + ' so far' : ''));
      else if (s.format === 'knockout' && s.current && s.current.index > 0) text.append(el('div', 'cup-banner-me', "You're out. Somebody has to be."));
    }
    const go = el('button', 'cup-banner-go', s.format === 'league' ? 'See the table' : 'See the bracket');
    go.type = 'button';
    go.addEventListener('click', () => { chosen = s.cup.type; window.FFWBExplore && window.FFWBExplore.open('cups-box'); });
    box.replaceChildren(art, text, go);
  }
  const listNames = (n) => (n.length > 1 ? n.slice(0, -1).join(', ') + ' and ' + n[n.length - 1] : n.join(''));
  const ordinal = (n) => n + ([, 'st', 'nd', 'rd'][(n % 100 >> 3 ^ 1) && n % 10] || 'th');

  // ---------- The full view ----------
  function row(p, score, win, seedShown) {
    const r = el('div', 'cb-row' + (win ? ' cb-win' : '') + (p && p.id === me() ? ' cb-me' : ''));
    r.append(el('span', 'cb-seed', p && seedShown ? String(p.seed) : ''), el('span', 'cb-name', p ? p.name : 'To be decided'), el('span', 'cb-score', score == null ? '' : fmt(score.points)));
    return r;
  }
  function matchCard(m, nextName) {
    const card = el('div', 'cb-match cb-' + m.status);
    if (m.status === 'bye') {
      card.append(row(m.a || m.b, null, true, true));
      card.append(el('div', 'cb-meta', 'Bye to the ' + (nextName || 'next round').toLowerCase()));
      return card;
    }
    const winA = m.winner && m.a && m.winner === m.a.id;
    const winB = m.winner && m.b && m.winner === m.b.id;
    card.append(row(m.a, m.scoreA, winA, true), row(m.b, m.scoreB, winB, true));
    const meta = m.status === 'final' ? (m.how || 'Full time') : m.status === 'shootout' ? 'Dead level: penalty shootout in FIFA' : m.status === 'live' ? 'In play this week' : m.status === 'waiting' ? 'Waiting on the last round' : 'Week ' + m.week;
    card.append(el('div', 'cb-meta', meta));
    return card;
  }
  function knockoutView(s) {
    const wrap = el('div', 'cb-ko');
    const b = s.bracket;
    const cur = s.current ? s.current.index : b.total - 1;
    const sel = chosenRound[s.cup.type] != null ? chosenRound[s.cup.type] : cur;
    // Round tabs, used on phones where a whole bracket will not fit.
    const tabs = el('div', 'cb-tabs');
    tabs.setAttribute('role', 'tablist');
    const grid = el('div', 'cb-bracket');
    grid.style.setProperty('--rounds', b.rounds.length);
    b.rounds.forEach((r, i) => {
      const t = el('button', 'cb-tab', r.name.replace('Quarter-finals', 'QF').replace('Semi-finals', 'SF').replace('First round', 'R1').replace(/^Round (\d+)/, 'R$1'));
      t.type = 'button';
      t.setAttribute('aria-pressed', String(i === sel));
      t.title = r.name + ', week ' + r.week;
      t.addEventListener('click', () => { chosenRound[s.cup.type] = i; render(); });
      tabs.append(t);
      const col = el('div', 'cb-col' + (i === sel ? ' cb-col-on' : ''));
      const head = el('div', 'cb-col-head');
      head.append(el('span', null, r.name), el('span', 'cb-week', 'Week ' + r.week));
      const list = el('div', 'cb-list');
      for (const m of r.matches) list.append(matchCard(m, b.rounds[i + 1] && b.rounds[i + 1].name));
      col.append(head, list);
      grid.append(col);
    });
    wrap.append(tabs, grid);
    wrap.append(el('p', 'ffwb-note', 'Each game is that week’s normal league points. Level games go to the better lock, then more winning picks, then a penalty shootout in FIFA. Seeds come from the table at the draw.'));
    return wrap;
  }
  function leagueView(s) {
    const wrap = el('div', 'cb-mini');
    const t = el('table', 'ffwb-table cb-table');
    const hr = el('tr');
    hr.append(el('th', 'ffwb-num', '#'), el('th', null, 'Player'));
    for (const w of s.cup.weeks) hr.append(el('th', 'ffwb-num', 'Wk ' + w));
    hr.append(el('th', 'ffwb-num', 'Pts'));
    const thead = el('thead'); thead.append(hr);
    const tbody = el('tbody');
    s.mini.rows.forEach((r, i) => {
      const tr = el('tr', (r.id === me() ? 'cb-me' : '') + (s.champion && s.champion.id === r.id ? ' cb-champ' : ''));
      tr.append(el('td', 'ffwb-num', String(i + 1)), el('td', 'ffwb-strong', r.name));
      for (const w of r.weeks) tr.append(el('td', 'ffwb-num', w ? fmt(w.points) : ''));
      tr.append(el('td', 'ffwb-num ffwb-strong', fmt(r.points)));
      tbody.append(tr);
    });
    t.append(thead, tbody);
    const scroll = el('div', 'ffwb-plot');
    scroll.append(t);
    if (s.mini.shootout) wrap.append(el('p', 'cb-shootout', listNames(s.mini.shootout.map((r) => r.name)) + ' are dead level at the top: penalty shootout in FIFA.'));
    wrap.append(scroll, el('p', 'ffwb-note', 'Most points over the festive weeks wins, counting every pick as normal. Ties go to the better locks, then more winning picks, then a penalty shootout in FIFA.'));
    return wrap;
  }
  function render() {
    const body = document.querySelector('#cups-box .cb-body');
    if (!body || !season) return;
    const list = states();
    if (!chosen || !list.some((s) => s.cup.type === chosen)) chosen = (lead(list) || { cup: { type: 'league' } }).cup.type;
    // One pill per cup, including ones not drawn yet.
    const pills = el('div', 'cb-pills');
    for (const type of ORDER) {
      const s = list.find((x) => x.cup.type === type);
      const b = el('button', 'cb-pill cb-pill-' + type, C.TYPES[type].name);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(type === chosen));
      if (!s) b.classList.add('cb-pill-off');
      b.addEventListener('click', () => { chosen = type; render(); });
      pills.append(b);
    }
    const s = list.find((x) => x.cup.type === chosen);
    const parts = [pills];
    if (!s) {
      const t = C.TYPES[chosen];
      const empty = el('div', 'cb-empty cup-' + chosen);
      const art = el('img', 'cb-empty-art'); art.src = ART[chosen]; art.alt = '';
      empty.append(art, el('h3', null, t.name), el('p', null, t.format === 'league'
        ? 'Not started yet. At ' + t.season + ', the most points over the festive weeks wins it.'
        : 'Not drawn yet. The ' + t.name + ' runs in the ' + t.season.toLowerCase() + ': a seeded knockout, one round a week, with the top of the table getting a bye.'));
      parts.push(empty);
    } else {
      const head = el('div', 'cb-head cup-' + s.cup.type);
      const art = el('img', 'cb-head-art'); art.src = ART[s.cup.type]; art.alt = '';
      const txt = el('div');
      txt.append(el('div', 'cb-head-name', s.name), el('div', 'cb-head-stage', stage(s)));
      head.append(art, txt);
      parts.push(head, s.format === 'league' ? leagueView(s) : knockoutView(s));
    }
    body.replaceChildren(...parts);
  }

  // The banner names your own game, so redraw it when the name on this phone changes.
  document.addEventListener('change', (e) => { if (e.target && e.target.id === 'player-name' && season) setTimeout(() => { banner(); render(); }, 0); });

  window.FFWBCupsUI = { teaser, open: (type) => { chosen = type; window.FFWBExplore && window.FFWBExplore.open('cups-box'); } };
  if (window.FFWB) window.FFWB.onSeason((s) => {
    season = s;
    if (!s) return;
    banner();
    render();
    if (window.FFWBExplore && window.FFWBExplore.refresh) window.FFWBExplore.refresh();
  });
})();
