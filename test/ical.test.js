'use strict';
process.env.DATA_DIR = require('os').tmpdir() + '/kraftflopedt-test-ical';
const test = require('node:test');
const assert = require('node:assert/strict');
const ical = require('../ical');

test('isoWeekMonday : lundi de la semaine ISO, y compris en bord d annee', () => {
  const d = (y, w) => ical.isoWeekMonday(y, w).toISOString().slice(0, 10);
  assert.equal(d(2026, 1),  '2025-12-29');
  assert.equal(d(2026, 40), '2026-09-28');
  assert.equal(d(2026, 53), '2026-12-28');
  assert.equal(d(2027, 1),  '2027-01-04');
  assert.equal(d(2021, 1),  '2021-01-04');
});

test('fmtLocal : date civile + minutes, debordement sur le jour suivant', () => {
  const mon = ical.isoWeekMonday(2026, 40);
  assert.equal(ical.fmtLocal(mon, 8 * 60 + 5), '20260928T080500');
  assert.equal(ical.fmtLocal(mon, 0), '20260928T000000');
  assert.equal(ical.fmtLocal(mon, 24 * 60 + 90), '20260929T013000');
});

test('esc : RFC 5545, antislash, retour ligne, point-virgule, virgule', () => {
  assert.equal(ical.esc('a;b,c\\d\ne'), 'a\\;b\\,c\\\\d\\ne');
  assert.equal(ical.esc('ligne1\r\nligne2'), 'ligne1\\nligne2');
  assert.equal(ical.esc(null), '');
  assert.equal(ical.esc('Salle B12'), 'Salle B12');
});

test('fold : 75 octets max par ligne, continuation avec espace, UTF-8 jamais coupe', () => {
  const short = 'SUMMARY:Cours';
  assert.equal(ical.fold(short), short);

  const long = 'DESCRIPTION:' + 'x'.repeat(200);
  const lines = ical.fold(long).split('\r\n');
  assert.ok(lines.length > 1);
  for (const [i, l] of lines.entries()) {
    assert.ok(Buffer.byteLength(l, 'utf8') <= 75, `ligne ${i} trop longue`);
    if (i > 0) assert.equal(l[0], ' ');
  }
  assert.equal(lines.map((l, i) => i ? l.slice(1) : l).join(''), long);

  const accents = 'SUMMARY:' + 'é'.repeat(100); // 2 octets chacun
  const folded = ical.fold(accents);
  for (const l of folded.split('\r\n')) {
    assert.ok(Buffer.byteLength(l, 'utf8') <= 75);
    assert.ok(!l.includes('�'));
  }
  assert.equal(folded.split('\r\n').map((l, i) => i ? l.slice(1) : l).join(''), accents);
});

test('parsePath : groupe, promo seule, prof, departement normalise', () => {
  assert.deepEqual(ical.parsePath('/ical/INFO/BUT1/1A.ics'), { dept: 'INFO', promo: 'BUT1', group: '1A' });
  assert.deepEqual(ical.parsePath('/ical/info/BUT1.ics'), { dept: 'INFO', promo: 'BUT1', group: undefined });
  assert.deepEqual(ical.parsePath('/ical/prof/rt/DUPONT.ics'), { dept: 'RT', tutor: 'DUPONT' });
  assert.deepEqual(ical.parsePath('/ical/INFO/BUT1/1%20A.ics'), { dept: 'INFO', promo: 'BUT1', group: '1 A' });
  assert.deepEqual(ical.parsePath('/ical/INFO/BUT1/constructor.ics'), { dept: 'INFO', promo: 'BUT1', group: 'constructor' });
});

test('parsePath : formes refusees', () => {
  assert.equal(ical.parsePath('/ical/MATHS/BUT1/1A.ics'), null);
  assert.equal(ical.parsePath('/ical/INFO/BUT1/1A.txt'), null);
  assert.equal(ical.parsePath('/ical/INFO.ics'), null);
  assert.equal(ical.parsePath('/ical/INFO/BUT1/1A/extra.ics'), null);
  assert.equal(ical.parsePath('/ical/INFO//1A.ics'), null);
  assert.equal(ical.parsePath('/ical/INFO/BUT1/%0D%0AX-INJECT.ics'), null, 'caracteres de controle');
  assert.equal(ical.parsePath('/ical/INFO/BUT1/%E0%A4%A.ics'), null, 'encodage invalide');
  assert.equal(ical.parsePath(`/ical/INFO/BUT1/${'a'.repeat(65)}.ics`), null, 'segment trop long');
  assert.equal(ical.parsePath('/prof/INFO/X.ics'), null);
});
