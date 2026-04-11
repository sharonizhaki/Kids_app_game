import { auth, db } from './firebase.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

import { showScreen, showToast, showLoading, hideLoading, openSideMenu, closeSideMenu, showConfirm } from './ui.js';
import { cropAndCompressPhoto } from './ui.js';
import { logoutParent, currentFamilyId, setCurrentFamilyId, confirmDeleteAccount, deleteAccount } from './auth.js';
import {
  childrenCache, clearChildrenCache, loadChildren, renderFamily,
  createChild, saveChild, deleteChild,
  createParentInviteCode, shareCode, shareParentCode,
  CHILD_EMOJIS, CHILD_COLORS, colorGradient,
  renderDashboardChildren, renderDashTaskRows, saveWeeklySnapshot,
  showChildInviteModal
} from './family.js';
import { SPLAT_SVG } from './icons.js';
import { createQuickTasks } from './tasks.js';

// =========== GUARD: הורה חייב להיות מחובר ===========
function checkAuth() {
  return new Promise((resolve) => {
    let timeoutId;
    const unsub = onAuthStateChanged(auth, (user) => {
      unsub();
      clearTimeout(timeoutId);
      if (!user || user.isAnonymous) {
        window.location.href = 'index.html';
      } else {
        resolve(user);
      }
    });
    // timeout safety — redirect only if auth never responds
    timeoutId = setTimeout(() => { window.location.href = 'index.html'; }, 5000);
  });
}

// =========== GLOBALS ===========
window.showScreen = showScreen;
window.showChildInviteModal = (childId) => showChildInviteModal(childId, currentFamilyId);
window.openEditChild = openEditChild;
window.renderFamily = () => renderFamily(currentFamilyId);

function getFamilyId() { return currentFamilyId; }

// =========== QUICK TASKS BANNER ===========
function quickBannerKey() { return `quickBannerDismissed_${currentFamilyId || 'none'}`; }
function quickClickedKey() { return `quickBannerClicked_${currentFamilyId || 'none'}`; }

function getClickedCategories() {
  try { return JSON.parse(localStorage.getItem(quickClickedKey()) || '[]'); } catch(e) { return []; }
}
function saveClickedCategory(cat) {
  const clicked = getClickedCategories();
  if (!clicked.includes(cat)) { clicked.push(cat); localStorage.setItem(quickClickedKey(), JSON.stringify(clicked)); }
}

function markButtonDone(btn) {
  const cat = btn.dataset.cat;
  const labels = { hygiene: 'היגיינה', chores: 'מטלות בית', study: 'לימודים' };
  btn.style.opacity = '1';
  btn.style.background = 'rgba(22,163,74,0.10)';
  btn.style.borderColor = '#16A34A';
  btn.innerHTML = `<div style="font-size:1.5rem;margin-bottom:4px;">✅</div><div style="font-size:0.78rem;font-weight:800;color:#15803D;">${labels[cat] || ''}</div><div style="font-size:0.65rem;color:#15803D;margin-top:2px;">נוסף!</div>`;
  btn.style.cursor = 'default';
  btn.disabled = true;
}

function refreshQuickTasksBanner() {
  const banner = document.getElementById('quick-tasks-banner');
  if (!banner) return;
  if (localStorage.getItem(quickBannerKey()) === '1') { banner.style.display = 'none'; return; }
  banner.style.display = 'block';
  const clicked = getClickedCategories();
  document.querySelectorAll('#quick-tasks-inner .quick-cat-btn').forEach(btn => {
    if (clicked.includes(btn.dataset.cat)) markButtonDone(btn);
  });
}

function animateBannerAway() {
  const inner = document.getElementById('quick-tasks-inner');
  const banner = document.getElementById('quick-tasks-banner');
  if (!inner || !banner) return;
  inner.style.transition = 'transform 0.1s ease-out,opacity 0.1s ease';
  inner.style.transform = 'scale(1.05)';
  setTimeout(() => {
    inner.style.transition = 'transform 0.5s cubic-bezier(.55,1.8,.65,.8),opacity 0.38s ease';
    inner.style.transformOrigin = 'top left';
    inner.style.transform = 'scale(0) rotate(-20deg)';
    inner.style.opacity = '0';
    setTimeout(() => {
      const h = banner.offsetHeight;
      banner.style.overflow = 'hidden';
      banner.style.maxHeight = h + 'px';
      banner.style.transition = 'max-height 0.36s cubic-bezier(.4,0,.2,1),margin-top 0.36s ease';
      requestAnimationFrame(() => { banner.style.maxHeight = '0'; banner.style.marginTop = '0'; });
      setTimeout(() => { banner.style.display = 'none'; }, 380);
    }, 440);
  }, 90);
}

function dismissQuickBanner() {
  localStorage.setItem(quickBannerKey(), '1');
  animateBannerAway();
}

async function handleQuickTasks(triggerEl, category) {
  const fid = getFamilyId();
  if (!fid) return;
  if (triggerEl) { triggerEl.disabled = true; triggerEl.style.opacity = '0.55'; }
  try {
    const ok = await createQuickTasks(fid, category);
    if (ok && triggerEl) {
      saveClickedCategory(category);
      markButtonDone(triggerEl);
      const allDone = [...document.querySelectorAll('#quick-tasks-inner .quick-cat-btn')].every(b => b.disabled || b.innerHTML.includes('✅'));
      if (allDone) {
        localStorage.setItem(quickBannerKey(), '1');
        setTimeout(animateBannerAway, 950);
      }
    }
  } finally {
    if (triggerEl && !triggerEl.innerHTML.includes('✅')) { triggerEl.disabled = false; triggerEl.style.opacity = ''; }
  }
}

// =========== INIT ===========
(async () => {
  const user = await checkAuth();

  // familyId — נטען מ-auth module
  const { getDocs, collection, query, where } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
  try {
    let famSnap = await getDocs(query(collection(db, 'families'), where('parentUid', '==', user.uid)));
    if (famSnap.empty) famSnap = await getDocs(query(collection(db, 'families'), where('secondaryParentUid', '==', user.uid)));
    if (!famSnap.empty) setCurrentFamilyId(famSnap.docs[0].id);
    else { window.location.href = 'index.html'; return; }
  } catch(e) { window.location.href = 'index.html'; return; }

  const name = user.displayName ? user.displayName.split(' ')[0] : 'הורה';
  document.getElementById('dash-greeting').textContent = `שלום ${name}! 👋`;

  // Check if no children → redirect to onboarding (לא לשני הורים)
  await loadChildren(currentFamilyId);
  const isSecondaryParent = sessionStorage.getItem('isSecondaryParent') === '1';
  sessionStorage.removeItem('isSecondaryParent');
  if (childrenCache.length === 0 && !isSecondaryParent) {
    // fallback — לא אמור לקרות, אבל למקרה קיצון
    window.location.href = 'index.html?onboard=1';
    return;
  }

  hideLoading();
  showScreen('screen-dashboard');
  renderDashboardChildren(currentFamilyId);
  refreshQuickTasksBanner();
  renderDashTaskRows(currentFamilyId);
  saveWeeklySnapshot(currentFamilyId).catch(() => {});

  // Quick banner buttons
  document.getElementById('btn-quick-banner-close').addEventListener('click', dismissQuickBanner);
  document.querySelectorAll('.quick-cat-btn').forEach(btn => {
    btn.addEventListener('click', function() { handleQuickTasks(this, this.dataset.cat); });
  });

  // הפעל טוטוריאל חד-פעמי לדשבורד
  const uid = user.uid;
  if (!localStorage.getItem('dashTourDone_' + uid)) {
    setTimeout(() => startDashTour(currentFamilyId, uid), 700);
  }
})();

// =========== DASHBOARD NAVIGATION ===========
document.getElementById('btn-manage-family').onclick = async () => {
  showScreen('screen-manage-family');
  await loadChildren(getFamilyId());
  renderFamily(getFamilyId());
};

document.getElementById('btn-add-tasks').onclick = () => {
  sessionStorage.setItem('tasksMode', 'add');
  window.location.href = 'tasks.html';
};

document.getElementById('btn-edit-tasks').onclick = () => {
  sessionStorage.setItem('tasksMode', 'edit');
  window.location.href = 'tasks.html';
};

document.getElementById('btn-manage-points').onclick = () => {
  window.location.href = 'points.html';
};

document.getElementById('btn-add-prizes').onclick = () => {
  localStorage.setItem('prizesTab', 'add');
  window.location.href = 'prizes.html';
};

document.getElementById('btn-manage-prizes').onclick = () => {
  localStorage.setItem('prizesTab', 'manage');
  window.location.href = 'prizes.html';
};

document.getElementById('btn-logout').onclick = () => {
  logoutParent(() => {
    clearChildrenCache();
    window.location.href = 'index.html';
  });
};

document.getElementById('btn-delete-account').onclick = () => {
  confirmDeleteAccount(() => {
    deleteAccount(getFamilyId(), () => {
      clearChildrenCache();
      window.location.href = 'index.html';
    });
  });
};

document.getElementById('btn-delete-account-dev').onclick = () => {
  document.getElementById('btn-delete-account').click();
};

// Modal: no child
document.getElementById('modal-no-child-back').onclick = () => {
  document.getElementById('modal-no-child').style.display = 'none';
};
document.getElementById('modal-no-child-create').onclick = () => {
  document.getElementById('modal-no-child').style.display = 'none';
  showScreen('screen-manage-family');
};

// =========== SIDE MENU ===========
document.getElementById('btn-open-menu').onclick = () => {
  const existing = document.getElementById('side-menu');
  if (existing) { existing.remove(); document.getElementById('side-overlay')?.remove(); return; }
  openSideMenu({
    auth,
    onAction: (action) => {
      if (action === 'manage-family') document.getElementById('btn-manage-family').click();
      else if (action === 'add-tasks') document.getElementById('btn-add-tasks').click();
      else if (action === 'edit-tasks') document.getElementById('btn-edit-tasks').click();
      else if (action === 'add-prizes') document.getElementById('btn-add-prizes').click();
      else if (action === 'manage-prizes') document.getElementById('btn-manage-prizes').click();
      else if (action === 'manage-points') document.getElementById('btn-manage-points').click();
      else if (action === 'logout') document.getElementById('btn-logout').click();
      else if (action === 'contact') window.open('mailto:support@example.com', '_blank');
      else if (action === 'terms') window.open('terms.html', '_blank');
      else if (action === 'delete-account') document.getElementById('btn-delete-account').click();
      else if (action === 'replay-tour') startDashTour(currentFamilyId, auth.currentUser?.uid);
    }
  });
};

document.getElementById('btn-replay-tour').onclick = () => {
  const uid = auth.currentUser?.uid;
  if (uid) localStorage.removeItem('dashTourDone_' + uid);
  startDashTour(currentFamilyId, uid);
};

// =========== MANAGE FAMILY ===========
let selectedGender = '';
let newChildEmoji = '';
let newChildColor = '';
let newChildPhotoData = null;

document.getElementById('gender-male').onclick = () => {
  selectedGender = 'male';
  document.getElementById('gender-male').classList.add('selected');
  document.getElementById('gender-female').classList.remove('selected');
};
document.getElementById('gender-female').onclick = () => {
  selectedGender = 'female';
  document.getElementById('gender-female').classList.add('selected');
  document.getElementById('gender-male').classList.remove('selected');
};

document.getElementById('btn-create-child').onclick = () => {
  document.getElementById('child-name-input').value = '';
  document.getElementById('create-child-error').textContent = '';
  selectedGender = ''; newChildEmoji = ''; newChildColor = ''; newChildPhotoData = null;
  document.querySelectorAll('#create-gender-picker .gender-opt').forEach(g => g.classList.remove('selected'));
  resetNewChildUI();
  showScreen('screen-create-child');
};

function resetNewChildUI() {
  const ncpc = document.getElementById('new-child-photo-circle');
  ncpc.innerHTML = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#818CF8" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>`;
  ncpc.style.border = '3px dashed #818CF8';
  document.getElementById('new-child-photo-input').value = '';
  const emojiEl = document.getElementById('new-child-emoji-display');
  emojiEl.textContent = '?';
  emojiEl.style.background = 'linear-gradient(135deg,#EDE9FE,#C7D2FE)';
  emojiEl.style.border = '3px dashed #818CF8';
  emojiEl.style.fontSize = '';
  const colorEl = document.getElementById('new-child-color-display');
  colorEl.innerHTML = SPLAT_SVG('#94A3B8', 75, true); colorEl.style.background = 'transparent'; colorEl.style.border = 'none'; colorEl.style.borderRadius = '0';
}

document.getElementById('btn-invite-parent').onclick = async () => {
  const result = await createParentInviteCode(getFamilyId());
  if (result.error) { showToast('שגיאה ביצירת קוד'); return; }
  document.getElementById('parent-invite-code-value').textContent = result.code;
  showScreen('screen-parent-invite');
};

document.getElementById('btn-share-parent-code').onclick = () => {
  shareParentCode(document.getElementById('parent-invite-code-value').textContent);
};

document.getElementById('btn-do-create-child').onclick = async () => {
  const name = document.getElementById('child-name-input').value.trim();
  const errEl = document.getElementById('create-child-error');
  errEl.textContent = '';
  if (!name) { errEl.textContent = 'נא להזין שם'; return; }
  if (!selectedGender) { errEl.textContent = 'נא לבחור מין'; return; }
  const nameLC = name.toLowerCase();
  const duplicate = childrenCache.find(c => c.name && c.name.toLowerCase() === nameLC);
  if (duplicate) { errEl.textContent = `"${name}" כבר קיים/ת במשפחה`; return; }

  const result = await createChild(getFamilyId(), name, selectedGender, {
    emoji: newChildEmoji, color: newChildColor, photo: newChildPhotoData || ''
  });
  if (result.error) { errEl.textContent = result.error; return; }
  childrenCache.push({ id: result.childId, name, gender: selectedGender, status: 'waiting', inviteCode: result.code });

  const isBoy = selectedGender === 'male';
  const inviteCode = result.code;
  const backdrop = document.createElement('div');
  backdrop.style.cssText = 'position:fixed;inset:0;z-index:7000;background:rgba(15,23,42,0.55);display:flex;align-items:center;justify-content:center;padding:24px;';
  const card = document.createElement('div');
  card.style.cssText = 'background:white;border-radius:28px;padding:30px 24px 24px;width:100%;max-width:340px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,0.28);direction:rtl;font-family:Heebo,sans-serif;';

  const codeBlock = inviteCode ? `
    <div style="background:linear-gradient(135deg,#EEF2FF,#E0E7FF);border-radius:18px;padding:14px 16px;margin-bottom:16px;">
      <div style="font-size:0.72rem;font-weight:700;color:#6366F1;margin-bottom:6px;">קוד כניסה לילד/ה</div>
      <div style="font-size:2rem;font-weight:900;color:#4338CA;letter-spacing:8px;direction:ltr;font-variant-numeric:tabular-nums;">${inviteCode}</div>
      <div style="font-size:0.7rem;color:#818CF8;margin-top:6px;font-weight:600;">⏰ תקף ל-24 שעות</div>
    </div>` : '';

  card.innerHTML = `
    <div style="font-size:3.2rem;margin-bottom:10px;">🎉</div>
    <div style="font-size:1.25rem;font-weight:900;color:#1E293B;margin-bottom:6px;">${name} ${isBoy ? 'נוסף' : 'נוספה'} בהצלחה!</div>
    <div style="font-size:0.86rem;color:#64748B;margin-bottom:20px;">${isBoy ? 'הוא' : 'היא'} כבר חלק מהמשפחה ✨</div>
    ${codeBlock}
    <div style="display:flex;gap:8px;">
      ${inviteCode ? `<button id="pop-share-code" style="flex:1;padding:13px 8px;background:linear-gradient(135deg,#10B981,#059669);border:none;border-radius:16px;font-size:0.88rem;font-weight:900;font-family:Heebo,sans-serif;cursor:pointer;color:white;">📤 שתף קוד</button>` : ''}
      <button id="pop-back" style="flex:1;padding:13px;background:linear-gradient(135deg,#6366F1,#4F46E5);border:none;border-radius:16px;font-size:0.88rem;font-weight:900;font-family:Heebo,sans-serif;cursor:pointer;color:white;">חזור</button>
    </div>`;

  backdrop.appendChild(card);
  document.body.appendChild(backdrop);

  if (inviteCode) {
    card.querySelector('#pop-share-code').onclick = () => {
      shareCode(inviteCode, name);
    };
  }
  card.querySelector('#pop-back').onclick = () => {
    backdrop.remove();
    showScreen('screen-manage-family');
    renderFamily(getFamilyId());
  };
};

document.getElementById('btn-share-code').onclick = () => {
  shareCode(document.getElementById('invite-code-value').textContent);
};

document.getElementById('new-child-photo-input').onchange = async (e) => {
  const file = e.target.files[0]; if (!file) return;
  try {
    newChildPhotoData = await cropAndCompressPhoto(file);
    const ncpc = document.getElementById('new-child-photo-circle');
    ncpc.innerHTML = `<img src="${newChildPhotoData}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
    ncpc.style.border = 'none';
  } catch(err) { showToast('שגיאה ⚠️'); }
};

function showNewChildEmojiModal() {
  let tempEmoji = newChildEmoji;
  const ov = document.createElement('div'); ov.className = 'modal-overlay';
  const sh = document.createElement('div'); sh.className = 'modal-sheet';
  sh.innerHTML = `<div class="modal-handle"></div>
    <div class="modal-header"><h2>🙂 בחר אימוג'י</h2><button class="modal-close">✕</button></div>
    <div class="modal-body">
      <div id="emoji-preview-display" style="font-size:4rem;text-align:center;min-height:64px;margin-bottom:12px;transition:transform 0.2s cubic-bezier(.34,1.28,.64,1);">${tempEmoji || '?'}</div>
      <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:6px;margin-bottom:16px;">
        ${CHILD_EMOJIS.map(e => `<div class="emoji-opt${e === tempEmoji ? ' selected' : ''}" data-emoji="${e}" style="font-size:1.6rem;aspect-ratio:1;display:flex;align-items:center;justify-content:center;border-radius:12px;cursor:pointer;">${e}</div>`).join('')}
      </div>
      <button id="emoji-confirm-btn" style="width:100%;padding:14px;background:linear-gradient(135deg,#6366F1,#4F46E5);border:none;border-radius:16px;font-size:1rem;font-weight:900;font-family:'Heebo',sans-serif;cursor:pointer;color:white;">אישור ✓</button>
    </div>`;
  sh.querySelector('.modal-close').onclick = () => ov.remove();
  ov.onclick = e => { if (e.target === ov) ov.remove(); };
  const preview = sh.querySelector('#emoji-preview-display');
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
    newChildEmoji = tempEmoji;
    const ed = document.getElementById('new-child-emoji-display');
    ed.textContent = newChildEmoji;
    ed.style.background = 'none';
    ed.style.border = 'none';
    ed.style.fontSize = '80px';
    ov.remove();
  };
  ov.appendChild(sh); document.body.appendChild(ov);
}

function showNewChildColorModal() {
  const ov = document.createElement('div'); ov.className = 'modal-overlay';
  const sh = document.createElement('div'); sh.className = 'modal-sheet';
  let tempColor = newChildColor;
  sh.innerHTML = `<div class="modal-handle"></div><div class="modal-header"><h2>🎨 בחר צבע</h2><button class="modal-close">✕</button></div><div class="modal-body">
    <div class="splat-modal-preview" id="modal-color-preview">
      ${newChildColor ? SPLAT_SVG(newChildColor, 115) : SPLAT_SVG('#94A3B8', 115, true)}
    </div>
    <div class="splat-color-grid">${CHILD_COLORS.map(c => `<div class="splat-color-opt${c === newChildColor ? ' splat-selected' : ''}" data-color="${c}">${SPLAT_SVG(c, 70)}</div>`).join('')}</div>
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
    newChildColor = tempColor;
    const cd = document.getElementById('new-child-color-display');
    cd.innerHTML = SPLAT_SVG(newChildColor, 75); cd.style.background = 'transparent'; cd.style.border = 'none'; cd.style.borderRadius = '0';
    ov.remove();
  };
  ov.appendChild(sh); document.body.appendChild(ov);
}

window.showNewChildEmojiModal = showNewChildEmojiModal;
window.showNewChildColorModal = showNewChildColorModal;

// =========== EDIT CHILD ===========
let editingChildId = null;
let editGender = '';
let editEmoji = '';
let editColor = '';
let editPhotoData = null;
let editPhotoCleared = false;

function openEditChild(childId) {
  const child = childrenCache.find(c => c.id === childId);
  if (!child) return;
  editingChildId = childId; editPhotoData = null; editPhotoCleared = false;
  document.getElementById('edit-child-name').value = child.name;
  editGender = child.gender;
  document.getElementById('edit-gender-male').classList.toggle('selected', child.gender === 'male');
  document.getElementById('edit-gender-female').classList.toggle('selected', child.gender === 'female');
  editColor = child.color || '';
  const colorEl = document.getElementById('edit-child-color-display');
  colorEl.innerHTML = child.color ? SPLAT_SVG(child.color, 75) : SPLAT_SVG('#94A3B8', 75, true);
  colorEl.style.background = 'transparent'; colorEl.style.border = 'none'; colorEl.style.borderRadius = '0';
  colorEl.onclick = () => showEditColorModal(child.color);
  editEmoji = child.emoji || '';
  const emojiEl = document.getElementById('edit-child-emoji-display');
  emojiEl.textContent = child.emoji || '';
  if (child.emoji) {
    emojiEl.style.background = 'none';
    emojiEl.style.border = 'none';
    emojiEl.style.fontSize = '80px';
  } else {
    emojiEl.style.background = 'linear-gradient(135deg,#EDE9FE,#C7D2FE)';
    emojiEl.style.border = '3px dashed #818CF8';
    emojiEl.style.fontSize = '';
  }
  emojiEl.onclick = () => showEditEmojiModal(child.emoji);
  const photoCircle = document.getElementById('edit-child-photo-circle');
  const clearBtn = document.getElementById('btn-clear-photo');
  const svgPlaceholder = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#818CF8" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>`;
  if (child.photo && child.photo.length > 10) {
    photoCircle.innerHTML = `<img src="${child.photo}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
    photoCircle.style.border = 'none';
    clearBtn.innerHTML = '🗑️ מחק';
    clearBtn.style.display = 'block';
  } else {
    photoCircle.innerHTML = svgPlaceholder;
    photoCircle.style.border = '3px dashed #818CF8';
    clearBtn.style.display = 'none';
  }
  const inviteSection = document.getElementById('edit-child-invite-section');
  if (child.status === 'waiting' && child.inviteCode) {
    inviteSection.style.display = 'block';
    document.getElementById('edit-child-invite-code').textContent = child.inviteCode;
  } else { inviteSection.style.display = 'none'; }
  document.getElementById('edit-child-error').textContent = '';
  showScreen('screen-edit-child');
}

document.getElementById('edit-gender-male').onclick = () => { editGender = 'male'; document.getElementById('edit-gender-male').classList.add('selected'); document.getElementById('edit-gender-female').classList.remove('selected'); };
document.getElementById('edit-gender-female').onclick = () => { editGender = 'female'; document.getElementById('edit-gender-female').classList.add('selected'); document.getElementById('edit-gender-male').classList.remove('selected'); };

const _editSvgPlaceholder = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#818CF8" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>`;

document.getElementById('edit-photo-input').onchange = async (e) => {
  const file = e.target.files[0]; if (!file) return;
  editPhotoCleared = false;
  try {
    editPhotoData = await cropAndCompressPhoto(file);
    const pc = document.getElementById('edit-child-photo-circle');
    pc.innerHTML = `<img src="${editPhotoData}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
    pc.style.border = 'none';
    const clearBtn = document.getElementById('btn-clear-photo');
    clearBtn.innerHTML = '🗑️ מחק';
    clearBtn.style.display = 'block';
  } catch(err) { showToast('שגיאה ⚠️'); }
};

document.getElementById('btn-clear-photo').onclick = () => {
  editPhotoData = null; editPhotoCleared = true;
  const pc = document.getElementById('edit-child-photo-circle');
  pc.innerHTML = _editSvgPlaceholder;
  pc.style.border = '3px dashed #818CF8';
  const clearBtn = document.getElementById('btn-clear-photo');
  clearBtn.style.display = 'none';
  clearBtn.innerHTML = '🗑️ מחק';
  document.getElementById('edit-photo-input').value = '';
};

document.getElementById('btn-save-child').onclick = async () => {
  const name = document.getElementById('edit-child-name').value.trim();
  if (!name) { document.getElementById('edit-child-error').textContent = 'נא להזין שם'; return; }
  const child = childrenCache.find(c => c.id === editingChildId);
  const updates = { name, gender: editGender || child.gender };
  if (editEmoji) updates.emoji = editEmoji;
  if (editColor) updates.color = editColor;
  if (editPhotoData) updates.photo = editPhotoData;
  if (editPhotoCleared) updates.photo = '';
  const result = await saveChild(getFamilyId(), editingChildId, updates);
  if (result.error) { document.getElementById('edit-child-error').textContent = result.error; return; }
  await loadChildren(getFamilyId());
  renderFamily(getFamilyId());
  showToast('נשמר! ✅');
  showScreen('screen-manage-family');
};

document.getElementById('btn-delete-child').onclick = () => {
  const child = childrenCache.find(c => c.id === editingChildId);
  showConfirm({
    icon: child?.emoji || '👦',
    title: `למחוק את ${child?.name || 'הילד/ה'}?`,
    message: 'כל המטלות, הנקודות וההיסטוריה יימחקו לצמיתות',
    confirmText: '🗑️ מחק',
    onConfirm: async () => {
      const result = await deleteChild(getFamilyId(), editingChildId);
      if (result.error) return;
      await loadChildren(getFamilyId());
      renderFamily(getFamilyId());
      showToast('נמחק! 🗑️');
      showScreen('screen-manage-family');
    }
  });
};

document.getElementById('btn-share-child-code-edit').onclick = () => {
  const code = document.getElementById('edit-child-invite-code').textContent;
  const child = childrenCache.find(c => c.id === editingChildId);
  shareCode(code, child?.name);
};

function showEditEmojiModal(current) {
  let tempEmoji = current || editEmoji;
  const ov = document.createElement('div'); ov.className = 'modal-overlay';
  const sh = document.createElement('div'); sh.className = 'modal-sheet';
  sh.innerHTML = `<div class="modal-handle"></div>
    <div class="modal-header"><h2>🙂 בחר אימוג'י</h2><button class="modal-close">✕</button></div>
    <div class="modal-body">
      <div id="emoji-preview-display" style="font-size:4rem;text-align:center;min-height:64px;margin-bottom:12px;transition:transform 0.2s cubic-bezier(.34,1.28,.64,1);">${tempEmoji || '?'}</div>
      <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:6px;margin-bottom:16px;">
        ${CHILD_EMOJIS.map(e => `<div class="emoji-opt${e === tempEmoji ? ' selected' : ''}" data-emoji="${e}" style="font-size:1.6rem;aspect-ratio:1;display:flex;align-items:center;justify-content:center;border-radius:12px;cursor:pointer;">${e}</div>`).join('')}
      </div>
      <button id="emoji-confirm-btn" style="width:100%;padding:14px;background:linear-gradient(135deg,#6366F1,#4F46E5);border:none;border-radius:16px;font-size:1rem;font-weight:900;font-family:'Heebo',sans-serif;cursor:pointer;color:white;">אישור ✓</button>
    </div>`;
  sh.querySelector('.modal-close').onclick = () => ov.remove();
  ov.onclick = e => { if (e.target === ov) ov.remove(); };
  const preview = sh.querySelector('#emoji-preview-display');
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
    editEmoji = tempEmoji;
    const ed = document.getElementById('edit-child-emoji-display');
    ed.textContent = editEmoji;
    ed.style.background = 'none';
    ed.style.border = 'none';
    ed.style.fontSize = '80px';
    ov.remove();
  };
  ov.appendChild(sh); document.body.appendChild(ov);
}

function showEditColorModal(current) {
  const ov = document.createElement('div'); ov.className = 'modal-overlay';
  const sh = document.createElement('div'); sh.className = 'modal-sheet';
  let tempColor = current || '';
  sh.innerHTML = `<div class="modal-handle"></div><div class="modal-header"><h2>🎨 בחר צבע</h2><button class="modal-close">✕</button></div><div class="modal-body">
    <div class="splat-modal-preview" id="modal-color-preview">
      ${current ? SPLAT_SVG(current, 115) : SPLAT_SVG('#94A3B8', 115, true)}
    </div>
    <div class="splat-color-grid">${CHILD_COLORS.map(c => `<div class="splat-color-opt${c === current ? ' splat-selected' : ''}" data-color="${c}">${SPLAT_SVG(c, 70)}</div>`).join('')}</div>
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
    editColor = tempColor;
    const cd = document.getElementById('edit-child-color-display');
    cd.innerHTML = SPLAT_SVG(editColor, 75); cd.style.background = 'transparent'; cd.style.border = 'none'; cd.style.borderRadius = '0';
    ov.remove();
  };
  ov.appendChild(sh); document.body.appendChild(ov);
}

// =========== DASH TOUR ===========
async function startDashTour(familyId, uid) {
  const { getDoc, doc, updateDoc } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');

  const steps = [
    {
      el: '#dash-children-grid',
      title: 'סקירת הילדים 👨‍👧‍👦',
      text: 'כאן תוכל לראות את כל הילדים — כוכבים שצברו השבוע והחודש, ומטלות שנותרו להיום'
    },
    {
      el: '#dash-task-section',
      title: 'מטלות להיום 📋',
      text: 'כאן מוצגות המטלות שנותרו לביצוע היום לכל ילד — מתחלפות אוטומטית אם יש כמה'
    },
    {
      el: '#quick-tasks-banner',
      title: 'יצירת משימות מהירה ⚡',
      text: 'בחר קטגוריה ו-5 מטלות מוכנות יתווספו אוטומטית לכל הילדים — חסוך זמן!'
    },
    {
      el: '#btn-open-menu',
      title: 'תפריט הגדרות ⚙️',
      text: 'כאן תוכל לנהל משפחה, מטלות, פרסים, נקודות ועוד — הכל במקום אחד',
      exact: true
    },
  ];

  // סנן שלבים שהאלמנט שלהם לא מוצג (כמו הבאנר אם נסגר)
  const visibleSteps = steps.filter(s => {
    const el = document.querySelector(s.el);
    return el && getComputedStyle(el).display !== 'none' && el.offsetHeight > 0;
  });
  if (!visibleSteps.length) return;

  let currentStep = 0;
  const PAD = 6;
  document.body.style.overflow = 'hidden';

  const overlay = document.createElement('div');
  overlay.className = 'tour-overlay';
  overlay.id = 'dash-tour-overlay';
  overlay.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

  const shutterTop = document.createElement('div');
  shutterTop.className = 'tour-shutter-top';
  shutterTop.style.height = '0px';

  const shutterBottom = document.createElement('div');
  shutterBottom.className = 'tour-shutter-bottom';
  shutterBottom.style.height = '0px';

  const card = document.createElement('div');
  card.className = 'tour-card';

  overlay.appendChild(shutterTop);
  overlay.appendChild(shutterBottom);
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  function showStep(idx) {
    const step = visibleSteps[idx];
    const rawEl = document.querySelector(step.el);
    if (!rawEl) { endTour(); return; }

    const el = step.exact ? rawEl : (rawEl.closest('.card') || rawEl.closest('[style]') || rawEl);

    card.classList.remove('visible');
    void card.offsetWidth;
    shutterTop.style.height = '0px';
    shutterBottom.style.height = '0px';
    rawEl.scrollIntoView({ behavior: 'smooth', block: 'center' });

    setTimeout(() => {
      const rect = el.getBoundingClientRect();
      shutterTop.style.height = Math.max(0, rect.top - PAD) + 'px';
      shutterBottom.style.height = Math.max(0, window.innerHeight - rect.bottom - PAD) + 'px';

      const dotsHTML = visibleSteps.map((_, i) => `<span class="tour-dot${i === idx ? ' active' : ''}"></span>`).join('');
      card.innerHTML = `
        <div class="tour-card-btns" style="margin-bottom:10px;">
          <span dir="ltr" style="font-size:0.78rem;color:var(--muted);">${idx + 1} / ${visibleSteps.length}</span>
          ${idx < visibleSteps.length - 1 ? '<button class="tour-skip-btn" id="tour-skip">דלג</button>' : ''}
        </div>
        <h4>${step.title}</h4>
        <p>${step.text}</p>
        <div style="display:flex;align-items:center;justify-content:space-between;">
          <div style="display:flex;gap:5px;">${dotsHTML}</div>
          <button class="tour-next-btn" id="tour-next">${idx === visibleSteps.length - 1 ? 'סיום ✅' : 'הבא ←'}</button>
        </div>`;

      const fitsBelow = rect.bottom + 190 < window.innerHeight;
      card.style.top    = fitsBelow ? (rect.bottom + 8) + 'px' : 'auto';
      card.style.bottom = fitsBelow ? 'auto' : (window.innerHeight - rect.top + 8) + 'px';

      document.getElementById('tour-next').onclick = () => {
        currentStep++;
        if (currentStep >= visibleSteps.length) endTour(); else showStep(currentStep);
      };
      document.getElementById('tour-skip')?.addEventListener('click', endTour);

      setTimeout(() => card.classList.add('visible'), 130);
    }, 520);
  }

  async function endTour() {
    card.classList.remove('visible');
    shutterTop.style.height = Math.ceil(window.innerHeight / 2 + 2) + 'px';
    shutterBottom.style.height = Math.ceil(window.innerHeight / 2 + 2) + 'px';
    setTimeout(() => {
      overlay.remove();
      document.body.style.overflow = '';
      if (uid) localStorage.setItem('dashTourDone_' + uid, '1');
    }, 540);
  }

  overlay.onclick = (e) => e.stopPropagation();
  showStep(0);
}
