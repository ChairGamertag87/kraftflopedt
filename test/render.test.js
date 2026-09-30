'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadFront, plain } = require('./helpers/front');

const r = loadFront(['config.js', 'utils.js', 'state.js', 'render.js']);
const c = (id, start, end) => ({ id, start, end });
const byId = out => Object.fromEntries(out.map(p => [p.c.id, { col: p.col, columns: p.columns }]));

test('layoutLanes : sans chevauchement, une colonne pleine largeur', () => {
  const out = byId(r.layoutLanes([c('a', 8, 9.5), c('b', 9.5, 11), c('c', 14, 15.5)]));
  for (const k of ['a', 'b', 'c']) assert.deepEqual(out[k], { col: 0, columns: 1 });
});

test('layoutLanes : deux cours superposes se partagent deux colonnes', () => {
  const out = byId(r.layoutLanes([c('a', 8, 9.5), c('b', 8, 9.5)]));
  assert.equal(out.a.columns, 2);
  assert.equal(out.b.columns, 2);
  assert.notEqual(out.a.col, out.b.col);
});

test('layoutLanes : un chevauchement le matin ne retrecit pas l apres-midi', () => {
  const out = byId(r.layoutLanes([c('a', 8, 9.5), c('b', 8.5, 10), c('pm', 14, 15.5)]));
  assert.equal(out.a.columns, 2);
  assert.equal(out.b.columns, 2);
  assert.deepEqual(out.pm, { col: 0, columns: 1 });
});

test('layoutLanes : un cours qui commence a la fin d un autre reutilise sa colonne', () => {
  const out = byId(r.layoutLanes([c('a', 8, 9.5), c('b', 8, 11), c('c', 9.5, 11)]));
  assert.equal(out.a.columns, 2);
  assert.equal(out.c.columns, 2);
  assert.equal(out.c.col, out.a.col);
  assert.notEqual(out.b.col, out.a.col);
});

test('layoutLanes : trois cours imbriques donnent trois colonnes', () => {
  const out = byId(r.layoutLanes([c('a', 8, 12), c('b', 9, 10), c('c', 9.5, 11)]));
  assert.equal(new Set(Object.values(out).map(p => p.col)).size, 3);
  for (const p of Object.values(out)) assert.equal(p.columns, 3);
});

test('layoutLanes : ordre d entree indifferent, liste vide acceptee', () => {
  assert.deepEqual(plain(r.layoutLanes([])), []);
  const a = byId(r.layoutLanes([c('x', 10, 11), c('y', 8, 9)]));
  const b = byId(r.layoutLanes([c('y', 8, 9), c('x', 10, 11)]));
  assert.deepEqual(a, b);
});
