#!/bin/bash
set -e

echo "[Entrypoint] Starting container entrypoint script..."

echo ""
echo "--- DIAG: proxy env vars ---"
env | grep -i proxy || echo "(none found)"

echo ""
echo "--- DIAG: CA certificates ---"
ls /etc/ssl/certs/ca-certificates.crt 2>&1 && echo "CA bundle present" || echo "MISSING"

echo ""
echo "--- DIAG: base image ---"
cat /etc/os-release | head -5

echo ""
echo "--- DIAG: general outbound test (huggingface.co) ---"
curl -sv --max-time 10 https://huggingface.co 2>&1 | tail -10

echo ""
echo "--- DIAG: telegram outbound test (api.telegram.org) ---"
curl -sv --max-time 10 https://api.telegram.org 2>&1 | tail -10

echo ""
echo "--- DIAG: cloudflare worker proxy test ---"
curl -sv --max-time 10 "https://forchi-tg-proxy.yonkkalu.workers.dev/bot${TELEGRAM_BOT_TOKEN}/getMe" 2>&1 | tail -15

echo ""
echo "--- DIAG: end ---"

exec "$@"
