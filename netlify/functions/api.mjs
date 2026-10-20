// Netlify entry point for the league API at /api/*.
import { getStore } from '@netlify/blobs';
import { createHandler } from '../lib/handler.mjs';

const env = (name) => (globalThis.Netlify && globalThis.Netlify.env ? globalThis.Netlify.env.get(name) : undefined) || process.env[name];

export default createHandler(() => getStore({ name: 'ffwb-league', consistency: 'strong' }), () => env('ADMIN_PASSCODE'), { footballKey: () => env('FOOTBALL_DATA_KEY') });

export const config = { path: '/api/*' };
