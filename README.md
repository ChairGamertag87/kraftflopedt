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

## Pourquoi un proxy ?

FlOpEDT bloque les requêtes venant d'un domaine différent (protection CORS).
Le proxy Node.js agit comme intermédiaire : le navigateur appelle `localhost:3000/proxy?url=...`,
et le serveur récupère les données côté serveur (sans restriction CORS) puis les retourne.

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
