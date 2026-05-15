#!/bin/bash
# Renew Let's Encrypt cert untuk vinfast.caricreatormu.my.id
# Jalankan via cron: 0 3 * * * /home/wabot/vinfast-bot/scripts/cert-renew.sh

set -e

LE_DIR=/home/wabot/vinfast-bot/letsencrypt
LOG=/home/wabot/vinfast-bot/logs/cert-renew.log

mkdir -p "$LE_DIR/config" "$LE_DIR/work" "$LE_DIR/logs"

{
  echo "=== $(date -Is) cert-renew start ==="

  docker run --rm \
    -v "$LE_DIR/config":/etc/letsencrypt \
    -v "$LE_DIR/work":/var/lib/letsencrypt \
    -v "$LE_DIR/logs":/var/log/letsencrypt \
    -v /home/wabot/evolution/public:/webroot \
    certbot/certbot:latest renew \
    --webroot -w /webroot --quiet

  # Reload nginx kalau ada cert baru
  docker exec evolution_nginx nginx -s reload 2>&1 || true

  echo "=== $(date -Is) cert-renew done ==="
} >> "$LOG" 2>&1
