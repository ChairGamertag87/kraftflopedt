/* ══════════════════════════════════════════════════
   API.JS — Appels réseau vers FlOpEDT via le proxy /api/flopedt/
   Endpoints :
     - /fr/api/fetch/scheduledcourses/ ← cours
     - /fr/api/fetch/constraints/       ← durées par type
     - /fr/api/groups/structural/tree/ ← hiérarchie des groupes
   ══════════════════════════════════════════════════ */

/**
 * Fetch JSON via le proxy restreint /api/flopedt/ (GET uniquement, 4 endpoints).
 * En prod il est servi par le nginx du conteneur web (docker/nginx.conf),
 * en dev par server.js : même chemin dans les deux cas.
 */
async function apiFetch(endpoint, params) {
  const url = `/api/flopedt${endpoint}?${params}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} sur ${endpoint}`);
  return res.json();
}

// ════════════════════════════
//  Hiérarchie des groupes
// ════════════════════════════

/**
 * Parcourt récursivement l'arbre de groupes pour construire
 * une map "groupe → liste de ses ancêtres".
 *
 * Exemple pour INFO BUT1 :
 *   CE  → []
 *   1   → ["CE"]
 *   1A  → ["1", "CE"]
 *   1B  → ["1", "CE"]
 *
 * @param {Array}  nodes    — nœuds de l'arbre
 * @param {Array}  ancestors — ancêtres accumulés (chemin depuis la racine)
 * @param {Object} map      — résultat accumulé
 */
function buildAncestorMap(nodes, ancestors, map) {
  for (const node of nodes) {
    map[node.name] = [...ancestors];
    if (node.children && node.children.length > 0) {
      buildAncestorMap(node.children, [...ancestors, node.name], map);
    }
  }
}

/**
 * Charge l'arbre des groupes et construit la map ancêtres.
 * @param {string} dept
 * @returns {Promise<Object>}  — { "1A": ["1","CE"], "CE": [], ... }
 */
async function fetchAncestorMap(dept) {
  try {
    const tree = await apiFetch('/fr/api/groups/structural/tree/', `dept=${encodeURIComponent(dept)}`);
    const map  = {};
    // L'arbre est un tableau de racines (une par promo : BUT1, BUT2, BUT3)
    for (const root of tree) {
      map[root.name] = [];
      if (root.children) buildAncestorMap(root.children, [root.name], map);
    }
    return map;
  } catch (e) {
    console.warn('[EDT] Impossible de charger l\'arbre des groupes :', e.message);
    return {};
  }
}

/**
 * Retourne true si le groupe du cours est visible pour le groupe sélectionné.
 * Un cours est visible si son groupe est :
 *   - le groupe sélectionné lui-même  ("1A" → "1A" ✓)
 *   - un ancêtre du groupe sélectionné ("1A" → "1" ✓, "CE" ✓)
 *
 * @param {string} courseGroup    — groupe du cours (ex: "CE", "1", "1A")
 * @param {string} selectedGroup  — groupe filtré par l'utilisateur (ex: "1A")
 * @param {Object} ancestorMap    — map groupe → ancêtres
 */
function isGroupVisible(courseGroup, selectedGroup, ancestorMap) {
  if (!selectedGroup) return true;        // aucun filtre = tout afficher
  if (!courseGroup)   return true;        // cours sans groupe = tous les étudiants

  // Correspondance directe
  if (courseGroup === selectedGroup) return true;

  // Le groupe du cours est-il un ancêtre du groupe sélectionné ?
  const ancestors = ancestorMap[selectedGroup] || [];
  return ancestors.includes(courseGroup);
}

// ════════════════════════════
//  Durées des créneaux
// ════════════════════════════

/**
 * Charge les durées par type de cours depuis /fr/api/fetch/constraints/.
 * Retourne une map type → durée en minutes.
 */
async function fetchDurations(dept) {
  try {
    const data = await apiFetch('/fr/api/fetch/constraints/', `dept=${encodeURIComponent(dept)}`);
    const map  = {};
    for (const [type, val] of Object.entries(data)) {
      map[type] = val.duration;
    }
    return map;
  } catch (e) {
    console.warn('[EDT] Durées indisponibles, 85 min par défaut :', e.message);
    return {};
  }
}

function getDuration(courseType, durations) {
  return durations[courseType] ?? 85;
}

// ════════════════════════════
//  Chargement principal
// ════════════════════════════

/**
 * Charge cours + durées + arbre des groupes en parallèle,
 * puis normalise et filtre les cours.
 */
async function fetchSchedule(dept, promo, group) {
  const params = `dept=${encodeURIComponent(dept)}&week=${state.currentWeek}&year=${state.currentYear}&work_copy=0`;

  const [raw, durations, ancestorMap] = await Promise.all([
    apiFetch('/fr/api/fetch/scheduledcourses/', params),
    fetchDurations(dept),
    fetchAncestorMap(dept),
  ]);

  const list = Array.isArray(raw) ? raw : (raw.results || []);

  return list
    .map(c => {
      const course   = c.course  || {};
      const module   = course.module || {};
      const groups   = course.groups || [];

      const name     = module.name   || module.abbrev || '?';
      const abbrev   = module.abbrev || name;
      const startMin = c.start_time ?? 480;
      const duration = getDuration(course.type, durations);
      const endMin   = startMin + duration;
      const day      = getDayIndex(c.day);
      const room     = c.room?.name || '—';
      const tutor    = c.tutor      || '—';
      const grpNames = groups.map(g => g.name);   // tableau de noms ex: ["1A"]
      const grpStr   = grpNames.join(', ');        // ex: "1A" ou "CE"
      const cPromo   = groups[0]?.train_prog || '';
      const type     = detectType(course.type, name);
      const colorBg  = module.display?.color_bg  || null;
      const colorTxt = module.display?.color_txt || null;

      return {
        name, abbrev,
        start:    startMin / 60,
        end:      endMin   / 60,
        day, room, tutor,
        group:    grpStr,
        groupArr: grpNames,   // tableau brut pour le filtre ancêtres
        promo:    cPromo, type,
        color:    colorBg,
        colorTxt,
        courseType: course.type || '',
      };
    })
    .filter(c => {
      if (c.day < 0) return false;
      // Filtre par promo : ne garder que les cours de la promo sélectionnée
      if (promo && c.promo && c.promo !== promo) return false;
      // Un cours est visible si AU MOINS UN de ses groupes est visible
      if (group) {
        const visible = c.groupArr.some(g => isGroupVisible(g, group, ancestorMap));
        if (!visible) return false;
      }
      return true;
    });
}

// ════════════════════════════
//  Cache localStorage
// ════════════════════════════

const CACHE_PREFIX = 'edt-cache-';
const CACHE_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 jours

function cacheKey(dept, promo, group, week, year) {
  return `${CACHE_PREFIX}${dept}-${promo}-${group}-S${week}-${year}`;
}

function cacheSave(dept, promo, group, week, year, courses) {
  const key = cacheKey(dept, promo, group, week, year);
  try {
    localStorage.setItem(key, JSON.stringify({ ts: Date.now(), courses }));
    cacheCleanup();
  } catch (_) { /* quota dépassé — on ignore */ }
}

function cacheLoad(dept, promo, group, week, year) {
  const key = cacheKey(dept, promo, group, week, year);
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (Date.now() - data.ts > CACHE_MAX_AGE) {
      localStorage.removeItem(key);
      return null;
    }
    return data;
  } catch (_) { return null; }
}

/** Supprime les entrées de cache expirées (> 7 jours). */
function cacheCleanup() {
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith(CACHE_PREFIX)) continue;
    try {
      const d = JSON.parse(localStorage.getItem(k));
      if (Date.now() - d.ts > CACHE_MAX_AGE) localStorage.removeItem(k);
    } catch (_) { localStorage.removeItem(k); }
  }
}

// ════════════════════════════
//  Point d'entrée principal
// ════════════════════════════

// Numero de sequence du dernier chargement demande. Trois clics rapides sur la
// fleche lancaient trois fetch et la reponse la plus lente ecrasait la grille,
// quelle que soit la semaine affichee dans l'en-tete.
let _loadSeq = 0;

async function loadSchedule() {
  const seq   = ++_loadSeq;
  const dept  = getSelectedDept();
  const promo = getSelectedPromo();
  const group = getSelectedGroup();
  const week  = state.currentWeek;
  const year  = state.currentYear;
  const err   = document.getElementById('error-banner');

  err.classList.remove('show');

  // Cache first: show cached data immediately if available
  const cached = cacheLoad(dept, promo, group, week, year);
  if (cached && cached.courses && cached.courses.length > 0) {
    buildGrid(cached.courses);
  } else {
    showLoading();
  }

  try {
    const courses = await fetchSchedule(dept, promo, group);

    // Le cache est toujours ecrit sous la bonne cle ; seul l'affichage est
    // reserve au dernier chargement demande.
    cacheSave(dept, promo, group, week, year, courses);
    if (seq !== _loadSeq) return;

    if (courses.length === 0) {
      _displayedCourses = [];
      document.getElementById('schedule-container').innerHTML = `
        <div class="state-box">
          <span class="state-icon">📭</span>
          Aucun cours cette semaine
          <div class="state-sub">// semaine libre ou groupe sans cours</div>
        </div>`;
    } else {
      buildGrid(courses);
    }
  } catch (e) {
    console.error('[EDT]', e);
    if (seq !== _loadSeq) return;

    if (cached && cached.courses && cached.courses.length > 0) {
      const age = Date.now() - cached.ts;
      const agoText = age < 3600000
        ? `${Math.round(age / 60000)} min`
        : age < 86400000
          ? `${Math.round(age / 3600000)}h`
          : `${Math.round(age / 86400000)}j`;

      showError(`Hors-ligne — données du cache (${agoText})`);
    } else {
      showError(`Impossible de charger l'emploi du temps (${e.message})`);
      showUnavailable();
    }
  }
}
