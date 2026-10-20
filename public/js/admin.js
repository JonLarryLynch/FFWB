// Football FWB commissioner page: results, weeks, anyone's picks, the change log and backups.
(function () {
  const R = window.FFWBRules;
  const { PicksEditor, resultCode } = window.FFWBPicks;
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
    closedBox.replaceChildren(...Array.from({ length: R.WEEKS }, (_, i) => i + 1).map((w) => {
      const hasResults = Object.keys(season.results[String(w)] || {}).length > 0;
      const b = el('button', 'pk-weekdot' + (locked.has(w) ? ' pk-weekdot-locked' : hasResults ? ' pk-weekdot-done' : w < season.config.currentWeek ? ' pk-weekdot-past' : ''), String(w));
      b.type = 'button';
      b.setAttribute('aria-pressed', String(locked.has(w)));
      b.title = locked.has(w) ? 'Closed by you. Click to reopen.' : hasResults ? 'Results are in, so this week is closed.' : 'Click to close this week to picks.';
      b.addEventListener('click', async () => {
        const next = new Set(locked);
        if (next.has(w)) next.delete(w); else next.add(w);
        const out = await adminPost('config', { lockedWeeks: [...next] });
        if (out.ok) { say(cwMsg, 'ok', next.has(w) ? 'Week ' + w + ' is closed to picks.' : 'Week ' + w + ' is open again, unless its results are in or it is before the current week.'); window.FFWB.reload(); }
        else say(cwMsg, 'bad', out.error);
      });
      return b;
    }));
  }
  document.getElementById('cw-down').addEventListener('click', () => { if (cw > 1) { cw -= 1; renderWeeks(); } });
  document.getElementById('cw-up').addEventListener('click', () => { if (cw < R.WEEKS) { cw += 1; renderWeeks(); } });
  document.getElementById('cw-save').addEventListener('click', async () => {
    const out = await adminPost('config', { currentWeek: cw });
    if (out.ok) { say(cwMsg, 'ok', 'The current week is now week ' + out.config.currentWeek + '. Players can pick that week and any later one.'); window.FFWB.reload(); }
    else say(cwMsg, 'bad', out.error);
  });

  // ---------- Results ----------
  const resWeekName = document.getElementById('res-week');
  const resGrid = document.getElementById('res-grid');
  const resMsg = document.getElementById('res-message');
  const CHOICES = [[1, 'W', 'Won'], [0.5, 'D', 'Drew'], [0, 'L', 'Lost'], ['P', 'P', 'Postponed']];
  let resWeek = null;
  let draft = {};
  let resDirty = false;
  function loadResults() {
    draft = { ...(season.results[String(resWeek)] || {}) };
    resDirty = false;
  }
  function renderResults() {
    if (!season) return;
    if (resWeek === null) {
      resWeek = season.config.currentWeek;
      loadResults();
    }
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
      name.append(el('span', 'ffwb-strong', club), el('span', 'ffwb-muted res-picked', picked[club] ? ' · picked by ' + picked[club] : ''));
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
    const n = Object.keys(draft).length;
    const saveBtn = document.getElementById('res-save');
    saveBtn.disabled = !resDirty;
    if (resDirty) say(resMsg, 'warn', n + ' of ' + season.config.clubs.length + ' results set. Not saved yet.');
    else if (!resMsg.dataset.keep) say(resMsg, 'info', n ? n + ' of ' + season.config.clubs.length + ' results saved for week ' + resWeek + '.' : 'No results entered for week ' + resWeek + ' yet.');
    delete resMsg.dataset.keep;
  }
  document.getElementById('res-prev').addEventListener('click', () => { if (resWeek > 1) { resWeek -= 1; loadResults(); renderResults(); } });
  document.getElementById('res-next').addEventListener('click', () => { if (resWeek < R.WEEKS) { resWeek += 1; loadResults(); renderResults(); } });
  document.getElementById('res-all-l').addEventListener('click', () => {
    for (const c of season.config.clubs) if (draft[c] === undefined) draft[c] = 0;
    resDirty = true;
    renderResults();
  });
  document.getElementById('res-save').addEventListener('click', async () => {
    say(resMsg, 'info', 'Saving...');
    const out = await adminPost('results', { week: resWeek, results: draft });
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

  // ---------- Backup ----------
  document.getElementById('backup').addEventListener('click', async () => {
    const msg = document.getElementById('backup-message');
    say(msg, 'info', 'Preparing...');
    const out = await adminPost('backup', {});
    if (!out.ok) { say(msg, 'bad', out.error); return; }
    const blob = new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'ffwb-backup-' + out.exportedAt.slice(0, 10) + '.json';
    document.body.append(a);
    a.click();
    a.remove();
    say(msg, 'ok', 'Backup downloaded.');
  });

  // ---------- Season data ----------
  window.FFWB.onSeason((s) => {
    season = s;
    if (!s) return;
    if (!resDirty) { if (resWeek !== null) loadResults(); }
    renderWeeks();
    renderResults();
    picksEditor.setSeason(s);
  });

  if (passcode) tryPass(passcode); else showGate();
})();
