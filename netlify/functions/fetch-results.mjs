// Scheduled job: every Tuesday at 9 AM Central, look up Premier League results and kickoff times and save
// them for the commissioner page, then save a backup of the whole league. Needs FOOTBALL_DATA_KEY on Netlify
// for the results; the backup runs either way.
//
// Netlify schedules run on UTC, and 9 AM Central is 14:00 UTC in summer time and 15:00 UTC in winter.
// So the job is scheduled for both hours and only does anything in the one that is 9 AM in Chicago.
import { getStore } from '@netlify/blobs';
import { runFetch } from '../lib/autoresults.mjs';
import { saveBackup } from '../lib/backup.mjs';

const chicagoHour = (date) => Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hourCycle: 'h23' }).format(date));

export default async () => {
  if (chicagoHour(new Date()) !== 9) return;
  const store = getStore({ name: 'ffwb-league', consistency: 'strong' });
  try {
    const saved = await saveBackup(store);
    console.log(saved ? 'Saved backup ' + saved : 'Nothing to back up yet.');
  } catch (err) { console.error('Backup failed: ' + err.message); }
  const key = (globalThis.Netlify && globalThis.Netlify.env ? globalThis.Netlify.env.get('FOOTBALL_DATA_KEY') : undefined) || process.env.FOOTBALL_DATA_KEY;
  if (!key) { console.log('FOOTBALL_DATA_KEY is not set, so no results were fetched.'); return; }
  const doc = await runFetch(store, key, fetch);
  console.log(doc ? 'Checked weeks ' + Object.keys(doc.weeks).join(', ') + (doc.error ? '. Problem: ' + doc.error : '') : 'The league has no data yet.');
};

export const config = { schedule: '0 14,15 * * 2' };
