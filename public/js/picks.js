// Football FWB picks editor: choose a player and a week, then 4 clubs and a lock.
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

  function weekStatus(season, week) {
    const res = season.results[String(week)];
    const hasResults = !!res && Object.keys(res).length > 0;
    if (season.openWeeks.includes(week)) return { open: true, label: week === season.config.currentWeek ? 'Open now' : 'Open' };
    if (hasResults) return { open: false, label: 'Results in' };
    if ((season.config.lockedWeeks || []).includes(week)) return { open: false, label: 'Closed by the commissioner' };
    return { open: false, label: 'Closed' };
  }

  function PicksEditor(root, opts) {
    const admin = !!(opts && opts.admin);
    const state = { season: null, player: null, week: null, std: [], lock: null, dirty: false, saving: false, message: null, errors: [], canOverride: false };

    const who = el('div', 'pk-who');
    const whoLabel = el('div', 'pk-label', admin ? 'Player' : "Who's picking?");
    const whoPills = el('div', 'ffwb-pills');
    whoPills.setAttribute('role', 'group');
    whoPills.setAttribute('aria-label', 'Player');
    who.append(whoLabel, whoPills);

    const weekBar = el('div', 'pk-weekbar');
    const prev = el('button', 'pk-step', '‹');
    prev.type = 'button';
    prev.setAttribute('aria-label', 'Previous week');
    const next = el('button', 'pk-step', '›');
    next.type = 'button';
    next.setAttribute('aria-label', 'Next week');
    const weekTitle = el('div', 'pk-weektitle');
    const weekName = el('span', 'pk-weekname');
    const weekChip = el('span', 'pk-chip');
    weekTitle.append(weekName, weekChip);
    weekBar.append(prev, weekTitle, next);

    const help = el('p', 'ffwb-note pk-help');
    const status = el('div', 'pk-status');
    status.setAttribute('aria-live', 'polite');
    const grid = el('div', 'pk-grid');
    const actions = el('div', 'pk-actions');
    const save = el('button', 'pk-save', 'Save picks');
    save.type = 'button';
    const clear = el('button', 'pk-clear', 'Clear this week');
    clear.type = 'button';
    const overrideWrap = el('label', 'pk-override');
    const override = el('input');
    override.type = 'checkbox';
    override.id = (admin ? 'admin' : 'player') + '-override';
    overrideWrap.append(override, el('span', null, 'Save anyway, overriding the rules'));
    overrideWrap.hidden = true;
    actions.append(save, clear, overrideWrap);
    const message = el('p', 'pk-message');
    message.setAttribute('aria-live', 'polite');

    const everyone = el('div', 'ffwb-card pk-everyone');
    const everyoneTitle = el('h3', 'ffwb-h');
    const everyoneNote = el('p', 'ffwb-note', 'Picks are visible to everyone as soon as they are saved. Each player\'s lock is last, in bold.');
    const everyoneTable = el('div', 'ffwb-plot ffwb-plain');
    everyone.append(everyoneTitle, everyoneNote, everyoneTable);

    const editor = el('div', 'ffwb-card pk-editor');
    editor.append(who, weekBar, help, grid, status, actions, message);
    root.replaceChildren(editor, everyone);

    const weekPicks = () => (state.season && state.player ? state.season.picks[state.player] || {} : {});
    const statusNow = () => weekStatus(state.season, state.week);
    const editable = () => admin || statusNow().open;

    function loadWeek() {
      const p = weekPicks()[String(state.week)];
      state.std = p ? [...(p.standard || [])] : [];
      state.lock = p ? p.lock || null : null;
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
      } else if (state.std.length < R.STANDARD_PICKS) {
        state.std.push(club);
      } else if (!state.lock) {
        state.lock = club;
      } else {
        state.message = { kind: 'warn', text: 'You already have 4 picks and a lock. Tap one of them to take it off first.' };
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
          if (clearing) { state.std = []; state.lock = null; }
          const name = state.season.config.players.find((p) => p.id === state.player).name;
          state.message = { kind: 'ok', text: clearing ? 'Week ' + state.week + ' cleared for ' + name + '.' : 'Saved ' + name + "'s picks for week " + state.week + '.' };
          if (opts && opts.onSaved) opts.onSaved();
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
      everyoneTitle.textContent = "Everyone's picks for week " + state.week;
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
        }
        let pts = '';
        if (wp && anyResult) pts = fmt(wp.standard.reduce((a, c) => a + R.pickPoints(res[c], false), 0) + R.pickPoints(res[wp.lock], true));
        tr.append(picksTd, el('td', 'ffwb-num ffwb-strong', pts));
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
      // Player pills.
      whoPills.replaceChildren(...s.config.players.map((p) => {
        const b = el('button', 'ffwb-pill', p.name);
        b.type = 'button';
        b.setAttribute('aria-pressed', String(p.id === state.player));
        b.addEventListener('click', () => {
          state.player = p.id;
          if (!admin) remember.set('ffwb-player', p.id);
          loadWeek();
          render();
        });
        return b;
      }));

      const st = statusNow();
      weekName.textContent = 'Week ' + state.week;
      weekChip.textContent = st.label + (R.halfOf(state.week) === 1 ? ' · first half' : ' · second half');
      weekChip.className = 'pk-chip ' + (st.open ? 'pk-chip-open' : 'pk-chip-closed');
      prev.disabled = state.week <= 1;
      next.disabled = state.week >= R.WEEKS;

      const showEditor = !!state.player;
      for (const node of [help, grid, status, actions]) node.hidden = !showEditor;
      if (!showEditor) {
        message.textContent = admin ? 'Choose a player to edit their picks.' : 'Tap your name to start.';
        message.className = 'pk-message';
        renderEveryone();
        everyone.hidden = false;
        return;
      }

      const canEdit = editable();
      help.textContent = canEdit
        ? 'Tap a club once to pick it, tap it again to make it your lock, and a third time to take it off. Numbers show how often you have picked each club this half; every club needs 3 picks a half and no club can be your lock more than 4 times.'
        : 'This week is closed, so its picks are shown as they stand.' + (admin ? '' : ' Ask the commissioner if something needs fixing.');

      // Club tiles.
      const res = s.results[String(state.week)] || {};
      const half = R.halfOf(state.week);
      const u = R.usage(weekPicks(), half, state.week);
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
        const meta = el('span', 'pk-tile-meta', 'Picked ' + used + ' · locked ' + locks);
        tile.append(meta);
        const r = res[club];
        if (r !== undefined) tile.append(el('span', 'pk-tile-badge pk-' + resultCode(r), resultWord(r)));
        else if (isLock) tile.append(el('span', 'pk-tile-badge pk-badge-lock', 'Lock'));
        else if (isPick) tile.append(el('span', 'pk-tile-badge pk-badge-pick', 'Picked'));
        else if (used < R.MIN_PER_HALF) tile.append(el('span', 'pk-tile-badge pk-badge-need', 'Needs ' + (R.MIN_PER_HALF - used)));
        tile.setAttribute('aria-label', club + (isLock ? ', your lock' : isPick ? ', picked' : '') + '. Picked ' + used + ' times and locked ' + locks + ' times this half.');
        tile.addEventListener('click', () => tap(club));
        return tile;
      }));

      // Rule check as they go.
      const chosen = state.std.length + (state.lock ? 1 : 0);
      const verdict = chosen ? R.check({ clubs: s.config.clubs, weekPicks: weekPicks(), week: state.week, standard: state.std, lock: state.lock, openWeeks: s.openWeeks }) : null;
      status.replaceChildren();
      const count = el('div', 'pk-count');
      count.append(el('span', 'ffwb-strong', state.std.length + ' of 4 picks'), el('span', null, ' · '), el('span', 'ffwb-strong', state.lock ? 'Lock: ' + state.lock : 'No lock yet'));
      status.append(count);
      const problems = state.errors.length ? state.errors : verdict && !verdict.ok && chosen === 5 ? verdict.errors : [];
      if (problems.length) {
        const ul = el('ul', 'pk-errors');
        for (const e of problems) ul.append(el('li', null, e));
        status.append(ul);
      } else if (verdict && verdict.ok) {
        status.append(el('div', 'pk-good', 'These picks follow the rules. After this week you would still owe ' + verdict.owed + ' required picks this half.'));
      }

      const saved = weekPicks()[String(state.week)];
      save.disabled = !canEdit || state.saving || chosen !== 5 || (!state.dirty && !!saved) || (!!verdict && !verdict.ok && !(admin && override.checked));
      save.textContent = saved ? 'Save changes' : 'Save picks';
      clear.hidden = !canEdit || !saved;
      clear.disabled = state.saving;
      overrideWrap.hidden = !(admin && ((verdict && !verdict.ok) || state.canOverride));

      if (state.message) {
        message.textContent = state.message.text;
        message.className = 'pk-message pk-message-' + state.message.kind;
      } else if (state.dirty) {
        message.textContent = 'Not saved yet.';
        message.className = 'pk-message pk-message-warn';
      } else if (saved) {
        message.textContent = 'Saved ' + new Date(saved.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + (saved.by ? ' by ' + saved.by : '') + '.';
        message.className = 'pk-message';
      } else {
        message.textContent = canEdit ? 'No picks saved for this week yet.' : 'No picks were made this week.';
        message.className = 'pk-message';
      }
      renderEveryone();
      everyone.hidden = false;
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

  window.FFWBPicks = { PicksEditor, weekStatus, resultCode, resultWord };

  // On the main page, mount the editor in the Make picks tab and load the live season.
  const mount = document.getElementById('picks-app');
  if (mount && !mount.dataset.admin) {
    const editor = PicksEditor(mount, { onSaved: () => window.FFWB.reload() });
    window.FFWB.onSeason((s) => editor.setSeason(s));
    window.FFWB.reload();
  }
})();
