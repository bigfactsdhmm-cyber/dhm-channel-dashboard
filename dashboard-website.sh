#!/bin/zsh
# "Dashboard website": full refresh of the channel dashboard and publish to
# https://dhmm-youtube-channels.netlify.app
#   1. Grok's live sheet (channels, uploads, held)   -> import-log.py
#   2. exact YouTube numbers + per-video view sums   -> refresh-stats.py (youtube-cleanup/token.json)
#   3. Rumble + Odysee official channels             -> fetch-platforms.py
#   4. rebuild channels.js, then publish (draft deploy + publish: direct --prod deploys return Forbidden)
set -e
R=~/1000-channels/repo; N=~/1000-channels/netlify-site; SITE=aea480b1-9d77-4b52-acae-ca71be193e47
cd $R
python3 import-log.py | tail -1
# YouTube numbers; if the API refuses (e.g. daily quota used up), keep the last numbers and still
# publish the sheet's channels and schedule.
if [[ "$SKIP_YT" == 1 ]]; then echo "(YouTube numbers: not due this run)"; else
python3 refresh-stats.py 2>/tmp/refresh-stats.err || { echo "!! YouTube numbers NOT refreshed ($(grep -o 'quotaExceeded\|invalid_grant\|HttpError [0-9]*' /tmp/refresh-stats.err | head -1)) - keeping the last numbers"; }
fi
python3 week-feed.py | head -1 || echo "!! weekly counts from feeds failed - keeping the last numbers"
python3 fetch-platforms.py || echo "!! Rumble/Odysee not refreshed - keeping the last numbers"
node build.mjs 2>&1 | grep -E 'unresolved|live ->' || true
node check.mjs
# channel list for the live-numbers function (/api/stats)
node -e '
const fs=require("fs");const w={};eval(fs.readFileSync("channels.js","utf8").replace(/window/g,"w"));
const all=[...w.CHANNELS,...w.OFFICIAL];
fs.writeFileSync(process.argv[1],JSON.stringify({youtube:[...new Set(all.map(c=>c.id).filter(i=>/^UC[\w-]{22}$/.test(i||"")))],
  views:Object.fromEntries(all.filter(c=>c.id).map(c=>[c.id,c.views])),
  rumble:w.PLATFORMS.filter(p=>p.platform==="Rumble").map(p=>p.url)}));' $N/netlify/functions/channels.json
node export-data.mjs   # channels.json / channels.csv / summary.txt for other tools and AI platforms
cp index.html channels.js manifest.webmanifest icon.svg channels.json channels.csv summary.txt $N/
cd $N
DID=$(npx --yes netlify-cli deploy --dir . --functions netlify/functions --site $SITE --message "Update $(date '+%Y-%m-%d %H:%M')" --json 2>/dev/null | python3 -c 'import json,sys;print(json.load(sys.stdin)["deploy_id"])')
npx --yes netlify-cli api restoreSiteDeploy --data "{\"site_id\":\"$SITE\",\"deploy_id\":\"$DID\"}" >/dev/null
echo "Published: https://dhmm-youtube-channels.netlify.app  (deploy $DID)"
# same update to GitHub, which youtube.flowlive.org is built from
~/1000-channels/github-sync.sh || echo "!! GitHub not updated - the .org site will catch up on the next run"
