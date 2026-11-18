#!/usr/bin/env python3
""""Videos this week" from each channel's public YouTube feed (no API quota), so it can move every 30 min.

Updates the `week` number in data/stats.json (network channels) and data/official.json (official channels).
A feed lists a channel's latest 15 videos; if all 15 are from this week the channel posted more than the
feed shows, so the larger of the feed count and the last YouTube API count is kept.
Also moves "videos published": `videos` = the count from the last YouTube API refresh (`videos_api`,
taken at `api_at`) plus the feed videos published since then, so the total grows between the 4-hourly
API refreshes.
Prints "changed: N" (channels whose number moved).
"""
import json, os, re, urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
STATS, OFFICIAL = os.path.join(HERE, "data/stats.json"), os.path.join(HERE, "data/official.json")
now = datetime.now(timezone.utc)
since = now - timedelta(days=7)


def feed_week(cid):
    try:
        xml = urllib.request.urlopen(urllib.request.Request(
            f"https://www.youtube.com/feeds/videos.xml?channel_id={cid}", headers={"user-agent": "Mozilla/5.0"}),
            timeout=20).read().decode("utf-8", "ignore")
    except Exception:
        return None
    entries = re.findall(r"<entry>.*?<published>([^<]+)</published>", xml, re.S)
    times = [datetime.fromisoformat(t) for t in entries]
    return sum(since <= t <= now for t in times), len(times), times


stats = json.load(open(STATS))
official = json.load(open(OFFICIAL))
ids = [i for i in stats if re.fullmatch(r"UC[\w-]{22}", i)] + [o["id"] for o in official]
with ThreadPoolExecutor(8) as ex:
    res = dict(zip(ids, ex.map(feed_week, ids)))

changed = failed = 0
# channels refreshed before api_at was recorded: count from the last API refresh time
try:
    LAST_API = datetime.fromtimestamp(int(open(os.path.expanduser("~/1000-channels/state/yt-time")).read()), timezone.utc)
except Exception:
    LAST_API = now


def update(rec, cid):
    global changed, failed
    r = res.get(cid)
    if r is None:
        failed += 1
        return
    week, listed, times = r
    if listed >= 15 and week >= listed:  # feed full of this week's videos: there may be more
        week = max(week, rec.get("week") or 0)
    moved = week != rec.get("week")
    rec["week"] = week
    # videos published = last API count + feed videos published since that refresh
    base = rec.setdefault("videos_api", rec.get("videos") or 0)
    at = datetime.fromisoformat(rec.setdefault("api_at", LAST_API.isoformat()))
    new = sum(t > at for t in times)
    if listed >= 15 and new >= listed:  # feed full of new videos: keep the larger count
        new = max(new, (rec.get("videos") or 0) - base)
    if base + new != rec.get("videos"):
        rec["videos"] = base + new
        moved = True
    changed += moved


for cid, rec in stats.items():
    if cid in res:
        update(rec, cid)
for o in official:
    update(o, o["id"])
json.dump(stats, open(STATS, "w"), indent=1)
json.dump(official, open(OFFICIAL, "w"), indent=1)
total = sum(r.get("week") or 0 for r in stats.values()) + sum(o.get("week") or 0 for o in official)
vids = sum(r.get("videos") or 0 for r in stats.values()) + sum(o.get("videos") or 0 for o in official)
print(f"week from feeds: {len(ids) - failed} channels read, {failed} failed, total {total}, videos published {vids}")
print(f"changed: {changed}")
