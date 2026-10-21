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
  const key = new URLSearchParams(location.search).get('key');
  if (key) {
    history.replaceState(null, '', location.pathname + location.hash);
    fetch('/api/link', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key }) })
      .then((r) => r.json())
      .then((out) => {
        if (!out.ok) { toast(out.error || 'That link did not work.', true); return; }
        store.set('ffwb-key-' + out.player, key);
        store.set('ffwb-player', out.player);
        if (!store.get('ffwb-intro-done')) store.set('ffwb-intro-pending', '1');
        once.set(out.name);
        location.replace(location.pathname + location.hash);
      })
      .catch(() => toast('That link could not be checked. Try opening it again when you have signal.', true));
  } else {
    const name = once.get();
    if (name) setTimeout(() => toast('This device is now linked to ' + name + '. Only your linked phones and laptops can change your picks. Open the same link on any other device you pick from.'), 600);
  }
  window.FFWBLink = { keyFor: (id) => (id ? store.get('ffwb-key-' + id) : null) };
})();
