#!/usr/bin/env bash
# Lance par cron toutes les 5 min : redeploie uniquement si origin/main a change.
#
#   */5 * * * * /home/chair/kraftflopedt/auto-update.sh >> /home/chair/kraftflopedt/auto-update.log 2>&1
#
# Regles :
#  - on compare origin/main AVANT et APRES le fetch, jamais HEAD : un commit
#    local non pousse n'est plus considere comme "nouveau" et n'est plus ecrase
#    par un reset --hard (l'ancienne version a efface des commits de travail).
#  - la mise a jour se fait en fast-forward uniquement ; si main local a diverge,
#    on previent et on ne touche a rien.
set -euo pipefail
cd "$(dirname "$0")"

exec 9>.auto-update.lock
flock -n 9 || exit 0

log() { echo "[$(date '+%F %T')] $*"; }

BEFORE=$(git rev-parse origin/main)
git fetch origin main --quiet
AFTER=$(git rev-parse origin/main)

if [ "$BEFORE" = "$AFTER" ]; then
  # Cas de reprise : origin/main deja deploye mais main local en retard
  # (ex. premier lancement apres un clone), on se contente de rattraper.
  [ "$(git rev-parse HEAD)" = "$AFTER" ] && exit 0
fi

if [ "$(git rev-parse --abbrev-ref HEAD)" != "main" ]; then
  log "ATTENTION : HEAD n'est pas sur main, deploiement ignore"
  exit 1
fi

if ! git merge-base --is-ancestor HEAD origin/main; then
  log "ATTENTION : main local a des commits non pousses ($(git rev-parse --short HEAD)), deploiement ignore. Pousse-les ou fais 'git reset --hard origin/main'."
  exit 1
fi

if [ "$(git rev-parse HEAD)" = "$AFTER" ]; then
  exit 0
fi

log "nouveau commit detecte ($(git rev-parse --short "$BEFORE") -> $(git rev-parse --short "$AFTER")), redeploiement..."
git merge --ff-only --quiet origin/main
docker compose up -d --build 2>&1 | tail -3
docker image prune -f >/dev/null
log "deploye : $(git log -1 --oneline)"
