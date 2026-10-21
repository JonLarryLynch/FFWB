// FFWB picks editor: choose a player and a week, then 4 clubs and a lock.
// Used on the main page for players, and on the commissioner page with overrides allowed.
(function () {
  const R = window.FFWBRules;
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  };
  const remember = {
    get(key) { try { return localStorage.getItem(key); } catch (err) { return null; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch (err) { /* only a convenience */ } },
  };
  const resultWord = (v) => (v === 1 ? 'Won' : v === 0.5 ? 'Drew' : v === 0 ? 'Lost' : v === 'P' ? 'Postponed' : '');
  const resultCode = (v) => (v === 1 ? 'W' : v === 0.5 ? 'D' : v === 0 ? 'L' : v === 'P' ? 'P' : '');
  const fmt = (n) => String(Math.round(n * 10) / 10);

  // Kickoff times, in the viewer's own time zone.
  const when = (iso) => new Date(iso).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  const whenLong = (iso) => new Date(iso).toLocaleString('en-US', { weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const fixturesFor = (season, week) => (season.fixtures || {})[String(week)] || null;
  const kickedOff = (season, week) => {
    const f = fixturesFor(season, week);
    return !!season.config.autoClose && !!(f && f.kickoff) && Date.now() >= Date.parse(f.kickoff) && !(season.config.reopenedWeeks || []).includes(week);
  };

  function weekStatus(season, week) {
    const res = season.results[String(week)];
    const hasResults = !!res && Object.keys(res).length > 0;
    // The page may have been open since before kickoff, so check the clock here too.
    if (season.openWeeks.includes(week) && !kickedOff(season, week)) return { open: true, label: 'This week' };
    if (hasResults) return { open: false, label: 'Results in' };
    if (kickedOff(season, week)) return { open: false, label: 'Kicked off' };
    if (week > season.config.currentWeek) return { open: false, label: 'Not open yet' };
    if ((season.config.lockedWeeks || []).includes(week)) return { open: false, label: 'Closed by the commissioner' };
    return { open: false, label: 'Closed' };
  }

  const REACTS = ['\u{1F525}', '\u{1F62C}', '\u{1F602}'];
  const ordinalOf = (n) => n + (['th', 'st', 'nd', 'rd'][(n % 100 >> 3 ^ 1) && n % 10] || 'th');

  // The planner sheet: every club against the weeks left in the half, with clashes marked.
  function openPlanner(pl) {
    const P = window.FFWBPlanner;
    const season = window.FFWB && window.FFWB.season;
    if (!P || !season) return;
    const wrap = el('div', 'pl-wrap');
    const head = el('div', 'pl-head pk-plan-' + pl.level);
    head.append(el('span', 'pk-plan-dot'), el('span', null, pl.text));
    wrap.append(head);
    const sum = el('div', 'pl-sum');
    for (const [k, v] of [['Weeks left', pl.left.length], ['Picks left', pl.slots], ['Still owed', pl.owed], ['Free picks', Math.max(0, pl.slots - pl.owed)]]) {
      const b = el('div', 'pl-stat'); b.append(el('span', 'pl-k', k), el('span', 'pl-v', String(v))); sum.append(b);
    }
    wrap.append(sum);
    if (pl.clashes.length) {
      const c = el('p', 'pl-clash-note');
      c.textContent = 'Watch out: ' + pl.clashes.slice(0, 3).map((x) => x.a + ' v ' + x.b + ' (week ' + x.week + ')').join(', ') + (pl.clashes.length > 3 ? ' and ' + (pl.clashes.length - 3) + ' more' : '') + '. You still owe both sides, so leave them to the same week and you are picking both teams in one match. That is how you join the Shame Club.';
      wrap.append(c);
    }
    const t = el('table', 'pl-table');
    const hr = el('tr');
    hr.append(el('th', null, 'Club'), el('th', 'ffwb-num', 'Have'), el('th', 'ffwb-num', 'Owe'));
    for (const w of pl.left) hr.append(el('th', 'ffwb-num pl-wk', 'W' + w));
    const thead = el('thead'); thead.append(hr);
    const tbody = el('tbody');
    const clashSet = new Set(pl.clashes.flatMap((x) => [x.week + '|' + x.a, x.week + '|' + x.b]));
    for (const c of [...pl.clubs].sort((a, b) => b.need - a.need || a.club.localeCompare(b.club))) {
      const tr = el('tr', c.need ? (c.need > pl.left.length ? 'pl-bad' : c.need === pl.left.length ? 'pl-tight' : '') : 'pl-done');
      tr.append(el('td', 'ffwb-strong', c.club), el('td', 'ffwb-num', c.have + (c.locks ? ' (' + c.locks + 'L)' : '')), el('td', 'ffwb-num ffwb-strong', c.need ? String(c.need) : '\u2713'));
      for (const w of pl.left) {
        const g = ((((season.fixtures || {})[String(w)] || {}).games) || {})[c.club];
        const td = el('td', 'pl-cell' + (clashSet.has(w + '|' + c.club) ? ' pl-clash' : ''), g ? (g.home ? '' : '@') + P.abbr(g.vs) : '');
        if (g) td.title = c.club + (g.home ? ' v ' : ' at ') + g.vs + ', week ' + w;
        tr.append(td);
      }
      tbody.append(tr);
    }
    t.append(thead, tbody);
    const scroll = el('div', 'pl-scroll');
    scroll.append(t);
    wrap.append(scroll, el('p', 'ffwb-note', 'Each club needs 3 picks a half, and you can only take a club once a week. Have counts picks this half (L is locks). The weeks show each club\u2019s opponent; @ is away. Red cells are games where you still owe both clubs.'));
    if (window.FFWBExplore && window.FFWBExplore.openCustom) window.FFWBExplore.openCustom('Half ' + pl.half + ' planner', 'Your picks', wrap);
  }

  function PicksEditor(root, opts) {
    const admin = !!(opts && opts.admin);
    const state = { season: null, player: null, week: null, std: [], lock: null, efl: null, dirty: false, saving: false, message: null, errors: [], canOverride: false };

    const who = el('div', 'pk-who');
    const whoSelect = el('select', 'ffwb-select pk-name');
    whoSelect.id = (admin ? 'admin' : 'player') + '-name';
    whoSelect.setAttribute('aria-label', admin ? 'Player' : 'Your name');
    whoSelect.addEventListener('change', () => {
      state.player = whoSelect.value || null;
      if (!admin && state.player) remember.set('ffwb-player', state.player);
      loadWeek();
      render();
    });

    const prev = el('button', 'pk-step', '‹');
    prev.type = 'button';
    prev.setAttribute('aria-label', 'Previous week');
    const next = el('button', 'pk-step', '›');
    next.type = 'button';
    next.setAttribute('aria-label', 'Next week');
    const weekTitle = el('div', 'pk-weektitle');
    const weekName = el('span', 'pk-weekname');
    const weekChip = el('span', 'pk-chip');
    const cupChip = el('span', 'pk-cupchip');
    cupChip.hidden = true;
    weekTitle.append(weekName, weekChip, cupChip);
    const weekBar = el('div', 'pk-weekbar');
    weekBar.append(prev, weekTitle, next);
    who.append(whoSelect, weekBar);

    const helpRow = el('div', 'pk-helprow');
    const help = el('span', 'pk-help');
    const how = el('details', 'pk-how');
    how.append(el('summary', null, 'How it works'), el('p', 'ffwb-note', 'Pick 4 clubs plus a lock each week. A win is 1 point, a draw a half, and your lock counts double. Every club needs 3 picks a half, and no club can be your lock more than 4 times a half; the numbers on each club show your picks so far this half. Win every pick in a week and you get a bonus pick the next week. You can change your picks until the week closes.'));
    helpRow.append(help, how);

    const bonus = el('div', 'pk-bonus');
    // This week's cup game, if the player has one.
    // You at a glance, the season calendar and the half-season plan.
    const glance = el('div', 'pk-glance');
    glance.hidden = true;
    const cal = el('div', 'pk-cal');
    cal.setAttribute('role', 'group');
    cal.setAttribute('aria-label', 'Season calendar');
    const planBar = el('button', 'pk-plan');
    planBar.type = 'button';
    planBar.hidden = true;
    const cupStrip = el('button', 'pk-cup');
    cupStrip.type = 'button';
    cupStrip.hidden = true;
    const grid = el('div', 'pk-grid');
    // The EFL pick: one Championship club, on weeks the commissioner switches it on.
    const eflRow = el('label', 'pk-efl');
    const eflLabel = el('span', 'pk-efl-label', 'EFL pick');
    const eflSelect = el('select', 'ffwb-select pk-efl-select');
    eflSelect.id = (admin ? 'admin' : 'player') + '-efl';
    const eflResult = el('span', 'pk-efl-result');
    eflRow.append(eflLabel, eflSelect, eflResult);
    eflRow.hidden = true;
    eflSelect.addEventListener('change', () => {
      state.efl = eflSelect.value || null;
      state.dirty = true;
      state.message = null;
      render();
    });
    const shameNote = el('div', 'pk-shame');
    shameNote.setAttribute('aria-live', 'polite');
    shameNote.hidden = true;
    const errorsBox = el('ul', 'pk-errors');
    errorsBox.setAttribute('aria-live', 'polite');
    const overrideWrap = el('label', 'pk-override');
    const override = el('input');
    override.type = 'checkbox';
    override.id = (admin ? 'admin' : 'player') + '-override';
    overrideWrap.append(override, el('span', null, 'Save anyway, overriding the rules'));
    overrideWrap.hidden = true;

    // The save bar stays at the bottom of the screen while the picks are in view.
    const bar = el('div', 'pk-bar');
    const barText = el('div', 'pk-bartext');
    const count = el('div', 'pk-count');
    const message = el('div', 'pk-message');
    message.setAttribute('aria-live', 'polite');
    barText.append(count, message);
    const clear = el('button', 'pk-clear', 'Clear');
    clear.type = 'button';
    const save = el('button', 'pk-save', 'Save picks');
    save.type = 'button';
    bar.append(barText, clear, save);

    const everyone = el('details', 'ffwb-more pk-everyone');
    const everyoneTitle = el('summary');
    const everyoneTable = el('div', 'ffwb-plot ffwb-plain');
    everyone.append(everyoneTitle, everyoneTable);

    const editor = el('div', 'ffwb-card pk-editor');
    editor.append(who, glance, cal, helpRow, cupStrip, planBar, bonus, grid, eflRow, shameNote, errorsBox, overrideWrap, bar);
    root.replaceChildren(editor, everyone);

    const weekPicks = () => (state.season && state.player ? state.season.picks[state.player] || {} : {});
    const statusNow = () => weekStatus(state.season, state.week);
    const editable = () => admin || statusNow().open;
    const allowed = () => R.allowedStandard(weekPicks(), state.season.results, state.week);
    const eflWeek = (week) => !!state.season && (state.season.config.eflWeeks || []).includes(week);

    function loadWeek() {
      const p = weekPicks()[String(state.week)];
      state.std = p ? [...(p.standard || [])] : [];
      state.lock = p ? p.lock || null : null;
      state.efl = p ? p.efl || null : null;
      state.dirty = false;
      state.errors = [];
      state.canOverride = false;
      override.checked = false;
      state.message = null;
    }

    function tap(club) {
      if (!editable()) return;
      state.message = null;
      if (state.lock === club) {
        state.lock = null;
      } else if (state.std.includes(club)) {
        state.std = state.std.filter((c) => c !== club);
        if (state.lock) state.std.push(state.lock);
        state.lock = club;
      } else if (state.std.length < allowed()) {
        state.std.push(club);
      } else if (!state.lock) {
        state.lock = club;
      } else {
        state.message = { kind: 'warn', text: 'You already have ' + allowed() + ' picks and a lock. Tap one of them to take it off first.' };
      }
      state.dirty = true;
      state.canOverride = false;
      render();
    }

    async function post(body) {
      const res = await fetch('/api/picks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      let out = {};
      try { out = await res.json(); } catch (err) { out = { ok: false, error: 'The league server sent an unexpected reply (' + res.status + ').' }; }
      return out;
    }

    async function submit(clearing) {
      if (state.saving) return;
      state.saving = true;
      state.message = { kind: 'info', text: clearing ? 'Clearing...' : 'Saving...' };
      render();
      const body = { player: state.player, week: state.week, standard: clearing ? [] : state.std, lock: clearing ? null : state.lock };
      if (!clearing && state.efl && eflWeek(state.week)) body.efl = state.efl;
      if (admin) {
        body.passcode = opts.passcode();
        if (override.checked) body.override = true;
      }
      try {
        const out = await post(body);
        if (!out.ok) {
          state.message = { kind: 'bad', text: out.error || 'That did not save.' };
          state.errors = out.errors || [];
          state.canOverride = !!out.canOverride;
        } else {
          state.season.picks[state.player] = out.weeks;
          state.dirty = false;
          state.errors = [];
          state.canOverride = false;
          override.checked = false;
          if (clearing) { state.std = []; state.lock = null; state.efl = null; }
          const name = state.season.config.players.find((p) => p.id === state.player).name;
          state.message = { kind: 'ok', text: clearing ? 'Week ' + state.week + ' cleared for ' + name + '.' : 'Saved ' + name + "'s picks for week " + state.week + '.' };
          if (opts && opts.onSaved) opts.onSaved();
          if (!admin && !clearing) document.dispatchEvent(new CustomEvent('ffwb:picks-saved', { detail: { week: state.week } }));
        }
      } catch (err) {
        state.message = { kind: 'bad', text: 'Could not reach the league server. Check your connection and try again.' };
      }
      state.saving = false;
      render();
    }

    save.addEventListener('click', () => submit(false));
    clear.addEventListener('click', () => submit(true));
    prev.addEventListener('click', () => { if (state.week > 1) { state.week -= 1; loadWeek(); render(); } });
    next.addEventListener('click', () => { if (state.week < R.WEEKS) { state.week += 1; loadWeek(); render(); } });

    function renderEveryone() {
      const s = state.season;
      const res = s.results[String(state.week)] || {};
      const eflRes = (s.eflResults || {})[String(state.week)] || {};
      const made = s.config.players.filter((p) => (s.picks[p.id] || {})[String(state.week)]).length;
      everyoneTitle.textContent = "See everyone's picks for week " + state.week + ' (' + made + ' of ' + s.config.players.length + ' in)';
      const t = el('table', 'ffwb-table pk-table');
      const hr = el('tr');
      for (const h of ['Player', 'Picks, lock last', 'Pts']) hr.append(el('th', h === 'Pts' ? 'ffwb-num' : null, h));
      const thead = el('thead');
      thead.append(hr);
      const tbody = el('tbody');
      const anyResult = Object.keys(res).length > 0;
      for (const p of s.config.players) {
        const wp = (s.picks[p.id] || {})[String(state.week)];
        const tr = el('tr');
        if (p.id === state.player) tr.className = 'pk-me';
        tr.append(el('td', 'ffwb-strong', p.name));
        const picksTd = el('td', 'pk-picks');
        if (!wp) {
          picksTd.append(el('span', 'ffwb-muted', 'No picks yet'));
        } else {
          for (const c of wp.standard) picksTd.append(el('span', 'pk-tag pk-' + (resultCode(res[c]) || 'none'), c));
          picksTd.append(el('span', 'pk-tag pk-locktag pk-' + (resultCode(res[wp.lock]) || 'none'), 'Lock: ' + wp.lock));
          if (wp.efl) picksTd.append(el('span', 'pk-tag pk-efltag pk-' + (resultCode(eflRes[wp.efl]) || 'none'), 'EFL: ' + wp.efl));
        }
        let pts = '';
        if (wp && anyResult) pts = fmt(wp.standard.reduce((a, c) => a + R.pickPoints(res[c], false), 0) + R.pickPoints(res[wp.lock], true) + (wp.efl ? R.pickPoints(eflRes[wp.efl], false) : 0));
        tr.append(picksTd, el('td', 'ffwb-num ffwb-strong', pts));
        // Reactions: one tap to put a fire, a grimace or a laugh on someone's picks.
        if (!admin && wp) {
          const box = el('div', 'pk-react');
          const mine = state.player || remember.get('ffwb-player');
          const got = (((s.reactions || {})[String(state.week)] || {})[p.id]) || {};
          for (const emo of REACTS) {
            const who = got[emo] || [];
            const b = el('button', 'pk-react-b' + (mine && who.includes(mine) ? ' pk-react-on' : '') + (who.length ? '' : ' pk-react-empty'));
            b.type = 'button';
            b.append(el('span', null, emo), el('span', 'pk-react-n', who.length ? String(who.length) : ''));
            const names = who.map((id) => (s.config.players.find((x) => x.id === id) || { name: id }).name);
            b.title = who.length ? names.join(', ') : 'React to ' + p.name + "'s picks";
            b.setAttribute('aria-label', emo + ' on ' + p.name + "'s picks" + (who.length ? ', ' + who.length + ' so far' : ''));
            b.addEventListener('click', async () => {
              if (!mine) { state.message = { kind: 'warn', text: 'Choose your name first to react.' }; render(); return; }
              try {
                const res = await fetch('/api/react', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ week: state.week, target: p.id, emoji: emo, by: mine }) });
                const out = await res.json();
                if (out.ok) { s.reactions = out.reactions; renderEveryone(); }
              } catch (err) { /* try again later */ }
            });
            box.append(b);
          }
          picksTd.append(box);
        }
        tbody.append(tr);
      }
      t.append(thead, tbody);
      everyoneTable.replaceChildren(t);
    }

    function render() {
      const s = state.season;
      if (!s) {
        editor.replaceChildren(el('p', 'ffwb-note', 'The live league data has not loaded, so picks cannot be made right now. Try reloading the page.'));
        everyone.hidden = true;
        return;
      }
      everyone.hidden = false;
      // Name dropdown.
      if (whoSelect.dataset.players !== s.config.players.map((p) => p.id).join('|')) {
        whoSelect.replaceChildren(new Option(admin ? 'Choose a player' : 'Choose your name', ''), ...s.config.players.map((p) => new Option(p.name, p.id)));
        whoSelect.dataset.players = s.config.players.map((p) => p.id).join('|');
      }
      whoSelect.value = state.player || '';

      const st = statusNow();
      weekName.textContent = 'Week ' + state.week;
      weekChip.textContent = st.label;
      weekChip.className = 'pk-chip ' + (st.open ? 'pk-chip-open' : 'pk-chip-closed');
      // A cup badge on any week a cup is played, so looking ahead shows the cup weeks.
      const cupHere = [];
      for (const cup of s.cups || []) {
        const i = cup.weeks.indexOf(state.week);
        if (i < 0 || !window.FFWBCups) continue;
        const t = window.FFWBCups.TYPES[cup.type];
        const round = t.format === 'knockout' ? window.FFWBCups.roundName(i, cup.weeks.length) : 'week ' + (i + 1) + ' of ' + cup.weeks.length;
        cupHere.push({ type: cup.type, text: t.name + ' · ' + round });
      }
      cupChip.hidden = !cupHere.length;
      if (cupHere.length) {
        cupChip.className = 'pk-cupchip cup-' + cupHere[0].type;
        cupChip.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4h10v4a5 5 0 0 1-10 0z"/><path d="M7 5H4.5v1.5A3.5 3.5 0 0 0 8 10M17 5h2.5v1.5A3.5 3.5 0 0 1 16 10"/><path d="M12 13v3M8 20h8l-1-4H9z"/></svg>';
        cupChip.append(document.createTextNode(cupHere.map((c) => c.text).join(' + ')));
      }
      prev.disabled = state.week <= 1;
      next.disabled = state.week >= R.WEEKS;

      const showEditor = !!state.player;
      for (const node of [grid, bar]) node.hidden = !showEditor;
      const canEdit = showEditor && editable();
      const fx = fixturesFor(s, state.week);
      const closesAt = !(st.open && fx && fx.kickoff) ? ''
        : s.config.autoClose && !(s.config.reopenedWeeks || []).includes(state.week) ? ' Picks lock at the first kickoff, ' + whenLong(fx.kickoff) + '.'
          : Date.now() < Date.parse(fx.kickoff) ? ' First kickoff ' + whenLong(fx.kickoff) + '.' : '';
      help.textContent = (!showEditor ? (admin ? 'Choose a player to edit their picks.' : 'Choose your name to make your picks.')
        : canEdit ? 'Tap once to pick, twice for your lock, three times to remove.'
          : state.week > s.config.currentWeek && !admin ? 'Week ' + state.week + " isn't open yet. You can pick it once week " + s.config.currentWeek + ' is done.'
            : 'This week is closed.' + (admin ? '' : ' Ask the commissioner if something needs fixing.')) + closesAt;
      bonus.hidden = true;
      errorsBox.replaceChildren();
      errorsBox.hidden = true;
      overrideWrap.hidden = true;
      if (!showEditor) { renderEveryone(); return; }

      const P = window.FFWBPlanner;
      // Calendar: every week, with what is on it. Tap a week to go to it.
      if (P) {
        const days = P.calendar(s);
        cal.replaceChildren(...days.map((d) => {
          const b = el('button', 'pk-day' + (d.done ? ' pk-day-done' : '') + (d.current ? ' pk-day-now' : '') + (d.week === state.week ? ' pk-day-on' : '') + (d.halfEnd ? ' pk-day-half' : '') + (d.marks.length ? ' pk-day-cup cup-' + d.marks[0].type : ''));
          b.type = 'button';
          b.textContent = String(d.week);
          if (d.efl) b.append(el('i', 'pk-day-efl'));
          b.title = 'Week ' + d.week + (d.current ? ', this week' : d.done ? ', results in' : '') + d.marks.map((m) => ', ' + m.text).join('') + (d.efl ? ', EFL pick' : '') + (d.halfEnd ? ', end of the first half' : '');
          b.setAttribute('aria-label', b.title);
          b.setAttribute('aria-pressed', String(d.week === state.week));
          b.addEventListener('click', () => { if (state.week !== d.week) { state.week = d.week; loadWeek(); render(); } });
          return b;
        }));
        requestAnimationFrame(() => { const on = cal.querySelector('.pk-day-on'); if (on && cal.scrollWidth > cal.clientWidth) cal.scrollLeft = on.offsetLeft - cal.clientWidth / 2 + on.offsetWidth / 2; });
      }
      // You at a glance.
      glance.hidden = true;
      if (P && state.player && !admin) {
        const g = P.glance(s, state.player);
        if (g && g.rank) {
          const move = g.was == null ? '' : g.was > g.rank ? '\u25B2' + (g.was - g.rank) : g.was < g.rank ? '\u25BC' + (g.rank - g.was) : '\u2013';
          const bits = [el('span', 'pk-g-rank', ordinalOf(g.rank)), el('span', 'pk-g-of', 'of ' + g.players), el('span', 'pk-g-pts', fmt(g.points) + ' pts')];
          if (move) bits.push(el('span', 'pk-g-move' + (move[0] === '\u25B2' ? ' pk-up' : move[0] === '\u25BC' ? ' pk-down' : ''), move));
          if (g.streak >= 2) bits.push(el('span', 'pk-g-chip', g.streak + ' locks in a row'));
          if (g.cup) bits.push(el('span', 'pk-g-chip pk-g-cup', g.cup));
          glance.replaceChildren(...bits);
          glance.hidden = false;
        }
      }
      // The half-season plan, with a warning when it is getting tight.
      planBar.hidden = true;
      if (P && state.player && R.halfOf(state.week) === R.halfOf(s.config.currentWeek) && state.week >= s.config.currentWeek) {
        const draft = editable() && (state.std.length || state.lock) ? { standard: state.std, lock: state.lock } : null;
        const pl = P.plan(s, state.player, state.week, draft);
        planBar.className = 'pk-plan pk-plan-' + pl.level;
        planBar.replaceChildren(el('span', 'pk-plan-dot'), el('span', 'pk-plan-text', pl.text), el('span', 'pk-plan-go', 'Planner \u203a'));
        planBar.onclick = () => openPlanner(pl);
        planBar.hidden = false;
      }

      cupStrip.hidden = true;
      const game = window.FFWBCups && s.cups && s.cups.length ? window.FFWBCups.gameFor(s, s.cups, state.player, state.week) : null;
      if (game) {
        cupStrip.className = 'pk-cup cup-' + game.cup.cup.type;
        const fmt1 = (n) => String(Math.round(n * 10) / 10);
        let line;
        if (game.kind === 'knockout') {
          const m = game.match;
          const mine = m.a && m.a.id === state.player ? m.scoreA : m.scoreB;
          const theirs = m.a && m.a.id === state.player ? m.scoreB : m.scoreA;
          line = !game.them ? 'You have a bye this round'
            : 'You v ' + game.them.name + (mine && theirs ? ', ' + fmt1(mine.points) + ' to ' + fmt1(theirs.points) : '')
              + (m.status === 'final' ? (m.winner === state.player ? '. Through!' : '. Out.') : m.status === 'shootout' ? '. Dead level: penalty shootout in FIFA!' : '');
        } else {
          line = game.detail + (game.pos ? ". You're " + game.pos + (['th', 'st', 'nd', 'rd'][(game.pos % 100 >> 3 ^ 1) && game.pos % 10] || 'th') + ' so far' : '');
        }
        cupStrip.replaceChildren(el('span', 'pk-cup-name', game.label + (game.round ? ' · ' + game.round : '')), el('span', 'pk-cup-line', line), el('span', 'pk-cup-go', '›'));
        cupStrip.onclick = () => window.FFWBCupsUI && window.FFWBCupsUI.open(game.cup.cup.type);
        cupStrip.hidden = false;
      }

      const max = allowed();
      if (max > R.STANDARD_PICKS) {
        const prevPicks = weekPicks()[String(state.week - 1)];
        const extra = max - R.STANDARD_PICKS;
        bonus.textContent = 'Perfect week ' + (state.week - 1) + '! You get ' + (extra === 1 ? 'a bonus pick' : extra + ' bonus picks') + ': up to ' + max + ' clubs plus your lock.' + (prevPicks && prevPicks.standard.length > R.STANDARD_PICKS ? ' It stacked from last week.' : '');
        bonus.hidden = false;
      }

      // Club tiles.
      const res = s.results[String(state.week)] || {};
      const half = R.halfOf(state.week);
      const u = R.usage(weekPicks(), half, state.week);
      const lastWeek = P ? P.pickedLastWeek(s, Math.min(state.week, s.config.currentWeek)) : { counts: {} };
      grid.replaceChildren(...s.config.clubs.map((club) => {
        const isLock = state.lock === club;
        const isPick = state.std.includes(club);
        const used = u.counts[club] || 0;
        const locks = u.locks[club] || 0;
        const tile = el('button', 'pk-tile' + (isLock ? ' pk-tile-lock' : isPick ? ' pk-tile-pick' : ''));
        tile.type = 'button';
        tile.disabled = !canEdit;
        tile.setAttribute('aria-pressed', String(isLock || isPick));
        tile.append(el('span', 'pk-tile-name', club));
        const game = fx && fx.games ? fx.games[club] : null;
        if (game) tile.append(el('span', 'pk-tile-game', (game.home ? 'v ' : '@ ') + game.vs + (game.off ? ' · postponed' : ' · ' + when(game.at))));
        const short = used < R.MIN_PER_HALF;
        tile.append(el('span', 'pk-tile-meta' + (short ? ' pk-tile-short' : ''), (short ? used + ' of 3' : used + ' picked') + (locks ? ' · ' + locks + ' lock' + (locks === 1 ? '' : 's') : '')));
        // Recent form, and how many of the league were on this club last week.
        if (P) {
          const f = P.form(s, club, Math.min(state.week, s.config.currentWeek));
          if (f.length) {
            const row = el('span', 'pk-form');
            for (const r of f) row.append(el('i', 'pk-f pk-f-' + r));
            const n = lastWeek.counts[club] || 0;
            if (lastWeek.week) row.append(el('span', 'pk-f-n', n + ' last wk'));
            row.title = 'Last ' + f.length + ': ' + f.join(' ') + (lastWeek.week ? '. ' + n + ' picked them in week ' + lastWeek.week : '');
            tile.append(row);
          }
        }
        const r = res[club];
        if (r !== undefined) tile.append(el('span', 'pk-tile-badge pk-' + resultCode(r), resultWord(r)));
        else if (isLock) tile.append(el('span', 'pk-tile-badge pk-badge-lock', 'Lock'));
        else if (isPick) tile.append(el('span', 'pk-tile-badge pk-badge-pick', 'Pick'));
        tile.setAttribute('aria-label', club + (game ? (game.home ? ' at home to ' : ' away at ') + game.vs + ', ' + whenLong(game.at) : '') + (isLock ? ', your lock' : isPick ? ', picked' : '') + '. Picked ' + used + ' times and locked ' + locks + ' times this half.');
        tile.addEventListener('click', () => tap(club));
        return tile;
      }));

      // EFL pick, only on EFL weeks (or if one was saved before the week was switched off).
      const showEfl = eflWeek(state.week);
      eflRow.hidden = !showEfl;
      if (showEfl) {
        const list = [...(s.config.eflClubs || [])];
        if (state.efl && !list.includes(state.efl)) list.unshift(state.efl);
        const key = list.join('|');
        if (eflSelect.dataset.list !== key) {
          eflSelect.replaceChildren(new Option('No EFL pick', ''), ...list.map((c) => new Option(c, c)));
          eflSelect.dataset.list = key;
        }
        eflSelect.value = state.efl || '';
        eflSelect.disabled = !canEdit;
        const er = state.efl ? ((s.eflResults || {})[String(state.week)] || {})[state.efl] : undefined;
        eflResult.textContent = er !== undefined ? resultWord(er) : list.length ? 'Optional. A Championship club, worth 1 for a win and a half for a draw, never doubled.' : 'The commissioner has not loaded the Championship clubs yet.';
        eflResult.className = 'pk-efl-result' + (er !== undefined ? ' pk-efl-done pk-' + resultCode(er) : ' ffwb-note');
      }

      // Both teams from the same match: legal, but it earns Shame Club membership.
      const clash = window.FFWBShame ? window.FFWBShame.pairsIn(s, state.week, [...state.std, ...(state.lock ? [state.lock] : [])]) : [];
      shameNote.hidden = !clash.length || !canEdit;
      if (clash.length) {
        const games = clash.map(([h, a]) => h + ' and ' + a).join(', and ');
        shameNote.textContent = games + ' play each other this week. Save this and you are joining the Shame Club.';
      }

      // Rule check as they go.
      const chosen = state.std.length + (state.lock ? 1 : 0);
      const verdict = chosen ? R.check({ clubs: s.config.clubs, weekPicks: weekPicks(), week: state.week, standard: state.std, lock: state.lock, openWeeks: s.upcomingWeeks || s.openWeeks, results: s.results }) : null;
      const complete = state.std.length >= R.STANDARD_PICKS && !!state.lock;
      count.textContent = state.std.length + ' of ' + max + ' picks' + (state.lock ? ' + lock' : ', no lock yet') + (showEfl && state.efl ? ' + EFL' : '');
      count.className = 'pk-count' + (complete && verdict && verdict.ok ? ' pk-count-ok' : '');
      const problems = state.errors.length ? state.errors : verdict && !verdict.ok && complete ? verdict.errors : [];
      for (const e of problems) errorsBox.append(el('li', null, e));
      errorsBox.hidden = !problems.length;

      const saved = weekPicks()[String(state.week)];
      save.disabled = !canEdit || state.saving || !complete || (!state.dirty && !!saved) || (!!verdict && !verdict.ok && !(admin && override.checked));
      save.textContent = saved && state.dirty ? 'Save changes' : saved ? 'Saved' : 'Save picks';
      clear.hidden = !canEdit || !saved;
      clear.disabled = state.saving;
      overrideWrap.hidden = !(admin && ((verdict && !verdict.ok) || state.canOverride));
      bar.hidden = !canEdit && !saved;

      if (state.message) {
        message.textContent = state.message.text;
        message.className = 'pk-message pk-message-' + state.message.kind;
      } else if (state.dirty) {
        message.textContent = complete && verdict && verdict.ok ? 'Ready to save.' : 'Not saved yet.';
        message.className = 'pk-message pk-message-warn';
      } else if (saved) {
        message.textContent = 'Saved ' + new Date(saved.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + (saved.by ? ' by ' + saved.by : '') + '.';
        message.className = 'pk-message';
      } else {
        message.textContent = canEdit ? 'Nothing saved for this week yet.' : 'No picks were made this week.';
        message.className = 'pk-message';
      }
      renderEveryone();
    }

    override.addEventListener('change', render);

    return {
      setSeason(season) {
        const first = !state.season;
        state.season = season;
        if (season && first) {
          state.week = season.config.currentWeek;
          const mine = admin ? null : remember.get('ffwb-player');
          if (mine && season.config.players.some((p) => p.id === mine)) state.player = mine;
          loadWeek();
        } else if (season && !state.dirty) {
          loadWeek();
        }
        render();
      },
      render,
    };
  }

  window.FFWBPicks = { PicksEditor, weekStatus, resultCode, resultWord, kickedOff, when, whenLong };

  // On the main page, mount the editor in the Make picks tab and load the live season.
  const mount = document.getElementById('picks-app');
  if (mount && !mount.dataset.admin) {
    const editor = PicksEditor(mount, { onSaved: () => window.FFWB.reload() });
    window.FFWB.onSeason((s) => editor.setSeason(s));
    window.FFWB.reload();
  }
})();
