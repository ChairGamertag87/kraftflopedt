/* ══════════════════════════════════════════════════
   UTILS.JS — Fonctions utilitaires pures
   ══════════════════════════════════════════════════ */

/**
 * Retourne le numéro de semaine ISO d'une date.
 */
function getISOWeek(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
}

/**
 * Retourne l'année ISO d'une date (celle à laquelle appartient sa semaine ISO).
 * Le 1er janvier 2027 est en S53 de 2026 : getFullYear() donnerait 2027 et
 * chargerait la mauvaise semaine.
 */
function getISOWeekYear(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  return date.getUTCFullYear();
}

/**
 * Nombre de semaines ISO d'une année : 52, ou 53 si le 28 décembre tombe en S53
 * (année commençant un jeudi, ou bissextile commençant un mercredi ; ex : 2026).
 */
function getISOWeeksInYear(year) {
  return getISOWeek(new Date(year, 11, 28));
}

/**
 * Retourne les dates de début/fin d'une semaine ISO.
 */
function getWeekDates(week, year) {
  const simple = new Date(year, 0, 1 + (week - 1) * 7);
  const dow = simple.getDay();
  const mon = new Date(simple);
  mon.setDate(simple.getDate() - (dow <= 4 ? dow - 1 : dow - 8));
  const fri = new Date(mon);
  fri.setDate(mon.getDate() + 4);
  const fmt = (d) => d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
  return { mon, fri, label: `S${week} — ${fmt(mon)} au ${fmt(fri)}` };
}

/**
 * Convertit un start_time FlOpEDT en nombre décimal d'heures.
 * L'API renvoie des minutes depuis minuit (ex: 480 = 8h00, 570 = 9h30).
 * Accepte aussi une string "HH:MM" pour rétrocompatibilité.
 * @param {number|string} t
 * @returns {number}  — ex: 8.5 pour 8h30
 */
function timeToFloat(t) {
  if (typeof t === 'number') return t / 60;
  if (typeof t === 'string' && t.includes(':')) {
    const [h, m] = t.split(':').map(Number);
    return h + m / 60;
  }
  return parseFloat(t) / 60;
}

/**
 * Minutes depuis minuit → « 8h05 ».
 */
function formatClock(min) {
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return `${h}h${String(m).padStart(2, '0')}`;
}

/**
 * Plage horaire à partir d'heures décimales (8.5 → 8h30) : « 8h00 → 9h25 ».
 */
function formatRange(startH, endH) {
  return formatClock(Math.round(startH * 60)) + ' → ' + formatClock(Math.round(endH * 60));
}

/**
 * Convertit un code de jour FlOpEDT en index 0-4 (0=Lundi).
 * L'API renvoie "m", "tu", "w", "th", "f".
 * @param {string|number} day
 * @returns {number}  — -1 si inconnu
 */
function getDayIndex(day) {
  // Format string FlOpEDT réel
  const strMap = { m: 0, tu: 1, w: 2, th: 3, f: 4 };
  if (typeof day === 'string' && strMap[day] !== undefined) return strMap[day];

  // Format numérique 1-5 (fallback)
  if (typeof day === 'number') return day - 1;

  // Noms complets (fallback)
  const nameMap = {
    lundi: 0, mardi: 1, mercredi: 2, jeudi: 3, vendredi: 4,
    monday: 0, tuesday: 1, wednesday: 2, thursday: 3, friday: 4,
  };
  return nameMap[(day + '').toLowerCase()] ?? -1;
}

/**
 * Détecte le type d'un cours depuis son champ "type" et son nom.
 * @param {string} type   — ex: "TP", "TD", "CM", "Projet"
 * @param {string} name   — nom du module (fallback)
 * @returns {'cm'|'td'|'tp'|'projet'|'exam'|'other'}
 */
function detectType(type, name = '') {
  const t = (type || '').toLowerCase();
  const n = (name || '').toLowerCase();
  if (t === 'cm')                                                     return 'cm';
  if (t === 'td')                                                     return 'td';
  if (t === 'tp')                                                     return 'tp';
  if (t === 'projet')                                                 return 'projet';
  if (t === 'ds' || t === 'qcm' || t.includes('exam') || n.includes('exam')) return 'exam';
  return 'other';
}

/**
 * Retourne le libellé court d'un type de cours.
 */
function typeLabel(t) {
  return { cm: 'CM', td: 'TD', tp: 'TP', projet: 'Projet', exam: 'Examen', other: 'Autre' }[t] || 'Autre';
}

/**
 * Normalise un cours brut venant de l'API FlOpEDT (format réel confirmé).
 * Structure réelle :
 * {
 *   room: { name: "B009" },
 *   start_time: 480,          ← minutes depuis minuit
 *   day: "m",                 ← "m","tu","w","th","f"
 *   course: {
 *     type: "TP",
 *     groups: [{ name: "3A", train_prog: "BUT1" }],
 *     module: { name: "DevObj", abbrev: "DevObj", display: { color_bg: "#af3014" } }
 *   },
 *   tutor: "NEK"              ← string directe
 * }
 */
function normaliseCourse(c) {
  const course   = c.course || {};
  const module   = course.module || {};
  const groups   = course.groups || [];

  const name     = module.name || module.abbrev || c.nom || c.name || '?';
  const abbrev   = module.abbrev || name;
  const start    = c.start_time ?? c.heure_debut ?? c.start ?? '480';
  const end      = c.end_time   ?? c.heure_fin   ?? c.end   ?? null;
  const day      = getDayIndex(c.day ?? c.jour ?? c.weekday ?? 'm');
  const room     = c.room?.name || c.room?.nom || c.salle?.nom || c.salle || c.room || '—';
  const tutor    = c.tutor || c.tuteur || '—';
  const group    = groups.map(g => g.name).join(', ') || '';
  const promo    = groups[0]?.train_prog || '';
  const type     = detectType(course.type, name);
  const color    = module.display?.color_bg || c.color || null;
  const colorTxt = module.display?.color_txt || null;

  // Durée : FlOpEDT ne renvoie pas end_time directement,
  // on déduit depuis number × durée standard (1 créneau = 95 min en général)
  // ou on pose 90 min par défaut
  const startFloat = timeToFloat(start);
  const endFloat   = end !== null ? timeToFloat(end) : startFloat + 1.5;

  return { name, abbrev, start: startFloat, end: endFloat, day, room, tutor, group, promo, type, color, colorTxt };
}
