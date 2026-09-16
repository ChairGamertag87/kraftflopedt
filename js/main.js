/* ══════════════════════════════════════════════════
   MAIN.JS — Point d'entrée & initialisation
   ══════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {
  updateWeekLabel();

  // Restaure dept/promo/groupe depuis l'URL ou la dernière visite
  restoreSelection();

  // Affiche les groupes immédiatement depuis la config locale
  // (charge l'EDT tout de suite si la sélection restaurée y figure)
  refreshGroupsFallback();

  // Tente d'enrichir avec l'arbre API en arrière-plan
  loadGroupsFromAPI();

  // Ferme les modaux au raccourci Escape
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      closeDetail();
      closeSelector();
      closeRooms();
      closeTutors();
      closeIcal();
    }
  });
});
