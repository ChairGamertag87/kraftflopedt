/**
 * server.js — Proxy Node.js pour FlOpEDT
 *
 * Ce serveur fait deux choses :
 *  1. Sert les fichiers statiques du site (HTML, CSS, JS)
 *  2. Proxifie les appels vers flopedt.iut-blagnac.fr
 *     pour contourner le blocage CORS du navigateur
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

  // ── Route proxy : /proxy?url=https://flopedt... ──
  if (parsed.pathname === '/proxy') {
    const targetUrl = parsed.query.url;

    if (!targetUrl || !targetUrl.startsWith(`https://${FLOPEDT_HOST}`)) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('URL cible invalide ou non autorisée.');
      return;
    }

    console.log(`[PROXY] → ${targetUrl}`);

    const options = {
      hostname: FLOPEDT_HOST,
      path:     targetUrl.replace(`https://${FLOPEDT_HOST}`, ''),
      method:   req.method,
      headers: {
        'Accept':          'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'User-Agent':      'Mozilla/5.0 (EDT-Proxy/1.0)',
        // Simule une requête depuis le site lui-même
        'Referer':         `https://${FLOPEDT_HOST}/`,
        'Origin':          `https://${FLOPEDT_HOST}`,
      },
    };

    const proxyReq = https.request(options, proxyRes => {
      res.writeHead(proxyRes.statusCode, {
        'Content-Type':                'application/json',
        'Access-Control-Allow-Origin': '*',   // autorise le navigateur local
      });
      proxyRes.pipe(res);
    });

    proxyReq.on('error', err => {
      console.error('[PROXY] Erreur :', err.message);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    });

    proxyReq.end();
    return;
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
  let filePath = parsed.pathname === '/'
    ? path.join(STATIC_DIR, 'index.html')
    : path.join(STATIC_DIR, parsed.pathname);

  // Sécurité : empêche de sortir du dossier
  if (!filePath.startsWith(STATIC_DIR)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  const ext     = path.extname(filePath);
  const mime    = MIME[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end(`Fichier non trouvé : ${parsed.pathname}`);
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
