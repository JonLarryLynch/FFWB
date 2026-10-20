// The Shame Club: anyone who has picked both teams from the same match in a week. The founding members
// come from the commissioner's list; new ones are found from this season's picks and fixtures.
(function () {
  const pairsIn = (season, week, clubs) => {
    const games = (((season && season.fixtures) || {})[String(week)] || {}).games || {};
    const out = [];
    const seen = new Set();
    for (const c of clubs) {
      const g = games[c];
      if (!g || !clubs.includes(g.vs)) continue;
      const key = [c, g.vs].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(g.home ? [c, g.vs] : [g.vs, c]);
    }
    return out;
  };
  const picksOf = (p) => [...((p && p.standard) || []), ...(p && p.lock ? [p.lock] : [])];

  // Every offence this season: { player, week, home, away }.
  function offences(season) {
    if (!season) return [];
    const out = [];
    for (const pl of season.config.players) {
      for (const [w, p] of Object.entries(season.picks[pl.id] || {})) {
        for (const [home, away] of pairsIn(season, Number(w), picksOf(p))) out.push({ player: pl.name, week: Number(w), home, away });
      }
    }
    return out.sort((a, b) => a.week - b.week);
  }

  // Members in order of joining: the founders first, then anyone new this season.
  function members(season) {
    if (!season) return [];
    const list = (season.config.shameClub || []).map((m) => ({ name: m.name, aka: m.aka || '', note: m.note || '', founder: true, offences: [] }));
    const by = new Map(list.map((m) => [m.name.toLowerCase(), m]));
    for (const o of offences(season)) {
      const k = o.player.toLowerCase();
      if (!by.has(k)) { const m = { name: o.player, note: '', founder: false, offences: [] }; by.set(k, m); list.push(m); }
      by.get(k).offences.push(o);
    }
    for (const m of list) {
      const total = m.offences.length + (m.founder ? 1 : 0);
      if (!m.note && total >= 2) m.note = 'Platinum Member';
    }
    return list;
  }

  const of = (name) => members(window.FFWB && window.FFWB.season).find((m) => m.name.toLowerCase() === String(name).toLowerCase()) || null;
  window.FFWBShame = { pairsIn, offences, members, of };

  // The card in History, Record book.
  function draw(season) {
    const box = document.getElementById('shame-box');
    if (!box) return;
    const list = members(season);
    const body = box.querySelector('.ffwb-plot');
    if (!list.length) { body.replaceChildren(Object.assign(document.createElement('p'), { className: 'ffwb-note', textContent: 'No members. Yet.' })); return; }
    const grid = document.createElement('div');
    grid.className = 'sh-grid';
    for (const m of list) {
      const card = document.createElement('div');
      card.className = 'sh-member' + (m.note === 'Platinum Member' ? ' sh-platinum' : '');
      const name = document.createElement('div');
      name.className = 'sh-name';
      name.textContent = m.name;
      if (m.aka) { const aka = document.createElement('span'); aka.className = 'sh-aka'; aka.textContent = ' aka ' + m.aka; name.append(aka); }
      card.append(name);
      if (m.note) { const n = document.createElement('div'); n.className = 'sh-note'; n.textContent = m.note; card.append(n); }
      const lines = m.offences.length ? m.offences.map((o) => 'Week ' + o.week + ': ' + o.home + ' v ' + o.away) : ['Founding member'];
      if (m.founder && m.offences.length) lines.unshift('Founding member');
      for (const line of lines) { const what = document.createElement('div'); what.className = 'sh-what'; what.textContent = line; card.append(what); }
      grid.append(card);
    }
    body.replaceChildren(grid);
  }
  if (window.FFWB) window.FFWB.onSeason((s) => { if (s) draw(s); });
})();
