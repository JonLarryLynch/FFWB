// An in-memory stand-in for a Netlify Blobs store, for tests and local runs.
export function memoryStore() {
  const data = new Map();
  let n = 0;
  const tag = () => 'e' + (n += 1);
  return {
    async get(key, opts = {}) {
      const v = data.get(key);
      if (!v) return null;
      return opts.type === 'json' ? JSON.parse(v.body) : v.body;
    },
    async getWithMetadata(key, opts = {}) {
      const v = data.get(key);
      if (!v) return null;
      return { data: opts.type === 'json' ? JSON.parse(v.body) : v.body, etag: v.etag, metadata: {} };
    },
    async setJSON(key, value, opts = {}) {
      const cur = data.get(key);
      if (opts.onlyIfNew && cur) return { modified: false };
      if (opts.onlyIfMatch && (!cur || cur.etag !== opts.onlyIfMatch)) return { modified: false };
      const etag = tag();
      data.set(key, { body: JSON.stringify(value), etag });
      return { modified: true, etag };
    },
    async list({ prefix = '' } = {}) {
      return { blobs: [...data.entries()].filter(([k]) => k.startsWith(prefix)).map(([key, v]) => ({ key, etag: v.etag })), directories: [] };
    },
    async delete(key) { data.delete(key); },
    _data: data,
  };
}
