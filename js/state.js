/* ══════════════════════════════════════════════════
   STATE.JS — État global de l'application
   ══════════════════════════════════════════════════ */

const state = {
  currentWeek: getISOWeek(new Date()),
  currentYear: getISOWeekYear(new Date()),
  groupTree:   [],   // arbre des groupes chargé depuis l'API tree
  // Sélection à restaurer au chargement (URL ou localStorage), consommée
  // dès que les chips promo/groupe correspondants existent.
  wanted:      null, // { promo, group } ou null
};
