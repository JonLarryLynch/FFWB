// Football FWB page layout: the History switch, foldable sections, info buttons and old links.
(function () {
  const redraw = () => window.dispatchEvent(new Event('resize'));

  // History: All-time, Record book and Past seasons share one tab.
  const subs = [...document.querySelectorAll('.ffwb-subtabs [data-sub]')];
  function showSub(name) {
    for (const b of subs) b.setAttribute('aria-pressed', String(b.dataset.sub === name));
    for (const s of document.querySelectorAll('.ffwb-sub')) s.hidden = s.id !== name;
    redraw();
  }
  for (const b of subs) b.addEventListener('click', () => { showSub(b.dataset.sub); window.dash.setLink(b.dataset.sub); });

  // Charts drawn while folded away have no width, so draw again when a section opens.
  document.addEventListener('toggle', (e) => { if (e.target.tagName === 'DETAILS' && e.target.open) redraw(); }, true);

  // Each card's explanation sits behind a small (i) button beside its heading.
  for (const note of document.querySelectorAll('.ffwb-card > p.ffwb-note:first-of-type')) {
    const card = note.parentElement;
    const head = card.querySelector(':scope > .ffwb-h, :scope > summary.ffwb-h');
    if (!head || head.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_PRECEDING) continue;
    note.hidden = true;
    note.classList.add('ffwb-info-text');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ffwb-info';
    b.textContent = 'i';
    b.setAttribute('aria-label', 'What is this?');
    b.setAttribute('aria-expanded', 'false');
    b.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      note.hidden = !note.hidden;
      b.setAttribute('aria-expanded', String(!note.hidden));
      if (!note.hidden && head.tagName === 'SUMMARY') head.parentElement.open = true;
    });
    head.append(b);
  }

  // On a phone, a one-time tip on adding the site to the home screen, until it is dismissed or done.
  (function homeTip() {
    const standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone;
    let dismissed = false;
    try { dismissed = localStorage.getItem('ffwb-home-tip') === 'no'; } catch (err) { /* show it */ }
    if (standalone || dismissed || !(window.matchMedia && matchMedia('(max-width: 640px)').matches)) return;
    const footer = document.querySelector('.ffwb-footer');
    if (!footer) return;
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const tip = document.createElement('div');
    tip.className = 'ffwb-hometip';
    const text = document.createElement('span');
    text.textContent = ios
      ? 'Add FWB to your home screen: tap Share, then Add to Home Screen.'
      : 'Add FWB to your home screen: open the browser menu, then Add to Home screen.';
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Got it';
    close.addEventListener('click', () => { tip.remove(); try { localStorage.setItem('ffwb-home-tip', 'no'); } catch (err) { /* fine */ } });
    tip.append(text, close);
    footer.before(tip);
  })();

  // Links from the old layout, like #records, still land in the right place.
  const OLD = { season: 'table', awards: 'stats', players: 'stats', alltime: 'history', records: 'history', archive: 'history' };
  const asked = location.hash.slice(1);
  if (OLD[asked]) {
    const tab = document.getElementById('tab-' + OLD[asked]);
    if (tab) tab.click();
    if (OLD[asked] === 'history') showSub(asked === 'history' ? 'alltime' : asked);
  }
})();
