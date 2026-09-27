/**
 * ical.js — flux iCalendar (RFC 5545) generes depuis le store local (store.js).
 *
 *   /ical/<dept>/<promo>.ics            tous les cours d'une promo
 *   /ical/<dept>/<promo>/<groupe>.ics   cours d'un groupe (+ ceux de ses groupes parents)
 *   /ical/prof/<dept>/<initiales>.ics   cours d'un enseignant
 *
 * FlOpEDT n'est jamais appele : on parcourt les semaines deja en memoire.
 * La logique de filtrage (promo, ancetres de groupe, durees par type) est la
 * meme que celle du front (js/api.js), portee cote serveur.
 */

const store = require('./store');

const ENDPOINT_COURSES     = '/fr/api/fetch/scheduledcourses/';
const ENDPOINT_TREE        = '/fr/api/groups/structural/tree/';
const ENDPOINT_CONSTRAINTS = '/fr/api/fetch/constraints/';

const DAY_INDEX = { m: 0, tu: 1, w: 2, th: 3, f: 4, sa: 5, su: 6 };
const DEFAULT_DURATION = 85;
const TZID = 'Europe/Paris';
const HOST = process.env.PUBLIC_HOST || 'kraftflopedt.fr';

// Bloc VTIMEZONE Europe/Paris (regles UE : dernier dimanche de mars / octobre)
const VTIMEZONE = [
  'BEGIN:VTIMEZONE',
  `TZID:${TZID}`,
  'X-LIC-LOCATION:Europe/Paris',
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:+0100',
  'TZOFFSETTO:+0200',
  'TZNAME:CEST',
  'DTSTART:19700329T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:+0200',
  'TZOFFSETTO:+0100',
  'TZNAME:CET',
  'DTSTART:19701025T030000',
  'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
  'END:STANDARD',
  'END:VTIMEZONE',
];

// ════════════════════════════════════════════════════
//  Dates
// ════════════════════════════════════════════════════

/** Lundi (minuit UTC, utilise comme simple date civile) de la semaine ISO demandee. */
function isoWeekMonday(year, week) {
  const jan4 = new Date(Date.UTC(year, 0, 4));            // le 4 janvier est toujours en semaine 1
  const dow  = jan4.getUTCDay() || 7;                      // 1 = lundi ... 7 = dimanche
  const mon  = new Date(jan4);
  mon.setUTCDate(jan4.getUTCDate() - (dow - 1) + (week - 1) * 7);
  return mon;
}

const pad = n => String(n).padStart(2, '0');

/** Date civile + minutes depuis minuit -> "YYYYMMDDTHHMMSS" (heure locale, sans Z). */
function fmtLocal(day, minutes) {
  const d = new Date(day);
  d.setUTCDate(d.getUTCDate() + Math.floor(minutes / 1440));
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(Math.floor(m / 60))}${pad(m % 60)}00`;
}

/** Date JS -> "YYYYMMDDTHHMMSSZ" (UTC). */
function fmtUtc(date) {
  const d = new Date(date);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

// ════════════════════════════════════════════════════
//  Encodage iCalendar
// ════════════════════════════════════════════════════

/** Echappe une valeur TEXT (RFC 5545 §3.3.11). */
function esc(s) {
  return String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

/** Plie une ligne a 75 octets max (RFC 5545 §3.1), sans couper un caractere UTF-8. */
function fold(line) {
  const out = [];
  let cur = '', curBytes = 0;
  for (const ch of line) {
    const b = Buffer.byteLength(ch, 'utf8');
    const limit = out.length === 0 ? 75 : 74;              // les lignes de continuation commencent par un espace
    if (curBytes + b > limit) { out.push(cur); cur = ' ' + ch; curBytes = 1 + b; }
    else { cur += ch; curBytes += b; }
  }
  out.push(cur);
  return out.join('\r\n');
}

// ════════════════════════════════════════════════════
//  Donnees : arbre des groupes, durees
// ════════════════════════════════════════════════════

function walkTree(nodes, ancestors, map) {
  for (const node of nodes || []) {
    map[node.name] = [...ancestors];
    if (node.children && node.children.length) walkTree(node.children, [...ancestors, node.name], map);
  }
}

/**
 * @returns {{promos: string[], byPromo: Object<string, Object<string,string[]>>}}
 *   promos  : identifiants de promo (champ promo/promotxt de la racine, sinon son nom ;
 *             en INFO les trois racines s'appellent toutes "CE")
 *   byPromo : promo -> (groupe -> liste de ses ancetres, racine incluse), comme js/ui.js + js/api.js
 */
async function loadGroups(dept) {
  const tree = (await store.get(ENDPOINT_TREE, { dept })).body;
  const promos = [], byPromo = {};
  for (const root of Array.isArray(tree) ? tree : []) {
    const promo = root.promo || root.promotxt || root.buttxt || root.name;
    if (!promos.includes(promo)) promos.push(promo);
    const map = byPromo[promo] || (byPromo[promo] = {});
    map[root.name] = [];
    walkTree(root.children, [root.name], map);
  }
  return { promos, byPromo };
}

async function loadDurations(dept) {
  try {
    const data = (await store.get(ENDPOINT_CONSTRAINTS, { dept })).body || {};
    const map = {};
    for (const [type, val] of Object.entries(data)) if (val && val.duration) map[type] = val.duration;
    return map;
  } catch (_) { return {}; }
}

function isGroupVisible(courseGroup, selectedGroup, ancestors) {
  if (!courseGroup) return true;
  if (courseGroup === selectedGroup) return true;
  return (Object.hasOwn(ancestors, selectedGroup) ? ancestors[selectedGroup] : []).includes(courseGroup);
}

// ════════════════════════════════════════════════════
//  Generation
// ════════════════════════════════════════════════════

/**
 * @param {{dept: string, promo?: string, group?: string, tutor?: string}} sel
 * @returns {Promise<{ics: string, count: number, lastModified: string}|null>}  null si promo/groupe inconnu
 */
async function build(sel) {
  const dept = sel.dept;
  const [groups, durations] = await Promise.all([loadGroups(dept), loadDurations(dept)]);

  let name;
  if (sel.tutor) {
    name = `${sel.tutor} · ${dept}`;
  } else {
    if (!sel.promo || !groups.promos.includes(sel.promo)) return null;
    // Object.hasOwn : "constructor" in {} est vrai et faisait planter le filtre (503)
    if (sel.group && !Object.hasOwn(groups.byPromo[sel.promo], sel.group)) return null;
    name = [dept, sel.promo, sel.group].filter(Boolean).join(' · ');
  }

  // Semaines entretenues par le store (pas les fichiers oublies d'annees passees)
  const weeks = new Set(store.weeksToMaintain().map(w => `${w.year}-${w.week}`));
  const entries = store.entries(ENDPOINT_COURSES, e => e.params.dept === dept && weeks.has(`${e.params.year}-${e.params.week}`));

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//KraftFlopEDT//${HOST}//FR`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:EDT ${esc(name)}`,
    `X-WR-TIMEZONE:${TZID}`,
    'X-WR-CALDESC:Emploi du temps IUT de Blagnac (source FlOpEDT) via KraftFlopEDT',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
    ...VTIMEZONE,
  ];

  const seen = new Set();
  let count = 0, lastModified = null;

  for (const entry of entries) {
    const list = Array.isArray(entry.body) ? entry.body : (entry.body?.results || []);
    const monday = isoWeekMonday(entry.params.year, entry.params.week);
    const stamp  = fmtUtc(entry.fetchedAt);
    if (!lastModified || entry.fetchedAt > lastModified) lastModified = entry.fetchedAt;

    for (const c of list) {
      if (c == null || seen.has(c.id)) continue;
      const dayIdx = DAY_INDEX[c.day];
      if (dayIdx === undefined || typeof c.start_time !== 'number') continue;

      const course  = c.course || {};
      const module  = course.module || {};
      const grps    = course.groups || [];
      const grpNames = grps.map(g => g.name);
      const promo   = grps[0]?.train_prog || '';
      // supp_tutor = co-enseignants sous la forme [{ username: 'MPH' }] : les
      // objets bruts donnaient "[object Object]" dans la description et ne
      // correspondaient jamais au flux /ical/prof/
      const tutors  = [c.tutor, ...(course.supp_tutor || []).map(t => (typeof t === 'string' ? t : t?.username))].filter(Boolean);

      if (sel.tutor) {
        if (!tutors.includes(sel.tutor)) continue;
      } else {
        if (promo && promo !== sel.promo) continue;
        if (sel.group && !grpNames.some(g => isGroupVisible(g, sel.group, groups.byPromo[sel.promo]))) continue;
      }

      seen.add(c.id);
      count++;

      const type     = course.type || '';
      const abbrev   = module.abbrev || module.name || '?';
      const fullName = module.name || abbrev;
      const room     = c.room?.name || '';
      const start    = c.start_time;
      const end      = start + (durations[type] || DEFAULT_DURATION);
      const grpStr   = grpNames.join(', ');

      const summary = sel.tutor
        ? [type, abbrev, grpStr].filter(Boolean).join(' · ')
        : [type, abbrev].filter(Boolean).join(' ');

      const desc = [
        fullName,
        tutors.length ? `Prof : ${tutors.join(', ')}` : null,
        grpStr ? `Groupes : ${grpStr}` : null,
        room ? `Salle : ${room}` : null,
        `Semaine ${entry.params.week}`,
      ].filter(Boolean).join('\n');

      lines.push(
        'BEGIN:VEVENT',
        `UID:sc-${c.id}@${HOST}`,
        `DTSTAMP:${stamp}`,
        `LAST-MODIFIED:${stamp}`,
        `DTSTART;TZID=${TZID}:${fmtLocal(monday, dayIdx * 1440 + start)}`,
        `DTEND;TZID=${TZID}:${fmtLocal(monday, dayIdx * 1440 + end)}`,
        `SUMMARY:${esc(summary)}`,
        room ? `LOCATION:${esc(room)}` : null,
        `DESCRIPTION:${esc(desc)}`,
        `CATEGORIES:${esc(type || 'Cours')}`,
        'STATUS:CONFIRMED',
        'TRANSP:OPAQUE',
        'END:VEVENT',
      );
    }
  }

  lines.push('END:VCALENDAR');
  const ics = lines.filter(l => l != null).map(fold).join('\r\n') + '\r\n';
  return { ics, count, lastModified: lastModified || new Date().toISOString() };
}

/**
 * Analyse un chemin /ical/... et renvoie la selection, ou null si la forme est inconnue.
 * Les segments sont decodes (les noms de groupes FlOpEDT peuvent contenir des caracteres speciaux).
 */
function parsePath(pathname) {
  if (!pathname.startsWith('/ical/') || !pathname.endsWith('.ics')) return null;
  let segs;
  try { segs = pathname.slice(6, -4).split('/').map(decodeURIComponent); }
  catch (_) { return null; }
  // Un segment part dans les en-tetes iCal (X-WR-CALNAME) : les caracteres de
  // controle (dont \r\n) permettraient d'injecter des lignes dans le flux.
  if (segs.some(s => !s || s.length > 64 || /[\u0000-\u001f\u007f]/.test(s))) return null;

  const depts = store.CONFIG.depts;
  const findDept = s => depts.find(d => d.toLowerCase() === s.toLowerCase());

  if (segs[0] === 'prof' && segs.length === 3) {
    const dept = findDept(segs[1]);
    return dept ? { dept, tutor: segs[2] } : null;
  }
  if (segs.length === 2 || segs.length === 3) {
    const dept = findDept(segs[0]);
    return dept ? { dept, promo: segs[1], group: segs[2] } : null;
  }
  return null;
}

module.exports = { build, parsePath, isoWeekMonday, fmtLocal, fold, esc };
