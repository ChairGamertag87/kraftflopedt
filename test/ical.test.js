'use strict';
process.env.DATA_DIR = require('os').tmpdir() + '/kraftflopedt-test-ical';
process.env.DISABLE_REFRESH = '1';
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const ical = require('../ical');
const store = require('../store');

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

// ── build() sur un store amorce depuis des fichiers (aucun appel FlOpEDT) ──

/** Semaine ISO du 15 octobre de l annee universitaire en cours : toujours dans la fenetre du store. */
function weekInCurrentYear() {
  const now = new Date();
  const start_year = now > new Date(Date.UTC(now.getUTCFullYear(), 6, 20)) ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  const d = new Date(Date.UTC(start_year, 9, 15));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const week = Math.ceil((((d - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000) + 1) / 7);
  return { year: d.getUTCFullYear(), week };
}

function writeEntry(key, endpoint, params, body) {
  const now = new Date().toISOString();
  fs.writeFileSync(path.join(process.env.DATA_DIR, `${key}.json`), JSON.stringify({ key, endpoint, params, fetchedAt: now, changedAt: now, body }));
}

test('build : prof inconnu -> null (404), casse ignoree, co-enseignant trouve, departement sans semaine -> 503 (KF20075)', async () => {
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
  const { year, week } = weekInCurrentYear();
  const course = (id, tutor, supp) => ({
    id, day: 'm', start_time: 480, tutor, room: { name: 'A1' },
    course: { type: 'TD', module: { abbrev: 'M1', name: 'Module 1' }, groups: [{ name: '1A', train_prog: 'BUT1' }], supp_tutor: supp },
  });
  writeEntry('groups-structural-tree__dept=GIM', '/fr/api/groups/structural/tree/', { dept: 'GIM' },
    [{ name: 'CE', promo: 'BUT1', children: [{ name: '1A' }] }]);
  writeEntry('fetch-constraints__dept=GIM', '/fr/api/fetch/constraints/', { dept: 'GIM' }, { TD: { duration: 90 } });
  writeEntry(`fetch-scheduledcourses__dept=GIM&week=${week}&work_copy=0&year=${year}`, '/fr/api/fetch/scheduledcourses/',
    { dept: 'GIM', week, year, work_copy: 0 }, [course(1, 'ABC', [{ username: 'DEF' }]), course(2, 'ABC', [])]);
  store.start();

  assert.equal(await ical.build({ dept: 'GIM', tutor: 'ZZZ' }), null, 'initiales inconnues');
  const lower = await ical.build({ dept: 'GIM', tutor: 'abc' });
  assert.equal(lower.count, 2, 'casse ignoree');
  assert.match(lower.ics, /X-WR-CALNAME:EDT ABC · GIM/, 'initiales canoniques de FlOpEDT');
  const supp = await ical.build({ dept: 'GIM', tutor: 'def' });
  assert.equal(supp.count, 1, 'co-enseignant (supp_tutor) connu');
  await assert.rejects(ical.build({ dept: 'RT', promo: 'BUT1' }), e => e.status === 503, 'aucune semaine en store');
});
