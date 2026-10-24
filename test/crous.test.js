'use strict';
process.env.DATA_DIR = require('os').tmpdir() + '/kraftflopedt-test-crous';
const test = require('node:test');
const assert = require('node:assert/strict');
const crous = require('../crous');

const MENU_HTML = `
<h2>midi</h2>
<h4>Entr&eacute;es</h4>
<ul><li>Salade de p&acirc;tes<li>&#8220;Carottes&#8221; r&acirc;p&eacute;es</ul>
<h4>PLATS DU JOUR</h4>
<ul><li>Poulet <b>r&ocirc;ti</b> &amp; frites</li><li>*sous reserve de changement</li><li>Menu non communiqu&eacute;</li></ul>
<h4>Dessert</h4>
<ul></ul>
<h2>Soir</h2>
<h4>Plat</h4>
<ul><li>Menu non communiqu&eacute;</li></ul>`;

const XML = `<?xml version="1.0"?><root>
<resto id="r001"><menu date="2026-09-29"><![CDATA[<h4>Plat</h4><ul><li>Autre resto</li></ul>]]></menu></resto>
<resto id="r674" title="RU Blagnac">
<menu date="2026-09-30"><![CDATA[${MENU_HTML}]]></menu>
<menu date="2026-09-29">&lt;h4&gt;Plat&lt;/h4&gt;&lt;ul&gt;&lt;li&gt;Lasagnes&lt;/li&gt;&lt;/ul&gt;</menu>
<menu date="2026-10-01"><![CDATA[<h4>Plat</h4><ul><li>*rien</li></ul>]]></menu>
</menu></resto>
<resto id="r999"/>
</root>`;

test('parseMenuHtml : services, categories, plats nettoyes, bruit retire', () => {
  const services = crous.parseMenuHtml(MENU_HTML);
  assert.equal(services.length, 1, 'le service du soir ne contient que du bruit');
  const midi = services[0];
  assert.equal(midi.moment, 'midi');
  assert.deepEqual(midi.categories.map(c => c.libelle), ['Entrées', 'Plats du jour']);
  assert.deepEqual(midi.categories[0].plats, ['Salade de pâtes', '“Carottes” râpées']);
  assert.deepEqual(midi.categories[1].plats, ['Poulet rôti & frites']);
});

test('parseMenuHtml : plats sans service ni categorie rattaches a midi / Menu', () => {
  const s = crous.parseMenuHtml('<ul><li>Steak</li><li>Frites</li></ul>');
  assert.deepEqual(s, [{ moment: 'midi', categories: [{ libelle: 'Menu', plats: ['Steak', 'Frites'] }] }]);
  assert.deepEqual(crous.parseMenuHtml(''), []);
  assert.deepEqual(crous.parseMenuHtml('<h2>midi</h2><h4>Entrees</h4>'), []);
});

test('parseMenuHtml : un avis de fermeture sans plat est conserve comme notice du service (KF30060)', () => {
  const closed = '<h2>midi</h2><h4>Structure ferm&eacute;e du Lundi 26 Octobre 2026 au Vendredi 30 Octobre 2026</h4>';
  assert.deepEqual(crous.parseMenuHtml(closed), [{
    moment: 'midi', categories: [],
    notice: 'Structure fermée du Lundi 26 Octobre 2026 au Vendredi 30 Octobre 2026',
  }]);
  // un service qui sert des plats ne porte jamais de notice, meme si un h4 matche
  const open = crous.parseMenuHtml('<h2>midi</h2><h4>Plats clos</h4><ul><li>Lasagnes</li></ul><h4>Cafeteria ferm&eacute;e</h4>');
  assert.deepEqual(open, [{ moment: 'midi', categories: [{ libelle: 'Plats clos', plats: ['Lasagnes'] }] }]);
  // mots entiers seulement : un produit fermier dans une categorie vide n'est pas une fermeture
  assert.deepEqual(crous.parseMenuHtml('<h2>midi</h2><h4>Poulet fermier</h4><ul></ul>'), []);
  assert.deepEqual(crous.parseMenuHtml('<h4>La Closerie</h4>'), []);
  assert.equal(crous.parseMenuHtml('<h4>Fermeture exceptionnelle</h4>')[0].notice, 'Fermeture exceptionnelle');
  assert.equal(crous.parseMenuHtml('<h4>RU clos</h4>')[0].notice, 'RU clos');
  // la journee fermee est gardee par parseFeed, triee avec les autres
  const xml = `<root><resto id="r674"><menu date="2026-10-26"><![CDATA[${closed}]]></menu>` +
    `<menu date="2026-10-23"><![CDATA[<h4>Plat</h4><ul><li>Poulet</li></ul>]]></menu></resto></root>`;
  const { days } = crous.parseFeed(xml, 'r674');
  assert.deepEqual(days.map(d => d.date), ['2026-10-23', '2026-10-26']);
  assert.match(days[1].services[0].notice, /^Structure fermée/);
});

test('parseMenuHtml : entites numeriques hors plage ne plantent pas', () => {
  const s = crous.parseMenuHtml('<ul><li>Plat &#1114112; &#xD800; &#0; &#233;</li></ul>');
  assert.equal(s[0].categories[0].plats[0], 'Plat &#1114112; &#xD800; &#0; é');
});

test('parseFeed : restaurant trouve, journees triees, CDATA et HTML echappe acceptes', () => {
  const { found, days } = crous.parseFeed(XML, 'r674');
  assert.equal(found, true);
  assert.deepEqual(days.map(d => d.date), ['2026-09-29', '2026-09-30'], 'la journee sans plat est ecartee');
  assert.deepEqual(days[0].services[0].categories[0].plats, ['Lasagnes']);
  assert.equal(days[1].services[0].categories.length, 2);
});

test('parseFeed : l attribut id peut ne pas etre le premier (KF10093)', () => {
  const xml = '<root><resto title="RU Blagnac" id="r674"><menu date="2026-09-30"><![CDATA[<h4>Plat</h4><ul><li>Riz</li></ul>]]></menu></resto>'
    + '<resto title="x" id="r999"/></root>';
  const { found, days } = crous.parseFeed(xml, 'r674');
  assert.equal(found, true);
  assert.deepEqual(days.map(d => d.date), ['2026-09-30']);
  assert.deepEqual(crous.parseFeed(xml, 'r999'), { found: true, days: [] });
  assert.deepEqual(crous.parseFeed(xml, 'r67'), { found: false, days: [] }, 'pas de correspondance partielle');
});

test('parseFeed : restaurant absent ou vide', () => {
  assert.deepEqual(crous.parseFeed(XML, 'r123'), { found: false, days: [] });
  assert.deepEqual(crous.parseFeed(XML, 'r999'), { found: true, days: [] });
  assert.deepEqual(crous.parseFeed('', 'r674'), { found: false, days: [] });
});

test('getMenus : copie locale sans jour a venir et flux injoignable -> repli CROUStillant (KF20072)', async () => {
  const fs = require('fs'), path = require('path'), http = require('http'), https = require('https');
  const { EventEmitter } = require('events');
  const dir = crous.CONFIG.dataDir;
  fs.mkdirSync(dir, { recursive: true });
  // copie locale du 1er octobre : le flux ne contient que des jours de septembre
  fs.writeFileSync(path.join(dir, `menu-${crous.CONFIG.region}.xml`), XML);
  fs.writeFileSync(path.join(dir, `menu-${crous.CONFIG.region}.meta.json`), JSON.stringify({ fetchedAt: '2026-10-01T00:00:00.000Z' }));
  const orig_http = http.get, orig_https = https.get;
  const fakeReq = () => { const req = new EventEmitter(); req.setTimeout = () => {}; return req; };
  http.get = () => { const req = fakeReq(); setImmediate(() => req.emit('error', new Error('ENETUNREACH'))); return req; };
  const fallback_paths = [];
  https.get = (opts, cb) => {
    fallback_paths.push(opts.path);
    const req = fakeReq();
    setImmediate(() => {
      const res = new EventEmitter(); res.statusCode = 200; cb(res);
      res.emit('data', Buffer.from(JSON.stringify({ data: { repas: [{ type: 'midi', categories: [{ libelle: 'Plat', plats: [{ libelle: 'Tartiflette' }] }] }] } })));
      res.emit('end');
    });
    return req;
  };
  try {
    crous.start();                                   // recharge la copie, le flux echoue
    await new Promise(r => setTimeout(r, 30));
    const out = await crous.getMenus('2026-10-24');
    assert.equal(out.source, 'croustillant');
    assert.ok(fallback_paths.length > 0, 'le repli a ete appele');
    assert.ok(out.days.length > 0);
    assert.equal(out.days[0].services[0].categories[0].plats[0], 'Tartiflette');
    // avec un jour a venir dans la copie locale, pas de repli : derniere version servie
    const before = fallback_paths.length;
    const kept = await crous.getMenus('2026-09-30');
    assert.equal(kept.source, 'cnous');
    assert.equal(kept.stale, true);
    assert.equal(fallback_paths.length, before);
  } finally {
    http.get = orig_http; https.get = orig_https;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('RESTAURANT et CONFIG : Blagnac, region toulouse', () => {
  assert.equal(crous.CONFIG.region, 'toulouse');
  assert.equal(crous.RESTAURANT.id, 'r674');
});
