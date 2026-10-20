// Weekly backups: a full copy of the league saved in the store under backups/<time>, newest 12 kept.
const KEEP = 12;

export async function snapshot(store) {
  const config = await store.get('config', { type: 'json' });
  if (!config) return null;
  const [results, fixtures, ...docs] = await Promise.all([
    store.get('results', { type: 'json' }),
    store.get('fixtures', { type: 'json' }),
    ...config.players.map((p) => store.get('picks/' + p.id, { type: 'json' })),
  ]);
  const picks = {};
  config.players.forEach((p, i) => { picks[p.id] = docs[i] || { player: p.id, weeks: {}, history: [] }; });
  return { exportedAt: new Date().toISOString(), config, results, picks, fixtures };
}

export async function listBackups(store) {
  const { blobs } = await store.list({ prefix: 'backups/' });
  return blobs.map((b) => b.key).sort().reverse();
}

export async function saveBackup(store) {
  const snap = await snapshot(store);
  if (!snap) return null;
  const key = 'backups/' + snap.exportedAt;
  await store.setJSON(key, snap);
  const old = (await listBackups(store)).slice(KEEP);
  for (const k of old) await store.delete(k);
  return key;
}
