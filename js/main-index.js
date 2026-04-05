import { auth, db } from './firebase.js';
import { signInAnonymously } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { doc, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

import { showScreen, showToast, showLoading, hideLoading } from './ui.js';
import {
  initAuth, loginWithGoogle, loginWithFacebook, logoutParent,
  createNewFamily, joinFamily, currentFamilyId,
  sendMagicLink, completeMagicLinkSignIn
} from './auth.js';
import {
  childrenCache, loadChildren, createChild, saveChild,
  createParentInviteCode, verifyChildCode, shareParentCode,
  CHILD_EMOJIS, CHILD_COLORS
} from './family.js';

// =========== HELPERS ===========
function cropAndCompressPhoto(file, size = 300, quality = 0.75) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) return reject(new Error('לא קובץ תמונה'));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('שגיאה'));
    reader.onload = (ev) => {
      const img = new Image();
      img.onerror = () => reject(new Error('שגיאה'));
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext('2d');
        const side = Math.min(img.width, img.height);
        const sx = (img.width - side) / 2;
        const sy = Math.max(0, (img.height - side) / 2 - img.height * 0.05);
        ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });
}

window.showScreen = showScreen;

// =========== MAGIC LINK ===========
completeMagicLinkSignIn();

// =========== AUTH INIT ===========
initAuth(
  (user) => {
    hideLoading();
    // הורה מחובר — עבור לדשבורד
    window.location.href = 'parent.html';
  },
  () => {
    hideLoading();
    // אין משפחה — מסך הצטרפות
    showScreen('screen-join-family');
  }
);

// =========== WHO ARE YOU ===========
document.getElementById('btn-who-parent').onclick = () => {
  if (auth.currentUser && !auth.currentUser.isAnonymous) return;
  showScreen('screen-parent-login');
};

document.getElementById('btn-who-child').onclick = () => {
  codeAttempts = 0;
  document.getElementById('child-code-error').textContent = '';
  document.getElementById('code-attempts').textContent = '';
  document.querySelectorAll('.code-digit').forEach(d => d.value = '');
  showScreen('screen-child-code');
};

// =========== PARENT LOGIN ===========
document.getElementById('btn-google-login').onclick = async () => {
  const err = await loginWithGoogle();
  if (err) document.getElementById('login-error').textContent = err;
};

document.getElementById('btn-facebook-login').onclick = async () => {
  const err = await loginWithFacebook();
  if (err) document.getElementById('login-error').textContent = err;
};

document.getElementById('btn-email-login').onclick = () => {
  document.getElementById('login-error').textContent = '';
  const ov = document.createElement('div'); ov.className = 'modal-overlay';
  const sh = document.createElement('div'); sh.className = 'modal-sheet';
  sh.innerHTML = `
    <div class="modal-handle"></div>
    <div class="modal-header"><h2>✉️ קישור קסם</h2><button class="modal-close">✕</button></div>
    <div class="modal-body">
      <p style="font-size:0.88rem;color:var(--muted);line-height:1.55;margin-bottom:16px;">הכנס את כתובת המייל שלך — נשלח לך קישור להתחברות ישירה.</p>
      <div class="input-group" style="margin-bottom:8px;">
        <input type="email" id="magic-email-input" placeholder="your@email.com" style="direction:ltr;text-align:left;font-size:1rem;" autocomplete="email">
      </div>
      <div class="error-msg" id="magic-email-error" style="margin-bottom:8px;"></div>
      <button class="btn btn-primary btn-sm" id="btn-send-magic-link" style="margin-top:4px;">שלח קישור ✉️</button>
    </div>`;
  sh.querySelector('.modal-close').onclick = () => ov.remove();
  ov.onclick = e => { if (e.target === ov) ov.remove(); };
  sh.querySelector('#btn-send-magic-link').onclick = async () => {
    const email = document.getElementById('magic-email-input').value.trim();
    const errEl = document.getElementById('magic-email-error');
    if (!email || !email.includes('@')) { errEl.textContent = 'כתובת מייל לא תקינה'; return; }
    const sendBtn = sh.querySelector('#btn-send-magic-link');
    sendBtn.disabled = true; sendBtn.textContent = 'שולח...';
    const result = await sendMagicLink(email);
    if (result.success) {
      ov.remove();
      showToast('קישור נשלח! 📬');
    } else {
      errEl.textContent = result.error || 'שגיאה';
      sendBtn.disabled = false; sendBtn.textContent = 'שלח קישור ✉️';
    }
  };
  ov.appendChild(sh); document.body.appendChild(ov);
  setTimeout(() => document.getElementById('magic-email-input')?.focus(), 320);
};

// =========== JOIN FAMILY ===========
const parentCodeDigits = document.querySelectorAll('.parent-code-digit');
parentCodeDigits.forEach((input, idx) => {
  input.addEventListener('input', (e) => {
    const val = e.target.value.replace(/\D/g, '');
    e.target.value = val.slice(0, 1);
    if (val && idx < 5) parentCodeDigits[idx + 1].focus();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Backspace' && !e.target.value && idx > 0) parentCodeDigits[idx - 1].focus();
  });
  input.addEventListener('paste', (e) => {
    e.preventDefault();
    const paste = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6);
    paste.split('').forEach((ch, i) => { if (parentCodeDigits[i]) parentCodeDigits[i].value = ch; });
    if (paste.length > 0) parentCodeDigits[Math.min(paste.length, 5)].focus();
  });
});

document.getElementById('btn-join-family').onclick = async () => {
  const code = Array.from(parentCodeDigits).map(d => d.value).join('');
  const err = document.getElementById('join-family-error');
  if (code.length < 6) { err.textContent = 'הכנס 6 ספרות'; return; }
  const result = await joinFamily(code);
  if (result.error) { err.textContent = result.error; return; }
  window.location.href = 'parent.html';
};

document.getElementById('btn-create-new-family').onclick = async () => {
  const result = await createNewFamily(auth.currentUser);
  if (!result.success) { showToast('שגיאה, נסה שוב'); return; }
  resetOb1Form();
  showScreen('screen-onboard-1');
  setTimeout(() => document.getElementById('ob1-name').focus(), 200);
};

document.getElementById('btn-join-back').onclick = async () => {
  const { signOut } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js");
  await signOut(auth);
  showScreen('screen-who');
};

// =========== CHILD CODE ENTRY ===========
let codeAttempts = 0;
const MAX_ATTEMPTS = 5;
const codeDigits = document.querySelectorAll('#code-input-wrap .code-digit');

codeDigits.forEach((input, idx) => {
  input.addEventListener('input', (e) => {
    const val = e.target.value.replace(/\D/g, '');
    e.target.value = val.slice(0, 1);
    if (val && idx < 5) codeDigits[idx + 1].focus();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Backspace' && !e.target.value && idx > 0) codeDigits[idx - 1].focus();
  });
  input.addEventListener('paste', (e) => {
    e.preventDefault();
    const paste = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6);
    paste.split('').forEach((ch, i) => { if (codeDigits[i]) codeDigits[i].value = ch; });
    if (paste.length > 0) codeDigits[Math.min(paste.length, 5)].focus();
  });
});

document.getElementById('btn-verify-code').onclick = async () => {
  const code = Array.from(codeDigits).map(d => d.value).join('');
  const err = document.getElementById('child-code-error');
  if (code.length < 6) { err.textContent = 'הכנס 6 ספרות'; return; }
  if (codeAttempts >= MAX_ATTEMPTS) { err.textContent = 'יותר מדי ניסיונות'; return; }
  codeAttempts++;
  document.getElementById('code-attempts').textContent = `ניסיון ${codeAttempts}/${MAX_ATTEMPTS}`;
  showLoading('בודק...');
  const result = await verifyChildCode(code);
  hideLoading();
  if (result.error) { err.textContent = result.error; return; }
  pendingChildData = result;
  document.getElementById('child-setup-name').textContent = `שלום ${result.name}! 👋`;
  setupEmojiPicker();
  setupColorPicker();
  resetChildPhoto();
  showScreen('screen-child-setup');
};

// =========== CHILD SETUP ===========
let pendingChildData = null;
let selectedEmoji = '';
let selectedColor = '';
let childPhotoData = null;

function setupEmojiPicker() {
  selectedEmoji = '';
  const grid = document.getElementById('emoji-picker');
  grid.innerHTML = CHILD_EMOJIS.map(e => `<div class="emoji-opt" data-emoji="${e}">${e}</div>`).join('');
  grid.querySelectorAll('.emoji-opt').forEach(el => {
    el.onclick = () => {
      grid.querySelectorAll('.emoji-opt').forEach(x => x.classList.remove('selected'));
      el.classList.add('selected');
      selectedEmoji = el.dataset.emoji;
    };
  });
}

function setupColorPicker() {
  selectedColor = '';
  const grid = document.getElementById('color-picker');
  grid.innerHTML = CHILD_COLORS.map(c => `<div class="color-opt" data-color="${c}" style="background:${c}"></div>`).join('');
  grid.querySelectorAll('.color-opt').forEach(el => {
    el.onclick = () => {
      grid.querySelectorAll('.color-opt').forEach(x => x.classList.remove('selected'));
      el.classList.add('selected');
      selectedColor = el.dataset.color;
    };
  });
}

function resetChildPhoto() {
  childPhotoData = null;
  document.getElementById('child-photo-preview').style.display = 'none';
  document.getElementById('child-photo-placeholder').style.display = '';
  document.getElementById('child-photo-input').value = '';
}

document.getElementById('child-photo-input').onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    childPhotoData = await cropAndCompressPhoto(file);
    document.getElementById('child-photo-preview').src = childPhotoData;
    document.getElementById('child-photo-preview').style.display = 'block';
    document.getElementById('child-photo-placeholder').style.display = 'none';
  } catch(err) { showToast('שגיאה בטעינת התמונה ⚠️'); }
};

document.getElementById('btn-finish-setup').onclick = async () => {
  const err = document.getElementById('setup-error');
  if (!selectedEmoji) { document.getElementById('emoji-error').textContent = "חובה לבחור אימוג'י"; return; }
  document.getElementById('emoji-error').textContent = '';
  if (!selectedColor) { document.getElementById('color-error').textContent = 'חובה לבחור צבע'; return; }
  document.getElementById('color-error').textContent = '';
  err.textContent = '';

  showLoading('שומר...');
  try {
    const cred = await signInAnonymously(auth);
    const anonUid = cred.user.uid;
    const updates = { emoji: selectedEmoji, color: selectedColor, status: 'active', anonUid };
    if (childPhotoData) updates.photo = childPhotoData;
    await updateDoc(doc(db, 'families', pendingChildData.familyId, 'children', pendingChildData.childId), updates);
    await updateDoc(doc(db, 'inviteCodes', pendingChildData.code), { used: true });
    localStorage.setItem('childId', pendingChildData.childId);
    localStorage.setItem('childFamilyId', pendingChildData.familyId);
    localStorage.setItem('childAnonUid', anonUid);
    hideLoading();
    showToast('מוכן! 🎉');
    setTimeout(() => { window.location.href = 'child.html'; }, 800);
  } catch(e) {
    hideLoading();
    err.textContent = 'שגיאה, נסה שוב';
    console.error(e);
  }
};

// =========== ONBOARDING ===========
let obGender = '';
let obChildPhoto = null;
let obEmoji = '';
let obColor = '';

document.querySelectorAll('.ob1-gender').forEach(btn => {
  btn.onclick = () => {
    obGender = btn.dataset.gender;
    document.querySelectorAll('.ob1-gender').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
  };
});

function showOb1EmojiModal() {
  const ov = document.createElement('div'); ov.className = 'modal-overlay';
  const sh = document.createElement('div'); sh.className = 'modal-sheet';
  sh.innerHTML = `<div class="modal-handle"></div>
    <div class="modal-header"><h2>🙂 בחר אימוג'י</h2><button class="modal-close">✕</button></div>
    <div class="modal-body"><div class="emoji-grid">${CHILD_EMOJIS.map(e => `<div class="emoji-opt${e === obEmoji ? ' selected' : ''}" data-emoji="${e}">${e}</div>`).join('')}</div></div>`;
  sh.querySelector('.modal-close').onclick = () => ov.remove();
  ov.onclick = e => { if (e.target === ov) ov.remove(); };
  sh.querySelectorAll('.emoji-opt').forEach(el => {
    el.onclick = () => {
      obEmoji = el.dataset.emoji;
      const ed = document.getElementById('ob1-emoji-display');
      ed.textContent = obEmoji; ed.style.background = 'transparent';
      ed.style.borderStyle = 'solid'; ed.style.color = '';
      ov.remove();
    };
  });
  ov.appendChild(sh); document.body.appendChild(ov);
}

function showOb1ColorModal() {
  const ov = document.createElement('div'); ov.className = 'modal-overlay';
  const sh = document.createElement('div'); sh.className = 'modal-sheet';
  sh.innerHTML = `<div class="modal-handle"></div>
    <div class="modal-header"><h2>🎨 בחר צבע</h2><button class="modal-close">✕</button></div>
    <div class="modal-body"><div class="color-grid">${CHILD_COLORS.map(c => `<div class="color-opt${c === obColor ? ' selected' : ''}" data-color="${c}" style="background:${c}"></div>`).join('')}</div></div>`;
  sh.querySelector('.modal-close').onclick = () => ov.remove();
  ov.onclick = e => { if (e.target === ov) ov.remove(); };
  sh.querySelectorAll('.color-opt').forEach(el => {
    el.onclick = () => {
      obColor = el.dataset.color;
      const cd = document.getElementById('ob1-color-display');
      cd.style.background = obColor; cd.style.borderStyle = 'solid';
      ov.remove();
    };
  });
  ov.appendChild(sh); document.body.appendChild(ov);
}

window.showOb1EmojiModal = showOb1EmojiModal;
window.showOb1ColorModal = showOb1ColorModal;

document.getElementById('ob1-photo-input').onchange = async (e) => {
  const file = e.target.files[0]; if (!file) return;
  try {
    obChildPhoto = await cropAndCompressPhoto(file);
    const ob1pc = document.getElementById('ob1-photo-circle');
    ob1pc.innerHTML = `<img src="${obChildPhoto}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
    ob1pc.style.borderStyle = 'solid';
  } catch(err) { showToast('שגיאה ⚠️'); }
};

const OB1_ORDINALS = ['ראשון','שני','שלישי','רביעי','חמישי','שישי','שביעי','שמיני','תשיעי','עשירי'];

function updateOb1Title() {
  const idx = childrenCache.length;
  const ord = OB1_ORDINALS[idx] || `${idx + 1}`;
  const el = document.getElementById('ob1-title');
  if (el) el.textContent = `הוסף ילד/ה ${ord}`;
  const topNext = document.getElementById('ob1-top-next');
  if (topNext) {
    topNext.style.visibility = idx === 0 ? 'hidden' : 'visible';
    topNext.textContent = 'דלג ←';
  }
  const backBtn = document.getElementById('ob1-back');
  if (backBtn) backBtn.style.visibility = idx === 0 ? 'visible' : 'hidden';
}

function resetOb1Form() {
  updateOb1Title();
  document.getElementById('ob1-name').value = '';
  obGender = ''; obChildPhoto = null; obEmoji = ''; obColor = '';
  document.getElementById('ob1-error').textContent = '';
  document.querySelectorAll('.ob1-gender').forEach(b => b.classList.remove('selected'));
  const ob1pc = document.getElementById('ob1-photo-circle');
  ob1pc.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#818CF8" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>`;
  ob1pc.style.borderStyle = 'dashed';
  document.getElementById('ob1-photo-input').value = '';
  const emojiEl = document.getElementById('ob1-emoji-display');
  emojiEl.textContent = '?'; emojiEl.style.background = 'linear-gradient(135deg,#EDE9FE,#C7D2FE)';
  emojiEl.style.borderStyle = 'dashed'; emojiEl.style.color = '#818CF8';
  const colorEl = document.getElementById('ob1-color-display');
  colorEl.style.background = 'linear-gradient(135deg,#EDE9FE,#C7D2FE)'; colorEl.style.borderStyle = 'dashed';
}

async function goToOnboard2() {
  showScreen('screen-onboard-2');
  document.getElementById('ob2-code').textContent = '——————';
  const invResult = await createParentInviteCode(currentFamilyId);
  if (invResult && invResult.code) document.getElementById('ob2-code').textContent = invResult.code;
}

function showChildAddedPopup(name, gender, onAddMore, onContinue) {
  const isBoy = gender === 'male';
  const backdrop = document.createElement('div');
  backdrop.style.cssText = 'position:fixed;inset:0;z-index:7000;background:rgba(15,23,42,0.55);display:flex;align-items:center;justify-content:center;padding:24px;';
  const card = document.createElement('div');
  card.style.cssText = 'background:white;border-radius:28px;padding:30px 24px 24px;width:100%;max-width:340px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,0.28);direction:rtl;font-family:Heebo,sans-serif;';
  card.innerHTML = `
    <div style="font-size:3.2rem;margin-bottom:10px;">🎉</div>
    <div style="font-size:1.25rem;font-weight:900;color:#1E293B;margin-bottom:6px;">${name} ${isBoy ? 'נוסף' : 'נוספה'} בהצלחה!</div>
    <div style="font-size:0.86rem;color:#64748B;margin-bottom:24px;">${isBoy ? 'הוא' : 'היא'} כבר חלק מהמשפחה ✨</div>
    <button id="pop-add-more" style="width:100%;padding:13px;background:#F1F5F9;border:2px dashed #CBD5E1;border-radius:16px;font-size:0.95rem;font-weight:800;font-family:Heebo,sans-serif;cursor:pointer;color:#475569;margin-bottom:10px;">➕ הוסף ילד/ה נוספ/ת</button>
    <button id="pop-continue" style="width:100%;padding:14px;background:linear-gradient(135deg,#6366F1,#4F46E5);border:none;border-radius:16px;font-size:1rem;font-weight:900;font-family:Heebo,sans-serif;cursor:pointer;color:white;">המשך ←</button>`;
  backdrop.appendChild(card); document.body.appendChild(backdrop);
  card.querySelector('#pop-add-more').onclick = () => { backdrop.remove(); onAddMore(); };
  card.querySelector('#pop-continue').onclick = () => { backdrop.remove(); onContinue(); };
}

document.getElementById('ob1-top-next').addEventListener('click', () => {
  if (childrenCache.length > 0) goToOnboard2();
  else document.getElementById('ob1-next').click();
});

document.getElementById('ob1-back').onclick = () => showScreen('screen-join-family');

document.getElementById('ob1-next').onclick = async () => {
  const name = document.getElementById('ob1-name').value.trim();
  const err = document.getElementById('ob1-error');
  if (!name && childrenCache.length > 0) { goToOnboard2(); return; }
  if (!name) { err.textContent = 'חובה להזין שם ילד/ה'; return; }
  if (!obGender) { err.textContent = 'חובה לבחור בן או בת'; return; }
  err.textContent = '';

  const nameLC = name.toLowerCase();
  const duplicate = childrenCache.find(c => c.name && c.name.toLowerCase() === nameLC);
  if (duplicate) { err.textContent = `ילד/ה בשם "${name}" כבר קיים/ת`; return; }

  const result = await createChild(currentFamilyId, name, obGender);
  if (result.error) { err.textContent = result.error; return; }

  childrenCache.push({ id: result.childId, name, gender: obGender });
  const extraUpdates = {};
  if (obChildPhoto) extraUpdates.photo = obChildPhoto;
  if (obEmoji) extraUpdates.emoji = obEmoji;
  if (obColor) extraUpdates.color = obColor;
  if (Object.keys(extraUpdates).length > 0) await saveChild(currentFamilyId, result.childId, extraUpdates);

  const savedName = name; const savedGender = obGender;
  resetOb1Form();
  showChildAddedPopup(savedName, savedGender, () => {}, () => goToOnboard2());
};

document.getElementById('ob2-back').onclick = () => { updateOb1Title(); showScreen('screen-onboard-1'); };
document.getElementById('ob2-skip').onclick = () => showScreen('screen-onboard-3');
document.getElementById('ob2-share').onclick = () => {
  const code = document.getElementById('ob2-code').textContent.trim();
  shareParentCode(code);
};
document.getElementById('ob3-back').onclick = () => showScreen('screen-onboard-2');
document.getElementById('ob3-allow').onclick = async () => {
  if ('Notification' in window) { try { await Notification.requestPermission(); } catch(e) {} }
  window.location.href = 'parent.html';
};
document.getElementById('ob3-later').onclick = () => { window.location.href = 'parent.html'; };

// =========== WHO SLIDER ===========
(function initWhoSlider() {
  const slider = document.getElementById('who-slider');
  const track = document.getElementById('who-track');
  const dots = [0, 1, 2].map(i => document.getElementById('who-dot-' + i));
  if (!slider || !track) return;
  let current = 0;
  function goTo(idx) {
    current = Math.max(0, Math.min(idx, 2));
    track.style.transform = `translateX(-${current * (100 / 3)}%)`;
    dots.forEach((d, i) => { if (!d) return; d.style.width = i === current ? '22px' : '8px'; d.style.background = i === current ? 'var(--primary)' : 'rgba(99,102,241,0.28)'; });
  }
  dots.forEach((d, i) => { if (d) d.onclick = () => goTo(i); });
  let startX = 0, autoInterval;
  const startAuto = () => { autoInterval = setInterval(() => goTo((current + 1) % 3), 3800); };
  slider.addEventListener('touchstart', e => { startX = e.touches[0].clientX; clearInterval(autoInterval); track.style.transition = 'none'; }, { passive: true });
  slider.addEventListener('touchend', e => {
    track.style.transition = 'transform 0.38s cubic-bezier(0.4,0,0.2,1)';
    const dx = e.changedTouches[0].clientX - startX;
    if (Math.abs(dx) > 48) goTo(dx > 0 ? current - 1 : current + 1); else goTo(current);
    startAuto();
  });
  startAuto();
})();
