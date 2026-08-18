/* ══════════════════════════════════════════════════
   CONFIG.JS — Constantes globales de l'application
   ══════════════════════════════════════════════════ */

// ── API ──
const API_BASE = 'https://flopedt.iut-blagnac.fr';

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

// ── Groupes fallback (clés promo = valeurs réelles de l'API) ──
const GROUPS = {
  INFO: {
    BUT1: ['1A','1B','2A','2B','3A','3B','4A','4B'],
    BUT2: ['1A','1B','2A','2B','3A','3B'],
    BUT3: ['3A','3B'],
  },
  RT: {
    RT1: ['1A','1B','2A','2B','3A','3B'],
    RT2: ['1A','1B','2A','2B'],
    RT3: ['1'],
  },
  CS: {
    CS1: ['1GA','1GB1','1GB2','1GC'],
    CS2: ['2GA','2GB','2GC','2GD'],
    CS3: ['3A','3B'],
  },
  GIM: {
    GIM1: ['1A','1B','1C','1D'],
    GIM2: ['2A','2B','2C','2D'],
    GIM3: ['3A','3B'],
  },
};
