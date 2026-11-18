#!/usr/bin/env node
// Plain-data copies of the dashboard for other tools and AI platforms (they can't run the page's
// JavaScript): channels.json, channels.csv and summary.txt, built from channels.js.
import { readFile, writeFile } from 'node:fs/promises';

const w = {};
new Function('window', await readFile(new URL('./channels.js', import.meta.url), 'utf8'))(w);
const site = 'https://dhmm-youtube-channels.netlify.app';
const officialNames = new Set(w.OFFICIAL.map(o => o.name.trim().toLowerCase()));

// Same rule as the page: a go-live time counts as scheduled while it is still ahead (Accra = UTC).
const MON = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
const ahead = c => {
  let day, mon, n = 0;
  for (const text of c.scheduled || []) for (const part of text.split(/,\s*/)) {
    const m = /^(Short\s+)?(?:(\d{1,2}) ([A-Z][a-z]{2}) )?(\d{1,2}):(\d{2})$/.exec(part.trim());
    if (!m) continue;
    if (m[2]) { day = +m[2]; mon = MON[m[3]]; }
    if (day !== undefined && Date.UTC(new Date().getUTCFullYear(), mon, day, +m[4], +m[5]) > Date.now()) n++;
  }
  return n;
};

const rows = [
  ...w.OFFICIAL.map(o => ({ section: 'Official YouTube channels', platform: 'YouTube', name: o.name, url: o.url,
    subscribers: o.subs, views: o.views, videos: o.videos, videos_this_week: o.week || 0, scheduled: 0, ministers: '' })),
  ...w.PLATFORMS.map(p => ({ section: 'Alternative Platforms', platform: p.platform, name: p.name, url: p.url,
    subscribers: p.followers ?? '', views: p.views ?? '', videos: p.videos ?? '', videos_this_week: p.week || 0, scheduled: 0, ministers: '' })),
  ...w.CHANNELS.filter(c => !officialNames.has(c.name.trim().toLowerCase())).map(c => ({
    section: c.category || 'Fan channels', platform: 'YouTube', name: c.name.trim(), url: c.url,
    subscribers: c.subs, views: c.views, videos: c.videos, videos_this_week: c.week || 0, scheduled: ahead(c),
    ministers: c.ministers ? `${c.ministers}${c.focus ? ` (${c.focus})` : ''}` : '' })),
];

const num = v => (typeof v === 'number' ? v : 0);
const sum = (list, k) => list.reduce((a, r) => a + num(r[k]), 0);
const yt = rows.filter(r => r.platform === 'YouTube');
const totals = {
  channels: rows.length, youtube_channels: yt.length,
  subscribers: sum(rows, 'subscribers'), views: sum(rows, 'views'), videos: sum(yt, 'videos'),
  videos_this_week: sum(rows, 'videos_this_week'), videos_scheduled: sum(rows, 'scheduled'),
};
const generated = new Date().toISOString();

await writeFile(new URL('./channels.json', import.meta.url), JSON.stringify({
  source: site, generated, data_updated: w.UPDATED, upload_log_updated: w.LOG_UPDATED,
  notes: 'YouTube numbers are exact lifetime figures from the YouTube Data API (views = max(channel total, sum of video views)). '
    + 'Alternative Platforms: Rumble, Odysee and BitChute subscribers = followers. '
    + '"scheduled" = videos with a go-live time still ahead when this file was made.',
  totals, channels: rows }, null, 1));

const cols = Object.keys(rows[0]);
const esc = v => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
await writeFile(new URL('./channels.csv', import.meta.url), [cols.join(','), ...rows.map(r => cols.map(k => esc(r[k])).join(','))].join('\n') + '\n');

const sections = [...new Set(rows.map(r => r.section))];
const fmt = n => n.toLocaleString('en-US');
const top = (k, n = 10) => [...yt].sort((a, b) => num(b[k]) - num(a[k])).slice(0, n)
  .map((r, i) => `  ${i + 1}. ${r.name} (${r.section}): ${fmt(num(r[k]))}`).join('\n');
await writeFile(new URL('./summary.txt', import.meta.url), `DAG HEWARD-MILLS YOUTUBE CHANNEL NETWORK - DASHBOARD SUMMARY
Source: ${site}   (full data: ${site}/channels.json , spreadsheet: ${site}/channels.csv)
Generated: ${generated}   Numbers refreshed: ${w.UPDATED}   Upload log: ${w.LOG_UPDATED}

TOTALS
  Channels tracked: ${fmt(totals.channels)} (${fmt(totals.youtube_channels)} on YouTube)
  Subscribers/followers: ${fmt(totals.subscribers)}
  Views: ${fmt(totals.views)}
  Videos on YouTube: ${fmt(totals.videos)}
  Videos posted in the last 7 days: ${fmt(totals.videos_this_week)}
  Videos scheduled (go-live time still ahead): ${fmt(totals.videos_scheduled)}

SECTIONS
${sections.map(s => { const l = rows.filter(r => r.section === s);
  return `  ${s}: ${l.length} channels, ${fmt(sum(l, 'subscribers'))} subscribers, ${fmt(sum(l, 'views'))} views, ${fmt(sum(l, 'videos_this_week'))} videos this week`; }).join('\n')}

TOP 10 BY SUBSCRIBERS
${top('subscribers')}

TOP 10 BY VIEWS
${top('views')}

MOST ACTIVE THIS WEEK (videos posted in the last 7 days)
${top('videos_this_week')}

MEN OF GOD CHANNELS
${rows.filter(r => r.ministers).map(r => `  ${r.name}: ${r.ministers}`).join('\n') || '  none'}

NOTES
  - YouTube figures are exact lifetime numbers from the YouTube Data API.
  - Rumble, Odysee and BitChute subscribers are followers.
  - Each row of channels.csv is one channel with its section, platform, link and numbers.
`);
console.error(`exported ${rows.length} channels -> channels.json, channels.csv, summary.txt`);
