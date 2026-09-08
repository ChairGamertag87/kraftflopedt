/* ══════════════════════════════════════════════════
   THEME.JS — Bascule carton / iOS et éléments propres au thème iOS
   (bande de 7 jours façon Calendrier, titre mois + semaine,
    bouton « Aujourd'hui », vue jour sur mobile).
   Le thème est posé sur <html data-theme="ios"> ; un script inline
   dans <head> le restaure avant le CSS pour éviter un flash.
   ══════════════════════════════════════════════════ */

const THEME_KEY   = 'edt-theme';
const DAYS_IOS    = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'];

// ════════════════════════════
//  Bascule
// ════════════════════════════

function currentTheme() {
  return isIosTheme() ? 'ios' : 'carton';
}

function setTheme(theme) {
  if (theme === 'ios') document.documentElement.setAttribute('data-theme', 'ios');
  else document.documentElement.removeAttribute('data-theme');
  try { localStorage.setItem(THEME_KEY, theme); } catch (_) { /* ignore */ }
  applyTheme();
}

function toggleTheme() {
  setTheme(isIosTheme() ? 'carton' : 'ios');
}

/**
 * Met l'interface en accord avec le thème actif : libellé du bouton,
 * titre iOS, bande de jours, et re-rendu de la grille (formats d'heure).
 */
function applyTheme() {
  const btn = document.getElementById('theme-btn');
  if (btn) {
    btn.textContent = isIosTheme() ? '📦 Style carton' : '📱 Style iOS';
    btn.setAttribute('aria-pressed', String(isIosTheme()));
  }
  updateIosTitle();
  updateTodayButton();

  if (typeof _displayedCourses !== 'undefined' && _displayedCourses.length > 0) {
    buildGrid(_displayedCourses.slice());   // buildGrid rappelle renderWeekStrip
  } else {
    renderWeekStrip();
  }
}

// ════════════════════════════
//  Jour sélectionné (vue jour sur mobile en thème iOS)
// ════════════════════════════

/** 0 = lundi … 6 = dimanche. Par défaut : aujourd'hui si semaine courante, sinon lundi. */
function getFocusDay() {
  if (state.focusDay === null || state.focusDay === undefined) {
    const now = new Date();
    const thisWeek = state.currentWeek === getISOWeek(now) && state.currentYear === getISOWeekYear(now);
    state.focusDay = thisWeek ? (now.getDay() + 6) % 7 : 0;
  }
  return state.focusDay;
}

function setFocusDay(d) {
  state.focusDay = d;
  const wrap = document.querySelector('.schedule-wrap');
  if (wrap) wrap.className = `schedule-wrap focus-${d}`;
  renderWeekStrip();
  updateIosTitle();
}

// ════════════════════════════
//  Bande de 7 jours
// ════════════════════════════

function renderWeekStrip() {
  const strip = document.getElementById('week-strip');
  if (!strip) return;

  const weekDates = getWeekDates(state.currentWeek, state.currentYear);
  const today     = new Date();
  const focus     = getFocusDay();
  const busy      = new Set((typeof _displayedCourses !== 'undefined' ? _displayedCourses : []).map(c => c.day));

  strip.innerHTML = '';
  for (let d = 0; d < 7; d++) {
    const date = new Date(weekDates.mon);
    date.setDate(weekDates.mon.getDate() + d);
    const isToday = date.toDateString() === today.toDateString();

    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'strip-day'
      + (d === focus ? ' selected' : '')
      + (isToday ? ' today' : '')
      + (d >= 5 ? ' weekend' : '');
    cell.setAttribute('aria-label', date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }));
    cell.innerHTML = `
      <span class="strip-label">${DAYS_IOS[d]}</span>
      <span class="strip-num">${date.getDate()}</span>
      <span class="strip-dot${busy.has(d) ? ' on' : ''}"></span>`;
    cell.onclick = () => setFocusDay(d);
    strip.appendChild(cell);
  }
}

// ════════════════════════════
//  Titre « Septembre · Semaine 37 » et bouton Aujourd'hui
// ════════════════════════════

function updateIosTitle() {
  const titleEl = document.getElementById('ios-title');
  const subEl   = document.getElementById('ios-subtitle');
  if (!titleEl || !subEl) return;

  const weekDates = getWeekDates(state.currentWeek, state.currentYear);
  const date = new Date(weekDates.mon);
  date.setDate(weekDates.mon.getDate() + getFocusDay());

  // Le mois ; l'année seulement hors année en cours (comme l'app)
  const opts  = date.getFullYear() === new Date().getFullYear() ? { month: 'long' } : { month: 'long', year: 'numeric' };
  const month = date.toLocaleDateString('fr-FR', opts);
  titleEl.textContent = month.charAt(0).toUpperCase() + month.slice(1);
  subEl.textContent   = `Semaine ${state.currentWeek}`;
}

function isOnCurrentWeek() {
  const now = new Date();
  return state.currentWeek === getISOWeek(now) && state.currentYear === getISOWeekYear(now);
}

function updateTodayButton() {
  const btn = document.getElementById('today-btn');
  if (btn) btn.hidden = isOnCurrentWeek();
}

/** Revient à la semaine courante et au jour d'aujourd'hui. */
function goToday() {
  const now = new Date();
  state.currentWeek = getISOWeek(now);
  state.currentYear = getISOWeekYear(now);
  state.focusDay    = (now.getDay() + 6) % 7;
  updateWeekLabel();
  if (getSelectedGroup()) loadSchedule();
}
