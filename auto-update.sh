#!/usr/bin/env bash
# Lance par cron toutes les 5 min : redeploie si origin/main n'est pas le dernier
# commit deploye avec succes (memorise dans .auto-update.deployed).
#
#   */5 * * * * /home/chair/kraftflopedt/auto-update.sh >> /home/chair/kraftflopedt/auto-update.log 2>&1
#
# Regles :
#  - la reference est le DERNIER DEPLOIEMENT REUSSI, pas HEAD ni origin/main
#    avant/apres fetch : quand le build docker echouait, HEAD valait deja
#    origin/main et le passage suivant sortait en exit 0, la prod restait sur
#    l'ancienne image jusqu'au commit suivant. Le fichier d'etat n'est ecrit
#    qu'apres un `docker compose up` reussi, un echec est donc retente.
#  - la mise a jour se fait en fast-forward uniquement ; si main local a diverge,
#    on previent et on ne touche a rien (un commit local non pousse n'est jamais
#    ecrase : l'ancienne version faisait un reset --hard).
set -euo pipefail
cd "$(dirname "$0")"

exec 9>.auto-update.lock
flock -n 9 || exit 0

STATE=.auto-update.deployed
log() { echo "[$(date '+%F %T')] $*"; }

if ! git fetch origin main --quiet 2>/dev/null; then
  log "fetch impossible (reseau ?), nouvel essai au prochain passage"
  exit 0
fi
TARGET=$(git rev-parse origin/main)
DEPLOYED=$(cat "$STATE" 2>/dev/null || true)

[ "$TARGET" = "$DEPLOYED" ] && exit 0

if [ "$(git rev-parse --abbrev-ref HEAD)" != "main" ]; then
  log "ATTENTION : HEAD n'est pas sur main, deploiement ignore"
  exit 1
fi

if ! git merge-base --is-ancestor HEAD origin/main; then
  log "ATTENTION : main local a des commits non pousses ($(git rev-parse --short HEAD)), deploiement ignore. Pousse-les ou fais 'git reset --hard origin/main'."
  exit 1
fi

if [ "$(git rev-parse HEAD)" != "$TARGET" ]; then
  log "nouveau commit detecte ($(git rev-parse --short HEAD) -> $(git rev-parse --short "$TARGET")), mise a jour..."
  git merge --ff-only --quiet origin/main
fi

log "deploiement de $(git rev-parse --short "$TARGET") (dernier deploye : ${DEPLOYED:-aucun})..."
if ! docker compose up -d --build 2>&1 | tail -3; then
  log "ECHEC du deploiement de $(git rev-parse --short "$TARGET"), nouvel essai au prochain passage"
  exit 1
fi
echo "$TARGET" > "$STATE"
docker image prune -f >/dev/null
log "deploye : $(git log -1 --oneline)"
