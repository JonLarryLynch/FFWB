// A stand-in for football-data.org for local runs (FAKE_FEED=1 node test/dev-server.mjs).
// Fixtures: week 8 kicks off in two days, week 7 kicked off last week; later weeks follow weekly.
import seed from '../netlify/lib/seed.mjs';

export function fakeFetch() {
  const clubs = seed.config.clubs;
  const day = 864e5;
  const matches = [];
  for (let w = 1; w <= 38; w += 1) {
    const base = Date.now() + (w - 8) * 7 * day + 2 * day;
    const order = clubs.map((c, i) => clubs[(i * 7 + w) % clubs.length]);
    for (let g = 0; g < 10; g += 1) {
      matches.push({ matchday: w, status: w < 8 ? 'FINISHED' : 'TIMED', utcDate: new Date(base + g * 3 * 3600e3).toISOString(),
        homeTeam: { name: order[g * 2], shortName: order[g * 2] }, awayTeam: { name: order[g * 2 + 1], shortName: order[g * 2 + 1] },
        score: { fullTime: { home: null, away: null } } });
    }
  }
  return async (url) => {
    const u = new URL(url);
    const md = u.searchParams.get('matchday');
    const body = u.pathname.endsWith('/teams') ? { teams: [{ shortName: 'Hull' }, { shortName: 'Leicester' }] }
      : u.pathname.includes('/ELC/') ? { matches: [] }
        : { matches: md ? matches.filter((m) => String(m.matchday) === md) : matches };
    return new Response(JSON.stringify(body), { status: 200 });
  };
}
