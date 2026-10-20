// Phone alerts: turn notifications on or off for this phone. They are tied to the name chosen on the picks
// page, so pick reminders only go to people who have not picked.
(function () {
  const box = document.getElementById('alerts');
  if (!box) return;
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone;
  const me = () => { try { return localStorage.getItem('ffwb-player'); } catch (err) { return null; } };
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  let reg = null;
  let busy = false;

  const b64 = (s) => {
    const pad = '='.repeat((4 - (s.length % 4)) % 4);
    const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
  };
  const api = async (path, body) => {
    const res = await fetch('/api/' + path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
    return res.json();
  };

  async function draw(note) {
    box.hidden = false;
    const title = el('div', 'al-title', 'Phone alerts');
    const text = el('p', 'ffwb-note al-text');
    const parts = [title, text];
    if (!supported) {
      if (ios && !standalone) text.textContent = 'On iPhone, add FWB to your home screen first (Share, then Add to Home Screen), then open it from there to turn on alerts.';
      else { box.hidden = true; return; }
    } else if (Notification.permission === 'denied') {
      text.textContent = 'Alerts are blocked for this site. Turn them back on in your phone or browser settings.';
    } else {
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      const btn = el('button', sub ? 'pk-clear' : 'pk-save', sub ? 'Turn off' : 'Turn on alerts');
      btn.type = 'button';
      btn.disabled = busy;
      text.textContent = sub
        ? 'Alerts are on for this phone. You will get a ping when a new week opens, and a reminder before kickoff if you have not picked.'
        : 'Get a ping when a new week opens, and a reminder before kickoff if you have not picked.';
      btn.addEventListener('click', () => (sub ? turnOff(sub) : turnOn()));
      parts.push(btn);
    }
    if (note) parts.push(el('p', 'pk-message pk-message-' + note.kind, note.text));
    box.replaceChildren(...parts);
  }

  async function turnOn() {
    if (!me()) { draw({ kind: 'warn', text: 'Choose your name above first, so reminders know whether you have picked.' }); return; }
    busy = true; draw();
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') throw new Error('Alerts were not allowed.');
      const { publicKey } = await api('push/key');
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(publicKey) });
      const out = await api('push/subscribe', { subscription: sub.toJSON(), player: me() });
      if (!out.ok) throw new Error(out.error);
      busy = false; draw({ kind: 'ok', text: 'Alerts are on.' });
    } catch (err) {
      busy = false; draw({ kind: 'bad', text: err.message || 'Alerts could not be turned on.' });
    }
  }

  async function turnOff(sub) {
    busy = true; draw();
    try { await api('push/unsubscribe', { endpoint: sub.endpoint }); await sub.unsubscribe(); } catch (err) { /* already gone */ }
    busy = false; draw({ kind: 'ok', text: 'Alerts are off for this phone.' });
  }

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
