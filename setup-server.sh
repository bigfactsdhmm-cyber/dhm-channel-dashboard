#!/bin/bash
# One-time setup on a fresh Ubuntu/Debian VPS:  bash setup-server.sh channels.example.com
# Installs Node, Python and nginx, refreshes the dashboard every 30 minutes, serves it over HTTPS
# behind a password. Run from the folder this script is in (it gets copied to /opt/channels).
set -e
DOMAIN="$1"
[ -n "$DOMAIN" ] || { echo "usage: bash setup-server.sh channels.yourdomain.com"; exit 1; }

apt update
apt install -y nginx python3 python3-openpyxl certbot python3-certbot-nginx apache2-utils curl rsync
command -v node >/dev/null || { curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt install -y nodejs; }

mkdir -p /opt/channels /var/www/channels
rsync -a --exclude setup-server.sh ./ /opt/channels/

cat > /opt/channels/refresh.sh <<'R'
#!/bin/bash
cd /opt/channels
python3 import-log.py && node build.mjs
cp index.html channels.js manifest.webmanifest icon.svg /var/www/channels/
R
chmod +x /opt/channels/refresh.sh
/opt/channels/refresh.sh
(crontab -l 2>/dev/null | grep -v channels/refresh.sh; echo "*/30 * * * * /opt/channels/refresh.sh >> /var/log/channels.log 2>&1") | crontab -

echo; echo "Choose the password for the dashboard (user name: office):"
htpasswd -c /etc/nginx/.channels_pass office
cat > /etc/nginx/sites-available/channels <<N
server {
  listen 80;
  server_name $DOMAIN;
  root /var/www/channels;
  index index.html;
  auth_basic "Channels";
  auth_basic_user_file /etc/nginx/.channels_pass;
}
N
ln -sf /etc/nginx/sites-available/channels /etc/nginx/sites-enabled/channels
nginx -t && systemctl reload nginx
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect
echo; echo "Done: https://$DOMAIN  (user: office)"
