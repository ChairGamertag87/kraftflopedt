/* ══════════════════════════════════════════════════
   STATE.JS — État global de l'application
   ══════════════════════════════════════════════════ */

const state = {
  currentWeek: getISOWeek(new Date()),
  currentYear: new Date().getFullYear(),
  groupTree:   [],   // arbre des groupes chargé depuis l'API tree
};
