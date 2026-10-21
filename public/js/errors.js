// FFWB error reports: if the site breaks on someone's phone, send a short note to the league server so the
// commissioner sees it. At most a few per page load, and only errors from the site's own scripts.
(function () {
  let sent = 0;
  const seen = new Set();
  const own = (src) => !src || src.startsWith(location.origin) || src.startsWith('/');
  function report(message, source, stack) {
    if (sent >= 5) return;
    const msg = String(message || 'Unknown error').slice(0, 300);
    if (/^Script error\.?$/.test(msg) || /ResizeObserver loop/.test(msg)) return;
    const key = msg + '|' + (source || '');
    if (seen.has(key)) return;
    seen.add(key);
    sent += 1;
    let player = null;
    try { player = localStorage.getItem('ffwb-player'); } catch (err) { /* fine */ }
    const body = JSON.stringify({ message: msg, source: String(source || '').replace(location.origin, '').slice(0, 200), stack: String(stack || '').replace(new RegExp(location.origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '').slice(0, 1500), page: location.pathname + location.hash, player, ua: navigator.userAgent.slice(0, 200) });
    try {
      if (navigator.sendBeacon) navigator.sendBeacon('/api/report', new Blob([body], { type: 'application/json' }));
      else fetch('/api/report', { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true });
    } catch (err) { /* reporting must never break the page */ }
  }
  window.addEventListener('error', (e) => {
    if (!e.message || !own(e.filename)) return;
    report(e.message, (e.filename || '') + ':' + (e.lineno || 0) + ':' + (e.colno || 0), e.error && e.error.stack);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    if (r && r.name === 'AbortError') return;
    report('Unhandled: ' + (r && r.message ? r.message : String(r)), '', r && r.stack);
  });
  window.FFWBErrors = { report };
})();
