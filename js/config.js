/* ══════════════════════════════════════════════════
   CONFIG.JS — Constantes globales de l'application
   ══════════════════════════════════════════════════ */

// ── Grille horaire ──
// Bornes calées sur les vrais créneaux de l'IUT de Blagnac
// start_time dans l'API = minutes depuis minuit (480=8h, 570=9h30...)
const SLOT_MIN = 8;    // 8h00
const SLOT_MAX = 19;   // 19h00
const SLOT_H   = 44;   // hauteur px par créneau de 30 min
const SLOTS    = (SLOT_MAX - SLOT_MIN) * 2; // 22 créneaux

// ── Jours ──
const DAYS       = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi'];
const DAYS_SHORT = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven'];

// ── Groupes de secours (si l'arbre FlOpEDT ne charge pas) ──
// Cles promo = valeurs reelles du champ promo de l'arbre, groupes = feuilles.
// Releve le 22 sept 2026 sur /fr/api/groups/structural/tree/ pour chaque dept.
// L'ancien repli RT declarait RT1/RT2/RT3 : un etudiant RT ne pouvait choisir
// aucune promo reelle quand l'arbre echouait.
const GROUPS = {
  INFO: {
    BUT1: ['1A','1B','2A','2B','3A','3B','4A','4B'],
    BUT2: ['1A','1B','2A','2B','3A'],
    BUT3: ['1A','1B','2A','3A'],
  },
  RT: {
    BUT1:  ['1A','1B','1C','1D','1E','1F'],
    BUT2:  ['2A','2B','2C'],
    BUT2A: ['2Aa'],
    BUT3:  ['3A','3B'],
    BUT3A: ['3Aa','3Ba'],
  },
  CS: {
    CS1: ['1GA','1GB1','1GB2','1GC'],
    CS2: ['2G1','2G2'],
    CS3: ['3FA1','3FA2','3FI'],
  },
  GIM: {
    GIM1: ['1A','1B','1C','1D'],
    GIM2: ['2A','2B','2C','2D'],
    GIM3: ['3A','3B','3C'],
  },
};
