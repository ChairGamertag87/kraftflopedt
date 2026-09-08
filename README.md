# KraftFlopEDT — IUT Blagnac

Site web d'emploi du temps basé sur FlOpEDT, avec proxy Node.js pour contourner le CORS.

## Prérequis

- [Node.js](https://nodejs.org/) installé (version 14+)
- Aucune dépendance npm — le serveur utilise uniquement les modules natifs Node.js

## Lancement

```bash
# 1. Se placer dans le dossier du projet
cd edt-blagnac

# 2. Lancer le serveur
node server.js

# 3. Ouvrir dans le navigateur
# http://localhost:3000
```

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

## Pourquoi un proxy ?

FlOpEDT bloque les requêtes venant d'un domaine différent (protection CORS).
Le navigateur appelle donc `/api/flopedt/<endpoint>` sur le site lui-même, et le serveur
récupère les données côté serveur puis les retourne.

Le proxy est volontairement restreint : GET uniquement, quatre endpoints publics
(`fetch/scheduledcourses`, `fetch/constraints`, `groups/structural/tree`, `rooms/all`),
et les cookies du visiteur ne sont jamais transmis à FlOpEDT.

- en dev : `server.js` (port 3000)
- en prod : le nginx du conteneur web (`docker/nginx.conf`), derrière Caddy

## Architecture

```
edt-blagnac/
├── server.js        ← proxy Node.js + serveur de fichiers statiques
├── index.html       ← structure HTML
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
    └── main.js      ← initialisation
```
