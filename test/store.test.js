'use strict';
// store.js se charge sans effet de bord (pas d acces disque avant start()) ;
// DATA_DIR pointe quand meme vers un dossier temporaire par securite.
process.env.DATA_DIR = require('os').tmpdir() + '/kraftflopedt-test-store';
const test = require('node:test');
const assert = require('node:assert/strict');
const store = require('../store');

const COURSES = '/fr/api/fetch/scheduledcourses/';
const TREE    = '/fr/api/groups/structural/tree/';

test('httpError : porte le code HTTP', () => {
  const e = store.httpError(400, 'nope');
  assert.equal(e.status, 400);
  assert.equal(e.message, 'nope');
  assert.ok(e instanceof Error);
});

test('validate : endpoint inconnu -> 404, departement hors liste blanche -> 400', () => {
  assert.throws(() => store.validate('/fr/api/fetch/autre/', { dept: 'INFO' }), e => e.status === 404);
  assert.throws(() => store.validate(TREE, { dept: 'MATHS' }), e => e.status === 400);
  assert.throws(() => store.validate(TREE, {}), e => e.status === 400);
});

test('validate : le departement est normalise en majuscules et les autres parametres ignores', () => {
  assert.deepEqual(store.validate(TREE, { dept: ' info ', week: 40 }), { dept: 'INFO' });
});

test('validate : semaine 1-53, annee 2000-2100, work_copy=0 seulement', () => {
  assert.deepEqual(store.validate(COURSES, { dept: 'rt', week: '40', year: '2026' }),
    { dept: 'RT', week: 40, year: 2026, work_copy: 0 });
  assert.deepEqual(store.validate(COURSES, { dept: 'RT', week: '53', year: '2026', work_copy: '' }).work_copy, 0);
  for (const bad of [{ week: '0' }, { week: '54' }, { week: 'abc' }, { week: '1.5' }, { week: '' }]) {
    assert.throws(() => store.validate(COURSES, { dept: 'RT', year: '2026', ...bad }), /week/);
  }
  for (const bad of [{ year: '1999' }, { year: '2101' }, { year: 'x' }]) {
    assert.throws(() => store.validate(COURSES, { dept: 'RT', week: '10', ...bad }), /year/);
  }
  assert.throws(() => store.validate(COURSES, { dept: 'RT', week: '10', year: '2026', work_copy: '1' }), /work_copy/);
});

test('weekInWindow : du 1er juillet precedant l annee universitaire au 31 aout suivant', () => {
  const now = new Date('2026-09-30T08:00:00Z'); // annee universitaire 2026-2027
  assert.equal(store.weekInWindow(2026, 27, now), false);  // lundi 29 juin 2026, avant le 1er juillet
  assert.equal(store.weekInWindow(2026, 28, now), true);   // lundi 6 juillet 2026
  assert.equal(store.weekInWindow(2026, 26, now), false);  // lundi 22 juin 2026
  assert.equal(store.weekInWindow(2027, 35, now), true);   // lundi 30 aout 2027
  assert.equal(store.weekInWindow(2027, 36, now), false);  // lundi 6 septembre 2027
  assert.equal(store.weekInWindow(2000, 1, now), false);
  assert.equal(store.weekInWindow(2100, 1, now), false);
});

test('weekInWindow : avant aout, l annee universitaire en cours est celle de l an dernier', () => {
  const now = new Date('2027-03-15T08:00:00Z'); // toujours 2026-2027
  assert.equal(store.weekInWindow(2026, 40, now), true);
  assert.equal(store.weekInWindow(2027, 35, now), true);
  assert.equal(store.weekInWindow(2027, 40, now), false);
  assert.equal(store.weekInWindow(2026, 20, now), false);
});

test('weeksToMaintain : la semaine courante d abord, WEEKS_BEHIND semaines passees, fin vers le 20 juillet', () => {
  const now = new Date('2026-09-30T08:00:00Z');
  const weeks = store.weeksToMaintain(now);
  assert.deepEqual({ year: weeks[0].year, week: weeks[0].week }, { year: 2026, week: 40 });
  const ids = weeks.map(w => `${w.year}-${w.week}`);
  assert.equal(new Set(ids).size, ids.length, 'pas de doublon');
  assert.ok(ids.includes('2026-38') && !ids.includes('2026-37'), 'deux semaines en arriere');
  assert.ok(ids.includes('2027-28'), 'la mi-juillet 2027 est entretenue');
  assert.ok(!ids.includes('2027-30'), 'apres le 20 juillet, plus rien');
  // futur avant passe a egalite de distance : S41 avant S39
  assert.ok(ids.indexOf('2026-41') < ids.indexOf('2026-39'));
  assert.ok(weeks.length > 40 && weeks.length < 50);
});

test('weeksToMaintain : entre le 21 et le 31 juillet on bascule sur l annee suivante', () => {
  const weeks = store.weeksToMaintain(new Date('2027-07-25T08:00:00Z'));
  const ids = weeks.map(w => `${w.year}-${w.week}`);
  assert.ok(ids.includes('2027-36'), 'la rentree 2027 est deja entretenue');
  assert.ok(ids.includes('2028-28'), 'jusqu a juillet 2028');
  assert.ok(weeks.length > 40);
});

test('weeksToMaintain : autour du 1er janvier, S53 de 2026 puis S1 de 2027', () => {
  const ids = store.weeksToMaintain(new Date('2026-12-30T08:00:00Z')).map(w => `${w.year}-${w.week}`);
  assert.equal(ids[0], '2026-53');
  assert.ok(ids.includes('2027-1'));
  assert.ok(!ids.includes('2027-53'));
});

test('ENDPOINTS : quatre endpoints FlOpEDT, rien d autre', () => {
  assert.deepEqual(Object.keys(store.ENDPOINTS).sort(), [
    '/fr/api/fetch/constraints/', '/fr/api/fetch/scheduledcourses/',
    '/fr/api/groups/structural/tree/', '/fr/api/rooms/all/',
  ]);
});
