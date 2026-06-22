import { auth, db } from './firebase.js';
import { showScreen, showToast, showLoading, hideLoading, syncPageScroll } from './ui.js';
import { cropAndCompressPhoto } from './ui.js';
import {
  initAuth, loginWithGoogle, loginWithFacebook,
  createNewFamily, joinFamily, currentFamilyId,
  sendMagicLink, completeMagicLinkSignIn
} from './auth.js';
import {
  childrenCache, loadChildren, createChild, saveChild,
  createParentInviteCode, verifyChildCode, shareParentCode,
  CHILD_EMOJIS, CHILD_COLORS, colorGradient
} from './family.js';
import { SPLAT_SVG } from './icons.js';
import { requestPushPermission, saveParentFcmToken } from './notifications.js';

window.showScreen = showScreen;

document.addEventListener('DOMContentLoaded', () => {
  const active = document.querySelector('.screen.active');
  if (active?.id) syncPageScroll(active.id);
});

// =========== MAGIC LINK ===========
completeMagicLinkSignIn();

// =========== AUTH INIT ===========
const _isOnboardReturn = new URLSearchParams(window.location.search).get('onboard') === '1';

if (_isOnboardReturn) {
  // הגענו מ-parent.html כי אין ילדים — טען familyId ישירות, הצג אונבורד
  hideLoading();
  (async () => {
    const { onAuthStateChanged } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js");
    const { getDocs, collection, query, where } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
    const { setCurrentFamilyId } = await import('./auth.js');
    let handled = false;
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (handled) return;
      handled = true;
      unsub();
      window.history.replaceState(null, '', window.location.pathname);
      if (!user || user.isAnonymous) {
        showScreen('screen-who');
        return;
      }
      try {
        let famSnap = await getDocs(query(collection(db, 'families'), where('parentUid', '==', user.uid)));
        if (famSnap.empty) famSnap = await getDocs(query(collection(db, 'families'), where('secondaryParentUid', '==', user.uid)));
        if (!famSnap.empty) setCurrentFamilyId(famSnap.docs[0].id);
      } catch(e) {}
      resetOb1Form();
      showScreen('screen-onboard-1');
    });
  })();

} else {
  initAuth(
    async (user) => {
      hideLoading();
      // יש משפחה — בדוק ילדים. currentFamilyId כבר מאוכלס על ידי initAuth
      try {
        await loadChildren(currentFamilyId);
        if (childrenCache.length === 0) {
          resetOb1Form();
          showScreen('screen-onboard-1');
        } else {
          window.location.href = 'parent.html';
        }
      } catch(e) {
        window.location.href = 'parent.html';
      }
    },
    () => {
      hideLoading();
      // אין משפחה
      const justLoggedIn = sessionStorage.getItem('justLoggedIn') === '1';
      sessionStorage.removeItem('justLoggedIn');
      if (justLoggedIn || sessionStorage.getItem('atJoinFamily') === '1') {
        sessionStorage.setItem('atJoinFamily', '1');
        showScreen('screen-join-family');
      } else {
        showScreen('screen-who');
      }
    }
  );
}

// =========== WHO ARE YOU ===========
document.getElementById('btn-who-parent').onclick = () => {
  const user = auth.currentUser;
  if (user && !user.isAnonymous) {
    sessionStorage.setItem('atJoinFamily', '1');
    showScreen('screen-join-family');
  } else {
    showScreen('screen-parent-login');
  }
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
  sessionStorage.setItem('justLoggedIn', '1');
  const err = await loginWithGoogle();
  if (err) document.getElementById('login-error').textContent = err;
};

document.getElementById('btn-facebook-login').onclick = async () => {
  sessionStorage.setItem('justLoggedIn', '1');
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
  sessionStorage.setItem('isSecondaryParent', '1');
  sessionStorage.removeItem('atJoinFamily');
  window.location.href = 'parent.html';
};

document.getElementById('btn-create-new-family').onclick = async () => {
  sessionStorage.removeItem('atJoinFamily');
  const result = await createNewFamily(auth.currentUser);
  if (!result.success) { showToast('שגיאה, נסה שוב'); return; }
  resetOb1Form();
  showScreen('screen-onboard-1');
};

document.getElementById('btn-join-back').onclick = async () => {
  const user = auth.currentUser;
  if (!user) { sessionStorage.removeItem('atJoinFamily'); showScreen('screen-who'); return; }
  showLoading('מנקה...');
  try {
    await user.delete();
  } catch(e) {
    if (e.code === 'auth/requires-recent-login') {
      try {
        const { GoogleAuthProvider, FacebookAuthProvider, reauthenticateWithPopup, signOut: _so } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js");
        const providerId = user.providerData?.[0]?.providerId;
        let provider = null;
        if (providerId === 'google.com') provider = new GoogleAuthProvider();
        else if (providerId === 'facebook.com') provider = new FacebookAuthProvider();
        if (provider) {
          await reauthenticateWithPopup(user, provider);
          await user.delete();
        } else {
          await _so(auth);
          hideLoading();
          sessionStorage.removeItem('atJoinFamily');
          showToast('אירעה שגיאה, נסה שוב ⚠️');
          showScreen('screen-who');
          return;
        }
      } catch(reAuthErr) {
        const { signOut: _so2 } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js");
        await _so2(auth);
        hideLoading();
        sessionStorage.removeItem('atJoinFamily');
        showToast('אירעה שגיאה, נסה שוב ⚠️');
        showScreen('screen-who');
        return;
      }
    } else {
      const { signOut: _so3 } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js");
      await _so3(auth);
      hideLoading();
      sessionStorage.removeItem('atJoinFamily');
      showToast('אירעה שגיאה, נסה שוב ⚠️');
      showScreen('screen-who');
      return;
    }
  }
  hideLoading();
  sessionStorage.removeItem('atJoinFamily');
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
  showLoading('מתחבר...');
  try {
    const { signInAnonymously } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js');
    const { doc: fsDoc, updateDoc: fsUpdate } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
    const cred = await signInAnonymously(auth);
    const anonUid = cred.user.uid;
    await fsUpdate(fsDoc(db, 'families', result.familyId, 'children', result.childId), { status: 'active', anonUid });
    await fsUpdate(fsDoc(db, 'inviteCodes', result.code), { used: true });
    localStorage.setItem('childId', result.childId);
    localStorage.setItem('childFamilyId', result.familyId);
    localStorage.setItem('childAnonUid', anonUid);
    hideLoading();
    window.location.href = 'child.html';
  } catch(e) {
    hideLoading();
    err.textContent = 'שגיאה בהתחברות, נסה שוב';
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
    <div class="modal-body">
      <div id="emoji-preview-display" style="font-size:4rem;text-align:center;min-height:64px;margin-bottom:12px;transition:transform 0.2s cubic-bezier(.34,1.28,.64,1);">${obEmoji || '?'}</div>
      <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:6px;margin-bottom:16px;">
        ${CHILD_EMOJIS.map(e => `<div class="emoji-opt${e === obEmoji ? ' selected' : ''}" data-emoji="${e}" style="font-size:1.6rem;aspect-ratio:1;display:flex;align-items:center;justify-content:center;border-radius:12px;cursor:pointer;">${e}</div>`).join('')}
      </div>
      <button id="emoji-confirm-btn" style="width:100%;padding:14px;background:linear-gradient(135deg,#7C3AED,#5B21B6);border:none;border-radius:16px;font-size:1rem;font-weight:900;font-family:'Heebo',sans-serif;cursor:pointer;color:white;">אישור ✓</button>
    </div>`;
  sh.querySelector('.modal-close').onclick = () => ov.remove();
  ov.onclick = e => { if (e.target === ov) ov.remove(); };
  const preview = sh.querySelector('#emoji-preview-display');
  let tempEmoji = obEmoji;
  sh.querySelectorAll('.emoji-opt').forEach(el => {
    el.onclick = () => {
      const prev = tempEmoji;
      tempEmoji = el.dataset.emoji;
      sh.querySelectorAll('.emoji-opt').forEach(x => x.classList.remove('selected'));
      el.classList.add('selected');
      if (tempEmoji !== prev) {
        preview.style.transform = 'scale(0.6)';
        setTimeout(() => { preview.textContent = tempEmoji; preview.style.transform = 'scale(1)'; }, 120);
      }
    };
  });
  sh.querySelector('#emoji-confirm-btn').onclick = () => {
    if (!tempEmoji) { ov.remove(); return; }
    obEmoji = tempEmoji;
    const ed = document.getElementById('ob1-emoji-display');
    ed.textContent = obEmoji;
    ed.style.background = 'none';
    ed.style.border = 'none';
    ed.style.fontSize = '80px';
    ed.style.color = '';
    ov.remove();
  };
  ov.appendChild(sh); document.body.appendChild(ov);
}

function showOb1ColorModal() {
  const ov = document.createElement('div'); ov.className = 'modal-overlay';
  const sh = document.createElement('div'); sh.className = 'modal-sheet';
  let tempColor = obColor;
  sh.innerHTML = `<div class="modal-handle"></div>
    <div class="modal-header"><h2>🎨 בחר צבע</h2><button class="modal-close">✕</button></div>
    <div class="modal-body">
      <div class="splat-modal-preview" id="modal-color-preview">
        ${obColor ? SPLAT_SVG(obColor, 115) : SPLAT_SVG('#94A3B8', 115, true)}
      </div>
      <div class="splat-color-grid">${CHILD_COLORS.map(c => `<div class="splat-color-opt${c === obColor ? ' splat-selected' : ''}" data-color="${c}">${SPLAT_SVG(c, 70)}</div>`).join('')}</div>
      <button class="splat-confirm-btn" id="modal-color-confirm">אישור ✓</button>
    </div>`;
  sh.querySelector('.modal-close').onclick = () => ov.remove();
  ov.onclick = e => { if (e.target === ov) ov.remove(); };
  sh.querySelectorAll('.splat-color-opt').forEach(el => {
    el.onclick = () => {
      tempColor = el.dataset.color;
      sh.querySelectorAll('.splat-color-opt').forEach(x => x.classList.remove('splat-selected'));
      el.classList.add('splat-selected');
      const prev = sh.querySelector('#modal-color-preview');
      prev.style.transition = 'transform 0.25s cubic-bezier(.34,1.5,.64,1), opacity 0.15s';
      prev.style.opacity = '0'; prev.style.transform = 'scale(0.7)';
      setTimeout(() => { prev.innerHTML = SPLAT_SVG(tempColor, 115); prev.style.opacity = '1'; prev.style.transform = 'scale(1)'; }, 150);
    };
  });
  sh.querySelector('#modal-color-confirm').onclick = () => {
    if (!tempColor) { ov.remove(); return; }
    obColor = tempColor;
    const cd = document.getElementById('ob1-color-display');
    cd.innerHTML = SPLAT_SVG(obColor, 75); cd.style.background = 'transparent'; cd.style.border = 'none';
    ov.remove();
  };
  ov.appendChild(sh); document.body.appendChild(ov);
}

window.showOb1EmojiModal = showOb1EmojiModal;
window.showOb1ColorModal = showOb1ColorModal;

const _ob1SvgPlaceholder = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#A78BFA" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>`;

document.getElementById('ob1-photo-input').onchange = async (e) => {
  const file = e.target.files[0]; if (!file) return;
  try {
    obChildPhoto = await cropAndCompressPhoto(file);
    const ob1pc = document.getElementById('ob1-photo-circle');
    ob1pc.innerHTML = `<img src="${obChildPhoto}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
    ob1pc.style.border = 'none'; ob1pc.style.width = '85px'; ob1pc.style.height = '85px';
    const clearBtn = document.getElementById('ob1-clear-photo');
    clearBtn.innerHTML = '🗑️ מחק';
    clearBtn.style.display = 'block';
  } catch(err) { showToast('שגיאה ⚠️'); }
};

document.getElementById('ob1-clear-photo').onclick = () => {
  obChildPhoto = null;
  const ob1pc = document.getElementById('ob1-photo-circle');
  ob1pc.innerHTML = _ob1SvgPlaceholder;
  ob1pc.style.border = '3px dashed #A78BFA'; ob1pc.style.width = '95px'; ob1pc.style.height = '95px';
  const clearBtn = document.getElementById('ob1-clear-photo');
  clearBtn.style.display = 'none';
  clearBtn.innerHTML = '🗑️ מחק';
  document.getElementById('ob1-photo-input').value = '';
};

const OB1_ORDINALS = [
  ['ראשון', 'ראשונה'],
  ['שני',   'שנייה'],
  ['שלישי', 'שלישית'],
  ['רביעי', 'רביעית'],
  ['חמישי', 'חמישית'],
  ['שישי',  'שישית'],
  ['שביעי', 'שביעית'],
  ['שמיני', 'שמינית'],
  ['תשיעי', 'תשיעית'],
  ['עשירי', 'עשירית'],
];

function updateOb1Title() {
  const idx = childrenCache.length;
  const el = document.getElementById('ob1-title');
  if (el) el.textContent = idx === 0 ? 'הוספת ילד/ה' : 'הוספת ילד/ה נוסף';
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
  ob1pc.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#A78BFA" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>`;
  ob1pc.style.border = '3px dashed #A78BFA'; ob1pc.style.width = '95px'; ob1pc.style.height = '95px';
  document.getElementById('ob1-photo-input').value = '';
  document.getElementById('ob1-clear-photo').style.display = 'none';
  const emojiEl = document.getElementById('ob1-emoji-display');
  emojiEl.textContent = '?';
  emojiEl.style.background = 'linear-gradient(135deg,#EDE9FE,#C7D2FE)';
  emojiEl.style.border = '3px dashed #A78BFA';
  emojiEl.style.fontSize = '';
  emojiEl.style.color = '#A78BFA';
  const colorEl = document.getElementById('ob1-color-display');
  colorEl.innerHTML = SPLAT_SVG('#94A3B8', 75, true); colorEl.style.background = 'transparent'; colorEl.style.border = 'none';
}

async function goToOnboard2() {
  showScreen('screen-onboard-2');
  document.getElementById('ob2-code').textContent = '——————';
  const invResult = await createParentInviteCode(currentFamilyId);
  if (invResult && invResult.code) document.getElementById('ob2-code').textContent = invResult.code;
}

function showChildAddedPopup(name, gender, inviteCode, onAddMore, onContinue) {
  const isBoy = gender === 'male';
  const backdrop = document.createElement('div');
  backdrop.style.cssText = 'position:fixed;inset:0;z-index:7000;background:rgba(15,23,42,0.55);display:flex;align-items:center;justify-content:center;padding:24px;';
  const card = document.createElement('div');
  card.style.cssText = 'background:white;border-radius:28px;padding:30px 24px 24px;width:100%;max-width:340px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,0.28);direction:rtl;font-family:Heebo,sans-serif;';

  const codeBlock = inviteCode ? `
    <div style="background:linear-gradient(135deg,#EDE9FE,#DDD6FE);border-radius:18px;padding:14px 16px;margin-bottom:12px;">
      <div style="font-size:0.72rem;font-weight:700;color:#7C3AED;margin-bottom:6px;">קוד כניסה ל${isBoy ? 'בן' : 'בת'}</div>
      <div style="font-size:2rem;font-weight:900;color:#5B21B6;letter-spacing:8px;direction:ltr;font-variant-numeric:tabular-nums;">${inviteCode}</div>
      <div style="font-size:0.7rem;color:#A78BFA;margin-top:6px;font-weight:600;">⏰ תקף ל-24 שעות</div>
    </div>` : '';

  card.innerHTML = `
    <div style="width:72px;height:72px;background:linear-gradient(135deg,#EDE9FE,#DDD6FE);border-radius:22px;display:flex;align-items:center;justify-content:center;font-size:2.6rem;margin:0 auto 12px;">🎉</div>
    <div style="font-size:1.25rem;font-weight:900;color:#1E293B;margin-bottom:4px;">${name} ${isBoy ? 'נוסף' : 'נוספה'} בהצלחה!</div>
    <div style="font-size:0.86rem;color:#64748B;margin-bottom:18px;">${isBoy ? 'הוא' : 'היא'} כבר חלק מהמשפחה ✨</div>
    ${codeBlock}
    ${inviteCode ? `<button id="pop-share-code" style="width:100%;padding:13px;background:linear-gradient(135deg,#7C3AED,#5B21B6);border:none;border-radius:16px;font-size:0.95rem;font-weight:900;font-family:Heebo,sans-serif;cursor:pointer;color:white;margin-bottom:10px;">📤 שתף קוד עם ה${isBoy ? 'ילד' : 'ילדה'}</button>` : ''}
    <div style="display:flex;gap:8px;">
      <button id="pop-add-more" style="flex:1;padding:13px 8px;background:#F5F3FF;border:2px dashed #A78BFA;border-radius:16px;font-size:0.85rem;font-weight:800;font-family:Heebo,sans-serif;cursor:pointer;color:#7C3AED;">➕ הוסף ילד/ה</button>
      <button id="pop-continue" style="flex:1;padding:13px;background:linear-gradient(135deg,#6D28D9,#5B21B6);border:none;border-radius:16px;font-size:0.88rem;font-weight:900;font-family:Heebo,sans-serif;cursor:pointer;color:white;">המשך ←</button>
    </div>`;
  backdrop.appendChild(card); document.body.appendChild(backdrop);
  if (inviteCode) {
    card.querySelector('#pop-share-code').onclick = () => {
      if (navigator.share) navigator.share({ title: `קוד כניסה עבור ${name}`, text: `הקוד שלך הוא: ${inviteCode}` }).catch(() => {});
      else { navigator.clipboard?.writeText(inviteCode); showToast('הקוד הועתק! 📋'); }
    };
  }
  card.querySelector('#pop-add-more').onclick = () => { backdrop.remove(); onAddMore(); };
  card.querySelector('#pop-continue').onclick = () => { backdrop.remove(); onContinue(); };
}

document.getElementById('ob1-top-next').addEventListener('click', () => {
  if (childrenCache.length > 0) goToOnboard2();
  else document.getElementById('ob1-next').click();
});

document.getElementById('ob1-back').onclick = async () => {
  if (childrenCache.length > 0) { showScreen('screen-join-family'); return; }
  const fid = currentFamilyId;
  if (!fid) { showScreen('screen-join-family'); return; }
  showLoading('מוחק...');
  try {
    const { deleteDoc, doc: fsDoc } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
    await deleteDoc(fsDoc(db, 'families', fid));
    const { setCurrentFamilyId: _set } = await import('./auth.js');
    _set(null);
  } catch(e) {
    console.warn('ob1-back: family delete failed', e);
  }
  hideLoading();
  showScreen('screen-join-family');
};

document.getElementById('ob1-next').onclick = async () => {
  const name = document.getElementById('ob1-name').value.trim();
  const err = document.getElementById('ob1-error');
  err.textContent = '';

  const nameInput = document.getElementById('ob1-name');
  const genderPicker = document.getElementById('ob1-gender-picker');

  if (!name && !obGender) {
    err.textContent = 'נא להזין שם ולבחור מין';
    nameInput.classList.remove('input-error'); void nameInput.offsetWidth; nameInput.classList.add('input-error');
    if (genderPicker) { genderPicker.classList.remove('gender-error'); void genderPicker.offsetWidth; genderPicker.classList.add('gender-error'); }
    setTimeout(() => { nameInput.classList.remove('input-error'); if (genderPicker) genderPicker.classList.remove('gender-error'); }, 1200);
    return;
  }
  if (!name) {
    err.textContent = 'נא להזין שם';
    nameInput.classList.remove('input-error'); void nameInput.offsetWidth; nameInput.classList.add('input-error');
    setTimeout(() => nameInput.classList.remove('input-error'), 1200);
    return;
  }
  if (!obGender) {
    err.textContent = 'נא לבחור מין';
    if (genderPicker) { genderPicker.classList.remove('gender-error'); void genderPicker.offsetWidth; genderPicker.classList.add('gender-error'); setTimeout(() => genderPicker.classList.remove('gender-error'), 1200); }
    return;
  }
  err.textContent = '';

  const nameLC = name.toLowerCase();
  const duplicate = childrenCache.find(c => c.name && c.name.toLowerCase() === nameLC);
  if (duplicate) { err.textContent = `${obGender === 'female' ? 'ילדה' : 'ילד'} בשם "${name}" כבר קיים${obGender === 'female' ? 'ת' : ''}`; return; }

  const result = await createChild(currentFamilyId, name, obGender);
  if (result.error) { err.textContent = result.error; return; }

  childrenCache.push({ id: result.childId, name, gender: obGender });
  const extraUpdates = {};
  if (obChildPhoto) extraUpdates.photo = obChildPhoto;
  if (obEmoji) extraUpdates.emoji = obEmoji;
  if (obColor) extraUpdates.color = obColor;
  if (Object.keys(extraUpdates).length > 0) await saveChild(currentFamilyId, result.childId, extraUpdates);

  const inviteCode = result.code || null;
  const savedName = name; const savedGender = obGender;
  resetOb1Form();
  showChildAddedPopup(savedName, savedGender, inviteCode, () => {}, () => goToOnboard2());
};

document.getElementById('ob2-back').onclick = () => { updateOb1Title(); showScreen('screen-onboard-1'); };
document.getElementById('ob2-skip').onclick = () => showScreen('screen-onboard-3');
document.getElementById('ob2-share').onclick = () => {
  const code = document.getElementById('ob2-code').textContent.trim();
  shareParentCode(code);
};
document.getElementById('ob3-back').onclick = () => showScreen('screen-onboard-2');
document.getElementById('ob3-allow').onclick = async () => {
  try {
    // requestPushPermission חייב להיות ראשון — לפני כל await אחר
    // כדי שהדפדפן יזהה שזה ממש user gesture ויציג את הדיאלוג
    const token = await requestPushPermission();
    if (token) {
      const [{ db: _db }, { currentFamilyId: _fid }] = await Promise.all([
        import('./firebase.js'),
        import('./auth.js'),
      ]);
      if (_fid) await saveParentFcmToken(_db, _fid, token);
    }
  } catch(e) { console.warn('ob3-allow FCM error:', e); }
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
  dots.forEach((d, i) => { if (d) d.onclick = () => { clearInterval(autoInterval); goTo(i); startAuto(); }; });
  let startX = 0, autoInterval, isDragging = false;
  const startAuto = () => { clearInterval(autoInterval); autoInterval = setInterval(() => goTo((current + 1) % 3), 4800); };

  slider.addEventListener('touchstart', e => { startX = e.touches[0].clientX; clearInterval(autoInterval); track.style.transition = 'none'; }, { passive: true });
  slider.addEventListener('touchend', e => {
    track.style.transition = 'transform 0.38s cubic-bezier(0.4,0,0.2,1)';
    const dx = e.changedTouches[0].clientX - startX;
    if (Math.abs(dx) > 48) goTo(dx > 0 ? current - 1 : current + 1); else goTo(current);
    startAuto();
  });

  slider.addEventListener('mousedown', e => {
    startX = e.clientX;
    isDragging = true;
    clearInterval(autoInterval);
    track.style.transition = 'none';
    e.preventDefault();
  });
  window.addEventListener('mouseup', e => {
    if (!isDragging) return;
    isDragging = false;
    track.style.transition = 'transform 0.38s cubic-bezier(0.4,0,0.2,1)';
    const dx = e.clientX - startX;
    if (Math.abs(dx) > 48) goTo(dx > 0 ? current - 1 : current + 1); else goTo(current);
    startAuto();
  });
  slider.addEventListener('mouseleave', () => {
    if (!isDragging) return;
    isDragging = false;
    track.style.transition = 'transform 0.38s cubic-bezier(0.4,0,0.2,1)';
    goTo(current);
    startAuto();
  });

  startAuto();
})();
