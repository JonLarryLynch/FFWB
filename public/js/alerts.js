// Phone alerts. A bell in the header shows whether they are on for this phone and opens a small panel to turn
// them on or off. Right after someone first saves picks, a toast offers alerts once. Alerts are tied to the
// name chosen on the Picks tab, so pick reminders only go to people who have not picked.
(function () {
  const box = document.getElementById('alerts');
  const bell = document.getElementById('alerts-bell');
  const pop = document.getElementById('alerts-pop');
  const toast = document.getElementById('alerts-toast');
  if (!box || !bell || !pop) return;
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone;
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (err) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (err) { /* only a convenience */ } },
  };
  const me = () => store.get('ffwb-player');
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  let reg = null;
  let busy = false;
  let on = false;

  const b64 = (s) => {
    const pad = '='.repeat((4 - (s.length % 4)) % 4);
    const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
  };
  const api = async (path, body) => {
    const res = await fetch('/api/' + path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
    return res.json();
  };
  const usable = () => supported && Notification.permission !== 'denied';

  function setBell() {
    // Only show the bell where alerts can work, or where an iPhone just needs the site on its home screen.
    bell.hidden = !(supported || (ios && !standalone));
    bell.classList.toggle('al-on', on);
    bell.setAttribute('aria-label', on ? 'Phone alerts are on' : 'Phone alerts are off. Turn them on');
    bell.title = on ? 'Phone alerts are on' : 'Turn on phone alerts';
  }

  const WHEN = [
    ['A new week opens', 'after the results are in'],
    ['A day before kickoff', "only if you haven't picked"],
    ['3 hours before kickoff', "last call, only if you haven't picked"],
  ];

  async function draw(note) {
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    on = !!sub;
    setBell();
    const parts = [];
    if (!supported) {
      parts.push(el('p', 'al-lead', 'On iPhone, alerts work once FFWB is on your home screen.'));
      const steps = el('ol', 'al-steps');
      for (const s of ['Tap the Share button in Safari', 'Tap Add to Home Screen', 'Open FFWB from the new icon and tap the bell']) steps.append(el('li', null, s));
      parts.push(steps);
    } else if (Notification.permission === 'denied') {
      parts.push(el('p', 'al-lead', 'Alerts are blocked for FFWB. Turn notifications back on for it in your phone or browser settings, then come back here.'));
    } else {
      const status = el('div', 'al-status' + (on ? ' al-status-on' : ''));
      status.append(el('span', 'al-status-dot'), el('span', null, on ? 'Alerts are on for this phone' : 'Alerts are off'));
      parts.push(status);
      const list = el('ul', 'al-when');
      for (const [a, b] of WHEN) { const li = el('li'); li.append(el('b', null, a), el('span', null, b)); list.append(li); }
      parts.push(el('p', 'al-lead', "You'll get a ping when:"), list);
      const btn = el('button', on ? 'pk-clear al-btn' : 'pk-save al-btn', on ? 'Turn off alerts' : 'Turn on alerts');
      btn.type = 'button';
      btn.disabled = busy;
      btn.addEventListener('click', () => (on ? turnOff(sub) : turnOn()));
      parts.push(btn);
    }
    if (note) parts.push(el('p', 'pk-message pk-message-' + note.kind, note.text));
    box.replaceChildren(...parts);
  }

  async function turnOn() {
    if (!me()) { draw({ kind: 'warn', text: 'Choose your name on the Picks tab first, so reminders know whether you have picked.' }); return false; }
    busy = true; draw();
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') throw new Error('Alerts were not allowed.');
      const { publicKey } = await api('push/key');
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(publicKey) });
      const out = await api('push/subscribe', { subscription: sub.toJSON(), player: me() });
      if (!out.ok) throw new Error(out.error);
      busy = false; await draw({ kind: 'ok', text: "You're set." });
      return true;
    } catch (err) {
      busy = false; draw({ kind: 'bad', text: err.message || 'Alerts could not be turned on.' });
      return false;
    }
  }

  async function turnOff(sub) {
    busy = true; draw();
    try { await api('push/unsubscribe', { endpoint: sub.endpoint }); await sub.unsubscribe(); } catch (err) { /* already gone */ }
    busy = false; draw({ kind: 'ok', text: 'Alerts are off for this phone.' });
  }

  bell.addEventListener('click', () => { draw(); pop.showModal(); });
  document.getElementById('alerts-close').addEventListener('click', () => pop.close());
  pop.addEventListener('click', (e) => { if (e.target === pop) pop.close(); });

  // Right after someone saves picks, offer alerts once. "No thanks" means never again on this phone.
  let toastTimer = null;
  function hideToast() { toast.hidden = true; clearTimeout(toastTimer); }
  document.addEventListener('ffwb:picks-saved', (e) => {
    if (on || !usable() || store.get('ffwb-alerts-offer') === 'no') return;
    const week = e.detail && e.detail.week;
    const text = el('span', null, 'Picks saved. Want a ping when week ' + (week ? week + 1 : 'the next week') + ' opens?');
    const yes = el('button', 'al-toast-yes', 'Turn on alerts');
    const no = el('button', 'al-toast-no', 'No thanks');
    yes.type = 'button'; no.type = 'button';
    yes.addEventListener('click', async () => { hideToast(); if (!(await turnOn())) { draw(); pop.showModal(); } else { draw({ kind: 'ok', text: "You're set." }); } });
    no.addEventListener('click', () => { store.set('ffwb-alerts-offer', 'no'); hideToast(); });
    toast.replaceChildren(text, yes, no);
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, 12000);
  });

  // If the name on this phone changes, move the alerts to the new name.
  document.addEventListener('change', async (e) => {
    if (!e.target || e.target.id !== 'player-name' || !reg) return;
    const sub = await reg.pushManager.getSubscription();
    if (sub && me()) api('push/subscribe', { subscription: sub.toJSON(), player: me() });
  });

  (async () => {
    if (supported) {
      try { reg = await navigator.serviceWorker.register('/sw.js'); await navigator.serviceWorker.ready; } catch (err) { console.error(err); }
    }
    draw();
  })();
})();
