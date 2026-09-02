/* ══════════════════════════════════════════════════
   ROOMS.JS — Recherche de salles libres
   ══════════════════════════════════════════════════ */

const DEPTS = ['INFO', 'CS', 'GIM', 'RT'];

// Fausses salles à ignorer
const ROOM_BLACKLIST = new Set([
  'ATCI', 'AUTRE', 'Autonome', 'Autonomie', 'MIB', 'EN ATT', 'EXT',
  'VIRT', 'VIS1', 'VIS2', 'VIS3', 'VIS4',
  'STA1', 'STA2', 'STA3', 'STA4',
  'Entretien',
]);

// Classement des bâtiments
function getRoomBuilding(name) {
  if (/^Amphi/i.test(name))  return 'Amphis';
  if (/^A\d/i.test(name))    return 'Bât. A';
  if (/^B\d/i.test(name))    return 'Bât. B';
  if (/^C\d/i.test(name))    return 'Bât. C';
  if (/^E\d/i.test(name))    return 'Bât. E';
  if (/^Labo/i.test(name))   return 'Labo';
  return 'Autres';
}

// Cache
let _allRooms    = null;
let _allCourses  = null;
let _roomsWeek   = null;
let _roomsYear   = null;

// État sélection
let _roomsDay  = null;
let _roomsHour = null;

// ════════════════════════════
//  Créneaux IUT (heures de début)
// ════════════════════════════

// Valeurs en minutes depuis minuit, comme le start_time de FlOpEDT.
// On reste en minutes entières de bout en bout : une conversion en heures
// décimales tronquées (11.083 pour 11h05) faisait échouer la comparaison
// avec 665/60 et affichait libres des salles occupées.
const ROOM_SLOTS = [
  { label: '8h00',  value: 480 },
  { label: '9h30',  value: 570 },
  { label: '11h05', value: 665 },
  { label: '12h35', value: 755 },
  { label: '14h15', value: 855 },
  { label: '15h45', value: 945 },
  { label: '17h20', value: 1040 },
];

// ════════════════════════════
//  Modal
// ════════════════════════════

function openRooms() {
  document.getElementById('rooms-overlay').classList.add('open');
  document.body.style.overflow = 'hidden';

  // Pré-sélectionne le jour actuel
  const now = new Date();
  const dow = now.getDay() - 1;
  if (dow >= 0 && dow <= 4 && _roomsDay === null) {
    _roomsDay = dow;
  }
  if (_roomsDay === null) _roomsDay = 0;

  // Pré-sélectionne le créneau le plus proche
  if (_roomsHour === null) {
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const best = ROOM_SLOTS.reduce((prev, s) => s.value <= nowMin ? s : prev, ROOM_SLOTS[0]);
    _roomsHour = best.value;
  }

  renderRoomsPickers();
  searchFreeRooms();
}

function closeRooms() {
  document.getElementById('rooms-overlay').classList.remove('open');
  document.body.style.overflow = '';
}

function closeRoomsOutside(e) {
  if (e.target === document.getElementById('rooms-overlay')) closeRooms();
}

// ════════════════════════════
//  Pickers (chips jour + créneau)
// ════════════════════════════

function renderRoomsPickers() {
  // Jours
  const dayContainer = document.getElementById('rooms-days');
  dayContainer.innerHTML = '';
  DAYS_SHORT.forEach((name, i) => {
    const btn = document.createElement('button');
    btn.className = 'sel-chip' + (i === _roomsDay ? ' active' : '');
    btn.textContent = name;
    btn.onclick = () => { _roomsDay = i; renderRoomsPickers(); searchFreeRooms(); };
    dayContainer.appendChild(btn);
  });

  // Créneaux
  const hourContainer = document.getElementById('rooms-hours');
  hourContainer.innerHTML = '';
  ROOM_SLOTS.forEach(s => {
    const btn = document.createElement('button');
    btn.className = 'sel-chip' + (s.value === _roomsHour ? ' active' : '');
    btn.textContent = s.label;
    btn.onclick = () => { _roomsHour = s.value; renderRoomsPickers(); searchFreeRooms(); };
    hourContainer.appendChild(btn);
  });
}

// ════════════════════════════
//  Chargement des données
// ════════════════════════════

function isRealRoom(name) {
  if (ROOM_BLACKLIST.has(name)) return false;
  if (/^(STA|VIS|VIRT)/i.test(name)) return false;
  return true;
}

function extractIndividualRooms(roomData) {
  const rooms = new Set();
  const groups = roomData.roomgroups || {};
  for (const [key, members] of Object.entries(groups)) {
    if (members.length === 1 && members[0] === key && isRealRoom(key)) {
      rooms.add(key);
    }
  }
  return rooms;
}

async function fetchAllRooms() {
  const allRooms = new Set();
  const promises = DEPTS.map(dept =>
    apiFetch('/fr/api/rooms/all/', `dept=${dept}`)
      .then(data => {
        const rooms = extractIndividualRooms(data);
        rooms.forEach(r => allRooms.add(r));
      })
      .catch(e => console.warn(`[ROOMS] Erreur salles ${dept}:`, e.message))
  );
  await Promise.all(promises);
  return allRooms;
}

async function fetchAllCoursesForWeek() {
  const allCourses = [];
  const promises = DEPTS.map(dept => {
    const params = `dept=${dept}&week=${state.currentWeek}&year=${state.currentYear}&work_copy=0`;
    return apiFetch('/fr/api/fetch/scheduledcourses/', params)
      .then(data => {
        const list = Array.isArray(data) ? data : (data.results || []);
        list.forEach(c => {
          const course   = c.course || {};
          const startMin = c.start_time ?? 480;
          const day      = getDayIndex(c.day);
          const room     = c.room?.name || null;
          const type     = course.type || '';
          const duration = { 'QCM': 20, 'Conf 45': 45, 'Conf': 90, 'Conf 2h': 120 }[type] || 85;

          if (room && day >= 0) {
            allCourses.push({
              room, day,
              start: startMin,             // minutes depuis minuit
              end:   startMin + duration,  // minutes depuis minuit
            });
          }
        });
      })
      .catch(e => console.warn(`[ROOMS] Erreur cours ${dept}:`, e.message));
  });
  await Promise.all(promises);
  return allCourses;
}

// ════════════════════════════
//  Recherche & affichage
// ════════════════════════════

async function searchFreeRooms() {
  const resultDiv = document.getElementById('rooms-result');

  resultDiv.innerHTML = '<div class="rooms-hint"><span class="state-icon spin" style="font-size:1.2rem;">⟳</span> Chargement…</div>';

  const needReload = !_allRooms || !_allCourses || _roomsWeek !== state.currentWeek || _roomsYear !== state.currentYear;
  if (needReload) {
    [_allRooms, _allCourses] = await Promise.all([fetchAllRooms(), fetchAllCoursesForWeek()]);
    _roomsWeek = state.currentWeek;
    _roomsYear = state.currentYear;
  }

  // Salles occupées à ce créneau (comparaison en minutes entières)
  const occupied = new Set();
  _allCourses.forEach(c => {
    if (c.day === _roomsDay && _roomsHour >= c.start && _roomsHour < c.end) {
      occupied.add(c.room);
    }
  });

  // Salles libres, groupées par bâtiment
  const free = [..._allRooms].filter(r => !occupied.has(r));
  const groups = {};
  free.forEach(r => {
    const bldg = getRoomBuilding(r);
    if (!groups[bldg]) groups[bldg] = [];
    groups[bldg].push(r);
  });

  // Trie les salles dans chaque groupe
  for (const bldg of Object.keys(groups)) {
    groups[bldg].sort();
  }

  // Ordre des bâtiments
  const bldgOrder = ['Amphis', 'Bât. A', 'Bât. B', 'Bât. C', 'Bât. E', 'Labo', 'Autres'];
  const sortedBldgs = bldgOrder.filter(b => groups[b]);

  if (free.length === 0) {
    resultDiv.innerHTML = '<div class="rooms-hint">Aucune salle libre à ce créneau</div>';
    return;
  }

  let html = `<div class="rooms-count">${free.length} salle${free.length > 1 ? 's' : ''} libre${free.length > 1 ? 's' : ''}</div>`;

  sortedBldgs.forEach(bldg => {
    html += `
      <div class="rooms-building">
        <div class="rooms-building-name">${bldg}</div>
        <div class="rooms-grid">
          ${groups[bldg].map(r => `<div class="room-chip">${r}</div>`).join('')}
        </div>
      </div>`;
  });

  resultDiv.innerHTML = html;
}
