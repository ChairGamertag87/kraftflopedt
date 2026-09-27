# KraftFlopEDT — IUT Blagnac

Site en ligne : **[kraftflopedt.fr](https://kraftflopedt.fr)**

Site web d'emploi du temps basé sur FlOpEDT. En prod, un adapter Node.js garde
les donnees FlOpEDT en local et les sert au site ; en dev, `server.js` relaie
directement vers FlOpEDT.

## Prérequis

- [Node.js](https://nodejs.org/) installé (version 18+, `node:22-alpine` en prod)
- Aucune dépendance npm — le serveur utilise uniquement les modules natifs Node.js

## Lancement (dev)

```bash
# 1. Se placer dans le dossier du projet
cd kraftflopedt

# 2. Lancer le serveur de dev (statique + proxy FlOpEDT + menus CROUS)
node server.js

# 3. Ouvrir dans le navigateur
# http://localhost:3000
```

Le bouton "Agenda" fonctionne aussi en local : `server.js` relaie `/ical/*` vers
l'adapter de prod (`ICAL_UPSTREAM`, defaut `https://kraftflopedt.fr`).
Le deploiement en prod (Docker, Caddy, cron) est decrit dans [`deploy/`](deploy/README.md).

Le terminal doit afficher :
```
  ╔══════════════════════════════════════════╗
  ║       Serveur EDT IUT Blagnac            ║
  ║   http://localhost:3000                  ║
  ╚══════════════════════════════════════════╝

  Proxy actif → flopedt.iut-blagnac.fr
  Ctrl+C pour arrêter
```

## Store local FlOpEDT (adapter)

FlOpEDT est lent en periode de charge (10 a 20 s par appel) et bloque les IP trop
insistantes. L'adapter (`adapter.js` + `store.js`) garde donc **toutes les donnees
en local** (volume Docker `kraftflopedt-adapter-data`, un fichier JSON par cle) et
ne parle a FlOpEDT qu'en tache de fond, une requete a la fois, espacees de 3 s :

- emplois du temps : tous les departements (`DEPTS`), de la semaine courante - 2 a la
  fin de l'annee universitaire, **toutes les heures** (`REFRESH_COURSES_MS`), semaines
  proches en premier ;
- groupes, contraintes, salles : **toutes les semaines** (`REFRESH_STATIC_MS`) ;
- une donnee jamais vue est telechargee a la demande puis entretenue ;
- si FlOpEDT tombe, la derniere version connue continue d'etre servie.

Le nginx du conteneur web relaie `/api/flopedt/*` vers l'adapter (plus vers FlOpEDT),
donc le front n'attend plus jamais FlOpEDT. Les reponses portent `X-Cache: hit|stale|miss`
et `X-Data-Fetched-At`. Etat du store : `GET /api/status`.

## Selection memorisee

Le trio departement / promo / groupe est sauvegarde dans `localStorage` a chaque
choix de groupe et recopie dans l'URL (`?dept=INFO&promo=BUT2&group=2A`), ce qui
permet de partager un lien direct. Au chargement, l'URL a priorite sur la memoire
locale ; la selection est appliquee des que les chips existent (liste locale de
secours d'abord, arbre FlOpEDT ensuite) et l'EDT se charge sans clic.

## Abonnement agenda (iCal)

Le bouton "Agenda" donne un lien d'abonnement iCalendar pour la selection
courante (Google Agenda, Apple Calendrier, Outlook, Thunderbird...). Les flux
sont generes par l'adapter (`ical.js`) depuis son store local, FlOpEDT n'est
jamais appele dans le chemin d'une requete :

- `/ical/<dept>/<promo>.ics` : tous les cours d'une promo
- `/ical/<dept>/<promo>/<groupe>.ics` : cours du groupe et de ses groupes parents (CM de promo inclus)
- `/ical/prof/<dept>/<initiales>.ics` : cours d'un enseignant (lien dans "Ou est le prof ?")

Les evenements couvrent les semaines entretenues par le store (WEEKS_BEHIND
semaines passees jusqu'a la fin de l'annee universitaire), en heure
Europe/Paris, avec un UID stable par cours (`sc-<id>@kraftflopedt.fr`) pour que
les agendas mettent a jour au lieu de dupliquer. Cache HTTP de 10 min.

## Ou est le prof ?

Le bouton "Ou est le prof ?" liste les enseignants (initiales FlOpEDT) ayant cours
dans la semaine affichee, tous departements confondus, et montre pour l'un d'eux
ses creneaux jour par jour avec la salle, le module et les groupes. Sur la semaine
courante, un bandeau indique la salle ou il se trouve en ce moment ou son prochain
cours du jour. Les cours de la semaine sont charges une fois et partages avec la
recherche de salles libres (`ensureWeekCourses` dans `js/rooms.js`).

## Menu du CROUS

Le bouton "Menu du CROUS" affiche les menus a venir du Resto U' Blagnac
(CROUS de Toulouse-Occitanie, restaurant `r674`), jour par jour. La source est
le flux XML officiel du CNOUS (`webservices-v2.crous-mobile.fr`, Licence
Ouverte). Ce flux est en HTTP seul, donc impossible a appeler depuis la page en
HTTPS : l'adapter (`crous.js`) le telecharge, le garde en cache 4 h sur le
volume de donnees (`If-Modified-Since` envoye, cache perime servi si le CNOUS
ne repond pas) et l'expose normalise en `GET /api/crous/menu`. Si le flux est
injoignable et qu'aucun cache n'existe, repli sur l'API CROUStillant
(restaurant `116`, usage non commercial).

Le menu est indicatif : il peut differer de ce qui est reellement servi, la
modale le rappelle. Un easter egg dedie a CroustOccitanie se cache dans la
modale (taper "croust" au clavier, ou tapoter 5 fois le titre).

Un visiteur n'attend jamais le CNOUS plus de 3 s (`CROUS_WAIT_MS`) : passe ce
delai le cache perime est servi (`stale: true`) pendant que le flux se recharge
en fond, et apres un echec aucun nouvel essai n'est fait avant 5 min
(`CROUS_RETRY_MS`). Le resultat du repli est lui aussi garde en memoire.

Reglages par variables d'environnement de l'adapter (voir l'en-tete de
`crous.js`) : `CROUS_REGION` (defaut `toulouse`), `CROUS_RESTO` (id dans le flux,
defaut `r674`), `CROUS_FALLBACK_CODE` (restaurant CROUStillant, defaut `116`),
`CROUS_TTL_MS`, `CROUS_WAIT_MS`, `CROUS_RETRY_MS`.

## Pourquoi un proxy ?

FlOpEDT bloque les requêtes venant d'un domaine différent (protection CORS).
Le navigateur appelle donc `/api/flopedt/<endpoint>` sur le site lui-même, et le serveur
récupère les données côté serveur puis les retourne.

Le proxy est volontairement restreint : GET uniquement, quatre endpoints publics
(`fetch/scheduledcourses`, `fetch/constraints`, `groups/structural/tree`, `rooms/all`),
et les cookies du visiteur ne sont jamais transmis à FlOpEDT.

- en dev : `server.js` (port 3000) relaie vers FlOpEDT
- en prod : le nginx du conteneur web (`docker/nginx.conf`), derrière Caddy,
  relaie vers l'adapter (`adapter.js`), qui repond depuis son store local

L'adapter n'accepte que les departements de `DEPTS` et ne telecharge a la
demande que les semaines de l'annee universitaire en cours ; une cle en echec
n'est pas retentee avant 5 min (`FAILURE_TTL_MS`) et la file des demandes
visiteur est bornee (`MAX_ON_DEMAND`), pour qu'un visiteur ne puisse pas faire
bannir l'IP du serveur par FlOpEDT.

## Architecture

```
kraftflopedt/
├── server.js            ← serveur de DEV : statique + proxy FlOpEDT + CROUS + relais iCal
├── adapter.js           ← PROD : API de l'adapter (endpoints bruts /api/flopedt/*, /status, /ical/, /crous/menu)
├── store.js             ← store local FlOpEDT (disque + memoire, rafraichissement en fond)
├── ical.js              ← flux iCalendar generes depuis le store
├── crous.js             ← menus du Resto U' (flux CNOUS + repli CROUStillant)
├── docker/nginx.conf    ← nginx du conteneur web (statique + relais vers l'adapter)
├── Dockerfile.web       ← image nginx (assets versionnes ?v=<hash>)
├── Dockerfile.adapter   ← image node de l'adapter
├── docker-compose.yml   ← les deux services + volume de donnees
├── auto-update.sh       ← deploiement automatique par cron (voir deploy/README.md)
├── deploy/README.md     ← mise en prod (Docker, Caddy, cron)
├── index.html           ← structure HTML
├── css/
│   ├── base.css     ← variables, reset, composants carte (style "carton")
│   ├── header.css   ← en-tête
│   ├── controls.css ← filtres, navigation semaine
│   ├── schedule.css ← grille EDT, cours, couleurs par type
│   └── overlay.css  ← modal détail d'un cours
└── js/
    ├── config.js    ← constantes (URL API, grille horaire, groupes)
    ├── utils.js     ← fonctions pures (dates, types, parsing)
    ├── state.js     ← état global (semaine/année courante)
    ├── ui.js        ← interactions (semaine, groupes, modal)
    ├── api.js       ← appels réseau via le proxy
    ├── render.js    ← construction de la grille HTML
    ├── rooms.js     ← salles libres + cache des cours de la semaine
    ├── tutors.js    ← "Où est le prof ?"
    ├── ical.js      ← modale d'abonnement agenda
    ├── crous.js     ← modale du menu du CROUS
    └── main.js      ← initialisation
```
