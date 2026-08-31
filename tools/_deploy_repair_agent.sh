#!/bin/bash
# Deploy the DeepSeek repair-agent commit to the VPS (run as root).
set -e
cd /opt/forchi || { echo "FAIL: /opt/forchi missing"; exit 1; }

echo "=== git pull ==="
git pull --ff-only origin main

echo "=== verify new files ==="
ls -la src/watchdog/repairAgent.js && echo "repairAgent.js present"
grep -n "DEEPSEEK_API_KEY" .env >/dev/null && echo "DEEPSEEK_API_KEY in .env" || echo "WARN: DEEPSEEK_API_KEY missing from .env"

echo "=== syntax check ==="
node --check src/watchdog/repairAgent.js && echo "repair syntax OK"
node --check src/watchdog/wakeTrigger.js && echo "wake syntax OK"
node --check src/llm/provider.js && echo "provider syntax OK"

echo "=== restart affected services ==="
systemctl restart forchi.service
systemctl restart forchi-wake.service
echo "restarted forchi + forchi-wake"

sleep 3
echo "=== service states ==="
for s in forchi forchi-wake forchi-shorts v10-watchdog code-server; do
  echo "$s: $(systemctl is-active $s.service)"
done

echo "=== wake-trigger one-shot check ==="
FORCHI_BASE=/opt/forchi node src/watchdog/wakeTrigger.js check || echo "(check reported problems - see above)"
echo "=== deploy done ==="
