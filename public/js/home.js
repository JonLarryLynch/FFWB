// FFWB "This week": one screen with only what matters right now. Have I picked, how long until kickoff,
// my cup game, what The Map says I still owe, and how last week went (with its awards).
(function () {
  const mount = document.getElementById('home-app');
  if (!mount) return;
  const R = window.FFWBRules;
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (err) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (err) { /* fine */ } },
  };
  const fmt = (n) => String(Math.round(n * 10) / 10);
  const ordinal = (n) => n + ([, 'st', 'nd', 'rd'][(n % 100 >> 3 ^ 1) && n % 10] || 'th');
  const list = (l) => (l.length > 2 ? l.slice(0, -1).join(', ') + ' and ' + l[l.length - 1] : l.join(' and '));
  const go = (tab) => { const t = document.getElementById('tab-' + tab); if (t) { t.click(); window.scrollTo({ top: 0 }); } };
  let season = null;
  let timer = null;

  function countdown(iso) {
    const ms = Date.parse(iso) - Date.now();
    if (ms <= 0) return null;
    const m = Math.floor(ms / 60000);
    const d = Math.floor(m / 1440);
    const h = Math.floor((m % 1440) / 60);
    const mm = m % 60;
    return d ? d + 'd ' + h + 'h' : h ? h + 'h ' + mm + 'm' : mm + 'm';
  }
  const longWhen = (iso) => new Date(iso).toLocaleString('en-US', { weekday: 'long', hour: 'numeric', minute: '2-digit' });

  function card(cls, ...kids) { const c = el('section', 'ffwb-card hm-card ' + (cls || '')); c.append(...kids); return c; }

  function draw() {
    const s = season;
    if (!s) return;
    const me = store.get('ffwb-player');
    const meP = s.config.players.find((p) => p.id === me);
    const w = s.config.currentWeek;
    const fx = (s.fixtures || {})[String(w)] || {};
    const out = [];

    // The week and the clock.
    const hero = el('div', 'hm-hero');
    const left = el('div');
    left.append(el('div', 'hm-kicker', meP ? 'Hi ' + meP.name : 'This week'), el('h2', 'hm-week', 'Week ' + w));
    const clock = el('div', 'hm-clock');
    const cd = fx.kickoff ? countdown(fx.kickoff) : null;
    const anyRes = Object.keys(s.results[String(w)] || {}).length > 0;
    const isOpen = (s.openWeeks || []).includes(w);
    if (cd) clock.append(el('span', 'hm-clock-n', cd), el('span', 'hm-clock-l', 'to kickoff, ' + longWhen(fx.kickoff)));
    else clock.append(el('span', 'hm-clock-n', isOpen && fx.kickoff ? 'Live' : anyRes ? 'Results' : '–'), el('span', 'hm-clock-l', isOpen && fx.kickoff ? 'under way, late picks still open' : anyRes ? 'coming in' : 'Kickoff time to come'));
    hero.append(left, clock);
    out.push(card('hm-herocard', hero));

    // Who are you?
    if (!meP) {
      const pickName = el('select', 'ffwb-select');
      pickName.append(new Option('Choose your name', ''), ...s.config.players.map((p) => new Option(p.name, p.id)));
      pickName.addEventListener('change', () => { if (!pickName.value) return; store.set('ffwb-player', pickName.value); window.FFWB.reload(); });
      out.push(card('', el('h3', 'hm-h', 'Who are you?'), el('p', 'ffwb-note', 'Choose your name once and this page shows your week.'), pickName));
      mount.replaceChildren(...out);
      return;
    }

    // Your picks.
    const mine = ((s.picks[me] || {})[String(w)]);
    const picksCard = el('div', 'hm-picks');
    const locked = (s.linked || []).includes(me) && !store.get('ffwb-key-' + me);
    if (mine) {
      const top = el('div', 'hm-status hm-ok');
      top.append(el('span', 'hm-dot'), el('span', null, 'Picked and saved'));
      const chips = el('div', 'hm-chips');
      for (const c of mine.standard || []) chips.append(el('span', 'hm-chip', c));
      if (mine.lock) chips.append(el('span', 'hm-chip hm-chip-lock', '\u{1F512} ' + mine.lock));
      if (mine.efl) chips.append(el('span', 'hm-chip hm-chip-efl', 'EFL: ' + mine.efl));
      const when = el('div', 'ffwb-note hm-saved', 'Saved ' + new Date(mine.at).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' }) + '.');
      const edit = el('button', 'pk-clear', isOpen ? 'Change picks' : 'See my picks');
      edit.type = 'button';
      edit.addEventListener('click', () => go('picks'));
      picksCard.append(top, chips, when, edit);
    } else {
      const top = el('div', 'hm-status hm-todo');
      top.append(el('span', 'hm-dot'), el('span', null, locked ? 'Picks are linked to your other device' : !isOpen ? 'No picks this week' : 'You have not picked yet'));
      if (locked && window.FFWBLink) {
        picksCard.append(top, el('p', 'ffwb-note', 'Your picks can only be made from devices linked to you. Open your personal link here, or paste it below.'), window.FFWBLink.form());
      } else {
        const cta = el('button', 'pk-save hm-cta', 'Make my picks');
        cta.type = 'button';
        cta.addEventListener('click', () => go('picks'));
        picksCard.append(top, cta);
      }
    }
    const picked = s.config.players.filter((p) => (s.picks[p.id] || {})[String(w)] || ((s.hiddenPicked || {})[String(w)] || []).includes(p.id)).length;
    picksCard.append(el('div', 'ffwb-note hm-count', picked + ' of ' + s.config.players.length + ' have picked.'));
    out.push(card('', el('h3', 'hm-h', 'Your picks'), picksCard));

    // The reveal, once the week has kicked off.
    if (window.FFWBReveal && window.FFWBReveal.available(w)) {
      const b = el('button', 'hm-reveal');
      b.type = 'button';
      b.append(el('span', 'hm-reveal-k', 'Picks are in'), el('span', 'hm-reveal-t', 'See what everyone picked ›'));
      b.addEventListener('click', () => window.FFWBReveal.open(w));
      out.push(b);
    }

    // Cup game and The Map, side by side on wider screens.
    const row = el('div', 'hm-row');
    const C = window.FFWBCups;
    const game = C && (s.cups || []).length ? C.gameFor(s, s.cups, me, w) : null;
    if (game) {
      const b = el('button', 'hm-tile cup-' + game.cup.cup.type);
      b.type = 'button';
      const line = game.kind === 'knockout' ? (game.them ? 'You v ' + game.them.name : 'You have a bye') : game.detail + (game.pos ? ", you're " + ordinal(game.pos) : '');
      b.append(el('span', 'hm-tile-k', game.label + (game.round ? ' · ' + game.round : '')), el('span', 'hm-tile-t', line));
      b.addEventListener('click', () => window.FFWBCupsUI && window.FFWBCupsUI.open(game.cup.cup.type));
      row.append(b);
    }
    const P = window.FFWBPlanner;
    if (P && R.halfOf(w) === R.halfOf(s.config.currentWeek)) {
      const pl = P.plan(s, me, w, null);
      const b = el('button', 'hm-tile hm-map hm-map-' + pl.level);
      b.type = 'button';
      b.append(el('span', 'hm-tile-k', 'The Map'), el('span', 'hm-tile-t', pl.text));
      b.addEventListener('click', () => window.FFWBPicks && window.FFWBPicks.openPlanner(pl, me));
      row.append(b);
    }
    if (row.children.length) out.push(row);

    // Last week.
    const A = window.FFWBAwards;
    let last = w - 1;
    while (last >= 1 && !(C && C.weekFinal(s, last))) last -= 1;
    if (last >= 1 && C) {
      const sc = C.weekScore(s, me, last);
      const g = P ? P.glance(s, me) : null;
      const lw = el('div', 'hm-last');
      const big = el('div', 'hm-last-big');
      big.append(el('span', 'hm-last-n', sc.picked ? fmt(sc.points) : '–'), el('span', 'hm-last-l', sc.picked ? 'points in week ' + last : 'no picks in week ' + last));
      lw.append(big);
      if (g && g.rank) {
        const mv = g.was == null ? '' : g.was > g.rank ? ' ▲' + (g.was - g.rank) : g.was < g.rank ? ' ▼' + (g.rank - g.was) : '';
        const pos = el('div', 'hm-last-big');
        pos.append(el('span', 'hm-last-n', ordinal(g.rank) + mv), el('span', 'hm-last-l', 'of ' + g.players + ', ' + fmt(g.points) + ' pts'));
        lw.append(pos);
      }
      const aw = A ? A.lines(A.week(s, last)) : [];
      const ICON = { top: '\u{1F3C6}', bottled: '\u{1F37E}', lone: '\u{1F43A}', worst: '\u{1F944}' };
      const ul = el('ul', 'hm-awards');
      for (const a of aw) {
        const li = el('li');
        li.append(el('span', 'hm-aw-i', ICON[a.key]), el('strong', null, a.label), el('span', null, a.text));
        ul.append(li);
      }
      const box = el('div');
      box.append(lw);
      if (aw.length) box.append(el('h4', 'hm-sub', 'Week ' + last + ' awards'), ul);
      const table = el('button', 'pk-clear', 'See the table');
      table.type = 'button';
      table.addEventListener('click', () => go('table'));
      box.append(table);
      out.push(card('', el('h3', 'hm-h', 'Last week'), box));
    }
    mount.replaceChildren(...out);
  }

  if (window.FFWB) window.FFWB.onSeason((s) => { season = s; if (s) draw(); else mount.replaceChildren(card('', el('p', 'ffwb-note', 'The live league data has not loaded, so this week cannot be shown. The Table and History tabs still work from the saved copy.'))); });
  clearInterval(timer);
  timer = setInterval(() => { if (!document.hidden && !document.getElementById('home').hidden) draw(); }, 30000);
  document.addEventListener('ffwb:picks-saved', () => setTimeout(draw, 50));
  window.FFWBHome = { draw };
})();
