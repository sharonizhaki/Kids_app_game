import { auth, db } from './firebase.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

import { showScreen, showToast, showLoading, hideLoading, openSideMenu, closeSideMenu, showConfirm } from './ui.js';
import { cropAndCompressPhoto } from './utils.js';
import { logoutParent, currentFamilyId, setCurrentFamilyId, confirmDeleteAccount, deleteAccount } from './auth.js';
import {
  childrenCache, clearChildrenCache, loadChildren, renderFamily,
  createChild, saveChild, deleteChild,
  createParentInviteCode, shareCode, shareParentCode,
  CHILD_EMOJIS, CHILD_COLORS, colorGradient,
  renderDashboardChildren, renderDashTaskRows, saveWeeklySnapshot,
  showChildInviteModal
} from './family.js';
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

async function refreshQuickTasksBanner(familyId) {
  const banner = document.getElementById('quick-tasks-banner');
  if (!banner) return;
  if (localStorage.getItem(quickBannerKey()) === '1') { banner.style.display = 'none'; return; }
  try {
    const { collection, getDocs } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
    const snap = await getDocs(collection(db, 'families', familyId, 'tasks'));
    banner.style.display = snap.empty ? 'block' : 'none';
  } catch(e) { banner.style.display = 'none'; }
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
      const labels = { hygiene: 'היגיינה', chores: 'מטלות בית', study: 'לימודים' };
      triggerEl.style.opacity = '1';
      triggerEl.style.background = 'rgba(22,163,74,0.10)';
      triggerEl.style.borderColor = '#16A34A';
      triggerEl.innerHTML = `<div style="font-size:1.5rem;margin-bottom:4px;">✅</div><div style="font-size:0.78rem;font-weight:800;color:#15803D;">${labels[category] || ''}</div><div style="font-size:0.65rem;color:#15803D;margin-top:2px;">נוסף!</div>`;
      triggerEl.style.cursor = 'default';
      const allDone = [...document.querySelectorAll('#quick-tasks-inner .quick-cat-btn')].every(b => b.innerHTML.includes('✅'));
      if (allDone) setTimeout(animateBannerAway, 950);
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

  // Check if no children → redirect to onboarding
  await loadChildren(currentFamilyId);
  if (childrenCache.length === 0) {
    window.location.href = 'index.html';
    return;
  }

  hideLoading();
  showScreen('screen-dashboard');
  renderDashboardChildren(currentFamilyId);
  refreshQuickTasksBanner(currentFamilyId);
  renderDashTaskRows(currentFamilyId);
  saveWeeklySnapshot(currentFamilyId).catch(() => {});

  // Quick banner buttons
  document.getElementById('btn-quick-banner-close').addEventListener('click', dismissQuickBanner);
  document.querySelectorAll('.quick-cat-btn').forEach(btn => {
    btn.addEventListener('click', function() { handleQuickTasks(this, this.dataset.cat); });
  });
})();

// =========== DASHBOARD NAVIGATION ===========
document.getElementById('btn-manage-family').onclick = async () => {
  showScreen('screen-manage-family');
  await loadChildren(getFamilyId());
  renderFamily(getFamilyId());
};

document.getElementById('btn-add-tasks').onclick = () => {
  window.location.href = 'tasks.html?mode=add';
};

document.getElementById('btn-edit-tasks').onclick = () => {
  window.location.href = 'tasks.html?mode=edit';
};

document.getElementById('btn-manage-points').onclick = () => {
  window.location.href = 'points.html';
};

document.getElementById('btn-add-prizes').onclick = () => {
  window.location.href = 'prizes.html';
};

document.getElementById('btn-manage-prizes').onclick = () => {
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
  setTimeout(() => document.getElementById('child-name-input').focus(), 350);
};

function resetNewChildUI() {
  const ncpc = document.getElementById('new-child-photo-circle');
  ncpc.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#818CF8" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>`;
  ncpc.style.borderStyle = 'dashed'; ncpc.style.borderColor = '#818CF8';
  document.getElementById('new-child-photo-input').value = '';
  const emojiEl = document.getElementById('new-child-emoji-display');
  emojiEl.textContent = '?'; emojiEl.style.background = 'linear-gradient(135deg,#EDE9FE,#C7D2FE)'; emojiEl.style.borderStyle = 'dashed';
  const colorEl = document.getElementById('new-child-color-display');
  colorEl.style.background = 'linear-gradient(135deg,#EDE9FE,#C7D2FE)'; colorEl.style.borderStyle = 'dashed';
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
  if (!name) { errEl.textContent = 'חובה להכניס שם ילד/ה'; return; }
  if (!selectedGender) { errEl.textContent = 'חובה לבחור בן או בת'; return; }
  const nameLC = name.toLowerCase();
  const duplicate = childrenCache.find(c => c.name && c.name.toLowerCase() === nameLC);
  if (duplicate) { errEl.textContent = `ילד/ה בשם "${name}" כבר קיים/ת`; return; }

  const result = await createChild(getFamilyId(), name, selectedGender, {
    emoji: newChildEmoji, color: newChildColor, photo: newChildPhotoData || ''
  });
  if (result.error) { errEl.textContent = result.error; return; }
  childrenCache.push({ id: result.childId, name, gender: selectedGender });
  document.getElementById('invite-code-value').textContent = result.code;
  showScreen('screen-invite-code');
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
    ncpc.style.borderStyle = 'solid';
  } catch(err) { showToast('שגיאה ⚠️'); }
};

function showNewChildEmojiModal() {
  const ov = document.createElement('div'); ov.className = 'modal-overlay';
  const sh = document.createElement('div'); sh.className = 'modal-sheet';
  sh.innerHTML = `<div class="modal-handle"></div><div class="modal-header"><h2>🙂 בחר אימוג'י</h2><button class="modal-close">✕</button></div><div class="modal-body"><div class="emoji-grid">${CHILD_EMOJIS.map(e => `<div class="emoji-opt${e === newChildEmoji ? ' selected' : ''}" data-emoji="${e}">${e}</div>`).join('')}</div></div>`;
  sh.querySelector('.modal-close').onclick = () => ov.remove();
  ov.onclick = e => { if (e.target === ov) ov.remove(); };
  sh.querySelectorAll('.emoji-opt').forEach(el => {
    el.onclick = () => {
      newChildEmoji = el.dataset.emoji;
      const ed = document.getElementById('new-child-emoji-display');
      ed.textContent = newChildEmoji; ed.style.background = 'transparent'; ed.style.borderStyle = 'solid';
      ov.remove();
    };
  });
  ov.appendChild(sh); document.body.appendChild(ov);
}

function showNewChildColorModal() {
  const ov = document.createElement('div'); ov.className = 'modal-overlay';
  const sh = document.createElement('div'); sh.className = 'modal-sheet';
  sh.innerHTML = `<div class="modal-handle"></div><div class="modal-header"><h2>🎨 בחר צבע</h2><button class="modal-close">✕</button></div><div class="modal-body"><div class="color-grid">${CHILD_COLORS.map(c => `<div class="color-opt${c === newChildColor ? ' selected' : ''}" data-color="${c}" style="background:${colorGradient(c)}"></div>`).join('')}</div></div>`;
  sh.querySelector('.modal-close').onclick = () => ov.remove();
  ov.onclick = e => { if (e.target === ov) ov.remove(); };
  sh.querySelectorAll('.color-opt').forEach(el => {
    el.onclick = () => {
      newChildColor = el.dataset.color;
      const cd = document.getElementById('new-child-color-display');
      cd.style.background = colorGradient(newChildColor); cd.style.borderStyle = 'solid';
      ov.remove();
    };
  });
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
  colorEl.style.background = child.color ? colorGradient(child.color) : 'linear-gradient(135deg,#EDE9FE,#C7D2FE)';
  colorEl.style.borderStyle = child.color ? 'solid' : 'dashed';
  colorEl.onclick = () => showEditColorModal(child.color);
  editEmoji = child.emoji || '';
  const emojiEl = document.getElementById('edit-child-emoji-display');
  emojiEl.textContent = child.emoji || '';
  emojiEl.style.borderStyle = child.emoji ? 'solid' : 'dashed';
  emojiEl.onclick = () => showEditEmojiModal(child.emoji);
  const photoCircle = document.getElementById('edit-child-photo-circle');
  const clearBtn = document.getElementById('btn-clear-photo');
  const svgPlaceholder = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#818CF8" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>`;
  if (child.photo && child.photo.length > 10) {
    photoCircle.innerHTML = `<img src="${child.photo}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
    photoCircle.style.borderStyle = 'solid';
    clearBtn.style.display = 'block';
  } else {
    photoCircle.innerHTML = svgPlaceholder;
    photoCircle.style.borderStyle = 'dashed';
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
    pc.style.borderStyle = 'solid';
    document.getElementById('btn-clear-photo').style.display = 'block';
  } catch(err) { showToast('שגיאה ⚠️'); }
};

document.getElementById('btn-clear-photo').onclick = () => {
  editPhotoData = null; editPhotoCleared = true;
  const pc = document.getElementById('edit-child-photo-circle');
  pc.innerHTML = _editSvgPlaceholder;
  pc.style.borderStyle = 'dashed';
  document.getElementById('btn-clear-photo').style.display = 'none';
  document.getElementById('edit-photo-input').value = '';
};

document.getElementById('btn-save-child').onclick = async () => {
  const name = document.getElementById('edit-child-name').value.trim();
  if (!name) { document.getElementById('edit-child-error').textContent = 'חובה להכניס שם'; return; }
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
  const ov = document.createElement('div'); ov.className = 'modal-overlay';
  const sh = document.createElement('div'); sh.className = 'modal-sheet';
  sh.innerHTML = `<div class="modal-handle"></div><div class="modal-header"><h2>🙂 בחר אימוג'י</h2><button class="modal-close">✕</button></div><div class="modal-body"><div class="emoji-grid">${CHILD_EMOJIS.map(e => `<div class="emoji-opt${e === current ? ' selected' : ''}" data-emoji="${e}">${e}</div>`).join('')}</div></div>`;
  sh.querySelector('.modal-close').onclick = () => ov.remove();
  ov.onclick = e => { if (e.target === ov) ov.remove(); };
  sh.querySelectorAll('.emoji-opt').forEach(el => {
    el.onclick = () => { editEmoji = el.dataset.emoji; const ed = document.getElementById('edit-child-emoji-display'); ed.textContent = editEmoji; ed.style.borderStyle = 'solid'; ov.remove(); };
  });
  ov.appendChild(sh); document.body.appendChild(ov);
}

function showEditColorModal(current) {
  const ov = document.createElement('div'); ov.className = 'modal-overlay';
  const sh = document.createElement('div'); sh.className = 'modal-sheet';
  sh.innerHTML = `<div class="modal-handle"></div><div class="modal-header"><h2>🎨 בחר צבע</h2><button class="modal-close">✕</button></div><div class="modal-body"><div class="color-grid">${CHILD_COLORS.map(c => `<div class="color-opt${c === current ? ' selected' : ''}" data-color="${c}" style="background:${colorGradient(c)}"></div>`).join('')}</div></div>`;
  sh.querySelector('.modal-close').onclick = () => ov.remove();
  ov.onclick = e => { if (e.target === ov) ov.remove(); };
  sh.querySelectorAll('.color-opt').forEach(el => {
    el.onclick = () => { editColor = el.dataset.color; const cd = document.getElementById('edit-child-color-display'); cd.style.background = colorGradient(editColor); cd.style.borderStyle = 'solid'; ov.remove(); };
  });
  ov.appendChild(sh); document.body.appendChild(ov);
}

// =========== DASH TOUR (stub — same logic as before) ===========
async function startDashTour(familyId, uid) {
  // אותו קוד כמו ב-main.js המקורי — ניתן להעתיק מהמקור
  showToast('סיור מודרך 🧭');
}
