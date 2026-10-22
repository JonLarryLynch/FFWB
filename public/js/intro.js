// FFWB "How to play": three quick cards, opened from the link at the bottom of every page. How picks and locks
// work, the 3-per-half rule and The Map, and alerts. It never pops up on its own.
(function () {
  const pop = document.getElementById('intro-pop');
  if (!pop) return;
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (err) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (err) { /* fine */ } },
    del(k) { try { localStorage.removeItem(k); } catch (err) { /* fine */ } },
  };
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

  // A little picture for each card, built from the site's own pieces.
  function trayArt() {
    const row = el('div', 'in-tray');
    for (const c of ['ARS', 'LIV', 'NEW', 'BHA']) row.append(el('span', 'in-slot', c));
    row.append(el('span', 'in-slot in-lock', '\u{1F512} MCI'));
    return row;
  }
  function mapArt() {
    const g = el('div', 'in-map');
    const cells = ['', 'W9', 'W10', 'W11', 'EVE', '✓', '', '✓', 'FUL', '', '✓', '', 'WOL', '✓', '', ''];
    cells.forEach((t, i) => g.append(el('span', 'in-cell' + (i < 4 ? ' in-head' : i % 4 === 0 ? ' in-club' : t ? ' in-on' : ''), t)));
    return g;
  }
  function alertArt() {
    const n = el('div', 'in-note');
    n.append(el('img', 'in-note-icon'), el('div'));
    n.firstChild.src = '/icons/icon-192.png';
    n.firstChild.alt = '';
    n.lastChild.append(el('strong', null, 'Week 9 picks'), el('span', null, "Kicks off Sat 6:30 AM CT. You haven't picked yet."));
    return n;
  }

  const CARDS = [
    { art: trayArt, kicker: '1 of 3', title: 'Pick four, lock one', text: 'Each week, pick 4 clubs plus a lock. A win is 1 point, a draw a half, and your lock counts double. Tap clubs to fill your tray, then tap a pick to make it your lock. Nobody sees your picks until the first kickoff.' },
    { art: mapArt, kicker: '2 of 3', title: 'Three of every club, every half', text: 'Every club needs 3 of your picks each half, and no club can be your lock more than 4 times a half. The Map on the Picks tab shows what you still owe, and you can tick squares to plan ahead.' },
    { art: alertArt, kicker: '3 of 3', title: 'Never miss a week', text: 'Tap the bell at the top for phone alerts: when a week opens, a reminder if you have not picked, and the reveal at kickoff. Add the site to your home screen and it works like an app.' },
  ];

  let i = 0;
  function draw() {
    const c = CARDS[i];
    const card = el('div', 'in-card');
    const art = el('div', 'in-art');
    art.append(c.art());
    const x = el('button', 'xp-close in-x', '×');
    x.type = 'button';
    x.setAttribute('aria-label', 'Skip the intro');
    x.addEventListener('click', done);
    const body = el('div', 'in-body');
    const h = el('h2', 'in-title', c.title);
    h.id = 'intro-title';
    body.append(el('div', 'in-kicker', c.kicker), h, el('p', 'in-text', c.text));
    const dots = el('div', 'in-dots');
    CARDS.forEach((_, k) => dots.append(el('span', 'in-dot' + (k === i ? ' in-dot-on' : ''))));
    const foot = el('div', 'in-foot');
    const back = el('button', 'pk-clear', i ? 'Back' : 'Skip');
    back.type = 'button';
    back.addEventListener('click', () => { if (i) { i -= 1; draw(); } else done(); });
    const last = i === CARDS.length - 1;
    const nextB = el('button', 'pk-save', last ? "Let's go" : 'Next');
    nextB.type = 'button';
    nextB.addEventListener('click', () => { if (last) done(); else { i += 1; draw(); } });
    foot.append(back, dots, nextB);
    if (last) {
      const bell = document.getElementById('alerts-bell');
      if (bell && !bell.hidden) {
        const on = el('button', 'pk-clear in-bell', 'Turn on alerts');
        on.type = 'button';
        on.addEventListener('click', () => { done(); setTimeout(() => bell.click(), 200); });
        body.append(on);
      }
    }
    card.append(x, art, body, foot);
    pop.replaceChildren(card);
    nextB.focus();
  }
  function done() {
    pop.close();
  }
  function open() { i = 0; draw(); if (!pop.open) pop.showModal(); }

  // Swipe between cards.
  let sx = null;
  pop.addEventListener('pointerdown', (e) => { sx = e.clientX; });
  pop.addEventListener('pointerup', (e) => {
    if (sx == null) return;
    const dx = e.clientX - sx;
    sx = null;
    if (Math.abs(dx) < 50) return;
    if (dx < 0 && i < CARDS.length - 1) { i += 1; draw(); } else if (dx > 0 && i > 0) { i -= 1; draw(); }
  });
  const link = document.getElementById('intro-link');
  if (link) link.addEventListener('click', open);

  window.FFWBIntro = { open };
})();
