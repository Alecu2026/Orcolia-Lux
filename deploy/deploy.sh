#!/usr/bin/env bash
# Deploy pe server, din repo-ul clonat:   bash deploy/deploy.sh      (îl pornește și deploy/auto-deploy.sh la fiecare commit nou)
#  - un singur deploy odată (lock): push-uri rapide una după alta nu se calcă;
#  - `npm ci` doar dacă s-au schimbat dependențele (sau lipsește node_modules); `prisma generate` la fiecare deploy (schema poate avea câmpuri noi);
#  - după build, aplicația se reîncarcă și se verifică (GET /login); dacă build-ul pică sau aplicația nu răspunde, revine automat la commit-ul anterior
#    și îl reține în logs/.failed-commit, ca deploy-ul automat să nu-l mai reîncerce în buclă (un commit nou îl reîncearcă);
#  - schema Prisma schimbată: `prisma db push` rulează singur doar cu AUTO_DB_PUSH=1 în .env; altfel doar te avertizează.
# Atenție: build-ul (`rimraf .next` + `next build`) durează câteva minute, timp în care aplicația răspunde cu erori — pune push-urile în afara orelor de lucru.
set -euo pipefail
cd "$(dirname "$0")/.."

die() { echo "$*" >&2; exit 1; }

# valoarea unei variabile din .env.local sau .env (primul fișier care o definește câștigă, ca în Next); fără ghilimele și fără comentariul de după
env_get() {
  local f line v
  for f in .env.local .env; do
    [ -f "$f" ] || continue
    line=$(grep -E "^[[:space:]]*$1[[:space:]]*=" "$f" | tail -1 || true)
    [ -n "$line" ] || continue
    v=${line#*=}
    printf '%s' "$v" | tr -d '\r' | sed -E "s/^[[:space:]]+//; s/[[:space:]]+#.*\$//; s/[[:space:]]+\$//; s/^\"(.*)\"\$/\\1/; s/^'(.*)'\$/\\1/"
    return 0
  done
  return 0
}

[ -f .env ] || [ -f .env.local ] || die "Lipsește .env — copiază .env.example și completează-l (cel puțin DATABASE_URL și SESSION_SECRET)."
for k in DATABASE_URL SESSION_SECRET; do
  [ -n "$(env_get "$k")" ] || die "$k e gol în .env — fără el aplicația pornește în mod DEMO (fără bază de date și fără autentificare)."
done
[ -n "$(env_get NEXT_PUBLIC_APP_URL)" ] || echo "ATENȚIE: NEXT_PUBLIC_APP_URL e gol în .env (se coace la build: linkurile din emailuri și PWA ies greșit)."
for c in git npm npx pm2 flock curl; do command -v "$c" >/dev/null || die "$c nu e instalat (pm2:  npm i -g pm2;  flock vine cu util-linux)."; done

NAME=$(env_get PM2_NAME); NAME=${NAME:-crm}
PORT=$(env_get PORT); PORT=${PORT:-3000}
BUILD_HEAP=$(env_get BUILD_HEAP_MB); BUILD_HEAP=${BUILD_HEAP:-4096}

exec 9>/tmp/"$NAME"-deploy.lock
flock -n 9 || { echo "Alt deploy rulează deja."; exit 0; }

# pornește / reîncarcă DOAR aplicația (nu și watcher-ul care a pornit acest script)
start_or_reload() {
  mkdir -p logs
  pm2 startOrReload ecosystem.config.js --only "$NAME" --update-env
  pm2 save >/dev/null
}

install_and_build() {
  if [ ! -d node_modules ] || [ "${1:-}" = "force" ]; then npm ci || return 1; fi
  npx prisma generate || return 1
  NODE_OPTIONS="--max-old-space-size=$BUILD_HEAP" npm run build || return 1
}

# aplicația răspunde pe portul ei? (pagina de login, fără autentificare)
healthy() {
  local i
  for ((i = 1; i <= ${HEALTH_TRIES:-45}; i++)); do
    curl -fsS -o /dev/null --max-time 5 "http://127.0.0.1:$PORT/login" 2>/dev/null && return 0
    sleep "${HEALTH_WAIT:-2}"
  done
  return 1
}

# revine la commit-ul dinainte de deploy, îl reconstruiește și îl pornește; commit-ul eșuat se reține (nu se mai reîncearcă automat)
rollback() {
  echo "!! $1 — revin la ${PREV:0:7}"
  mkdir -p logs
  echo "$NEW" > logs/.failed-commit
  git reset --hard "$PREV"
  install_and_build force || { echo "!! Nici versiunea anterioară nu se construiește: aplicația poate fi oprită. Verifică logurile și rulează din nou deploy/deploy.sh."; exit 1; }
  start_or_reload
  if healthy; then echo "Versiunea anterioară (${PREV:0:7}) rulează din nou."; else echo "!! Nici versiunea anterioară nu răspunde pe portul $PORT — verifică:  pm2 logs $NAME"; fi
  exit 1
}

PREV=$(git rev-parse HEAD)
BRANCH=$(git rev-parse --abbrev-ref HEAD)
[ "$BRANCH" != "HEAD" ] || die "Clona de pe server e pe un commit, nu pe un branch (git checkout main)."
echo "[$(date -Is)] git pull origin $BRANCH (acum: ${PREV:0:7})"
git pull --ff-only origin "$BRANCH" || die "git pull a eșuat (modificări locale pe server sau istoric divergent). Rezolvă pe server, apoi rulează din nou."
NEW=$(git rev-parse HEAD)

NEED_CI=""
if [ "$PREV" != "$NEW" ] && git diff --name-only "$PREV" "$NEW" | grep -Eq '^package(-lock)?\.json$'; then NEED_CI=force; fi

if ! install_and_build "$NEED_CI"; then
  [ "$PREV" != "$NEW" ] || die "!! Build eșuat pe ${NEW:0:7}, iar înainte de acest deploy nu era alt commit de restaurat. Aplicația poate fi oprită."
  rollback "Build eșuat pe ${NEW:0:7}"
fi

# schema Prisma s-a schimbat: câmpurile noi opționale merg fără pași în plus; indexurile și modelele noi cer `prisma db push`
if [ "$PREV" != "$NEW" ] && ! git diff --quiet "$PREV" "$NEW" -- prisma/schema.prisma; then
  if [ "$(env_get AUTO_DB_PUSH)" = "1" ]; then
    echo "prisma/schema.prisma s-a schimbat → prisma db push"
    npx prisma db push --skip-generate || echo "!! db push a eșuat — rulează-l manual:  npm run db:push"
  else
    echo "ATENȚIE: prisma/schema.prisma s-a schimbat. Pentru indexuri sau modele noi rulează:  npm run db:push   (sau pune AUTO_DB_PUSH=1 în .env)."
  fi
fi

echo "pm2 reload (${NEW:0:7})"
start_or_reload
if ! healthy; then
  [ "$PREV" != "$NEW" ] || die "!! Aplicația nu răspunde pe portul $PORT după reload — verifică:  pm2 logs $NAME"
  rollback "Aplicația nu răspunde după reload pe ${NEW:0:7}"
fi

rm -f logs/.failed-commit
echo "Gata (${NEW:0:7}). Verifică:  pm2 status  |  pm2 logs $NAME  |  curl -I http://localhost:$PORT/login"
