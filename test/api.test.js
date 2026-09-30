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

test('cacheKey : une cle par departement, promo, groupe et semaine', () => {
  const a = load();
  assert.notEqual(a.cacheKey('INFO', 'BUT1', '1A', 40, 2026), a.cacheKey('INFO', 'BUT2', '1A', 40, 2026));
  assert.notEqual(a.cacheKey('INFO', 'BUT1', '1A', 40, 2026), a.cacheKey('INFO', 'BUT1', '1A', 40, 2027));
  assert.match(a.cacheKey('INFO', 'BUT1', '1A', 40, 2026), /^edt-cache-/);
});
