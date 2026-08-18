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

  container.innerHTML = '';

  tree.forEach((root, i) => {
    const promoValue = root.promo || root.promotxt || root.name;
    const btn = document.createElement('button');
    btn.className     = 'sel-chip' + (i === 0 ? ' active' : '');
    btn.dataset.value = promoValue;
    btn.textContent   = promoValue;
    btn.onclick       = () => selectPromo(btn);
    container.appendChild(btn);
  });
}

function filterGroupsByPromo() {
  const dept      = getSelectedDept();
  const promo     = getSelectedPromo();
  const container = document.getElementById('group-btns');
  const tree      = state.groupTree || [];

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
    btn.className     = 'sel-chip';
    btn.dataset.value = name;
    btn.textContent   = name;
    btn.onclick       = () => selectGroup(btn);
    container.appendChild(btn);
  });

  updateSelectorLabel();
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
  const dept      = getSelectedDept();
  const deptData  = GROUPS[dept] || {};
  const promoContainer = document.getElementById('promo-btns');
  const groupContainer = document.getElementById('group-btns');

  // Génère les chips promo depuis le fallback config
  promoContainer.innerHTML = '';
  const promoKeys = Object.keys(deptData);
  promoKeys.forEach((p, i) => {
    const btn = document.createElement('button');
    btn.className     = 'sel-chip' + (i === 0 ? ' active' : '');
    btn.dataset.value = p;
    btn.textContent   = p;
    btn.onclick       = () => selectPromo(btn);
    promoContainer.appendChild(btn);
  });

  // Génère les chips groupe pour la première promo
  const promo  = getSelectedPromo();
  const groups = deptData[promo] || [];
  groupContainer.innerHTML = '';
  groups.forEach(g => {
    const btn = document.createElement('button');
    btn.className     = 'sel-chip';
    btn.dataset.value = g;
    btn.textContent   = g;
    btn.onclick       = () => selectGroup(btn);
    groupContainer.appendChild(btn);
  });

  updateSelectorLabel();
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
