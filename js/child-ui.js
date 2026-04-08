// =========== child-ui.js ===========
// כלי UI כלליים — ללא תלות ב-state או Firebase.
// כל הפונקציות ניתנות לייבוא ושימוש בכל מודול אחר.

// -------- STARS --------
export function starsText(n) {
  return '⭐'.repeat(Math.min(Math.max(n || 0, 0), 5));
}

// -------- SCREEN TRANSITIONS --------
export function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active', 'visible'));
  const next = document.getElementById(id);
  if (!next) return;
  next.classList.add('active');
  requestAnimationFrame(() => requestAnimationFrame(() => next.classList.add('visible')));
}


// -------- TOAST & CONFIRM — re-export זמני מ-ui.js עד לבניית גרסה חדשה --------
export { showToast, showConfirm } from './ui.js';

// -------- GENERIC MODAL SHELL --------
// מחזיר את ה-body div להכנסת תוכן
export function makeModal(title) {
  const ov = document.createElement('div'); ov.className = 'modal-overlay';
  const sh = document.createElement('div'); sh.className = 'modal-sheet';
  sh.innerHTML = `
    <div class="modal-handle"></div>
    <div class="modal-header">
      <h2>${title}</h2>
      <button class="modal-close">✕</button>
    </div>
    <div class="modal-body"></div>`;
  sh.querySelector('.modal-close').onclick = () => ov.remove();
  ov.onclick = e => { if (e.target === ov) ov.remove(); };
  ov.appendChild(sh);
  document.body.appendChild(ov);
  return sh.querySelector('.modal-body');
}

// -------- CLOSE ALL MODALS --------
export function closeModals() {
  document.querySelectorAll('.modal-overlay').forEach(m => m.remove());
}
