// FFWB "The Kitty": the league money as it stands, on the Table tab for everyone. Where the fund has gone
// (greenouts and the full-season picks payout), what is left in the prize pot, who is in line for each prize,
// and everyone's running total.
(function () {
  const box = document.getElementById('kitty-box');
  const M = window.FFWBMoney;
  if (!box || !M) return;
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const $ = M.dollars;
  const list = (l) => (l.length > 2 ? l.slice(0, -1).join(', ') + ' and ' + l[l.length - 1] : l.join(' and '));
  const me = () => { try { return localStorage.getItem('ffwb-player'); } catch (err) { return null; } };
  let open = false;

  function draw(season) {
    const m = M.compute(season);
    const st = m.settings;
    const head = el('div', 'kt-head');
    head.append(el('h2', 'ffwb-h', 'The Kitty'), el('span', 'kt-sub', m.weeksCounted ? 'As it stands after ' + m.weeksCounted + ' week' + (m.weeksCounted === 1 ? '' : 's') : 'Before a ball is kicked'));

    // Where the fund goes, as one bar.
    const figs = el('div', 'kt-figs');
    const fig = (label, value, sub, cls) => { const f = el('div', 'kt-fig' + (cls ? ' ' + cls : '')); f.append(el('span', 'kt-fig-l', label), el('span', 'kt-fig-v', value), el('span', 'kt-fig-s', sub)); return f; };
    figs.append(
      fig('The fund', $(m.fund), 'this season'),
      fig('Greenouts', $(m.greenoutTotal), m.greenouts.length + ' so far, ' + $(st.greenout) + ' each', 'kt-c-green'),
      fig('Picks payout', $(m.picksTotal), $(st.picks) + ' each for making every pick', 'kt-c-picks'),
      fig('Prize pot', $(m.pot), 'split three ways', 'kt-c-pot'),
    );
    const bar = el('div', 'kt-bar');
    bar.setAttribute('role', 'img');
    bar.setAttribute('aria-label', 'Of the ' + $(m.fund) + ' fund: ' + $(m.greenoutTotal) + ' to greenouts, ' + $(m.picksTotal) + ' to the picks payout and ' + $(m.pot) + ' in the prize pot.');
    for (const [v, cls] of [[m.greenoutTotal, 'kt-c-green'], [m.picksTotal + Math.max(0, m.adjustTotal), 'kt-c-picks'], [m.pot, 'kt-c-pot']]) {
      const seg = el('span', 'kt-seg ' + cls);
      seg.style.flexGrow = String(Math.max(0.0001, v));
      bar.append(seg);
    }

    // The three prizes and who is in line for them.
    const prizes = el('ul', 'ffwb-recap-list kt-prizes');
    const ICON = { first: '\u{1F3C5}', second: '\u{1F3C6}', runnerUp: '\u{1F948}' };
    for (const p of m.prizes) {
      const li = el('li', 'ffwb-recap-item kt-prize');
      const who = p.key === 'runnerUp' && p.sharedWithTop ? 'Shared by the tied champions'
        : !p.started ? 'Up for grabs'
          : list(p.winners.map((w) => w.name)) + (p.winners.length > 1 ? ' (tied)' : '');
      const status = !p.started ? (p.key === 'first' ? 'Weeks 1 to 19' : 'Weeks 20 to 38') : p.done ? 'Won' : 'In line right now';
      const amount = p.winners.length > 1 ? $(p.winners[0].amount) + ' each' : $(p.amount);
      li.append(el('span', 'ffwb-recap-icon', ICON[p.key]), el('span', 'ffwb-recap-label', p.label + ' · ' + p.pct + '%'), el('span', 'kt-prize-amt', amount), el('span', 'kt-prize-who', who + ' · ' + status));
      prizes.append(li);
    }

    // Everyone's money so far.
    const more = el('details', 'ffwb-more kt-more');
    more.open = open;
    more.addEventListener('toggle', () => { open = more.open; });
    more.append(el('summary', null, "Everyone's money"));
    const t = el('table', 'ffwb-table kt-table');
    const hr = el('tr');
    for (const [h, num] of [['Player'], ['Greenouts', 1], ['Picks', 1], ['Prizes', 1], ['Total', 1]]) hr.append(el('th', num ? 'ffwb-num' : null, h));
    const thead = el('thead'); thead.append(hr);
    const tbody = el('tbody');
    const mine = me();
    for (const r of m.players) {
      const tr = el('tr', r.id === mine ? 'kt-me' : null);
      const name = el('td', 'ffwb-strong', r.name);
      const notes = [];
      if (r.missed.length) notes.push('missed week ' + list(r.missed.map(String)));
      if (r.adjust) notes.push((r.adjust > 0 ? '+' : '−') + $(Math.abs(r.adjust)) + (r.note ? ', ' + r.note : ''));
      if (notes.length) name.append(el('span', 'kt-note', notes.join(' · ')));
      tr.append(name,
        el('td', 'ffwb-num', r.greenouts ? $(r.greenoutMoney) + ' (' + r.greenouts + ')' : '–'),
        el('td', 'ffwb-num' + (r.picksMoney < st.picks ? ' kt-short' : ''), $(r.picksMoney)),
        el('td', 'ffwb-num', r.prize ? $(r.prize) : '–'),
        el('td', 'ffwb-num ffwb-strong', $(r.total)));
      tbody.append(tr);
    }
    t.append(thead, tbody);
    const scroll = el('div', 'kt-scroll');
    scroll.append(t);
    more.append(scroll);
    if (m.greenouts.length) {
      const g = el('div', 'kt-greenouts');
      g.append(el('span', 'kt-fig-l', 'Greenouts'));
      for (const x of m.greenouts) g.append(el('span', 'kt-chip', 'Wk ' + x.week + ' ' + x.name));
      more.append(g);
    }
    more.append(el('p', 'ffwb-note', 'A greenout (every pick, lock included, wins) pays ' + $(st.greenout) + '. Make every pick all season for ' + $(st.picks) + ' back, less ' + $(st.missed) + ' for each week missed. The rest is split ' + st.split.first + '% first half champion, ' + st.split.second + '% second half champion and ' + st.split.runnerUp + '% second half runner-up. The overall champion plays for pride. Prizes show who is in line now; the pot shrinks by ' + $(st.greenout) + ' with every new greenout and grows by ' + $(st.missed) + ' with every missed week.'));
    box.replaceChildren(head, figs, bar, prizes, more);
    box.hidden = false;
  }

  if (window.FFWB) window.FFWB.onSeason((s) => { if (s) draw(s); });
  window.FFWBKitty = { draw };
})();
