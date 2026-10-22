// FFWB reveal: picks are secret until a week's first kickoff. Once it kicks off, the first visit (or a tap on
// the "Picks are in" alert, which opens /?reveal=<week>) shows what everyone picked: the most-picked clubs, the
// people's lock, who went against the crowd, and anyone who just joined the Shame Club. Once per week per phone.
(function () {
  const pop = document.getElementById('reveal-pop');
  const A = window.FFWBAwards;
  if (!pop || !A) return;
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (err) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (err) { /* fine */ } },
  };
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const list = (l) => (l.length > 2 ? l.slice(0, -1).join(', ') + ' and ' + l[l.length - 1] : l.join(' and '));
  const asked = Number(new URLSearchParams(location.search).get('reveal')) || null;
  if (asked) history.replaceState(null, '', location.pathname + location.hash);
  let season = null;
  let forced = asked;

  // A week's picks are out once it has kicked off and nothing is held back any more.
  function isOut(s, w) {
    if (((s.hiddenPicked || {})[String(w)] || []).length) return false;
    if (Object.keys(s.results[String(w)] || {}).length) return true;
    const ko = ((s.fixtures || {})[String(w)] || {}).kickoff;
    return !!ko && Date.now() >= Date.parse(ko);
  }
  const seenKey = (s, w) => 'ffwb-reveal-' + s.config.season + '-' + w;

  function section(title, body) {
    const sec = el('section', 'rv-sec');
    sec.append(el('h3', 'rv-h', title), body);
    return sec;
  }

  function draw(s, w) {
    const r = A.reveal(s, w, window.FFWBShame ? window.FFWBShame.pairsIn : null);
    if (!r) return false;
    const me = store.get('ffwb-player');
    const card = el('div', 'rv-card');
    const head = el('header', 'rv-head');
    const t = el('div');
    t.append(el('div', 'rv-kicker', 'Week ' + w + ' · The reveal'), el('h2', 'rv-title', 'Picks are in'), el('p', 'rv-sub', r.players + ' of ' + r.of + ' picked this week.'));
    t.querySelector('h2').id = 'reveal-title';
    const x = el('button', 'xp-close', '×');
    x.type = 'button';
    x.setAttribute('aria-label', 'Close');
    x.addEventListener('click', () => pop.close());
    head.append(t, x);
    const body = el('div', 'rv-body');

    // The people's lock.
    if (r.locks.length) {
      const top = r.locks[0];
      const box = el('div', 'rv-lock');
      box.append(el('span', 'rv-lock-icon', '\u{1F512}'), el('span', 'rv-lock-club', top.club), el('span', 'rv-lock-n', top.n + ' of ' + r.players + ' locked them'));
      const others = r.locks.slice(1, 4).map((l) => l.club + ' ' + l.n);
      if (others.length) box.append(el('span', 'rv-lock-more', 'Then ' + others.join(', ')));
      body.append(section("The people's lock", box));
    }

    // Most-picked clubs, as bars.
    const bars = el('ol', 'rv-bars');
    for (const c of r.clubs.slice(0, 6)) {
      const li = el('li', 'rv-bar');
      const fill = el('span', 'rv-bar-fill');
      fill.style.setProperty('--w', Math.round((c.n / r.players) * 100) + '%');
      li.append(el('span', 'rv-bar-club', c.club), el('span', 'rv-bar-track', null), el('span', 'rv-bar-n', String(c.n)));
      li.children[1].append(fill);
      li.title = c.who.join(', ');
      bars.append(li);
    }
    const most = el('div');
    most.append(bars);
    if (r.unanimous.length) most.append(el('p', 'rv-note', 'Everyone has ' + list(r.unanimous) + '.'));
    body.append(section('Most picked', most));

    // Against the crowd.
    if (r.contrarians.length) {
      const ul = el('ul', 'rv-list');
      for (const c of r.contrarians) {
        const li = el('li');
        li.append(el('strong', null, c.name), el('span', null, ' is alone on ' + list(c.solo)));
        ul.append(li);
      }
      body.append(section('Against the crowd', ul));
    }

    // You against everyone.
    const mine = me && r && ((s.picks[me] || {})[String(w)]);
    if (mine) {
      const clubs = [...(mine.standard || []), ...(mine.lock ? [mine.lock] : [])];
      const count = Object.fromEntries(r.clubs.map((c) => [c.club, c.n]));
      const withCrowd = clubs.filter((c) => count[c] > r.players / 2).length;
      const alone = clubs.filter((c) => count[c] === 1);
      const p = el('p', 'rv-you');
      p.textContent = 'You: ' + withCrowd + ' of your ' + clubs.length + ' picks are with the majority' + (alone.length ? ', and you are the only one on ' + list(alone) : '') + '.';
      body.append(p);
    }

    // New Shame Club members.
    if (r.shame.length) {
      const ul = el('ul', 'rv-list rv-shame');
      for (const m of r.shame) ul.append(el('li', null, m.name + ': ' + m.pairs.map(([h, a]) => h + ' and ' + a).join(', ')));
      body.append(section('Shame Club this week', ul));
    }

    const foot = el('footer', 'rv-foot');
    const all = el('button', 'pk-clear', "See everyone's picks");
    all.type = 'button';
    all.addEventListener('click', () => {
      pop.close();
      const tab = document.getElementById('tab-picks');
      if (tab) tab.click();
      setTimeout(() => { const d = document.querySelector('.pk-everyone'); if (d) { d.open = true; d.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }, 80);
    });
    const ok = el('button', 'pk-save', 'Nice');
    ok.type = 'button';
    ok.addEventListener('click', () => pop.close());
    foot.append(all, ok);
    card.append(head, body, foot);
    pop.replaceChildren(card);
    return true;
  }

  function open(w) {
    if (!season) return false;
    const week = w || season.config.currentWeek;
    if (!isOut(season, week) || !draw(season, week)) return false;
    store.set(seenKey(season, week), '1');
    if (!pop.open) pop.showModal();
    return true;
  }
  function available(w) { return !!season && isOut(season, w || season.config.currentWeek) && !!A.reveal(season, w || season.config.currentWeek); }

  // Wait for other pop-ups (a cup week, what's new) to finish first.
  let waiting = false;
  function maybe() {
    if (!season || waiting) return;
    const w = forced || season.config.currentWeek;
    if (!forced) {
      if (store.get(seenKey(season, w))) return;
      // A week whose results are all in is old news.
      if (window.FFWBCups && window.FFWBCups.weekFinal(season, w)) return;
    }
    if (!isOut(season, w)) return;
    waiting = true;
    let tries = 0;
    (function go() {
      if (document.querySelector('dialog[open]') && tries < 40) { tries += 1; setTimeout(go, 1500); return; }
      waiting = false;
      if (document.querySelector('dialog[open]')) return;
      forced = null;
      open(w);
    })();
  }

  pop.addEventListener('click', (e) => { if (e.target === pop) pop.close(); });
  if (window.FFWB) window.FFWB.onSeason((s) => { season = s; if (s) setTimeout(maybe, 700); });
  window.FFWBReveal = { open, available };
})();
