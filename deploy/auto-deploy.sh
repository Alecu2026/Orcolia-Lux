#!/usr/bin/env bash
# Deploy automat: verifică GitHub-ul o dată pe minut și, dacă există commit nou pe branch-ul curent, rulează deploy/deploy.sh.
# Rulează permanent în pm2 („<nume>-autodeploy”, vezi ecosystem.config.js). O singură verificare, de pe cron:  bash deploy/auto-deploy.sh --once
# Un commit la care deploy-ul a eșuat (build sau aplicație care nu pornește) e reținut în logs/.failed-commit și nu se mai reîncearcă; un commit nou da.
# Intervalul se schimbă cu AUTODEPLOY_INTERVAL (secunde, implicit 60).
set -uo pipefail
cd "$(dirname "$0")/.."

check_once() {
  if ! git fetch --quiet origin; then
    echo "[$(date -Is)] git fetch a eșuat (rețea?) — reîncerc la următoarea verificare"
    return 0
  fi
  local branch remote
  branch=$(git rev-parse --abbrev-ref HEAD)
  remote=$(git rev-parse "origin/$branch" 2>/dev/null) || { echo "[$(date -Is)] origin/$branch nu există"; return 0; }
  # la zi (sau înaintea lui origin): nimic de făcut
  git merge-base --is-ancestor "$remote" HEAD 2>/dev/null && return 0
  # deja încercat și eșuat: așteptăm un commit nou
  if [ -f logs/.failed-commit ] && [ "$(cat logs/.failed-commit)" = "$remote" ]; then return 0; fi
  echo "[$(date -Is)] commit nou pe $branch (${remote:0:7}) → deploy"
  bash ./deploy/deploy.sh || echo "[$(date -Is)] deploy eșuat; rămâne versiunea anterioară (detalii mai sus). Un commit nou îl reîncearcă."
}

if [ "${1:-}" = "--once" ]; then check_once; exit 0; fi

INTERVAL=${AUTODEPLOY_INTERVAL:-60}
echo "[$(date -Is)] autodeploy pornit: verific la fiecare ${INTERVAL}s"
while true; do
  check_once
  sleep "$INTERVAL"
done
