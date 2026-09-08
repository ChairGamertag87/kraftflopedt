/* ══════════════════════════════════════════════════
   UI.JS — Interactions interface
   ══════════════════════════════════════════════════ */

// ════════════════════════════
//  Helpers : lecture valeur active
// ════════════════════════════

function getActiveValue(containerId) {
  const btn = document.querySelector(`#${containerId} .sel-chip.active`);
  return btn ? btn.dataset.value : '';
}

function getSelectedDept()  { return getActiveValue('dept-btns'); }
function getSelectedPromo() { return getActiveValue('promo-btns'); }
function getSelectedGroup() { return getActiveValue('group-btns'); }

/** Met à jour le libellé affiché dans le bouton sélecteur. */
function updateSelectorLabel() {
  const dept  = getSelectedDept();
  const promo = getSelectedPromo();
  const group = getSelectedGroup();
  const parts = [dept, promo, group].filter(Boolean);
  document.getElementById('selector-label').textContent = parts.join(' · ') || '—';
}

// ════════════════════════════
//  Sélection mémorisée (URL + localStorage)
// ════════════════════════════

const SELECTION_KEY = 'edt-selection';

/**
 * Lit la sélection à restaurer : l'URL (?dept=INFO&promo=BUT2&group=2A)
 * a priorité sur localStorage, pour que les liens partagés fonctionnent.
 * @returns {{dept:string, promo:string, group:string}|null}
 */
function readSavedSelection() {
  const params = new URLSearchParams(location.search);
  if (params.get('dept')) {
    return {
      dept:  params.get('dept'),
      promo: params.get('promo') || '',
      group: params.get('group') || '',
    };
  }
  try {
    const raw = localStorage.getItem(SELECTION_KEY);
    if (raw) {
      const sel = JSON.parse(raw);
      if (sel && sel.dept) return sel;
    }
  } catch (_) { /* localStorage indisponible ou corrompu */ }
  return null;
}

/** Sauvegarde la sélection courante (localStorage + URL sans rechargement). */
function saveSelection() {
  const sel = { dept: getSelectedDept(), promo: getSelectedPromo(), group: getSelectedGroup() };
  try { localStorage.setItem(SELECTION_KEY, JSON.stringify(sel)); } catch (_) { /* quota ou mode privé */ }

  const params = new URLSearchParams();
  if (sel.dept)  params.set('dept',  sel.dept);
  if (sel.promo) params.set('promo', sel.promo);
  if (sel.group) params.set('group', sel.group);
  const qs = params.toString();
  try {
    history.replaceState(null, '', qs ? `${location.pathname}?${qs}` : location.pathname);
  } catch (_) { /* history indisponible */ }
}

/**
 * Active le chip dont data-value vaut `value` dans un conteneur.
 * @returns {HTMLElement|null} le chip activé, ou null s'il n'existe pas
 */
function activateChip(containerId, value) {
  let found = null;
  document.querySelectorAll(`#${containerId} .sel-chip`).forEach(b => {
    const match = value !== '' && b.dataset.value === value;
    b.classList.toggle('active', match);
    if (match) found = b;
  });
  return found;
}

/**
 * Prépare la restauration : active le chip département et mémorise
 * promo/groupe dans state.wanted. Les chips promo/groupe sont créés plus
 * tard (fallback puis API) : buildPromoChips / filterGroupsByPromo les
 * appliquent dès qu'ils existent.
 */
function restoreSelection() {
  const saved = readSavedSelection();
  if (!saved) return;
  if (!activateChip('dept-btns', saved.dept)) {
    // Département inconnu : on garde le défaut (premier chip)
    const first = document.querySelector('#dept-btns .sel-chip');
    if (first) first.classList.add('active');
    return;
  }
  state.wanted = { promo: saved.promo || '', group: saved.group || '' };
}

/**
 * Si un groupe est attendu (state.wanted) et que son chip vient d'être créé,
 * l'active et charge l'EDT. À appeler après (re)construction des chips groupe.
 */
function applyWantedGroup() {
  if (!state.wanted || !state.wanted.group) { state.wanted = null; return; }
  if (state.wanted.promo && getSelectedPromo() !== state.wanted.promo) return;
  const btn = activateChip('group-btns', state.wanted.group);
  if (!btn) return; // pas encore dans cette liste (fallback incomplet), on attend l'API
  state.wanted = null;
  updateSelectorLabel();
  loadSchedule();
}

// ════════════════════════════
//  Modal sélection
// ════════════════════════════

function openSelector() {
  document.getElementById('selector-overlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeSelector() {
  document.getElementById('selector-overlay').classList.remove('open');
  document.body.style.overflow = '';
}

function closeSelectorOutside(e) {
  if (e.target === document.getElementById('selector-overlay')) closeSelector();
}

// ════════════════════════════
//  Navigation semaine
// ════════════════════════════

function updateWeekLabel() {
  document.getElementById('week-label').textContent =
    getWeekDates(state.currentWeek, state.currentYear).label;
}

function changeWeek(delta) {
  state.currentWeek += delta;
  if (state.currentWeek < 1)  { state.currentYear--; state.currentWeek = 52; }
  if (state.currentWeek > 52) { state.currentYear++; state.currentWeek = 1;  }
  updateWeekLabel();
  if (getSelectedGroup()) loadSchedule();
}

// ════════════════════════════
//  Sélection dept / promo / groupe
// ════════════════════════════

/** Clic sur un chip département. */
function selectDept(btn) {
  document.querySelectorAll('#dept-btns .sel-chip').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');

  // Vider promos et groupes
  document.getElementById('promo-btns').innerHTML = '';
  document.getElementById('group-btns').innerHTML = '';
  updateSelectorLabel();
  loadGroupsFromAPI();
}

/** Clic sur un chip promo. */
function selectPromo(btn) {
  document.querySelectorAll('#promo-btns .sel-chip').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  filterGroupsByPromo();
  updateSelectorLabel();
}

/** Clic sur un chip groupe : sélectionne, ferme le modal, charge l'EDT. */
function selectGroup(btn) {
  document.querySelectorAll('#group-btns .sel-chip').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  updateSelectorLabel();
  saveSelection();
  closeSelector();
  loadSchedule();
}

// ════════════════════════════
//  Chargement groupes & promos
// ════════════════════════════

function flattenTree(nodes, result = []) {
  for (const node of nodes) {
    result.push(node.name);
    if (node.children && node.children.length > 0) {
      flattenTree(node.children, result);
    }
  }
  return result;
}

const _treeCache = {};

async function loadGroupsFromAPI() {
  const dept = getSelectedDept();

  try {
    if (!_treeCache[dept]) {
      _treeCache[dept] = await apiFetch('/fr/api/groups/structural/tree/', `dept=${encodeURIComponent(dept)}`);
    }
    state.groupTree = _treeCache[dept];

    // Génère les chips de promo depuis l'arbre
    buildPromoChips();
    filterGroupsByPromo();
  } catch (e) {
    console.warn('[EDT] Impossible de charger les groupes :', e.message);
    state.groupTree = [];
    refreshGroupsFallback();
  }
}

/**
 * Génère dynamiquement les boutons promo depuis l'arbre API.
 * Chaque racine de l'arbre = une promo (BUT1, GIM1, CS1, etc.)
 */
function buildPromoChips() {
  const container = document.getElementById('promo-btns');
  const tree      = state.groupTree || [];
  const promos    = tree.map(root => root.promo || root.promotxt || root.name);

  fillPromoChips(container, promos);
}

/**
 * Remplit les chips promo. La promo active est, dans l'ordre : celle attendue
 * par la restauration (state.wanted), celle déjà sélectionnée (les chips sont
 * reconstruits quand l'API répond après le fallback), sinon la première.
 */
function fillPromoChips(container, promos) {
  const keep = (state.wanted && state.wanted.promo) || getSelectedPromo();
  const activeIdx = Math.max(0, promos.indexOf(keep));

  container.innerHTML = '';
  promos.forEach((p, i) => {
    const btn = document.createElement('button');
    btn.className     = 'sel-chip' + (i === activeIdx ? ' active' : '');
    btn.dataset.value = p;
    btn.textContent   = p;
    btn.onclick       = () => selectPromo(btn);
    container.appendChild(btn);
  });
}

function filterGroupsByPromo() {
  const dept      = getSelectedDept();
  const promo     = getSelectedPromo();
  const container = document.getElementById('group-btns');
  const tree      = state.groupTree || [];
  const keepGroup = getSelectedGroup(); // groupe déjà choisi, à conserver si toujours présent

  container.innerHTML = '';

  let leaves = [];

  if (tree.length > 0) {
    const root = tree.find(r =>
      r.promo === promo || r.buttxt === promo || r.promotxt === promo || r.name === promo
    );
    if (root && root.children) {
      leaves = collectLeaves(root.children);
    }
  }

  // Fallback: use hardcoded GROUPS config
  if (leaves.length === 0) {
    const deptData = GROUPS[dept] || {};
    leaves = deptData[promo] || [];
  }

  leaves.forEach(name => {
    const btn = document.createElement('button');
    btn.className     = 'sel-chip' + (name === keepGroup ? ' active' : '');
    btn.dataset.value = name;
    btn.textContent   = name;
    btn.onclick       = () => selectGroup(btn);
    container.appendChild(btn);
  });

  updateSelectorLabel();
  applyWantedGroup();
}

function collectLeaves(nodes, result = []) {
  for (const node of nodes) {
    if (node.children && node.children.length > 0) {
      collectLeaves(node.children, result);
    } else {
      result.push(node.name);
    }
  }
  return result;
}

function refreshGroupsFallback() {
  const dept     = getSelectedDept();
  const deptData = GROUPS[dept] || {};

  fillPromoChips(document.getElementById('promo-btns'), Object.keys(deptData));
  // state.groupTree est vide ou d'un autre dept : filterGroupsByPromo retombe sur GROUPS
  filterGroupsByPromo();
}

// ════════════════════════════
//  Modal détail cours
// ════════════════════════════

function showDetail(c) {
  if (typeof c === 'string') c = JSON.parse(c);

  document.getElementById('d-name').textContent  = c.name;
  document.getElementById('d-badge').textContent = c.courseType || typeLabel(c.type);
  document.getElementById('d-badge').className   = `course-type-badge type-${c.type}`;

  const h  = Math.floor(c.start), m  = Math.round((c.start % 1) * 60);
  const h2 = Math.floor(c.end),   m2 = Math.round((c.end   % 1) * 60);
  document.getElementById('d-time').textContent  = `${h}h${m.toString().padStart(2,'0')} → ${h2}h${m2.toString().padStart(2,'0')}`;
  document.getElementById('d-day').textContent   = DAYS[c.day] || '—';
  document.getElementById('d-room').textContent  = c.room  || '—';
  document.getElementById('d-tutor').textContent = c.tutor || '—';
  document.getElementById('d-group').textContent = c.group || 'Tous';

  document.getElementById('detail-overlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeDetail() {
  document.getElementById('detail-overlay').classList.remove('open');
  document.body.style.overflow = '';
}

function closeDetailOutside(e) {
  if (e.target === document.getElementById('detail-overlay')) closeDetail();
}
