// FFWB tooltips, following the usual rules: with a mouse, a short pause before the first one shows, then they
// follow instantly from item to item until you leave; on keyboard focus straight away; on a phone a long press.
// Escape, scrolling or moving away hides them. Content is built fresh each time, so it is never stale.
(function () {
  const DELAY = 500;      // before the first tooltip shows
  const WARM = 400;       // after one hides, the next shows without waiting for this long
  const PRESS = 450;      // a long press on a touch screen
  let tip = null;
  let timer = null;
  let lastHide = 0;
  let current = null;
  function el() {
    if (tip) return tip;
    tip = document.createElement('div');
    tip.className = 'ff-tip';
    tip.id = 'ff-tip';
    tip.setAttribute('role', 'tooltip');
    tip.hidden = true;
    document.body.append(tip);
    return tip;
  }
  function place(target) {
    const t = el();
    const r = target.getBoundingClientRect();
    t.style.left = '0px'; t.style.top = '0px';
    const w = t.offsetWidth;
    const h = t.offsetHeight;
    const pad = 8;
    let left = r.left + r.width / 2 - w / 2;
    left = Math.max(pad, Math.min(left, window.innerWidth - w - pad));
    let top = r.top - h - 8;
    let below = false;
    if (top < pad) { top = r.bottom + 8; below = true; }
    t.style.left = Math.round(left + window.scrollX) + 'px';
    t.style.top = Math.round(top + window.scrollY) + 'px';
    t.classList.toggle('ff-tip-below', below);
    t.style.setProperty('--arrow', Math.round(r.left + r.width / 2 - left) + 'px');
  }
  function show(target, build) {
    clearTimeout(timer);
    const t = el();
    const content = build(target);
    if (!content) { hide(); return; }
    t.replaceChildren(content);
    t.hidden = false;
    current = target;
    target.setAttribute('aria-describedby', 'ff-tip');
    place(target);
    requestAnimationFrame(() => t.classList.add('ff-tip-on'));
  }
  function hide() {
    clearTimeout(timer);
    if (!tip || tip.hidden) return;
    tip.classList.remove('ff-tip-on');
    tip.hidden = true;
    if (current) current.removeAttribute('aria-describedby');
    current = null;
    lastHide = Date.now();
  }
  // Attach to every element matching `selector` inside `root`; build(target) returns the tooltip's content.
  function attach(root, selector, build) {
    const find = (e) => e.target.closest && e.target.closest(selector);
    root.addEventListener('pointerover', (e) => {
      if (e.pointerType === 'touch') return;
      const target = find(e);
      if (!target || target === current) return;
      clearTimeout(timer);
      const warm = (current && tip && !tip.hidden) || Date.now() - lastHide < WARM;
      if (warm) show(target, build); else timer = setTimeout(() => show(target, build), DELAY);
    });
    root.addEventListener('pointerout', (e) => {
      if (e.pointerType === 'touch') return;
      const target = find(e);
      if (!target || (e.relatedTarget && target.contains(e.relatedTarget))) return;
      hide();
    });
    root.addEventListener('focusin', (e) => { const target = find(e); if (target && target.matches(':focus-visible')) show(target, build); });
    root.addEventListener('focusout', hide);
    // Long press on a touch screen shows it, and that press does not count as a tap.
    let pressed = null;
    root.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') { hide(); return; }
      const target = find(e);
      if (!target) return;
      pressed = { target, x: e.clientX, y: e.clientY, shown: false };
      clearTimeout(timer);
      timer = setTimeout(() => { if (pressed) { pressed.shown = true; show(target, build); } }, PRESS);
    });
    root.addEventListener('pointermove', (e) => { if (pressed && Math.hypot(e.clientX - pressed.x, e.clientY - pressed.y) > 10) { clearTimeout(timer); pressed = null; } });
    root.addEventListener('pointerup', () => { if (pressed && !pressed.shown) clearTimeout(timer); });
    root.addEventListener('click', (e) => { if (pressed && pressed.shown) { e.preventDefault(); e.stopPropagation(); } pressed = null; }, true);
    root.addEventListener('contextmenu', (e) => { if (find(e)) e.preventDefault(); });
    root.addEventListener('scroll', hide, { passive: true });
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });
  window.addEventListener('scroll', hide, { passive: true });
  window.addEventListener('resize', hide);
  document.addEventListener('pointerdown', (e) => { if (tip && !tip.hidden && e.pointerType === 'touch' && !(current && current.contains(e.target))) hide(); }, true);
  window.FFWBTip = { attach, hide };
})();
