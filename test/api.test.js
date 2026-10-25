'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadFront, plain } = require('./helpers/front');

// Arbre INFO simplifie : trois racines nommees CE (une par promo), 1A dans chacune
const TREE = [
  { name: 'CE', promo: 'BUT1', children: [{ name: '1', children: [{ name: '1A' }, { name: '1B' }] }, { name: '2', children: [{ name: '2A' }] }] },
  { name: 'CE', promo: 'BUT2', children: [{ name: '1', children: [{ name: '1A' }] }, { name: 'ALT', children: [{ name: 'ALT1' }] }] },
  { name: 'CE', promo: 'BUT3', children: [{ name: 'A', children: [{ name: '1A' }] }] },
];

function load(fetchImpl) {
  return loadFront(['config.js', 'utils.js', 'state.js', 'api.js'], { fetch: fetchImpl });
}

// DOM minimal : un element par id, createElement et appendChild pour les chips ;
// _active[conteneur] = valeur du chip actif (vide par innerHTML = '' comme en vrai)
function fakeDocument() {
  const els = {}, active = {};
  const el = id => ({
    id, className: '', _html: '', textContent: '', dataset: {}, children: [],
    classList: { add() {}, remove() {}, toggle() {} },
    appendChild(c) { this.children.push(c); },
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = v; this.children = []; delete active[this.id]; },
  });
  // _chips[conteneur] = chips statiques (data-value) renvoyes par querySelectorAll
  const chips = {};
  const chipsOf = sel => { const m = /^#([\w-]+) \.sel-chip$/.exec(sel); return m ? (chips[m[1]] || []) : []; };
  return {
    _els: els, _active: active, _chips: chips,
    getElementById: id => (els[id] = els[id] || el(id)),
    querySelector: sel => {
      const m = /^#([\w-]+) \.sel-chip\.active$/.exec(sel);
      if (m) return active[m[1]] ? { dataset: { value: active[m[1]] } } : null;
      return chipsOf(sel)[0] || null;
    },
    querySelectorAll: chipsOf,
    createElement: () => el(''),
  };
}
const chip = value => {
  const c = { dataset: { value }, active: false };
  c.classList = { toggle: (cls, on) => { c.active = on; }, add: () => { c.active = true; }, remove: () => { c.active = false; } };
  return c;
};
function loadUi(fetchImpl, extra = {}) {
  const document = fakeDocument();
  const ctx = loadFront(['config.js', 'utils.js', 'state.js', 'ui.js', 'api.js', 'render.js'], { document, fetch: fetchImpl, ...extra });
  return { ctx, document };
}
const okJson = body => async () => ({ ok: true, status: 200, json: async () => body });

test('buildAncestorMap : chaque groupe connait son chemin jusqu a la racine', () => {
  const a = load();
  const map = { CE: [] };
  a.buildAncestorMap(TREE[0].children, ['CE'], map);
  assert.deepEqual(plain(map['1A']), ['CE', '1']);
  assert.deepEqual(plain(map['1']),  ['CE']);
  assert.deepEqual(plain(map['2A']), ['CE', '2']);
});

test('isGroupVisible : groupe exact, ancetres, sans filtre, cours sans groupe', () => {
  const a = load();
  const map = { CE: [], 1: ['CE'], '1A': ['CE', '1'], '1B': ['CE', '1'] };
  assert.equal(a.isGroupVisible('1A', '1A', map), true);
  assert.equal(a.isGroupVisible('1',  '1A', map), true);
  assert.equal(a.isGroupVisible('CE', '1A', map), true);
  assert.equal(a.isGroupVisible('1B', '1A', map), false);
  assert.equal(a.isGroupVisible('1A', '1',  map), false); // un TD de 1A n est pas visible par tout le groupe 1
  assert.equal(a.isGroupVisible('1A', '',   map), true);
  assert.equal(a.isGroupVisible(null, '1A', map), true);
  assert.equal(a.isGroupVisible('1A', 'inconnu', map), false);
  // KF20050 : un nom de propriete herite ne doit pas planter ni rendre le cours visible
  assert.equal(a.isGroupVisible('1A', 'constructor', map), false);
  assert.equal(a.isGroupVisible('1A', '__proto__', map), false);
});

test('fetchAncestorMap : une table par promo, la derniere promo n ecrase pas la premiere', async () => {
  const a = load(okJson(TREE));
  const but1 = await a.fetchAncestorMap('INFO', 'BUT1');
  assert.deepEqual(plain(but1['1A']), ['CE', '1']);
  assert.deepEqual(plain(but1['2A']), ['CE', '2']);
  assert.equal(but1.ALT1, undefined);

  const but2 = await a.fetchAncestorMap('INFO', 'BUT2');
  assert.deepEqual(plain(but2.ALT1), ['CE', 'ALT']);
  assert.equal(but2['2A'], undefined);

  const but3 = await a.fetchAncestorMap('INFO', 'BUT3');
  assert.deepEqual(plain(but3['1A']), ['CE', 'A']);
});

test('fetchAncestorMap : sans promo (ou promo inconnue) les tables sont fusionnees', async () => {
  const a = load(okJson(TREE));
  const merged = await a.fetchAncestorMap('INFO');
  assert.deepEqual(plain(merged.ALT1), ['CE', 'ALT']);
  assert.deepEqual(plain(merged['2A']), ['CE', '2']);
  const fallback = await a.fetchAncestorMap('INFO', 'BUT9');
  assert.deepEqual(plain(fallback), plain(merged));
});

test('fetchAncestorMap : un arbre indisponible est une erreur, pas une table vide', async () => {
  const a = load(async () => ({ ok: false, status: 503 }));
  await assert.rejects(a.fetchAncestorMap('INFO', 'BUT1'), /arbre des groupes indisponible.*HTTP 503/);
});

test('fetchDurations : seules les contraintes portant une duree sont gardees', async () => {
  const a = load(okJson({ CM: { duration: 85 }, TP: { duration: 170 }, Conf: {}, DS: null }));
  assert.deepEqual(plain(await a.fetchDurations('INFO')), { CM: 85, TP: 170 });
  assert.equal(a.getDuration('CM', { CM: 85 }), 85);
  assert.equal(a.getDuration('Autre', { CM: 85 }), 85);
  assert.equal(a.getDuration('QCM', { QCM: 20 }), 20);
});

test('loadSchedule : sans groupe, aucune requete et retour a l invite (KF30056)', async () => {
  let calls = 0;
  const { ctx, document } = loadUi(async () => { calls++; return { ok: true, status: 200, json: async () => [] }; });
  await ctx.loadSchedule();                       // querySelector -> null : aucun chip actif
  assert.equal(calls, 0, 'toute la promo n est pas chargee');
  assert.match(document._els['schedule-container'].innerHTML, /Sélectionne ta promo et ton groupe/);
});

test('selectDept et changeWeek : une reponse en vol n ecrase pas l invite (KF30056)', async () => {
  const pending = [];
  const fetchImpl = () => new Promise(r => pending.push(() => r({ ok: true, status: 200, json: async () => [] })));
  const { ctx, document } = loadUi(fetchImpl);
  Object.assign(document._active, { 'dept-btns': 'INFO', 'promo-btns': 'BUT2', 'group-btns': '2A' });
  const first = ctx.loadSchedule();                      // INFO BUT2 2A, reponse lente
  assert.match(document._els['schedule-container'].innerHTML, /Chargement/);
  ctx.selectDept({ classList: { add() {}, remove() {} } }); // clic RT avant la reponse
  assert.match(document._els['schedule-container'].innerHTML, /Sélectionne ta promo/);
  pending.splice(0).forEach(f => f());
  await first;
  assert.match(document._els['schedule-container'].innerHTML, /Sélectionne ta promo/, 'la reponse INFO 2A est ignoree');
  assert.doesNotMatch(document._els['schedule-container'].innerHTML, /Aucun cours/);
  // ▶ sans groupe : l'en-tete change, la grille reste a l'invite
  document._els['schedule-container'].innerHTML = 'ancienne grille';
  ctx.changeWeek(1);
  assert.match(document._els['schedule-container'].innerHTML, /Sélectionne ta promo/);
});

test('loadSchedule : hors ligne, une semaine vide deja visitee n est pas "sans copie locale" (KF20065)', async () => {
  const localStorage = { getItem: () => JSON.stringify({ ts: Date.now() - 60000, courses: [] }), setItem() {}, removeItem() {}, key: () => null, length: 0 };
  const { ctx, document } = loadUi(async () => { throw new Error('Failed to fetch'); }, { localStorage });
  Object.assign(document._active, { 'dept-btns': 'INFO', 'promo-btns': 'BUT1', 'group-btns': '1A' });
  await ctx.loadSchedule();
  assert.match(document._els['schedule-container'].innerHTML, /Aucun cours cette semaine/);
  assert.doesNotMatch(document._els['schedule-container'].innerHTML, /aucune copie locale/);
  assert.match(document._els['error-banner'].textContent, /Hors-ligne/);
});

test('apiFetch : le message d erreur de l adapter est lu, un corps non JSON ne plante pas (KF20063)', async () => {
  const a = load(async () => ({ ok: false, status: 404, json: async () => ({ error: 'Semaine 2026-S20 hors de l annee universitaire en cours' }) }));
  await assert.rejects(a.apiFetch('/fr/api/fetch/scheduledcourses/', 'x'), e => e.status === 404 && /S20 hors/.test(e.message));
  const b = load(async () => ({ ok: false, status: 502, json: async () => { throw new SyntaxError('Unexpected token <'); } }));
  await assert.rejects(b.apiFetch('/fr/api/fetch/scheduledcourses/', 'x'), e => e.status === 502 && /HTTP 502/.test(e.message));
  const c = load(async (url, opts) => { assert.ok(opts.signal, 'AbortController branche'); return { ok: true, status: 200, json: async () => [1] }; });
  assert.deepEqual(plain(await c.apiFetch('/fr/api/fetch/scheduledcourses/', 'x')), [1]);
});

test('loadSchedule : un refus 4xx affiche la raison sans bouton Reessayer (KF20063)', async () => {
  const fetchImpl = async () => ({ ok: false, status: 404, json: async () => ({ error: 'Semaine 2026-S20 hors de l annee universitaire en cours' }) });
  const { ctx, document } = loadUi(fetchImpl);
  Object.assign(document._active, { 'dept-btns': 'INFO', 'promo-btns': 'BUT1', 'group-btns': '1A' });
  await ctx.loadSchedule();
  const html = document._els['schedule-container'].innerHTML;
  assert.match(html, /Semaine indisponible/);
  assert.match(html, /S20 hors/);
  assert.doesNotMatch(html, /Réessayer/);
  assert.match(document._els['error-banner'].textContent, /S20 hors/);
});

test('changeWeek : la navigation s arrete aux bornes de l annee universitaire (KF20063)', () => {
  const { ctx } = loadUi(okJson([]));
  const state = require('vm').runInContext('state', ctx); // const du script, pas une globale du contexte
  const now = new Date();
  const start_year = now > new Date(now.getFullYear(), 6, 20) ? now.getFullYear() : now.getFullYear() - 1;
  state.currentWeek = 27; state.currentYear = start_year;   // S26 (lundi 22-28 juin) est toujours hors fenetre
  ctx.changeWeek(-1);
  assert.deepEqual([state.currentWeek, state.currentYear], [27, start_year]);
  state.currentWeek = 35; state.currentYear = start_year + 1; // S36 (lundi 1er-7 sept) est toujours hors fenetre
  ctx.changeWeek(1);
  assert.deepEqual([state.currentWeek, state.currentYear], [35, start_year + 1]);
  state.currentWeek = 40; state.currentYear = start_year;
  ctx.changeWeek(1);
  assert.deepEqual([state.currentWeek, state.currentYear], [41, start_year]);
});

test('fillPromoChips : aucune promo activee d office (KF30056)', () => {
  const { ctx, document } = loadUi();
  const container = document.getElementById('promo-btns');
  ctx.fillPromoChips(container, ['BUT1', 'BUT2', 'BUT3']);
  assert.equal(container.children.length, 3);
  assert.ok(container.children.every(c => !c.className.includes('active')), 'aucun chip actif sans choix');
  // state est une constante du contexte isole : on la modifie depuis l interieur
  require('vm').runInContext("state.wanted = { promo: 'BUT2', group: '' }", ctx);
  ctx.fillPromoChips(container, ['BUT1', 'BUT2', 'BUT3']);
  assert.deepEqual(container.children.map(c => c.className.includes('active')), [false, true, false]);
});

test('cacheLoad : une entree mal formee est supprimee et ignoree (KF20066)', () => {
  for (const raw of ['{"ts":1,"courses":"x"}', '{"ts":1,"courses":{}}', '{"courses":[]}', 'null', '[]']) {
    const removed = [];
    const localStorage = { getItem: () => raw.replace('"ts":1', `"ts":${Date.now()}`), setItem() {}, removeItem: k => removed.push(k), key: () => null, length: 0 };
    const a = loadFront(['config.js', 'utils.js', 'state.js', 'api.js'], { localStorage });
    assert.equal(a.cacheLoad('INFO', 'BUT1', '1A', 40, 2026), null, raw);
    assert.ok(removed.length === 1 || raw === 'null' || raw === '[]', `entree supprimee pour ${raw}`);
  }
  const ok = { getItem: () => JSON.stringify({ ts: Date.now(), courses: [] }), setItem() {}, removeItem() {}, key: () => null, length: 0 };
  assert.deepEqual(plain(loadFront(['config.js', 'utils.js', 'state.js', 'api.js'], { localStorage: ok }).cacheLoad('INFO', 'BUT1', '1A', 40, 2026).courses), []);
});

test('cacheCleanup : le prefixe est versionne, les entrees de l ancien format sont purgees (KF20066)', () => {
  const store = { 'edt-cache-INFO-BUT1-1A-S40-2026': '{"ts":1,"courses":[]}', 'edt-cache-v2-INFO-BUT1-1A-S40-2026': JSON.stringify({ ts: Date.now(), courses: [] }), 'edt-selection': '{}' };
  const localStorage = {
    getItem: k => store[k] ?? null, setItem(k, v) { store[k] = v; }, removeItem(k) { delete store[k]; },
    key: i => Object.keys(store)[i] ?? null, get length() { return Object.keys(store).length; },
  };
  const a = loadFront(['config.js', 'utils.js', 'state.js', 'api.js'], { localStorage });
  assert.match(a.cacheKey('INFO', 'BUT1', '1A', 40, 2026), /^edt-cache-v2-/);
  a.cacheCleanup();
  assert.deepEqual(Object.keys(store).sort(), ['edt-cache-v2-INFO-BUT1-1A-S40-2026', 'edt-selection']);
});

test('readSavedSelection et activateChip : parametres d URL insensibles a la casse (KF10085)', () => {
  const { ctx, document } = loadUi(undefined, { URLSearchParams, location: { search: '?dept=info&promo=but1&group=1a', pathname: '/' } });
  assert.deepEqual(plain(ctx.readSavedSelection()), { dept: 'INFO', promo: 'BUT1', group: '1a' });
  document._chips['group-btns'] = [chip('1A'), chip('1B')];
  const found = ctx.activateChip('group-btns', '1a');
  assert.equal(found && found.dataset.value, '1A');
  assert.deepEqual(document._chips['group-btns'].map(c => c.active), [true, false]);
});

test('restoreSelection : selection inconnue -> banniere et URL nettoyee (KF10085)', () => {
  const replaced = [];
  const { ctx, document } = loadUi(undefined, {
    URLSearchParams,
    location: { search: '?dept=ZZZ&promo=BUT1&group=1A', pathname: '/edt' },
    history: { replaceState: (s, t, url) => replaced.push(url) },
  });
  document._chips['dept-btns'] = [chip('INFO'), chip('RT')];
  ctx.restoreSelection();
  assert.equal(document._chips['dept-btns'][0].active, true, 'le premier departement reste actif');
  assert.match(document._els['error-banner'].textContent, /Sélection inconnue/);
  assert.deepEqual(replaced, ['/edt']);
});

test('cacheKey : une cle par departement, promo, groupe et semaine', () => {
  const a = load();
  assert.notEqual(a.cacheKey('INFO', 'BUT1', '1A', 40, 2026), a.cacheKey('INFO', 'BUT2', '1A', 40, 2026));
  assert.notEqual(a.cacheKey('INFO', 'BUT1', '1A', 40, 2026), a.cacheKey('INFO', 'BUT1', '1A', 40, 2027));
  assert.match(a.cacheKey('INFO', 'BUT1', '1A', 40, 2026), /^edt-cache-/);
});
