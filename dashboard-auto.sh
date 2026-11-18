#!/bin/zsh
# Runs every 30 min from LaunchAgent com.dhmm.dashboard-website.
# Publishes when Grok's sheet has changed, or every 4 h for fresh YouTube numbers
# (YouTube refresh only every 4 h so the shared daily API quota isn't used up).
export PATH=$HOME/.local/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin
S=~/1000-channels/state; mkdir -p $S
cd ~/1000-channels/repo
SID=$(cat data/live-sheet-id.txt)
NOW=$(date +%s)
# Grok's "Upload log, updated" time
STAMP=$(python3 - "$SID" <<'P' 2>/dev/null
import sys,io,urllib.request,openpyxl
b=urllib.request.urlopen(f"https://docs.google.com/spreadsheets/d/{sys.argv[1]}/export?format=xlsx",timeout=60).read()
wb=openpyxl.load_workbook(io.BytesIO(b),data_only=True)
import hashlib
h=hashlib.sha1()
for ws in wb:
    for r in ws.iter_rows(values_only=True): h.update(repr(r).encode())
print(h.hexdigest())  # fingerprint of every cell: catches new rows even when the "updated" time isn't changed
P
)
LAST_STAMP=$(cat $S/sheet-stamp 2>/dev/null); LAST_YT=$(cat $S/yt-time 2>/dev/null || echo 0)
YT_DUE=$(( NOW - LAST_YT >= 4*3600 ))
# "videos this week" from the free channel feeds; publish when any channel's number moved
WEEK_CHANGED=$(python3 week-feed.py 2>/dev/null | sed -n 's/^changed: //p'); WEEK_CHANGED=${WEEK_CHANGED:-0}
if [[ "$STAMP" == "$LAST_STAMP" && $YT_DUE == 0 && $WEEK_CHANGED == 0 ]]; then
  echo "$(date '+%F %T') no change (sheet $STAMP)"; exit 0
fi
echo "$(date '+%F %T') run: week changed on $WEEK_CHANGED channels, sheet '$LAST_STAMP' -> '$STAMP', youtube due=$YT_DUE"
if [[ $YT_DUE == 1 ]]; then SKIP_YT=0; else SKIP_YT=1; fi
SKIP_YT=$SKIP_YT ~/1000-channels/dashboard-website.sh && {
  [[ -n "$STAMP" ]] && echo "$STAMP" > $S/sheet-stamp
  [[ $YT_DUE == 1 ]] && echo $NOW > $S/yt-time
}
