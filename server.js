/**
 * server.js — Proxy Node.js pour FlOpEDT
 *
 * Ce serveur fait deux choses :
 *  1. Sert les fichiers statiques du site (HTML, CSS, JS)
 *  2. Proxifie /api/flopedt/* vers flopedt.iut-blagnac.fr
 *     (GET uniquement, 4 endpoints autorisés) pour contourner
 *     le blocage CORS du navigateur
 *  3. Relaie /ical/* vers l'adapter de prod (ICAL_UPSTREAM, defaut
 *     https://kraftflopedt.fr) : les flux sont generes depuis le store de
 *     l'adapter, qu'on ne fait pas tourner en dev (200 appels FlOpEDT)
 *
 * Serveur de DEV uniquement : ne pas exposer sur Internet.
 *
 * Usage :
 *   node server.js
 * Puis ouvre : http://localhost:3000
 */

const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const url   = require('url');

const PORT        = 3000;
const FLOPEDT_HOST = 'flopedt.iut-blagnac.fr';
const ICAL_UPSTREAM = new URL(process.env.ICAL_UPSTREAM || 'https://kraftflopedt.fr');

// Menus CROUS (meme module qu'en prod dans l'adapter) : cache dans ./.data en dev
process.env.DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '.data');
const crous = require('./crous');
crous.start();

// ── Proxy restreint : seuls ces endpoints FlOpEDT sont relayés, en GET ──
// (liste identique à docker/nginx.conf pour la prod)
const PROXY_PREFIX  = '/api/flopedt';
const PROXY_ALLOWED = new Set([
  '/fr/api/fetch/scheduledcourses/',
  '/fr/api/fetch/constraints/',
  '/fr/api/groups/structural/tree/',
  '/fr/api/rooms/all/',
]);

// ── Types MIME pour les fichiers statiques ──
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.png':  'image/png',
};

// ── Dossier des fichiers statiques (là où se trouve index.html) ──
const STATIC_DIR = path.join(__dirname);

// ════════════════════════════════════════════════════
//  Serveur HTTP
// ════════════════════════════════════════════════════
const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);

  // ── Menus du Resto U' Blagnac : /api/crous/menu (comme docker/nginx.conf) ──
  if (parsed.pathname === '/api/crous/menu') {
    if (req.method !== 'GET') {
      res.writeHead(405, { 'Content-Type': 'application/json', 'Allow': 'GET' });
      return res.end(JSON.stringify({ error: 'Méthode non autorisée' }));
    }
    crous.getMenus().then(out => {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(out));
    }).catch(err => {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    });
    return;
  }

  // ── Route proxy : /api/flopedt/<endpoint FlOpEDT> ──
  // Même chemin et mêmes règles qu'en prod (docker/nginx.conf) :
  // GET uniquement, 4 endpoints autorisés, aucun cookie transmis.
  if (parsed.pathname.startsWith(PROXY_PREFIX)) {
    const upstreamPath = parsed.pathname.slice(PROXY_PREFIX.length);

    if (!PROXY_ALLOWED.has(upstreamPath)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Endpoint FlOpEDT non autorisé', path: upstreamPath }));
      return;
    }
    if (req.method !== 'GET') {
      res.writeHead(405, { 'Content-Type': 'application/json', 'Allow': 'GET' });
      res.end(JSON.stringify({ error: 'Méthode non autorisée' }));
      return;
    }

    const search = parsed.search || '';
    console.log(`[PROXY] → https://${FLOPEDT_HOST}${upstreamPath}${search}`);

    const options = {
      hostname: FLOPEDT_HOST,
      path:     upstreamPath + search,
      method:   'GET',
      headers: {
        'Accept':     'application/json',
        'User-Agent': 'KraftFlopEDT-Proxy/1.0 (dev)',
      },
    };

    const proxyReq = https.request(options, proxyRes => {
      res.writeHead(proxyRes.statusCode, {
        'Content-Type':                proxyRes.headers['content-type'] || 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control':               'no-store',
      });
      proxyRes.pipe(res);
    });

    proxyReq.setTimeout(60000, () => proxyReq.destroy(new Error('timeout upstream (60 s)')));
    proxyReq.on('error', err => {
      console.error('[PROXY] Erreur :', err.message);
      if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    });

    proxyReq.end();
    return;
  }

  // ── Flux iCalendar : relayes vers l'adapter de prod (bouton Agenda en local) ──
  if (parsed.pathname.startsWith('/ical/')) {
    if (req.method !== 'GET') {
      res.writeHead(405, { 'Content-Type': 'application/json', 'Allow': 'GET' });
      return res.end(JSON.stringify({ error: 'Méthode non autorisée' }));
    }
    const client = ICAL_UPSTREAM.protocol === 'http:' ? http : https;
    const up = client.request({
      hostname: ICAL_UPSTREAM.hostname, port: ICAL_UPSTREAM.port || undefined,
      path: parsed.pathname + (parsed.search || ''), method: 'GET',
      headers: { 'Accept': 'text/calendar', 'User-Agent': 'KraftFlopEDT-Proxy/1.0 (dev)' },
    }, upRes => {
      res.writeHead(upRes.statusCode, {
        'Content-Type':  upRes.headers['content-type'] || 'text/calendar; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      upRes.pipe(res);
    });
    up.setTimeout(30000, () => up.destroy(new Error('timeout ical (30 s)')));
    up.on('error', err => {
      if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `iCal indisponible via ${ICAL_UPSTREAM.host} : ${err.message}` }));
    });
    return up.end();
  }

  // ── Preflight CORS (OPTIONS) ──
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Accept',
    });
    res.end();
    return;
  }

  // ── Fichiers statiques ──
  let pathname;
  try { pathname = decodeURIComponent(parsed.pathname); }
  catch (_) { res.writeHead(400); return res.end('Bad request'); }
  const filePath = pathname === '/'
    ? path.join(STATIC_DIR, 'index.html')
    : path.join(STATIC_DIR, pathname);

  // Sécurité : rester DANS le dossier (un simple startsWith laissait lire un
  // dossier voisin "kraftflopedt-xxx") et ne jamais servir les fichiers caches
  // (.git/, .data/, .gitignore...)
  const rel = path.relative(STATIC_DIR, filePath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  if (rel.split(path.sep).some(seg => seg.startsWith('.'))) {
    res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end(`Fichier non trouvé : ${pathname}`); return;
  }

  const ext     = path.extname(filePath);
  const mime    = MIME[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end(`Fichier non trouvé : ${pathname}`);
      return;
    }
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log('');
  console.log('  ╔══════════════════════════════════════════╗');
  console.log('  ║       Serveur EDT IUT Blagnac            ║');
  console.log(`  ║   http://localhost:${PORT}                  ║`);
  console.log('  ╚══════════════════════════════════════════╝');
  console.log('');
  console.log('  Proxy actif → flopedt.iut-blagnac.fr');
  console.log('  Ctrl+C pour arrêter\n');
});
