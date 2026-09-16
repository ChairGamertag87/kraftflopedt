/* ══════════════════════════════════════════════════
   TUTORS.JS — "Où est le prof ?" : salles d'un enseignant
   sur la semaine affichée, tous départements confondus.
   S'appuie sur ensureWeekCourses() de rooms.js (cache partagé).
   ══════════════════════════════════════════════════ */

const TUTOR_KEY = 'edt-tutor';   // dernier prof consulté (localStorage)

let _tutorSelected = null;       // nom du prof affiché
let _tutorFilter   = '';         // texte tapé dans la recherche

// ════════════════════════════
//  Modal
// ════════════════════════════

function openTutors() {
  document.getElementById('tutors-overlay').classList.add('open');
  document.body.style.overflow = 'hidden';

  if (_tutorSelected === null) {
    try { _tutorSelected = localStorage.getItem(TUTOR_KEY) || null; } catch (_) { /* ignore */ }
  }

  refreshTutors();
  const input = document.getElementById('tutors-search');
  if (input && !_tutorSelected) setTimeout(() => input.focus(), 50);
}

function closeTutors() {
  document.getElementById('tutors-overlay').classList.remove('open');
  document.body.style.overflow = '';
}

function closeTutorsOutside(e) {
  if (e.target === document.getElementById('tutors-overlay')) closeTutors();
}

// ════════════════════════════
//  Chargement + liste des profs
// ════════════════════════════

async function refreshTutors() {
  const listDiv   = document.getElementById('tutors-list');
  const resultDiv = document.getElementById('tutors-result');

  listDiv.innerHTML = '';
  resultDiv.innerHTML = '<div class="rooms-hint"><span class="state-icon spin" style="font-size:1.2rem;">⟳</span> Chargement…</div>';

  let courses;
  try {
    courses = await ensureWeekCourses();
  } catch (e) {
    resultDiv.innerHTML = `<div class="rooms-hint">Erreur : ${escapeHtml(e.message)}</div>`;
    return;
  }

  renderTutorList(courses);

  if (_tutorSelected) {
    renderTutorSchedule(_tutorSelected, courses);
  } else {
    resultDiv.innerHTML = '<div class="rooms-hint">Choisis un prof pour voir ses salles de la semaine</div>';
  }
}

/** Liste des profs distincts ayant au moins un cours cette semaine. */
function listTutors(courses) {
  const names = new Set();
  courses.forEach(c => { if (c.tutor) names.add(c.tutor); });
  return [...names].sort((a, b) => a.localeCompare(b, 'fr'));
}

function renderTutorList(courses) {
  const listDiv = document.getElementById('tutors-list');
  const filter  = _tutorFilter.trim().toLowerCase();
  const tutors  = listTutors(courses).filter(t => !filter || t.toLowerCase().includes(filter));

  listDiv.innerHTML = '';
  if (tutors.length === 0) {
    listDiv.innerHTML = '<div class="rooms-hint" style="padding:6px 0;">Aucun prof ne correspond cette semaine</div>';
    return;
  }

  tutors.forEach(name => {
    const btn = document.createElement('button');
    btn.className     = 'sel-chip' + (name === _tutorSelected ? ' active' : '');
    btn.dataset.value = name;
    btn.textContent   = name;
    btn.onclick       = () => selectTutor(name);
    listDiv.appendChild(btn);
  });
}

function filterTutorList(text) {
  _tutorFilter = text || '';
  if (_allCourses) renderTutorList(_allCourses);
}

async function selectTutor(name) {
  _tutorSelected = name;
  try { localStorage.setItem(TUTOR_KEY, name); } catch (_) { /* ignore */ }

  document.querySelectorAll('#tutors-list .sel-chip').forEach(b =>
    b.classList.toggle('active', b.dataset.value === name));

  const courses = await ensureWeekCourses();
  renderTutorSchedule(name, courses);
}

// ════════════════════════════
//  Affichage du planning d'un prof
// ════════════════════════════

function minToLabel(min) { return formatClock(min); }

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

/**
 * Cours d'un prof, triés par jour puis heure, et cours en cours "maintenant"
 * si la semaine affichée est la semaine courante.
 * @returns {{ slots: Array, current: object|null, isThisWeek: boolean, todayDow: number }}
 */
function tutorWeek(name, courses, now = new Date()) {
  const slots = courses
    .filter(c => c.tutor === name)
    .sort((a, b) => a.day - b.day || a.start - b.start);

  const isThisWeek = state.currentWeek === getISOWeek(now) && state.currentYear === getISOWeekYear(now);
  const todayDow   = now.getDay() - 1;   // 0 = lundi, -1 = dimanche
  const nowMin     = now.getHours() * 60 + now.getMinutes();

  let current = null;
  if (isThisWeek) {
    current = slots.find(c => c.day === todayDow && nowMin >= c.start && nowMin < c.end) || null;
  }
  return { slots, current, isThisWeek, todayDow, nowMin };
}

function renderTutorSchedule(name, courses) {
  const resultDiv = document.getElementById('tutors-result');
  const { slots, current, isThisWeek, todayDow, nowMin } = tutorWeek(name, courses);

  if (slots.length === 0) {
    resultDiv.innerHTML = `<div class="rooms-hint">${escapeHtml(name)} n'a aucun cours cette semaine</div>`;
    return;
  }

  let html = '';

  // Bandeau "en ce moment" (uniquement sur la semaine courante, un jour de cours)
  if (isThisWeek && todayDow >= 0 && todayDow <= 4) {
    if (current) {
      html += `<div class="tutors-now">📍 En ce moment : <b>${escapeHtml(current.room || 'salle inconnue')}</b>
        jusqu'à ${minToLabel(current.end)} (${escapeHtml(current.module)}${current.groups ? ' · ' + escapeHtml(current.groups) : ''})</div>`;
    } else {
      const next = slots.find(c => c.day === todayDow && c.start > nowMin);
      html += next
        ? `<div class="tutors-now off">Pas en cours actuellement · prochain à ${minToLabel(next.start)} en <b>${escapeHtml(next.room || '?')}</b></div>`
        : `<div class="tutors-now off">Pas en cours actuellement · plus de cours aujourd'hui</div>`;
    }
  }

  const weekDates = getWeekDates(state.currentWeek, state.currentYear);
  const count = slots.length;
  html += `<div class="rooms-count">${count} cours cette semaine
    · <a href="#" class="tutors-ical" onclick="openIcalTutor(${JSON.stringify(name).replace(/"/g, '&quot;')}); return false;">📅 S'abonner à son agenda</a></div>`;

  for (let d = 0; d < 5; d++) {
    const daySlots = slots.filter(c => c.day === d);
    if (daySlots.length === 0) continue;

    const date = new Date(weekDates.mon);
    date.setDate(weekDates.mon.getDate() + d);
    const isToday = isThisWeek && d === todayDow;

    html += `<div class="tutors-day${isToday ? ' today' : ''}">
      <div class="rooms-building-name">${DAYS[d]} <span style="font-family:Inconsolata,monospace;font-size:0.78rem;font-weight:400;">${date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })}</span></div>`;

    daySlots.forEach(c => {
      const isCurrent = current === c;
      html += `<div class="tutor-slot${isCurrent ? ' current' : ''}">
        <span>${minToLabel(c.start)} → ${minToLabel(c.end)}</span>
        <span class="tutor-room">📍 ${escapeHtml(c.room || '—')}</span>
        <span class="tutor-info"><b>${escapeHtml(c.module)}</b>${c.type ? ' · ' + escapeHtml(c.type) : ''}${c.groups ? ' · ' + escapeHtml(c.groups) : ''} · ${escapeHtml(c.dept)}</span>
      </div>`;
    });

    html += `</div>`;
  }

  resultDiv.innerHTML = html;
}
