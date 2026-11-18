#!/usr/bin/env python3
"""Grok Bot's upload log -> data/grok-log.txt + data/held.json for build.mjs.

Source, first that has upload rows: a path given as the first argument; the live Google Sheet
whose id is in data/live-sheet-id.txt (shared "anyone with the link", read with no login);
the newest "UPLOAD LOG*.xlsx" in ~/Downloads.
grok-log.txt uses the same line format as videos.txt, with go-live times in brackets so the
dashboard can tag channels whose videos aren't public yet.
"""
import glob, json, os, re, sys, urllib.request
from datetime import datetime
import openpyxl

HERE = os.path.dirname(os.path.abspath(__file__))
# Channels taken off the dashboard on purpose; the log still mentions them.
EXCLUDE = {"Dag Heward-Mills 1999", "The Poimano- Dag Heward-Mills", "The Poimano"}

def upload_sheets(wb):
    """Tabs whose header row has a channel column and a main-video-link column."""
    out = []
    for ws in wb:
        head = [str(c or "").strip().lower() for c in next(ws.iter_rows(max_row=1, values_only=True), ())]
        if "channel" in head and any("main" in h and "link" in h for h in head):
            out.append((ws, head))
    return out


def live_sheet():
    try:
        sid = open(os.path.join(HERE, "data/live-sheet-id.txt")).read().strip()
    except OSError:
        return None
    path = os.path.join(HERE, "data/.live-sheet.xlsx")
    tmp = os.path.join(HERE, "data/.live-sheet.new.xlsx")  # openpyxl needs an .xlsx name
    try:
        urllib.request.urlretrieve(f"https://docs.google.com/spreadsheets/d/{sid}/export?format=xlsx", tmp)
        wb = openpyxl.load_workbook(tmp, data_only=True)
        os.replace(tmp, path)
    except Exception as e:
        # Not readable (e.g. the sheet's link sharing was turned off): use the last good copy, never
        # an older Downloads file, so a sharing change can't roll the dashboard back.
        if os.path.exists(tmp):
            os.remove(tmp)
        print(f"  !! LIVE SHEET NOT READABLE ({type(e).__name__}) - check its sharing is 'Anyone with the link'.")
        if os.path.exists(path):
            print("  using the last good copy of the live sheet")
            return path
        return None
    if not any(ws.max_row > 1 for ws, _ in upload_sheets(wb)):
        print("  live sheet has no upload rows yet; falling back to Downloads")
        return None
    return path


downloads = glob.glob(os.path.expanduser("~/Downloads/UPLOAD LOG*.xlsx"))
src = (sys.argv[1] if len(sys.argv) > 1 else None) or live_sheet() or (max(downloads, key=os.path.getmtime) if downloads else None)
if not src:  # on the server there is no Downloads folder: keep the last imported log
    print("no upload log available; keeping the previous data/grok-log.txt")
    sys.exit(0)
wb = openpyxl.load_workbook(src, data_only=True)


def when(v):
    """'2026-10-01 19:00' -> '1 Oct 19:00'; anything else ('Not logged', 'No Short') -> None."""
    try:
        d = datetime.strptime(str(v).strip()[:16], "%Y-%m-%d %H:%M")
    except ValueError:
        return None
    return f"{d.day} {d:%b %H:%M}"


def col(head, *words):
    return next((i for i, h in enumerate(head) if all(w in h for w in words)), None)


lines = []
for ws, head in upload_sheets(wb):
    c = dict(name=col(head, "channel"), main=col(head, "main", "link"), short=col(head, "short", "link"),
             mt=col(head, "main", "live"), st=col(head, "short", "live"), status=col(head, "status"))
    get = lambda r, k: r[c[k]] if c[k] is not None and c[k] < len(r) else None
    for r in ws.iter_rows(min_row=2, values_only=True):
        name, main, short, status = get(r, "name"), get(r, "main"), get(r, "short"), get(r, "status")
        if not name or name in EXCLUDE or (status and "Duplicate" in status):
            continue
        links = [main] if main else []
        if short and str(short).startswith("http"):
            links.append(f"Short {short}")
        if not links:
            continue
        m, s = when(get(r, "mt")), when(get(r, "st"))
        at = ", ".join(x for x in (m, s and f"Short {s}") if x)
        lines.append(f"{name}{f' ({at})' if at else ''}: {', '.join(links)}")

# Every channel, from the "All channels" tab (account, channel, channel link, …, status): a channel
# link puts it on the dashboard even before its first upload.
seen, channel_lines = {}, []
if "All channels" in wb.sheetnames:
    ws = wb["All channels"]
    head = [str(x or "").strip().lower() for x in next(ws.iter_rows(max_row=1, values_only=True))]
    ci, li, si = col(head, "channel"), col(head, "link"), col(head, "status")
    for r in ws.iter_rows(min_row=2, values_only=True):
        name, link = r[ci], r[li]
        if not name or not link or name in EXCLUDE or (si is not None and r[si] == "Skipped"):
            continue
        handle = re.search(r"youtube\.com/(@[\w.-]+|channel/[\w-]+)", str(link))
        if not handle:
            continue
        # Two different channels can share a name ("Stir It Up"): key the later one by its handle.
        key = name if name not in seen or seen[name] == handle.group(1) else f"{name} [{handle.group(1)}]"
        seen.setdefault(name, handle.group(1))
        channel_lines.append(f"{key}: https://www.youtube.com/{handle.group(1)}")

# Channels the user says are not on hold, whatever the log's "Held or blocked" tab still says.
NOT_HELD = {"Many Are Called"}

# Held/blocked uploads, by channel, with a short reason for the tile.
REASONS = [(r"phone", "phone check"), (r"not created|renamed", "channel not created"),
           (r"account (unknown|unclear)", "owner account unknown"), (r"processing", "processing stuck")]
held = {}
for r in (wb["Held or blocked"].iter_rows(min_row=2, values_only=True) if "Held or blocked" in wb.sheetnames else []):
    name, reason = r[0], str(r[3] or "")
    if not name or name in EXCLUDE or name in NOT_HELD:
        continue
    why = next((label for pat, label in REASONS if re.search(pat, reason, re.I)), "on hold")
    held.setdefault(name, {})
    held[name][why] = held[name].get(why, 0) + 1

updated = next((r[1] for r in wb["Summary"].iter_rows(values_only=True) if r[0] == "Upload log, updated"), "") \
    if "Summary" in wb.sheetnames else datetime.now().strftime("%Y-%m-%d %H:%M (live sheet)")
with open(os.path.join(HERE, "data/grok-log.txt"), "w") as f:
    f.write(f"# Generated by import-log.py from {os.path.basename(src)} (log updated {updated}). Do not edit.\n")
    if channel_lines:
        f.write(f"created: {len(channel_lines)}\n")
    f.write("\n".join(lines + channel_lines) + "\n")
with open(os.path.join(HERE, "data/held.json"), "w") as f:
    json.dump({"updated": updated, "channels": held}, f, indent=1)
print(f"{len(lines)} upload lines, {len(channel_lines)} channels, {len(held)} with held uploads <- {os.path.basename(src)} ({updated})")
