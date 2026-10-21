// Phone notifications (web push). The site makes its own signing keys the first time and keeps them in the
// store, so there is nothing to set up on Netlify. Subscriptions live in one document, "push/subs".
import crypto from 'node:crypto';
import webpush from 'web-push';

const SUBS = 'push/subs';
const KEYS = 'push/vapid';
const SENT = 'push/sent';
const CONTACT = 'https://timmytyrantfootball.netlify.app';

export async function vapidKeys(store) {
  let keys = await store.get(KEYS, { type: 'json' });
  if (keys) return keys;
  const made = webpush.generateVAPIDKeys();
  await store.setJSON(KEYS, made, { onlyIfNew: true });
  return store.get(KEYS, { type: 'json' });
}

const idOf = (endpoint) => crypto.createHash('sha256').update(String(endpoint)).digest('hex').slice(0, 24);

async function change(store, key, fn) {
  for (let i = 0; i < 5; i += 1) {
    const cur = await store.getWithMetadata(key, { type: 'json' });
    const next = fn(cur ? structuredClone(cur.data) : {});
    const w = cur ? await store.setJSON(key, next, { onlyIfMatch: cur.etag }) : await store.setJSON(key, next, { onlyIfNew: true });
    if (w.modified) return next;
  }
  throw new Error('Someone else was saving at the same moment. Please try again.');
}

export function validSubscription(sub) {
  return !!sub && typeof sub.endpoint === 'string' && /^https:\/\//.test(sub.endpoint) && sub.endpoint.length < 1000
    && sub.keys && typeof sub.keys.p256dh === 'string' && typeof sub.keys.auth === 'string';
}

// A phone's subscription. The commissioner flag rides along with whoever's name the phone is under.
export async function subscribe(store, sub, player, { commissioner } = {}) {
  const clean = { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } };
  return change(store, SUBS, (d) => {
    const id = idOf(sub.endpoint);
    const was = d[id] || {};
    d[id] = { sub: clean, player: player === undefined ? (was.player || null) : player || null, commish: commissioner === undefined ? !!was.commish : !!commissioner, at: new Date().toISOString() };
    return d;
  });
}

export async function unsubscribe(store, endpoint) {
  return change(store, SUBS, (d) => { delete d[idOf(endpoint)]; return d; });
}

export async function subscriptions(store) {
  return (await store.get(SUBS, { type: 'json' })) || {};
}

// Send one message to every subscription, or only those for the given players. Dead subscriptions are removed.
export async function send(store, message, { players = null, commissioner = false, sender = webpush } = {}) {
  const keys = await vapidKeys(store);
  const all = await subscriptions(store);
  const targets = Object.entries(all).filter(([, s]) => (commissioner ? s.commish : !players || players.includes(s.player)));
  const payload = JSON.stringify({ title: message.title || 'FFWB', body: message.body, url: message.url || '/', tag: message.tag });
  const dead = [];
  let sent = 0;
  await Promise.all(targets.map(async ([id, s]) => {
    try {
      await sender.sendNotification(s.sub, payload, { vapidDetails: { subject: CONTACT, publicKey: keys.publicKey, privateKey: keys.privateKey }, TTL: 6 * 3600 });
      sent += 1;
    } catch (err) {
      if (err && (err.statusCode === 404 || err.statusCode === 410)) dead.push(id);
      else console.error('Push failed: ' + (err && err.message));
    }
  }));
  if (dead.length) await change(store, SUBS, (d) => { for (const id of dead) delete d[id]; return d; });
  return { sent, removed: dead.length, targeted: targets.length };
}

// The commissioner's own phones, subscribed from the commissioner page.
export function toCommissioner(store, message, opts = {}) {
  return send(store, { url: '/admin.html', ...message }, { ...opts, commissioner: true });
}

// Only send a given reminder once.
export async function once(store, tag, fn) {
  const sent = (await store.get(SENT, { type: 'json' })) || {};
  if (sent[tag]) return null;
  await change(store, SENT, (d) => { d[tag] = new Date().toISOString(); return d; });
  return fn();
}

const chicago = (iso) => new Date(iso).toLocaleString('en-US', { timeZone: 'America/Chicago', weekday: 'short', hour: 'numeric', minute: '2-digit' }) + ' CT';

// Reminders before a week's first kickoff, for players who have not picked: one about a day before and one
// about three hours before. Runs from the hourly job.
export async function remind(store, now = Date.now(), sender) {
  const config = await store.get('config', { type: 'json' });
  const fixtures = await store.get('fixtures', { type: 'json' });
  if (!config || !fixtures) return [];
  const week = config.currentWeek;
  const ko = fixtures.weeks && fixtures.weeks[String(week)] && fixtures.weeks[String(week)].kickoff;
  if (!ko) return [];
  const left = Date.parse(ko) - now;
  const done = [];
  for (const [tag, from, to] of [['day', 3 * 3600e3, 26 * 3600e3], ['soon', 0, 3 * 3600e3]]) {
    if (left <= from || left > to) continue;
    const docs = await Promise.all(config.players.map((p) => store.get('picks/' + p.id, { type: 'json' })));
    const missing = config.players.filter((p, i) => !(docs[i] && docs[i].weeks && docs[i].weeks[String(week)])).map((p) => p.id);
    if (!missing.length) continue;
    const r = await once(store, 'remind-' + config.season + '-' + week + '-' + tag, () => send(store, {
      title: 'Week ' + week + ' picks',
      body: tag === 'soon' ? 'Last call: week ' + week + ' kicks off ' + chicago(ko) + " and you haven't picked." : 'Week ' + week + ' kicks off ' + chicago(ko) + ". You haven't picked yet.",
      tag: 'remind-' + week,
    }, { players: missing, sender }));
    if (r) done.push({ tag, ...r });
    // Three hours out, tell the commissioner who is still missing if it is more than a couple.
    if (tag === 'soon' && missing.length >= 3) {
      const names = config.players.filter((p) => missing.includes(p.id)).map((p) => p.name);
      await once(store, 'commish-missing-' + config.season + '-' + week, () => toCommissioner(store, { title: names.length + ' still to pick for week ' + week, body: names.join(', ') + '. Kickoff ' + chicago(ko) + '.', tag: 'commish' }, { sender }));
    }
  }
  return done;
}
