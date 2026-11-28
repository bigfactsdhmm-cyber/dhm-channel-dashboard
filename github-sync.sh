#!/bin/zsh
# Copy the dashboard to GitHub (bigfactsdhmm-cyber/dhm-channel-dashboard) after every publish.
# youtube.flowlive.org is built from that repository, so it follows the Netlify site.
# Public repo: no logins, no Gmail addresses, no Google Sheet ID.
set -e
R=~/1000-channels/repo; N=~/1000-channels/netlify-site; G=~/1000-channels/github
SHEET=$(cat $R/data/live-sheet-id.txt)
cd $G
git pull -q --rebase || true
rsync -a --delete \
  --exclude .git --exclude README.md --exclude HOSTING.md --exclude netlify \
  --exclude '.live-sheet*' --exclude .odysee-token --exclude update.sh \
  --exclude data/live-sheet-id.txt --exclude .DS_Store --exclude '.playwright-mcp' \
  $R/ $G/
# fresh numbers also under data/live/, for copies (the .org server) that keep their own data/*.json
mkdir -p data/live && cp data/stats.json data/official.json data/platforms.json data/live/
mkdir -p netlify/functions
cp $N/netlify/functions/stats.mjs $N/netlify/functions/channels.json netlify/functions/
cp ~/1000-channels/dashboard-website.sh ~/1000-channels/dashboard-auto.sh ~/1000-channels/github-sync.sh .
# keep private details out of the public copy
LC_ALL=C sed -i '' "s/$SHEET/YOUR_GOOGLE_SHEET_ID/g" index.html
LC_ALL=C sed -i '' 's/ (all on [a-z0-9.]*@gmail\.com)//' data/categories.txt
if grep -rIlE "$SHEET|@gmail\.com|refresh_token|client_secret|ya29\.|gho_|ghp_" --exclude-dir=.git --exclude=.gitignore --exclude=github-sync.sh . ; then
  echo "!! GitHub copy NOT updated: private detail found in the files above"; git checkout -q -- . 2>/dev/null; exit 1
fi
git add -A
if git diff --cached --quiet; then echo "GitHub: no changes"; exit 0; fi
git commit -qm "Dashboard update $(date '+%Y-%m-%d %H:%M')

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -q && echo "GitHub updated: https://github.com/bigfactsdhmm-cyber/dhm-channel-dashboard ($(git rev-parse --short HEAD))"
