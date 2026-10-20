// Fetches Premier League results from football-data.org and turns them into W/D/L/P per club.
// Results are saved as suggestions (store key "auto/results") for the commissioner to review and save.
// The league's week numbers are the Premier League matchdays, so a postponed game played later
// still belongs to its original week, as the league rules say.

const BASE = 'https://api.football-data.org/v4/competitions/';
const API = BASE + 'PL/matches?matchday=';

// Other names the feed may use for each club, written as normalize() returns them.
const ALIASES = {
  'Bournemouth': ['afc bournemouth'],
  'Brighton': ['brighton hove', 'brighton hove albion'],
  'Coventry City': ['coventry'],
  'Hull City': ['hull'],
  'Ipswich Town': ['ipswich'],
  'Leeds': ['leeds united'],
  'Man City': ['manchester city'],
  'Man U': ['man united', 'manchester united', 'man utd'],
  'Newcastle': ['newcastle united'],
  'Nottingham Forest': ['nottingham', 'nottm forest'],
  'Tottenham': ['tottenham hotspur', 'spurs'],
  'West Ham': ['west ham united'],
  'Wolves': ['wolverhampton wanderers', 'wolverhampton'],
  'Leicester': ['leicester city'],
  'Sheffield Utd': ['sheffield united'],
  'Norwich City': ['norwich'],
  'Burnley': ['burnley'],
  'Southampton': ['southampton'],
  'Watford': ['watford'],
  'West Brom': ['west bromwich albion'],
};

export function normalize(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/&/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\b(afc|fc)\b/g, ' ')
    .replace(/\band\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Which of the season's clubs a team from the feed is, or null.
export function matchClub(team, clubs) {
  const names = [team && team.name, team && team.shortName].filter(Boolean).map(normalize);
  for (const club of clubs) {
    const known = new Set([normalize(club), ...(ALIASES[club] || []).map(normalize)]);
    if (names.some((n) => known.has(n))) return club;
  }
  // Last resort: a club whose name starts the feed's name, like "brentford" in "brentford fc".
  for (const club of clubs) {
    const c = normalize(club);
    if (names.some((n) => n.startsWith(c + ' ') || c.startsWith(n + ' '))) return club;
  }
  return null;
}

const POSTPONED = new Set(['POSTPONED', 'SUSPENDED', 'CANCELLED']);
const DONE = new Set(['FINISHED', 'AWARDED']);

// One week from the feed's matches: { results: { club: 1 | 0.5 | 0 | 'P' }, finished, pending, postponed, unmatched }.
export function weekFromMatches(matches, clubs) {
  const results = {};
  const unmatched = [];
  let finished = 0;
  let pending = 0;
  let postponed = 0;
  for (const m of matches || []) {
    const home = matchClub(m.homeTeam, clubs);
    const away = matchClub(m.awayTeam, clubs);
    if (!home) unmatched.push((m.homeTeam && (m.homeTeam.shortName || m.homeTeam.name)) || 'unknown team');
    if (!away) unmatched.push((m.awayTeam && (m.awayTeam.shortName || m.awayTeam.name)) || 'unknown team');
    if (POSTPONED.has(m.status)) {
      postponed += 1;
      if (home) results[home] = 'P';
      if (away) results[away] = 'P';
      continue;
    }
    const ft = (m.score && m.score.fullTime) || {};
    if (!DONE.has(m.status) || ft.home == null || ft.away == null) { pending += 1; continue; }
    finished += 1;
    const h = ft.home > ft.away ? 1 : ft.home < ft.away ? 0 : 0.5;
    if (home) results[home] = h;
    if (away) results[away] = h === 0.5 ? 0.5 : 1 - h;
  }
  return { results, finished, pending, postponed, games: (matches || []).length, unmatched: [...new Set(unmatched)] };
}

async function getJSON(url, key, fetchImpl) {
  const res = await fetchImpl(url, { headers: { 'X-Auth-Token': key } });
  if (res.status === 403 || res.status === 400) throw new Error('football-data.org refused the API key. Check FOOTBALL_DATA_KEY on Netlify.');
  if (res.status === 429) throw new Error('football-data.org says too many requests. It will try again at the next check.');
  if (!res.ok) throw new Error('football-data.org answered ' + res.status + '.');
  return res.json();
}

export async function fetchWeek(week, key, fetchImpl) {
  return (await getJSON(API + week, key, fetchImpl)).matches || [];
}

// A competition's clubs, by the short names the feed uses (ELC is the Championship).
export async function fetchTeams(code, key, fetchImpl) {
  const body = await getJSON(BASE + code + '/teams', key, fetchImpl);
  return [...new Set((body.teams || []).map((t) => t.shortName || t.name).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

// EFL picks for a Premier League week: Championship games played on the same dates as that matchday.
// A club with two games in that window is left for the commissioner to decide.
export async function fetchEflWeek(plMatches, eflClubs, key, fetchImpl) {
  const days = (plMatches || []).map((m) => String(m.utcDate || '').slice(0, 10)).filter(Boolean).sort();
  if (!days.length || !eflClubs.length) return null;
  const url = BASE + 'ELC/matches?dateFrom=' + days[0] + '&dateTo=' + days[days.length - 1];
  const matches = (await getJSON(url, key, fetchImpl)).matches || [];
  const seen = {};
  for (const m of matches) for (const t of [m.homeTeam, m.awayTeam]) { const c = matchClub(t, eflClubs); if (c) seen[c] = (seen[c] || 0) + 1; }
  const twice = Object.keys(seen).filter((c) => seen[c] > 1);
  const week = weekFromMatches(matches, eflClubs);
  for (const c of twice) delete week.results[c];
  return { ...week, twice, from: days[0], to: days[days.length - 1] };
}

// The whole season's fixtures in one call: per week, the first kickoff and each club's game.
// Postponed or cancelled games do not set a week's first kickoff.
export function fixturesFromMatches(matches, clubs) {
  const weeks = {};
  for (const m of matches || []) {
    const w = String(m.matchday || '');
    if (!w || !m.utcDate) continue;
    const wk = weeks[w] || (weeks[w] = { kickoff: null, games: {} });
    const home = matchClub(m.homeTeam, clubs);
    const away = matchClub(m.awayTeam, clubs);
    const off = POSTPONED.has(m.status);
    const short = (t) => (t && (t.shortName || t.name)) || '';
    if (home) wk.games[home] = { vs: away || short(m.awayTeam), home: true, at: m.utcDate, off };
    if (away) wk.games[away] = { vs: home || short(m.homeTeam), home: false, at: m.utcDate, off };
    if (!off && (!wk.kickoff || m.utcDate < wk.kickoff)) wk.kickoff = m.utcDate;
  }
  return weeks;
}

export async function fetchFixtures(store, config, key, fetchImpl) {
  const body = await getJSON(BASE + 'PL/matches', key, fetchImpl);
  const doc = { checkedAt: new Date().toISOString(), weeks: fixturesFromMatches(body.matches || [], config.clubs), error: null };
  await store.setJSON('fixtures', doc);
  return doc;
}

// Which weeks to check: the current week, the week before if it is still incomplete,
// and any week that still has a postponed game. At most five, to stay inside the free plan's limit.
export function weeksToCheck(config, savedWeeks) {
  const weeks = new Set([config.currentWeek]);
  const prev = savedWeeks[String(config.currentWeek - 1)] || {};
  if (config.currentWeek > 1 && Object.keys(prev).length < config.clubs.length) weeks.add(config.currentWeek - 1);
  for (const [w, res] of Object.entries(savedWeeks)) if (Object.values(res).includes('P')) weeks.add(Number(w));
  return [...weeks].filter((w) => w >= 1 && w <= 38).sort((a, b) => a - b).slice(-5);
}

export async function runFetch(store, key, fetchImpl, onlyWeek) {
  const config = await store.get('config', { type: 'json' });
  if (!config) return null;
  const saved = (await store.get('results', { type: 'json' })) || { weeks: {} };
  const prior = (await store.get('auto/results', { type: 'json' })) || { weeks: {} };
  const weeks = onlyWeek ? [onlyWeek] : weeksToCheck(config, saved.weeks || {});
  const doc = { checkedAt: new Date().toISOString(), weeks: { ...prior.weeks }, error: null };
  // Kickoff times move around for TV, so refresh the fixtures on every check too.
  try { await fetchFixtures(store, config, key, fetchImpl); } catch (err) { doc.error = err.message; }
  for (const week of weeks) {
    if (doc.error) break;
    try {
      const matches = await fetchWeek(week, key, fetchImpl);
      doc.weeks[String(week)] = { ...weekFromMatches(matches, config.clubs), checkedAt: doc.checkedAt };
      if ((config.eflWeeks || []).includes(week)) {
        doc.weeks[String(week)].efl = await fetchEflWeek(matches, config.eflClubs || [], key, fetchImpl);
      }
    } catch (err) {
      doc.error = err.message;
      break;
    }
  }
  await store.setJSON('auto/results', doc);
  return doc;
}
