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

// -------- TOAST (כוכבים או הודעה חופשית) --------
// pts: מספר כוכבים | message: הודעה חופשית | color: צבע הילד
export function showToast({ pts, message, color = '#6366F1' } = {}) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.innerHTML = message
    ? message
    : `כל הכבוד! 🎉<br><span style="font-size:1.2rem">+${starsText(pts)}</span>`;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2000);

  if (typeof confetti === 'function') {
    const colors = [color, '#FCD34D', '#10B981', '#EC4899', '#3B82F6'];
    confetti({ particleCount: 80, spread: 70, origin: { y: 0.6 }, colors });
    setTimeout(() => confetti({ particleCount: 50, angle: 60,  spread: 55, origin: { x: 0, y: 0.65 }, colors }), 200);
    setTimeout(() => confetti({ particleCount: 50, angle: 120, spread: 55, origin: { x: 1, y: 0.65 }, colors }), 400);
  }
}

// -------- CONFIRM MODAL --------
export function showConfirm({ icon, title, message, confirmText, confirmClass, onConfirm }) {
  const ov = document.createElement('div'); ov.className = 'modal-overlay';
  const sh = document.createElement('div'); sh.className = 'modal-sheet';
  sh.innerHTML = `
    <div class="modal-handle"></div>
    <div class="confirm-body">
      <div class="confirm-icon">${icon}</div>
      <div class="confirm-title">${title}</div>
      <div class="confirm-msg">${message}</div>
      <div class="confirm-btns">
        <button class="confirm-btn confirm-btn-cancel">ביטול</button>
        <button class="confirm-btn ${confirmClass || 'confirm-btn-danger'}">${confirmText}</button>
      </div>
    </div>`;
  sh.querySelector('.confirm-btn-cancel').onclick = () => ov.remove();
  sh.querySelector(`.${confirmClass || 'confirm-btn-danger'}`).onclick = () => { ov.remove(); onConfirm(); };
  ov.onclick = e => { if (e.target === ov) ov.remove(); };
  ov.appendChild(sh);
  document.body.appendChild(ov);
}

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
