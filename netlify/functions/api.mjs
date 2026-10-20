// Netlify entry point for the league API at /api/*.
import { getStore } from '@netlify/blobs';
import { createHandler } from '../lib/handler.mjs';

const passcode = () => (globalThis.Netlify && globalThis.Netlify.env ? globalThis.Netlify.env.get('ADMIN_PASSCODE') : undefined) || process.env.ADMIN_PASSCODE;

export default createHandler(() => getStore({ name: 'ffwb-league', consistency: 'strong' }), passcode);

export const config = { path: '/api/*' };
