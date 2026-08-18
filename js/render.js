/* ══════════════════════════════════════════════════
   RENDER.JS — Construction et affichage de la grille
   ══════════════════════════════════════════════════ */

// Registre des cours affichés (pour onclick sans JSON inline)
let _displayedCourses = [];

// ════════════════════════════
//  États UI
// ════════════════════════════

/** Affiche l'état "chargement en cours". */
function showLoading() {
  document.getElementById('schedule-container').innerHTML = `
    <div class="state-box">
      <span class="state-icon spin">⟳</span>
      Chargement de l'emploi du temps…
      <div class="state-sub">// contact de flopedt.iut-blagnac.fr</div>
    </div>`;
}

/**
 * Affiche un message d'erreur dans la bannière.
 * @param {string} msg
 */
function showError(msg) {
  const err = document.getElementById('error-banner');
  err.textContent = msg;
  err.classList.add('show');
}

// ════════════════════════════
//  Entrée principale
// ════════════════════════════

/**
 * Normalise les données brutes de l'API puis délègue à buildGrid.
 * @param {object|Array} rawData     — réponse brute de l'API
 * @param {string}       dept
 * @param {string}       promo
 * @param {string}       groupFilter — filtre groupe optionnel
 */
function renderSchedule(rawData, dept, promo, groupFilter) {
  // Normalisation du format de réponse (plusieurs formes possibles)
  let courses = [];
  if (Array.isArray(rawData))                         courses = rawData;
  else if (rawData && Array.isArray(rawData.results)) courses = rawData.results;
  else if (rawData && Array.isArray(rawData.cours))   courses = rawData.cours;

  if (!courses.length) {
    document.getElementById('schedule-container').innerHTML = `
      <div class="state-box">
        <span class="state-icon">📭</span>
        Aucun cours cette semaine
        <div class="state-sub">// semaine libre ou données indisponibles</div>
      </div>`;
    return;
  }

  // Normalise chaque cours et filtre les jours inconnus
  const parsed = courses.map(c => normaliseCourse(c)).filter(c => c.day >= 0);

  // Filtre groupe côté client si nécessaire
  const filtered = groupFilter
    ? parsed.filter(c => !c.group || c.group.toLowerCase().includes(groupFilter.toLowerCase()))
    : parsed;

  buildGrid(filtered);
}

// ════════════════════════════
//  Construction de la grille
// ════════════════════════════

/**
 * Construit et injecte la grille HTML de l'emploi du temps.
 * @param {Array} courses  — cours normalisés
 */
function buildGrid(courses) {
  _displayedCourses = [];
  const today     = new Date();
  const todayDow  = today.getDay() - 1; // 0 = Lundi
  const weekDates = getWeekDates(state.currentWeek, state.currentYear);
  const totalH    = (SLOT_MAX - SLOT_MIN) * SLOT_H * 2; // hauteur totale en px

  let html = `<div class="schedule-wrap"><div class="schedule-grid">`;

  // ── En-tête : coin vide + 5 jours ──
  html += `<div class="time-header" style="height:48px;"></div>`;

  for (let d = 0; d < 5; d++) {
    const date    = new Date(weekDates.mon);
    date.setDate(weekDates.mon.getDate() + d);
    const isToday =
      state.currentWeek === getISOWeek(today) &&
      state.currentYear === today.getFullYear() &&
      d === todayDow;

    html += `
      <div class="day-header${isToday ? ' today' : ''}">
        ${DAYS[d]}
        <span>${date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })}</span>
      </div>`;
  }

  // ── Colonne horaires ──
  html += `<div style="display:flex;flex-direction:column;">`;
  for (let s = 0; s < SLOTS; s++) {
    const h      = Math.floor(SLOT_MIN + s * 0.5);
    const m      = s % 2 === 0 ? '00' : '30';
    const isHalf = s % 2 !== 0;
    html += `
      <div class="time-slot${isHalf ? ' half' : ''}" style="height:${SLOT_H}px;">
        ${m === '00' ? h + 'h' : ''}
      </div>`;
  }
  html += `</div>`;

  // ── Colonnes jours ──
  for (let d = 0; d < 5; d++) {
    html += `<div class="day-col" style="position:relative;height:${totalH}px;">`;

    // Lignes de fond (heures & demi-heures)
    for (let s = 0; s < SLOTS; s++) {
      const isHour = s % 2 === 0;
      html += `
        <div style="
          position:absolute; top:${s * SLOT_H}px; left:0; right:0; height:${SLOT_H}px;
          border-bottom:1px solid rgba(139,105,20,${isHour ? 0.18 : 0.07});
        "></div>`;
    }

    // Marqueur heure actuelle (aujourd'hui seulement)
    const now = new Date();
    const isCurrentDay =
      state.currentWeek === getISOWeek(today) &&
      state.currentYear === today.getFullYear() &&
      d === todayDow;

    if (isCurrentDay) {
      const nowH = now.getHours() + now.getMinutes() / 60;
      if (nowH >= SLOT_MIN && nowH <= SLOT_MAX) {
        const pct = ((nowH - SLOT_MIN) / (SLOT_MAX - SLOT_MIN)) * 100;
        html += `
          <div style="
            position:absolute; left:0; right:0; top:${pct}%; height:2px;
            background:var(--red-stamp); opacity:0.7; z-index:15; pointer-events:none;
          ">
            <div style="
              position:absolute; left:-4px; top:-4px; width:8px; height:8px;
              border-radius:50%; background:var(--red-stamp);
            "></div>
          </div>`;
      }
    }

    // Cours du jour
    const dayCourses = courses.filter(c => c.day === d);
    dayCourses.forEach(c => {
      const idx = _displayedCourses.length;
      _displayedCourses.push(c);

      const durationH = c.end - c.start;
      const topPct    = ((c.start - SLOT_MIN) / (SLOT_MAX - SLOT_MIN)) * 100;
      // Hauteur minimum = 30 min en pourcentage pour rester lisible
      const minH      = (0.5 / (SLOT_MAX - SLOT_MIN)) * 100;
      const heightPct = Math.max(((durationH) / (SLOT_MAX - SLOT_MIN)) * 100, minH);

      const h  = Math.floor(c.start), m  = Math.round((c.start % 1) * 60);
      const h2 = Math.floor(c.end),   m2 = Math.round((c.end   % 1) * 60);
      const timeStr = `${h}h${m.toString().padStart(2, '0')} → ${h2}h${m2.toString().padStart(2, '0')}`;

      const customStyle = c.color
        ? `background:${c.color}55; border-left-color:${c.color};`
        : '';

      // Cours court (<1h10) : layout compact sur une ligne
      const isShort = durationH < 1.17;
      let innerHtml;
      if (isShort) {
        innerHtml = `
          <div class="course-compact">
            <span class="course-type-badge">${typeLabel(c.type)}</span>
            <span class="course-name">${c.abbrev || c.name}</span>
            <span class="course-meta">${timeStr}</span>
          </div>
          ${c.room !== '—' ? `<div class="course-meta">📍 ${c.room}</div>` : ''}`;
      } else {
        innerHtml = `
          <div class="course-type-badge">${typeLabel(c.type)}</div>
          <div class="course-name">${c.abbrev || c.name}</div>
          <div class="course-meta">${timeStr}</div>
          ${c.room  !== '—' ? `<div class="course-meta">📍 ${c.room}</div>`  : ''}
          ${c.tutor !== '—' ? `<div class="course-meta">👤 ${c.tutor}</div>` : ''}`;
      }

      html += `
        <div class="course-card type-${c.type}"
          style="top:${topPct}%;height:${heightPct}%;${customStyle}"
          onclick="showDetail(_displayedCourses[${idx}])">
          ${innerHtml}
        </div>`;
    });

    html += `</div>`;
  }

  html += `</div></div>`;
  document.getElementById('schedule-container').innerHTML = html;
}

// ════════════════════════════
//  Mode démo (fallback CORS)
// ════════════════════════════

/**
 * Affiche un emploi du temps fictif quand l'API est inaccessible.
 * @param {string} dept
 * @param {string} promo
 * @param {string} group
 */
function showDemoFallback(dept, promo, group) {
  const demoRaw = [
    { name: 'Algo & Struct. données', start: '08:00', end: '10:00', day: 1, room: 'A101',      tutor: 'M. Martin',   group: 'G1', type: 'cm'   },
    { name: 'TP Programmation',       start: '10:15', end: '12:15', day: 1, room: 'Salle TP3', tutor: 'Mme. Dupont', group: 'G2', type: 'tp'   },
    { name: 'Bases de données',       start: '13:30', end: '15:30', day: 2, room: 'B204',      tutor: 'M. Lefevre',  group: 'G1', type: 'td'   },
    { name: 'Réseaux TD',             start: '08:00', end: '09:30', day: 3, room: 'C310',      tutor: 'M. Bernard',  group: 'G3', type: 'td'   },
    { name: 'Mathématiques',          start: '09:45', end: '11:45', day: 3, room: 'Amphi A',   tutor: 'Mme. Petit',  group: '',   type: 'cm'   },
    { name: 'DS Algo',                start: '14:00', end: '16:00', day: 4, room: 'Amphi B',   tutor: 'M. Martin',   group: '',   type: 'exam' },
    { name: 'Dev Web',                start: '08:00', end: '10:00', day: 5, room: 'Salle TP1', tutor: 'Mme. Durand', group: 'G1', type: 'tp'   },
    { name: 'Anglais',                start: '10:15', end: '12:15', day: 5, room: 'D105',      tutor: 'M. Smith',    group: 'G2', type: 'td'   },
  ];

  const demo = demoRaw.map(c => ({
    ...c,
    start: timeToFloat(c.start),
    end:   timeToFloat(c.end),
    day:   c.day - 1,
    color: null,
  }));

  const filtered = group ? demo.filter(c => !c.group || c.group === group) : demo;
  buildGrid(filtered);

  // Notice mode démo
  const notice = document.createElement('div');
  notice.style.cssText =
    'font-family:Inconsolata,monospace;font-size:0.75rem;color:var(--ink-faded);' +
    'text-align:center;margin-top:12px;opacity:0.7;';
  notice.textContent =
    '// Mode démo — données fictives (API inaccessible depuis ce navigateur, CORS)';
  document.getElementById('schedule-container').appendChild(notice);
}
