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
      const hasResults = Object.keys(season.results[String(w)] || {}).length > 0;
      const kicked = kickedOff(season, w);
      const cls = locked.has(w) ? ' pk-weekdot-locked' : hasResults ? ' pk-weekdot-done' : kicked ? ' pk-weekdot-kicked' : reopened.has(w) && started(w) ? ' pk-weekdot-reopened' : w < season.config.currentWeek ? ' pk-weekdot-past' : '';
      const b = el('button', 'pk-weekdot' + cls, String(w));
      b.type = 'button';
      b.setAttribute('aria-pressed', String(locked.has(w)));
      const ko = fx(w).kickoff ? ' First kickoff ' + whenLong(fx(w).kickoff) + '.' : '';
      b.title = (locked.has(w) ? 'Closed by you. Click to reopen.' : hasResults ? 'Results are in, so this week is closed.'
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
    for (const h of ['When', 'What', 'Week', 'By', 'Changed to']) hr.append(el('th', null, h));
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
  async function copy(id, what) {
    const box = document.getElementById(id);
    try { await navigator.clipboard.writeText(box.value); }
    catch (err) { box.select(); document.execCommand('copy'); }
    say(chatMsg, 'ok', what + ' copied. Paste it in the group chat.');
  }
  async function loadPush() {
    const out = await adminPost('push', {});
    if (!out.ok) return;
    const who = document.getElementById('push-who');
    who.textContent = (out.count ? out.count + ' phone' + (out.count === 1 ? ' has' : 's have') + ' alerts on (' + listNames(out.who) + '). ' : 'Nobody has turned alerts on yet. ')
      + 'Players turn them on from the Picks tab. The site sends one when a week opens, and reminds anyone who has not picked about a day and three hours before kickoff.';
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
  document.getElementById('nudge-copy').addEventListener('click', () => copy('nudge-text', 'Reminder'));
  document.getElementById('recap-copy').addEventListener('click', () => copy('recap-text', 'Recap'));

  // ---------- Cups ----------
  const Cups = window.FFWBCups;
  const cupMsg = document.getElementById('cup-message');
  const cupType = document.getElementById('cup-type');
  const cupFirst = document.getElementById('cup-first');
  const cupLength = document.getElementById('cup-length');
  const cupMake = document.getElementById('cup-make');
  const cupPlan = document.getElementById('cup-plan');
  const cupBody = () => ({ type: cupType.value, firstWeek: Number(cupFirst.value), length: Number(cupLength.value) });
  cupType.addEventListener('change', () => { document.getElementById('cup-length-wrap').hidden = cupType.value !== 'festive'; cupMake.disabled = true; cupPlan.replaceChildren(); });
  cupFirst.addEventListener('input', () => { cupMake.disabled = true; cupPlan.replaceChildren(); });
  document.getElementById('cup-preview').addEventListener('click', async () => {
    const out = await adminPost('cups', { action: 'preview', ...cupBody() });
    if (!out.ok) { say(cupMsg, 'bad', out.error); cupMake.disabled = true; return; }
    const t = Cups.TYPES[cupType.value];
    const box = el('div', 'adm-cupplan');
    box.append(el('p', 'ffwb-strong', t.name + ': weeks ' + out.weeks.join(', ')));
    if (t.format === 'knockout') {
      const order = Cups.seedOrder(2 ** Cups.roundsFor(out.seeds.length));
      const list = el('ol', 'adm-pairs');
      for (let i = 0; i < order.length; i += 2) {
        const a = out.seeds[order[i] - 1];
        const b = out.seeds[order[i + 1] - 1];
        list.append(el('li', null, a && b ? '(' + order[i] + ') ' + a + ' v ' + b + ' (' + order[i + 1] + ')' : '(' + (a ? order[i] : order[i + 1]) + ') ' + (a || b) + ', bye'));
      }
      box.append(el('p', 'ffwb-note', 'First round, week ' + out.weeks[0] + ', seeded from the table as it stands before then:'), list);
    } else {
      box.append(el('p', 'ffwb-note', 'All ' + out.seeds.length + ' players, most points over those weeks wins.'));
    }
    cupPlan.replaceChildren(box);
    cupMake.disabled = false;
    say(cupMsg, 'info', 'Happy with that? Make the draw to lock it in and tell everyone.');
  });
  cupMake.addEventListener('click', async () => {
    cupMake.disabled = true;
    const out = await adminPost('cups', { action: 'create', ...cupBody() });
    if (!out.ok) { say(cupMsg, 'bad', out.error); return; }
    cupPlan.replaceChildren();
    say(cupMsg, 'ok', 'The draw is made. Everyone with alerts on has been told who they play.');
    window.FFWB.reload();
  });
  async function cupAction(body, done) {
    const out = await adminPost('cups', body);
    if (out.ok) { say(cupMsg, 'ok', done); window.FFWB.reload(); } else say(cupMsg, 'bad', out.error);
  }
  function renderCups() {
    if (!season || !Cups) return;
    if (!cupFirst.value) cupFirst.value = season.config.currentWeek;
    const box = document.getElementById('cup-list');
    const list = (season.cups || []).map((c) => Cups.state(season, c));
    if (!list.length) { box.replaceChildren(el('p', 'ffwb-note', 'No cups drawn this season yet.')); return; }
    box.replaceChildren(...list.map((s) => {
      const card = el('div', 'adm-cup');
      const head = el('div', 'adm-cup-head');
      head.append(el('b', null, s.name), el('span', 'ffwb-muted', s.status === 'done' ? 'Won by ' + s.champion.name : s.status === 'live' ? 'Being played' : 'Drawn, starts week ' + s.cup.weeks[0]));
      card.append(head);
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
            const line = el('div', 'adm-cup-match');
            line.append(el('span', null, m.a.name + ' v ' + m.b.name + (m.winner ? ': ' + (m.winner === m.a.id ? m.a.name : m.b.name) + ' through' : '')));
            const sel = el('select', 'ffwb-select adm-small');
            sel.append(new Option('Decided by points', ''), new Option(m.a.name + ' through', m.a.id), new Option(m.b.name + ' through', m.b.id));
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
      }
      const del = el('button', 'pk-clear adm-small adm-danger', 'Delete this cup');
      del.type = 'button';
      del.addEventListener('click', () => { if (confirm('Delete the ' + s.name + '? The draw and any overrides go with it.')) cupAction({ action: 'delete', id: s.cup.id }, s.name + ' deleted.'); });
      card.append(del);
      return card;
    }));
  }

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

  // ---------- Season data ----------
  window.FFWB.onSeason((s) => {
    season = s;
    if (!s) return;
    if (!resDirty) { if (resWeek !== null) loadResults(); }
    renderWeeks();
    renderEfl();
    renderShame();
    renderCups();
    renderResults();
    picksEditor.setSeason(s);
  });

  if (passcode) tryPass(passcode); else showGate();
})();
