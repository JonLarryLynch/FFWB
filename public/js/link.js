// FFWB personal links. Each player gets a private link (/?key=...) from the commissioner. Opening it ties this
// phone to their name: from then on only a phone with their key can save their picks or see them before kickoff.
(function () {
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (err) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (err) { /* private mode: the link will need opening again */ } },
  };
  const once = {
    get() { try { const v = sessionStorage.getItem('ffwb-linked'); sessionStorage.removeItem('ffwb-linked'); return v; } catch (err) { return null; } },
    set(v) { try { sessionStorage.setItem('ffwb-linked', v); } catch (err) { /* fine */ } },
  };
  function toast(text, bad) {
    const t = document.createElement('div');
    t.className = 'lk-toast' + (bad ? ' lk-bad' : '');
    t.setAttribute('role', 'status');
    t.textContent = text;
    document.body.append(t);
    setTimeout(() => t.classList.add('lk-go'), 5200);
    setTimeout(() => t.remove(), 6000);
  }
  // Link this device with a key, from an opened link or one pasted into the box below.
  function linkWith(key, onFail) {
    return fetch('/api/link', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key }) })
      .then((r) => r.json())
      .then((out) => {
        if (!out.ok) { (onFail || ((t) => toast(t, true)))(out.error || 'That link did not work.'); return; }
        store.set('ffwb-key-' + out.player, key);
        store.set('ffwb-player', out.player);
        if (!store.get('ffwb-intro-done')) store.set('ffwb-intro-pending', '1');
        once.set(out.name);
        location.replace(location.pathname + location.hash);
      })
      .catch(() => (onFail || ((t) => toast(t, true)))('That link could not be checked. Try again when you have signal.'));
  }
  // A home screen app cannot open a link from a text, so it can be pasted here instead.
  function form() {
    const box = document.createElement('form');
    box.className = 'lk-form';
    const input = document.createElement('input');
    input.className = 'adm-input lk-input';
    input.placeholder = 'Paste your personal link';
    input.setAttribute('aria-label', 'Your personal link');
    input.autocomplete = 'off';
    const go = document.createElement('button');
    go.className = 'pk-save adm-small';
    go.type = 'submit';
    go.textContent = 'Link this device';
    const note = document.createElement('p');
    note.className = 'ffwb-note lk-note';
    note.textContent = 'Using the home screen app? Copy your link from the text and paste it here.';
    box.append(input, go, note);
    box.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = input.value.trim();
      const m = v.match(/[?&]key=([\w-]+)/) || v.match(/^([\w-]{8,})$/);
      if (!m) { note.textContent = 'That does not look like an FFWB link. It should end in ?key= and some letters.'; return; }
      go.disabled = true;
      note.textContent = 'Checking...';
      linkWith(m[1], (t) => { note.textContent = t; go.disabled = false; });
    });
    return box;
  }
  const key = new URLSearchParams(location.search).get('key');
  if (key) {
    history.replaceState(null, '', location.pathname + location.hash);
    linkWith(key);
  } else {
    const name = once.get();
    if (name) setTimeout(() => toast('This device is now linked to ' + name + '. Only your linked phones and laptops can change your picks. Open the same link on any other device you pick from.'), 600);
  }
  window.FFWBLink = { keyFor: (id) => (id ? store.get('ffwb-key-' + id) : null), form, linkWith };
})();
