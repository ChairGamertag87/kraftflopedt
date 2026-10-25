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

# Rotation du journal (cron redirige dans auto-update.log) : au-dela de 1 Mo,
# le fichier courant devient .1 (la precedente .1 est ecrasee)
LOG=auto-update.log
if [ -f "$LOG" ] && [ "$(stat -c %s "$LOG")" -gt 1048576 ]; then
  mv -f "$LOG" "$LOG.1"
fi

STATE=.auto-update.deployed
log() { echo "[$(date '+%F %T')] $*"; }

if ! ERR=$(git fetch origin main --quiet 2>&1); then
  log "fetch impossible, nouvel essai au prochain passage : ${ERR}"
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
# --wait : le commit n'est marque deploye que si les conteneurs sont healthy ;
# un build reussi suivi d'un conteneur qui meurt au demarrage etait sinon
# considere comme deploye et jamais retente
# Sortie capturee en entier et journalisee seulement en cas d'echec : tail -3
# ne montrait que les trois dernieres lignes, pas la cause d'un build rate
if ! OUT=$(docker compose up -d --build --wait --wait-timeout 120 2>&1); then
  log "ECHEC du deploiement de $(git rev-parse --short "$TARGET"), nouvel essai au prochain passage"
  printf '%s\n' "$OUT" | tail -40
  docker compose logs --tail 30 2>&1 || true
  exit 1
fi
echo "$TARGET" > "$STATE"
# Seules les images de ce projet : le prune global supprimait aussi les images
# dangling des projets voisins. Le cache de build (jamais touche par image prune)
# est borne une fois par semaine.
docker image prune -f --filter label=com.docker.compose.project=kraftflopedt >/dev/null
PRUNE_STAMP=.auto-update.builder-prune
if [ -z "$(find "$PRUNE_STAMP" -mtime -7 2>/dev/null)" ]; then
  docker builder prune -f --keep-storage 1g >/dev/null 2>&1 || true
  touch "$PRUNE_STAMP"
fi
log "deploye : $(git log -1 --oneline)"
