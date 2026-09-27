/* ══════════════════════════════════════════════════
   ICAL.JS — Abonnement agenda (flux iCalendar servi par l'adapter)
     /ical/<dept>/<promo>[/<groupe>].ics
     /ical/prof/<dept>/<initiales>.ics
   ══════════════════════════════════════════════════ */

function icalPathFor(dept, promo, group) {
  const enc = encodeURIComponent;
  return `/ical/${enc(dept)}/${enc(promo)}${group ? '/' + enc(group) : ''}.ics`;
}

function icalPathForTutor(dept, tutor) {
  return `/ical/prof/${encodeURIComponent(dept)}/${encodeURIComponent(tutor)}.ics`;
}

/** Remplit le panneau avec un chemin /ical/... et un libellé. */
function fillIcalPanel(path, label) {
  const https  = `${location.origin}${path}`;
  const webcal = https.replace(/^https?:/, 'webcal:');
  const google = `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`;

  document.getElementById('ical-desc').textContent = `Emploi du temps ${label}, mis à jour automatiquement dans ton application d'agenda.`;
  document.getElementById('ical-url').value        = https;
  document.getElementById('ical-webcal').href      = webcal;
  document.getElementById('ical-google').href      = google;
  document.getElementById('ical-download').href    = https;
  document.getElementById('ical-copy').textContent = 'Copier';
  document.getElementById('ical-body').hidden      = false;
  document.getElementById('ical-empty').hidden     = true;
}

function openIcal() {
  const dept  = getSelectedDept();
  const promo = getSelectedPromo();
  const group = getSelectedGroup();

  if (!dept || !promo) {
    document.getElementById('ical-body').hidden  = true;
    document.getElementById('ical-empty').hidden = false;
  } else {
    fillIcalPanel(icalPathFor(dept, promo, group), [dept, promo, group].filter(Boolean).join(' · '));
  }

  document.getElementById('ical-overlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}

/**
 * @param {string} tutor  initiales FlOpEDT
 * @param {string} [dept] departement des cours du prof (defaut : celui de l'EDT affiche)
 */
function openIcalTutor(tutor, dept) {
  dept = dept || getSelectedDept() || 'INFO';
  closeTutors();
  fillIcalPanel(icalPathForTutor(dept, tutor), `de ${tutor} (${dept})`);
  document.getElementById('ical-overlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeIcal() {
  document.getElementById('ical-overlay').classList.remove('open');
  document.body.style.overflow = '';
}

function closeIcalOutside(e) {
  if (e.target === document.getElementById('ical-overlay')) closeIcal();
}

async function copyIcalUrl() {
  const input = document.getElementById('ical-url');
  const btn   = document.getElementById('ical-copy');
  let ok = false;
  try {
    await navigator.clipboard.writeText(input.value);
    ok = true;
  } catch (_) {
    input.focus();
    input.select();
    try { ok = document.execCommand('copy'); } catch (_) { /* ignore */ }
  }
  btn.textContent = ok ? 'Copié ✓' : 'Sélectionné';
  setTimeout(() => { btn.textContent = 'Copier'; }, 1800);
}
