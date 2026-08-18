#!/bin/bash
# ══════════════════════════════════════════════════
#  KraftFlopEDT — Deploy guide
#  Debian / Ubuntu + nginx + PM2 + Let's Encrypt
#
#  Everything lives on: kraftflopedt.habibiserver.dev
#    /            → static site
#    /courses     → API adapter
#    /docs        → API docs (Scalar)
#    /openapi.json→ OpenAPI spec
# ══════════════════════════════════════════════════


# ════════════════════════════
#  1. PREREQUISITES (once)
# ════════════════════════════

sudo apt update
sudo apt install -y nginx certbot python3-certbot-nginx

# Node.js v20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# PM2 — keeps adapter.js alive across reboots
sudo npm install -g pm2


# ════════════════════════════
#  2. COPY FILES TO SERVER
# ════════════════════════════

# Static site
sudo mkdir -p /var/www/kraftflopedt
# scp -r index.html css/ js/ user@habibiserver:/var/www/kraftflopedt/
sudo chown -R www-data:www-data /var/www/kraftflopedt
sudo chmod -R 755 /var/www/kraftflopedt

# API adapter
sudo mkdir -p /var/www/flopedt-adapter
# scp adapter.js user@habibiserver:/var/www/flopedt-adapter/
sudo chown -R $USER:$USER /var/www/flopedt-adapter


# ════════════════════════════
#  3. START ADAPTER WITH PM2
# ════════════════════════════

cd /var/www/flopedt-adapter
PORT=3001 pm2 start adapter.js --name flopedt-adapter

# Persist across reboots
pm2 save
pm2 startup   # ← run the command it prints


# ════════════════════════════
#  4. NGINX + SSL
# ════════════════════════════

sudo cp deploy/kraftflopedt.nginx.conf /etc/nginx/sites-available/kraftflopedt
sudo ln -sf /etc/nginx/sites-available/kraftflopedt /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default

sudo nginx -t && sudo systemctl reload nginx

# SSL — single domain only now
sudo certbot --nginx -d kraftflopedt.habibiserver.dev
sudo certbot renew --dry-run


# ════════════════════════════
#  5. VERIFY
# ════════════════════════════

curl https://kraftflopedt.habibiserver.dev                                      # static site
curl https://kraftflopedt.habibiserver.dev/current-week                         # API
curl "https://kraftflopedt.habibiserver.dev/courses?week=17&year=2026&dept=INFO&group=1A"
# Docs: https://kraftflopedt.habibiserver.dev/docs


# ════════════════════════════
#  6. UPDATES
# ════════════════════════════

# Update static site:
#   scp -r index.html css/ js/ user@habibiserver:/var/www/kraftflopedt/

# Update adapter.js:
#   scp adapter.js user@habibiserver:/var/www/flopedt-adapter/
#   pm2 restart flopedt-adapter


# ════════════════════════════
#  7. TROUBLESHOOTING
# ════════════════════════════

# Adapter logs:      pm2 logs flopedt-adapter
# Adapter monitor:   pm2 monit
# Nginx error log:   sudo tail -f /var/log/nginx/kraftflopedt.error.log
# Restart adapter:   pm2 restart flopedt-adapter
# Nginx status:      sudo systemctl status nginx
