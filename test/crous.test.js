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

test('parseFeed : restaurant absent ou vide', () => {
  assert.deepEqual(crous.parseFeed(XML, 'r123'), { found: false, days: [] });
  assert.deepEqual(crous.parseFeed(XML, 'r999'), { found: true, days: [] });
  assert.deepEqual(crous.parseFeed('', 'r674'), { found: false, days: [] });
});

test('RESTAURANT et CONFIG : Blagnac, region toulouse', () => {
  assert.equal(crous.CONFIG.region, 'toulouse');
  assert.equal(crous.RESTAURANT.id, 'r674');
});
