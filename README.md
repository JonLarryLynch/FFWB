# FFWB

The FFWB pick'em league site, live at https://timmytyrantfootball.netlify.app.

- `public/` is the website: make picks, this season's table and race, awards, player cards, all-time records and past seasons. `admin.html` is the commissioner page.
- `netlify/functions/api.mjs` is the league API at `/api/*`. It keeps picks and results in Netlify Blobs (the `ffwb-league` store). The code lives in `netlify/lib/handler.mjs`.
- `public/js/rules.js` holds the league rules, used by both the website and the API.
- `netlify/lib/seed.mjs` is this season through week 7, copied from the league sheet. It fills the store the first time the site runs.
- `public/data/history.js` holds 2016-17 to 2025-26. `public/data/season.js` is a saved copy the site falls back to if the API cannot be reached.

The commissioner page needs an `ADMIN_PASSCODE` environment variable set on Netlify.

Results: `netlify/functions/fetch-results.mjs` runs every Tuesday at 9 AM Central and fetches Premier League results from football-data.org (`netlify/lib/autoresults.mjs`). They are saved as suggestions that pre-fill the commissioner page. It needs a `FOOTBALL_DATA_KEY` environment variable on Netlify. Never commit the key: this repository is public.

Tests: `npm install`, then `node test/api.test.mjs` and `node test/autoresults.test.mjs`. To run the site locally with in-memory storage: `node test/dev-server.mjs` (passcode `test`).
