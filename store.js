/**
 * store.js — Stockage local des donnees FlOpEDT + rafraichissement en tache de fond
 *
 * Pourquoi : FlOpEDT met 10 a 20 s par appel en periode de charge et bloque les IP
 * trop insistantes. On garde donc TOUT en local (disque + memoire) et on ne
 * l'interroge qu'en arriere-plan, une requete a la fois, espacees de MIN_GAP_MS.
 *
 *  - emplois du temps (scheduledcourses) : tous les departements, de la semaine
 *    courante - WEEKS_BEHIND jusqu'a la fin de l'annee universitaire, rafraichis
 *    toutes les heures (REFRESH_COURSES_MS), semaines proches en premier
 *  - groupes, contraintes, salles : rafraichis une fois par semaine (REFRESH_STATIC_MS)
 *  - une donnee absente du store est telechargee a la demande (une seule fois,
 *    en priorite), puis entretenue par le rafraichissement periodique
 *  - si FlOpEDT tombe ou repond n'importe quoi, on garde la derniere version connue
 *
 * Variables d'environnement (toutes optionnelles) :
 *   DATA_DIR            dossier de stockage            (defaut /data)
 *   DEPTS               departements suivis            (defaut INFO,RT,CS,GIM)
 *   REFRESH_COURSES_MS  periode emplois du temps       (defaut 3600000 = 1 h)
 *   REFRESH_STATIC_MS   periode groupes/contraintes    (defaut 604800000 = 7 j)
 *   MIN_GAP_MS          espacement entre deux appels   (defaut 3000)
 *   UPSTREAM_TIMEOUT_MS delai max d'un appel FlOpEDT   (defaut 60000)
 *   WEEKS_BEHIND        semaines passees entretenues   (defaut 2)
 *   DISABLE_REFRESH=1   desactive le rafraichissement  (tests)
 */

const fs    = require('fs');
const path  = require('path');
const https = require('https');

const FLOPEDT_HOST = 'flopedt.iut-blagnac.fr';

const CONFIG = {
  dataDir:         process.env.DATA_DIR || '/data',
  depts:           (process.env.DEPTS || 'INFO,RT,CS,GIM').split(',').map(s => s.trim()).filter(Boolean),
  refreshCourses:  Number(process.env.REFRESH_COURSES_MS)  || 60 * 60 * 1000,
  refreshStatic:   Number(process.env.REFRESH_STATIC_MS)   || 7 * 24 * 60 * 60 * 1000,
  minGap:          Number(process.env.MIN_GAP_MS)          || 3000,
  upstreamTimeout: Number(process.env.UPSTREAM_TIMEOUT_MS) || 60000,
  weeksBehind:     Number(process.env.WEEKS_BEHIND ?? 2),
  disableRefresh:  process.env.DISABLE_REFRESH === '1',
};

// Endpoints FlOpEDT connus : parametres acceptes et famille de rafraichissement
const ENDPOINTS = {
  '/fr/api/fetch/scheduledcourses/': { kind: 'courses', params: ['dept', 'week', 'year', 'work_copy'] },
  '/fr/api/fetch/constraints/':      { kind: 'static',  params: ['dept'] },
  '/fr/api/groups/structural/tree/': { kind: 'static',  params: ['dept'] },
  '/fr/api/rooms/all/':              { kind: 'static',  params: ['dept'] },
};

function log(...a)  { console.log(`[${new Date().toISOString()}] [store]`, ...a); }
function warn(...a) { console.warn(`[${new Date().toISOString()}] [store]`, ...a); }

// ════════════════════════════════════════════════════
//  Validation des parametres (evite de polluer le store)
// ════════════════════════════════════════════════════

function validate(endpoint, query = {}) {
  const def = ENDPOINTS[endpoint];
  if (!def) throw new Error(`Endpoint FlOpEDT non autorise : ${endpoint}`);

  const dept = String(query.dept || '').trim();
  if (!/^[A-Za-z0-9_-]{1,16}$/.test(dept)) throw new Error('Parametre dept invalide');
  const params = { dept };

  if (def.kind === 'courses') {
    const week = Number(query.week), year = Number(query.year);
    if (!Number.isInteger(week) || week < 1 || week > 53)     throw new Error('Parametre week invalide (1-53)');
    if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new Error('Parametre year invalide');
    const wc = query.work_copy === undefined || query.work_copy === '' ? 0 : Number(query.work_copy);
    if (wc !== 0) throw new Error('Seul work_copy=0 est disponible');
    Object.assign(params, { week, year, work_copy: 0 });
  }
  return params;
}

function keyOf(endpoint, params) {
  const slug = endpoint.replace(/^\/fr\/api\//, '').replace(/\/$/, '').replace(/\//g, '-');
  const qs   = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('&');
  return `${slug}__${qs}`.replace(/[^A-Za-z0-9_.=&-]/g, '_');
}

function queryString(params) {
  return Object.entries(params).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
}

// ════════════════════════════════════════════════════
//  Persistance : memoire + un fichier JSON par cle
// ════════════════════════════════════════════════════

const mem = new Map(); // key -> { key, endpoint, params, fetchedAt, body }

function fileOf(key) { return path.join(CONFIG.dataDir, `${key}.json`); }

function loadFromDisk() {
  fs.mkdirSync(CONFIG.dataDir, { recursive: true });
  let n = 0;
  for (const f of fs.readdirSync(CONFIG.dataDir)) {
    if (!f.endsWith('.json') || f.startsWith('.')) continue;
    try {
      const e = JSON.parse(fs.readFileSync(path.join(CONFIG.dataDir, f), 'utf8'));
      if (e && e.key && e.endpoint && e.body !== undefined) { mem.set(e.key, e); n++; }
    } catch (err) { warn(`fichier ignore ${f}: ${err.message}`); }
  }
  log(`${n} entree(s) chargee(s) depuis ${CONFIG.dataDir}`);
}

function persist(entry) {
  const target = fileOf(entry.key);
  const tmp    = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(entry));
  fs.renameSync(tmp, target); // ecriture atomique : jamais de fichier a moitie ecrit
}

// ════════════════════════════════════════════════════
//  Appel FlOpEDT (une seule requete a la fois, espacees)
// ════════════════════════════════════════════════════

const upstream = { lastOk: null, lastError: null, lastErrorAt: null, calls: 0, failures: 0 };

function fetchUpstream(endpoint, params) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: FLOPEDT_HOST,
      path:     `${endpoint}?${queryString(params)}`,
      method:   'GET',
      timeout:  CONFIG.upstreamTimeout,
      headers: {
        'Accept':     'application/json',
        'User-Agent': 'KraftFlopEDT-Adapter/2.0 (+https://kraftflopedt.habibiserver.dev)',
        'Referer':    `https://${FLOPEDT_HOST}/`,
        'Origin':     `https://${FLOPEDT_HOST}`,
      },
    }, res => {
      let chunks = '';
      res.on('data', d => chunks += d);
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`HTTP ${res.statusCode} sur ${endpoint}`));
        }
        let body;
        try { body = JSON.parse(chunks); }
        catch (e) { return reject(new Error(`JSON invalide sur ${endpoint}: ${e.message}`)); }
        if (body === null || typeof body !== 'object') return reject(new Error(`Reponse inattendue sur ${endpoint}`));
        resolve(body);
      });
    });
    req.on('timeout', () => req.destroy(new Error(`Timeout ${CONFIG.upstreamTimeout} ms sur ${endpoint}`)));
    req.on('error', reject);
    req.end();
  });
}

// File d'attente : les demandes "a la demande" passent devant le rafraichissement
const queue   = [];            // { key, endpoint, params, priority, resolve, reject }
const pending = new Map();     // key -> Promise (deduplication)
let   draining = false;
let   lastCallAt = 0;

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function drain() {
  if (draining) return;
  draining = true;
  try {
    while (queue.length) {
      queue.sort((a, b) => b.priority - a.priority);
      const job = queue.shift();
      const wait = lastCallAt + CONFIG.minGap - Date.now();
      if (wait > 0) await sleep(wait);
      lastCallAt = Date.now();
      upstream.calls++;
      try {
        const body  = await fetchUpstream(job.endpoint, job.params);
        const entry = { key: job.key, endpoint: job.endpoint, params: job.params, fetchedAt: new Date().toISOString(), body };
        mem.set(job.key, entry);
        try { persist(entry); } catch (e) { warn(`ecriture impossible ${job.key}: ${e.message}`); }
        upstream.lastOk = entry.fetchedAt;
        job.resolve(entry);
      } catch (e) {
        upstream.failures++;
        upstream.lastError   = e.message;
        upstream.lastErrorAt = new Date().toISOString();
        job.reject(e);
      } finally {
        pending.delete(job.key);
      }
    }
  } finally {
    draining = false;
  }
}

/** Telecharge (ou re-telecharge) une cle. Retourne la nouvelle entree. */
function refresh(endpoint, params, priority = 0) {
  const key = keyOf(endpoint, params);
  if (pending.has(key)) {
    const existing = queue.find(j => j.key === key);
    if (existing && priority > existing.priority) existing.priority = priority;
    return pending.get(key);
  }
  const p = new Promise((resolve, reject) => queue.push({ key, endpoint, params, priority, resolve, reject }));
  pending.set(key, p);
  drain();
  return p;
}

// ════════════════════════════════════════════════════
//  Lecture : toujours depuis le store, FlOpEDT seulement si on n'a rien
// ════════════════════════════════════════════════════

function maxAgeOf(endpoint) {
  return ENDPOINTS[endpoint].kind === 'courses' ? CONFIG.refreshCourses : CONFIG.refreshStatic;
}

/**
 * @returns {Promise<{body, fetchedAt, status: 'hit'|'stale'|'miss'}>}
 *  hit   : servi depuis le store, a jour
 *  stale : servi depuis le store, plus vieux que 2 periodes (re-telechargement lance en fond)
 *  miss  : absent du store, telecharge a la demande
 */
async function get(endpoint, query) {
  const params = validate(endpoint, query);
  const key    = keyOf(endpoint, params);
  const entry  = mem.get(key);

  if (entry) {
    const age = Date.now() - Date.parse(entry.fetchedAt);
    let status = 'hit';
    if (age > 2 * maxAgeOf(endpoint)) {
      status = 'stale';
      if (!CONFIG.disableRefresh) refresh(endpoint, params, 5).catch(() => {});
    }
    return { body: entry.body, fetchedAt: entry.fetchedAt, status };
  }

  const fresh = await refresh(endpoint, params, 10);
  return { body: fresh.body, fetchedAt: fresh.fetchedAt, status: 'miss' };
}

// ════════════════════════════════════════════════════
//  Semaines de l'annee universitaire, proches en premier
// ════════════════════════════════════════════════════

function isoWeek(d) {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return { week: Math.ceil((((date - yearStart) / 86400000) + 1) / 7), year: date.getUTCFullYear() };
}

/**
 * Semaines a entretenir : de (aujourd'hui - WEEKS_BEHIND) a la fin de l'annee
 * universitaire (mi-juillet), triees par distance a la semaine courante.
 */
function weeksToMaintain(now = new Date()) {
  const startYear = now.getUTCMonth() >= 7 ? now.getUTCFullYear() : now.getUTCFullYear() - 1; // annee univ. demarre en aout
  const end   = new Date(Date.UTC(startYear + 1, 6, 20));                                      // ~20 juillet
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 7 * CONFIG.weeksBehind));

  const seen = new Set(), out = [];
  for (let d = new Date(start), i = -CONFIG.weeksBehind; d <= end; d.setUTCDate(d.getUTCDate() + 7), i++) {
    const w = isoWeek(d), id = `${w.year}-${w.week}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ ...w, distance: Math.abs(i) * 2 + (i < 0 ? 1 : 0) }); // futur avant passe a egalite
  }
  return out.sort((a, b) => a.distance - b.distance);
}

// ════════════════════════════════════════════════════
//  Rafraichissement periodique
// ════════════════════════════════════════════════════

const runs = {
  courses: { running: false, startedAt: null, finishedAt: null, ok: 0, failed: 0, total: 0 },
  static:  { running: false, startedAt: null, finishedAt: null, ok: 0, failed: 0, total: 0 },
};

async function runJobs(name, jobs) {
  const r = runs[name];
  if (r.running) { warn(`rafraichissement ${name} deja en cours, passe ignoree`); return; }
  Object.assign(r, { running: true, startedAt: new Date().toISOString(), finishedAt: null, ok: 0, failed: 0, total: jobs.length });
  log(`rafraichissement ${name} : ${jobs.length} appel(s) FlOpEDT, espaces de ${CONFIG.minGap} ms`);
  await Promise.all(jobs.map(j => refresh(j.endpoint, j.params, 0).then(() => r.ok++, e => { r.failed++; warn(`${j.endpoint} ${queryString(j.params)} : ${e.message}`); })));
  r.running = false;
  r.finishedAt = new Date().toISOString();
  log(`rafraichissement ${name} termine : ${r.ok} ok, ${r.failed} echec(s), ${Math.round((Date.parse(r.finishedAt) - Date.parse(r.startedAt)) / 1000)} s`);
}

function refreshCourses() {
  const jobs = [];
  for (const w of weeksToMaintain()) {
    for (const dept of CONFIG.depts) {
      jobs.push({ endpoint: '/fr/api/fetch/scheduledcourses/', params: { dept, week: w.week, year: w.year, work_copy: 0 } });
    }
  }
  return runJobs('courses', jobs);
}

function refreshStatic() {
  const jobs = [];
  for (const dept of CONFIG.depts) {
    for (const [endpoint, def] of Object.entries(ENDPOINTS)) {
      if (def.kind === 'static') jobs.push({ endpoint, params: { dept } });
    }
  }
  return runJobs('static', jobs);
}

/** Age de la plus vieille donnee statique (ou Infinity s'il en manque une). */
function staticAge() {
  let oldest = 0;
  for (const dept of CONFIG.depts) {
    for (const [endpoint, def] of Object.entries(ENDPOINTS)) {
      if (def.kind !== 'static') continue;
      const e = mem.get(keyOf(endpoint, { dept }));
      if (!e) return Infinity;
      oldest = Math.max(oldest, Date.now() - Date.parse(e.fetchedAt));
    }
  }
  return oldest;
}

function start() {
  loadFromDisk();
  if (CONFIG.disableRefresh) { log('rafraichissement periodique desactive (DISABLE_REFRESH=1)'); return; }

  // Au demarrage : statique seulement si absent ou perime (on redemarre souvent
  // pour deployer, pas besoin de re-telecharger rooms/all a chaque fois),
  // puis les emplois du temps.
  (async () => {
    if (staticAge() > CONFIG.refreshStatic) await refreshStatic();
    await refreshCourses();
  })().catch(e => warn(`rafraichissement initial : ${e.message}`));

  setInterval(() => refreshStatic().catch(() => {}),  CONFIG.refreshStatic).unref();
  setInterval(() => refreshCourses().catch(() => {}), CONFIG.refreshCourses).unref();
  log(`emplois du temps toutes les ${Math.round(CONFIG.refreshCourses / 60000)} min, groupes/contraintes/salles toutes les ${Math.round(CONFIG.refreshStatic / 3600000)} h, depts ${CONFIG.depts.join(',')}`);
}

function status() {
  let courses = 0, statics = 0, oldest = null, newest = null;
  for (const e of mem.values()) {
    if (ENDPOINTS[e.endpoint]?.kind === 'courses') courses++; else statics++;
    if (!oldest || e.fetchedAt < oldest) oldest = e.fetchedAt;
    if (!newest || e.fetchedAt > newest) newest = e.fetchedAt;
  }
  return {
    config: { depts: CONFIG.depts, refreshCoursesMs: CONFIG.refreshCourses, refreshStaticMs: CONFIG.refreshStatic, minGapMs: CONFIG.minGap, weeksBehind: CONFIG.weeksBehind },
    store:  { entries: mem.size, courses, static: statics, oldestFetchedAt: oldest, newestFetchedAt: newest, dataDir: CONFIG.dataDir },
    queue:  { pending: queue.length, inFlight: draining ? 1 : 0 },
    upstream,
    runs,
  };
}

module.exports = { ENDPOINTS, CONFIG, validate, get, refresh, start, status, weeksToMaintain };
