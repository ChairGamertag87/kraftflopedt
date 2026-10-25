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

test('weekInWindow et weeksToMaintain : meme bascule du 20 juillet (KF10087)', () => {
  const now = new Date('2027-07-25T08:00:00Z');
  const ids = store.weeksToMaintain(now).map(w => `${w.year}-${w.week}`);
  assert.ok(ids.includes('2027-36'));
  assert.equal(store.weekInWindow(2027, 36, now), true, 'une semaine entretenue est dans la fenetre');
  assert.equal(store.weekInWindow(2028, 35, now), true);
  assert.equal(store.weekInWindow(2026, 40, now), false, 'l annee precedente est sortie');
  // Le 19 juillet on est encore sur 2026-2027
  const before = new Date('2027-07-19T08:00:00Z');
  assert.equal(store.weekInWindow(2026, 40, before), true);
  assert.equal(store.weekInWindow(2027, 36, before), false);
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

// ── Appels FlOpEDT simules : https.request remplace par un faux serveur ──
const https = require('https');
const { EventEmitter } = require('events');

/** Remplace https.request ; `scenario(req, cb)` joue la reponse. Renvoie la fonction de restauration. */
function fakeUpstream(scenario) {
  const original = https.request;
  const original_gap = store.CONFIG.minGap;
  store.CONFIG.minGap = 1;
  https.request = (opts, cb) => {
    fakeUpstream.calls++;
    const req = new EventEmitter();
    req.end = () => scenario(req, cb);
    req.destroy = err => {
      if (req.destroyed) return;
      req.destroyed = true;
      if (err) req.emit('error', err);
      req.emit('close');
    };
    return req;
  };
  return () => { https.request = original; store.CONFIG.minGap = original_gap; };
}
fakeUpstream.calls = 0;

/** La Map pending est privee : si elle est purgee, un nouveau refresh sur la meme cle declenche un nouvel appel. */
async function assertPendingPurged(endpoint, query) {
  const before = fakeUpstream.calls;
  await store.refresh(endpoint, query).catch(() => {});
  assert.equal(fakeUpstream.calls, before + 1, 'un nouvel appel part : la cle n est plus dans pending');
}

function fakeResponse(statusCode = 200) {
  const res = new EventEmitter();
  res.statusCode = statusCode;
  res.complete = false;
  return res;
}

test('fetchUpstream : une reponse complete est servie et la file est liberee', async () => {
  const restore = fakeUpstream((req, cb) => {
    const res = fakeResponse();
    setImmediate(() => { cb(res); res.emit('data', Buffer.from('[{"ok":1}]')); res.complete = true; res.emit('end'); res.emit('close'); });
  });
  try {
    const entry = await store.refresh(TREE, { dept: 'INFO' });
    assert.deepEqual(entry.body, [{ ok: 1 }]);
    assert.equal(store.status().queue.inFlight, 0);
  } finally { restore(); }
});

test('get : une cle stale en echec recent ne relance pas FlOpEDT a chaque lecture (KF20068)', async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const saved_static = store.CONFIG.refreshStatic;
  let fail = false;
  const restore = fakeUpstream((req, cb) => {
    const res = fakeResponse(fail ? 500 : 200);
    setImmediate(() => { cb(res); res.emit('data', Buffer.from('[]')); res.complete = true; res.emit('end'); res.emit('close'); });
  });
  try {
    await store.refresh(TREE, { dept: 'GIM' });          // entree en store
    store.CONFIG.refreshStatic = 1;                       // elle est aussitot stale
    await sleep(5);
    fail = true;
    const calls_before = fakeUpstream.calls;
    assert.equal((await store.get(TREE, { dept: 'GIM' })).status, 'stale');
    await sleep(20);                                      // le refresh de fond echoue -> failedAt
    assert.equal(fakeUpstream.calls, calls_before + 1, 'premier rafraichissement tente');
    for (let i = 0; i < 5; i++) assert.equal((await store.get(TREE, { dept: 'GIM' })).status, 'stale');
    await sleep(20);
    assert.equal(fakeUpstream.calls, calls_before + 1, 'pas de nouvel appel avant FAILURE_TTL_MS');
  } finally { store.CONFIG.refreshStatic = saved_static; restore(); }
});

test('get : une semaine passee n est jamais stale, une semaine entretenue l est (KF10089)', async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const saved_courses = store.CONFIG.refreshCourses;
  const restore = fakeUpstream((req, cb) => {
    const res = fakeResponse();
    setImmediate(() => { cb(res); res.emit('data', Buffer.from('[]')); res.complete = true; res.emit('end'); res.emit('close'); });
  });
  try {
    // Deuxieme semaine de juillet de l annee universitaire en cours : dans la
    // fenetre a la demande, mais jamais dans weeksToMaintain (plus de 2 semaines passees)
    const now = new Date();
    const start_year = now.getUTCMonth() >= 7 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
    const july = new Date(Date.UTC(start_year, 6, 10));
    july.setUTCDate(july.getUTCDate() + 4 - (july.getUTCDay() || 7));
    const past_week = Math.ceil((((july - Date.UTC(july.getUTCFullYear(), 0, 1)) / 86400000) + 1) / 7);
    const past = { dept: 'INFO', week: String(past_week), year: String(july.getUTCFullYear()) };
    const maintained = store.weeksToMaintain(now)[0];
    const current = { dept: 'INFO', week: String(maintained.week), year: String(maintained.year) };

    await store.refresh(COURSES, store.validate(COURSES, past));
    await store.refresh(COURSES, store.validate(COURSES, current));
    store.CONFIG.refreshCourses = 1;
    await sleep(5);

    const calls_before = fakeUpstream.calls;
    assert.equal((await store.get(COURSES, past)).status, 'hit', 'semaine passee servie sans etre stale');
    await sleep(20);
    assert.equal(fakeUpstream.calls, calls_before, 'aucun appel FlOpEDT pour une semaine passee');
    assert.equal((await store.get(COURSES, current)).status, 'stale');
    await sleep(20);
    assert.equal(fakeUpstream.calls, calls_before + 1, 'la semaine entretenue est rafraichie');
  } finally { store.CONFIG.refreshCourses = saved_courses; restore(); }
});

test('start : les fichiers d une annee universitaire passee sont supprimes au chargement (KF10089)', () => {
  const fs = require('fs'), path = require('path');
  const dir = store.CONFIG.dataDir;
  fs.mkdirSync(dir, { recursive: true });
  const old_key = 'fetch-scheduledcourses__dept=INFO&week=40&work_copy=0&year=2021';
  const static_key = 'rooms-all__dept=INFO';
  const write = (key, endpoint, params) => fs.writeFileSync(path.join(dir, `${key}.json`),
    JSON.stringify({ key, endpoint, params, fetchedAt: new Date().toISOString(), body: [] }));
  write(old_key, COURSES, { dept: 'INFO', week: 40, year: 2021, work_copy: 0 });
  write(static_key, '/fr/api/rooms/all/', { dept: 'INFO' });
  store.CONFIG.disableRefresh = true;
  try {
    store.start();
    assert.equal(fs.existsSync(path.join(dir, `${old_key}.json`)), false, 'semaine de 2021 supprimee');
    assert.equal(fs.existsSync(path.join(dir, `${static_key}.json`)), true, 'statique conserve');
    assert.ok(store.entries('/fr/api/rooms/all/').some(e => e.key === static_key));
    assert.ok(!store.entries(COURSES).some(e => e.key === old_key));
  } finally { fs.rmSync(path.join(dir, `${static_key}.json`), { force: true }); fs.rmSync(path.join(dir, `${old_key}.json`), { force: true }); }
});

test('refreshCourses : au demarrage, seules les semaines absentes ou perimees sont demandees (KF10088)', async () => {
  const saved_depts = store.CONFIG.depts;
  store.CONFIG.depts = ['INFO'];
  const restore = fakeUpstream((req, cb) => {
    const res = fakeResponse();
    setImmediate(() => { cb(res); res.emit('data', Buffer.from('[]')); res.complete = true; res.emit('end'); res.emit('close'); });
  });
  try {
    const total = store.weeksToMaintain().length;
    let before = fakeUpstream.calls;
    await store.refreshCourses({ only_outdated: true });
    assert.ok(fakeUpstream.calls - before > 0, 'les semaines absentes sont demandees');
    before = fakeUpstream.calls;
    await store.refreshCourses({ only_outdated: true });
    assert.equal(fakeUpstream.calls - before, 0, 'store a jour : aucun appel au demarrage');
    before = fakeUpstream.calls;
    await store.refreshCourses();
    assert.equal(fakeUpstream.calls - before, total, 'la passe periodique reste complete');
  } finally { store.CONFIG.depts = saved_depts; restore(); }
});

test('fetchUpstream : reponse tronquee apres les en-tetes -> rejet, file liberee (KF40055)', async () => {
  const restore = fakeUpstream((req, cb) => {
    const res = fakeResponse();
    // Content-Length jamais atteint : la connexion se ferme sans 'end'
    setImmediate(() => { cb(res); res.emit('data', Buffer.from('[{"a":')); res.emit('close'); });
  });
  try {
    await assert.rejects(store.refresh(TREE, { dept: 'RT' }), /tronquee/);
    assert.equal(store.status().queue.inFlight, 0, 'drain ne reste pas bloque');
    await assertPendingPurged(TREE, { dept: 'RT' });
  } finally { restore(); }
});

test('fetchUpstream : reponse au goutte-a-goutte -> borne sur la duree totale (KF40055)', async () => {
  const saved = store.CONFIG.upstreamTimeout;
  store.CONFIG.upstreamTimeout = 40; // duree totale max = 80 ms
  let timer;
  const restore = fakeUpstream((req, cb) => {
    const res = fakeResponse();
    const original_destroy = req.destroy;
    req.destroy = err => { clearInterval(timer); original_destroy(err); };
    setImmediate(() => {
      cb(res);
      // un octet toutes les 10 ms : jamais d'inactivite, jamais de fin
      timer = setInterval(() => res.emit('data', Buffer.from('[')), 10);
    });
  });
  try {
    await assert.rejects(store.refresh(TREE, { dept: 'CS' }), /Duree maximale/);
    assert.equal(store.status().queue.inFlight, 0);
    clearInterval(timer);
    await assertPendingPurged(TREE, { dept: 'CS' });
  } finally { clearInterval(timer); store.CONFIG.upstreamTimeout = saved; restore(); }
});
