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
  const lock = next.classList.contains('screen-no-scroll');
  document.documentElement.style.overflowY = lock ? 'hidden' : '';
  document.body.style.overflowY = lock ? 'hidden' : '';
  window.scrollTo(0, 0);
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

// -------- PHOTO PREVIEW MODAL --------
// src: מקור התמונה; onReplace: callback לפתיחת picker; onDelete: callback למחיקה
export function openPhotoModal(src, onReplace, onDelete) {
  document.getElementById('_photo-modal')?.remove();
  const ov = document.createElement('div');
  ov.id = '_photo-modal';
  ov.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.88);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:28px;';
  ov.innerHTML = `
    <img src="${src}" style="width:210px;height:210px;border-radius:50%;object-fit:cover;border:4px solid white;box-shadow:0 8px 40px rgba(0,0,0,0.4);">
    <div style="display:flex;gap:16px;">
      <button id="_pm-replace" style="padding:13px 26px;border-radius:14px;border:none;background:#7C3AED;color:white;font-size:1rem;font-weight:800;cursor:pointer;font-family:inherit;">📷 החלף</button>
      <button id="_pm-delete"  style="padding:13px 26px;border-radius:14px;border:none;background:#FEE2E2;color:#DC2626;font-size:1rem;font-weight:800;cursor:pointer;font-family:inherit;">🗑️ מחק</button>
    </div>
    <button id="_pm-close" style="color:rgba(255,255,255,0.65);background:none;border:none;font-size:0.95rem;cursor:pointer;padding:8px;">✕ סגור</button>`;
  const close = () => ov.remove();
  ov.addEventListener('click', e => { if (e.target === ov) close(); });
  ov.querySelector('#_pm-close').onclick    = close;
  ov.querySelector('#_pm-replace').onclick  = () => { close(); onReplace(); };
  ov.querySelector('#_pm-delete').onclick   = () => { close(); onDelete(); };
  document.body.appendChild(ov);
}
