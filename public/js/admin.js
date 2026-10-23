// FFWB commissioner page: results, weeks, anyone's picks, the change log and backups.
(function () {
  const R = window.FFWBRules;
  const { PicksEditor, resultCode, kickedOff, whenLong } = window.FFWBPicks;
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  };
  const session = {
    get() { try { return sessionStorage.getItem('ffwb-pass') || ''; } catch (err) { return ''; } },
    set(v) { try { sessionStorage.setItem('ffwb-pass', v); } catch (err) { /* only a convenience */ } },
    clear() { try { sessionStorage.removeItem('ffwb-pass'); } catch (err) { /* only a convenience */ } },
  };
  let passcode = session.get();
  let season = null;

  async function adminPost(route, body) {
    const res = await fetch('/api/admin/' + route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, passcode }) });
    let out = {};
    try { out = await res.json(); } catch (err) { out = { ok: false, error: 'The league server sent an unexpected reply (' + res.status + ').' }; }
    if (res.status === 401) { session.clear(); showGate(out.error); }
    return out;
  }
  const say = (node, kind, text) => { node.textContent = text; node.className = 'pk-message pk-message-' + kind; };

  // ---------- Sign in ----------
  const gate = document.getElementById('gate');
  const app = document.getElementById('admin-app');
  const passInput = document.getElementById('passcode');
  const gateMsg = document.getElementById('gate-message');
  function showGate(text) {
    gate.hidden = false;
    app.hidden = true;
    if (text) say(gateMsg, 'bad', text);
  }
  async function tryPass(value) {
    passcode = value;
    say(gateMsg, 'info', 'Checking...');
    const out = await adminPost('check', {});
    if (out.ok) {
      session.set(value);
      gate.hidden = true;
      app.hidden = false;
      gateMsg.textContent = '';
      window.FFWB.reload();
      loadLog();
      loadSuggested();
      loadBackups();
      loadErrors();
      loadPush();
    } else {
      showGate(out.error || 'That passcode is not right.');
    }
  }
  document.getElementById('gate-go').addEventListener('click', () => tryPass(passInput.value.trim()));
  passInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') tryPass(passInput.value.trim()); });
  document.getElementById('sign-out').addEventListener('click', () => { session.clear(); passcode = ''; passInput.value = ''; showGate(); });

  // ---------- Weeks ----------
  const cwValue = document.getElementById('cw-value');
  const cwMsg = document.getElementById('cw-message');
  const closedBox = document.getElementById('closed-weeks');
  let cw = null;
  function renderWeeks() {
    if (!season) return;
    if (cw === null) cw = season.config.currentWeek;
    cwValue.textContent = 'Week ' + cw;
    const locked = new Set(season.config.lockedWeeks || []);
    const reopened = new Set(season.config.reopenedWeeks || []);
    const fx = (w) => (season.fixtures || {})[String(w)] || {};
    const auto = !!season.config.autoClose;
    autoBox.checked = auto;
    const started = (w) => auto && !!fx(w).kickoff && Date.now() >= Date.parse(fx(w).kickoff);
    closedBox.replaceChildren(...Array.from({ length: R.WEEKS }, (_, i) => i + 1).map((w) => {
      const hasResults = season.config.clubs.every((c) => (season.results[String(w)] || {})[c] !== undefined);
      const kicked = kickedOff(season, w);
      const cls = locked.has(w) ? ' pk-weekdot-locked' : hasResults ? ' pk-weekdot-done' : kicked ? ' pk-weekdot-kicked' : reopened.has(w) && started(w) ? ' pk-weekdot-reopened' : w < season.config.currentWeek ? ' pk-weekdot-past' : '';
      const b = el('button', 'pk-weekdot' + cls, String(w));
      b.type = 'button';
      b.setAttribute('aria-pressed', String(locked.has(w)));
      const ko = fx(w).kickoff ? ' First kickoff ' + whenLong(fx(w).kickoff) + '.' : '';
      b.title = (locked.has(w) ? 'Closed by you. Click to reopen.' : hasResults ? 'All results are in, so this week is closed.'
        : kicked ? 'Kicked off, so closed. Click to reopen it for late picks.' : reopened.has(w) && started(w) ? 'Reopened by you after kickoff. Click to close it again.'
          : 'Click to close this week to picks.') + ko;
      b.addEventListener('click', async () => {
        let change;
        let text;
        if (locked.has(w)) { const n = new Set(locked); n.delete(w); change = { lockedWeeks: [...n] }; text = 'Week ' + w + ' is no longer closed by you.'; }
        else if (started(w) && !hasResults) {
          const n = new Set(reopened);
          if (n.has(w)) { n.delete(w); text = 'Week ' + w + ' is closed again.'; } else { n.add(w); text = 'Week ' + w + ' is open for late picks until you click it again or enter a result.'; }
          change = { reopenedWeeks: [...n] };
        } else { const n = new Set(locked); n.add(w); change = { lockedWeeks: [...n] }; text = 'Week ' + w + ' is closed to picks.'; }
        const out = await adminPost('config', change);
        if (out.ok) { say(cwMsg, 'ok', text); window.FFWB.reload(); }
        else say(cwMsg, 'bad', out.error);
      });
      return b;
    }));
  }
  // ---------- EFL weeks and clubs ----------
  const eflWeeksBox = document.getElementById('efl-weeks');
  const eflMsg = document.getElementById('efl-message');
  const eflList = document.getElementById('efl-list');
  function renderEfl() {
    if (!season) return;
    const on = new Set(season.config.eflWeeks || []);
    eflWeeksBox.replaceChildren(...Array.from({ length: R.WEEKS }, (_, i) => i + 1).map((w) => {
      const b = el('button', 'pk-weekdot' + (on.has(w) ? ' pk-weekdot-efl' : ''), String(w));
      b.type = 'button';
      b.setAttribute('aria-pressed', String(on.has(w)));
      b.title = on.has(w) ? 'EFL pick is on. Click to switch it off.' : 'Click to switch the EFL pick on for this week.';
      b.addEventListener('click', async () => {
        const next = new Set(on);
        if (next.has(w)) next.delete(w); else next.add(w);
        const out = await adminPost('config', { eflWeeks: [...next] });
        if (out.ok) { say(eflMsg, 'ok', next.has(w) ? 'The EFL pick is on for week ' + w + '.' : 'The EFL pick is off for week ' + w + '. Any EFL picks already made that week no longer count.'); window.FFWB.reload(); }
        else say(eflMsg, 'bad', out.error);
      });
      return b;
    }));
    const clubs = season.config.eflClubs || [];
    document.getElementById('efl-clubs-note').textContent = clubs.length
      ? clubs.length + ' clubs on the list: ' + clubs.join(', ') + '.'
      : 'No clubs on the list yet. Load them from the feed so players pick from a dropdown.';
    if (document.activeElement !== eflList) eflList.value = clubs.join('\n');
  }
  document.getElementById('efl-load').addEventListener('click', async () => {
    say(eflMsg, 'info', 'Loading the Championship clubs...');
    const out = await adminPost('efl-clubs', {});
    if (out.ok) { say(eflMsg, 'ok', 'Loaded ' + out.config.eflClubs.length + ' Championship clubs.'); window.FFWB.reload(); }
    else say(eflMsg, 'bad', out.error);
  });
  document.getElementById('efl-save-list').addEventListener('click', async () => {
    const list = eflList.value.split('\n').map((x) => x.trim()).filter(Boolean);
    const out = await adminPost('config', { eflClubs: list });
    if (out.ok) { say(eflMsg, 'ok', 'Saved ' + out.config.eflClubs.length + ' clubs.'); window.FFWB.reload(); }
    else say(eflMsg, 'bad', out.error);
  });

  const autoBox = document.getElementById('auto-close');
  autoBox.addEventListener('change', async () => {
    const on = autoBox.checked;
    const out = await adminPost('config', { autoClose: on });
    if (out.ok) { say(cwMsg, 'ok', on ? 'Weeks now close at their first kickoff.' : 'Weeks stay open after kickoff until you close them or enter a result.'); window.FFWB.reload(); }
    else { autoBox.checked = !on; say(cwMsg, 'bad', out.error); }
  });

  document.getElementById('cw-down').addEventListener('click', () => { if (cw > 1) { cw -= 1; renderWeeks(); } });
  document.getElementById('cw-up').addEventListener('click', () => { if (cw < R.WEEKS) { cw += 1; renderWeeks(); } });
  document.getElementById('cw-save').addEventListener('click', async () => {
    const out = await adminPost('config', { currentWeek: cw });
    if (out.ok) { say(cwMsg, 'ok', 'The current week is now week ' + out.config.currentWeek + '. Players can pick that week only.'); window.FFWB.reload(); }
    else say(cwMsg, 'bad', out.error);
  });

  // ---------- Results ----------
  const resWeekName = document.getElementById('res-week');
  const resGrid = document.getElementById('res-grid');
  const resMsg = document.getElementById('res-message');
  const CHOICES = [[1, 'W', 'Won'], [0.5, 'D', 'Drew'], [0, 'L', 'Lost'], ['P', 'P', 'Postponed']];
  let resWeek = null;
  let draft = {};
  let eflDraft = {};
  let resDirty = false;
  let suggested = null;
  let feedOn = false;
  let prefilled = new Set();
  const feedFor = (w) => (suggested && suggested.weeks && suggested.weeks[String(w)]) || null;
  // Add the feed's results for any club that has no result yet, leaving anything already set alone.
  function addFeed() {
    const feed = feedFor(resWeek);
    if (!feed) return;
    for (const [club, v] of Object.entries(feed.results || {})) {
      if (draft[club] === undefined && season.config.clubs.includes(club)) { draft[club] = v; prefilled.add(club); resDirty = true; }
    }
    const efl = feed.efl && feed.efl.results ? feed.efl.results : {};
    for (const club of Object.keys(eflPicked())) {
      if (eflDraft[club] === undefined && efl[club] !== undefined) { eflDraft[club] = efl[club]; prefilled.add('efl:' + club); resDirty = true; }
    }
  }
  // EFL clubs picked this week, with how many players picked each.
  function eflPicked() {
    const out = {};
    if (!season) return out;
    for (const weeks of Object.values(season.picks)) {
      const p = weeks[String(resWeek)];
      if (p && p.efl) out[p.efl] = (out[p.efl] || 0) + 1;
    }
    return out;
  }
  const isEflWeek = () => (season.config.eflWeeks || []).includes(resWeek);
  function loadResults() {
    draft = { ...(season.results[String(resWeek)] || {}) };
    eflDraft = { ...((season.eflResults || {})[String(resWeek)] || {}) };
    resDirty = false;
    prefilled = new Set();
    addFeed();
  }
  const feedBox = document.getElementById('res-feed');
  const ago = (iso) => {
    const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    return mins < 2 ? 'just now' : mins < 90 ? mins + ' minutes ago' : new Date(iso).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  };
  function renderFeed() {
    feedBox.replaceChildren();
    if (!feedOn) {
      feedBox.append(el('p', 'ffwb-note', 'Automatic results are off. Add your football-data.org key on Netlify as FOOTBALL_DATA_KEY and redeploy to turn them on.'));
      return;
    }
    const feed = feedFor(resWeek);
    if (!feed) {
      feedBox.append(el('p', 'ffwb-note', 'Results for week ' + resWeek + ' have not been fetched yet. The site checks every Tuesday at 9 AM Central, or click Check for results now.'));
    } else {
      const left = feed.games - feed.finished - feed.postponed;
      let text = 'From football-data.org, checked ' + ago(feed.checkedAt) + ': ' + feed.finished + ' of ' + feed.games + ' games finished';
      if (feed.postponed) text += ', ' + feed.postponed + ' postponed';
      if (left > 0) text += ', ' + left + ' still to play';
      text += '.';
      if (prefilled.size) text += ' ' + prefilled.size + ' results are filled in below and marked "from the feed". Check them, then save.';
      feedBox.append(el('p', 'res-feed-line', text));
      if (feed.efl && feed.efl.twice && feed.efl.twice.length) feedBox.append(el('p', 'ffwb-note', 'EFL: ' + feed.efl.twice.join(', ') + ' played twice that week, so enter those by hand.'));
      if (feed.unmatched && feed.unmatched.length) feedBox.append(el('p', 'pk-message pk-message-bad', 'The feed has teams this site does not recognise: ' + feed.unmatched.join(', ') + '. Enter those results by hand and tell Claude so the names can be matched.'));
    }
    if (suggested && suggested.error) feedBox.append(el('p', 'pk-message pk-message-bad', 'The last check had a problem: ' + suggested.error));
  }
  async function loadSuggested() {
    const out = await adminPost('suggested', {});
    if (!out.ok) return;
    suggested = out.suggested;
    feedOn = out.configured;
    if (season && resWeek !== null) addFeed();
    renderResults();
  }
  function renderResults() {
    if (!season) return;
    if (resWeek === null) {
      resWeek = season.config.currentWeek;
      loadResults();
    }
    renderFeed();
    resWeekName.textContent = 'Week ' + resWeek;
    const picked = {};
    for (const weeks of Object.values(season.picks)) {
      const p = weeks[String(resWeek)];
      if (!p) continue;
      for (const c of [...p.standard, p.lock]) picked[c] = (picked[c] || 0) + 1;
    }
    resGrid.replaceChildren(...season.config.clubs.map((club) => {
      const row = el('div', 'res-row');
      const name = el('div', 'res-club');
      name.append(el('span', 'ffwb-strong', club), el('span', 'ffwb-muted res-picked', picked[club] ? 'picked by ' + picked[club] : ''));
      const feed = feedFor(resWeek);
      const fv = feed && feed.results ? feed.results[club] : undefined;
      const saved = (season.results[String(resWeek)] || {})[club];
      if (prefilled.has(club) && draft[club] === fv) name.append(el('span', 'res-tag', 'from the feed'));
      else if (fv !== undefined && saved !== undefined && fv !== saved) name.append(el('span', 'res-tag res-tag-warn', 'feed says ' + resultCode(fv)));
      const btns = el('div', 'res-btns');
      btns.setAttribute('role', 'group');
      btns.setAttribute('aria-label', club + ' result');
      for (const [value, code, word] of CHOICES) {
        const b = el('button', 'res-btn res-' + code, code);
        b.type = 'button';
        b.title = word;
        b.setAttribute('aria-label', club + ' ' + word);
        b.setAttribute('aria-pressed', String(draft[club] === value));
        b.addEventListener('click', () => {
          if (draft[club] === value) delete draft[club]; else draft[club] = value;
          resDirty = true;
          renderResults();
        });
        btns.append(b);
      }
      row.append(name, btns);
      return row;
    }));
    // EFL picks for this week.
    const eflBox = document.getElementById('res-efl');
    const ep = eflPicked();
    const eflClubs = Object.keys(ep).sort((a, b) => a.localeCompare(b));
    eflBox.hidden = !isEflWeek() || !eflClubs.length;
    const feedEfl = (feedFor(resWeek) || {}).efl || {};
    document.getElementById('res-efl-grid').replaceChildren(...eflClubs.map((club) => {
      const row = el('div', 'res-row');
      const name = el('div', 'res-club');
      name.append(el('span', 'ffwb-strong', club), el('span', 'ffwb-muted res-picked', 'picked by ' + ep[club]));
      if (prefilled.has('efl:' + club) && eflDraft[club] === (feedEfl.results || {})[club]) name.append(el('span', 'res-tag', 'from the feed'));
      const btns = el('div', 'res-btns');
      for (const [value, code, word] of CHOICES) {
        const b = el('button', 'res-btn res-' + code, code);
        b.type = 'button';
        b.title = word;
        b.setAttribute('aria-label', club + ' ' + word);
        b.setAttribute('aria-pressed', String(eflDraft[club] === value));
        b.addEventListener('click', () => {
          if (eflDraft[club] === value) delete eflDraft[club]; else eflDraft[club] = value;
          resDirty = true;
          renderResults();
        });
        btns.append(b);
      }
      row.append(name, btns);
      return row;
    }));

    const n = Object.keys(draft).length;
    const saveBtn = document.getElementById('res-save');
    saveBtn.disabled = !resDirty;
    if (resMsg.dataset.keep) { /* keep the last action's message */ }
    else if (resDirty) say(resMsg, 'warn', n + ' of ' + season.config.clubs.length + ' results set. Not saved yet.');
    else if (!resMsg.dataset.keep) say(resMsg, 'info', n ? n + ' of ' + season.config.clubs.length + ' results saved for week ' + resWeek + '.' : 'No results entered for week ' + resWeek + ' yet.');
    delete resMsg.dataset.keep;
    renderChat();
  }
  document.getElementById('res-prev').addEventListener('click', () => { if (resWeek > 1) { resWeek -= 1; loadResults(); renderResults(); } });
  document.getElementById('res-next').addEventListener('click', () => { if (resWeek < R.WEEKS) { resWeek += 1; loadResults(); renderResults(); } });
  document.getElementById('res-all-l').addEventListener('click', () => {
    for (const c of season.config.clubs) if (draft[c] === undefined) draft[c] = 0;
    if (isEflWeek()) for (const c of Object.keys(eflPicked())) if (eflDraft[c] === undefined) eflDraft[c] = 0;
    resDirty = true;
    renderResults();
  });
  document.getElementById('res-fetch').addEventListener('click', async () => {
    const btn = document.getElementById('res-fetch');
    btn.disabled = true;
    say(resMsg, 'info', 'Checking football-data.org for week ' + resWeek + '...');
    const out = await adminPost('fetch-results', { week: resWeek });
    btn.disabled = false;
    if (out.suggested) suggested = out.suggested;
    if (out.ok) feedOn = true;
    addFeed();
    resMsg.dataset.keep = '1';
    if (out.ok) {
      const f = feedFor(resWeek);
      say(resMsg, 'ok', f ? 'Checked. ' + f.finished + ' of ' + f.games + ' games in week ' + resWeek + ' are finished.' : 'Checked.');
    } else say(resMsg, 'bad', out.error);
    renderResults();
  });
  // Accept the feed: save every feed result for clubs without one, and say what still needs a look.
  document.getElementById('res-accept').addEventListener('click', async () => {
    const feed = feedFor(resWeek);
    if (!feed || !feed.results || !Object.keys(feed.results).length) { resMsg.dataset.keep = '1'; say(resMsg, 'warn', 'Nothing from the feed for week ' + resWeek + ' yet. Try Check for results now.'); return; }
    const saved = season.results[String(resWeek)] || {};
    const codes = { 1: 'W', 0.5: 'D', 0: 'L', P: 'P' };
    let added = 0;
    for (const [club, v] of Object.entries(feed.results)) {
      if (!season.config.clubs.includes(club)) continue;
      if (saved[club] === undefined && draft[club] !== v) { draft[club] = v; added += 1; }
      else if (saved[club] === undefined) added += 1;
    }
    const efl = feed.efl && feed.efl.results ? feed.efl.results : {};
    for (const club of Object.keys(eflPicked())) if (eflDraft[club] === undefined && efl[club] !== undefined) eflDraft[club] = efl[club];
    const differ = season.config.clubs.filter((c) => saved[c] !== undefined && feed.results[c] !== undefined && saved[c] !== feed.results[c]);
    const missing = season.config.clubs.filter((c) => draft[c] === undefined);
    const body = { week: resWeek, results: draft };
    if (isEflWeek() || Object.keys(eflDraft).length) body.efl = eflDraft;
    const out = await adminPost('results', body);
    resMsg.dataset.keep = '1';
    if (!out.ok) { say(resMsg, 'bad', out.error); return; }
    resDirty = false;
    const parts = ['Saved ' + added + ' result' + (added === 1 ? '' : 's') + ' from the feed.'];
    if (differ.length) parts.push('Check: ' + differ.map((c) => c + ' (you have ' + codes[saved[c]] + ', feed says ' + codes[feed.results[c]] + ')').join(', ') + '.');
    if (missing.length) parts.push('Still to come: ' + listNames(missing) + '.');
    if (out.config && out.config.currentWeek !== season.config.currentWeek) parts.push('Week ' + out.config.currentWeek + ' is now open for picks.');
    say(resMsg, differ.length || missing.length ? 'warn' : 'ok', parts.join(' '));
    cw = null;
    window.FFWB.reload();
    loadLog();
  });

  document.getElementById('res-save').addEventListener('click', async () => {
    say(resMsg, 'info', 'Saving...');
    const body = { week: resWeek, results: draft };
    if (isEflWeek() || Object.keys(eflDraft).length) body.efl = eflDraft;
    const out = await adminPost('results', body);
    if (out.ok) {
      resDirty = false;
      const moved = out.config && out.config.currentWeek !== season.config.currentWeek;
      resMsg.dataset.keep = '1';
      say(resMsg, 'ok', 'Week ' + resWeek + ' results saved.' + (moved ? ' Every club has a result, so week ' + out.config.currentWeek + ' is now open for picks.' : ''));
      cw = null;
      window.FFWB.reload();
      loadLog();
    } else say(resMsg, 'bad', out.error);
  });

  // ---------- Anyone's picks ----------
  const picksEditor = PicksEditor(document.getElementById('admin-picks'), { admin: true, passcode: () => passcode, onSaved: () => { window.FFWB.reload(); loadLog(); } });

  // ---------- Change log ----------
  const logBox = document.getElementById('log');
  const describe = (v) => (!v ? 'nothing' : v.standard ? v.standard.join(', ') + ' + lock ' + v.lock : Object.keys(v).length + ' results');
  async function loadLog() {
    const out = await adminPost('log', {});
    if (!out.ok) { logBox.replaceChildren(el('p', 'ffwb-note', out.error || 'The change log could not be loaded.')); return; }
    if (!out.entries.length) { logBox.replaceChildren(el('p', 'ffwb-note', 'No changes yet.')); return; }
    const t = el('table', 'ffwb-table');
    const hr = el('tr');
    for (const h of ['When', 'What', 'Week', 'By', 'Changed to', '']) hr.append(el('th', null, h));
    const thead = el('thead');
    thead.append(hr);
    const tbody = el('tbody');
    for (const e of out.entries.slice(0, 80)) {
      const tr = el('tr');
      tr.append(
        el('td', null, new Date(e.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })),
        el('td', 'ffwb-strong', e.kind === 'results' ? 'Results' : e.player + "'s picks"),
        el('td', 'ffwb-num', String(e.week)),
        el('td', null, e.by),
        el('td', 'ffwb-wrap', describe(e.to) + (e.from ? ' (was ' + describe(e.from) + ')' : '')),
      );
      // Undo: put back what it was before this change.
      const undoTd = el('td');
      const undo = el('button', 'pk-clear adm-small', 'Undo');
      undo.type = 'button';
      undo.title = 'Put back ' + describe(e.from);
      undo.addEventListener('click', async () => {
        const what = e.kind === 'results' ? 'week ' + e.week + ' results' : e.player + "'s week " + e.week + ' picks';
        if (!confirm('Put ' + what + ' back to ' + describe(e.from) + '?')) return;
        let out;
        if (e.kind === 'results') out = await adminPost('results', { week: e.week, results: e.from || {} });
        else {
          const f = e.from || {};
          const res = await fetch('/api/picks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ passcode, override: true, player: e.pid, week: e.week, standard: f.standard || [], lock: f.lock || null, efl: f.efl || undefined }) });
          out = await res.json();
        }
        if (out.ok) { window.FFWB.reload(); loadLog(); } else alert(out.error || 'That could not be undone.');
      });
      undoTd.append(undo);
      tr.append(undoTd);
      tbody.append(tr);
    }
    t.append(thead, tbody);
    logBox.replaceChildren(t);
  }
  document.getElementById('log-refresh').addEventListener('click', loadLog);

  // ---------- For the group chat ----------
  const siteUrl = location.origin + '/';
  const listNames = (names) => (names.length > 1 ? names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1] : names.join(''));
  const pts = (n) => String(Math.round(n * 10) / 10);
  const ordinal = (n) => n + ([, 'st', 'nd', 'rd'][(n % 100 >> 3 ^ 1) && n % 10] || 'th');
  // One player's points in a week: picks, the doubled lock and any EFL pick.
  function weekScore(pid, w) {
    const p = (season.picks[pid] || {})[String(w)];
    if (!p) return { points: 0, wins: 0 };
    const res = season.results[String(w)] || {};
    const eres = (season.eflResults || {})[String(w)] || {};
    const all = [...(p.standard || []), p.lock].filter(Boolean);
    return {
      points: (p.standard || []).reduce((a, c) => a + R.pickPoints(res[c], false), 0) + R.pickPoints(res[p.lock], true) + (p.efl ? R.pickPoints(eres[p.efl], false) : 0),
      wins: all.filter((c) => res[c] === 1).length,
    };
  }
  function tableThrough(w) {
    const rows = season.config.players.map((p) => {
      let points = 0;
      let wins = 0;
      for (let k = 1; k <= w; k += 1) { if (!Object.keys(season.results[String(k)] || {}).length) continue; const s = weekScore(p.id, k); points += s.points; wins += s.wins; }
      return { id: p.id, name: p.name, points, wins };
    }).sort((a, b) => b.points - a.points || b.wins - a.wins || a.name.localeCompare(b.name));
    rows.forEach((r, i) => { r.pos = i && rows[i - 1].points === r.points && rows[i - 1].wins === r.wins ? rows[i - 1].pos : i + 1; });
    return rows;
  }
  function nudgeText() {
    const w = season.openWeeks.find((x) => x >= season.config.currentWeek && !kickedOff(season, x));
    if (!w) return { title: 'Still to pick', text: 'No week is open for picks right now.' };
    const missing = season.config.players.filter((p) => !(season.picks[p.id] || {})[String(w)]).map((p) => p.name);
    const ko = ((season.fixtures || {})[String(w)] || {}).kickoff;
    const lockLine = ko && season.config.autoClose ? 'Week ' + w + ' picks lock ' + whenLong(ko) + '.'
      : ko && Date.now() < Date.parse(ko) ? 'Week ' + w + ' kicks off ' + whenLong(ko) + '.' : 'Week ' + w + ' picks are open.';
    const text = !missing.length ? "Everyone's in for week " + w + '. ' + siteUrl
      : lockLine + ' Still waiting on ' + listNames(missing) + '. Make yours at ' + siteUrl;
    return { title: 'Still to pick for week ' + w + ' (' + missing.length + ')', text };
  }
  function recapText() {
    const done = Object.keys(season.results).map(Number).filter((w) => Object.keys(season.results[String(w)]).length);
    if (!done.length) return { title: 'Weekly recap', text: 'No results yet.' };
    const w = done.includes(resWeek) ? resWeek : Math.max(...done);
    const res = season.results[String(w)];
    const played = season.config.players.filter((p) => (season.picks[p.id] || {})[String(w)]);
    const scores = played.map((p) => ({ name: p.name, ...weekScore(p.id, w) }));
    const top = Math.max(...scores.map((s) => s.points));
    const best = scores.filter((s) => s.points === top).map((s) => s.name);
    const zero = scores.filter((s) => s.points === 0).map((s) => s.name);
    const perfect = played.filter((p) => R.isPerfect(season.picks[p.id][String(w)], res)).map((p) => p.name);
    const now = tableThrough(w);
    const before = tableThrough(w - 1);
    const was = Object.fromEntries(before.map((r) => [r.id, r.pos]));
    const moves = w > 1 ? now.map((r) => ({ name: r.name, up: was[r.id] - r.pos, pos: r.pos })).sort((a, b) => b.up - a.up) : [];
    const lines = ['FFWB week ' + w + ' recap'];
    lines.push(best.length > 3 ? 'Top score: ' + pts(top) + ', hit by ' + best.length + ' players.' : 'Top score: ' + listNames(best) + ' with ' + pts(top) + '.');
    lines.push(perfect.length ? 'Perfect week' + (perfect.length > 1 ? 's' : '') + ': ' + listNames(perfect) + '. Bonus pick' + (perfect.length > 1 ? 's' : '') + ' in week ' + (w + 1) + '.' : 'No perfect weeks.');
    if (zero.length) lines.push('Zero points: ' + listNames(zero) + '.');
    // The weekly awards (the top scorer is already above).
    const aw = window.FFWBAwards ? window.FFWBAwards.lines(window.FFWBAwards.week(season, w)) : [];
    for (const a of aw) if (a.key !== 'top') lines.push(({ bottled: '\u{1F37E} ', lone: '\u{1F43A} ', worst: '\u{1F944} ' }[a.key] || '') + a.label + ': ' + a.text + '.');
    if (moves.length && moves[0].up > 0) {
      const climbers = moves.filter((m) => m.up === moves[0].up);
      lines.push('Biggest climb: ' + listNames(climbers.map((m) => m.name)) + ', up ' + moves[0].up + (climbers.length === 1 ? ' to ' + ordinal(climbers[0].pos) : '') + '.');
    }
    lines.push('Top 3: ' + now.slice(0, 3).map((r) => r.pos + '. ' + r.name + ' ' + pts(r.points)).join(', '));
    // Cup news from this week.
    for (const cup of season.cups || []) {
      const st = window.FFWBCups && window.FFWBCups.state(season, cup);
      if (!st) continue;
      if (st.format === 'knockout') {
        const r = st.bracket.rounds.find((x) => x.week === w);
        if (!r || !r.matches.every((m) => m.status === 'final' || m.status === 'bye')) continue;
        const next = st.bracket.rounds[r.index + 1];
        const through = r.matches.filter((m) => !m.bye).map((m) => (m.winner === m.a.id ? m.a : m.b).name);
        const byes = r.matches.filter((m) => m.bye).map((m) => (m.a || m.b).name);
        lines.push(next ? st.name + ': ' + listNames(through) + (through.length > 1 ? ' are' : ' is') + ' through to the ' + next.name.toLowerCase() + (byes.length ? ', joining ' + listNames(byes) : '') + '.'
          : st.name + ': ' + (st.champion ? st.champion.name + ' wins it!' : ''));
      } else if (cup.weeks.includes(w) && st.mini.rows[0]) {
        lines.push(st.name + (st.champion ? ': ' + st.champion.name + ' wins it with ' + pts(st.champion.points) + '.' : ': ' + st.mini.rows[0].name + ' leads on ' + pts(st.mini.rows[0].points) + '.'));
      }
    }
    const shamed = window.FFWBShame ? window.FFWBShame.offences(season).filter((o) => o.week === w) : [];
    for (const o of shamed) lines.push('Welcome to the Shame Club: ' + o.player + ' (' + o.home + ' v ' + o.away + ').');
    if (Object.values(res).includes('P')) lines.push('A postponed game still to come, so scores can change.');
    lines.push(siteUrl);
    return { title: 'Week ' + w + ' recap', text: lines.join('\n') };
  }
  const chatMsg = document.getElementById('chat-message');
  function renderChat() {
    if (!season) return;
    const n = nudgeText();
    const r = recapText();
    document.getElementById('nudge-title').textContent = n.title;
    document.getElementById('recap-title').textContent = r.title;
    const nt = document.getElementById('nudge-text');
    const rt = document.getElementById('recap-text');
    if (document.activeElement !== nt) nt.value = n.text;
    if (document.activeElement !== rt) rt.value = r.text;
  }
  // ---------- The weekly programme image ----------
  function recapData() {
    const done = Object.keys(season.results).map(Number).filter((w) => Object.keys(season.results[String(w)]).length);
    if (!done.length) return null;
    const w = done.includes(resWeek) ? resWeek : Math.max(...done);
    const res = season.results[String(w)];
    const played = season.config.players.filter((p) => (season.picks[p.id] || {})[String(w)]);
    const scores = played.map((p) => ({ name: p.name, ...weekScore(p.id, w) }));
    const topPts = Math.max(...scores.map((x) => x.points));
    const best = scores.filter((x) => x.points === topPts).map((x) => x.name);
    const perfect = played.filter((p) => R.isPerfect(season.picks[p.id][String(w)], res)).map((p) => p.name);
    const now = tableThrough(w);
    const was = Object.fromEntries(tableThrough(w - 1).map((r) => [r.id, r.pos]));
    const moves = w > 1 ? now.map((r) => ({ name: r.name, up: was[r.id] - r.pos })).sort((a, b) => b.up - a.up) : [];
    const climb = moves.length && moves[0].up > 0 ? moves.filter((m) => m.up === moves[0].up) : [];
    const cupLines = [];
    for (const cup of season.cups || []) {
      const st = window.FFWBCups && window.FFWBCups.state(season, cup);
      if (!st) continue;
      if (st.format === 'knockout') {
        const r = st.bracket.rounds.find((x) => x.week === w);
        if (r) cupLines.push(st.name + ', ' + r.name.toLowerCase() + ': ' + r.matches.filter((m) => m.a && m.b).map((m) => m.status === 'final' ? (m.winner === m.a.id ? m.a.name : m.b.name) + ' through' : m.a.name + ' v ' + m.b.name).slice(0, 4).join(', '));
      } else if (cup.weeks.includes(w) && st.mini.rows[0]) cupLines.push(st.name + ': ' + st.mini.rows[0].name + ' leads on ' + pts(st.mini.rows[0].points));
    }
    const awards = window.FFWBAwards ? window.FFWBAwards.lines(window.FFWBAwards.week(season, w)).filter((a) => a.key !== 'top') : [];
    return { w, topPts, best, perfect, climb, upBy: climb.length ? moves[0].up : 0, top: now.slice(0, 5), was, cupLines, awards };
  }
  async function programmeImage() {
    const d = recapData();
    if (!d) { say(chatMsg, 'warn', 'No results yet to make an image from.'); return; }
    try { await Promise.all(['700 64px "Playfair Display"', '600 40px Oswald', '500 30px Oswald', '500 30px Barlow', '600 30px Barlow'].map((f) => document.fonts.load(f))); } catch (err) { /* fall back to system fonts */ }
    const W = 1080, H = 1350;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    const NAVY = '#1c2945', CLARET = '#7b1f2c', CREAM = '#f1e8d4', GOLD = '#c8a04a';
    g.fillStyle = NAVY; g.fillRect(0, 0, W, H);
    for (let x = 0; x < W; x += 120) { g.fillStyle = 'rgba(255,255,255,0.025)'; g.fillRect(x, 0, 60, H); }
    g.strokeStyle = GOLD; g.lineWidth = 4; g.strokeRect(34, 34, W - 68, H - 68);
    g.strokeStyle = 'rgba(200,160,74,0.45)'; g.lineWidth = 1.5; g.strokeRect(48, 48, W - 96, H - 96);
    const crest = await new Promise((ok) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => ok(null); im.src = '/brand/crest.svg'; });
    if (crest) g.drawImage(crest, W / 2 - 95, 80, 190, 190);
    const text = (t, x, y, font, color, align = 'center') => { g.font = font; g.fillStyle = color; g.textAlign = align; g.fillText(t, x, y); };
    const fit = (t, max, size, family) => { let s = size; g.font = family.replace('SIZE', s); while (g.measureText(t).width > max && s > 20) { s -= 2; g.font = family.replace('SIZE', s); } return family.replace('SIZE', s); };
    g.letterSpacing = '8px'; text('WEEK ' + d.w + ' IN REVIEW', W / 2, 330, '500 30px Oswald', GOLD); g.letterSpacing = '0px';
    const headline = d.best.length > 3 ? d.best.length + ' players top the week' : d.best.join(' and ') + ' top' + (d.best.length > 1 ? '' : 's') + ' the week';
    text(headline, W / 2, 410, fit(headline, W - 160, 64, '700 SIZEpx "Playfair Display"'), CREAM);
    text(pts(d.topPts) + ' points' + (d.perfect.length ? ' · ' + d.perfect.length + ' perfect week' + (d.perfect.length > 1 ? 's' : '') : ''), W / 2, 462, '500 32px Barlow', 'rgba(241,232,212,0.85)');
    // The table.
    let y = 540;
    g.letterSpacing = '6px'; text('THE TABLE', 110, y, '500 26px Oswald', GOLD, 'left'); g.letterSpacing = '0px';
    y += 24;
    const maxPts = d.top.length ? d.top[0].points : 1;
    d.top.forEach((r, i) => {
      y += 70;
      g.fillStyle = i === 0 ? 'rgba(200,160,74,0.18)' : 'rgba(255,255,255,0.05)';
      g.fillRect(100, y - 48, W - 200, 60);
      g.fillStyle = GOLD; g.fillRect(100, y - 48, Math.max(6, (W - 200) * 0.28 * (r.points / maxPts)), 4);
      text(String(r.pos), 140, y, '600 34px Oswald', i === 0 ? GOLD : CREAM, 'center');
      text(r.name, 190, y, '600 34px Barlow', CREAM, 'left');
      const mv = d.was[r.id] ? d.was[r.id] - r.pos : 0;
      if (mv) text((mv > 0 ? '\u25B2' : '\u25BC') + Math.abs(mv), W - 260, y, '600 28px Barlow', mv > 0 ? '#7ed69a' : '#e8808c', 'right');
      text(pts(r.points), W - 130, y, '700 36px "Playfair Display"', CREAM, 'right');
    });
    y += 70;
    const notes = d.awards.slice(0, 2).map((a) => a.label + ': ' + a.text);
    if (d.climb.length) notes.push('Biggest climb: ' + listNames(d.climb.map((m) => m.name)) + ', up ' + d.upBy);
    if (d.perfect.length) notes.push('Perfect: ' + (d.perfect.length > 4 ? d.perfect.length + ' players' : listNames(d.perfect)) + '. Bonus pick next week');
    notes.push(...d.cupLines);
    for (const n of notes.slice(0, 3)) { text(n, W / 2, y, fit(n, W - 180, 30, '500 SIZEpx Barlow'), 'rgba(241,232,212,0.9)'); y += 48; }
    // Footer band.
    g.fillStyle = CLARET; g.fillRect(0, H - 210, W, 110);
    g.fillStyle = GOLD; g.fillRect(0, H - 210, W, 4); g.fillRect(0, H - 104, W, 4);
    g.letterSpacing = '6px'; text('WEEK ' + (d.w + 1) + ' PICKS ARE OPEN', W / 2, H - 140, '600 44px Oswald', CREAM); g.letterSpacing = '0px';
    g.letterSpacing = '4px'; text(location.host.toUpperCase(), W / 2, H - 58, '500 28px Oswald', GOLD); g.letterSpacing = '0px';
    const blob = await new Promise((ok) => cv.toBlob(ok, 'image/png'));
    const file = new File([blob], 'ffwb-week-' + d.w + '.png', { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'FFWB week ' + d.w }); say(chatMsg, 'ok', 'Shared.'); return; } catch (err) { if (err && err.name === 'AbortError') return; }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = file.name;
    document.body.append(a); a.click(); a.remove();
    say(chatMsg, 'ok', 'Image downloaded. Drop it in the group chat.');
  }
  document.getElementById('recap-image').addEventListener('click', programmeImage);

  async function copy(id, what) {
    const box = document.getElementById(id);
    try { await navigator.clipboard.writeText(box.value); }
    catch (err) { box.select(); document.execCommand('copy'); }
    say(chatMsg, 'ok', what + ' copied. Paste it in the group chat.');
  }
  // Alerts for the commissioner on this phone.
  const commishBtn = document.getElementById('commish-toggle');
  const pushOk = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  let commishReg = null;
  let commishOn = false;
  const b64 = (s) => { const pad = '='.repeat((4 - (s.length % 4)) % 4); const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(raw, (c) => c.charCodeAt(0)); };
  async function mySub() {
    if (!pushOk) return null;
    if (!commishReg) { try { commishReg = await navigator.serviceWorker.register('/sw.js'); await navigator.serviceWorker.ready; } catch (err) { return null; } }
    return commishReg.pushManager.getSubscription();
  }
  function drawCommish() {
    if (!pushOk) { commishBtn.hidden = true; document.getElementById('commish-note').textContent = 'This browser cannot get alerts. On iPhone, add the site to your home screen and open the commissioner page from there.'; return; }
    commishBtn.textContent = commishOn ? 'Turn off alerts for me' : 'Turn on alerts for me';
    commishBtn.className = commishOn ? 'pk-clear' : 'pk-save';
  }
  commishBtn.addEventListener('click', async () => {
    commishBtn.disabled = true;
    try {
      let sub = await mySub();
      if (!commishOn && !sub) {
        if ((await Notification.requestPermission()) !== 'granted') throw new Error('Alerts were not allowed.');
        const { publicKey } = await (await fetch('/api/push/key')).json();
        sub = await commishReg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(publicKey) });
      }
      const res = await fetch('/api/push/subscribe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ subscription: sub.toJSON(), commissioner: !commishOn, passcode }) });
      const done = await res.json();
      if (!done.ok) throw new Error(done.error);
      commishOn = !commishOn;
      say(chatMsg, 'ok', commishOn ? 'Commissioner alerts are on for this phone.' : 'Commissioner alerts are off for this phone.');
    } catch (err) { say(chatMsg, 'bad', err.message || 'That did not work.'); }
    commishBtn.disabled = false;
    drawCommish();
  });

  async function loadPush() {
    const s = await mySub();
    const out = await adminPost('push', s ? { endpoint: s.endpoint } : {});
    if (out.ok) { commishOn = !!out.thisPhone; drawCommish(); }
    if (!out.ok) return;
    alertCount = out.count;
    renderStatus();
    const who = document.getElementById('push-who');
    who.textContent = (out.count ? out.count + ' phone' + (out.count === 1 ? ' has' : 's have') + ' alerts on (' + listNames(out.who) + '). ' : 'Nobody has turned alerts on yet. ')
      + 'Players turn them on with the bell at the top of the site. The site sends one when a week opens, and reminds anyone who has not picked about a day and three hours before kickoff.';
  }
  document.getElementById('push-send').addEventListener('click', async () => {
    const box = document.getElementById('push-text');
    const text = box.value.trim();
    if (!text) { say(chatMsg, 'warn', 'Type a message first.'); return; }
    say(chatMsg, 'info', 'Sending...');
    const out = await adminPost('push', { body: text });
    if (out.ok) { say(chatMsg, 'ok', 'Sent to ' + out.sent + ' phone' + (out.sent === 1 ? '' : 's') + '.'); box.value = ''; loadPush(); }
    else say(chatMsg, 'bad', out.error);
  });
  // What's new: send the newest release notes to every phone, or copy them for the group chat.
  const rel = (window.FFWB_RELEASES || [])[0];
  const wnMsg = document.getElementById('wn-msg');
  const relText = (r) => 'What\u2019s new in FFWB (' + r.date + ')\n\n' + r.sections.map((s) => s.name.toUpperCase() + '\n' + s.items.map(([n, t]) => '\u2022 ' + n + ': ' + t).join('\n')).join('\n\n') + '\n\nThe full notes are on the site under What\u2019s new, at the bottom of the page.';
  if (rel) {
    const pv = document.getElementById('wn-preview');
    pv.append(el('div', 'ffwb-strong', rel.title + ' (' + rel.date + ')'), el('div', 'ffwb-note', 'The alert says: \u201c' + rel.push + '\u201d'));
    document.getElementById('wn-send').addEventListener('click', async () => {
      if (!confirm('Send \u201c' + rel.title + '\u201d to everyone with alerts on?')) return;
      say(wnMsg, 'info', 'Sending...');
      const out = await adminPost('push', { title: 'What\u2019s new in FFWB', body: rel.push, url: '/?whatsnew=1', tag: 'release-' + rel.id });
      if (out.ok) say(wnMsg, 'ok', 'Sent to ' + out.sent + ' phone' + (out.sent === 1 ? '' : 's') + '. Tapping it opens the notes.');
      else say(wnMsg, 'bad', out.error);
    });
    document.getElementById('wn-copy').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(relText(rel)); say(wnMsg, 'ok', 'Copied. Paste it into the group chat.'); } catch (err) { say(wnMsg, 'bad', 'Could not copy on this browser.'); }
    });
  } else {
    document.getElementById('wn-send').disabled = true;
    document.getElementById('wn-copy').disabled = true;
  }
  document.getElementById('nudge-copy').addEventListener('click', () => copy('nudge-text', 'Reminder'));
  document.getElementById('recap-copy').addEventListener('click', () => copy('recap-text', 'Recap'));

  // ---------- Cups ----------
  const Cups = window.FFWBCups;
  const cupMsg = document.getElementById('cup-message');
  const cupType = document.getElementById('cup-type');
  const cupFirst = document.getElementById('cup-first');
  const cupPlan = document.getElementById('cup-plan');
  const cupPick = document.getElementById('cup-pick');
  const cupGrid = document.getElementById('cup-grid');
  // The weeks the cup being set up would use: a run from the first week for a knockout, any chosen weeks for
  // Festive Fixtures. Every other cup's weeks are shown too, and a cup can never share a week with another.
  const festive = new Set();
  let cupReady = false;
  const isKO = () => Cups.TYPES[cupType.value].format === 'knockout';
  const cupId = (type) => type + '-' + season.config.season;
  const roundsNeeded = () => Cups.roundsFor(season.config.players.length);
  const drawnCup = (type) => (season.cups || []).find((c) => c.id === cupId(type) && !c.provisional);
  const savedFor = (type) => (drawnCup(type) ? drawnCup(type).weeks : (season.cupSchedule || {})[type] || null);
  const started = (cup) => !!cup && cup.weeks.some(played);
  function takenWeeks(exceptType) {
    const out = {};
    for (const type of Object.keys(Cups.TYPES)) {
      if (type === exceptType) continue;
      const weeks = savedFor(type);
      if (!weeks) continue;
      const t = Cups.TYPES[type];
      const drawn = !!drawnCup(type);
      weeks.forEach((w, i) => { out[w] = { type, name: t.name, drawn, what: (t.format === 'knockout' ? Cups.roundName(i, weeks.length) : 'week ' + (i + 1) + ' of ' + weeks.length) + (drawn ? '' : ', saved, not drawn yet') }; });
    }
    return out;
  }
  const played = (w) => Object.keys(season.results[String(w)] || {}).length > 0;
  function chosenWeeks() {
    if (!isKO()) return [...festive].sort((a, b) => a - b);
    const first = Number(cupFirst.value);
    if (!Number.isInteger(first) || first < 1) return [];
    return Array.from({ length: roundsNeeded() }, (_, k) => first + k);
  }
  // A sensible starting point for each cup: the next free run of weeks in its part of the season.
  function suggest(type) {
    const taken = takenWeeks(type);
    const now = season.config.currentWeek;
    const free = (w) => w >= 1 && w <= R.WEEKS && !taken[w] && !played(w);
    if (Cups.TYPES[type].format === 'knockout') {
      const n = roundsNeeded();
      const from = type === 'fa' ? Math.max(now, 24) : now;
      for (let w = from; w + n - 1 <= R.WEEKS; w += 1) if (Array.from({ length: n }, (_, k) => w + k).every(free)) return { first: w };
      return { first: from };
    }
    // Festive Fixtures: the weeks with games over Christmas and New Year, if their kickoffs are known.
    const xmas = [];
    for (let w = 1; w <= R.WEEKS; w += 1) {
      const ko = ((season.fixtures || {})[String(w)] || {}).kickoff;
      if (!ko) continue;
      const d = new Date(ko);
      const md = (d.getMonth() + 1) * 100 + d.getDate();
      if ((md >= 1218 || md <= 104) && free(w)) xmas.push(w);
    }
    return { weeks: xmas.length >= 2 ? xmas.slice(0, 4) : [17, 18, 19].filter(free) };
  }
  // Open a cup on its saved weeks if it has them (drawn or not), otherwise on a suggestion.
  function startCup(type) {
    const saved = savedFor(type);
    const sug = saved ? (Cups.TYPES[type].format === 'knockout' ? { first: saved[0] } : { weeks: saved }) : suggest(type);
    festive.clear();
    if (sug.weeks) sug.weeks.forEach((w) => festive.add(w));
    if (sug.first) cupFirst.value = sug.first;
    cupReady = true;
  }
  const changed = () => drawCupGrid();
  function drawCupGrid() {
    if (!season || !Cups) return;
    if (!cupReady) startCup(cupType.value);
    const type = cupType.value;
    const T = Cups.TYPES[type];
    const ko = isKO();
    const drawn = drawnCup(type);
    const locked = started(drawn);
    document.getElementById('cup-first-wrap').hidden = !ko;
    cupFirst.disabled = locked;
    document.getElementById('cup-how').textContent = locked ? 'The ' + T.name + ' has started, so its weeks are fixed. Use Push back a week on a round still to come.'
      : drawn ? 'The ' + T.name + ' is drawn. You can still change its weeks until it starts: change them and save.'
      : ko ? 'The ' + T.name + ' needs ' + roundsNeeded() + ' weeks in a row, one round a week. Choose the first week, or tap a week on the calendar to start there.'
        : 'Tap the weeks to include. They do not need to be in a row: weeks 17 and 19 is fine. Most points over those weeks wins.';
    for (const o of cupType.options) {
      const d = drawnCup(o.value);
      const sv = savedFor(o.value);
      o.textContent = Cups.TYPES[o.value].name + (d ? ' (drawn, weeks ' + d.weeks.join(', ') + ')' : sv ? ' (weeks ' + sv.join(', ') + ' saved)' : '');
    }
    const taken = takenWeeks(type);
    const mine = locked ? drawn.weeks : chosenWeeks();
    const saved = savedFor(type);
    const dirty = !saved || saved.join(',') !== mine.join(',');
    const clashes = mine.filter((w) => taken[w]);
    cupGrid.replaceChildren(...Array.from({ length: R.WEEKS }, (_, k) => {
      const w = k + 1;
      const t = taken[w];
      const on = mine.includes(w);
      const b = el('button', 'adm-wk' + (played(w) ? ' adm-wk-played' : '') + (t ? ' adm-wk-taken cup-' + t.type : '') + (on ? ' adm-wk-on cup-' + type : '') + (on && t ? ' adm-wk-clash' : '') + (w === season.config.currentWeek ? ' adm-wk-now' : '') + (w === R.HALF_END ? ' adm-wk-half' : ''));
      b.type = 'button';
      b.textContent = String(w);
      b.disabled = locked;
      b.title = 'Week ' + w + (t ? ': ' + t.name + ', ' + t.what : '') + (played(w) ? ' (results in)' : '') + (w === season.config.currentWeek ? ' (this week)' : '');
      b.setAttribute('aria-pressed', String(on));
      b.addEventListener('click', () => {
        if (ko) cupFirst.value = Math.min(w, R.WEEKS - roundsNeeded() + 1);
        else if (festive.has(w)) festive.delete(w); else festive.add(w);
        changed();
      });
      return b;
    }));
    const legend = document.getElementById('cup-legend');
    const present = [...new Set(Object.values(taken).map((t) => t.type))];
    legend.replaceChildren(el('span', 'adm-lg adm-lg-on cup-' + type, 'This ' + T.name), ...present.map((p) => el('span', 'adm-lg cup-' + p, Cups.TYPES[p].name + (drawnCup(p) ? '' : ' (saved)'))), el('span', 'adm-lg adm-lg-played', 'Results in'));
    // What the choice adds up to, and whether it can be drawn.
    let ok = false;
    if (locked) {
      cupPick.className = 'adm-cup-pick';
      cupPick.textContent = 'Weeks ' + drawn.weeks.join(', ') + ', drawn and under way.';
    } else if (clashes.length) {
      cupPick.className = 'adm-cup-pick adm-cup-bad';
      cupPick.textContent = 'Week ' + clashes.join(' and ') + ' already belong' + (clashes.length === 1 ? 's' : '') + ' to the ' + listNames([...new Set(clashes.map((w) => taken[w].name))]) + '. Choose other weeks.';
    } else if (ko && (!mine.length || mine[mine.length - 1] > R.WEEKS)) {
      cupPick.className = 'adm-cup-pick adm-cup-bad';
      cupPick.textContent = 'The ' + T.name + ' needs ' + roundsNeeded() + ' weeks in a row, so it has to start by week ' + (R.WEEKS - roundsNeeded() + 1) + '.';
    } else if (!ko && mine.length < 2) {
      cupPick.className = 'adm-cup-pick adm-cup-bad';
      cupPick.textContent = 'Choose at least 2 weeks for Festive Fixtures.';
    } else if (!ko && mine.length > 8) {
      cupPick.className = 'adm-cup-pick adm-cup-bad';
      cupPick.textContent = 'Festive Fixtures can have up to 8 weeks.';
    } else {
      ok = true;
      cupPick.className = 'adm-cup-pick adm-cup-good';
      cupPick.textContent = ko ? mine.map((w, k) => Cups.roundName(k, mine.length) + ' week ' + w).join(' · ')
        : 'Weeks ' + listNames(mine.map(String)) + ' (' + mine.length + ' weeks' + (mine.some((w, k) => k && w !== mine[k - 1] + 1) ? ', not in a row' : '') + ').';
      if (mine.some(played)) cupPick.textContent += ' Some of these weeks already have results, and they will count.';
    }
    // Saved or not, so it is always clear whether a change will stick.
    const status = el('span', 'adm-cup-saved' + (dirty ? ' adm-cup-unsaved' : ''), locked ? '' : dirty ? (saved ? 'Changed, not saved yet. Saved weeks: ' + saved.join(', ') + '.' : 'Not saved yet.') : '\u2713 Saved' + (drawn ? ' and drawn.' : '. ' + (T.format === 'knockout' ? 'Draws itself' : 'Starts') + ' when week ' + mine[0] + ' starts.'));
    if (!locked) cupPick.append(document.createElement('br'), status);
    const saveB = document.getElementById('cup-save');
    saveB.hidden = locked;
    saveB.textContent = drawn ? 'Save new weeks' : 'Save weeks';
    saveB.disabled = !ok || !dirty;
    // How the draw would look if the cup started now. It is fixed from the table when its first week starts.
    cupPlan.replaceChildren();
    if (ok && !drawn) {
      const box = el('div', 'adm-cupplan');
      const seeds = Cups.table(season).map((r) => r.name);
      if (ko) {
        const order = Cups.seedOrder(2 ** Cups.roundsFor(seeds.length));
        const list = el('ol', 'adm-pairs');
        for (let k = 0; k < order.length; k += 2) {
          const a = seeds[order[k] - 1];
          const b = seeds[order[k + 1] - 1];
          list.append(el('li', null, a && b ? '(' + order[k] + ') ' + a + ' v ' + b + ' (' + order[k + 1] + ')' : '(' + (a ? order[k] : order[k + 1]) + ') ' + (a || b) + ', bye'));
        }
        box.append(el('p', 'ffwb-note', 'It draws itself when week ' + mine[0] + ' starts, from the table then. If it started now, the first round would be:'), list);
      } else {
        box.append(el('p', 'ffwb-note', 'It starts by itself in week ' + mine[0] + '. Everyone is in, nothing to draw. Most points over weeks ' + listNames(mine.map(String)) + ' wins, then the lock, winning picks and a FIFA shootout.'));
      }
      cupPlan.append(box);
    }
  }
  const cupBody = () => ({ type: cupType.value, firstWeek: Number(cupFirst.value), weeks: isKO() ? undefined : [...festive].sort((a, b) => a - b) });
  cupType.addEventListener('change', () => { startCup(cupType.value); changed(); });
  document.getElementById('cup-save').addEventListener('click', async () => {
    const T = Cups.TYPES[cupType.value];
    const drawn = drawnCup(cupType.value);
    const out = await adminPost('cups', { action: 'save-weeks', ...cupBody() });
    if (!out.ok) { say(cupMsg, 'bad', out.error); return; }
    say(cupMsg, 'ok', T.name + (drawn ? ' moved to' : ' saved for') + ' weeks ' + out.weeks.join(', ') + '.' + (drawn ? '' : ' It ' + (T.format === 'knockout' ? 'draws itself' : 'starts') + ' when week ' + out.weeks[0] + ' starts.'));
    season.cupSchedule = out.schedule;
    drawCupGrid();
    window.FFWB.reload();
  });
  cupFirst.addEventListener('input', changed);
  async function cupAction(body, done) {
    const out = await adminPost('cups', body);
    if (out.ok) { say(cupMsg, 'ok', done); window.FFWB.reload(); } else say(cupMsg, 'bad', out.error);
  }
  function renderCups() {
    if (!season || !Cups) return;
    drawCupGrid();
    const box = document.getElementById('cup-list');
    const list = (season.cups || []).map((c) => Cups.state(season, c));
    if (!list.length) { box.replaceChildren(el('p', 'ffwb-note', 'No cups drawn this season yet.')); return; }
    box.replaceChildren(...list.map((s) => {
      const card = el('div', 'adm-cup');
      const head = el('div', 'adm-cup-head');
      head.append(el('b', null, s.name), el('span', 'ffwb-muted', s.cup.provisional ? 'Weeks ' + s.cup.weeks.join(', ') + ' saved' : s.status === 'done' ? 'Won by ' + s.champion.name : s.status === 'live' ? 'Being played' : 'Drawn, starts week ' + s.cup.weeks[0]));
      card.append(head);
      if (s.cup.provisional) {
        card.append(el('p', 'ffwb-note', s.format === 'knockout' ? 'Draws itself when week ' + s.cup.weeks[0] + ' starts, seeded from the table then. Change its weeks above.' : 'Starts by itself in week ' + s.cup.weeks[0] + '. Change its weeks above.'));
        const rm = el('button', 'pk-clear adm-small adm-danger', 'Remove these weeks');
        rm.type = 'button';
        rm.addEventListener('click', () => { if (confirm('Remove the ' + s.name + ' weeks? It will not be played unless you save new weeks.')) { cupReady = false; cupAction({ action: 'delete', id: s.cup.id }, s.name + ' weeks removed.'); } });
        card.append(rm);
        return card;
      }
      if (s.format === 'knockout') {
        for (const r of s.bracket.rounds) {
          const rr = el('div', 'adm-cup-round');
          const started = r.matches.some((m) => m.status === 'live' || m.status === 'final') && r.matches.some((m) => !m.bye);
          const top = el('div', 'adm-cup-roundhead');
          top.append(el('span', 'ffwb-strong', r.name + ', week ' + r.week));
          if (!started) {
            const push = el('button', 'pk-clear adm-small', 'Push back a week');
            push.type = 'button';
            push.title = 'Moves this round and every later one back one week';
            push.addEventListener('click', () => cupAction({ action: 'push-back', id: s.cup.id, round: r.index }, r.name + ' moved to week ' + (r.week + 1) + ', and later rounds moved with it.'));
            top.append(push);
          }
          rr.append(top);
          for (const m of r.matches) {
            if (m.bye || !m.a || !m.b) continue;
            const line = el('div', 'adm-cup-match' + (m.status === 'shootout' ? ' adm-cup-pk' : ''));
            line.append(el('span', null, m.a.name + ' v ' + m.b.name + (m.winner ? ': ' + (m.winner === m.a.id ? m.a.name : m.b.name) + ' through' : m.status === 'shootout' ? ': dead level. Who won the shootout?' : '')));
            const sel = el('select', 'ffwb-select adm-small');
            sel.append(new Option(m.status === 'shootout' ? 'Shootout winner...' : 'Decided by points', ''), new Option(m.a.name + (m.status === 'shootout' ? ' won it' : ' through'), m.a.id), new Option(m.b.name + (m.status === 'shootout' ? ' won it' : ' through'), m.b.id));
            sel.value = (s.cup.overrides || {})[m.key] || '';
            sel.setAttribute('aria-label', 'Winner of ' + m.a.name + ' v ' + m.b.name);
            sel.addEventListener('change', () => cupAction({ action: 'override', id: s.cup.id, key: m.key, winner: sel.value || null }, sel.value ? 'Winner set by you.' : 'Back to being decided by points.'));
            line.append(sel);
            rr.append(line);
          }
          card.append(rr);
        }
      } else {
        card.append(el('p', 'ffwb-note', 'Weeks ' + s.cup.weeks.join(', ') + '. Leader: ' + (s.mini.rows[0] ? s.mini.rows[0].name : 'nobody yet') + '.'));
        if (s.mini.shootout || (s.cup.overrides || {}).winner) {
          const line = el('div', 'adm-cup-match' + (s.mini.shootout ? ' adm-cup-pk' : ''));
          const tied = s.mini.shootout || s.mini.rows.slice(0, 2);
          line.append(el('span', null, s.mini.shootout ? listNames(tied.map((r) => r.name)) + ' are dead level. Who won the shootout?' : 'Winner set by you'));
          const sel = el('select', 'ffwb-select adm-small');
          sel.append(new Option('Shootout winner...', ''), ...s.mini.rows.filter((r) => tied.some((t) => t.id === r.id) || r.id === (s.cup.overrides || {}).winner).map((r) => new Option(r.name + ' won it', r.id)));
          sel.value = (s.cup.overrides || {}).winner || '';
          sel.addEventListener('change', () => cupAction({ action: 'override', id: s.cup.id, key: 'winner', winner: sel.value || null }, sel.value ? 'Shootout winner saved.' : 'Cleared.'));
          line.append(sel);
          card.append(line);
        }
      }
      const del = el('button', 'pk-clear adm-small adm-danger', 'Delete this cup');
      del.type = 'button';
      del.addEventListener('click', () => { if (confirm('Delete the ' + s.name + '? The draw, its weeks and any overrides go with it. Save weeks again to bring it back.')) cupAction({ action: 'delete', id: s.cup.id }, s.name + ' deleted.'); });
      card.append(del);
      return card;
    }));
  }

  // ---------- New season ----------
  const nsSeason = document.getElementById('ns-season');
  const nsClubs = document.getElementById('ns-clubs');
  const nsConfirm = document.getElementById('ns-confirm');
  const nsStart = document.getElementById('ns-start');
  const nsMsg = document.getElementById('ns-message');
  let nsReady = false;
  const nsList = () => [...new Set(nsClubs.value.split('\n').map((x) => x.trim()).filter(Boolean))];
  function nsCheck() {
    if (!season) return;
    const list = nsList();
    const out = season.config.clubs.filter((c) => !list.includes(c));
    const inn = list.filter((c) => !season.config.clubs.includes(c));
    document.getElementById('ns-clubs-note').textContent = list.length + ' clubs' + (list.length !== 20 ? ' (a season needs 20)' : '') + (out.length ? '. Out: ' + listNames(out) : '') + (inn.length ? '. In: ' + listNames(inn) : '') + '.';
    document.getElementById('ns-type').textContent = nsSeason.value.trim() || 'the season';
    nsStart.textContent = 'Start ' + (nsSeason.value.trim() || 'the new season');
    nsStart.disabled = list.length !== 20 || !nsSeason.value.trim() || nsConfirm.value.trim() !== nsSeason.value.trim();
  }
  async function renderNewSeason() {
    if (!season || nsReady) return;
    nsReady = true;
    const out = await adminPost('new-season', { action: 'preview' });
    if (!out.ok) return;
    nsSeason.value = out.next;
    nsClubs.value = out.clubs.join('\n');
    document.getElementById('ns-players').replaceChildren(...out.players.map((p) => {
      const l = el('label', 'adm-ns-player');
      const c = el('input'); c.type = 'checkbox'; c.checked = true; c.value = p.id;
      l.append(c, el('span', null, p.name));
      return l;
    }));
    nsCheck();
  }
  for (const n of [nsSeason, nsClubs, nsConfirm]) n.addEventListener('input', nsCheck);
  document.getElementById('ns-feed').addEventListener('click', async () => {
    say(nsMsg, 'info', 'Loading the Premier League clubs...');
    const out = await adminPost('new-season', { action: 'feed-clubs' });
    if (!out.ok) { say(nsMsg, 'bad', out.error); return; }
    nsClubs.value = out.clubs.join('\n');
    say(nsMsg, 'ok', 'Loaded ' + out.clubs.length + ' clubs. Check the names, then carry on.');
    nsCheck();
  });
  nsStart.addEventListener('click', async () => {
    const label = nsSeason.value.trim();
    const keep = [...document.querySelectorAll('#ns-players input:checked')].map((c) => c.value);
    if (!confirm('Start ' + label + '? This season moves into History and everyone starts again at week 1.')) return;
    nsStart.disabled = true;
    say(nsMsg, 'info', 'Saving a backup and starting ' + label + '...');
    const out = await adminPost('new-season', { action: 'start', season: label, clubs: nsList(), keep, confirm: nsConfirm.value.trim() });
    if (!out.ok) { say(nsMsg, 'bad', out.error); nsCheck(); return; }
    say(nsMsg, 'ok', label + ' is under way. ' + out.archived + ' is in History. Load the fixtures with Check for results now on the Results tab.');
    nsReady = false;
    nsConfirm.value = '';
    cw = null; resWeek = null;
    window.FFWB.reload();
    loadLog();
  });

  // ---------- Players ----------
  const playersMsg = document.getElementById('players-message');
  async function playerAction(body, done) {
    const out = await adminPost('players', body);
    if (out.ok) { say(playersMsg, 'ok', done); window.FFWB.reload(); } else say(playersMsg, 'bad', out.error);
    return out.ok;
  }
  function renderPlayers() {
    if (!season) return;
    const box = document.getElementById('players-list');
    if (box.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
    const rows = season.config.players.map((p) => {
      const row = el('div', 'adm-player');
      const input = el('input', 'adm-input adm-player-name');
      input.value = p.name; input.maxLength = 30; input.setAttribute('aria-label', 'Name for ' + p.name);
      const save = el('button', 'pk-clear adm-small', 'Rename');
      save.type = 'button';
      save.addEventListener('click', () => { if (input.value.trim() && input.value.trim() !== p.name) playerAction({ action: 'rename', id: p.id, name: input.value }, p.name + ' is now ' + input.value.trim() + '.'); });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save.click(); });
      const retire = el('button', 'pk-clear adm-small adm-danger', 'Retire');
      retire.type = 'button';
      retire.addEventListener('click', () => { if (confirm('Retire ' + p.name + '? They come off this season\'s table, and you can bring them back later.')) playerAction({ action: 'retire', id: p.id }, p.name + ' is retired.'); });
      row.append(input, save, retire);
      return row;
    });
    const retired = (season.config.retired || []);
    if (retired.length) {
      rows.push(el('h3', 'ffwb-h', 'Retired'));
      for (const p of retired) {
        const row = el('div', 'adm-player');
        row.append(el('span', 'adm-player-gone', p.name));
        const back = el('button', 'pk-clear adm-small', 'Bring back');
        back.type = 'button';
        back.addEventListener('click', () => playerAction({ action: 'restore', id: p.id }, p.name + ' is back.'));
        row.append(back);
        rows.push(row);
      }
    }
    box.replaceChildren(...rows);
  }
  document.getElementById('player-add').addEventListener('click', async () => {
    const input = document.getElementById('player-new');
    const name = input.value.trim();
    if (!name) { say(playersMsg, 'warn', 'Type a name first.'); return; }
    if (await playerAction({ action: 'add', name }, name + ' is in. They can pick from this week.')) input.value = '';
  });

  // ---------- Personal links ----------
  const linksMsg = document.getElementById('links-message');
  let links = [];
  const linkUrl = (p) => location.origin + '/?key=' + p.key;
  const shortDay = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  async function loadLinks(body = {}, done) {
    const out = await adminPost('keys', body);
    if (!out.ok) { say(linksMsg, 'bad', out.error); return; }
    links = out.players;
    if (done) say(linksMsg, 'ok', done);
    drawLinks();
  }
  async function copyText(text, done) {
    try { await navigator.clipboard.writeText(text); say(linksMsg, 'ok', done); } catch (err) { say(linksMsg, 'bad', 'Could not copy on this browser.'); }
  }
  function drawLinks() {
    const box = document.getElementById('links-list');
    if (box.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
    const n = links.filter((p) => p.locked).length;
    const head = el('p', 'ffwb-note adm-links-sum', n + ' of ' + links.length + ' players linked.');
    const rows = links.map((p) => {
      const row = el('div', 'adm-link' + (p.locked ? ' adm-link-on' : ''));
      const who = el('div', 'adm-link-who');
      who.append(el('span', 'ffwb-strong', p.name), el('span', 'ffwb-note', p.locked ? '\u{1F512} Linked ' + shortDay(p.linkedAt) + (p.lastSeen && p.lastSeen !== p.linkedAt ? ', last opened ' + shortDay(p.lastSeen) : '') : 'Not linked yet'));
      const acts = el('div', 'adm-link-acts');
      const copy = el('button', 'pk-save adm-small', 'Copy link');
      copy.type = 'button';
      copy.addEventListener('click', () => copyText('Your FFWB link. Open it on your phone (and your laptop if you pick from there) and keep it to yourself: ' + linkUrl(p), p.name + "'s link copied. Text it to them."));
      const note = 'Your FFWB link. Open it on your phone (and your laptop if you pick from there) and keep it to yourself: ' + linkUrl(p);
      const text = el('a', 'pk-clear adm-small', 'Text');
      text.href = 'sms:' + (p.phone || '') + '?&body=' + encodeURIComponent(note);
      text.title = p.phone ? 'Text ' + p.phone : 'Add a number under Contact to fill in who it goes to';
      const mail = el('a', 'pk-clear adm-small', 'Email');
      mail.href = 'mailto:' + encodeURIComponent(p.email || '') + '?subject=' + encodeURIComponent('Your FFWB link') + '&body=' + encodeURIComponent('Hi ' + p.name + ',\n\n' + note + '\n\nOnce you open it, only your own devices can change your picks.');
      mail.hidden = !p.email;
      const edit = el('button', 'pk-clear adm-small', 'Contact');
      edit.type = 'button';
      const form = el('div', 'adm-link-contact');
      form.hidden = true;
      const ph = el('input', 'adm-input'); ph.type = 'tel'; ph.placeholder = 'Mobile number'; ph.value = p.phone || ''; ph.setAttribute('aria-label', p.name + "'s mobile number");
      const em = el('input', 'adm-input'); em.type = 'email'; em.placeholder = 'Email'; em.value = p.email || ''; em.setAttribute('aria-label', p.name + "'s email");
      const keep = el('button', 'pk-save adm-small', 'Save');
      keep.type = 'button';
      keep.addEventListener('click', () => loadLinks({ action: 'contact', id: p.id, phone: ph.value, email: em.value }, p.name + "'s contact details are saved."));
      form.append(ph, em, keep);
      edit.addEventListener('click', () => { form.hidden = !form.hidden; if (!form.hidden) ph.focus(); });
      if (p.phone || p.email) who.append(el('span', 'ffwb-note', [p.phone, p.email].filter(Boolean).join(' \u00b7 ')));
      const reset = el('button', 'pk-clear adm-small adm-danger', 'Reset');
      reset.type = 'button';
      reset.title = 'Make a new link. The old one stops working, and so does every device that opened it.';
      reset.addEventListener('click', () => { if (confirm('Make a new link for ' + p.name + '? The old link stops working, and each of their devices needs the new one.')) loadLinks({ action: 'reset', id: p.id }, p.name + ' has a new link. Send it to them.'); });
      acts.append(copy, text, mail, edit, reset);
      if (p.locked) {
        const unlock = el('button', 'pk-clear adm-small', 'Unlock');
        unlock.type = 'button';
        unlock.title = 'Let them pick from any device again until they open their link.';
        unlock.addEventListener('click', () => { if (confirm('Unlock ' + p.name + '? Anyone could pick as them until they open their link again.')) loadLinks({ action: 'unlock', id: p.id }, p.name + ' is unlocked until they open their link again.'); });
        acts.append(unlock);
      }
      row.append(who, acts, form);
      return row;
    });
    box.replaceChildren(head, ...rows);
  }
  document.getElementById('links-copy-all').addEventListener('click', () => copyText(links.map((p) => p.name + (p.email ? ' <' + p.email + '>' : '') + ': ' + linkUrl(p)).join('\n'), 'All ' + links.length + ' links copied. Send each person only their own.'));

  // ---------- Shame Club ----------
  const shameList = document.getElementById('shame-list');
  function renderShame() {
    if (!season || document.activeElement === shameList) return;
    shameList.value = (season.config.shameClub || []).map((m) => m.name + (m.aka ? ' aka ' + m.aka : '') + (m.note ? ' (' + m.note + ')' : '')).join('\n');
  }
  document.getElementById('shame-save').addEventListener('click', async () => {
    const list = shameList.value.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
      const m = l.match(/^(.*?)\s*\((.*)\)\s*$/);
      const [who, note] = m ? [m[1].trim(), m[2].trim()] : [l, ''];
      const [name, aka] = who.split(/\s+aka\s+/i).map((x) => x.trim());
      return { name, ...(aka ? { aka } : {}), ...(note ? { note } : {}) };
    });
    const out = await adminPost('config', { shameClub: list });
    const msg = document.getElementById('shame-message');
    if (out.ok) { say(msg, 'ok', 'Saved ' + out.config.shameClub.length + ' members.'); window.FFWB.reload(); }
    else say(msg, 'bad', out.error);
  });

  // ---------- Backup ----------
  const download = (data, name) => {
    const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
  };
  // ---------- The Kitty ----------
  const mnMsg = document.getElementById('mn-message');
  let mnDirty = false;
  function renderMoney() {
    if (!season || !window.FFWBMoney || mnDirty) return;
    const st = window.FFWBMoney.settings(season);
    const set = (id, v) => { const n = document.getElementById(id); if (document.activeElement !== n) n.value = v; };
    set('mn-fund', st.fund); set('mn-greenout', st.greenout); set('mn-picks', st.picks); set('mn-missed', st.missed);
    set('mn-first', st.split.first); set('mn-second', st.split.second); set('mn-runner', st.split.runnerUp);
    const adj = season.config.moneyAdjust || {};
    const box = document.getElementById('mn-adjust');
    box.replaceChildren(...season.config.players.map((p) => {
      const row = el('div', 'adm-adjust-row');
      const amt = el('input', 'adm-input adm-num'); amt.type = 'number'; amt.step = '1'; amt.placeholder = '$0'; amt.dataset.id = p.id; amt.dataset.k = 'amount'; amt.value = adj[p.id] ? adj[p.id].amount : '';
      amt.setAttribute('aria-label', 'Adjustment for ' + p.name + ', in dollars, minus to take money off');
      const note = el('input', 'adm-input'); note.placeholder = 'Why (shown to everyone)'; note.maxLength = 120; note.dataset.id = p.id; note.dataset.k = 'note'; note.value = adj[p.id] ? adj[p.id].note : '';
      note.setAttribute('aria-label', 'Reason for ' + p.name + "'s adjustment");
      row.append(el('span', 'ffwb-strong', p.name), amt, note);
      return row;
    }));
  }
  document.getElementById('money-card').addEventListener('input', () => { mnDirty = true; });
  document.getElementById('mn-save').addEventListener('click', async () => {
    const v = (id) => Number(document.getElementById(id).value);
    const moneyAdjust = {};
    for (const n of document.querySelectorAll('#mn-adjust input[data-k="amount"]')) {
      const amount = Number(n.value);
      if (!n.value || !amount) continue;
      moneyAdjust[n.dataset.id] = { amount, note: document.querySelector('#mn-adjust input[data-k="note"][data-id="' + n.dataset.id + '"]').value.trim() };
    }
    const out = await adminPost('config', { money: { fund: v('mn-fund'), greenout: v('mn-greenout'), picks: v('mn-picks'), missed: v('mn-missed'), split: { first: v('mn-first'), second: v('mn-second'), runnerUp: v('mn-runner') } }, moneyAdjust });
    if (!out.ok) { say(mnMsg, 'bad', out.error); return; }
    mnDirty = false;
    const m = window.FFWBMoney.compute({ ...season, config: out.config });
    say(mnMsg, 'ok', 'Saved. The prize pot is ' + window.FFWBMoney.dollars(m.pot) + ' as it stands.');
    window.FFWB.reload();
  });

  // ---------- Site errors ----------
  const errMsg = document.getElementById('errors-message');
  async function loadErrors(body = {}) {
    const out = await adminPost('errors', body);
    if (!out.ok) { say(errMsg, 'bad', out.error); return; }
    errorCount = out.items.length;
    renderStatus();
    const box = document.getElementById('errors-list');
    const nameOf = (id) => ((season && season.config.players.find((p) => p.id === id)) || { name: id }).name;
    const device = (ua) => (/iPhone|iPad/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Other') + (/CriOS|Chrome/.test(ua) ? ', Chrome' : /Firefox|FxiOS/.test(ua) ? ', Firefox' : /Safari/.test(ua) ? ', Safari' : '');
    const when = (iso) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    if (!out.items.length) { box.replaceChildren(el('p', 'ffwb-note', 'No errors' + (out.clearedAt ? ' since you cleared the list on ' + when(out.clearedAt) : ' so far') + '.')); return; }
    box.replaceChildren(...out.items.map((x) => {
      const d = el('details', 'adm-error');
      const sum = el('summary');
      sum.append(el('span', 'adm-error-msg', x.message), el('span', 'ffwb-note', (x.count > 1 ? x.count + ' times, last ' : '') + when(x.last) + (x.player ? ' \u00b7 ' + nameOf(x.player) : '') + ' \u00b7 ' + device(x.ua || '')));
      const pre = el('pre', 'adm-error-stack', [x.source && 'At ' + x.source, x.page && 'Page ' + x.page, 'First seen ' + when(x.first), x.stack].filter(Boolean).join('\n'));
      d.append(sum, pre);
      return d;
    }));
  }
  document.getElementById('errors-refresh').addEventListener('click', () => loadErrors());
  document.getElementById('errors-clear').addEventListener('click', () => { if (confirm('Clear the error list?')) loadErrors({ action: 'clear' }).then(() => say(errMsg, 'ok', 'Cleared.')); });

  async function loadBackups() {
    const box = document.getElementById('backup-list');
    const out = await adminPost('backups', {});
    if (!out.ok) return;
    if (!out.backups.length) { box.replaceChildren(el('p', 'ffwb-note', 'No weekly backups yet. The first one is saved next Tuesday morning.')); return; }
    const list = el('div', 'adm-backup-list');
    for (const key of out.backups) {
      const b = el('button', 'pk-clear adm-backup', new Date(key.slice(8)).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }));
      b.type = 'button';
      b.title = 'Download this backup';
      b.addEventListener('click', async () => {
        const msg = document.getElementById('backup-message');
        const got = await adminPost('backup', { key });
        if (!got.ok) { say(msg, 'bad', got.error); return; }
        download(got, 'ffwb-backup-' + key.slice(8, 18) + '.json');
        say(msg, 'ok', 'Backup downloaded.');
      });
      list.append(b);
    }
    box.replaceChildren(el('h3', 'ffwb-h', 'Weekly backups'), list);
  }
  document.getElementById('backup').addEventListener('click', async () => {
    const msg = document.getElementById('backup-message');
    say(msg, 'info', 'Preparing...');
    const out = await adminPost('backup', {});
    if (!out.ok) { say(msg, 'bad', out.error); return; }
    download(out, 'ffwb-backup-' + out.exportedAt.slice(0, 10) + '.json');
    say(msg, 'ok', 'Backup downloaded.');
  });

  // ---------- Tabs, the status strip and info buttons ----------
  const tabs = [...document.querySelectorAll('.adm-nav [data-panel]')];
  function showPanel(id, remember = true) {
    if (!document.getElementById(id)) id = 'p-results';
    for (const t of tabs) { const on = t.dataset.panel === id; t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1; }
    for (const p of document.querySelectorAll('.adm-panel')) p.hidden = p.id !== id;
    if (remember) { try { sessionStorage.setItem('ffwb-adm-tab', id); history.replaceState(null, '', '#' + id.slice(2)); } catch (err) { /* nicety */ } }
    // Charts and tables drawn while hidden need a redraw.
    window.dispatchEvent(new Event('resize'));
  }
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => showPanel(t.dataset.panel));
    t.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      n.focus(); showPanel(n.dataset.panel);
    });
  });
  const fromHash = location.hash ? 'p-' + location.hash.slice(1) : null;
  let saved = null;
  try { saved = sessionStorage.getItem('ffwb-adm-tab'); } catch (err) { /* nicety */ }
  showPanel(fromHash && document.getElementById(fromHash) ? fromHash : saved || 'p-results', false);

  // Long explanations sit behind a small (i) button beside each heading.
  for (const note of document.querySelectorAll('.adm-panel .ffwb-card > p.ffwb-note')) {
    // The heading just above the note, or the one above the control that sits between them.
    let head = note.previousElementSibling;
    if (head && head.matches('.ffwb-cardhead')) head = head.querySelector('h2.ffwb-h');
    if (head && head.matches('label') && head.previousElementSibling && head.previousElementSibling.matches('h3.ffwb-h')) head = head.previousElementSibling;
    if (!head || !head.matches('h2.ffwb-h, h3.ffwb-h')) continue;
    note.hidden = true;
    const b = el('button', 'ffwb-info', 'i');
    b.type = 'button';
    b.setAttribute('aria-label', 'What is this?');
    b.setAttribute('aria-expanded', 'false');
    b.addEventListener('click', () => { note.hidden = !note.hidden; b.setAttribute('aria-expanded', String(!note.hidden)); });
    head.append(b);
  }

  let alertCount = null;
  let errorCount = null;
  function renderStatus() {
    if (!season) return;
    const box = document.getElementById('adm-status');
    const w = season.config.currentWeek;
    const picked = season.config.players.filter((p) => (season.picks[p.id] || {})[String(w)]).length;
    const res = season.results[String(w)] || {};
    const got = Object.keys(res).length;
    const open = season.openWeeks.includes(w);
    let cupText = 'None drawn';
    let cupSub = 'Draw one in Cups';
    let cupWarn = false;
    if (window.FFWBCups) {
      const live = (season.cups || []).map((c) => window.FFWBCups.state(season, c)).filter((s) => s.status !== 'done');
      const next = live.map((s) => {
        if (s.format === 'league') { const nw = s.cup.weeks.find((x) => x >= w) || s.cup.weeks[0]; return { s, week: nw, what: s.name }; }
        return s.current ? { s, week: s.current.week, what: s.name + ', ' + s.current.name.toLowerCase() } : null;
      }).filter(Boolean).sort((a, b) => a.week - b.week)[0];
      if (next) { cupText = next.what; cupSub = 'Week ' + next.week; }
      const pks = live.reduce((n, s) => n + (s.format === 'knockout' ? s.bracket.rounds.reduce((k, r) => k + r.matches.filter((m) => m.status === 'shootout').length, 0) : (s.mini.shootout ? 1 : 0)), 0);
      if (pks) { cupSub = pks + ' shootout' + (pks === 1 ? '' : 's') + ' to enter'; cupWarn = true; }
      else if ((season.cups || []).length) { cupText = 'All done'; cupSub = 'This season'; }
    }
    const chips = [
      { label: 'Week ' + w, value: open ? 'Open for picks' : 'Closed', sub: open ? 'Players can pick now' : 'Results are coming in', panel: 'p-weeks', tone: open ? 'ok' : '' },
      { label: 'Picks in', value: picked + ' of ' + season.config.players.length, sub: picked < season.config.players.length ? 'Send a reminder' : 'Everyone is in', panel: 'p-messages', tone: picked === season.config.players.length ? 'ok' : 'warn' },
      { label: 'Results', value: got + ' of ' + season.config.clubs.length, sub: got ? 'For week ' + w : 'Enter or check the feed', panel: 'p-results', tone: got === season.config.clubs.length ? 'ok' : '' },
      { label: 'Cups', value: cupText, sub: cupSub, panel: 'p-cups', tone: cupWarn ? 'warn' : '' },
      { label: 'Alerts', value: alertCount == null ? '-' : alertCount + ' phone' + (alertCount === 1 ? '' : 's'), sub: 'Send a message', panel: 'p-messages' },
      { label: 'Site errors', value: errorCount == null ? '-' : errorCount ? String(errorCount) : 'None', sub: errorCount ? 'Take a look' : 'All quiet', panel: 'p-house', tone: errorCount ? 'warn' : errorCount === 0 ? 'ok' : '' },
    ];
    box.replaceChildren(...chips.map((c) => {
      const b = el('button', 'adm-chip' + (c.tone ? ' adm-chip-' + c.tone : ''));
      b.type = 'button';
      b.append(el('span', 'adm-chip-label', c.label), el('span', 'adm-chip-value', c.value), el('span', 'adm-chip-sub', c.sub));
      b.addEventListener('click', () => showPanel(c.panel));
      return b;
    }));
  }

  // ---------- Season data ----------
  window.FFWB.onSeason((s) => {
    season = s;
    if (!s) return;
    if (!resDirty) { if (resWeek !== null) loadResults(); }
    renderWeeks();
    renderEfl();
    renderShame();
    renderPlayers();
    renderMoney();
    if (!app.hidden && passcode) loadLinks();
    renderNewSeason();
    renderCups();
    renderStatus();
    renderResults();
    picksEditor.setSeason(s);
  });

  if (passcode) tryPass(passcode); else showGate();
})();
