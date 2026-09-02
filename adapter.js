/**
 * adapter.js — REST adapter for the FlOpEDT API
 *
 * Exposes clean endpoints that hide FlOpEDT's messiness:
 *   GET /courses?week=9&year=2026&dept=INFO&group=1A
 *   GET /groups?dept=INFO
 *   GET /free-rooms?week=9&year=2026&day=m&start=480&end=565&dept=INFO
 *   GET /current-week
 *
 * Returns clean, flat, predictable JSON.
 *
 * Sert aussi les 4 endpoints bruts de FlOpEDT utilises par le front, sous
 * /api/flopedt/<endpoint FlOpEDT> (le nginx du conteneur web les relaie ici),
 * et GET /status (etat du store, expose en /api/status par nginx).
 *
 * Toutes les donnees viennent d'un store local (store.js) rafraichi en tache de
 * fond : FlOpEDT n'est jamais appele dans le chemin d'une requete visiteur, sauf
 * pour une donnee qu'on n'a encore jamais vue.
 *
 * Run:
 *   node adapter.js              (port 3001 by default)
 *   PORT=8080 node adapter.js
 *
 * Example:
 *   curl "https://kraftflopedt.habibiserver.dev/courses?week=17&year=2026&dept=INFO&group=1A"
 */

const http  = require('http');
const url   = require('url');

const PORT         = process.env.PORT || 3001;
const FLOPEDT_HOST = 'flopedt.iut-blagnac.fr';

// ════════════════════════════════════════════════════
//  Transport layer — tout passe par le store local (store.js)
//  FlOpEDT n'est appele qu'en tache de fond ou si la donnee manque.
// ════════════════════════════════════════════════════

const store = require('./store');

async function flopFetch(endpoint, params = {}) {
  return (await store.get(endpoint, params)).body;
}

// ════════════════════════════════════════════════════
//  Normalization layer — from FlOpEDT mess to clean JSON
// ════════════════════════════════════════════════════

const DAY_MAP = { m: 'monday', tu: 'tuesday', w: 'wednesday', th: 'thursday', f: 'friday' };
const DAY_INDEX = { m: 0, tu: 1, w: 2, th: 3, f: 4 };

const DEFAULT_DURATIONS = { CM: 85, TD: 85, TP: 85, DS: 85, Projet: 85, QCM: 20, Conf: 90 };

function minutesToHHMM(m) {
  const h  = Math.floor(m / 60);
  const mn = m % 60;
  return `${String(h).padStart(2, '0')}:${String(mn).padStart(2, '0')}`;
}

function detectType(type, name = '') {
  const t = (type || '').toLowerCase();
  const n = (name || '').toLowerCase();
  if (t === 'cm') return 'cm';
  if (t === 'td') return 'td';
  if (t === 'tp') return 'tp';
  if (t === 'projet') return 'project';
  if (t === 'ds' || t === 'qcm' || t.includes('exam') || n.includes('exam')) return 'exam';
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

async function fetchAncestorMap(dept) {
  try {
    const tree = await flopFetch('/fr/api/groups/structural/tree/', { dept });
    const map  = {};
    for (const root of tree) {
      map[root.name] = [];
      if (root.children) buildAncestorMap(root.children, [root.name], map);
    }
    return map;
  } catch { return {}; }
}

async function fetchDurations(dept) {
  try {
    const data = await flopFetch('/fr/api/fetch/constraints/', { dept });
    const map  = {};
    for (const [type, val] of Object.entries(data)) map[type] = val.duration;
    return map;
  } catch { return DEFAULT_DURATIONS; }
}

function isGroupVisible(courseGroup, selectedGroup, ancestorMap) {
  if (!selectedGroup) return true;
  if (!courseGroup)   return true;
  if (courseGroup === selectedGroup) return true;
  return (ancestorMap[selectedGroup] || []).includes(courseGroup);
}

/**
 * Transforms a raw FlOpEDT course into a flat, usable object.
 */
function normalizeCourse(c, durations) {
  const course = c.course  || {};
  const module = course.module || {};
  const groups = course.groups || [];
  const startMin = c.start_time ?? 480;
  const duration = durations[course.type] ?? 85;
  const endMin   = startMin + duration;

  return {
    id:        c.id ?? null,
    module:    module.name || module.abbrev || null,
    abbrev:    module.abbrev || null,
    type:      course.type || null,
    category:  detectType(course.type, module.name),
    day:       DAY_MAP[c.day] || c.day,
    dayIndex:  DAY_INDEX[c.day] ?? -1,
    start:     minutesToHHMM(startMin),
    end:       minutesToHHMM(endMin),
    startMin,
    endMin,
    duration,
    room:      c.room?.name || null,
    tutor:     c.tutor || null,
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
    throw new Error('Required parameters: week, year, dept');
  }

  const [raw, durations, ancestorMap] = await Promise.all([
    flopFetch('/fr/api/fetch/scheduledcourses/', { dept, week, year, work_copy: 0 }),
    fetchDurations(dept),
    group ? fetchAncestorMap(dept) : Promise.resolve({}),
  ]);

  const list = Array.isArray(raw) ? raw : (raw.results || []);

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
  if (!dept) throw new Error('Required parameter: dept');
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
  if (!week || !year || !dept || !day || !start || !end) {
    throw new Error('Required parameters: week, year, dept, day, start, end');
  }

  const [raw, durations] = await Promise.all([
    flopFetch('/fr/api/fetch/scheduledcourses/', { dept, week, year, work_copy: 0 }),
    fetchDurations(dept),
  ]);

  const list = Array.isArray(raw) ? raw : (raw.results || []);
  const startNum = Number(start);
  const endNum   = Number(end);

  // Rooms busy during the requested time slot
  const busy = new Set();
  const allRooms = new Set();

  for (const c of list) {
    const roomName = c.room?.name;
    if (roomName) allRooms.add(roomName);
    if (c.day !== day || !roomName) continue;

    const cStart = c.start_time ?? 0;
    const cEnd   = cStart + (durations[c.course?.type] ?? 85);

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
               + '(timetables hourly, groups/constraints/rooms weekly), so responses never wait for FlOpEDT.',
    contact: { name: 'Clément Herrard', url: 'https://chairgamertag87.fr' },
  },
  servers: [
    { url: 'https://kraftflopedt.habibiserver.dev', description: 'Local dev' },
    { url: 'https://habibiserver.dev', description: 'Production' },
  ],
  tags: [
    { name: 'Schedule', description: 'Course schedules' },
    { name: 'Groups',   description: 'Group hierarchy' },
    { name: 'Rooms',    description: 'Room availability' },
    { name: 'Utility',  description: 'Helpers' },
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
          400: { description: 'Missing required parameter', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
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
  <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
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
  '/':              () => ({
    name: 'KraftFlopEDT Adapter',
    version: '1.0',
    docs: '/docs',
    openapi: '/openapi.json',
    endpoints: [
      'GET /courses?week=9&year=2026&dept=INFO&group=1A',
      'GET /groups?dept=INFO',
      'GET /free-rooms?week=9&year=2026&dept=INFO&day=m&start=480&end=565',
      'GET /current-week',
    ],
  }),
};

const RAW_PREFIX = '/api/flopedt';

function send(res, status, payload) {
  res.writeHead(status, {
    'Content-Type':                'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control':               status === 200 ? 'public, max-age=300' : 'no-store',
  });
  res.end(JSON.stringify(payload, null, 2));
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Accept',
    });
    return res.end();
  }
  if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });

  const parsed = url.parse(req.url, true);

  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);

  // Documentation routes (HTML + raw OpenAPI spec)
  if (parsed.pathname === '/docs') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    return res.end(DOCS_HTML);
  }
  if (parsed.pathname === '/openapi.json') {
    return send(res, 200, OPENAPI_SPEC);
  }
  if (parsed.pathname === '/status') {
    return send(res, 200, store.status());
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
      const isParam = /invalide|disponible|non autorise/.test(e.message);
      return send(res, isParam ? 400 : 503, { error: isParam ? e.message : `FlOpEDT indisponible et aucune donnee locale : ${e.message}` });
    }
  }

  const handler = ROUTES[parsed.pathname];
  if (!handler) return send(res, 404, { error: 'Unknown route', path: parsed.pathname });

  try {
    const data = await handler(parsed.query);
    send(res, 200, { data });
  } catch (e) {
    console.error('[ERR]', e.message);
    const isParam = /^Required parameter|invalide|disponible/.test(e.message);
    send(res, isParam ? 400 : 503, { error: e.message });
  }
});

store.start();

server.listen(PORT, () => {
  console.log(`\n  KraftFlopEDT Adapter → https://kraftflopedt.habibiserver.dev`);
  console.log(`  Docs                 → https://kraftflopedt.habibiserver.dev/docs`);
  console.log(`  Source: https://${FLOPEDT_HOST}\n`);
  console.log('  Endpoints:');
  for (const r of Object.keys(ROUTES).filter(r => r !== '/')) console.log(`    GET ${r}`);
  console.log(`    GET /status`);
  console.log(`    GET ${RAW_PREFIX}<endpoint FlOpEDT>  (${Object.keys(store.ENDPOINTS).length} endpoints)`);
  console.log('');
});
