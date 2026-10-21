// FFWB explore tiles: on the Table, Stats and History tabs, every section beyond the headline one is a tile
// with a live hook ("Basler 23% to win the league"). Tapping a tile opens the full section in a sheet, which
// slides up on phones and sits in the middle on bigger screens. Next steps through the tab's tiles.
(function () {
  const get = (id) => { const d = window.dash.data(id); return d && d.status === 'ok' ? d.data : []; };
  const num = (n, d = 1) => (Math.round(Number(n) * 10 ** d) / 10 ** d).toLocaleString('en-US');
  const pct = (n) => Math.round(Number(n) * 100) + '%';
  const names = (list, max = 2) => (list.length > max ? list.length + ' players' : list.length > 1 ? list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1] : list.join(''));
  const topBy = (rows, key) => {
    if (!rows.length) return [];
    const best = Math.max(...rows.map((r) => Number(r[key]) || 0));
    return rows.filter((r) => (Number(r[key]) || 0) === best);
  };
  const none = { big: 'Coming soon', sub: 'Fills in as the season goes' };

  // Small line icons, drawn on a 24 grid.
  const ICONS = {
    race: '<path d="M3 17l5-6 4 3 6-8"/><path d="M15 6h3v3"/><path d="M3 21h18"/>',
    numbers: '<path d="M5 20V10M10 20V4M15 20v-7M20 20v-4"/>',
    target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r=".8" fill="currentColor"/>',
    lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    card: '<rect x="4" y="3" width="16" height="18" rx="2"/><circle cx="12" cy="10" r="3"/><path d="M7.5 18c1-2.5 8-2.5 9 0"/>',
    odds: '<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="9" cy="9" r="1.2" fill="currentColor"/><circle cx="15" cy="15" r="1.2" fill="currentColor"/><circle cx="15" cy="9" r="1.2" fill="currentColor"/><circle cx="9" cy="15" r="1.2" fill="currentColor"/>',
    herd: '<path d="M6 14a4 4 0 0 1 1-7.9A5 5 0 0 1 16.5 7 3.5 3.5 0 0 1 18 14z"/><path d="M8 14v4M15 14v4"/>',
    compass: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
    cup: '<path d="M7 4h10v4a5 5 0 0 1-10 0z"/><path d="M7 5H4.5v1.5A3.5 3.5 0 0 0 8 10M17 5h2.5v1.5A3.5 3.5 0 0 1 16 10"/><path d="M12 13v3M8 20h8l-1-4H9z"/>',
    trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4"/><path d="M12 13v4M8.5 20h7M10 17h4v3h-4z"/>',
    laurel: '<path d="M12 20c-4-2-7-6-7-11M12 20c4-2 7-6 7-11"/><path d="M5 9c2 0 3 1 3 3M19 9c-2 0-3 1-3 3M6 14c2 0 3 1 3 2.5M18 14c-2 0-3 1-3 2.5"/>',
    star: '<path d="M12 3l2.7 5.6 6.1.8-4.5 4.2 1.1 6-5.4-2.9-5.4 2.9 1.1-6L3.2 9.4l6.1-.8z"/>',
    book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5M9 7h6"/>',
    shame: '<circle cx="12" cy="12" r="9"/><path d="M8.5 9.5h.01M15.5 9.5h.01" stroke-width="2.6"/><path d="M8 16c2.5-2 5.5-2 8 0"/>',
    swords: '<path d="M4 4l9 9M20 4l-9 9"/><path d="M14 16l4 4M10 16l-4 4M16 13l-3 3M8 13l3 3"/>',
    bolt: '<path d="M13 3L5 14h6l-1 7 8-11h-6z"/>',
    clover: '<path d="M12 12c-3-4-7-2-5 1s5-1 5-1zM12 12c4-3 2-7-1-5s1 5 1 5zM12 12c3 4 7 2 5-1s-5 1-5 1zM12 12c-4 3-2 7 1 5s-1-5-1-5z"/>',
    heart: '<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/>',
    moon: '<path d="M19 15A8 8 0 1 1 9 5a6.5 6.5 0 0 0 10 10z"/>',
    calendar: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
    podium: '<path d="M9 9h6v11H9zM3 13h6v7H3zM15 15h6v5h-6z"/>',
    shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
  };
  const svg = (name) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || '') + '</svg>';

  // Every tile: the section it opens, where it sits, and its hook.
  const TILES = [
    // Table
    { tab: 'table', id: 'cups-box', title: 'Cups', icon: 'cup', tone: 'navy', size: 'wide', art: '/brand/cup-league.svg', teaser() {
      return window.FFWBCupsUI ? window.FFWBCupsUI.teaser() : none;
    } },
    { tab: 'table', id: 'race-chart', title: 'The race', icon: 'race', tone: 'cream', teaser() {
      const race = get('race');
      if (!race.length) return none;
      const tops = {};
      for (const r of race) if (r.position === 1) tops[r.player] = (tops[r.player] || 0) + 1;
      const weeks = new Set(race.map((r) => r.week)).size;
      const best = Math.max(...Object.values(tops));
      const who = Object.keys(tops).filter((p) => tops[p] === best);
      return { big: names(who), sub: (who.length === 1 ? 'has' : 'have') + ' been top after ' + best + ' of ' + weeks + ' weeks' };
    } },
    { tab: 'table', id: 'season-figures', title: 'Season in numbers', icon: 'numbers', tone: 'gold', teaser() {
      const s = get('season_summary')[0];
      return s ? { big: pct(s.lock_win_rate), sub: 'of locks have won · ' + num(s.spread) + ' points first to last' } : none;
    } },
    { tab: 'table', id: 'club-chart', title: 'Where the picks went', icon: 'target', tone: 'cream', size: 'wide', teaser() {
      const c = [...get('club_picks')].sort((a, b) => b.picks - a.picks)[0];
      return c ? { big: c.club, sub: c.picks + ' picks so far, ' + Number(c.per_pick).toFixed(2) + ' points a pick' } : none;
    } },
    { tab: 'table', id: 'lock-chart', title: 'Locks, week by week', icon: 'lock', tone: 'claret', size: 'wide', teaser() {
      const top = topBy(get('standings'), 'lock_wins');
      return top.length ? { big: names(top.map((r) => r.player)), sub: top[0].lock_wins + ' locks won' + (top.length > 1 ? ' each' : '') + ', the most in the league' } : none;
    } },
    // Stats
    { tab: 'stats', id: 'odds-box', title: 'Title odds', icon: 'odds', tone: 'navy', teaser() {
      const o = [...get('title_odds')].sort((a, b) => b.title_odds - a.title_odds);
      return o.length ? { big: o[0].player + ' ' + pct(o[0].title_odds), sub: 'to win the league' + (o[1] ? ' · ' + o[1].player + ' next on ' + pct(o[1].title_odds) : '') } : none;
    } },
    { tab: 'stats', id: 'player-section', title: 'Player cards', icon: 'card', tone: 'claret', teaser() {
      const c = [...get('player_cards')].sort((a, b) => (b.trophies || 0) - (a.trophies || 0))[0];
      return c ? { big: get('player_cards').length + ' cards', sub: 'Titles, rivals and bogey clubs. ' + c.player + ' has ' + c.trophies + ' trophies' } : none;
    } },
    { tab: 'stats', id: 'herd-card', title: 'Can you beat the Herd?', icon: 'herd', tone: 'cream', teaser() {
      const v = get('vs_herd');
      const herd = v.find((r) => /herd/i.test(r.player));
      if (!herd) return none;
      const ahead = v.filter((r) => r !== herd && r.points > herd.points).length;
      return { big: ahead + ' of ' + (v.length - 1), sub: 'are beating the Herd, a player who just follows the crowd' };
    } },
    { tab: 'stats', id: 'herd-box', title: 'Sheep and mavericks', icon: 'compass', tone: 'gold', teaser() {
      const h = [...get('herd')].sort((a, b) => a.herd - b.herd);
      return h.length ? { big: h[0].player, sub: 'is the biggest maverick · ' + h[h.length - 1].player + ' follows the crowd most' } : none;
    } },
    // History: hall of fame
    { tab: 'history', group: 'Hall of fame', id: 'cabinet-box', title: 'Trophy cabinet', icon: 'trophy', tone: 'gold', size: 'wide', art: '/brand/trophy-champion.svg', teaser() {
      const top = topBy(get('trophy_cabinet'), 'total');
      return top.length ? { big: names(top.map((r) => r.player), 4), sub: top[0].total + ' trophies' + (top.length > 1 ? ' each' : '') + ', the most of anyone' } : none;
    } },
    { tab: 'history', group: 'Hall of fame', id: 'records-box', title: 'Record book', icon: 'book', tone: 'navy', teaser() {
      const r = get('records')[0];
      return r ? { big: r.holder, sub: r.record + ': ' + r.detail } : none;
    } },
    { tab: 'history', group: 'Hall of fame', id: 'honours-box', title: 'Honours by season', icon: 'laurel', tone: 'cream', teaser() {
      const done = get('honours').filter((r) => r.champion);
      const last = done[done.length - 1];
      return last ? { big: last.champion, sub: 'the last champion, in ' + last.season } : none;
    } },
    { tab: 'history', group: 'Hall of fame', id: 'careers-box', title: 'Career records', icon: 'star', tone: 'cream', size: 'wide', teaser() {
      const c = [...get('careers')].sort((a, b) => b.titles - a.titles || b.vs_avg - a.vs_avg)[0];
      return c ? { big: c.player, sub: c.titles + ' titles in ' + c.seasons + ' seasons, the best record in the league' } : none;
    } },
    { tab: 'history', group: 'Hall of fame', id: 'shame-box', title: 'The Shame Club', icon: 'shame', tone: 'claret', size: 'wide', teaser() {
      const m = window.FFWBShame ? window.FFWBShame.members(window.FFWB.season) : [];
      const plat = m.filter((x) => x.note === 'Platinum Member').map((x) => x.name);
      return m.length ? { big: m.length + ' members', sub: 'who picked both teams from one match' + (plat.length ? '. Platinum: ' + (plat.length > 3 ? plat.slice(0, 2).join(', ') + ' and ' + (plat.length - 2) + ' more' : names(plat, 3)) : '') } : { big: 'No members', sub: 'Yet.' };
    } },
    // History: rivalries and quirks
    { tab: 'history', group: 'Rivalries and quirks', id: 'h2h-chart', title: 'Head to head', icon: 'swords', tone: 'navy', size: 'wide', teaser() {
      const h = get('head_to_head').filter((r) => r.won + r.lost >= 60).sort((a, b) => b.share - a.share)[0];
      return h ? { big: h.player + ' over ' + h.opponent, sub: 'wins ' + pct(h.share) + ' of their weeks, the most one-sided rivalry' } : none;
    } },
    { tab: 'history', group: 'Rivalries and quirks', id: 'weeks-box', title: 'Big weeks and lock runs', icon: 'bolt', tone: 'gold', teaser() {
      const top = topBy(get('week_records'), 'perfect');
      return top.length ? { big: names(top.map((r) => r.player)), sub: top[0].perfect + ' perfect weeks' + (top.length > 1 ? ' each' : '') + ', the most ever' } : none;
    } },
    { tab: 'history', group: 'Rivalries and quirks', id: 'edges-box', title: 'Lucky and bogey clubs', icon: 'clover', tone: 'cream', teaser() {
      const e = [...get('club_edges')].sort((a, b) => (b.lucky_per_pick - b.lucky_others) - (a.lucky_per_pick - a.lucky_others))[0];
      return e ? { big: e.player + ' and ' + e.lucky_club, sub: '+' + (e.lucky_per_pick - e.lucky_others).toFixed(2) + ' points a pick over everyone else' } : none;
    } },
    { tab: 'history', group: 'Rivalries and quirks', id: 'loyalty-box', title: 'Heart or head', icon: 'heart', tone: 'claret', size: 'wide', teaser() {
      const l = [...get('loyalty')].sort((a, b) => b.times_as_often - a.times_as_often)[0];
      return l ? { big: l.player, sub: 'picks ' + l.club + ' ' + num(l.times_as_often) + ' times as often as the rest' } : none;
    } },
    { tab: 'history', group: 'Rivalries and quirks', id: 'black-box', title: 'Black weekends', icon: 'moon', tone: 'navy', size: 'wide', teaser() {
      const b = get('black_weekends');
      return b.length ? { big: b.length + ' weekends', sub: 'when not one lock in the league won' } : none;
    } },
    // History: the archive
    { tab: 'history', group: 'The archive', id: 'archive-section', title: 'Past seasons', icon: 'calendar', tone: 'navy', size: 'wide', teaser() {
      const seasons = [...new Set(get('history_seasons').map((r) => r.season))];
      return seasons.length ? { big: seasons.length + ' seasons', sub: 'Every title race and final table since ' + seasons[0] } : none;
    } },
    { tab: 'history', group: 'The archive', id: 'finish-chart', title: 'Finishing positions', icon: 'podium', tone: 'cream', teaser() {
      const top = topBy(get('careers'), 'top3');
      return top.length ? { big: names(top.map((r) => r.player)), sub: top[0].top3 + ' top-three finishes' + (top.length > 1 ? ' each' : '') + ', the most of anyone' } : none;
    } },
    { tab: 'history', group: 'The archive', id: 'clubs-box', title: 'Clubs, all-time', icon: 'shield', tone: 'gold', teaser() {
      const c = get('club_history')[0];
      return c ? { big: c.club, sub: num(c.picks, 0) + ' picks since 2016-17, ' + pct(c.win_rate) + ' of them won' } : none;
    } },
  ];

  // ---------- Tiles ----------
  const tileEls = new Map();
  function build() {
    for (const grid of document.querySelectorAll('.xp[data-xp-tab]')) {
      const tab = grid.dataset.xpTab;
      const tiles = TILES.filter((t) => t.tab === tab && document.getElementById(t.id));
      const groups = [...new Set(tiles.map((t) => t.group || ''))];
      grid.replaceChildren();
      for (const g of groups) {
        const head = document.createElement('h2');
        head.className = 'xp-group';
        head.textContent = g || (tab === 'table' ? 'More this season' : 'Dig deeper');
        const wrap = document.createElement('div');
        wrap.className = 'xp-grid';
        for (const t of tiles.filter((x) => (x.group || '') === g)) {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'xp-tile xp-' + t.tone + (t.size === 'wide' ? ' xp-wide' : '');
          b.innerHTML = '<span class="xp-icon">' + svg(t.icon) + '</span>'
            + '<span class="xp-label"></span><span class="xp-big"></span><span class="xp-sub"></span>'
            + '<span class="xp-go" aria-hidden="true">Open <span>&rsaquo;</span></span>'
            + (t.art ? '<img class="xp-art" alt="" src="' + t.art + '">' : '');
          b.querySelector('.xp-label').textContent = t.title;
          b.addEventListener('click', () => open(t));
          wrap.append(b);
          tileEls.set(t.id, b);
        }
        grid.append(head, wrap);
      }
    }
  }
  function fill() {
    for (const t of TILES) {
      const b = tileEls.get(t.id);
      if (!b) continue;
      let v = none;
      try { v = t.teaser() || none; } catch (err) { console.error(err); }
      b.querySelector('.xp-big').textContent = v.big;
      b.querySelector('.xp-sub').textContent = v.sub;
      b.setAttribute('aria-label', t.title + ': ' + v.big + ', ' + v.sub + '. Open');
    }
  }

  // ---------- The sheet ----------
  const sheet = document.getElementById('xp-sheet');
  const body = document.getElementById('xp-body');
  const nextBtn = document.getElementById('xp-next');
  let current = null;
  let home = null;
  const redraw = () => window.dispatchEvent(new Event('resize'));

  function putBack() {
    if (!current) return;
    const el = document.getElementById(current.id);
    if (el && home) home.parent.insertBefore(el, home.marker);
    if (home && home.marker) home.marker.remove();
    current = null;
    home = null;
  }
  function open(t) {
    putBack();
    const el = document.getElementById(t.id);
    if (!el) return;
    const marker = document.createComment('xp ' + t.id);
    el.parentNode.insertBefore(marker, el);
    home = { parent: marker.parentNode, marker };
    current = t;
    body.replaceChildren(el);
    body.scrollTop = 0;
    document.getElementById('xp-title').textContent = t.title;
    document.getElementById('xp-kicker').textContent = t.group || { table: 'This season', stats: 'Stats' }[t.tab] || '';
    const list = TILES.filter((x) => x.tab === t.tab && tileEls.has(x.id));
    const next = list[(list.indexOf(t) + 1) % list.length];
    nextBtn.textContent = 'Next: ' + next.title + ' ›';
    nextBtn.onclick = () => open(next);
    if (!sheet.open) { sheet.showModal(); document.documentElement.classList.add('xp-locked'); }
    try { history.replaceState(null, '', '#' + t.id); } catch (err) { /* nicety */ }
    // Charts drawn while tucked away have no width, so draw them again now they can be seen.
    requestAnimationFrame(() => requestAnimationFrame(redraw));
  }
  // Any content in the sheet, not tied to a tile (the pick planner, for one).
  function openCustom(title, kicker, node) {
    putBack();
    body.replaceChildren(node);
    body.scrollTop = 0;
    document.getElementById('xp-title').textContent = title;
    document.getElementById('xp-kicker').textContent = kicker || '';
    nextBtn.textContent = 'Close';
    nextBtn.onclick = () => close();
    if (!sheet.open) { sheet.showModal(); document.documentElement.classList.add('xp-locked'); }
  }
  function close() {
    if (sheet.open) sheet.close();
  }
  sheet.addEventListener('close', () => {
    const tab = current && current.tab;
    putBack();
    document.documentElement.classList.remove('xp-locked');
    try { history.replaceState(null, '', tab ? '#' + tab : location.pathname); } catch (err) { /* nicety */ }
  });
  document.getElementById('xp-close').addEventListener('click', close);
  // Tap outside the panel to close.
  sheet.addEventListener('click', (e) => { if (e.target === sheet) close(); });

  build();
  window.dash.onData(fill);
  if (window.FFWB) window.FFWB.onSeason(() => fill());

  // A link straight to a section, like #h2h-chart, opens its tab and then the sheet.
  const asked = TILES.find((t) => t.id === location.hash.slice(1));
  if (asked) {
    const tab = document.getElementById('tab-' + asked.tab);
    if (tab) tab.click();
    setTimeout(() => open(asked), 300);
  }
  window.FFWBExplore = { open: (id) => { const t = TILES.find((x) => x.id === id); if (t) open(t); }, openCustom, refresh: fill };
})();
