// FFWB cup week pop-up: the first time someone opens the Picks tab in a cup week, a themed card tells them
// it is a cup week and what is at stake for them. Each cup has its own look (autumn leaves for the League Cup,
// snow and fairy lights for Festive Fixtures, ribbons for the FA Cup) and each round its own words.
// Shown once per cup week on each phone.
(function () {
  const C = window.FFWBCups;
  const pop = document.getElementById('cup-splash');
  if (!C || !pop) return;
  const ART = { league: '/brand/cup-league.svg', festive: '/brand/cup-festive.svg', fa: '/brand/cup-fa.svg' };
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (err) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (err) { /* fine */ } },
  };
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const fmt = (n) => String(Math.round(n * 10) / 10);
  const ordinal = (n) => n + ([, 'st', 'nd', 'rd'][(n % 100 >> 3 ^ 1) && n % 10] || 'th');
  const names = (l) => (l.length > 1 ? l.slice(0, -1).join(', ') + ' and ' + l[l.length - 1] : l.join(''));
  let season = null;

  // Words for each cup and round. {them} is the opponent.
  const KO = {
    league: {
      kicker: 'League Cup',
      rounds: {
        'First round': ['The League Cup starts this week', 'Outscore your opponent this week and you are in the quarter-finals.'],
        'Quarter-finals': ['Quarter-final week', 'Eight left. Four go through.'],
        'Semi-finals': ['Semi-final week', 'One win from the final.'],
        Final: ['League Cup final week', 'One week, one game, one cup.'],
      },
      out: 'You are out of the League Cup, but the picks still count in the league.',
    },
    fa: {
      kicker: 'The magic of the cup',
      rounds: {
        'First round': ['The FA Cup is back', 'Giant-killings welcome. Seeds mean nothing now.'],
        'Quarter-finals': ['FA Cup quarter-finals', 'This is where the cup gets serious.'],
        'Semi-finals': ['FA Cup semi-finals', 'Win this week and you are in the final.'],
        Final: ['FA Cup Final', 'Win this week and your name goes on the cup. Well, on this website.'],
      },
      out: 'Out of the FA Cup, but there is still a league to play for.',
    },
  };
  // Festive Fixtures: the words follow the calendar when the kickoff dates fall on the holidays.
  function festiveWords(week, i, total, ko) {
    const d = ko ? new Date(ko) : null;
    const md = d ? (d.getMonth() + 1) * 100 + d.getDate() : 0;
    if (md >= 1224 && md <= 1227) return ['Boxing Day fixtures', 'Leftover turkey, a full card of games and Festive Fixtures points on the line.'];
    if (md >= 1228 && md <= 1231) return ['Between the holidays', 'Nobody knows what day it is, but the picks are due.'];
    if (md >= 101 && md <= 103) return ['New Year fixtures', 'New year, new you, same old lock.'];
    if (i === 0) return ['Festive Fixtures kicks off', 'Most points over the festive weeks takes the trophy. Everyone is in.'];
    if (i === total - 1) return ['The last festive week', 'Unwrap the table: this week decides it.'];
    return ['Festive Fixtures, week ' + (i + 1) + ' of ' + total, 'Mince pies optional, picks are not.'];
  }

  // Falling things for each theme.
  function sky(type) {
    const box = el('div', 'cs-sky');
    box.setAttribute('aria-hidden', 'true');
    const n = type === 'festive' ? 34 : 18;
    for (let i = 0; i < n; i += 1) {
      const p = el('i', 'cs-bit cs-bit-' + type + ' cs-v' + (i % 4));
      p.style.left = (Math.random() * 100).toFixed(1) + '%';
      p.style.animationDelay = (-Math.random() * 9).toFixed(2) + 's';
      p.style.animationDuration = (type === 'festive' ? 6 + Math.random() * 6 : 5 + Math.random() * 5).toFixed(2) + 's';
      p.style.setProperty('--drift', ((Math.random() - 0.5) * 80).toFixed(0) + 'px');
      p.style.setProperty('--size', (type === 'festive' ? 3 + Math.random() * 5 : 8 + Math.random() * 8).toFixed(1) + 'px');
      box.append(p);
    }
    if (type === 'festive') {
      // A string of fairy lights along the top.
      const lights = el('div', 'cs-lights');
      for (let i = 0; i < 14; i += 1) lights.append(el('span', 'cs-light cs-l' + (i % 4)));
      box.append(lights);
    }
    return box;
  }

  function content(st, week) {
    const me = store.get('ffwb-player');
    const type = st.cup.type;
    const parts = { kicker: '', title: '', line: '', game: null, extra: null };
    if (st.format === 'league') {
      const i = st.cup.weeks.indexOf(week);
      const ko = ((season.fixtures || {})[String(week)] || {}).kickoff;
      const [title, line] = festiveWords(week, i, st.cup.weeks.length, ko);
      Object.assign(parts, { kicker: 'Festive Fixtures', title, line });
      const rows = st.mini.rows;
      const pos = rows.findIndex((r) => r.id === me);
      if (pos >= 0 && i > 0 && rows[0].points > 0) {
        const leader = rows[0];
        parts.game = pos === 0 ? { big: "You're top of the tree", small: (rows[1] ? fmt(leader.points - rows[1].points) + ' ahead of ' + rows[1].name : '') }
          : { big: "You're " + ordinal(pos + 1), small: fmt(leader.points - rows[pos].points) + ' behind ' + leader.name };
      } else {
        parts.game = { big: 'All ' + rows.length + ' of you are in', small: 'Weeks ' + st.cup.weeks.join(', ') };
      }
      return parts;
    }
    const words = KO[type] || KO.league;
    const r = st.bracket.rounds.find((x) => x.week === week);
    const [title, line] = words.rounds[r.name] || [r.name, ''];
    Object.assign(parts, { kicker: words.kicker, title, line });
    const g = me ? C.gameFor(season, [st.cup], me, week) : null;
    if (g && g.them) parts.game = { you: g.me.name, them: g.them.name, small: 'Seed ' + g.me.seed + ' v seed ' + g.them.seed };
    else if (g && !g.them) parts.game = { big: 'You have a bye', small: 'Top of the table goes straight into the next round' };
    else if (me) {
      parts.line = words.out;
      const games = r.matches.filter((m) => m.a && m.b).map((m) => m.a.name + ' v ' + m.b.name);
      parts.extra = games.length ? (r.name === 'Final' ? 'The final: ' : 'This week: ') + names(games.slice(0, 4)) + (games.length > 4 ? ' and more' : '') : null;
    } else {
      parts.extra = 'Choose your name to see your game.';
    }
    return parts;
  }

  function show(st, week) {
    const type = st.cup.type;
    const p = content(st, week);
    const card = el('div', 'cs-card cs-' + type);
    card.append(sky(type));
    const art = el('img', 'cs-art'); art.src = ART[type]; art.alt = '';
    const text = el('div', 'cs-text');
    text.append(el('div', 'cs-kicker', p.kicker), el('h2', 'cs-title', p.title));
    if (p.line) text.append(el('p', 'cs-line', p.line));
    if (p.game) {
      const g = el('div', 'cs-game');
      if (p.game.you) {
        const vs = el('div', 'cs-vs');
        vs.append(el('span', 'cs-name', 'You'), el('span', 'cs-v', 'v'), el('span', 'cs-name', p.game.them));
        g.append(vs);
      } else g.append(el('div', 'cs-big', p.game.big));
      if (p.game.small) g.append(el('div', 'cs-small', p.game.small));
      text.append(g);
    }
    if (p.extra) text.append(el('p', 'cs-extra', p.extra));
    const go = el('button', 'cs-go', 'Make my picks');
    go.type = 'button';
    go.addEventListener('click', () => pop.close());
    const more = el('button', 'cs-more', st.format === 'league' ? 'See the table' : 'See the bracket');
    more.type = 'button';
    more.addEventListener('click', () => { pop.close(); window.FFWBCupsUI && window.FFWBCupsUI.open(type); });
    const actions = el('div', 'cs-actions');
    actions.append(go, more);
    text.append(actions);
    card.append(art, text);
    pop.replaceChildren(card);
    pop.showModal();
  }

  function maybeShow() {
    if (!season || pop.open) return;
    const picksTab = document.getElementById('picks');
    const homeTab = document.getElementById('home');
    if (picksTab && picksTab.hidden && !(homeTab && !homeTab.hidden)) return;
    if (document.querySelector('dialog[open]')) return;
    const week = season.config.currentWeek;
    for (const cup of season.cups || []) {
      if (!cup.weeks.includes(week)) continue;
      const key = 'ffwb-cupweek-' + cup.id + '-' + week;
      if (store.get(key)) continue;
      const st = C.state(season, cup);
      store.set(key, '1');
      setTimeout(() => show(st, week), 450);
      return;
    }
  }

  pop.addEventListener('click', (e) => { if (e.target === pop) pop.close(); });
  if (window.FFWB) window.FFWB.onSeason((s) => { season = s; if (s) maybeShow(); });
  document.getElementById('tab-picks') && document.getElementById('tab-picks').addEventListener('click', () => setTimeout(maybeShow, 50));
  window.FFWBCupSplash = { preview: (type, week) => { const cup = (season.cups || []).find((c) => c.type === type); if (cup) show(C.state(season, cup), week || cup.weeks[0]); } };
})();
