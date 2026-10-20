// Scheduled job: every hour, send pick reminders to anyone who has turned on notifications and has not picked
// for the current week, about a day before its first kickoff and again about three hours before.
// It only reads the saved fixtures; it never calls football-data.org.
import { getStore } from '@netlify/blobs';
import { remind } from '../lib/push.mjs';

export default async () => {
  const done = await remind(getStore({ name: 'ffwb-league', consistency: 'strong' }));
  if (done.length) console.log('Reminders: ' + JSON.stringify(done));
};

export const config = { schedule: '@hourly' };
