// =========== child-onboarding.js ===========
// אונבורדינג לילד בפעם הראשונה בלבד.
// startOnboarding(db, renderChildFn) — קורא מ-child.js כשchildData.onboarded !== true

import { doc, updateDoc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { state } from './child-state.js';
import { cropAndCompressPhoto } from './ui.js';
import { SPLAT_SVG } from './icons.js';

// -------- CONSTANTS --------
const ONBOARD_EMOJIS = [
  '🦁','🐱','🦄','🐶','🐸','🦊','🐼','🦋','🌟','🎈',
  '🐯','🐰','🦜','🐻','🎀','🚀','⚽','🎸','🌈','🧸',
  '🐬','🦕','🐝','🍀',
];
const ONBOARD_COLORS = [
  '#EF4444','#F59E0B','#10B981','#3B82F6','#8B5CF6',
  '#EC4899','#06B6D4','#F97316','#84CC16','#6366F1',
];

// -------- LOCAL STATE --------
let _db = null;
let _renderChildFn = null;
let _obPhoto = null;      // base64 או null
let _obColor = '';
let _obEmoji = '';
let _currentStep = 0;     // 0=welcome, 1=photo, 2=color, 3=emoji

// -------- ENTRY POINT --------
export function startOnboarding(db, renderChildFn) {
  _db = db;
  _renderChildFn = renderChildFn;

  // קח ערכים קיימים מ-childData
  _obPhoto = state.childData?.photo || null;
  _obColor = state.childData?.color || '';
  _obEmoji = state.childData?.emoji || '';

  // צור overlay
  const overlay = document.createElement('div');
  overlay.id = 'onboarding-overlay';
  document.body.appendChild(overlay);

  // הצג שלב פתיחה
  showWelcome();
}

// -------- HELPERS --------
function getOverlay() { return document.getElementById('onboarding-overlay'); }

function animateIn(el) {
  el.style.animation = 'none';
  el.offsetHeight; // reflow
  el.style.animation = 'obCardIn 0.38s cubic-bezier(.34,1.28,.64,1)';
}

// פופאפ מגניב — מוצג מעל הכרטיסייה, נסגר לבד
function showPopup(icon, message, duration = 1600) {
  const popup = document.createElement('div');
  popup.className = 'ob-popup';
  popup.innerHTML = `<span class="ob-popup-icon">${icon}</span><span class="ob-popup-msg">${message}</span>`;
  getOverlay().appendChild(popup);
  requestAnimationFrame(() => popup.classList.add('ob-popup-show'));
  setTimeout(() => {
    popup.classList.remove('ob-popup-show');
    setTimeout(() => popup.remove(), 350);
  }, duration);
}

// נקודות התקדמות (שלבים 1-3)
function dotsHTML(active) {
  return `<div class="ob-dots">
    ${[1,2,3].map(i => `<div class="ob-dot${i === active ? ' ob-dot-active' : i < active ? ' ob-dot-done' : ''}"></div>`).join('')}
  </div>`;
}

// כפתורי ניווט
function navBtnsHTML(step) {
  if (step === 1) return `
    <button class="ob-btn ob-btn-primary" id="ob-next">המשך ←</button>`;
  if (step === 2) return `
    <div class="ob-nav-row">
      <button class="ob-btn ob-btn-ghost" id="ob-back">→ חזור</button>
      <button class="ob-btn ob-btn-primary" id="ob-next">המשך ←</button>
    </div>`;
  if (step === 3) return `
    <div class="ob-nav-row">
      <button class="ob-btn ob-btn-ghost" id="ob-back">→ חזור</button>
      <button class="ob-btn ob-btn-finish" id="ob-finish">סיום 🎉</button>
    </div>`;
  return '';
}

function attachNav(step) {
  const overlay = getOverlay();
  const nextBtn = overlay.querySelector('#ob-next');
  const backBtn = overlay.querySelector('#ob-back');
  const finBtn  = overlay.querySelector('#ob-finish');
  if (nextBtn) nextBtn.onclick = () => goToStep(step + 1);
  if (backBtn) backBtn.onclick = () => goToStep(step - 1);
  if (finBtn)  finBtn.onclick  = () => finishOnboarding();
}

function goToStep(step) {
  _currentStep = step;
  if (step === 1) showPhotoStep();
  if (step === 2) showColorStep();
  if (step === 3) showEmojiStep();
}

// -------- STEP 0: WELCOME --------
function showWelcome() {
  _currentStep = 0;
  const name   = state.childData?.name || '';
  const isFem  = state.childData?.gender === 'female';
  const overlay = getOverlay();

  overlay.innerHTML = `
    <div class="ob-backdrop">
      <div class="ob-card ob-welcome-card" id="ob-card">
        <div class="ob-welcome-emoji">🎉</div>
        <h1 class="ob-welcome-title">שלום ${name}!</h1>
        <p class="ob-welcome-sub">
          ${isFem ? 'ברוכה הבאה' : 'ברוך הבא'} לאפליקציה שלך 🌟<br>
          בוא${isFem ? 'י' : ''} נגדיר את הפרופיל שלך בכמה שלבים קצרים
        </p>
        <button class="ob-btn ob-btn-start" id="ob-start">
          <span>התחל${isFem ? 'י' : ''} 🚀</span>
        </button>
      </div>
    </div>`;

  animateIn(overlay.querySelector('#ob-card'));
  overlay.querySelector('#ob-start').onclick = () => goToStep(1);
}

// -------- STEP 1: PHOTO --------
function showPhotoStep() {
  _currentStep = 1;
  const overlay = getOverlay();
  const hasPhoto = _obPhoto && _obPhoto.length > 10;
  const isFromParent = state.childData?.photo && state.childData?.photo.length > 10 && !_obPhoto?.startsWith('data:');

  overlay.innerHTML = `
    <div class="ob-backdrop">
      <div class="ob-card" id="ob-card">
        ${dotsHTML(1)}
        <div class="ob-step-label">שלב 1 מתוך 3</div>
        <h2 class="ob-step-title">התמונה שלך 📷</h2>
        <p class="ob-step-sub">${isFromParent ? 'ההורה בחר תמונה עבורך — אפשר להחליף' : 'בחר תמונה שתייצג אותך'}</p>

        <div class="ob-photo-area">
          <div class="ob-photo-circle" id="ob-photo-circle">
            ${hasPhoto
              ? `<img id="ob-photo-img" src="${_obPhoto}" alt="תמונה">`
              : `<div class="ob-photo-placeholder">
                  <span>📷</span>
                  <small>בחר תמונה</small>
                </div>`
            }
            <input type="file" accept="image/*" id="ob-photo-input" class="ob-photo-file-input">
          </div>
          ${hasPhoto ? `<button class="ob-trash-btn" id="ob-photo-trash" title="הסר תמונה">🗑️</button>` : ''}
        </div>

        <div id="ob-photo-error" class="ob-error"></div>
        ${navBtnsHTML(1)}
      </div>
    </div>`;

  animateIn(overlay.querySelector('#ob-card'));

  // העלאת תמונה
  overlay.querySelector('#ob-photo-input').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      _obPhoto = await cropAndCompressPhoto(file);
      // עדכן תצוגה
      const circle = overlay.querySelector('#ob-photo-circle');
      circle.innerHTML = `
        <img id="ob-photo-img" src="${_obPhoto}" alt="תמונה">
        <input type="file" accept="image/*" id="ob-photo-input" class="ob-photo-file-input">`;
      // הוסף כפתור פח
      if (!overlay.querySelector('#ob-photo-trash')) {
        const trash = document.createElement('button');
        trash.className = 'ob-trash-btn'; trash.id = 'ob-photo-trash'; trash.title = 'הסר תמונה';
        trash.textContent = '🗑️';
        overlay.querySelector('.ob-photo-area').appendChild(trash);
        trash.onclick = () => clearPhoto();
      }
      // re-attach file input listener
      overlay.querySelector('#ob-photo-input').onchange = arguments.callee;
      showPopup('📸', 'תמונה נבחרה!');
    } catch {
      overlay.querySelector('#ob-photo-error').textContent = 'שגיאה בטעינת התמונה ⚠️';
    }
  };

  // כפתור פח
  const trashBtn = overlay.querySelector('#ob-photo-trash');
  if (trashBtn) trashBtn.onclick = () => clearPhoto();

  function clearPhoto() {
    _obPhoto = null;
    const circle = overlay.querySelector('#ob-photo-circle');
    circle.innerHTML = `
      <div class="ob-photo-placeholder"><span>📷</span><small>בחר תמונה</small></div>
      <input type="file" accept="image/*" id="ob-photo-input" class="ob-photo-file-input">`;
    overlay.querySelector('#ob-photo-input').onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        _obPhoto = await cropAndCompressPhoto(file);
        circle.innerHTML = `<img id="ob-photo-img" src="${_obPhoto}" alt="תמונה">
          <input type="file" accept="image/*" id="ob-photo-input" class="ob-photo-file-input">`;
        overlay.querySelector('#ob-photo-input').onchange = arguments.callee;
        let trash = overlay.querySelector('#ob-photo-trash');
        if (!trash) {
          trash = document.createElement('button');
          trash.className = 'ob-trash-btn'; trash.id = 'ob-photo-trash'; trash.title = 'הסר תמונה';
          trash.textContent = '🗑️';
          overlay.querySelector('.ob-photo-area').appendChild(trash);
        }
        trash.onclick = () => clearPhoto();
        showPopup('📸', 'תמונה נבחרה!');
      } catch {
        overlay.querySelector('#ob-photo-error').textContent = 'שגיאה בטעינת התמונה ⚠️';
      }
    };
    const t = overlay.querySelector('#ob-photo-trash');
    if (t) t.remove();
    showPopup('🗑️', 'התמונה הוסרה');
  }

  attachNav(1);
}

// -------- STEP 2: COLOR --------
function showColorStep() {
  _currentStep = 2;
  const overlay = getOverlay();

  overlay.innerHTML = `
    <div class="ob-backdrop">
      <div class="ob-card" id="ob-card">
        ${dotsHTML(2)}
        <div class="ob-step-label">שלב 2 מתוך 3</div>
        <h2 class="ob-step-title">הצבע שלך 🎨</h2>
        <p class="ob-step-sub">${_obColor ? 'הצבע שנבחר עבורך — אפשר לשנות' : 'בחר צבע שמייצג אותך'}</p>

        <div class="ob-color-preview-row">
          <div class="ob-color-preview-splat" id="ob-color-preview">
            ${_obColor ? SPLAT_SVG(_obColor, 56) : SPLAT_SVG('#E2E8F0', 56)}
          </div>
          <span class="ob-color-preview-label" id="ob-color-preview-label">
            ${_obColor ? 'הצבע שלי ✓' : 'לא נבחר עדיין'}
          </span>
        </div>

        <div class="ob-color-grid splat-color-grid">
          ${ONBOARD_COLORS.map(c => `
            <div class="ob-color-opt splat-color-opt${c === _obColor ? ' ob-color-selected splat-selected' : ''}"
              data-color="${c}">
              ${SPLAT_SVG(c, 44)}
            </div>`).join('')}
        </div>

        <div id="ob-color-error" class="ob-error"></div>
        ${navBtnsHTML(2)}
      </div>
    </div>`;

  animateIn(overlay.querySelector('#ob-card'));

      overlay.querySelectorAll('.ob-color-opt').forEach(el => {
    el.onclick = () => {
      const prev = _obColor;
      _obColor = el.dataset.color;
      overlay.querySelectorAll('.ob-color-opt').forEach(x => { x.classList.remove('ob-color-selected'); x.classList.remove('splat-selected'); });
      el.classList.add('ob-color-selected'); el.classList.add('splat-selected');
      overlay.querySelector('#ob-color-preview').innerHTML = SPLAT_SVG(_obColor, 56);
      overlay.querySelector('#ob-color-preview-label').textContent = 'הצבע שלי ✓';
      // פופאפ רק אם שינה
      if (_obColor !== prev) showPopup('🎨', 'צבע נבחר!', 1200);
    };
  });

  const nextBtn = overlay.querySelector('#ob-next');
  if (nextBtn) {
    nextBtn.onclick = () => {
      if (!_obColor) {
        overlay.querySelector('#ob-color-error').textContent = 'חובה לבחור צבע 🎨';
        return;
      }
      goToStep(3);
    };
  }
  const backBtn = overlay.querySelector('#ob-back');
  if (backBtn) backBtn.onclick = () => goToStep(1);
}

// -------- STEP 3: EMOJI --------
function showEmojiStep() {
  _currentStep = 3;
  const overlay = getOverlay();

  overlay.innerHTML = `
    <div class="ob-backdrop">
      <div class="ob-card" id="ob-card">
        ${dotsHTML(3)}
        <div class="ob-step-label">שלב 3 מתוך 3</div>
        <h2 class="ob-step-title">האימוג'י שלך 😄</h2>
        <p class="ob-step-sub">${_obEmoji ? 'האימוג\'י שנבחר עבורך — אפשר לשנות' : 'בחר אימוג\'י שמייצג אותך'}</p>

        <div class="ob-emoji-preview" id="ob-emoji-preview">
          ${_obEmoji || '?'}
        </div>

        <div class="ob-emoji-grid">
          ${ONBOARD_EMOJIS.map(e => `
            <div class="ob-emoji-opt${e === _obEmoji ? ' ob-emoji-selected' : ''}"
              data-emoji="${e}">${e}</div>`).join('')}
        </div>

        <div id="ob-emoji-error" class="ob-error"></div>
        ${navBtnsHTML(3)}
      </div>
    </div>`;

  animateIn(overlay.querySelector('#ob-card'));

  overlay.querySelectorAll('.ob-emoji-opt').forEach(el => {
    el.onclick = () => {
      const prev = _obEmoji;
      _obEmoji = el.dataset.emoji;
      overlay.querySelectorAll('.ob-emoji-opt').forEach(x => x.classList.remove('ob-emoji-selected'));
      el.classList.add('ob-emoji-selected');
      overlay.querySelector('#ob-emoji-preview').textContent = _obEmoji;
      if (_obEmoji !== prev) showPopup(_obEmoji, 'נבחר!', 1100);
    };
  });

  const finBtn = overlay.querySelector('#ob-finish');
  if (finBtn) {
    finBtn.onclick = () => {
      if (!_obEmoji) {
        overlay.querySelector('#ob-emoji-error').textContent = 'חובה לבחור אימוג\'י 😊';
        return;
      }
      if (!_obColor) { goToStep(2); return; }
      finishOnboarding();
    };
  }
  const backBtn = overlay.querySelector('#ob-back');
  if (backBtn) backBtn.onclick = () => goToStep(2);
}

// -------- FINISH --------
async function finishOnboarding() {
  const overlay = getOverlay();

  // פופאפ סיום
  const card = overlay.querySelector('#ob-card');
  if (card) {
    card.innerHTML = `
      <div class="ob-finish-body">
        <div class="ob-finish-emoji">${_obEmoji || '🎉'}</div>
        <h2 class="ob-finish-title">מוכן${state.childData?.gender === 'female' ? 'ה' : ''}! 🎉</h2>
        <p class="ob-finish-sub">הפרופיל שלך מוכן<br>בוא${state.childData?.gender === 'female' ? 'י' : ''} נתחיל לאסוף כוכבים ⭐</p>
        <div class="ob-spinner"></div>
      </div>`;
    animateIn(card);
  }

  // שמור ל-Firestore
  try {
    const updates = {
      onboarded: true,
      emoji: _obEmoji,
      color: _obColor,
    };
    if (_obPhoto && _obPhoto.length > 10)  updates.photo = _obPhoto;
    if (!_obPhoto)                          updates.photo = '';

    await updateDoc(
      doc(_db, 'families', state.familyId, 'children', state.childId),
      updates,
    );
    Object.assign(state.childData, updates);
    if (_obColor) document.documentElement.style.setProperty('--child-color', _obColor);
  } catch (e) {
    console.error('onboarding save error', e);
  }

  // מעבר לדשבורד אחרי אנימציית הסיום
  setTimeout(() => {
    overlay.style.transition = 'opacity 0.4s ease';
    overlay.style.opacity = '0';
    setTimeout(() => {
      overlay.remove();
      _renderChildFn();
      // show dashboard
      const { show } = window._childShowFn || {};
      if (show) show('screen-child');
      else document.getElementById('screen-child')?.classList.add('active','visible');
    }, 420);
  }, 1800);
}
