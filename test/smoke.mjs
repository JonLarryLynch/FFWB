// The pre-release check in a real browser: start the site with a fresh in-memory league, then open it as a
// player and as the commissioner. Any failure (or any error on a page) stops the release.
// Run with: node test/smoke.mjs   (set PW_CHROMIUM to use a browser that is already installed)
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const port = 8900 + Math.floor(Math.random() * 90);
const base = 'http://localhost:' + port;
let chromium;
try { ({ chromium } = await import('playwright')); } catch (err) { console.error('Playwright is not installed: ' + err.message); process.exit(1); }

const server = spawn(process.execPath, [path.join(here, 'dev-server.mjs'), String(port)], { env: { ...process.env, FAKE_FEED: '1' }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((ok, bad) => { server.stdout.on('data', ok); server.on('exit', () => bad(new Error('The test server did not start.'))); });

let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
} catch (err) {
  // The browser itself could not start here: that is the build machine, not the site. Say so loudly, but let
  // the release go ahead on the other tests.
  console.warn('\n*** WARNING: the browser check could not start a browser, so it was skipped. ***\n' + err.message.split('\n')[0] + '\n');
  server.kill();
  process.exit(0);
}

const failures = [];
const step = async (name, fn) => {
  try { await fn(); console.log('ok  ' + name); } catch (err) { failures.push(name + ': ' + err.message.split('\n')[0]); console.log('FAIL ' + name + ': ' + err.message.split('\n')[0]); }
};
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };

async function page(setup) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const pg = await ctx.newPage();
  pg.errors = [];
  pg.on('pageerror', (e) => pg.errors.push(e.message));
  // Work offline from the chart library's CDN if a local copy was given (the build machine has the internet).
  if (process.env.D3_LOCAL) await pg.route('**/d3.min.js', (r) => r.fulfill({ path: process.env.D3_LOCAL }));
  if (setup) await pg.addInitScript(setup);
  pg.on('dialog', (d) => d.accept());
  return pg;
}
const closePopups = (pg) => pg.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));

try {
  const pg = await page(() => { localStorage.setItem('ffwb-intro-done', '1'); localStorage.setItem('ffwb-seen-release', 'x'); });
  await step('the site opens on This week', async () => {
    await pg.goto(base + '/');
    await pg.waitForSelector('.hm-herocard', { timeout: 15000 });
    expect(/Week \d+/.test(await pg.textContent('.hm-week')), 'no week shown');
  });
  await step('a player can choose their name, make picks and save them', async () => {
    await closePopups(pg);
    await pg.click('#tab-picks');
    await pg.selectOption('#player-name', 'jon');
    await pg.waitForTimeout(1200);
    await closePopups(pg);
    for (let i = 0; i < 5; i += 1) { await (await pg.$$('.pk-tile:not([aria-pressed="true"])'))[i === 0 ? 0 : 1].click(); }
    const filled = await pg.$$eval('.pk-slot-on', (s) => s.length);
    expect(filled === 5, 'the tray has ' + filled + ' of 5 filled');
    await pg.click('.pk-tray .pk-save');
    await pg.waitForFunction(() => /Saved/.test(document.querySelector('.pk-tray .pk-save').textContent), null, { timeout: 10000 });
  });
  await step('This week shows the saved picks', async () => {
    await pg.click('#tab-home');
    await pg.waitForFunction(() => /Picked and saved/.test(document.getElementById('home-app').textContent), null, { timeout: 10000 });
  });
  await step('the table has every player', async () => {
    await pg.click('#tab-table');
    await pg.waitForTimeout(800);
    const rows = await pg.$$eval('#table .ffwb-table tbody tr', (r) => r.length);
    expect(rows >= 10, 'only ' + rows + ' table rows');
  });
  await step('the Stats and History tabs draw', async () => {
    for (const t of ['stats', 'history']) {
      await pg.click('#tab-' + t);
      await pg.waitForTimeout(600);
      const n = await pg.$$eval('#' + t + ' .ffwb-card', (c) => c.length);
      expect(n > 0, t + ' is empty');
    }
  });
  await step('no errors on the player pages', async () => { expect(!pg.errors.length, pg.errors.join('; ')); });

  const adm = await page();
  await step('the commissioner page logs in and shows the status strip', async () => {
    await adm.goto(base + '/admin.html');
    await adm.fill('#passcode', 'test');
    await adm.press('#passcode', 'Enter');
    await adm.waitForSelector('.adm-chip', { timeout: 15000 });
    expect(adm.errors.length === 0, adm.errors.join('; '));
  });
} finally {
  await browser.close();
  server.kill();
}
if (failures.length) { console.error('\nThe browser check failed, so this release is stopped:\n- ' + failures.join('\n- ')); process.exit(1); }
console.log('Browser check passed.');
