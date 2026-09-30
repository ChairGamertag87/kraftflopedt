'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadFront } = require('./helpers/front');

const u = loadFront(['config.js', 'utils.js']);

test('getISOWeek : semaines ISO autour du passage d annee', () => {
  assert.equal(u.getISOWeek(new Date(2026, 0, 1)),  1);   // jeudi 1er janvier 2026 = S1
  assert.equal(u.getISOWeek(new Date(2026, 11, 31)), 53); // 2026 compte 53 semaines
  assert.equal(u.getISOWeek(new Date(2027, 0, 1)),  53);  // 1er janvier 2027 est encore en S53 de 2026
  assert.equal(u.getISOWeek(new Date(2027, 0, 4)),  1);
  assert.equal(u.getISOWeek(new Date(2025, 11, 29)), 1);  // lundi 29 decembre 2025 = S1 2026
  assert.equal(u.getISOWeek(new Date(2026, 8, 30)),  40);
});

test('getISOWeekYear : l annee ISO n est pas l annee civile en bord d annee', () => {
  assert.equal(u.getISOWeekYear(new Date(2027, 0, 1)),  2026);
  assert.equal(u.getISOWeekYear(new Date(2025, 11, 29)), 2026);
  assert.equal(u.getISOWeekYear(new Date(2026, 5, 15)),  2026);
});

test('getISOWeeksInYear : 52 ou 53', () => {
  assert.equal(u.getISOWeeksInYear(2026), 53);
  assert.equal(u.getISOWeeksInYear(2025), 52);
  assert.equal(u.getISOWeeksInYear(2027), 52);
  assert.equal(u.getISOWeeksInYear(2020), 53);
});

test('getWeekDates : lundi et vendredi de la semaine, libelle S<n>', () => {
  const w = u.getWeekDates(40, 2026);
  assert.equal(w.mon.getFullYear(), 2026);
  assert.equal(w.mon.getMonth(), 8);
  assert.equal(w.mon.getDate(), 28);
  assert.equal(w.fri.getDate(), 2);
  assert.equal(w.fri.getMonth(), 9);
  assert.match(w.label, /^S40 /);

  // S1 2026 commence le lundi 29 decembre 2025
  const s1 = u.getWeekDates(1, 2026);
  assert.equal(s1.mon.getFullYear(), 2025);
  assert.equal(s1.mon.getDate(), 29);
  // S53 2026 : lundi 28 decembre 2026
  const s53 = u.getWeekDates(53, 2026);
  assert.equal(s53.mon.getDate(), 28);
  assert.equal(s53.mon.getMonth(), 11);
});

test('escapeHtml : les cinq caracteres dangereux, null et nombres', () => {
  assert.equal(u.escapeHtml(`<b onclick="x">Tom & 'Jerry'</b>`),
    '&lt;b onclick=&quot;x&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/b&gt;');
  assert.equal(u.escapeHtml(null), '');
  assert.equal(u.escapeHtml(undefined), '');
  assert.equal(u.escapeHtml(42), '42');
});

test('formatClock et formatRange', () => {
  assert.equal(u.formatClock(485), '8h05');
  assert.equal(u.formatClock(600), '10h00');
  assert.equal(u.formatClock(0), '0h00');
  assert.equal(u.formatRange(8, 9.4167), '8h00 → 9h25');
  assert.equal(u.formatRange(13.5, 15), '13h30 → 15h00');
});

test('getDayIndex : codes FlOpEDT, nombres, noms, inconnu', () => {
  assert.equal(u.getDayIndex('m'), 0);
  assert.equal(u.getDayIndex('tu'), 1);
  assert.equal(u.getDayIndex('f'), 4);
  assert.equal(u.getDayIndex(3), 2);
  assert.equal(u.getDayIndex('Jeudi'), 3);
  assert.equal(u.getDayIndex('friday'), 4);
  assert.equal(u.getDayIndex('sa'), -1);
  assert.equal(u.getDayIndex(undefined), -1);
});

test('detectType et typeLabel : la categorie projet s ecrit "projet" cote front', () => {
  assert.equal(u.detectType('CM'), 'cm');
  assert.equal(u.detectType('td'), 'td');
  assert.equal(u.detectType('TP'), 'tp');
  assert.equal(u.detectType('Projet'), 'projet');
  assert.equal(u.detectType('DS'), 'exam');
  assert.equal(u.detectType('QCM'), 'exam');
  assert.equal(u.detectType('Autre', 'Examen de maths'), 'exam');
  assert.equal(u.detectType('TD', 'Examen de maths'), 'td'); // le type explicite prime sur le nom
  assert.equal(u.detectType('Conf'), 'other');
  assert.equal(u.detectType(null), 'other');
  assert.equal(u.typeLabel('projet'), 'Projet');
  assert.equal(u.typeLabel('inconnu'), 'Autre');
});
