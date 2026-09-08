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

## Deux apparences : carton et iOS

Le bouton "Style iOS" / "Style carton" bascule toute l'apparence du site. Le theme
est memorise (`localStorage`, cle `edt-theme`) et peut etre force par `?theme=ios`
ou `?theme=carton` dans l'URL. Un script inline dans `<head>` le restaure avant le
CSS pour eviter un flash.

- **carton** (defaut) : le style d'origine, `css/base.css` et compagnie.
- **iOS** : `css/ios.css`, scope sous `html[data-theme="ios"]`, reprend l'app
  [flop-edt-ios](https://github.com/maelancochet/flop-edt-ios) : police systeme,
  fonds groupes iOS clair/sombre (`prefers-color-scheme`), accent bleu, grand titre
  "Septembre / Semaine 37", bande de 7 jours facon Calendrier (aujourd'hui en rouge,
  pastille sous les jours avec cours), cartes de cours a barre de couleur, feuilles
  modales. Sur mobile, la grille devient une vue jour pilotee par la bande.

Le rendu (`js/render.js`) est neutre : classes CSS plutot que styles inline, couleur
du module exposee en variable `--accent`, heures formatees via `formatClock` (8h00 en
carton, 08:00 en iOS). Les cours qui se chevauchent sont repartis en colonnes.
`js/theme.js` porte la bascule, la bande de jours, le titre et le bouton Aujourd'hui.

## Ou est le prof ?

Le bouton "Ou est le prof ?" liste les enseignants (initiales FlOpEDT) ayant cours
dans la semaine affichee, tous departements confondus, et montre pour l'un d'eux
ses creneaux jour par jour avec la salle, le module et les groupes. Sur la semaine
courante, un bandeau indique la salle ou il se trouve en ce moment ou son prochain
cours du jour. Les cours de la semaine sont charges une fois et partages avec la
recherche de salles libres (`ensureWeekCourses` dans `js/rooms.js`).

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
│   ├── overlay.css  ← modal détail d'un cours
│   └── ios.css      ← thème « flop!EDT iOS » (html[data-theme="ios"])
└── js/
    ├── config.js    ← constantes (URL API, grille horaire, groupes)
    ├── utils.js     ← fonctions pures (dates, types, parsing)
    ├── state.js     ← état global (semaine/année courante)
    ├── ui.js        ← interactions (semaine, groupes, modal)
    ├── api.js       ← appels réseau via le proxy
    ├── render.js    ← construction de la grille HTML
    ├── theme.js     ← bascule carton/iOS, bande de 7 jours, Aujourd'hui
    ├── rooms.js     ← salles libres + cache des cours de la semaine
    ├── tutors.js    ← "Où est le prof ?"
    └── main.js      ← initialisation
```
