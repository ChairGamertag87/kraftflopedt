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
 * Affiche l'état "indisponible" : FlOpEDT injoignable et aucun cache local.
 * Remplace l'ancien mode démo qui affichait un faux emploi du temps et un
 * message destiné au développeur (node server.js) aux étudiants.
 */
function showUnavailable() {
  _displayedCourses = [];
  document.getElementById('schedule-container').innerHTML = `
    <div class="state-box">
      <span class="state-icon">📡</span>
      Emploi du temps indisponible
      <div class="state-sub">// flopedt.iut-blagnac.fr ne répond pas et aucune copie locale n'existe</div>
      <button class="sel-chip state-retry" onclick="loadSchedule()">Réessayer</button>
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
 * Répartit les cours d'une journée qui se chevauchent en colonnes.
 * Deux cours au même créneau existent (CM de promo + TD de groupe pendant une
 * retouche d'EDT) : superposés, l'un des deux était invisible.
 * @returns {Array<{c:object, col:number, columns:number}>}
 */
function layoutLanes(dayCourses) {
  const sorted = dayCourses.slice().sort((a, b) => a.start - b.start || a.end - b.end);
  const lanes  = [];   // fin du dernier cours de chaque colonne
  const placed = sorted.map(c => {
    let col = lanes.findIndex(end => end <= c.start + 1e-9);
    if (col === -1) { lanes.push(c.end); col = lanes.length - 1; }
    else lanes[col] = c.end;
    return { c, col };
  });
  const columns = Math.max(1, lanes.length);
  return placed.map(p => ({ ...p, columns }));
}

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
  const isThisWeek =
    state.currentWeek === getISOWeek(today) &&
    state.currentYear === getISOWeekYear(today);

  let html = `<div class="schedule-wrap"><div class="schedule-grid">`;

  // ── En-tête : coin vide + 5 jours ──
  html += `<div class="time-header"></div>`;

  for (let d = 0; d < 5; d++) {
    const date    = new Date(weekDates.mon);
    date.setDate(weekDates.mon.getDate() + d);
    const isToday = isThisWeek && d === todayDow;

    html += `
      <div class="day-header${isToday ? ' today' : ''}" data-day="${d}">
        ${DAYS[d]}
        <span>${date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })}</span>
      </div>`;
  }

  // ── Colonne horaires ──
  html += `<div class="time-col">`;
  for (let s = 0; s < SLOTS; s++) {
    const isHalf = s % 2 !== 0;
    const label  = isHalf ? '' : formatClock((SLOT_MIN + s * 0.5) * 60);
    html += `<div class="time-slot${isHalf ? ' half' : ''}" style="height:${SLOT_H}px;"><span>${label}</span></div>`;
  }
  html += `</div>`;

  // ── Colonnes jours ──
  for (let d = 0; d < 5; d++) {
    html += `<div class="day-col" data-day="${d}" style="height:${totalH}px;">`;

    // Lignes de fond (heures & demi-heures)
    for (let s = 0; s < SLOTS; s++) {
      html += `<div class="grid-line${s % 2 === 0 ? ' hour' : ' half'}" style="top:${s * SLOT_H}px;height:${SLOT_H}px;"></div>`;
    }

    // Marqueur heure actuelle (aujourd'hui seulement)
    if (isThisWeek && d === todayDow) {
      const nowH = today.getHours() + today.getMinutes() / 60;
      if (nowH >= SLOT_MIN && nowH <= SLOT_MAX) {
        const pct = ((nowH - SLOT_MIN) / (SLOT_MAX - SLOT_MIN)) * 100;
        html += `<div class="now-line" style="top:${pct}%;"><div class="now-dot"></div></div>`;
      }
    }

    // Cours du jour, répartis en colonnes s'ils se chevauchent
    layoutLanes(courses.filter(c => c.day === d)).forEach(({ c, col, columns }) => {
      const idx = _displayedCourses.length;
      _displayedCourses.push(c);

      const durationH = c.end - c.start;
      const topPct    = ((c.start - SLOT_MIN) / (SLOT_MAX - SLOT_MIN)) * 100;
      // Hauteur minimum = 30 min en pourcentage pour rester lisible
      const minH      = (0.5 / (SLOT_MAX - SLOT_MIN)) * 100;
      const heightPct = Math.max((durationH / (SLOT_MAX - SLOT_MIN)) * 100, minH);
      const timeStr   = formatRange(c.start, c.end);

      let style = `top:${topPct}%;height:${heightPct}%;`;
      if (columns > 1) {
        // largeur utile = 100% moins les marges latérales (3px de chaque côté)
        style += `left:calc(3px + ${col} * (100% - 6px) / ${columns});width:calc((100% - 6px) / ${columns} - 3px);right:auto;`;
      }
      // Couleur du module FlOpEDT : exposée en variable, chaque thème en dérive fond et bordure
      // On n'accepte qu'une couleur hexa : la valeur part dans un attribut style
      if (c.color && /^#[0-9a-f]{3,8}$/i.test(c.color)) style += `--accent:${c.color};`;

      // Cours court (<1h10) : layout compact sur une ligne
      const isShort = durationH < 1.17;
      let innerHtml;
      if (isShort) {
        innerHtml = `
          <div class="course-compact">
            <span class="course-type-badge">${typeLabel(c.type)}</span>
            <span class="course-name">${escapeHtml(c.abbrev || c.name)}</span>
            <span class="course-meta">${timeStr}</span>
          </div>
          ${c.room !== '—' ? `<div class="course-meta course-room">📍 ${escapeHtml(c.room)}</div>` : ''}`;
      } else {
        innerHtml = `
          <div class="course-head">
            <span class="course-type-badge">${typeLabel(c.type)}</span>
            <span class="course-name">${escapeHtml(c.abbrev || c.name)}</span>
          </div>
          <div class="course-meta course-time">${timeStr}</div>
          ${c.room  !== '—' ? `<div class="course-meta course-room">📍 ${escapeHtml(c.room)}</div>`  : ''}
          ${c.tutor !== '—' ? `<div class="course-meta course-tutor">👤 ${escapeHtml(c.tutor)}</div>` : ''}`;
      }

      html += `
        <div class="course-card type-${c.type}${style.includes('--accent') ? ' has-accent' : ''}"
          style="${style}"
          onclick="showDetail(_displayedCourses[${idx}])">
          ${innerHtml}
        </div>`;
    });

    html += `</div>`;
  }

  html += `</div></div>`;
  document.getElementById('schedule-container').innerHTML = html;
}
