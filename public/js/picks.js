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

  // The Map: every club against the weeks left in the half, with clashes marked. Tap a square to plan
  // taking that club that week. Plans are only a reference, kept on this phone, and never make a pick.
  function openPlanner(pl, id) {
    const P = window.FFWBPlanner;
    const season = window.FFWB && window.FFWB.season;
    if (!P || !season) return;
    const scrollWas = document.querySelector('.pl-scroll') ? document.querySelector('.pl-scroll').scrollLeft : 0;
    const marks = id ? P.marks(season, id) : new Set();
    const fx = (w) => (((season.fixtures || {})[String(w)] || {}).games) || {};
    const planned = (w, c) => marks.has(w + '|' + c);
    const perClub = {};
    const perWeek = {};
    for (const k of marks) {
      const [w, c] = [Number(k.split('|')[0]), k.slice(k.indexOf('|') + 1)];
      if (!pl.left.includes(w)) continue;
      perClub[c] = (perClub[c] || 0) + 1;
      perWeek[w] = (perWeek[w] || 0) + 1;
    }
    // Planned both sides of one game in the same week: a Shame Club week in the making.
    const pkClash = new Set();
    for (const w of pl.left) for (const c of pl.clubs) {
      const g = fx(w)[c.club];
      if (g && planned(w, c.club) && planned(w, g.vs)) pkClash.add(w + '|' + c.club);
    }
    const cap = (w) => (w === season.config.currentWeek ? R.allowedStandard(season.picks[id] || {}, season.results, w) : R.STANDARD_PICKS) + 1;
    const over = pl.left.filter((w) => (perWeek[w] || 0) > cap(w));
    const plannedOwed = pl.clubs.reduce((a, c) => a + Math.min(c.need, perClub[c.club] || 0), 0);

    const wrap = el('div', 'pl-wrap');
    const head = el('div', 'pl-head pk-plan-' + pl.level);
    head.append(el('span', 'pk-plan-dot'), el('span', null, pl.text));
    wrap.append(head);
    const sum = el('div', 'pl-sum');
    for (const [k, v] of [['Weeks left', pl.left.length], ['Still owed', pl.owed], ['Planned', plannedOwed + ' of ' + pl.owed], ['Free picks', Math.max(0, pl.slots - pl.owed)]]) {
      const b = el('div', 'pl-stat'); b.append(el('span', 'pl-k', k), el('span', 'pl-v', String(v))); sum.append(b);
    }
    wrap.append(sum);
    const warn = [];
    if (pkClash.size) warn.push('You have planned both teams from the same game: ' + [...pkClash].map((k) => { const [w, c] = k.split('|'); return c + ' v ' + fx(w)[c].vs + ' (week ' + w + ')'; }).filter((x, i, a) => a.findIndex((y) => y.split(' v ').sort().join() === x.split(' v ').sort().join()) === i).join(', ') + '. Allowed, but that is a Shame Club week.');
    if (over.length) warn.push('Too many planned for week ' + over.join(', ') + ': ' + over.map((w) => (perWeek[w] || 0) + ' of ' + cap(w)).join(', ') + '.');
    if (!warn.length && pl.clashes.length) warn.push('Watch out: ' + pl.clashes.slice(0, 3).map((x) => x.a + ' v ' + x.b + ' (week ' + x.week + ')').join(', ') + (pl.clashes.length > 3 ? ' and ' + (pl.clashes.length - 3) + ' more' : '') + '. You still owe both sides, so plan them for different weeks.');
    for (const w of warn) wrap.append(el('p', 'pl-clash-note', w));
    const tip = el('p', 'pl-tip', id ? 'Tap a square to plan that club for that week, and again to clear it. Plans are just for you: they stay on this phone and never make a pick.' : 'Choose your name on the Picks tab to plan ahead.');
    wrap.append(tip);

    const t = el('table', 'pl-table');
    const hr = el('tr');
    hr.append(el('th', null, 'Club'), el('th', 'ffwb-num', 'Have'), el('th', 'ffwb-num', 'Owe'));
    for (const w of pl.left) {
      const th = el('th', 'ffwb-num pl-wk' + (over.includes(w) ? ' pl-over' : ''));
      th.append(el('span', null, 'W' + w), el('span', 'pl-wk-n', (perWeek[w] || 0) + '/' + cap(w)));
      hr.append(th);
    }
    const thead = el('thead'); thead.append(hr);
    const tbody = el('tbody');
    const clashSet = new Set(pl.clashes.flatMap((x) => [x.week + '|' + x.a, x.week + '|' + x.b]));
    for (const c of [...pl.clubs].sort((a, b) => b.need - a.need || a.club.localeCompare(b.club))) {
      const p = perClub[c.club] || 0;
      const covered = c.need && p >= c.need;
      const tr = el('tr', c.need ? (covered ? 'pl-covered' : c.need > pl.left.length ? 'pl-bad' : c.need === pl.left.length ? 'pl-tight' : '') : 'pl-done');
      const owe = el('td', 'ffwb-num ffwb-strong');
      owe.append(document.createTextNode(c.need ? String(c.need) : '✓'));
      if (p) owe.append(el('span', 'pl-owe-p', ' · ' + p + '✓'));
      tr.append(el('td', 'ffwb-strong', c.club), el('td', 'ffwb-num', c.have + (c.locks ? ' (' + c.locks + 'L)' : '')), owe);
      for (const w of pl.left) {
        const g = fx(w)[c.club];
        const on = planned(w, c.club);
        const td = el('td', 'pl-cell' + (on ? ' pl-planned' : '') + (pkClash.has(w + '|' + c.club) ? ' pl-pk' : clashSet.has(w + '|' + c.club) ? ' pl-clash' : ''));
        const b = el('button', 'pl-tap', (on ? '✓ ' : '') + (g ? (g.home ? '' : '@') + P.abbr(g.vs) : '–'));
        b.type = 'button';
        b.disabled = !id;
        b.setAttribute('aria-pressed', String(on));
        b.title = c.club + (g ? (g.home ? ' v ' : ' at ') + g.vs : '') + ', week ' + w + (on ? '. Planned, tap to clear' : '. Tap to plan');
        b.addEventListener('click', () => { P.toggleMark(season, id, w, c.club); openPlanner(pl, id); document.dispatchEvent(new CustomEvent('ffwb:map-changed')); });
        td.append(b);
        tr.append(td);
      }
      tbody.append(tr);
    }
    t.append(thead, tbody);
    const scroll = el('div', 'pl-scroll');
    scroll.append(t);
    wrap.append(scroll);
    const foot = el('div', 'pl-foot');
    foot.append(el('p', 'ffwb-note', 'Each club needs 3 picks a half, and you can only take a club once a week. Have counts picks this half (L is locks). The squares show each club’s opponent; @ is away. W9 3/5 means 3 planned of the 5 picks that week.'));
    if (id && marks.size) {
      const clr = el('button', 'pk-clear adm-small', 'Clear my plan');
      clr.type = 'button';
      clr.addEventListener('click', () => { if (confirm('Clear everything you have planned for this half?')) { P.clearMarks(season, id, pl.left); openPlanner(pl, id); document.dispatchEvent(new CustomEvent('ffwb:map-changed')); } });
      foot.append(clr);
    }
    wrap.append(foot);
    if (window.FFWBExplore && window.FFWBExplore.openCustom) window.FFWBExplore.openCustom('The Map', (pl.half === 1 ? 'First' : 'Second') + ' half, your picks', wrap);
    const sc = document.querySelector('.pl-scroll');
    if (sc) sc.scrollLeft = scrollWas;
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
      // This week's picks only come back for the name asking, so fetch again as the new name.
      if (!admin && state.player && window.FFWB && window.FFWB.reload) window.FFWB.reload();
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

    // The pick tray stays at the bottom of the screen: a slot for each pick and a gold slot for the lock, so you
    // can always see what is missing. Tap a club to fill the next slot; tap (or drag) a pick onto the lock slot to
    // make it your lock; x takes a pick off.
    const bar = el('div', 'pk-bar pk-tray');
    const slots = el('div', 'pk-slots');
    slots.setAttribute('role', 'group');
    slots.setAttribute('aria-label', 'Your picks');
    const trayFoot = el('div', 'pk-tray-foot');
    const barText = el('div', 'pk-bartext');
    const count = el('div', 'pk-count');
    const message = el('div', 'pk-message');
    message.setAttribute('aria-live', 'polite');
    barText.append(count, message);
    const clear = el('button', 'pk-clear', 'Clear');
    clear.type = 'button';
    const save = el('button', 'pk-save', 'Save picks');
    save.type = 'button';
    trayFoot.append(barText, clear, save);
    bar.append(slots, trayFoot);

    const everyone = el('details', 'ffwb-more pk-everyone');
    const everyoneTitle = el('summary');
    const everyoneTable = el('div', 'ffwb-plot ffwb-plain');
    everyone.append(everyoneTitle, everyoneTable);

    const editor = el('div', 'ffwb-card pk-editor');
    editor.append(who, glance, cal, helpRow, cupStrip, planBar, bonus, grid, eflRow, shameNote, errorsBox, overrideWrap, bar);
    root.replaceChildren(editor, everyone);

    const weekPicks = () => (state.season && state.player ? state.season.picks[state.player] || {} : {});
    const statusNow = () => weekStatus(state.season, state.week);
    // A name linked to someone's own phone can only be picked from a phone holding its key.
    const lockedOut = () => !admin && !!state.player && !!state.season && (state.season.linked || []).includes(state.player) && !remember.get('ffwb-key-' + state.player);
    const editable = () => admin || (statusNow().open && !lockedOut());
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

    const changed = () => { state.dirty = true; state.canOverride = false; render(); };
    // Tapping a club: add it to the next empty slot (picks first, then the lock), or take it off if it is in.
    function tap(club) {
      if (!editable()) return;
      state.message = null;
      if (state.lock === club) state.lock = null;
      else if (state.std.includes(club)) state.std = state.std.filter((c) => c !== club);
      else if (state.std.length < R.STANDARD_PICKS) state.std.push(club);
      else if (!state.lock) state.lock = club;
      else if (state.std.length < allowed()) state.std.push(club);
      else { state.message = { kind: 'warn', text: 'Your tray is full. Take a pick off (\u00d7) to swap one in.' }; render(); return; }
      changed();
    }
    // Make a pick the lock; the old lock (if any) goes back into the picks.
    function makeLock(club) {
      if (!editable() || state.lock === club) return;
      state.message = null;
      const old = state.lock;
      state.std = state.std.filter((c) => c !== club);
      if (old) state.std.push(old);
      state.lock = club;
      changed();
    }
    function unLock() {
      if (!editable() || !state.lock) return;
      if (state.std.length >= allowed()) { state.message = { kind: 'warn', text: 'Tap one of your picks to swap it with the lock.' }; render(); return; }
      state.std.push(state.lock);
      state.lock = null;
      state.message = null;
      changed();
    }
    function drop(club) {
      if (!editable()) return;
      if (state.lock === club) state.lock = null; else state.std = state.std.filter((c) => c !== club);
      state.message = null;
      changed();
    }
    // Drag a pick onto the lock slot (or the lock onto a pick) with a finger or mouse.
    function draggable(chip, club, isLock) {
      let start = null;
      let ghost = null;
      chip.addEventListener('pointerdown', (e) => { if (!editable() || e.target.closest('.pk-slot-x')) return; start = { x: e.clientX, y: e.clientY, id: e.pointerId }; });
      chip.addEventListener('pointermove', (e) => {
        if (!start || e.pointerId !== start.id) return;
        if (!ghost && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 8) {
          ghost = chip.cloneNode(true);
          ghost.classList.add('pk-ghost');
          document.body.append(ghost);
          chip.setPointerCapture(e.pointerId);
          chip.classList.add('pk-slot-lifted');
        }
        if (ghost) {
          ghost.style.left = e.clientX + 'px';
          ghost.style.top = e.clientY + 'px';
          const over = document.elementFromPoint(e.clientX, e.clientY);
          for (const s of slots.querySelectorAll('.pk-slot')) s.classList.toggle('pk-slot-over', !!over && s.contains(over) && s !== chip);
        }
      });
      const end = (e) => {
        if (!start) return;
        const wasDrag = !!ghost;
        if (ghost) {
          ghost.remove(); ghost = null;
          chip.classList.remove('pk-slot-lifted');
          const over = document.elementFromPoint(e.clientX, e.clientY);
          const target = over && over.closest('.pk-slot');
          for (const s of slots.querySelectorAll('.pk-slot')) s.classList.remove('pk-slot-over');
          if (target && target !== chip) {
            if (!isLock && target.classList.contains('pk-slot-lockslot')) makeLock(club);
            else if (isLock && target.dataset.club) makeLock(target.dataset.club);
          }
          chip.dataset.dragged = '1';
          setTimeout(() => { delete chip.dataset.dragged; }, 0);
        }
        start = null;
        return wasDrag;
      };
      chip.addEventListener('pointerup', end);
      chip.addEventListener('pointercancel', () => { if (ghost) { ghost.remove(); ghost = null; chip.classList.remove('pk-slot-lifted'); } start = null; });
    }
    function drawSlots(canEdit) {
      const max = allowed();
      const abbrOf = (c) => (window.FFWBPlanner ? window.FFWBPlanner.abbr(c) : c.slice(0, 3).toUpperCase());
      const chips = [];
      const slot = (club, i) => {
        const bonusSlot = i >= R.STANDARD_PICKS;
        const b = el('button', 'pk-slot' + (club ? ' pk-slot-on' : '') + (bonusSlot ? ' pk-slot-bonus' : ''));
        b.type = 'button';
        b.disabled = !canEdit && !club;
        if (club) {
          b.dataset.club = club;
          b.append(el('span', 'pk-slot-name', club), el('span', 'pk-slot-abbr', abbrOf(club)));
          if (canEdit) {
            const x = el('span', 'pk-slot-x', '\u00d7');
            x.setAttribute('aria-hidden', 'true');
            x.addEventListener('click', (e) => { e.stopPropagation(); drop(club); });
            b.append(x);
          }
          b.setAttribute('aria-label', club + '. Tap to make it your lock.');
          b.addEventListener('click', (e) => { if (b.dataset.dragged) return; if (e.target.closest('.pk-slot-x')) return; makeLock(club); });
          if (canEdit) draggable(b, club, false);
        } else {
          b.append(el('span', 'pk-slot-empty', bonusSlot ? 'Bonus' : 'Pick ' + (i + 1)));
          b.setAttribute('aria-label', (bonusSlot ? 'Bonus pick, optional, ' : 'Pick ' + (i + 1) + ', ') + 'empty. Tap a club above to fill it.');
          b.tabIndex = -1;
        }
        return b;
      };
      for (let i = 0; i < max; i += 1) chips.push(slot(state.std[i] || null, i));
      const lk = el('button', 'pk-slot pk-slot-lockslot' + (state.lock ? ' pk-slot-on' : ''));
      lk.type = 'button';
      lk.append(el('span', 'pk-slot-lockicon', '\u{1F512}'));
      if (state.lock) {
        lk.dataset.club = state.lock;
        lk.append(el('span', 'pk-slot-name', state.lock), el('span', 'pk-slot-abbr', abbrOf(state.lock)));
        if (canEdit) {
          const x = el('span', 'pk-slot-x', '\u00d7');
          x.setAttribute('aria-hidden', 'true');
          x.addEventListener('click', (e) => { e.stopPropagation(); drop(state.lock); });
          lk.append(x);
          draggable(lk, state.lock, true);
        }
        lk.setAttribute('aria-label', 'Lock: ' + state.lock + '. Counts double. Tap to move it back to your picks.');
        lk.addEventListener('click', (e) => { if (lk.dataset.dragged || e.target.closest('.pk-slot-x')) return; unLock(); });
      } else {
        lk.append(el('span', 'pk-slot-empty', 'Lock'));
        lk.setAttribute('aria-label', 'Lock, empty. Tap one of your picks to make it your lock.');
        lk.disabled = !canEdit;
        lk.addEventListener('click', () => { if (state.std.length) { state.message = { kind: 'info', text: 'Tap one of your picks to make it your lock, or drag it here.' }; render(); } });
      }
      chips.push(lk);
      slots.replaceChildren(...chips);
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
      if (!admin) {
        body.key = remember.get('ffwb-key-' + state.player) || undefined;
        // This phone's alert subscription, so a save from the player's own phone does not alert them.
        try {
          const reg = navigator.serviceWorker && await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(r, 800))]);
          const sub = reg && reg.pushManager ? await reg.pushManager.getSubscription() : null;
          if (sub) body.endpoint = sub.endpoint;
        } catch (err) { /* no alerts on this phone */ }
      }
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
          if (!admin && !clearing) document.dispatchEvent(new CustomEvent('ffwb:picks-saved', { detail: { week: state.week, bonus: allowed() > R.STANDARD_PICKS } }));
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
      const secret = new Set((s.hiddenPicked || {})[String(state.week)] || []);
      const made = s.config.players.filter((p) => (s.picks[p.id] || {})[String(state.week)] || secret.has(p.id)).length;
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
        if (!wp && secret.has(p.id)) {
          picksTd.append(el('span', 'pk-tag pk-secret', '\u2713 Picked, hidden until kickoff'));
        } else if (!wp) {
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
                const res = await fetch('/api/react', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ week: state.week, target: p.id, emoji: emo, by: mine, key: remember.get('ffwb-key-' + mine) || undefined }) });
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
      const kicks = el('p', 'ffwb-note pk-secret-note', 'Everyone\u2019s picks show once the first game of the week kicks off.');
      if (secret.size) everyoneTable.replaceChildren(kicks, t); else everyoneTable.replaceChildren(t);
    }

    if (!admin) document.addEventListener('ffwb:map-changed', () => render());
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
      const lockedName = lockedOut() ? (s.config.players.find((p) => p.id === state.player) || { name: '' }).name : '';
      help.textContent = (!showEditor ? (admin ? 'Choose a player to edit their picks.' : 'Choose your name to make your picks.')
        : lockedName ? '\u{1F512} ' + lockedName + "'s picks can only be made from " + lockedName + "'s own phone or laptop. If you are " + lockedName + ', open your personal link on this device. The commissioner can send it again.'
        : canEdit ? 'Tap clubs to fill your tray. Tap a pick in the tray (or drag it to the gold slot) to make it your lock. Your lock counts double.'
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
          const bits = [el('span', 'pk-g-rank', ordinalOf(g.rank)), el('span', 'pk-g-of', 'of ' + g.players), el('span', 'pk-g-pts', null)];
          bits[2].append(el('span', 'pk-g-pts-n', fmt(g.points)), document.createTextNode(' pts'));
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
        planBar.replaceChildren(el('span', 'pk-plan-dot'), el('span', 'pk-plan-text', pl.text), el('span', 'pk-plan-go', 'The Map \u203a'));
        planBar.onclick = () => openPlanner(pl, state.player);
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
      const myMarks = P && state.player && !admin ? P.marks(s, state.player) : new Set();
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
        if (myMarks.has(state.week + '|' + club) && !isPick && !isLock && r === undefined) tile.append(el('span', 'pk-tile-badge pk-badge-planned', 'Planned'));
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

      drawSlots(canEdit);
      const saved = weekPicks()[String(state.week)];
      save.disabled = !canEdit || state.saving || !complete || (!state.dirty && !!saved) || (!!verdict && !verdict.ok && !(admin && override.checked));
      save.textContent = saved && state.dirty ? 'Save changes' : saved ? 'Saved' : 'Save picks';
      clear.hidden = !canEdit || !saved;
      clear.disabled = state.saving || lockedOut();
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

  window.FFWBPicks = { PicksEditor, weekStatus, resultCode, resultWord, kickedOff, when, whenLong, openPlanner };

  // On the main page, mount the editor in the Make picks tab and load the live season.
  const mount = document.getElementById('picks-app');
  if (mount && !mount.dataset.admin) {
    const editor = PicksEditor(mount, { onSaved: () => window.FFWB.reload() });
    window.FFWB.onSeason((s) => editor.setSeason(s));
    window.FFWB.reload();
  }
})();
