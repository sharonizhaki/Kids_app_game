// =========== child-onboarding.js ===========
// אונבורדינג לילד בפעם הראשונה בלבד.
// startOnboarding(db, renderChildFn) — קורא מ-child.js כשchildData.onboarded !== true

import { doc, updateDoc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { state, g } from './child-state.js';
import { cropAndCompressPhoto } from './ui.js';
import { SPLAT_SVG } from './icons.js';
import { requestPushPermission, saveChildFcmToken } from './notifications.js';

// -------- CONSTANTS --------
const ONBOARD_EMOJIS = [
  '🦁','🐱','🦄','🐶','🐸','🦊','🐼','🦋','🌟','🎈',
  '🐯','🐰','🦜','🐻','🎀','🚀','⚽','🎸','🌈','🧸',
  '🐬','🦕','🐝','🍀',
];
const ONBOARD_COLORS = [
  '#10B981','#3B82F6','#06B6D4','#8B5CF6','#EC4899','#EF4444','#F97316','#F59E0B',
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
  document.documentElement.style.overflowY = 'hidden';
  document.body.style.overflowY = 'hidden';

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
    ${[1,2,3,4].map(i => `<div class="ob-dot${i === active ? ' ob-dot-active' : i < active ? ' ob-dot-done' : ''}"></div>`).join('')}
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
      <button class="ob-btn ob-btn-primary" id="ob-next">המשך ←</button>
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
  if (step === 4) showNotifStep();
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
        <p class="ob-step-sub">${isFromParent ? 'ההורה בחר תמונה עבורך — אפשר להחליף' : g('בחר תמונה שתייצג אותך', 'בחרי תמונה שתייצג אותך')}</p>

        <div class="ob-photo-area">
          <div class="ob-photo-circle" id="ob-photo-circle">
            ${hasPhoto
              ? `<img id="ob-photo-img" src="${_obPhoto}" alt="תמונה">`
              : `<div class="ob-photo-placeholder">
                  <span>📷</span>
                  <small>${g('בחר תמונה', 'בחרי תמונה')}</small>
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

  // העלאת תמונה — named function כדי שניתן להצמיד מחדש אחרי עדכון DOM
  async function handlePhotoChange(e) {
    const file = e.target.files[0];
    if (!file) return;
    try {
      _obPhoto = await cropAndCompressPhoto(file);
      const circle = overlay.querySelector('#ob-photo-circle');
      circle.innerHTML = `
        <img id="ob-photo-img" src="${_obPhoto}" alt="תמונה">
        <input type="file" accept="image/*" id="ob-photo-input" class="ob-photo-file-input">`;
      overlay.querySelector('#ob-photo-input').onchange = handlePhotoChange;
      let trash = overlay.querySelector('#ob-photo-trash');
      if (!trash) {
        trash = document.createElement('button');
        trash.className = 'ob-trash-btn'; trash.id = 'ob-photo-trash'; trash.title = 'הסר תמונה';
        trash.textContent = '🗑️';
        overlay.querySelector('.ob-photo-area').appendChild(trash);
      }
      trash.onclick = () => clearPhoto();
      overlay.querySelector('#ob-photo-error').textContent = '';
      showPopup('📸', 'תמונה נבחרה!');
    } catch {
      overlay.querySelector('#ob-photo-error').textContent = 'שגיאה בטעינת התמונה ⚠️';
    }
  }

  overlay.querySelector('#ob-photo-input').onchange = handlePhotoChange;

  // כפתור פח
  const trashBtn = overlay.querySelector('#ob-photo-trash');
  if (trashBtn) trashBtn.onclick = () => clearPhoto();

  function clearPhoto() {
    _obPhoto = null;
    const circle = overlay.querySelector('#ob-photo-circle');
    circle.innerHTML = `
      <div class="ob-photo-placeholder"><span>📷</span><small>${g('בחר תמונה', 'בחרי תמונה')}</small></div>
      <input type="file" accept="image/*" id="ob-photo-input" class="ob-photo-file-input">`;
    overlay.querySelector('#ob-photo-input').onchange = handlePhotoChange;
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
        <p class="ob-step-sub">${_obColor ? 'הצבע שנבחר עבורך — אפשר לשנות' : g('בחר צבע שמייצג אותך', 'בחרי צבע שמייצג אותך')}</p>

        <div class="ob-color-preview-wrap">
          <div id="ob-color-preview" class="ob-color-preview-splat">
            ${_obColor ? SPLAT_SVG(_obColor, 115) : SPLAT_SVG('#94A3B8', 115, true)}
          </div>
          <span class="ob-color-preview-label" id="ob-color-preview-label">
            ${_obColor ? 'הצבע שלי ' : 'לא נבחר עדיין'}
          </span>
        </div>

        <div class="ob-color-grid splat-color-grid-ob">
          ${ONBOARD_COLORS.map(c => `
            <div class="ob-color-opt splat-color-opt${c === _obColor ? ' splat-selected' : ''}" data-color="${c}">
              ${SPLAT_SVG(c, 70)}
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
      overlay.querySelectorAll('.ob-color-opt').forEach(x => x.classList.remove('splat-selected'));
      el.classList.add('splat-selected');
      const preview = overlay.querySelector('#ob-color-preview');
      preview.style.transition = 'transform 0.25s cubic-bezier(.34,1.5,.64,1), opacity 0.15s';
      preview.style.opacity = '0'; preview.style.transform = 'scale(0.7)';
      setTimeout(() => {
        preview.innerHTML = SPLAT_SVG(_obColor, 115);
        preview.style.opacity = '1'; preview.style.transform = 'scale(1)';
      }, 150);
      overlay.querySelector('#ob-color-preview-label').textContent = 'הצבע שלי ';
      if (_obColor !== prev) showPopup('🎨', 'צבע נבחר!', 1200);
    };
  });

  const nextBtn = overlay.querySelector('#ob-next');
  if (nextBtn) {
    nextBtn.onclick = () => {
      if (!_obColor) { overlay.querySelector('#ob-color-error').textContent = 'חובה לבחור צבע 🎨'; return; }
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
        <p class="ob-step-sub">${_obEmoji ? 'האימוג\'י שנבחר עבורך — אפשר לשנות' : g('בחר אימוג\'י שמייצג אותך', 'בחרי אימוג\'י שמייצג אותך')}</p>

        <div class="ob-emoji-preview" id="ob-emoji-preview">
          ${_obEmoji || '?'}
        </div>

        <div class="ob-emoji-grid">
          ${ONBOARD_EMOJIS.map(e => `
            <div class="ob-emoji-opt${e === _obEmoji ? ' ob-emoji-selected' : ''}"
              data-emoji="${e}">${e}</div>`).join('')}
          <div id="ob-kb-btn" style="font-size:1.2rem;aspect-ratio:1;display:flex;flex-direction:column;align-items:center;justify-content:center;border-radius:12px;cursor:pointer;background:#F3F0FF;border:2px dashed #A78BFA;color:#7C3AED;font-weight:900;line-height:1.2;">⌨️<span style="font-size:0.55rem;">אחר</span></div>
        </div>
        <input id="ob-kb-input" type="text" placeholder="✏️ הקלד אמוגי…" style="display:none;width:100%;margin-top:8px;padding:8px 12px;border-radius:10px;border:1.5px solid #A78BFA;font-size:1.4rem;text-align:center;outline:none;box-sizing:border-box;">

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
      const kbInp = overlay.querySelector('#ob-kb-input');
      if (kbInp) { kbInp.style.display = 'none'; kbInp.value = ''; }
      const kbBtn = overlay.querySelector('#ob-kb-btn');
      if (kbBtn) { kbBtn.style.background = '#F3F0FF'; kbBtn.style.borderStyle = 'dashed'; }
      if (_obEmoji !== prev) showPopup(_obEmoji, 'נבחר!', 1100);
    };
  });

  const obKbBtn = overlay.querySelector('#ob-kb-btn');
  const obKbInput = overlay.querySelector('#ob-kb-input');
  if (obKbBtn && obKbInput) {
    obKbBtn.onclick = () => {
      obKbInput.style.display = 'block';
      obKbInput.focus();
      obKbBtn.style.background = '#EDE9FE';
      obKbBtn.style.borderStyle = 'solid';
      obKbInput.oninput = () => {
        const val = obKbInput.value;
        if (!val) return;
        const seg = new Intl.Segmenter();
        const first = [...seg.segment(val)][0]?.segment;
        if (first && /\p{Emoji}/u.test(first)) {
          obKbInput.value = first;
          _obEmoji = first;
          overlay.querySelectorAll('.ob-emoji-opt').forEach(x => x.classList.remove('ob-emoji-selected'));
          overlay.querySelector('#ob-emoji-preview').textContent = first;
        }
      };
    };
  }

  const nextBtn = overlay.querySelector('#ob-next');
  if (nextBtn) {
    nextBtn.onclick = () => {
      if (!_obEmoji) {
        overlay.querySelector('#ob-emoji-error').textContent = 'חובה לבחור אימוג\'י 😊';
        return;
      }
      if (!_obColor) { goToStep(2); return; }
      goToStep(4);
    };
  }
  const backBtn = overlay.querySelector('#ob-back');
  if (backBtn) backBtn.onclick = () => goToStep(2);
}

// -------- STEP 4: NOTIFICATIONS --------
function showNotifStep() {
  _currentStep = 4;
  const overlay  = getOverlay();
  const isFem    = state.childData?.gender === 'female';
  const fem      = isFem ? 'י' : '';
  const color    = state.childData?.color || '#7C3AED';

  const isIOS      = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
  const isIOSBrowser = isIOS && !isStandalone;
  const isBlocked  = 'Notification' in window && Notification.permission === 'denied';
  const isGranted  = 'Notification' in window && Notification.permission === 'granted';

  // תוכן כרטיס לפי מצב
  let statusBox = '';
  let mainBtn   = '';
  let skipLabel = 'המשך ←';

  if (isGranted) {
    statusBox = `
      <div style="background:#D1FAE5;border-radius:16px;padding:14px 16px;display:flex;align-items:center;gap:10px;margin:4px 0;">
        <span style="font-size:1.5rem;">✅</span>
        <div style="font-size:0.85rem;font-weight:700;color:#065F46;">התראות כבר מופעלות!</div>
      </div>`;
    skipLabel = 'המשך ←';
  } else if (isIOSBrowser) {
    statusBox = `
      <div style="background:#FEF3C7;border:1.5px solid #FDE68A;border-radius:16px;padding:14px 16px;text-align:right;">
        <div style="font-weight:800;font-size:0.88rem;color:#92400E;margin-bottom:6px;">📲 כדי לקבל התראות ב-iOS:</div>
        <ol style="margin:0;padding-right:18px;font-size:0.82rem;color:#78350F;line-height:2;">
          <li>לחצ${fem} על <strong>שתף</strong> (□↑) בתחתית Safari</li>
          <li>בחר${fem} <strong>הוסף${fem} למסך הבית</strong></li>
          <li>פתח${fem} את האפליקציה מהמסך הבית</li>
        </ol>
      </div>`;
    skipLabel = 'המשך בינתיים ←';
  } else if (isBlocked) {
    statusBox = `
      <div style="background:#FEE2E2;border:1.5px solid #FECACA;border-radius:16px;padding:14px 16px;text-align:right;">
        <div style="font-weight:800;font-size:0.88rem;color:#991B1B;margin-bottom:6px;">🔕 התראות חסומות — כדי לשחרר:</div>
        <ol style="margin:0;padding-right:18px;font-size:0.82rem;color:#7F1D1D;line-height:2;">
          <li>לחצ${fem} על 🔒 / ⓘ ליד כתובת האתר</li>
          <li>לחצ${fem} על <strong>הרשאות אתר</strong></li>
          <li>הפעל${fem} <strong>התראות</strong> ורענן</li>
        </ol>
      </div>`;
    skipLabel = 'המשך בלי התראות ←';
  } else {
    statusBox = `
      <div style="background:#EDE9FE;border-radius:16px;padding:12px 16px;display:flex;align-items:center;gap:12px;">
        <div style="width:42px;height:42px;border-radius:12px;background:linear-gradient(135deg,#7C3AED,#6D28D9);display:flex;align-items:center;justify-content:center;font-size:1.2rem;flex-shrink:0;">🪥</div>
        <div style="text-align:right;">
          <div style="font-size:0.82rem;font-weight:800;color:#1E293B;">תזכורת: צחצוח שיניים</div>
          <div style="font-size:0.75rem;color:#6D28D9;margin-top:2px;">השלמ${fem} ותרוויח${fem} ⭐ עכשיו!</div>
        </div>
      </div>`;
    mainBtn = `
      <button class="ob-btn ob-btn-finish" id="ob-notif-allow"
        style="background:linear-gradient(135deg,#7C3AED,#5B21B6);color:white;border:none;width:100%;padding:15px;border-radius:18px;font-size:1rem;font-weight:900;font-family:'Heebo',sans-serif;cursor:pointer;margin-bottom:10px;box-shadow:0 6px 20px rgba(124,58,237,0.4);">
        🔔 אפשר${fem} התראות
      </button>`;
    skipLabel = 'אולי אחר כך ←';
  }

  overlay.innerHTML = `
    <div class="ob-backdrop">
      <div class="ob-card" id="ob-card">
        ${dotsHTML(4)}
        <div class="ob-step-label">שלב 4 מתוך 4</div>
        <div style="width:64px;height:64px;border-radius:20px;background:linear-gradient(135deg,#7C3AED,#5B21B6);display:flex;align-items:center;justify-content:center;font-size:2rem;margin:4px auto 10px;box-shadow:0 4px 16px rgba(124,58,237,0.35);">🔔</div>
        <h2 class="ob-step-title">תזכורות חכמות</h2>
        <p class="ob-step-sub" style="margin-bottom:12px;">
          ${isGranted ? `מעולה! תקבל${fem} תזכורות על משימות בזמן` :
            isIOSBrowser ? `כדי לקבל התראות ב-iPhone — הוסיפ${fem} למסך הבית` :
            isBlocked ? `התראות חסומות — אפשר לשחרר בהגדרות` :
            `קבל${fem} תזכורות על משימות ב⏰ הנכון`}
        </p>
        ${statusBox}
        ${mainBtn}
        <button class="ob-btn ob-btn-ghost" id="ob-notif-skip">${skipLabel}</button>
      </div>
    </div>`;

  animateIn(overlay.querySelector('#ob-card'));

  overlay.querySelector('#ob-notif-allow')?.addEventListener('click', async () => {
    const btn = overlay.querySelector('#ob-notif-allow');
    if (btn) { btn.disabled = true; btn.textContent = `⏳ מבקש${fem} הרשאה...`; }
    try {
      const token = await requestPushPermission();
      if (token && state.familyId && state.childId) {
        await saveChildFcmToken(_db, state.familyId, state.childId, token);
      }
      showPopup('🔔', 'התראות הופעלו! ✅');
    } catch(e) {
      console.warn('notif permission error:', e);
    }
    setTimeout(() => finishOnboarding(), 900);
  });

  overlay.querySelector('#ob-notif-skip')?.addEventListener('click', () => {
    finishOnboarding();
  });
}

// -------- FINISH --------
async function finishOnboarding() {
  const overlay = getOverlay();

  // פופאפ סיום
  const card = overlay.querySelector('#ob-card');
  const name = state.childData?.name || '';
  const isFem = state.childData?.gender === 'female';
  if (card) {
    card.innerHTML = `
      <div class="ob-finish-body">
        <div class="ob-finish-emoji">${_obEmoji || '🎉'}</div>
        <h2 class="ob-finish-title">${name ? `${name}, ` : ''}מוכן${isFem ? 'ה' : ''}! 🎉</h2>
        <p class="ob-finish-sub">הפרופיל שלך מוכן${isFem ? 'ה' : ''}<br>בוא${isFem ? 'י' : ''} נתחיל לאסוף כוכבים ⭐</p>
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
      document.documentElement.style.overflowY = '';
      document.body.style.overflowY = '';
      _renderChildFn();
      // show dashboard
      const { show } = window._childShowFn || {};
      if (show) show('screen-child');
      else document.getElementById('screen-child')?.classList.add('active','visible');
    }, 420);
  }, 1800);
}
