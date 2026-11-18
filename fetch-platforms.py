#!/usr/bin/env python3
"""Official Dag Heward-Mills channels on Odysee, Rumble and BitChute -> data/platforms.json for build.mjs.

Odysee: the public LBRY API (title, picture, video count, latest upload).
Rumble: the channel page (title, picture, followers, latest upload).
Add or remove channels in the two lists below. (Removed at the user's request: First Love Sunday
Services, GTWC Ghana, Healing Jesus Crusades, GTWC International Conferences, International Ministry, Camps, The Art Of Ministry, En Français.)
"""
import datetime, json, os, re, time, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ODYSEE = """@daghewardmillspastorsconferences @daghewardmillsrevivalat7 @daghewardmillsimpartationservices
@FlowChurchServices @GiveThyselfWhollyInternationalConferences @daghewardmillsflowchurchservices""".split()
# Only the 6 Odysee channels on the DHMM platforms banner (IMG_1495, 2026-11-17).
RUMBLE = ["DagHewardMills", "c-6260523", "c-6116724", "daghewardmillstuesdayservices", "c-6264812", "c-6257904",
          "c-7805020"]
ODY_IMG = "https://thumbnails.odycdn.com/optimize/s:176:176/quality:85/plain/"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"

def day(ts):
    return datetime.datetime.utcfromtimestamp(int(ts)).strftime("%Y-%m-%d")

def rpc(method, params):
    for attempt in range(5):  # the public API rate-limits bursts; back off and retry
        req = urllib.request.Request("https://api.na-backend.odysee.com/api/v1/proxy",
            data=json.dumps({"jsonrpc": "2.0", "method": method, "params": params}).encode(),
            headers={"content-type": "application/json"})
        r = json.load(urllib.request.urlopen(req, timeout=30))
        if "result" in r:
            return r["result"]
        time.sleep(2 + 3 * attempt)
    raise RuntimeError(f"Odysee {method} failed: {r.get('error')}")

# Views and followers need an Odysee auth token. Like odysee.com does for every visitor, use an anonymous
# one (no account, no personal details), made once and kept in data/.odysee-token.
TOKEN_FILE = os.path.join(HERE, "data/.odysee-token")


def ody_token():
    try:
        return open(TOKEN_FILE).read().strip()
    except OSError:
        tok = json.load(urllib.request.urlopen("https://api.odysee.com/user/new?auth_token=&language=en", timeout=30))["data"]["auth_token"]
        open(TOKEN_FILE, "w").write(tok); os.chmod(TOKEN_FILE, 0o600)
        return tok


def ody_api(path, **q):
    url = f"https://api.odysee.com/{path}?" + urllib.parse.urlencode(dict(auth_token=ody_token(), **q))
    r = json.load(urllib.request.urlopen(url, timeout=30))
    if not r.get("success"):
        raise RuntimeError(r.get("error"))
    return r["data"]


def ody_views(channel_id):
    """Sum of the views on every video of an Odysee channel."""
    ids, page = [], 1
    while True:
        res = rpc("claim_search", {"channel_ids": [channel_id], "claim_type": ["stream"], "page": page, "page_size": 50})
        ids += [i["claim_id"] for i in res["items"]]
        if page >= res.get("total_pages", 1):
            break
        page += 1; time.sleep(0.4)
    total = 0
    for i in range(0, len(ids), 50):
        total += sum(ody_api("file/view_count", claim_id=",".join(ids[i:i + 50])) or [])
        time.sleep(0.3)
    return total


out = []
res = rpc("resolve", {"urls": ["lbry://" + n for n in ODYSEE]})
for n in ODYSEE:
    d = res.get("lbry://" + n, {})
    if not d.get("claim_id"):
        continue
    v, m = d.get("value", {}), d.get("meta", {})
    time.sleep(0.6)
    last = rpc("claim_search", {"channel_ids": [d["claim_id"]], "order_by": ["release_time"],
                                "page_size": 1, "claim_type": ["stream"]})["items"]
    time.sleep(0.6)
    week = rpc("claim_search", {"channel_ids": [d["claim_id"]], "claim_type": ["stream"], "page_size": 1,
                                "release_time": f">{int(time.time()) - 7 * 86400}"}).get("total_items", 0)
    try:
        followers = ody_api("subscription/sub_count", claim_id=d["claim_id"])[0]
        views = ody_views(d["claim_id"])
    except Exception as e:
        print("  odysee counts failed:", n, e); followers = views = None
    out.append(dict(platform="Odysee", week=week, views=views, name=v.get("title") or n, url="https://odysee.com/" + n,
                    # Raw LBRY thumbnail links come back without an image content type, which browsers
                    # refuse to show; Odysee's own image service serves them properly.
                    icon=(ODY_IMG + v["thumbnail"]["url"]) if (v.get("thumbnail") or {}).get("url") else "",
                    videos=m.get("claims_in_channel", 0),
                    followers=followers,
                    latest=day(last[0]["value"].get("release_time") or last[0]["meta"]["creation_timestamp"]) if last else ""))

def rumble_videos(url):
    """Every video on a Rumble channel: {permalink id: views}, from its /videos pages (25 a page)."""
    seen = {}
    for page in range(1, 200):
        try:
            html = urllib.request.urlopen(urllib.request.Request(f"{url}/videos?page={page}", headers={"user-agent": UA}),
                                          timeout=30).read().decode("utf-8", "ignore")
        except Exception:
            break  # past the last page
        found = dict((pid, int(v)) for v, pid in re.findall(r'"views":(\d+),[^{}]*?"permalink_id":"(\w+)"', html))
        if not set(found) - set(seen):
            break
        seen.update(found)
        time.sleep(0.4)
    return seen


for h in RUMBLE:
    url = f"https://rumble.com/c/{h}"
    try:
        html = urllib.request.urlopen(urllib.request.Request(url, headers={"user-agent": UA}), timeout=30).read().decode("utf-8", "ignore")
    except Exception as e:
        print("  rumble failed:", h, e); continue
    # The channel's own header data: picture, name and followers sit together in the page JSON.
    hdr = re.search(r'"thumb":"(https[^"]+)","name":"([^"]+)","followers":(\d+)', html)
    t = re.search(r'"title":"([^"]+)"', html) or re.search(r"<title>([^<|]+)", html)
    f = re.search(r'"followers":(\d+)', html)
    icon = re.search(r'property="og:image" content="([^"]+)"', html)
    dt = re.search(r'datetime="(\d{4}-\d\d-\d\d)', html)
    vids = rumble_videos(url)
    out.append(dict(platform="Rumble", url=url, videos=len(vids), views=sum(vids.values()), latest=dt.group(1) if dt else "",
                    name=hdr.group(2) if hdr else (t.group(1).strip() if t else h),
                    icon=hdr.group(1).replace("\\/", "/") if hdr else (icon.group(1) if icon else ""),
                    followers=int(hdr.group(3)) if hdr else (int(f.group(1)) if f else None)))

# BitChute: the public API behind bitchute.com (channel details + every video's views).
BITCHUTE = ["Mg7id7fz3eCF", "4MgIaXadefNI", "11UXeAys0iQY", "0PiH10KPVZix", "zVljk4VmyC9q", "kwaYujwB7XMk"]
# Qodesh, Iron Sharpeneth Iron, Miracle Wave Conventions, Overcomers, Leaders, Unquenchable Fire


def bc(path, body):
    req = urllib.request.Request("https://api.bitchute.com/api/beta/" + path, data=json.dumps(body).encode(),
                                 headers={"content-type": "application/json", "user-agent": UA})
    return json.load(urllib.request.urlopen(req, timeout=30))


for cid in BITCHUTE:
    try:
        ch = bc("channel", {"channel_id": cid})
        vids, off = [], 0
        while True:
            page = bc("channel/videos", {"channel_id": cid, "offset": off, "limit": 50}).get("videos") or []
            vids += page
            if len(page) < 50:
                break
            off += 50
            time.sleep(0.4)
    except Exception as e:
        print("  bitchute failed:", cid, e); continue
    cutoff = datetime.datetime.utcnow() - datetime.timedelta(days=7)
    week = sum(datetime.datetime.strptime(v["date_published"][:19], "%Y-%m-%dT%H:%M:%S") > cutoff for v in vids)
    out.append(dict(platform="BitChute", url=f"https://www.bitchute.com/channel/{cid}/", name=ch.get("channel_name") or cid,
                    icon=ch.get("thumbnail_url") or "", followers=ch.get("subscriber_count"),
                    videos=max(len(vids), ch.get("video_count") or 0),
                    # the channel's own view counter lags; use the larger of it and the sum of its videos
                    views=max(sum(v.get("view_count") or 0 for v in vids), ch.get("view_count") or 0),
                    week=week, latest=(ch.get("last_video_published") or "")[:10]))

json.dump(out, open(os.path.join(HERE, "data/platforms.json"), "w"), indent=1)
print(" + ".join(f"{sum(o['platform'] == pf for o in out)} {pf}" for pf in ("Odysee", "Rumble", "BitChute")) + " channels")
