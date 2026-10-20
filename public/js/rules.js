// Football FWB league rules, shared by the website and the server so both check picks the same way.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FFWBRules = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const WEEKS = 38;
  const HALF_END = 19;
  const STANDARD_PICKS = 4;
  const MIN_PER_HALF = 3;
  const MAX_LOCKS_PER_HALF = 4;

  const halfOf = (week) => (week <= HALF_END ? 1 : 2);
  const weeksInHalf = (half) => {
    const out = [];
    for (let w = half === 1 ? 1 : HALF_END + 1; w <= (half === 1 ? HALF_END : WEEKS); w += 1) out.push(w);
    return out;
  };

  // Points for one pick: a win is 1, a draw a half, a loss 0; a lock counts double.
  // A result of 'P' (postponed) or no result yet scores nothing until it is played.
  function pickPoints(result, isLock) {
    const base = result === 1 ? 1 : result === 0.5 ? 0.5 : 0;
    return isLock ? base * 2 : base;
  }

  // A week where every pick, lock included, won. A postponed or missing result means not yet.
  function isPerfect(p, weekResults) {
    if (!p || !p.lock || !weekResults) return false;
    return [...(p.standard || []), p.lock].every((c) => weekResults[c] === 1);
  }

  // How many regular picks a player may make in a week. Normally 4; after a perfect week,
  // one more than they had that week, so a perfect bonus week earns another (the greenout rule).
  // The bonus is optional: a player may always pick just 4.
  function allowedStandard(weekPicks, results, week) {
    const prev = (weekPicks || {})[String(week - 1)];
    if (week > 1 && isPerfect(prev, (results || {})[String(week - 1)])) return (prev.standard || []).length + 1;
    return STANDARD_PICKS;
  }

  // How a player has used each club in one half: picks of any kind, and locks.
  // weekPicks is { week: { standard: [...], lock } }. skipWeek leaves one week out.
  function usage(weekPicks, half, skipWeek) {
    const counts = {};
    const locks = {};
    const filled = new Set();
    for (const [w, p] of Object.entries(weekPicks || {})) {
      const week = Number(w);
      if (week === skipWeek || halfOf(week) !== half || !p) continue;
      const clubs = [...(p.standard || []), ...(p.lock ? [p.lock] : [])];
      if (clubs.length) filled.add(week);
      for (const c of clubs) counts[c] = (counts[c] || 0) + 1;
      if (p.lock) locks[p.lock] = (locks[p.lock] || 0) + 1;
    }
    return { counts, locks, filled };
  }

  // Checks one week's picks against the league rules.
  // clubs: the season's 20 clubs. weekPicks: the player's picks for every week.
  // openWeeks: weeks still open for picking, used to judge whether every club can still reach 3.
  // Returns { ok, errors, owed, slotsLeft } where owed and slotsLeft describe the half after this week.
  function check({ clubs, weekPicks, week, standard, lock, openWeeks, results }) {
    const errors = [];
    const valid = new Set(clubs);
    if (!Number.isInteger(week) || week < 1 || week > WEEKS) errors.push('Pick a week from 1 to ' + WEEKS + '.');
    const std = Array.isArray(standard) ? standard : [];
    const allowed = allowedStandard(weekPicks, results, week);
    if (std.length < STANDARD_PICKS || std.length > allowed) {
      errors.push(allowed > STANDARD_PICKS
        ? 'Pick ' + STANDARD_PICKS + ' to ' + allowed + ' clubs plus a lock this week, since last week was perfect (you have ' + std.length + ').'
        : 'Pick ' + STANDARD_PICKS + ' clubs plus a lock (you have ' + std.length + ').');
    }
    if (!lock) errors.push('Choose your lock.');
    for (const c of [...std, ...(lock ? [lock] : [])]) if (!valid.has(c)) errors.push(c + ' is not a club this season.');
    if (new Set(std).size !== std.length) errors.push('Each club can only be picked once a week.');
    if (lock && std.includes(lock)) errors.push(lock + ' is already one of your picks this week, so it cannot be the lock as well.');
    if (errors.length) return { ok: false, errors, owed: null, slotsLeft: null };

    const half = halfOf(week);
    const u = usage(weekPicks, half, week);
    for (const c of [...std, lock]) u.counts[c] = (u.counts[c] || 0) + 1;
    u.locks[lock] = (u.locks[lock] || 0) + 1;
    if (u.locks[lock] > MAX_LOCKS_PER_HALF) {
      errors.push(lock + ' has already been your lock ' + MAX_LOCKS_PER_HALF + ' times this half, the most allowed.');
    }

    // Weeks in this half still free to pick, not counting this one.
    const open = new Set(openWeeks || []);
    const remaining = weeksInHalf(half).filter((w) => w !== week && open.has(w) && !u.filled.has(w)).length;
    const slotsLeft = remaining * (STANDARD_PICKS + 1);
    // How far a player is from being able to pick every club 3 times, given some counts and weeks left.
    const shortfall = (counts, weeksLeft) => {
      let owed = 0;
      let perClub = 0;
      const short = [];
      for (const c of clubs) {
        const need = Math.max(0, MIN_PER_HALF - (counts[c] || 0));
        owed += need;
        if (need > weeksLeft) { perClub += need - weeksLeft; short.push(c); }
      }
      return { owed, short, score: perClub + Math.max(0, owed - weeksLeft * (STANDARD_PICKS + 1)) };
    };
    const after = shortfall(u.counts, remaining);
    // The same half with this week still to pick, so a player already behind can save picks that do not make it worse.
    const before = shortfall(usage(weekPicks, half, week).counts, remaining + 1);
    if (after.score > before.score) {
      if (after.short.length) {
        errors.push('With these picks there are not enough weeks left this half to pick ' + after.short.slice(0, 3).join(', ') + (after.short.length > 3 ? ' and ' + (after.short.length - 3) + ' more' : '') + ' ' + MIN_PER_HALF + ' times each.');
      } else {
        errors.push('With these picks you would owe ' + after.owed + ' required picks but have only ' + slotsLeft + ' picks left this half.');
      }
    }
    return { ok: errors.length === 0, errors, owed: after.owed, slotsLeft };
  }

  return { WEEKS, HALF_END, STANDARD_PICKS, MIN_PER_HALF, MAX_LOCKS_PER_HALF, halfOf, weeksInHalf, pickPoints, isPerfect, allowedStandard, usage, check };
});
