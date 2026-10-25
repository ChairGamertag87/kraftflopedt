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
  // L'année est toujours affichée : S1 ou une semaine d'une autre année n'en disaient rien
  const fmt_year = (d) => d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
  return { mon, fri, label: `S${week} — ${fmt(mon)} au ${fmt_year(fri)}` };
}

/** Date courte d'une colonne (jour + mois), avec l'année quand elle n'est pas celle du jour. */
function formatDayHeader(d, now = new Date()) {
  const opts = { day: '2-digit', month: 'short' };
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString('fr-FR', opts);
}

/**
 * Fenêtre servie par l'adapter (store.js, weekInWindow) : du 1er juillet qui
 * précède l'année universitaire en cours (bascule le 20 juillet) au 31 août
 * suivant. Toute autre semaine est refusée en 404.
 */
function isWeekInAcademicYear(week, year, now = new Date()) {
  const start_year = now > new Date(now.getFullYear(), 6, 20) ? now.getFullYear() : now.getFullYear() - 1;
  const mon = getWeekDates(week, year).mon.getTime();
  return mon >= new Date(start_year, 6, 1).getTime() && mon <= new Date(start_year + 1, 7, 31).getTime();
}

/**
 * Echappe une chaine avant insertion en innerHTML. Les donnees FlOpEDT
 * (noms de modules, salles, profs) et CROUS ne sont pas de confiance :
 * un simple "<" dans un nom cassait la carte, et un compte FlOpEDT
 * compromis aurait pu injecter du script.
 */
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, ch =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
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
 * Détecte la catégorie d'un cours depuis son champ "type" FlOpEDT, le nom et
 * l'abréviation du module.
 *
 * La nomenclature des types varie selon le département :
 *   - INFO : CM, TD, TP, DS, QCM, Projet, Conf, Conf 45, Conf 2h
 *   - CS   : CM, TD, TP
 *   - RT   : CM, CM60..CM240, CMHi5, TD60..TD240, TP60..TP240, Examen, Exam45, ExamTP120..240
 *   - GIM  : CM30..CM270, TD90..TD270, TP90..TP270, CTRL60/90 (contrôle), X30/X60/X90
 * On lit donc le préfixe (CM/TD/TP suivi d'une durée) au lieu d'exiger une égalité
 * stricte. Un type reconnu prime toujours sur le nom du module (un TD d'une SAE
 * reste un TD) ; en dernier recours une SAE au type inconnu (ex. GIM "X90",
 * "Autonomies des SAE") est classée projet plutôt qu'autre.
 *
 * @param {string} type    — ex: "TP", "TD240", "CM90", "Projet", "ExamTP240", "X90"
 * @param {string} name    — nom du module (fallback)
 * @param {string} abbrev  — abréviation du module (fallback, ex: "SAE11")
 * @returns {'cm'|'td'|'tp'|'projet'|'exam'|'other'}
 */
function detectType(type, name = '', abbrev = '') {
  const t = (type || '').toLowerCase().trim();
  const n = (name || '').toLowerCase();
  const a = (abbrev || '').toLowerCase();
  if (t.startsWith('projet'))                                            return 'projet';
  if (t === 'ds' || t === 'qcm' || t.includes('exam') || t.startsWith('ctrl')) return 'exam';
  const m = t.match(/^(cm|td|tp)(?![a-z])/) || t.match(/^(cm)hi/);
  if (m)                                                                 return m[1];
  // Type inconnu : on se rabat sur le module.
  if (n.includes('exam'))                                                return 'exam';
  if (/^sa[eé]/.test(a) || /\bsa[eé]s?\b/.test(n))                       return 'projet';
  return 'other';
}

/**
 * Retourne le libellé court d'un type de cours.
 */
function typeLabel(t) {
  return { cm: 'CM', td: 'TD', tp: 'TP', projet: 'Projet', exam: 'Examen', other: 'Autre' }[t] || 'Autre';
}
