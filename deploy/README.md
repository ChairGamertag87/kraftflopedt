# Mise en production

Le site tourne en Docker sur le serveur (`docker-compose.yml`), derriere le
reverse proxy Caddy partage du serveur qui termine le TLS. L'ancienne
architecture (nginx hote + PM2 + `/flopedt/` relaye vers FlOpEDT) n'existe plus.

## Conteneurs

| Service                | Image                | Role                                                              | Port hote        |
| ---------------------- | -------------------- | ----------------------------------------------------------------- | ---------------- |
| `kraftflopedt-web`     | `Dockerfile.web`     | nginx : site statique + relais `/api/*`, `/ical/*` vers l'adapter | `127.0.0.1:8093` |
| `kraftflopedt-adapter` | `Dockerfile.adapter` | `adapter.js` : store FlOpEDT, iCal, menus CROUS                   | `127.0.0.1:8094` |

Les donnees de l'adapter vivent dans le volume `kraftflopedt-adapter-data`
(`/data`) : elles survivent aux redeploiements. Reglages (departements, periodes
de rafraichissement, garde-fous) : variables d'environnement dans
`docker-compose.yml`, documentees en tete de `store.js` et `crous.js`.

## Reverse proxy

Le fichier `docker-compose.override.yml` (non versionne, specifique a l'hote)
branche les deux conteneurs sur le reseau du reverse proxy :

```yaml
services:
  kraftflopedt-web:     { networks: [default, figutab_default] }
  kraftflopedt-adapter: { networks: [default, figutab_default] }
networks:
  figutab_default: { external: true }
```

Cote Caddy, un bloc pour `kraftflopedt.fr` fait `reverse_proxy kraftflopedt-web:80`
(les anciens hotes `www.` et `kraftflopedt.habibiserver.dev` redirigent en 301
vers l'apex). Le DNS est chez Cloudflare (proxy), certificats Let's Encrypt
obtenus par Caddy.

## Deploiement automatique

`auto-update.sh` est lance par cron toutes les 5 minutes :

```
*/5 * * * * /home/chair/kraftflopedt/auto-update.sh >> /home/chair/kraftflopedt/auto-update.log 2>&1
```

Il fait un `git fetch`, compare `origin/main` au dernier commit deploye avec
succes (`.auto-update.deployed`), avance `main` en fast-forward uniquement puis
`docker compose up -d --build`. Un build rate est retente au passage suivant ;
un commit local non pousse bloque le deploiement (message dans le log) au lieu
d'etre ecrase.

Pousser sur `main` suffit donc a deployer. Pour forcer a la main :

```bash
cd ~/kraftflopedt && docker compose up -d --build
```

## Verifier

```bash
curl -sI https://kraftflopedt.fr/ | head -1               # 200
curl -s  https://kraftflopedt.fr/api/status | head -c 300  # etat du store et du CROUS
curl -sI "https://kraftflopedt.fr/ical/INFO/BUT1.ics" | grep -i x-event-count
docker logs --since 1h kraftflopedt-adapter | tail         # rafraichissements FlOpEDT
```
