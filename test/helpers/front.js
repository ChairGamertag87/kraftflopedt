'use strict';
// Charge les scripts du navigateur (js/*.js, sans module) dans un contexte
// isole et renvoie ses globales : les fonctions declarees en haut de fichier
// deviennent des proprietes du contexte, comme dans une page.
const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.join(__dirname, '..', '..');

function loadFront(files, extra = {}) {
  const sandbox = {
    console,
    document:     { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] },
    window:       {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {}, key: () => null, length: 0 },
    state:        {},
    ...extra,
  };
  sandbox.window = sandbox;
  const ctx = vm.createContext(sandbox);
  for (const f of files) {
    const code = fs.readFileSync(path.join(ROOT, 'js', f), 'utf8');
    vm.runInContext(code, ctx, { filename: `js/${f}` });
  }
  return ctx;
}

// Les tableaux et objets crees dans le contexte isole ont d autres prototypes
// que ceux du test : deepStrictEqual les refuse. On compare des copies simples.
const plain = v => JSON.parse(JSON.stringify(v));

module.exports = { loadFront, plain };
