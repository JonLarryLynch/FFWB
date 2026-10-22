// FFWB "What's new": shows the newest release notes once on each phone, from the footer link at any time,
// and straight away when someone taps the release alert (the alert opens /?whatsnew=1).
(function () {
  const list = window.FFWB_RELEASES || [];
  const pop = document.getElementById('whatsnew-pop');
  if (!list.length || !pop) return;
  const KEY = 'ffwb-seen-release';
  const store = {
    get() { try { return localStorage.getItem(KEY); } catch (err) { return null; } },
    set(v) { try { localStorage.setItem(KEY, v); } catch (err) { /* fine */ } },
  };
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

  function draw(index) {
    const r = list[index];
    const card = el('div', 'wn-card');
    const head = el('header', 'wn-head');
    const t = el('div');
    t.append(el('div', 'wn-kicker', 'What’s new · ' + r.date), el('h2', 'wn-title', r.title));
    t.querySelector('h2').id = 'whatsnew-title';
    const close = el('button', 'xp-close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', () => pop.close());
    head.append(t, close);
    const body = el('div', 'wn-body');
    for (const s of r.sections) {
      body.append(el('h3', 'wn-sec', s.name));
      const ul = el('ul', 'wn-list');
      for (const [name, text] of s.items) {
        const li = el('li');
        li.append(el('strong', null, name), el('span', null, text));
        ul.append(li);
      }
      body.append(ul);
    }
    const foot = el('footer', 'wn-foot');
    if (index + 1 < list.length) {
      const older = el('button', 'pk-clear', 'Earlier updates');
      older.type = 'button';
      older.addEventListener('click', () => draw(index + 1));
      foot.append(older);
    }
    const ok = el('button', 'pk-save', 'Got it');
    ok.type = 'button';
    ok.addEventListener('click', () => pop.close());
    foot.append(ok);
    card.append(head, body, foot);
    pop.replaceChildren(card);
    pop.scrollTop = 0;
  }

  function open() {
    draw(0);
    store.set(list[0].id);
    if (!pop.open) pop.showModal();
  }

  pop.addEventListener('click', (e) => { if (e.target === pop) pop.close(); });
  const link = document.getElementById('whatsnew-link');
  if (link) link.addEventListener('click', open);

  const forced = /[?&]whatsnew=1\b/.test(location.search);
  if (forced) history.replaceState(null, '', location.pathname + location.hash);
  // Wait for the page to settle, and step aside if another pop-up (a cup week, say) got there first.
  let tries = 0;
  // Start once the page has settled, behind any pop-up already up (a cup week, say).
  setTimeout(function wait() {
    if (!forced && store.get() === list[0].id) return;
    if (document.querySelector('dialog[open]') && tries < 20) { tries += 1; setTimeout(wait, 1500); return; }
    if (document.querySelector('dialog[open]')) return;
    open();
  }, 1200);
  window.FFWBWhatsNew = { open };
})();
