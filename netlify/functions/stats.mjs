// Live numbers for the dashboard: GET /api/stats
// YouTube: exact subscribers / views / videos for every channel (YouTube Data API, key in the
// YT_API_KEY environment variable, 1 quota unit per 50 channels). Rumble: followers from each
// channel page. The CDN keeps each answer for 5 minutes, so viewers share one lookup.
import list from './channels.json' with { type: 'json' };

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

const youtube = async key => {
  const out = {};
  for (let i = 0; i < list.youtube.length; i += 50) {
    const ids = list.youtube.slice(i, i + 50).join(',');
    const r = await fetch(`https://www.googleapis.com/youtube/v3/channels?part=statistics&id=${ids}&key=${key}`).then(r => r.json());
    if (r.error) throw new Error(r.error.message);
    for (const c of r.items || []) {
      const s = c.statistics;
      // YouTube's channel view total lags behind its videos' counts; never go below the per-video sum
      // taken at the last full refresh (list.views).
      out[c.id] = { subs: s.hiddenSubscriberCount ? 0 : +s.subscriberCount,
                    views: Math.max(+s.viewCount, list.views?.[c.id] || 0), videos: +s.videoCount };
    }
  }
  return out;
};

const rumble = async () => Object.fromEntries(await Promise.all(list.rumble.map(async url => {
  const html = await fetch(url, { headers: { 'user-agent': UA } }).then(r => r.ok ? r.text() : '').catch(() => '');
  const m = /"thumb":"https[^"]+","name":"[^"]+","followers":(\d+)/.exec(html) || /"followers":(\d+)/.exec(html);
  return [url, m ? +m[1] : null];
})));

export default async () => {
  const key = process.env.YT_API_KEY;
  if (!key) return Response.json({ error: 'YT_API_KEY not set' }, { status: 503 });
  try {
    const [channels, followers] = await Promise.all([youtube(key), rumble()]);
    const sum = k => Object.values(channels).reduce((a, c) => a + c[k], 0);
    const body = {
      at: new Date().toISOString(),
      totals: { subs: sum('subs'), views: sum('views'), videos: sum('videos'),
                rumbleFollowers: Object.values(followers).reduce((a, f) => a + (f || 0), 0) },
      channels, rumble: followers,
    };
    return Response.json(body, { headers: {
      'cache-control': 'public, max-age=60',
      'netlify-cdn-cache-control': 'public, durable, max-age=300, stale-while-revalidate=600',
    } });
  } catch (e) {
    return Response.json({ error: String(e.message || e) }, { status: 502 });
  }
};

export const config = { path: '/api/stats' };
