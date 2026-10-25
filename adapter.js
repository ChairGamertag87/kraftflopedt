/**
 * adapter.js — REST adapter for the FlOpEDT API
 *
 * Exposes clean endpoints that hide FlOpEDT's messiness:
 *   GET /courses?week=9&year=2026&dept=INFO&group=1A
 *   GET /groups?dept=INFO
 *   GET /free-rooms?week=9&year=2026&day=m&start=480&end=565&dept=INFO
 *   GET /current-week
 *   GET /crous/menu          (menus du Resto U' Blagnac, flux CNOUS, voir crous.js)
 *
 * Returns clean, flat, predictable JSON.
 *
 * Sert aussi les 4 endpoints bruts de FlOpEDT utilises par le front, sous
 * /api/flopedt/<endpoint FlOpEDT> (le nginx du conteneur web les relaie ici),
 * et GET /status (etat du store, expose en /api/status par nginx).
 * GET /crous/menu (expose en /api/crous/menu) : menus du Resto U' Blagnac (crous.js).
 *
 * Toutes les donnees viennent d'un store local (store.js) rafraichi en tache de
 * fond : FlOpEDT n'est jamais appele dans le chemin d'une requete visiteur, sauf
 * pour une donnee qu'on n'a encore jamais vue.
 *
 * Run:
 *   node adapter.js              (port 3001 by default)
 *   PORT=8080 node adapter.js
 *
 * Example (port publie en loopback par docker-compose.yml ; en prod, nginx ne
 * relaie que /api/status, /api/crous/menu, /api/flopedt/* et /ical/*) :
 *   curl "http://127.0.0.1:8094/courses?week=17&year=2026&dept=INFO&group=1A"
 */

const http   = require('http');
const url    = require('url');
const crypto = require('crypto');

const PORT         = process.env.PORT || 3001;
const FLOPEDT_HOST = 'flopedt.iut-blagnac.fr';

// ════════════════════════════════════════════════════
//  Transport layer — tout passe par le store local (store.js)
//  FlOpEDT n'est appele qu'en tache de fond ou si la donnee manque.
// ════════════════════════════════════════════════════

const store = require('./store');
const ical  = require('./ical');
const crous = require('./crous');

async function flopFetch(endpoint, params = {}) {
  return (await store.get(endpoint, params)).body;
}

// ════════════════════════════════════════════════════
//  Normalization layer — from FlOpEDT mess to clean JSON
// ════════════════════════════════════════════════════

const DAY_MAP = { m: 'monday', tu: 'tuesday', w: 'wednesday', th: 'thursday', f: 'friday' };
const DAY_INDEX = { m: 0, tu: 1, w: 2, th: 3, f: 4 };

const DEFAULT_DURATIONS = { CM: 85, TD: 85, TP: 85, DS: 85, Projet: 85, QCM: 20, Conf: 90 };

/**
 * Duree d'un type de cours : contraintes du departement, puis suffixe numerique
 * du type (TP240, TD120, CM90, X90 pour RT et GIM), puis valeurs par defaut, puis 85.
 */
function durationOf(type, durations) {
  if (type && Object.hasOwn(durations, type) && Number.isFinite(durations[type])) return durations[type];
  const suffix = /(\d+)$/.exec(type || '');
  if (suffix) return Number(suffix[1]);
  if (type && Object.hasOwn(DEFAULT_DURATIONS, type)) return DEFAULT_DURATIONS[type];
  return 85;
}

function minutesToHHMM(m) {
  const h  = Math.floor(m / 60);
  const mn = m % 60;
  return `${String(h).padStart(2, '0')}:${String(mn).padStart(2, '0')}`;
}

function detectType(type, name = '', abbrev = '') {
  // Meme regle que js/utils.js (nomenclature par departement : TD240, CM90,
  // ExamTP240, CTRL90, X90...). Garder les deux copies synchronisees.
  const t = (type || '').toLowerCase().trim();
  const n = (name || '').toLowerCase();
  const a = (abbrev || '').toLowerCase();
  if (t.startsWith('projet')) return 'project';
  if (t === 'ds' || t === 'qcm' || t.includes('exam') || t.startsWith('ctrl')) return 'exam';
  const m = t.match(/^(cm|td|tp)(?![a-z])/) || t.match(/^(cm)hi/);
  if (m) return m[1];
  if (n.includes('exam')) return 'exam';
  if (/^sa[eé]/.test(a) || /\bsa[eé]s?\b/.test(n)) return 'project';
  return 'other';
}

/**
 * Builds a "group → ancestors" map for hierarchical filtering.
 */
function buildAncestorMap(nodes, ancestors, map) {
  for (const node of nodes) {
    map[node.name] = [...ancestors];
    if (node.children?.length) buildAncestorMap(node.children, [...ancestors, node.name], map);
  }
}

/**
 * Une table d'ancetres par promo (les racines INFO s'appellent toutes "CE" et
 * 1A existe dans chaque promo) ; sans promo, les tables sont fusionnees.
 */
async function fetchAncestorMap(dept, promo) {
  try {
    const tree = await flopFetch('/fr/api/groups/structural/tree/', { dept });
    const byPromo = {}, merged = {};
    for (const root of tree) {
      const p   = root.promo || root.promotxt || root.buttxt || root.name;
      const map = byPromo[p] || (byPromo[p] = {});
      map[root.name] = [];
      if (root.children) buildAncestorMap(root.children, [root.name], map);
      Object.assign(merged, map);
    }
    return (promo && byPromo[promo]) || merged;
  } catch { return {}; }
}

async function fetchDurations(dept) {
  try {
    const data = await flopFetch('/fr/api/fetch/constraints/', { dept });
    const map  = {};
    // Une entree nulle ne doit pas faire perdre toute la table
    for (const [type, val] of Object.entries(data)) {
      if (Number.isFinite(val?.duration)) map[type] = val.duration;
    }
    return map;
  } catch { return DEFAULT_DURATIONS; }
}

function isGroupVisible(courseGroup, selectedGroup, ancestorMap) {
  if (!selectedGroup) return true;
  if (!courseGroup)   return true;
  if (courseGroup === selectedGroup) return true;
  // Object.hasOwn : "constructor" est une cle heritee de {} et n'a pas de includes
  return (Object.hasOwn(ancestorMap, selectedGroup) ? ancestorMap[selectedGroup] : []).includes(courseGroup);
}

/**
 * Transforms a raw FlOpEDT course into a flat, usable object.
 */
function normalizeCourse(c, durations) {
  const course = c.course  || {};
  const module = course.module || {};
  const groups = course.groups || [];
  const startMin = c.start_time ?? 480;
  const duration = durationOf(course.type, durations);
  const endMin   = startMin + duration;

  return {
    id:        c.id ?? null,
    module:    module.name || module.abbrev || null,
    abbrev:    module.abbrev || null,
    type:      course.type || null,
    category:  detectType(course.type, module.name, module.abbrev),
    day:       DAY_MAP[c.day] || c.day,
    dayIndex:  DAY_INDEX[c.day] ?? -1,
    start:     minutesToHHMM(startMin),
    end:       minutesToHHMM(endMin),
    startMin,
    endMin,
    duration,
    room:      c.room?.name || null,
    tutor:     c.tutor || null,
    // FlOpEDT : supp_tutor = [{ username }] (parfois des chaines)
    suppTutors: (course.supp_tutor || []).map(t => (typeof t === 'string' ? t : t?.username)).filter(Boolean),
    groups:    groups.map(g => g.name),
    promo:     groups[0]?.train_prog || null,
    color:     module.display?.color_bg  || null,
    colorText: module.display?.color_txt || null,
  };
}

// ════════════════════════════════════════════════════
//  Business layer — public endpoints
// ════════════════════════════════════════════════════

async function getCourses({ week, year, dept, promo, group }) {
  if (!week || !year || !dept) {
    throw store.httpError(400, 'Required parameters: week, year, dept');
  }

  const [raw, durations, ancestorMap] = await Promise.all([
    flopFetch('/fr/api/fetch/scheduledcourses/', { dept, week, year, work_copy: 0 }),
    fetchDurations(dept),
    group ? fetchAncestorMap(dept, promo) : Promise.resolve({}),
  ]);

  const list = Array.isArray(raw) ? raw : (raw.results || []);

  // Une table vide signifie un arbre indisponible, pas un groupe inconnu
  if (group && Object.keys(ancestorMap).length && !Object.hasOwn(ancestorMap, group)) {
    throw store.httpError(400, `Unknown group "${group}" for ${dept}${promo ? '/' + promo : ''}`);
  }

  return list
    .map(c => normalizeCourse(c, durations))
    .filter(c => {
      if (c.dayIndex < 0) return false;
      if (promo && c.promo && c.promo !== promo) return false;
      if (group && !c.groups.some(g => isGroupVisible(g, group, ancestorMap))) return false;
      return true;
    })
    .sort((a, b) => a.dayIndex - b.dayIndex || a.startMin - b.startMin);
}

async function getGroupTree({ dept }) {
  if (!dept) throw store.httpError(400, 'Required parameter: dept');
  const tree = await flopFetch('/fr/api/groups/structural/tree/', { dept });

  const flatten = (nodes, parent = null) => {
    const out = [];
    for (const n of nodes) {
      out.push({ name: n.name, parent, promo: n.train_prog || parent || n.name });
      if (n.children?.length) out.push(...flatten(n.children, n.name));
    }
    return out;
  };

  return { tree, flat: flatten(tree) };
}

async function getFreeRooms({ week, year, dept, day, start, end }) {
  if (!week || !year || !dept || !day || start == null || end == null || start === '' || end === '') {
    throw store.httpError(400, 'Required parameters: week, year, dept, day, start, end');
  }
  const start_num = Number(start);
  const end_num   = Number(end);
  if (!Number.isInteger(start_num) || !Number.isInteger(end_num) || start_num < 0 || start_num >= end_num) {
    throw store.httpError(400, 'start and end must be integers (minutes since midnight) with start < end');
  }
  if (!Object.hasOwn(DAY_INDEX, day)) {
    throw store.httpError(400, `day must be one of: ${Object.keys(DAY_INDEX).join(', ')}`);
  }

  const [raw, durations] = await Promise.all([
    flopFetch('/fr/api/fetch/scheduledcourses/', { dept, week, year, work_copy: 0 }),
    fetchDurations(dept),
  ]);

  const list = Array.isArray(raw) ? raw : (raw.results || []);
  const startNum = start_num;
  const endNum   = end_num;

  // Rooms busy during the requested time slot
  const busy = new Set();
  const allRooms = new Set();

  for (const c of list) {
    const roomName = c.room?.name;
    if (roomName) allRooms.add(roomName);
    if (c.day !== day || !roomName) continue;

    const cStart = c.start_time ?? 0;
    const cEnd   = cStart + durationOf(c.course?.type, durations);

    // Overlap check
    if (cStart < endNum && cEnd > startNum) busy.add(roomName);
  }

  const free = [...allRooms].filter(r => !busy.has(r)).sort();
  return { free, busy: [...busy].sort(), total: allRooms.size };
}

function getCurrentWeek() {
  const d = new Date();
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return { week, year: date.getUTCFullYear() };
}

// ════════════════════════════════════════════════════
//  OpenAPI spec
// ════════════════════════════════════════════════════

const OPENAPI_SPEC = {
  openapi: '3.0.3',
  info: {
    title: 'KraftFlopEDT Adapter API',
    version: '2.0.0',
    description: 'A clean REST adapter that wraps the messy FlOpEDT API (IUT Blagnac).\n\n'
               + 'Returns flat, predictable JSON. Built with vanilla Node.js, zero dependencies.\n\n'
               + 'All data is served from a local store refreshed in the background '
               + '(timetables hourly, groups/constraints/rooms weekly), so responses never wait for FlOpEDT.\n\n'
               + 'Public exposure (https://kraftflopedt.fr, through nginx): only /api/status (-> /status), '
               + '/api/crous/menu (-> /crous/menu), /api/flopedt/* and /ical/*. The other routes are reachable '
               + 'from the host only (127.0.0.1:8094).',
    contact: { name: 'Clément Herrard', url: 'https://chairgamertag87.fr' },
  },
  servers: [
    { url: 'http://127.0.0.1:8094', description: 'Host (docker-compose, loopback only)' },
  ],
  tags: [
    { name: 'Schedule', description: 'Course schedules' },
    { name: 'Groups',   description: 'Group hierarchy' },
    { name: 'Rooms',    description: 'Room availability' },
    { name: 'Utility',  description: 'Helpers' },
    { name: 'CROUS',    description: "Menus du Resto U' Blagnac (flux CNOUS)" },
  ],
  paths: {
    '/courses': {
      get: {
        tags: ['Schedule'],
        summary: 'Get scheduled courses for a given week',
        parameters: [
          { name: 'week',  in: 'query', required: true,  schema: { type: 'integer', minimum: 1, maximum: 53 }, example: 17 },
          { name: 'year',  in: 'query', required: true,  schema: { type: 'integer' }, example: 2026 },
          { name: 'dept',  in: 'query', required: false, schema: { type: 'string', default: 'INFO' }, example: 'INFO' },
          { name: 'promo', in: 'query', required: false, schema: { type: 'string' }, example: 'BUT1' },
          { name: 'group', in: 'query', required: false, schema: { type: 'string' }, example: '1A' },
        ],
        responses: {
          200: {
            description: 'List of normalized courses',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/CourseListResponse' } } },
          },
          400: { description: 'Missing, invalid or repeated parameter, unknown department or group', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          404: { description: 'Week outside the current academic year', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          503: { description: 'FlOpEDT unreachable and no local copy', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/groups': {
      get: {
        tags: ['Groups'],
        summary: 'Get the group hierarchy tree for a department',
        parameters: [
          { name: 'dept', in: 'query', required: false, schema: { type: 'string', default: 'INFO' }, example: 'INFO' },
        ],
        responses: {
          200: { description: 'Group tree (raw + flattened)', content: { 'application/json': { schema: { $ref: '#/components/schemas/GroupTreeResponse' } } } },
          400: { description: 'Unknown department or repeated parameter', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          503: { description: 'FlOpEDT unreachable and no local copy', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/free-rooms': {
      get: {
        tags: ['Rooms'],
        summary: 'List free rooms during a given time slot',
        parameters: [
          { name: 'week',  in: 'query', required: true, schema: { type: 'integer' }, example: 17 },
          { name: 'year',  in: 'query', required: true, schema: { type: 'integer' }, example: 2026 },
          { name: 'dept',  in: 'query', required: false, schema: { type: 'string', default: 'INFO' } },
          { name: 'day',   in: 'query', required: true, schema: { type: 'string', enum: ['m', 'tu', 'w', 'th', 'f'] }, example: 'm' },
          { name: 'start', in: 'query', required: true, schema: { type: 'integer', description: 'Minutes since midnight' }, example: 480 },
          { name: 'end',   in: 'query', required: true, schema: { type: 'integer', description: 'Minutes since midnight' }, example: 565 },
        ],
        responses: {
          200: { description: 'Free / busy rooms', content: { 'application/json': { schema: { $ref: '#/components/schemas/FreeRoomsResponse' } } } },
          400: { description: 'Missing or invalid parameter (day, start, end), unknown department', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          404: { description: 'Week outside the current academic year', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          503: { description: 'FlOpEDT unreachable and no local copy', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/current-week': {
      get: {
        tags: ['Utility'],
        summary: 'Get the current ISO week and year',
        responses: {
          200: { description: 'Current week info', content: { 'application/json': { schema: { $ref: '#/components/schemas/CurrentWeekResponse' } } } },
        },
      },
    },
    '/crous/menu': {
      get: {
        tags: ['CROUS'],
        summary: "Menus a venir du Resto U' Blagnac (CROUS de Toulouse-Occitanie)",
        description: 'Source : flux XML officiel du CNOUS (r674, region toulouse), cache 4 h cote serveur. '
                   + 'Repli sur l\'API CROUStillant si le flux est injoignable. Les menus sont indicatifs et peuvent differer de ce qui est servi.',
        responses: {
          200: { description: 'Menus normalises, du jour courant aux jours suivants publies', content: { 'application/json': { schema: { $ref: '#/components/schemas/CrousMenuResponse' } } } },
          503: { description: 'Aucune source disponible', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/status': {
      get: {
        tags: ['Utility'],
        summary: 'Store and CROUS cache state (public as /api/status)',
        responses: {
          200: { description: 'Never cached', content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } } },
        },
      },
    },
    '/ical/{dept}/{promo}.ics': {
      get: {
        tags: ['Schedule'],
        summary: 'iCalendar feed of a promo (public as /ical/...)',
        parameters: [
          { name: 'dept',  in: 'path', required: true, schema: { type: 'string' }, example: 'INFO' },
          { name: 'promo', in: 'path', required: true, schema: { type: 'string' }, example: 'BUT1' },
        ],
        responses: {
          200: { description: 'text/calendar', content: { 'text/calendar': { schema: { type: 'string' } } } },
          404: { description: 'Unknown feed, promo or group', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          503: { description: 'No local data', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/ical/{dept}/{promo}/{group}.ics': {
      get: {
        tags: ['Schedule'],
        summary: 'iCalendar feed of a group (public as /ical/...)',
        parameters: [
          { name: 'dept',  in: 'path', required: true, schema: { type: 'string' }, example: 'INFO' },
          { name: 'promo', in: 'path', required: true, schema: { type: 'string' }, example: 'BUT1' },
          { name: 'group', in: 'path', required: true, schema: { type: 'string' }, example: '1A' },
        ],
        responses: {
          200: { description: 'text/calendar', content: { 'text/calendar': { schema: { type: 'string' } } } },
          404: { description: 'Unknown feed, promo or group', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          503: { description: 'No local data', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/ical/prof/{dept}/{tutor}.ics': {
      get: {
        tags: ['Schedule'],
        summary: 'iCalendar feed of a teacher (public as /ical/...)',
        parameters: [
          { name: 'dept',  in: 'path', required: true, schema: { type: 'string' }, example: 'INFO' },
          { name: 'tutor', in: 'path', required: true, schema: { type: 'string' }, example: 'NEK' },
        ],
        responses: {
          200: { description: 'text/calendar', content: { 'text/calendar': { schema: { type: 'string' } } } },
          404: { description: 'Unknown feed', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          503: { description: 'No local data', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/api/flopedt/{endpoint}': {
      get: {
        tags: ['Utility'],
        summary: 'Raw FlOpEDT endpoint served from the local store (used by the front)',
        description: 'Allowed endpoints: fr/api/fetch/scheduledcourses/, fr/api/fetch/constraints/, fr/api/groups/structural/tree/, fr/api/rooms/all/. '
                   + 'Query parameters are validated by the store (dept whitelist, week/year integers, no repeated parameter).',
        parameters: [
          { name: 'endpoint', in: 'path', required: true, schema: { type: 'string' }, example: 'fr/api/fetch/scheduledcourses/' },
        ],
        responses: {
          200: { description: 'FlOpEDT JSON body, with X-Cache and X-Data-Fetched-At headers', content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } } },
          400: { description: 'Parameter rejected by the store', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          404: { description: 'Endpoint not allowed or week outside the academic year', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          503: { description: 'FlOpEDT unreachable and no local copy', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
  },
  components: {
    schemas: {
      Course: {
        type: 'object',
        properties: {
          id:        { type: 'integer', nullable: true },
          module:    { type: 'string',  example: 'DevObj' },
          abbrev:    { type: 'string',  example: 'DevObj' },
          type:      { type: 'string',  example: 'TP' },
          category:  { type: 'string',  enum: ['cm', 'td', 'tp', 'project', 'exam', 'other'] },
          day:       { type: 'string',  example: 'monday' },
          dayIndex:  { type: 'integer', example: 0 },
          start:     { type: 'string',  example: '08:00' },
          end:       { type: 'string',  example: '09:25' },
          startMin:  { type: 'integer', example: 480 },
          endMin:    { type: 'integer', example: 565 },
          duration:  { type: 'integer', example: 85 },
          room:      { type: 'string',  nullable: true, example: 'B009' },
          tutor:     { type: 'string',  nullable: true, example: 'NEK' },
          suppTutors: { type: 'array', items: { type: 'string' }, description: 'Co-enseignants (supp_tutor FlOpEDT)', example: ['MDM'] },
          groups:    { type: 'array',   items: { type: 'string' }, example: ['1A'] },
          promo:     { type: 'string',  nullable: true, example: 'BUT1' },
          color:     { type: 'string',  nullable: true, example: '#af3014' },
          colorText: { type: 'string',  nullable: true },
        },
      },
      CourseListResponse: {
        type: 'object',
        properties: {
          data: { type: 'array', items: { $ref: '#/components/schemas/Course' } },
        },
      },
      GroupTreeResponse: {
        type: 'object',
        properties: {
          data: {
            type: 'object',
            properties: {
              tree: { type: 'array', items: { type: 'object' } },
              flat: { type: 'array', items: {
                type: 'object',
                properties: {
                  name:   { type: 'string', example: '1A' },
                  parent: { type: 'string', nullable: true, example: '1' },
                  promo:  { type: 'string', example: 'BUT1' },
                },
              } },
            },
          },
        },
      },
      FreeRoomsResponse: {
        type: 'object',
        properties: {
          data: {
            type: 'object',
            properties: {
              free:  { type: 'array', items: { type: 'string' }, example: ['B009', 'B011'] },
              busy:  { type: 'array', items: { type: 'string' }, example: ['B007'] },
              total: { type: 'integer', example: 12 },
            },
          },
        },
      },
      CurrentWeekResponse: {
        type: 'object',
        properties: {
          data: {
            type: 'object',
            properties: {
              week: { type: 'integer', example: 17 },
              year: { type: 'integer', example: 2026 },
            },
          },
        },
      },
      CrousMenuResponse: {
        type: 'object',
        properties: {
          data: {
            type: 'object',
            properties: {
              restaurant:   { type: 'object', properties: { id: { type: 'string', example: 'r674' }, nom: { type: 'string', example: "Resto U' Blagnac" }, adresse: { type: 'string' }, horaires: { type: 'string' } } },
              region:       { type: 'string', example: 'toulouse' },
              source:       { type: 'string', enum: ['cnous', 'croustillant'] },
              fetchedAt:    { type: 'string', format: 'date-time' },
              lastModified: { type: 'string', nullable: true },
              stale:        { type: 'boolean', description: 'true si le flux n\'a pas pu etre rafraichi et que le cache est perime' },
              days: { type: 'array', items: {
                type: 'object',
                properties: {
                  date:     { type: 'string', example: '2026-09-22' },
                  services: { type: 'array', items: {
                    type: 'object',
                    properties: {
                      moment:     { type: 'string', enum: ['matin', 'midi', 'soir'] },
                      categories: { type: 'array', items: {
                        type: 'object',
                        properties: {
                          libelle: { type: 'string', example: 'Menu traditionnel' },
                          plats:   { type: 'array', items: { type: 'string' }, example: ['Cuisse de poulet', 'Semoule aux raisins'] },
                        },
                      } },
                    },
                  } },
                },
              } },
            },
          },
        },
      },
      Error: {
        type: 'object',
        properties: {
          error: { type: 'string',  example: 'Required parameters: week, year, dept' },
        },
      },
    },
  },
};

const DOCS_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>KraftFlopEDT Adapter — API Docs</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>📚</text></svg>" />
</head>
<body>
  <script id="api-reference" data-url="/openapi.json"></script>
  <script>
    var configuration = {
      theme: 'kepler',
      layout: 'modern',
      hideDownloadButton: false,
      defaultOpenAllTags: true,
      metaData: { title: 'KraftFlopEDT Adapter' },
    };
    document.getElementById('api-reference').dataset.configuration = JSON.stringify(configuration);
  </script>
  <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.72.3"></script>
</body>
</html>`;

// ════════════════════════════════════════════════════
//  HTTP router
// ════════════════════════════════════════════════════

const ROUTES = {
  '/courses':       (q) => getCourses({
                            week:  q.week,
                            year:  q.year,
                            dept:  q.dept  || 'INFO',
                            promo: q.promo,
                            group: q.group,
                          }),
  '/groups':        (q) => getGroupTree({ dept: q.dept || 'INFO' }),
  '/free-rooms':    (q) => getFreeRooms({
                            week:  q.week,
                            year:  q.year,
                            dept:  q.dept || 'INFO',
                            day:   q.day,
                            start: q.start,
                            end:   q.end,
                          }),
  '/current-week':  () => getCurrentWeek(),
  '/crous/menu':    async () => {
                      // Jours passes retires : le flux CNOUS garde parfois la semaine entiere
                      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
                      const out = await crous.getMenus(today);
                      return { ...out, days: (out.days || []).filter(d => d.date >= today) };
                    },
  '/':              () => ({
    name: 'KraftFlopEDT Adapter',
    version: OPENAPI_SPEC.info.version,
    docs: '/docs',
    openapi: '/openapi.json',
    endpoints: [
      'GET /courses?week=9&year=2026&dept=INFO&group=1A',
      'GET /groups?dept=INFO',
      'GET /free-rooms?week=9&year=2026&dept=INFO&day=m&start=480&end=565',
      'GET /current-week',
      'GET /crous/menu',
      'GET /status',
      'GET /ical/<dept>/<promo>[/<groupe>].ics, GET /ical/prof/<dept>/<initiales>.ics',
      `GET ${RAW_PREFIX}/<endpoint FlOpEDT>`,
    ],
  }),
};

const RAW_PREFIX = '/api/flopedt';

function send(res, status, payload, cacheControl) {
  res.writeHead(status, {
    'Content-Type':                'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control':               cacheControl || (status === 200 ? 'public, max-age=300' : 'no-store'),
  });
  res.end(JSON.stringify(payload, null, 2));
}

const server = http.createServer(async (req, res) => {
  // HEAD : Node n'ecrit pas le corps pour cette methode, les routes restent inchangees.
  // OPTIONS n'arrive jamais ici (nginx le refuse en amont), le code dedie a ete retire.
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed' });

  const parsed = url.parse(req.url, true);

  // Le healthcheck (wget busybox sur /status toutes les 60 s) n'est pas journalise
  const is_healthcheck = parsed.pathname === '/status' && /^Wget/.test(req.headers['user-agent'] || '');
  if (!is_healthcheck) console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);

  // Documentation routes (HTML + raw OpenAPI spec)
  if (parsed.pathname === '/docs') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    return res.end(DOCS_HTML);
  }
  if (parsed.pathname === '/openapi.json') {
    return send(res, 200, OPENAPI_SPEC);
  }
  if (parsed.pathname === '/status') {
    // Etat instantane : jamais mis en cache (nginx renvoie la meme consigne)
    return send(res, 200, { ...store.status(), crous: crous.status() }, 'no-store');
  }

  // Endpoints bruts FlOpEDT pour le front (js/api.js) : /api/flopedt/fr/api/...
  if (parsed.pathname.startsWith(RAW_PREFIX)) {
    const endpoint = parsed.pathname.slice(RAW_PREFIX.length);
    if (!store.ENDPOINTS[endpoint]) return send(res, 404, { error: 'Endpoint FlOpEDT non autorise', path: endpoint });
    try {
      const { body, fetchedAt, status } = await store.get(endpoint, parsed.query);
      res.writeHead(200, {
        'Content-Type':                'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control':               'public, max-age=60',
        'X-Cache':                     status,
        'X-Data-Fetched-At':           fetchedAt,
      });
      return res.end(JSON.stringify(body));
    } catch (e) {
      console.error('[ERR]', e.message);
      // Seules les erreurs typees par le store (parametre refuse) sont des 4xx :
      // un "JSON invalide sur ..." renvoye par FlOpEDT est bien une panne amont.
      const status = e.status || 503;
      return send(res, status, { error: status < 500 ? e.message : `FlOpEDT indisponible et aucune donnee locale : ${e.message}` });
    }
  }

  // Flux iCalendar : /ical/<dept>/<promo>[/<groupe>].ics ou /ical/prof/<dept>/<initiales>.ics
  if (parsed.pathname.startsWith('/ical/')) {
    const sel = ical.parsePath(parsed.pathname);
    if (!sel) return send(res, 404, { error: 'Flux iCal inconnu. Formes : /ical/<dept>/<promo>.ics, /ical/<dept>/<promo>/<groupe>.ics, /ical/prof/<dept>/<initiales>.ics' });
    try {
      const out = await ical.build(sel);
      if (!out) return send(res, 404, { error: sel.tutor ? 'Enseignant inconnu pour ce departement (initiales FlOpEDT, tutor ou co-enseignant)' : 'Promo ou groupe inconnu pour ce departement', ...sel });
      const raw_name = ['edt', sel.dept, sel.promo, sel.group, sel.tutor].filter(Boolean).join('-');
      const fname    = raw_name.replace(/[^\w.-]+/g, '_');   // repli ASCII (RFC 6266)
      // filename* RFC 5987 : encodeURIComponent laisse passer '()* qui n'y sont pas admis
      const fname_utf8 = encodeURIComponent(`${raw_name}.ics`).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
      const etag          = `"${crypto.createHash('sha1').update(out.ics).digest('base64url')}"`;
      const last_modified = new Date(out.lastModified);
      last_modified.setUTCMilliseconds(0); // If-Modified-Since est a la seconde
      const headers = {
        'Access-Control-Allow-Origin': '*',
        'Cache-Control':               'public, max-age=600',
        'ETag':                        etag,
        'Last-Modified':               last_modified.toUTCString(),
        'X-Event-Count':               String(out.count),
      };
      const if_none_match     = req.headers['if-none-match'];
      const if_modified_since = Date.parse(req.headers['if-modified-since'] || '');
      const not_modified = if_none_match
        ? if_none_match.split(',').some(t => t.trim() === etag || t.trim() === 'W/' + etag)
        : (Number.isFinite(if_modified_since) && last_modified.getTime() <= if_modified_since);
      if (not_modified) { res.writeHead(304, headers); return res.end(); }
      res.writeHead(200, {
        ...headers,
        'Content-Type':                'text/calendar; charset=utf-8',
        'Content-Disposition':         `inline; filename="${fname}.ics"; filename*=UTF-8''${fname_utf8}`,
      });
      return res.end(out.ics);
    } catch (e) {
      console.error('[ERR]', e.message);
      return send(res, 503, { error: `Donnees indisponibles : ${e.message}` });
    }
  }

  const handler = ROUTES[parsed.pathname];
  if (!handler) return send(res, 404, { error: 'Unknown route', path: parsed.pathname });

  // url.parse rend un tableau pour un parametre repete : les filtres compareraient
  // une chaine a un tableau et repondraient 200 avec une liste vide
  const repeated = Object.keys(parsed.query).filter(k => Array.isArray(parsed.query[k]));
  if (repeated.length) return send(res, 400, { error: `Repeated query parameter: ${repeated.join(', ')}` });

  try {
    const data = await handler(parsed.query);
    send(res, 200, { data });
  } catch (e) {
    console.error('[ERR]', e.message);
    send(res, e.status || 503, { error: e.message });
  }
});

store.start();
crous.start();

server.listen(PORT, () => {
  console.log(`\n  KraftFlopEDT Adapter listening on http://127.0.0.1:${PORT}`);
  console.log(`  Docs: http://127.0.0.1:${PORT}/docs`);
  console.log(`  Source: https://${FLOPEDT_HOST}\n`);
  console.log('  Endpoints:');
  for (const r of Object.keys(ROUTES).filter(r => r !== '/')) console.log(`    GET ${r}`);
  console.log(`    GET /status`);
  console.log(`    GET ${RAW_PREFIX}<endpoint FlOpEDT>  (${Object.keys(store.ENDPOINTS).length} endpoints)`);
  console.log('');
});
