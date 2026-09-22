/* ══════════════════════════════════════════════════
   CROUS.JS — Menu du Resto U' Blagnac (via l'adapter : /api/crous/menu)
   ══════════════════════════════════════════════════ */

const CROUS_DAY_NAMES = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
const CROUS_MOMENT_LABEL = { matin: '🌅 Petit-déjeuner', midi: '🍽️ Déjeuner', soir: '🌙 Dîner' };

// Echappement HTML : escapeHtml (utils.js), partage avec la grille et les modales.
const crousEscape = escapeHtml;

let _crousData    = null;   // réponse de l'adapter
let _crousPromise = null;
let _crousDate    = null;   // date ISO sélectionnée

// ════════════════════════════
//  Modal
// ════════════════════════════

function openCrous() {
  document.getElementById('crous-overlay').classList.add('open');
  document.body.style.overflow = 'hidden';
  loadCrousMenu();
}

function closeCrous() {
  document.getElementById('crous-overlay').classList.remove('open');
  document.body.style.overflow = '';
}

function closeCrousOutside(e) {
  if (e.target === document.getElementById('crous-overlay')) closeCrous();
}

// ════════════════════════════
//  Chargement
// ════════════════════════════

async function loadCrousMenu() {
  const result = document.getElementById('crous-result');

  // Cache navigateur : 10 min, le menu ne change pas plus vite que ça
  if (_crousData && Date.now() - _crousData._at < 10 * 60 * 1000) {
    renderCrousDays();
    return;
  }
  if (_crousPromise) return;

  result.innerHTML = '<div class="rooms-hint">⏳ On demande au chef…</div>';
  document.getElementById('crous-days').innerHTML = '';

  _crousPromise = fetch('/api/crous/menu', { headers: { Accept: 'application/json' } })
    .then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .then(json => {
      _crousData = { ...(json.data || json), _at: Date.now() };
      renderCrousDays();
    })
    .catch(e => {
      console.warn('[CROUS] menu indisponible :', e.message);
      result.innerHTML = '<div class="rooms-hint">😕 Le menu est indisponible pour le moment.<br>'
        + 'Le flux du CROUS ne répond pas, réessaie un peu plus tard.</div>';
    })
    .finally(() => { _crousPromise = null; });
}

// ════════════════════════════
//  Rendu
// ════════════════════════════

function crousParseDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function crousTodayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function crousDayLabel(iso) {
  const d = crousParseDate(iso);
  const today = crousTodayIso();
  if (iso === today) return "Aujourd'hui";
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  if (d.toDateString() === tomorrow.toDateString()) return 'Demain';
  return `${CROUS_DAY_NAMES[d.getDay()]} ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function crousDayLong(iso) {
  return crousParseDate(iso).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}

function renderCrousDays() {
  const days      = (_crousData && _crousData.days) || [];
  const container = document.getElementById('crous-days');
  const result    = document.getElementById('crous-result');
  const meta      = document.getElementById('crous-meta');

  container.innerHTML = '';

  if (!days.length) {
    result.innerHTML = '<div class="rooms-hint">🍽️ Aucun menu publié pour les prochains jours.<br>'
      + "Le CROUS met généralement les menus en ligne en début de semaine.</div>";
    meta.textContent = '';
    return;
  }

  if (!_crousDate || !days.some(d => d.date === _crousDate)) _crousDate = days[0].date;

  days.forEach(d => {
    const btn = document.createElement('button');
    btn.className     = 'sel-chip' + (d.date === _crousDate ? ' active' : '');
    btn.dataset.value = d.date;
    btn.textContent   = crousDayLabel(d.date);
    btn.onclick       = () => { _crousDate = d.date; renderCrousDays(); };
    container.appendChild(btn);
  });

  const day = days.find(d => d.date === _crousDate);
  let html = `<div class="crous-date">${crousEscape(crousDayLong(day.date))}</div>`;

  for (const svc of day.services) {
    html += `<div class="crous-service">`;
    if (day.services.length > 1 || svc.moment !== 'midi') {
      html += `<div class="crous-service-title">${CROUS_MOMENT_LABEL[svc.moment] || crousEscape(svc.moment)}</div>`;
    }
    for (const cat of svc.categories) {
      html += `<div class="crous-cat">
        <div class="rooms-building-name">${crousEscape(cat.libelle)}</div>
        <ul class="crous-plats">${cat.plats.map(p => `<li>${crousEscape(p)}</li>`).join('')}</ul>
      </div>`;
    }
    html += `</div>`;
  }
  result.innerHTML = html;

  const src = _crousData.source === 'croustillant' ? 'CROUStillant (repli)' : 'flux CNOUS';
  const upd = _crousData.lastModified ? new Date(_crousData.lastModified) : (_crousData.fetchedAt ? new Date(_crousData.fetchedAt) : null);
  meta.textContent = `Source : ${src}`
    + (upd && !isNaN(upd) ? ` · publié le ${upd.toLocaleDateString('fr-FR')} à ${upd.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : '')
    + (_crousData.stale ? ' · données possiblement anciennes' : '');
}

// ════════════════════════════
//  Easter egg : CroustOccitanie 🥐
//  Tape "croust" au clavier, ou tapote 5 fois le titre de la modale.
// ════════════════════════════

let _croustBuffer = '';
let _croustTaps   = 0;
let _croustTapTimer = null;
let _croustBusy   = false;

document.addEventListener('keydown', e => {
  if (e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
  if (!e.key || e.key.length !== 1) return;
  _croustBuffer = (_croustBuffer + e.key.toLowerCase()).slice(-6);
  if (_croustBuffer === 'croust') { _croustBuffer = ''; croustOccitanie(); }
});

function crousTitleTap() {
  _croustTaps++;
  clearTimeout(_croustTapTimer);
  _croustTapTimer = setTimeout(() => { _croustTaps = 0; }, 1500);
  if (_croustTaps >= 5) { _croustTaps = 0; croustOccitanie(); }
}

function croustOccitanie() {
  if (_croustBusy) return;
  _croustBusy = true;

  // Pluie de viennoiseries
  const layer = document.createElement('div');
  layer.className = 'croust-rain';
  const icons = ['🥐', '🥖', '🧀', '🍷', '🥗', '🍽️', '🥐', '🥐'];
  for (let i = 0; i < 36; i++) {
    const s = document.createElement('span');
    s.textContent = icons[i % icons.length];
    s.style.left = `${Math.random() * 100}%`;
    s.style.animationDelay = `${Math.random() * 1.6}s`;
    s.style.animationDuration = `${2.4 + Math.random() * 1.8}s`;
    s.style.fontSize = `${1.4 + Math.random() * 1.6}rem`;
    layer.appendChild(s);
  }
  document.body.appendChild(layer);

  // Tampon "Approuvé par CroustOccitanie"
  const stamp = document.createElement('div');
  stamp.className = 'croust-stamp';
  stamp.innerHTML = '🥐 Approuvé par<br><b>CroustOccitanie</b><small>le vrai menu, c\'est ici</small>';
  document.body.appendChild(stamp);

  const btn = document.getElementById('crous-btn');
  if (btn) btn.textContent = '🥐 CroustOccitanie';

  setTimeout(() => {
    layer.remove();
    stamp.remove();
    _croustBusy = false;
  }, 4600);
}
