// FFWB player profiles from any name: tap a player's name in a table, the bracket, the Shame Club or the
// trophy shelf, and their player card opens in the sheet.
(function () {
  const SPOTS = [
    '.ffwb-table td.ffwb-strong', '.cb-name', '.sh-name', '.ffwb-shelf-name', '.ffwb-award-name', '.ffwb-crown-who', '.cb-table td.ffwb-strong',
  ].join(', ');
  const names = () => {
    const s = window.FFWB && window.FFWB.season;
    const fromCards = (window.dash && window.dash.data('player_cards').data) || [];
    return new Set([...(s ? s.config.players.map((p) => p.name) : []), ...fromCards.map((c) => c.player)]);
  };
  const nameOf = (node) => {
    const t = (node.firstChild && node.firstChild.nodeType === 3 ? node.firstChild.textContent : node.textContent).split(',')[0].trim();
    return t;
  };
  function open(name) {
    const sel = document.getElementById('player-pills');
    if (!sel || !window.FFWBExplore) return;
    if (![...sel.options].some((o) => o.value === name)) return;
    sel.value = name;
    if (sel.onchange) sel.onchange();
    window.FFWBExplore.open('player-section');
    const t = document.getElementById('xp-title');
    if (t) t.textContent = name;
    const k = document.getElementById('xp-kicker');
    if (k) k.textContent = 'Player card';
  }
  let timer = null;
  function mark() {
    const known = names();
    if (!known.size) return;
    for (const node of document.querySelectorAll(SPOTS)) {
      if (node.closest('#player-section')) continue;
      const n = nameOf(node);
      const ok = known.has(n);
      node.classList.toggle('pp-link', ok);
      if (ok) { node.tabIndex = 0; node.setAttribute('role', 'button'); node.dataset.player = n; node.title = 'Open ' + n + "'s player card"; }
    }
  }
  const soon = () => { clearTimeout(timer); timer = setTimeout(mark, 120); };
  new MutationObserver(soon).observe(document.body, { childList: true, subtree: true });
  document.addEventListener('click', (e) => {
    const node = e.target.closest && e.target.closest('.pp-link');
    if (!node || !node.dataset.player) return;
    e.preventDefault();
    open(node.dataset.player);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const node = e.target.closest && e.target.closest('.pp-link');
    if (node && node.dataset.player) { e.preventDefault(); open(node.dataset.player); }
  });
  window.FFWBProfile = { open };
})();
