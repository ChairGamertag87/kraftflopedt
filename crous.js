/**
 * crous.js — Menus du Resto U' de Blagnac (flux XML officiels du CNOUS)
 *
 * Source : http://webservices-v2.crous-mobile.fr/feed/<region>/externe/menu.xml
 * (Licence Ouverte, pas d'authentification). Le flux est en HTTP seulement, il
 * est donc telecharge ici, cote serveur, jamais depuis le navigateur (mixed content).
 *
 * Le menu.xml contient TOUS les restaurants de la region (30 a 400 Ko) et n'est
 * regenere que quelques fois par jour : on garde le fichier brut sur disque avec
 * un TTL (CROUS_TTL_MS, 4 h par defaut), on revalide avec If-Modified-Since /
 * If-None-Match, et en cas de panne on sert la derniere version connue.
 *
 * Repli : si le CNOUS est injoignable et qu'aucune copie locale n'existe, l'API
 * CROUStillant (JSON, usage non commercial) est interrogee pour les jours a venir.
 *
 * Variables d'environnement (optionnelles) :
 *   CROUS_REGION   slug du CROUS                 (defaut toulouse)
 *   CROUS_RESTO    id du restaurant dans le flux (defaut r674 = Resto U' Blagnac)
 *   CROUS_TTL_MS   TTL du fichier brut           (defaut 14400000 = 4 h)
 *   CROUS_WAIT_MS  attente max d'un visiteur pendant un rafraichissement (defaut 3000)
 *   CROUS_RETRY_MS delai entre deux essais apres un echec            (defaut 300000 = 5 min)
 *   DATA_DIR       dossier de stockage           (defaut /data, sous-dossier crous/)
 *
 * Un visiteur n'attend jamais le CNOUS plus de CROUS_WAIT_MS : cache perime
 * servi tel quel pendant que le flux se recharge en fond, et pas de nouvel
 * essai avant CROUS_RETRY_MS apres un echec (sinon chaque requete attendait le
 * timeout de 20 s tant que le CNOUS etait en panne).
 */

const fs    = require('fs');
const path  = require('path');
const http  = require('http');
const https = require('https');

const CONFIG = {
  region:   (process.env.CROUS_REGION || 'toulouse').replace(/[^a-z0-9-]/g, ''),
  resto:    (process.env.CROUS_RESTO  || 'r674').replace(/[^a-z0-9]/gi, ''),
  ttl:      Number(process.env.CROUS_TTL_MS)   || 4 * 60 * 60 * 1000,
  wait:     Number(process.env.CROUS_WAIT_MS)  || 3000,
  retry:    Number(process.env.CROUS_RETRY_MS) || 5 * 60 * 1000,
  dataDir:  path.join(process.env.DATA_DIR || '/data', 'crous'),
  timeout:  20000,
  // Repli CROUStillant : code du restaurant chez eux (Blagnac = 116), appels en
  // parallele et resultat garde en memoire (ttl) pour ne pas refaire 5 appels par visite
  fallback: { host: 'api.croustillant.menu', code: process.env.CROUS_FALLBACK_CODE || '116', days: 7, timeout: 10000 },
};

// Infos fixes du restaurant (le flux resto.xml les donne aussi, mais en HTML libre)
const RESTAURANT = {
  id:       CONFIG.resto,
  nom:      "Resto U' Blagnac",
  adresse:  '5 rue George Sand, 31700 Blagnac',
  horaires: 'Du lundi au vendredi, le midi (11h45 - 13h45)',
};

const FEED_URL = `http://webservices-v2.crous-mobile.fr/feed/${CONFIG.region}/externe/menu.xml`;

function log(...a)  { console.log(`[${new Date().toISOString()}] [crous]`, ...a); }
function warn(...a) { console.warn(`[${new Date().toISOString()}] [crous]`, ...a); }

// ════════════════════════════════════════════════════
//  Cache disque : fichier brut + meta (dates, ETag)
// ════════════════════════════════════════════════════

const FILE_XML  = path.join(CONFIG.dataDir, `menu-${CONFIG.region}.xml`);
const FILE_META = path.join(CONFIG.dataDir, `menu-${CONFIG.region}.meta.json`);

let cache = null; // { xml, fetchedAt, lastModified, etag }
const state = { lastError: null, lastErrorAt: null, lastOk: null, calls: 0, failures: 0, fallbackCalls: 0 };

function loadFromDisk() {
  try {
    fs.mkdirSync(CONFIG.dataDir, { recursive: true });
    if (!fs.existsSync(FILE_XML)) return;
    const xml  = fs.readFileSync(FILE_XML, 'utf8');
    let meta = {};
    try { meta = JSON.parse(fs.readFileSync(FILE_META, 'utf8')); } catch { /* meta absente : on garde le xml */ }
    cache = { xml, fetchedAt: meta.fetchedAt || new Date(0).toISOString(), lastModified: meta.lastModified || null, etag: meta.etag || null };
    log(`menu ${CONFIG.region} charge depuis le disque (recupere le ${cache.fetchedAt})`);
  } catch (e) { warn(`lecture du cache impossible : ${e.message}`); }
}

function persist() {
  try {
    fs.mkdirSync(CONFIG.dataDir, { recursive: true });
    const tmp = `${FILE_XML}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, cache.xml);
    fs.renameSync(tmp, FILE_XML);
    fs.writeFileSync(FILE_META, JSON.stringify({ fetchedAt: cache.fetchedAt, lastModified: cache.lastModified, etag: cache.etag }));
  } catch (e) { warn(`ecriture du cache impossible : ${e.message}`); }
}

function ageMs() { return cache ? Date.now() - Date.parse(cache.fetchedAt) : Infinity; }

// ════════════════════════════════════════════════════
//  Telechargement du flux (une seule requete a la fois)
// ════════════════════════════════════════════════════

let inFlight = null;

function fetchFeed() {
  if (inFlight) return inFlight;
  inFlight = new Promise((resolve, reject) => {
    const headers = { 'User-Agent': 'KraftFlopEDT/1.0 (+https://kraftflopedt.fr)', Accept: 'text/xml' };
    if (cache?.lastModified) headers['If-Modified-Since'] = cache.lastModified;
    if (cache?.etag)         headers['If-None-Match']     = cache.etag;
    state.calls++;

    const req = http.get(FEED_URL, { headers }, res => {
      const now = new Date().toISOString();
      if (res.statusCode === 304 && cache) {
        res.resume();
        cache.fetchedAt = now; persist();
        state.lastOk = now;
        return resolve({ status: 'not-modified' });
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} sur menu.xml`));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const xml = Buffer.concat(chunks).toString('utf8');
        if (!/<root[\s>]/.test(xml) || !/<\/root>/.test(xml)) return reject(new Error('menu.xml tronque ou invalide'));
        cache = { xml, fetchedAt: now, lastModified: res.headers['last-modified'] || null, etag: res.headers.etag || null };
        persist();
        state.lastOk = now;
        log(`menu ${CONFIG.region} mis a jour (${xml.length} octets, Last-Modified ${cache.lastModified || '?'})`);
        resolve({ status: 'updated' });
      });
      res.on('error', reject);
    });
    req.setTimeout(CONFIG.timeout, () => req.destroy(new Error(`timeout (${CONFIG.timeout / 1000} s)`)));
    req.on('error', reject);
  }).catch(e => {
    state.failures++;
    state.lastError = e.message; state.lastErrorAt = new Date().toISOString();
    warn(`echec du telechargement : ${e.message}`);
    throw e;
  }).finally(() => { inFlight = null; });
  return inFlight;
}

let lastAttemptAt = 0; // dernier lancement de fetchFeed (succes ou echec)

function tryFetch() {
  lastAttemptAt = Date.now();
  return fetchFeed();
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Garantit un flux pas plus vieux que le TTL, sans jamais bloquer le visiteur
 * plus de CONFIG.wait : passe ce delai le cache perime est servi (stale) et le
 * telechargement continue en fond. Apres un echec, pas de nouvel essai avant
 * CONFIG.retry : les requetes suivantes repondent immediatement.
 */
async function ensureFresh() {
  if (cache && ageMs() < CONFIG.ttl) return { ok: true, fromCache: true };

  const canRetry = !inFlight && Date.now() - lastAttemptAt >= CONFIG.retry;
  if (!inFlight && !canRetry) return { ok: false, error: state.lastError || 'flux injoignable' };

  const attempt = (inFlight || tryFetch()).then(() => ({ ok: true, fromCache: false }), e => ({ ok: false, error: e.message }));
  attempt.catch(() => {});
  const res = await Promise.race([attempt, sleep(CONFIG.wait).then(() => null)]);
  if (res) return res;
  return { ok: false, error: `rafraichissement en cours (plus de ${CONFIG.wait / 1000} s)` };
}

// ════════════════════════════════════════════════════
//  Parsing du XML (wrapper regulier) puis du HTML des menus
// ════════════════════════════════════════════════════

// Entites nommees du francais courant ; les autres et les numeriques passent par decodeEntities
const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  eacute: 'é', egrave: 'è', agrave: 'à', ugrave: 'ù', ccedil: 'ç',
  acirc: 'â', ecirc: 'ê', icirc: 'î', ocirc: 'ô', ucirc: 'û', euml: 'ë', iuml: 'ï', uuml: 'ü',
  oelig: 'œ', OElig: 'Œ', Eacute: 'É', Egrave: 'È', Agrave: 'À', Ccedil: 'Ç',
  rsquo: '\u2019', lsquo: '\u2018', ldquo: '\u201c', rdquo: '\u201d', hellip: '\u2026',
  ndash: '\u2013', mdash: '\u2014', laquo: '\u00ab', raquo: '\u00bb', deg: '\u00b0', euro: '\u20ac',
};

function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      // String.fromCodePoint leve une RangeError au-dela de U+10FFFF ou sur un
      // demi-codet : une entite farfelue dans le flux CNOUS ne doit pas planter la route
      if (!Number.isFinite(n) || n <= 0 || n > 0x10FFFF || (n >= 0xD800 && n <= 0xDFFF)) return m;
      return String.fromCodePoint(n);
    }
    return ENTITIES[code] ?? m;
  });
}

function cleanText(s) {
  return decodeEntities(s).replace(/\s+/g, ' ').trim();
}

/** Extrait le bloc <resto id="rXXX">...</resto> du menu.xml (null si absent). */
function extractResto(xml, restoId) {
  const re = new RegExp(`<resto\\s+id="${restoId}"[^>]*?(/>|>)`, 'i');
  const m  = re.exec(xml);
  if (!m) return null;
  if (m[1] === '/>') return '';
  const start = m.index + m[0].length;
  const end   = xml.indexOf('</resto>', start);
  return end < 0 ? xml.slice(start) : xml.slice(start, end);
}

/** Liste des { date, html } d'un bloc resto. */
function extractMenus(block) {
  const out = [];
  const re  = /<menu\s+date="(\d{4}-\d{2}-\d{2})"[^>]*>([\s\S]*?)<\/menu>/gi;
  let m;
  while ((m = re.exec(block))) {
    let inner = m[2].trim();
    const cdata = /^<!\[CDATA\[([\s\S]*?)\]\]>$/.exec(inner);
    inner = cdata ? cdata[1] : decodeEntities(inner); // sans CDATA le HTML est echappe en entites
    out.push({ date: m[1], html: inner });
  }
  return out;
}

const MOMENTS = { matin: 'matin', midi: 'midi', soir: 'soir' };

function normaliseMoment(s) {
  const k = cleanText(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return MOMENTS[k] || k || 'midi';
}

function normaliseLibelle(s) {
  const t = cleanText(s);
  if (!t) return '';
  // Casse normalisee : "ENTREES" -> "Entrees", "Plats du jour" -> "Plats du jour"
  const lower = t.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function isNoise(plat) {
  if (!plat) return true;
  if (plat.startsWith('*')) return true;              // "*sous reserve de changement"
  if (/^menu non communiqu/i.test(plat)) return true; // service ferme / non renseigne
  return false;
}

/**
 * Parcourt le HTML d'un menu balise par balise (pas de regex sur les plats :
 * les balises ne sont pas toujours fermees et la mise en forme varie).
 *   <h2>  ouvre un service          <h4> ouvre une categorie          <li> un plat
 */
function parseMenuHtml(html) {
  const services = [];
  let service = null, category = null;
  let mode = null; // balise dont on collecte le texte : h2 | h4 | li
  let buf  = '';

  const flush = () => {
    const text = cleanText(buf); buf = '';
    if (mode === 'h2') {
      service = { moment: normaliseMoment(text), categories: [] };
      services.push(service); category = null;
    } else if (mode === 'h4') {
      if (!service) { service = { moment: 'midi', categories: [] }; services.push(service); }
      category = { libelle: normaliseLibelle(text) || 'Menu', plats: [] };
      service.categories.push(category);
    } else if (mode === 'li') {
      if (!isNoise(text)) {
        if (!service)  { service  = { moment: 'midi', categories: [] }; services.push(service); }
        if (!category) { category = { libelle: 'Menu', plats: [] }; service.categories.push(category); }
        category.plats.push(text);
      }
    }
    mode = null;
  };

  const re = /<\/?([a-z][a-z0-9]*)\b[^>]*>|<!--[\s\S]*?-->/gi;
  let last = 0, m;
  while ((m = re.exec(html))) {
    if (mode) buf += html.slice(last, m.index);
    last = re.lastIndex;
    if (m[0].startsWith('<!--')) continue;
    const closing = m[0][1] === '/';
    const tag = m[1].toLowerCase();
    if (tag === 'br') { if (mode) buf += ' '; continue; }
    if (['h2', 'h4', 'li'].includes(tag)) {
      if (mode) flush();               // balise precedente non fermee
      if (!closing) mode = tag;
    } else if (tag === 'ul' || tag === 'h3' || tag === 'div' || tag === 'p') {
      if (mode) flush();
    }
    // autres balises (b, span, strong...) : transparentes
  }
  if (mode) { buf += html.slice(last); flush(); }

  // Nettoyage : categories vides puis services vides supprimes
  for (const s of services) s.categories = s.categories.filter(c => c.plats.length);
  return services.filter(s => s.categories.length);
}

/** Toutes les journees publiees pour le restaurant, triees par date. */
function parseFeed(xml, restoId) {
  const block = extractResto(xml, restoId);
  if (block === null) return { found: false, days: [] };
  const days = extractMenus(block)
    .map(({ date, html }) => ({ date, services: parseMenuHtml(html) }))
    .filter(d => d.services.length)
    .sort((a, b) => a.date.localeCompare(b.date));
  return { found: true, days };
}

// ════════════════════════════════════════════════════
//  Repli CROUStillant (JSON deja structure, HTTPS)
// ════════════════════════════════════════════════════

function getJson(host, p) {
  return new Promise((resolve, reject) => {
    const req = https.get({ host, path: p, headers: { 'User-Agent': 'KraftFlopEDT/1.0 (+https://kraftflopedt.fr)', Accept: 'application/json' } }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        if (res.statusCode === 404) return resolve(null);
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} sur ${host}${p}`));
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(e); }
      });
      res.on('error', reject);
    });
    req.setTimeout(CONFIG.fallback.timeout, () => req.destroy(new Error('timeout repli')));
    req.on('error', reject);
  });
}

function fmtDDMMYYYY(d) {
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`;
}
function fmtISO(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

let fallbackCache = null; // { at, days } : resultat du repli, garde CONFIG.ttl (5 min si vide)

async function fetchFallback() {
  if (fallbackCache && Date.now() - fallbackCache.at < (fallbackCache.days.length ? CONFIG.ttl : CONFIG.retry)) {
    return fallbackCache.days;
  }
  const today = new Date();
  const dates = [];
  for (let i = 0; i < CONFIG.fallback.days; i++) {
    const d = new Date(today); d.setDate(today.getDate() + i);
    if (d.getDay() === 0 || d.getDay() === 6) continue; // RU ferme le week-end
    dates.push(d);
  }
  state.fallbackCalls += dates.length;
  const results = await Promise.all(dates.map(d =>
    getJson(CONFIG.fallback.host, `/v1/restaurants/${CONFIG.fallback.code}/menu/${fmtDDMMYYYY(d)}`).catch(() => null)));

  const days = [];
  dates.forEach((d, i) => {
    const repas = results[i]?.data?.repas;
    if (!Array.isArray(repas)) return;
    const services = repas.map(r => ({
      moment: normaliseMoment(r.type || 'midi'),
      categories: (r.categories || []).map(c => ({
        libelle: normaliseLibelle(c.libelle || 'Menu'),
        plats:   (c.plats || []).map(p => cleanText(p.libelle || '')).filter(p => !isNoise(p)),
      })).filter(c => c.plats.length),
    })).filter(s => s.categories.length);
    if (services.length) days.push({ date: fmtISO(d), services });
  });
  fallbackCache = { at: Date.now(), days };
  return days;
}

// ════════════════════════════════════════════════════
//  API publique
// ════════════════════════════════════════════════════

/**
 * Menus du restaurant : { restaurant, region, source, fetchedAt, stale, days: [...] }
 * Ne jette jamais pour une panne amont : `days` peut etre vide, `error` renseigne.
 */
async function getMenus() {
  const fresh = await ensureFresh();
  let result;

  if (cache) {
    const parsed = parseFeed(cache.xml, CONFIG.resto);
    result = {
      source:    'cnous',
      fetchedAt: cache.fetchedAt,
      lastModified: cache.lastModified,
      stale:     !fresh.ok,
      found:     parsed.found,
      days:      parsed.days,
    };
    if (!fresh.ok) result.error = `flux CNOUS injoignable, derniere version connue servie (${fresh.error})`;
  } else {
    // Aucune copie locale et flux injoignable : repli CROUStillant
    let days = [];
    let err  = fresh.error;
    try { days = await fetchFallback(); } catch (e) { err += ` ; repli : ${e.message}`; }
    result = { source: 'croustillant', fetchedAt: new Date().toISOString(), lastModified: null, stale: false, found: days.length > 0, days };
    if (!days.length) result.error = `menus indisponibles (${err})`;
  }

  return { restaurant: RESTAURANT, region: CONFIG.region, ...result };
}

function status() {
  return {
    region: CONFIG.region, resto: CONFIG.resto, ttlMs: CONFIG.ttl,
    cached: !!cache, fetchedAt: cache?.fetchedAt || null, lastModified: cache?.lastModified || null,
    lastAttemptAt: lastAttemptAt ? new Date(lastAttemptAt).toISOString() : null, inFlight: !!inFlight,
    fallbackCachedAt: fallbackCache ? new Date(fallbackCache.at).toISOString() : null,
    ...state,
  };
}

function start() {
  loadFromDisk();
  // Premier telechargement en fond pour que la premiere visite ne l'attende pas
  if (!cache || ageMs() >= CONFIG.ttl) tryFetch().catch(() => {});
}

module.exports = { CONFIG, RESTAURANT, getMenus, status, start, parseMenuHtml, parseFeed, ensureFresh };
