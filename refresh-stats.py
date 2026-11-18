#!/usr/bin/env python3
"""Exact lifetime subscribers / views / videos for every channel, from the YouTube Data API.

Uses the YouTube login in ~/youtube-cleanup/token.json (read-only use: channels.list, 1 quota unit
per 50 channels). Writes data/stats.json (channel id -> numbers) for the network channels found in
.cache.json, and refreshes data/official.json. build.mjs prefers these numbers over page scraping.
"""
import json, os, re, time, warnings
warnings.filterwarnings("ignore")
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build

HERE = os.path.dirname(os.path.abspath(__file__))
TOKEN = os.path.expanduser("~/youtube-cleanup/token.json")
creds = Credentials.from_authorized_user_file(TOKEN)
if not creds.valid:
    creds.refresh(Request())
yt = build("youtube", "v3", credentials=creds)

# Google sometimes rejects a request with 401 mid-run even though the login was just renewed;
# every request renews the login and retries (up to 3 times) when that happens.
from googleapiclient.http import HttpRequest
from googleapiclient.errors import HttpError
_execute = HttpRequest.execute
def _execute_renewing(self, *a, **k):
    for attempt in range(4):
        try:
            return _execute(self, *a, **k)
        except HttpError as e:
            if e.resp.status != 401 or attempt == 3:
                raise
            creds.refresh(Request())
            self.headers["authorization"] = f"Bearer {creds.token}"
            time.sleep(1 + attempt)
HttpRequest.execute = _execute_renewing


def ex(request):
    """Run an API request; if the login expired mid-run (401), renew it and try again."""
    from googleapiclient.errors import HttpError
    for attempt in range(3):
        try:
            return request.execute()
        except HttpError as e:
            if e.resp.status != 401 or attempt == 2:
                raise
            creds.refresh(Request())

WEEK_AGO = (__import__("datetime").datetime.utcnow() - __import__("datetime").timedelta(days=7)).strftime("%Y-%m-%dT%H:%M:%S")


def video_views(uploads):
    """Sum of the views of every public video in a channel's uploads playlist. YouTube's channel-level
    view total lags (days, for new channels with a fast-growing video); the per-video counts don't."""
    ids, tok, week = [], None, 0
    while True:
        try:
            r = ex(yt.playlistItems().list(part="contentDetails", playlistId=uploads, maxResults=50, pageToken=tok))
        except Exception:
            return None, 0  # no public uploads playlist
        ids += [i["contentDetails"]["videoId"] for i in r.get("items", [])]
        # public videos published in the last 7 days
        week += sum(1 for i in r.get("items", []) if i["contentDetails"].get("videoPublishedAt", "") >= WEEK_AGO)
        tok = r.get("nextPageToken")
        if not tok:
            break
    total = 0
    for k in range(0, len(ids), 50):
        for v in yt.videos().list(part="statistics", id=",".join(ids[k:k + 50])).execute().get("items", []):
            total += int(v["statistics"].get("viewCount", 0))
    return total, week


NOW_ISO = __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat()


def fetch(ids):
    out = {}
    ids = [i for i in dict.fromkeys(ids) if i and i.startswith("UC")]
    for k in range(0, len(ids), 50):
        r = yt.channels().list(part="snippet,statistics,contentDetails", id=",".join(ids[k:k + 50])).execute()
        for ch in r.get("items", []):
            st, sn = ch["statistics"], ch["snippet"]
            t = sn["thumbnails"]
            summed, week = video_views(ch["contentDetails"]["relatedPlaylists"]["uploads"])
            out[ch["id"]] = dict(
                title=sn["title"],
                subs=0 if st.get("hiddenSubscriberCount") else int(st.get("subscriberCount", 0)),
                hidden=bool(st.get("hiddenSubscriberCount")),
                views=max(int(st.get("viewCount", 0)), summed or 0), channel_views=int(st.get("viewCount", 0)),
                videos=int(st.get("videoCount", 0)), week=week,
                videos_api=int(st.get("videoCount", 0)), api_at=NOW_ISO,
                icon=re.sub(r"=s\d+", "=s176", (t.get("high") or t.get("medium") or t["default"])["url"]))
    return out

cache = json.load(open(os.path.join(HERE, ".cache.json")))
network = fetch(v.get("id") for v in cache.get("channels", {}).values())
json.dump(network, open(os.path.join(HERE, "data/stats.json"), "w"), indent=1)

op = os.path.join(HERE, "data/official.json")
official = json.load(open(op))
fresh = fetch(o["id"] for o in official)
for o in official:
    f = fresh.get(o["id"])
    if f:
        o.update(name=f["title"], icon=f["icon"], subs=f["subs"], views=f["views"], videos=f["videos"], week=f["week"],
                     videos_api=f["videos_api"], api_at=f["api_at"])
json.dump(official, open(op, "w"), indent=1)
print(f"{len(network)} network channels, {len(fresh)} official channels refreshed from the YouTube API")
