// Tests for phone notifications, with a fake push sender. Run with: node test/push.test.mjs
import assert from 'node:assert/strict';
import { createHandler } from '../netlify/lib/handler.mjs';
import { remind } from '../netlify/lib/push.mjs';
import { memoryStore } from './memory-store.mjs';

let passed = 0;
const t = async (name, fn) => { await fn(); passed += 1; console.log('ok  ' + name); };
const sub = (n) => ({ endpoint: 'https://push.example/' + n, keys: { p256dh: 'p' + n, auth: 'a' + n } });
function setup() {
  const store = memoryStore();
  const sent = [];
  const sender = { sendNotification: async (s, payload) => { if (s.endpoint.endsWith('/dead')) { const e = new Error('gone'); e.statusCode = 410; throw e; } sent.push({ to: s.endpoint, msg: JSON.parse(payload) }); } };
  const api = createHandler(() => store, 'p', { pushSender: sender });
  const post = async (path, body) => { const r = await api(new Request('https://x.test/api/' + path, { method: 'POST', body: JSON.stringify(body) })); return { status: r.status, body: await r.json() }; };
  const get = async (path) => (await api(new Request('https://x.test/api/' + path))).json();
  return { store, sent, sender, post, get };
}

await t('the site makes its own keys and phones can subscribe', async () => {
  const { post, get } = setup();
  const k = await get('push/key');
  assert.ok(k.publicKey && k.publicKey.length > 40);
  assert.equal((await get('push/key')).publicKey, k.publicKey, 'the same key every time');
  assert.equal((await post('push/subscribe', { subscription: sub(1), player: 'jon' })).status, 200);
  assert.equal((await post('push/subscribe', { subscription: { endpoint: 'nope' } })).status, 400);
  const s = await post('admin/push', { passcode: 'p' });
  assert.equal(s.body.count, 1);
  assert.deepEqual(s.body.who, ['Jon']);
});

await t('the commissioner can send to everyone, and dead phones are dropped', async () => {
  const { post, sent } = setup();
  await post('push/subscribe', { subscription: sub(1), player: 'jon' });
  await post('push/subscribe', { subscription: sub(2), player: 'ben' });
  await post('push/subscribe', { subscription: sub('dead'), player: 'tim' });
  const r = await post('admin/push', { passcode: 'p', body: 'Pub at 7' });
  assert.equal(r.body.sent, 2);
  assert.equal(r.body.removed, 1);
  assert.equal(sent[0].msg.body, 'Pub at 7');
  assert.equal((await post('admin/push', { passcode: 'p' })).body.count, 2);
  assert.equal((await post('admin/push', { passcode: 'wrong', body: 'x' })).status, 401);
});

await t('finishing a week tells everyone the next one is open, once', async () => {
  const { post, get, sent } = setup();
  await post('push/subscribe', { subscription: sub(1), player: 'jon' });
  const s = await get('season');
  const res = Object.fromEntries(s.config.clubs.map((c) => [c, 1]));
  await post('admin/results', { passcode: 'p', week: 8, results: res });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].msg.title, 'Week 9 is open');
  await post('admin/config', { passcode: 'p', currentWeek: 8 });
  await post('admin/results', { passcode: 'p', week: 8, results: res });
  assert.equal(sent.length, 1, 'not sent twice for the same week');
});

await t('reminders go only to players who have not picked, a day and three hours out', async () => {
  const { store, post, get, sent, sender } = setup();
  await get('season');
  await post('push/subscribe', { subscription: sub(1), player: 'jon' });
  await post('push/subscribe', { subscription: sub(2), player: 'ben' });
  await post('picks', { player: 'jon', week: 8, standard: ['Arsenal', 'Chelsea', 'Liverpool', 'Brighton'], lock: 'Man City' });
  const ko = Date.parse('2026-10-24T11:30:00Z');
  await store.setJSON('fixtures', { checkedAt: new Date().toISOString(), weeks: { 8: { kickoff: new Date(ko).toISOString(), games: {} } } });
  assert.deepEqual(await remind(store, ko - 40 * 3600e3, sender), [], 'too early');
  await remind(store, ko - 20 * 3600e3, sender);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, sub(2).endpoint, 'only Ben, who has not picked');
  assert.match(sent[0].msg.body, /Week 8 kicks off Sat 6:30 AM CT/);
  await remind(store, ko - 19 * 3600e3, sender);
  assert.equal(sent.length, 1, 'the day-before reminder only once');
  await remind(store, ko - 2 * 3600e3, sender);
  assert.equal(sent.length, 2);
  assert.match(sent[1].msg.body, /Last call/);
});

console.log(passed + ' tests passed');
