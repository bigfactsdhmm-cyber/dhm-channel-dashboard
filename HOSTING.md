# DHM Channel Dashboard — handover

A dashboard of the Dag Heward-Mills YouTube channel network: ~250 network channels, the 8 official
YouTube channels, and official channels on Rumble and Odysee. Subscribers, views, videos, videos
posted this week, scheduled uploads, and tabs per category.

Current live copy: https://dhmm-youtube-channels.netlify.app (TV mode: `/?tv`).

## What it is

A **static website** (`index.html` + `channels.js` + `manifest.webmanifest` + `icon.svg`) that is
**rebuilt from data on a schedule**. Any static host works: Netlify, Vercel, Cloudflare Pages,
GitHub Pages, Hostinger, an nginx server.

Plain-data copies for other tools and AI platforms are built alongside it:
`channels.json`, `channels.csv`, `summary.txt`.

## Data sources

| Source | What it gives | Read by |
|---|---|---|
| Grok's Google Sheet `YOUR_GOOGLE_SHEET_ID` (must be shared *Anyone with the link → Viewer*) | Every channel (All channels tab), uploads and go-live times (Scheduled uploads), held items, official-channel feed | `import-log.py` (and the page itself, live, for the official feed) |
| YouTube Data API | Exact subscribers, views, videos, videos this week, profile pictures | `refresh-stats.py` |
| Odysee public API, Rumble channel pages | Official channels on those platforms | `fetch-platforms.py` |

## Rebuild steps (run every 30 minutes on the new host)

Needs Node 20+ and Python 3.9+ with `openpyxl` and `google-api-python-client`.

```sh
python3 import-log.py        # Grok's sheet -> data/grok-log.txt, data/held.json
python3 refresh-stats.py     # YouTube numbers -> data/stats.json, data/official.json
python3 fetch-platforms.py   # Rumble/Odysee -> data/platforms.json
node build.mjs               # -> channels.js
node check.mjs               # sanity checks (fails loudly if the data looks wrong)
node export-data.mjs         # -> channels.json, channels.csv, summary.txt
```

Then publish: `index.html channels.js manifest.webmanifest icon.svg channels.json channels.csv summary.txt`.
`dashboard-website.sh` is the exact script used on the original Mac (it publishes to Netlify).

### YouTube access on the new host

`refresh-stats.py` currently signs in with a YouTube OAuth login kept on the original Mac
(`~/youtube-cleanup/token.json`) — **that login is not included**. On a new host, use a
**YouTube Data API key** instead (Google Cloud console → APIs & Services → Credentials → API key,
restricted to *YouTube Data API v3*). `build.mjs` already accepts it as `YT_API_KEY=… node build.mjs`;
switch `refresh-stats.py` to `build("youtube", "v3", developerKey=os.environ["YT_API_KEY"])`.
Cost: about 1,500 of the free 10,000 daily quota units per full refresh.

### Optional live numbers (every 5 minutes)

`netlify/functions/stats.mjs` serves `/api/stats` on Netlify (needs the `YT_API_KEY` environment
variable); the page polls it and updates subscribers/views/followers in place. On another host,
port it to that host's serverless functions or skip it — the page works without it.

## Where things are configured

| File | Controls |
|---|---|
| `data/categories.txt` | The tabs and which channels are in each (Christian Gist, FLOW, Association, Camps, People, Other Languages, Men of God). Anything not listed = Fan channels |
| `data/ministers.json` | Men of God channels: which ministers each features, and its focus |
| `data/official.json` | The 8 official YouTube channels |
| `fetch-platforms.py` | Which Odysee and Rumble channels are shown (lists at the top) |
| `import-log.py` | `EXCLUDE` (channels kept off the dashboard: Dag Heward-Mills 1999, The Poimano), `NOT_HELD` |
| `data/videos.txt` | Hand-added links (e.g. Many Are Called) |
| `data/live-sheet-id.txt` | Which Google Sheet is read |

## Decisions already made (keep these)

- Tab order: Official YouTube Channels (home) → Alternative Platforms (Rumble before Odysee) → Fan →
  Christian Gist → FLOW → Association → Camps → People → Other Languages → Men of God → All channels.
- "All channels" is grouped by section; the official channels appear once (Loyalty counted as official).
- No "Newest" sort, no "Overdue" tags, no "On hold" section.
- Totals = YouTube (network + official) + Rumble followers/views. Odysee numbers aren't public.
- Views = the higher of YouTube's channel total and the sum of its videos' views (channel totals lag).
- Scheduled = Grok's go-live times still in the future (the page re-checks against the clock).
- The open tab is kept in the address (`#christian-gist-channels`), so refresh/shared links reopen it.

## Known gaps

- Dag Heward-Mills Anointing Channel: its link in Grok's sheet gives "page not found".
- Odysee followers/views need a logged-in Odysee account.
- Rumble: only the 7 channels found so far; more exist but have numeric addresses.
