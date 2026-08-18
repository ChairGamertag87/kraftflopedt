/* ══════════════════════════════════════════════════
   MAIN.JS — Point d'entrée & initialisation
   ══════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {
  updateWeekLabel();

  // Affiche les groupes immédiatement depuis la config locale
  refreshGroupsFallback();

  // Tente d'enrichir avec l'arbre API en arrière-plan
  loadGroupsFromAPI();

  // Ferme les modaux au raccourci Escape
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      closeDetail();
      closeSelector();
      closeRooms();
    }
  });
});
