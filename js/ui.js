// =========== SCREEN NAVIGATION ===========
export function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => { s.classList.remove('active','visible'); });
  const next = document.getElementById(id);
  next.classList.add('active');
  requestAnimationFrame(() => requestAnimationFrame(() => next.classList.add('visible')));
  window.scrollTo(0, 0);
}

// =========== TOAST ===========
export function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2000);
}

// =========== FIELD HIGHLIGHT ===========
export function highlightField(el) {
  if (!el) return;
  el.classList.add('field-error');
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  if (navigator.vibrate) navigator.vibrate(100);
  setTimeout(() => el.classList.remove('field-error'), 1500);
}

// =========== LOADING ===========
let loadingTimer = null;

export function showLoading(msg) {
  hideLoading();
  const ov = document.createElement('div');
  ov.className = 'loading-overlay';
  ov.id = 'global-loading';
  ov.innerHTML = `<div class="loading-box">
    <div class="spinner-lg"></div>
    <p style="font-weight:700;font-size:0.95rem;">${msg || 'טוען...'}</p>
  </div>`;
  document.body.appendChild(ov);
  loadingTimer = setTimeout(() => hideLoading(), 8000);
}

export function hideLoading() {
  if (loadingTimer) { clearTimeout(loadingTimer); loadingTimer = null; }
  document.querySelectorAll('.loading-overlay').forEach(el => el.remove());
}

// =========== CONFIRM MODAL ===========
export function showConfirm({ icon = '⚠️', title, message, confirmText = 'אישור', confirmColor = 'linear-gradient(135deg,#EF4444,#DC2626)', onConfirm }) {
  const ov = document.createElement('div');
  ov.className = 'modal-overlay';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.65);display:flex;align-items:center;justify-content:center;z-index:2000;animation:fadeIn 0.2s ease;';
  ov.innerHTML = `
    <div style="background:#fff;border-radius:24px;width:88%;max-width:380px;text-align:center;animation:modalPop 0.25s cubic-bezier(.4,0,.2,1);">
      <div style="width:44px;height:5px;background:#E2E8F0;border-radius:3px;margin:14px auto 0;"></div>
      <div style="padding:24px 24px 28px;">
        <div style="font-size:2.6rem;margin-bottom:10px;">${icon}</div>
        <div style="font-size:1.05rem;font-weight:800;margin-bottom:6px;color:#1E293B;">${title}</div>
        ${message ? `<div style="font-size:0.88rem;color:#94A3B8;margin-bottom:22px;line-height:1.5;">${message}</div>` : '<div style="margin-bottom:22px;"></div>'}
        <div style="display:flex;gap:10px;">
          <button data-act="cancel" style="flex:1;padding:14px;background:#F1F5F9;border:none;border-radius:14px;font-size:1rem;font-weight:700;cursor:pointer;font-family:'Heebo',sans-serif;color:#1E293B;">ביטול</button>
          <button data-act="confirm" style="flex:1;padding:14px;background:${confirmColor};color:white;border:none;border-radius:14px;font-size:1rem;font-weight:700;cursor:pointer;font-family:'Heebo',sans-serif;">${confirmText}</button>
        </div>
      </div>
    </div>`;
  ov.querySelector('[data-act="cancel"]').onclick = () => ov.remove();
  ov.querySelector('[data-act="confirm"]').onclick = () => { ov.remove(); onConfirm(); };
  ov.onclick = e => { if (e.target === ov) ov.remove(); };
  document.body.appendChild(ov);
}

// =========== SIDE MENU ===========
export function openSideMenu({ auth, onAction }) {
  closeSideMenu();

  const overlay = document.createElement('div');
  overlay.className = 'side-overlay';
  overlay.id = 'side-overlay';
  overlay.onclick = closeSideMenu;

  const menu = document.createElement('div');
  menu.className = 'side-menu';
  menu.id = 'side-menu';

  const parentName = auth.currentUser?.displayName?.split(' ')[0] || 'הורה';

  menu.innerHTML = `
    <div class="side-header">
      <div class="side-settings-icon" id="side-settings-close">⚙️</div>
      <div class="side-header-text">
        <h3>תפריט</h3>
        <p>שלום ${parentName}</p>
      </div>
    </div>
    <div class="side-item" data-action="manage-family">
      <div class="side-icon" style="background:linear-gradient(135deg,#FEF3C7,#FDE68A);">👨‍👩‍👧‍👦</div>
      <span class="side-item-text">ניהול משפחה</span>
    </div>
    <div class="side-item" data-action="add-tasks">
      <div class="side-icon" style="background:linear-gradient(135deg,#D1FAE5,#A7F3D0);">📋</div>
      <span class="side-item-text">הוספת מטלות</span>
    </div>
    <div class="side-item" data-action="edit-tasks">
      <div class="side-icon" style="background:linear-gradient(135deg,#E0E7FF,#C7D2FE);">✏️</div>
      <span class="side-item-text">עריכת מטלות</span>
    </div>
    <div class="side-item" data-action="add-prizes">
      <div class="side-icon" style="background:linear-gradient(135deg,#FCE7F3,#FBCFE8);">🎁</div>
      <span class="side-item-text">הוספת פרסים</span>
    </div>
    <div class="side-item" data-action="manage-prizes">
      <div class="side-icon" style="background:linear-gradient(135deg,#FEF3C7,#FDE68A);">🏆</div>
      <span class="side-item-text">ניהול פרסים</span>
    </div>
    <div class="side-item" data-action="manage-points">
      <div class="side-icon" style="background:linear-gradient(135deg,#CCFBF1,#99F6E4);">⭐</div>
      <span class="side-item-text">ניהול ניקוד ומטלות</span>
    </div>
    <div class="side-item" data-action="replay-tour">
      <div class="side-icon" style="background:linear-gradient(135deg,#EDE9FE,#DDD6FE);">🧭</div>
      <span class="side-item-text">סיור מודרך</span>
    </div>
    <div class="side-item" data-action="contact">
      <div class="side-icon" style="background:linear-gradient(135deg,#E0F2FE,#BAE6FD);">✉️</div>
      <span class="side-item-text">צור קשר</span>
    </div>
    <div class="side-item" data-action="terms">
      <div class="side-icon" style="background:linear-gradient(135deg,#F0FDF4,#DCFCE7);">📄</div>
      <span class="side-item-text">תנאי שימוש</span>
    </div>
    <div class="side-item danger" data-action="logout">
      <div class="side-icon" style="background:linear-gradient(135deg,#FEE2E2,#FECACA);">🚪</div>
      <span class="side-item-text">התנתק</span>
    </div>
  `;

  menu.querySelectorAll('.side-item').forEach(item => {
    item.onclick = () => {
      closeSideMenu();
      onAction(item.dataset.action);
    };
  });

  document.body.appendChild(overlay);
  document.body.appendChild(menu);

  document.getElementById('side-settings-close').onclick = closeSideMenu;

  // Swipe to close
  let swStartX = 0, swCurrentX = 0, swSwiping = false;

  function handleSwipeStart(e) {
    swStartX = e.touches[0].clientX;
    swCurrentX = 0;
    swSwiping = true;
    menu.style.transition = 'none';
  }
  function handleSwipeMove(e) {
    if (!swSwiping) return;
    swCurrentX = Math.max(0, e.touches[0].clientX - swStartX);
    menu.style.transform = `translateX(${swCurrentX}px)`;
  }
  function handleSwipeEnd() {
    swSwiping = false;
    if (swCurrentX > 80) {
      menu.style.transition = 'transform 0.2s ease';
      menu.style.transform = 'translateX(100%)';
      setTimeout(closeSideMenu, 200);
    } else {
      menu.style.transition = 'transform 0.2s ease';
      menu.style.transform = 'translateX(0)';
    }
  }

  menu.addEventListener('touchstart', handleSwipeStart, { passive: true });
  menu.addEventListener('touchmove', handleSwipeMove, { passive: true });
  menu.addEventListener('touchend', handleSwipeEnd);

  overlay.addEventListener('touchstart', handleSwipeStart, { passive: true });
  overlay.addEventListener('touchmove', (e) => {
    if (!swSwiping) return;
    swCurrentX = Math.max(0, e.touches[0].clientX - swStartX);
    menu.style.transition = 'none';
    menu.style.transform = `translateX(${swCurrentX}px)`;
  }, { passive: true });
  overlay.addEventListener('touchend', handleSwipeEnd);
}

export function closeSideMenu() {
  document.getElementById('side-overlay')?.remove();
  document.getElementById('side-menu')?.remove();
}
