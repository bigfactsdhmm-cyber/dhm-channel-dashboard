#!/usr/bin/env node
// Resolves data/videos.txt -> channels.js (window.CHANNELS) for index.html.
//
// Keyless by default: oEmbed identifies each channel, the channel page gives the avatar and
// subscriber count, and each watch page gives that video's view count. YouTube publishes a
// channel's *lifetime* view total only through the API, so without a key we sum the views of
// the videos you listed — which is what "views across all the videos" means here anyway.
//
// YT_API_KEY=… upgrades views, video counts and subscribers to the channel's true lifetime
// totals and costs ~2 quota units per 50 channels.
//
// Everything fetched is cached. Pass --refresh to re-fetch it: counts move, channel ids do not.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const KEY = process.env.YT_API_KEY;
const FRESH = process.argv.includes('--refresh');
const CACHE = new URL('./.cache.json', import.meta.url);
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

// --- parse ------------------------------------------------------------------
// "Name (12:10, 17:10): https://youtu.be/ID, Short https://youtube.com/shorts/ID2"
// "Name: https://youtube.com/@handle" (or a bare channel link) works too, for channels with
// nothing public yet.
// -> { order: names first-seen, videos: name -> Set(videoId), links: name -> channel url,
//      when: videoId -> the line's bracketed schedule text, shown on the tile until it's public }.
// Non-link lines are noise.
export function parseVideos(text) {
  const ID = /(?:youtu\.be\/|shorts\/|[?&]v=)([\w-]{11})/g;
  const CH = /youtube\.com\/(@[\w.-]+|channel\/UC[\w-]{22})/;
  const order = [], videos = new Map(), links = new Map(), when = new Map(), lineOf = new Map();
  for (const line of text.split('\n')) {
    const ids = [...line.matchAll(ID)].map(m => m[1]);
    const ch = CH.exec(line)?.[1];
    if (!ids.length && !ch) continue;
    const head = line.split(/:\s*(?:https?:|www\.|youtube\.com|Short\b)/)[0];
    // Curly and straight apostrophes are the same channel ("The Shepherd’s Staff").
    let name = head.replace(/\s*\([^)]*\)\s*$/, '').replace(/[‘’]/g, "'").trim();
    const at = /\(([^)]*)\)\s*$/.exec(head)?.[1].trim();
    if (at) ids.forEach(id => { when.set(id, at); lineOf.set(id, ids[0]); });
    if (ch && (!name || /youtube\.com|^https?:/.test(name))) name = ch.replace(/^channel\//, '');
    if (!name || name.length > 80) continue;
    if (!videos.has(name)) { videos.set(name, new Set()); order.push(name); }
    ids.forEach(id => videos.get(name).add(id));
    if (ch && !links.has(name)) links.set(name, `https://www.youtube.com/${ch}`);
  }
  return { order, videos, links, when, lineOf };
}

// How many channels exist in total, including ones with nothing published yet — only you know
// that, so it is declared as "created: 200" at the top of data/videos.txt.
export const createdCount = text => +(/^created:\s*(\d+)/mi.exec(text ?? '')?.[1] || 0);

// YouTube renders rounded counts: "18 subscribers", "1.2K subscribers", "3.4M subscribers".
const SCALE = { K: 1e3, M: 1e6, B: 1e9 };
export const count = text => {
  const m = /([\d.,]+)\s*([KMB])?/i.exec(text ?? '');
  return m ? Math.round(parseFloat(m[1].replace(/,/g, '')) * (SCALE[m[2]?.toUpperCase()] || 1)) : 0;
};

if (process.argv[1] === fileURLToPath(import.meta.url)) { // skipped when imported by check.mjs

const cache = await readFile(CACHE, 'utf8').then(JSON.parse).catch(() => ({}));
cache.channels ??= {};  // name -> { id, title, url, icon, subs }
cache.views ??= {};     // videoId -> view count
cache.pending ??= {};   // videoId -> 'private' (scheduled) | 'processing' until public; re-checked every build
cache.retry ??= {};     // videoId -> true when YouTube sent back no page (throttled); re-checked every build
// videos.txt is maintained by hand; grok-log.txt and held.json come from Grok Bot's upload log
// via import-log.py.
const source = await readFile(new URL('./data/videos.txt', import.meta.url), 'utf8');
const grok = await readFile(new URL('./data/grok-log.txt', import.meta.url), 'utf8').catch(() => '');
const held = await readFile(new URL('./data/held.json', import.meta.url), 'utf8').then(JSON.parse).catch(() => ({ channels: {} }));
// The 8 official Dag Heward-Mills channels (icon, subscribers, videos, views from the YouTube API);
// the page adds their latest-post times live from the "Official DHM summary" tab.
// Exact lifetime numbers per channel id from the YouTube API (refresh-stats.py); preferred over
// page scraping, which rounds subscribers and only sums the views of the videos we have links for.
const readJson = (path, empty) => readFile(new URL(path, import.meta.url), 'utf8').then(JSON.parse).catch(() => empty);
// data/live/ holds the same files as published (github-sync.sh copies them there). A copy of this repo
// that keeps its own data/*.json (youtube.flowlive.org's server) still gets fresh numbers: per channel,
// whichever record has the later YouTube API time (api_at) wins.
const newer = (a, b) => (!a ? b : !b ? a : (b.api_at || '') >= (a.api_at || '') ? b : a);
const apiStats = await (async () => {
  const own = await readJson('./data/stats.json', {}), live = await readJson('./data/live/stats.json', {});
  for (const [id, r] of Object.entries(live)) own[id] = newer(own[id], r);
  return own;
})();
// Official channels on other platforms (Odysee, Rumble) from fetch-platforms.py.
const platformList = await readJson('./data/live/platforms.json', null) || await readJson('./data/platforms.json', []);
// Which men of God a channel features, and its focus (Men of God channels tab).
const ministers = await readFile(new URL('./data/ministers.json', import.meta.url), 'utf8').then(JSON.parse).catch(() => ({}));
const norm2 = t => t.toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim();
const ministerOf = new Map(Object.entries(ministers).map(([k, v]) => [norm2(k), v]));
const officialList = await (async () => {
  const own = await readJson('./data/official.json', []), live = await readJson('./data/live/official.json', []);
  const byId = new Map(live.map(o => [o.id, o]));
  return own.length ? own.map(o => newer(o, byId.get(o.id))) : live;
})();
// data/categories.txt: "## Category" headings, channel names under each (as they appear on the page).
const catText = await readFile(new URL('./data/categories.txt', import.meta.url), 'utf8').catch(() => '');
const categories = [], categoryOf = new Map(), spelled = new Map();
const norm = t => t.toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim();
for (const line of catText.split('\n')) {
  const t = line.trim();
  if (t.startsWith('## ')) categories.push(t.slice(3).trim());
  else if (t && !t.startsWith('#') && categories.length) { categoryOf.set(norm(t), categories.at(-1)); spelled.set(norm(t), t); }
}
const { order, videos, links, when, lineOf } = parseVideos(`${source}\n${grok}`);
// The channel total: the live sheet's channel list when there is one, else the hand-kept line in videos.txt.
const created = createdCount(grok) || Math.max(createdCount(source), order.length);

const pool = async (items, n, fn) => {
  const it = items[Symbol.iterator]();
  await Promise.all(Array.from({ length: n }, async () => { for (const x of it) await fn(x); }));
};
// A channel page also lists the channels it features, each with its own "N subscribers", so the
// first count on the page can belong to someone else. The channel's own header pairs its
// subscriber count with its video count; no subscriber part there means none (or hidden).
const header = html => {
  const m = /"content":"([\d.,]+[KMBkmb]?) subscribers?"[^\]]{0,400}?"content":"([\d.,]+[KMBkmb]?) videos?"/.exec(html);
  if (m) return { subs: count(m[1]), videos: count(m[2]) };
  const v = /"content":"@[^"]+"[^\]]{0,400}?"content":"([\d.,]+[KMBkmb]?) videos?"/.exec(html);
  return { subs: 0, videos: v ? count(v[1]) : 0 };
};
const page = url => fetch(url, { headers: { 'user-agent': UA } }).then(r => r.ok ? r.text() : '').catch(() => '');
const grab = (html, re) => html.match(re)?.[1];

// --- resolve channels -------------------------------------------------------
// One representative video per channel is enough to find the channel.
const stale = order.filter(n => FRESH || !cache.channels[n]?.id);
if (stale.length) console.error(`resolving ${stale.length} channel(s)…`);
const todo = stale.filter(n => videos.get(n).size);

// Channel-link-only entries: the channel page itself, and the view counts on its first page of
// videos and shorts (the only per-video views YouTube shows without a key or a video link).
const sum = (html, re) => [...html.matchAll(re)].reduce((a, m) => a + count(m[1]), 0);
const fromLink = async name => {
  const url = links.get(name);
  const html = await page(url);
  const id = grab(html, /"externalId":"([^"]+)"/);
  if (!id) return;
  const [vids, shorts] = await Promise.all([page(`${url}/videos`), page(`${url}/shorts`)]);
  cache.channels[name] = {
    id,
    title: grab(html, /property="og:title" content="([^"]+)"/)?.replace(/&amp;/g, '&'),
    url,
    subs: header(html).subs,
    icon: grab(html, /property="og:image" content="([^"]+)"/) || '',
    videos: header(html).videos,
    views: sum(vids, /"accessibilityLabel":"([\d.,]+[KMBkmb]?) views?"/g) + sum(shorts, /"secondaryText":\{"content":"([\d.,]+[KMBkmb]?) views?"/g),
  };
};
await pool(stale.filter(n => !videos.get(n).size), 8, fromLink);

if (KEY) {
  const reps = todo.map(n => [n, [...videos.get(n)][0]]);
  for (let i = 0; i < reps.length; i += 50) {
    const batch = reps.slice(i, i + 50);
    const r = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${batch.map(b => b[1]).join(',')}&key=${KEY}`).then(r => r.json());
    if (r.error) throw new Error(r.error.message);
    const byVid = new Map(r.items.map(v => [v.id, v.snippet.channelId]));
    for (const [name, vid] of batch) if (byVid.has(vid)) cache.channels[name] = { id: byVid.get(vid) };
  }
} else {
  await pool(todo, 8, async name => {
    const vid = [...videos.get(name)][0];
    const o = await fetch(`https://www.youtube.com/oembed?url=https://youtu.be/${vid}&format=json`).then(r => r.ok ? r.json() : null).catch(() => null);
    if (!o?.author_url) return;
    const html = await page(o.author_url);
    if (!grab(html, /"externalId":"([^"]+)"/) && cache.channels[name]?.id) return; // throttled: keep last
    cache.channels[name] = {
      id: grab(html, /"externalId":"([^"]+)"/) || o.author_url,
      title: o.author_name,
      url: o.author_url,
      // Absent entirely when a channel has no subscribers yet.
      subs: header(html).subs,
      icon: grab(html, /property="og:image" content="([^"]+)"/) || '',
    };
  });
}

// Channels whose listed videos are all still private can't be found through a video; fall back to
// their channel link when we have one.
await pool(stale.filter(n => !cache.channels[n]?.id && links.has(n)), 8, fromLink);

// --- views ------------------------------------------------------------------
// Keyless only: with a key the channel's lifetime total comes back below, no per-video work.
if (!KEY) {
  const ids = [...videos.values()].flatMap(s => [...s]).filter(id => FRESH || cache.views[id] === undefined || cache.pending[id] || cache.retry[id]);
  if (ids.length) console.error(`counting views on ${ids.length} video(s)…`);
  await pool(ids, 8, async id => {
    const html = await page(`https://www.youtube.com/watch?v=${id}`);
    const status = grab(html, /"playabilityStatus":\{"status":"([A-Z_]+)"/);
    // No status means a throttled or consent page, not a real answer: keep the last count.
    if (!status) { cache.retry[id] = true; return; }
    delete cache.retry[id];
    cache.views[id] = count(grab(html, /"viewCount":"(\d+)"/));
    // Scheduled uploads read as "Private video" until they premiere; some sit in "processing".
    const reason = grab(html, /"playabilityStatus":\{"status":"[A-Z_]+","reason":"([^"]*)"/) || '';
    if (status === 'OK') delete cache.pending[id];
    else cache.pending[id] = /processing/i.test(reason) ? 'processing' : 'private';
  });
}
await writeFile(CACHE, JSON.stringify(cache));

// --- enrich (API only: avatars, lifetime views, subscribers, true video counts) ---
const stats = new Map();
if (KEY) {
  const ids = order.map(n => cache.channels[n]?.id).filter(Boolean);
  for (let i = 0; i < ids.length; i += 50) {
    const r = await fetch(`https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&id=${ids.slice(i, i + 50).join(',')}&key=${KEY}`).then(r => r.json());
    if (r.error) throw new Error(r.error.message);
    for (const c of r.items) stats.set(c.id, c);
  }
}

// --- emit -------------------------------------------------------------------
// Chrome blocks the s900 avatar variant with ERR_BLOCKED_BY_ORB; s176 loads fine and is 1/25th the bytes.
const avatar = u => u.replace(/=s\d+/, '=s176');

// Never shown, even if its links get pasted into videos.txt again. Matched by channel id or
// handle, since the name in videos.txt can be anything.
const HIDDEN = ['UCRLB02nZLdmSpXmXe8YCX1A', '@DagHeward-Mills1999'];
const hidden = hit => HIDDEN.some(h => hit.id === h || hit.url?.toLowerCase().endsWith('/' + h.toLowerCase()));

// Two names can land on one channel (a renamed channel, or a log row filed under a video title):
// fold the later name's videos into the first so the channel shows once.
const firstName = new Map();
const names = order.filter(name => {
  const id = cache.channels[name]?.id;
  if (!id) return true;
  if (!firstName.has(id)) return firstName.set(id, name), true;
  const into = firstName.get(id);
  videos.get(name).forEach(v => videos.get(into).add(v));
  console.error(`  merged "${name}" into "${into}" (same channel)`);
  return false;
});

const channels = names.flatMap((name, i) => {
  const hit = cache.channels[name];
  if (!hit) { console.error(`  ! unresolved: ${name}`); return []; }
  if (hidden(hit)) { console.error(`  - hidden: ${name}`); return []; }
  const c = stats.get(hit.id);
  const api = apiStats[hit.id];
  const t = c?.snippet.thumbnails;
  return [{
    id: hit.id,  // YouTube channel id: the page's live numbers are matched to tiles by it
    name: c?.snippet.title || hit.title || name,
    ...(ministerOf.get(norm2(c?.snippet.title || hit.title || name)) || {}),
    ...((cat => cat && { category: cat })(categoryOf.get(norm(c?.snippet.title || hit.title || name)) || categoryOf.get(norm(name)))),
    url: c ? `https://www.youtube.com/channel/${hit.id}` : hit.url,
    icon: avatar(t?.high?.url || t?.default?.url || hit.icon || ''),
    videos: api ? api.videos : +(c?.statistics.videoCount ?? hit.videos ?? videos.get(name).size),
    views: api ? api.views : c ? +c.statistics.viewCount : hit.views ?? [...videos.get(name)].reduce((a, id) => a + (cache.views[id] || 0), 0),
    subs: api ? api.subs : c ? +c.statistics.subscriberCount : (hit.subs ?? 0),
    week: api?.week ?? 0,  // public videos published in the last 7 days
    // Channel age when the API knows it; otherwise position in videos.txt.
    added: c?.snippet.publishedAt || i,
    // Not-yet-public videos, by their schedule text from videos.txt.
    ...(() => {
      const ids = [...videos.get(name)];
      // Grok's go-live times, one entry per upload line (a main video and its Short together);
      // the page shows only the times still in the future, so past ones drop off by themselves.
      const soon = [...new Map(ids.filter(id => when.has(id)).map(id => [lineOf.get(id), id])).values()];
      const stuck = ids.filter(id => cache.pending[id] === 'processing').length;
      return {
        ...(soon.length && { scheduled: soon.map(id => when.get(id)) }),
        ...(stuck && { processing: stuck }),
        ...(held.channels[name] && { held: held.channels[name] }),
      };
    })(),
  }];
});

// Categorised channels with no tile yet (kept for the build log; the page shows live channels only).
const heldBy = new Map(Object.entries(held.channels).map(([n, why]) => [norm(n), why]));
const inLog = new Set(order.map(norm));
const pendingTiles = [...categoryOf].filter(([k]) => !channels.some(c => norm(c.name) === k)).flatMap(([k, category]) => {
  if (heldBy.has(k)) return [{ name: spelled.get(k), category, why: heldBy.get(k) }];
  if (inLog.has(k)) return [{ name: spelled.get(k), category, why: { 'not live yet': 1 } }];
  return [];
});
// Held channels with no tile (not created yet, stuck at a phone check, …) get their own list.
const shown = new Set(names.filter(n => cache.channels[n]));
const heldOnly = Object.entries(held.channels).filter(([n]) => !shown.has(n)).map(([name, why]) => ({ name, why }));

// Channels created = Grok's count plus live channels missing from Grok's channel list
// (e.g. Lovely Diamond Nations / Camps added by hand, Fire on the Altar which Grok skips).
const grokKeys = new Set((grok.match(/youtube\.com\/(@[^\s/?]+|channel\/UC[\w-]{22})/g) || []).map(u => u.replace(/^youtube\.com\/(channel\/)?/, '').toLowerCase()));
const keysOf = c => [c.id, (c.url.match(/@[^/?]+/) || [''])[0]].filter(Boolean).map(k => k.toLowerCase());
const notInGrok = createdCount(grok) ? channels.filter(c => !keysOf(c).some(k => grokKeys.has(k))) : [];
const createdTotal = Math.max(created + notInGrok.length, channels.length);
if (notInGrok.length) console.error(`  + ${notInGrok.length} channels not in Grok's list counted as created: ${notInGrok.map(c => c.name.trim()).join(', ')}`);
await writeFile(new URL('./channels.js', import.meta.url),
  `window.CREATED = ${createdTotal};\nwindow.PLATFORMS = ${JSON.stringify(platformList)};\nwindow.OFFICIAL = ${JSON.stringify(officialList)};\nwindow.PENDING = [];\nwindow.CATEGORIES = ${JSON.stringify(categories)};\nwindow.HELD = ${JSON.stringify(heldOnly)};\nwindow.UPDATED = ${JSON.stringify(new Date().toISOString())};\nwindow.LOG_UPDATED = ${JSON.stringify(held.updated || '')};\nwindow.CHANNELS = ${JSON.stringify(channels, null, 1)};\n`);
const waiting = new Set([...order, ...Object.keys(held.channels)].map(norm));
const unfiled = [...categoryOf.keys()].filter(k => !channels.some(c => norm(c.name) === k) && !waiting.has(k));
if (unfiled.length) console.error(`  ! categories.txt names not on the page: ${unfiled.join(', ')}`);
console.error(`${channels.length} of ${created} channels live -> channels.js`);
}
