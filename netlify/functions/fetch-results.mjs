// Scheduled job: every two hours, look up Premier League results and save them as suggestions
// for the commissioner page. Needs the FOOTBALL_DATA_KEY environment variable on Netlify.
import { getStore } from '@netlify/blobs';
import { runFetch } from '../lib/autoresults.mjs';

export default async () => {
  const key = (globalThis.Netlify && globalThis.Netlify.env ? globalThis.Netlify.env.get('FOOTBALL_DATA_KEY') : undefined) || process.env.FOOTBALL_DATA_KEY;
  if (!key) { console.log('FOOTBALL_DATA_KEY is not set, so no results were fetched.'); return; }
  const doc = await runFetch(getStore({ name: 'ffwb-league', consistency: 'strong' }), key, fetch);
  console.log(doc ? 'Checked weeks ' + Object.keys(doc.weeks).join(', ') + (doc.error ? '. Problem: ' + doc.error : '') : 'The league has no data yet.');
};

export const config = { schedule: '15 */2 * * *' };
