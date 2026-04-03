import { auth, db } from './firebase.js';
import {
  signInAnonymously
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  doc, updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

import { showScreen, showToast, showLoading, hideLoading, openSideMenu, closeSideMenu, showConfirm } from './ui.js';
import { initAuth, loginWithGoogle, loginWithFacebook, logoutParent, createNewFamily, joinFamily, currentFamilyId, setCurrentFamilyId, confirmDeleteAccount, deleteAccount } from './auth.js';
import {
  childrenCache, clearChildrenCache, loadChildren, renderFamily,
  createChild, saveChild, deleteChild,
  createParentInviteCode, verifyChildCode,
  showChildInviteModal, shareCode, shareParentCode,
  CHILD_EMOJIS, CHILD_COLORS,
  renderDashboardChildren, renderDashTaskRows, saveWeeklySnapshot
} from './family.js';
import {
  openAddTask, saveTask, loadAllTasks,
  renderEditTasksFilters, renderEditTasksList,
  openEditTask, saveEditedTask, toggleHideTask, deleteTask,
  initSuggestions, startTaskTour, createQuickTasks
} from './tasks.js';
import {
  loadCompletedTasks, renderMPFilters, renderMPList, resetMPState
} from './points.js';

// =========== PHOTO CROP + COMPRESS ===========
function cropAndCompressPhoto(file, size = 300, quality = 0.75) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) return reject(new Error('לא קובץ תמונה'));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('שגיאה בקריאת הקובץ'));
    reader.onload = (ev) => {
      const img = new Image();
      img.onerror = () => reject(new Error('שגיאה בטעינת התמונה'));
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
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

// =========== GLOBALS (needed by inline onclick in HTML) ===========
window.showScreen = (id) => {
  showScreen(id);
  if (id === 'screen-dashboard' && currentFamilyId) {
    renderDashboardChildren(currentFamilyId);
    refreshQuickTasksBanner(currentFamilyId);
    renderDashTaskRows(currentFamilyId);
    saveWeeklySnapshot(currentFamilyId).catch(() => {});
  }
};

async function refreshQuickTasksBanner(familyId) {
  const banner = document.getElementById('quick-tasks-banner');
  if (!banner) return;
  try {
    const { collection, getDocs } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
    const snap = await getDocs(collection(db, 'families', familyId, 'tasks'));
    banner.style.display = snap.empty ? 'block' : 'none';
  } catch(e) { banner.style.display = 'none'; }
}

async function handleQuickTasks(triggerEl) {
  const fid = getFamilyId();
  if (!fid) return;
  if (triggerEl) { triggerEl.disabled = true; triggerEl.style.opacity = '0.5'; }
  try {
    const ok = await createQuickTasks(fid);
    if (ok) {
      // hide dashboard banner
      document.getElementById('quick-tasks-banner').style.display = 'none';
      // hide the form button
      const formBtn = document.getElementById('btn-quick-tasks-form');
      if (formBtn) formBtn.style.display = 'none';
      // navigate to edit tasks
      document.getElementById('btn-edit-tasks').click();
    }
  } finally {
    if (triggerEl) { triggerEl.disabled = false; triggerEl.style.opacity = ''; }
  }
}

window.showChildInviteModal = (childId) => showChildInviteModal(childId, getFamilyId());
window.openEditChild = openEditChild;
window.renderFamily = () => renderFamily(getFamilyId());

function getFamilyId() { return currentFamilyId; }

// =========== AUTH INIT ===========
initAuth(
  (user) => {
    hideLoading();
    renderDashboard(user);
  },
  () => {
    hideLoading();
    showScreen('screen-join-family');
  }
);

// =========== DASHBOARD ===========
function renderDashboard(user) {
  const name = user.displayName ? user.displayName.split(' ')[0] : 'הורה';
  document.getElementById('dash-greeting').textContent = `שלום ${name}! 👋`;
  showScreen('screen-dashboard');
  renderDashboardChildren(currentFamilyId);
  refreshQuickTasksBanner(currentFamilyId);
  renderDashTaskRows(currentFamilyId);
  // Fire-and-forget: save last week's stats if new week began
  saveWeeklySnapshot(currentFamilyId).catch(() => {});
}

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

// =========== DASHBOARD BUTTONS ===========
document.getElementById('btn-manage-family').onclick = async () => {
  showScreen('screen-manage-family');
  await loadChildren(getFamilyId());
  renderFamily(getFamilyId());
};

document.getElementById('btn-add-tasks').onclick = () => openAddTask(getFamilyId());
document.getElementById('btn-save-task').onclick = () => saveTask(getFamilyId());

// Modal: no child warning
document.getElementById('modal-no-child-back').onclick = () => {
  document.getElementById('modal-no-child').style.display = 'none';
};
document.getElementById('modal-no-child-create').onclick = () => {
  document.getElementById('modal-no-child').style.display = 'none';
  showScreen('screen-manage-family');
};

document.getElementById('quick-tasks-inner').onclick = function() { handleQuickTasks(null); };
document.getElementById('btn-quick-tasks-form').onclick = function() { handleQuickTasks(this); };

document.getElementById('btn-edit-tasks').onclick = async () => {
  showScreen('screen-edit-tasks');
  await loadAllTasks(getFamilyId());
  renderEditTasksFilters();
  renderEditTasksList(getFamilyId());
};

document.getElementById('btn-manage-points').onclick = async () => {
  resetMPState();
  showScreen('screen-manage-points');
  await loadCompletedTasks(getFamilyId());
  renderMPFilters();
  renderMPList(getFamilyId());
};

document.getElementById('btn-add-prizes').onclick = () => showToast('בקרוב! 🚧');
document.getElementById('btn-manage-prizes').onclick = () => showToast('בקרוב! 🚧');

document.getElementById('btn-logout').onclick = () => {
  logoutParent(() => {
    clearChildrenCache();
    showScreen('screen-who');
  });
};

document.getElementById('btn-delete-account').onclick = () => {
  confirmDeleteAccount(() => {
    const fid = getFamilyId();
    console.log('[deleteAccount] familyId =', fid);
    deleteAccount(fid, () => {
      clearChildrenCache();
      showScreen('screen-who');
    });
  });
};

document.getElementById('btn-delete-account-dev').onclick = () => {
  document.getElementById('btn-delete-account').click();
};

// =========== SIDE MENU ===========
document.getElementById('btn-open-menu').onclick = () => {
  const existing = document.getElementById('side-menu');
  if (existing) {
    existing.remove();
    document.getElementById('side-overlay')?.remove();
  } else {
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
        else if (action === 'replay-tour') {
          const uid = auth.currentUser?.uid;
          if (uid) localStorage.removeItem('dashTourDone_' + uid);
          setTimeout(() => startDashTour(currentFamilyId, uid), 300);
        }
      }
    });
  }
};

document.getElementById('btn-replay-tour').onclick = () => {
  const uid = auth.currentUser?.uid;
  if (uid) localStorage.removeItem('dashTourDone_' + uid);
  startDashTour(currentFamilyId, uid);
};

// =========== CREATE CHILD ===========
let selectedGender = '';

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

document.getElementById('btn-do-create-child').onclick = async () => {
  const name = document.getElementById('child-name-input').value.trim();
  const errEl = document.getElementById('create-child-error');

  // בדיקת שם כפול
  const nameLC = name.toLowerCase();
  const duplicate = childrenCache.find(c => c.name && c.name.toLowerCase() === nameLC);
  if (duplicate) {
    const isMale = duplicate.gender === 'male';
    errEl.textContent = `${isMale ? 'ילד' : 'ילדה'} בשם "${name}" כבר ${isMale ? 'קיים' : 'קיימת'} במשפחה`;
    const input = document.getElementById('child-name-input');
    input.style.borderColor = '#F59E0B';
    input.style.background  = '#FFFBEB';
    navigator.vibrate && navigator.vibrate([60, 30, 60]);
    setTimeout(() => { input.style.borderColor = ''; input.style.background = ''; }, 2200);
    return;
  }

  // ולידציה מקומית לפני קריאה לשרת
  if (!name) {
    errEl.textContent = 'חובה להכניס שם ילד/ה';
    const inp = document.getElementById('child-name-input');
    inp.style.borderColor = '#EF4444'; inp.style.background = '#FEF2F2';
    inp.focus();
    navigator.vibrate && navigator.vibrate([80, 40, 80]);
    setTimeout(() => { inp.style.borderColor = ''; inp.style.background = ''; }, 1800);
    return;
  }
  if (!selectedGender) {
    errEl.textContent = 'חובה לבחור בן או בת';
    const opts = document.querySelectorAll('#create-gender-picker .gender-opt');
    opts.forEach(o => { o.style.outline = '2.5px solid #EF4444'; o.style.background = '#FEF2F2'; });
    navigator.vibrate && navigator.vibrate([80, 40, 80]);
    setTimeout(() => opts.forEach(o => { o.style.outline = ''; o.style.background = ''; }), 1800);
    return;
  }

  const result = await createChild(getFamilyId(), name, selectedGender);
  if (result.error) {
    errEl.textContent = result.error;
    return;
  }
  // עדכן cache
  childrenCache.push({ id: result.childId, name, gender: selectedGender });
  document.getElementById('invite-code-value').textContent = result.code;
  showScreen('screen-invite-code');
};

document.getElementById('btn-share-code').onclick = () => {
  shareCode(document.getElementById('invite-code-value').textContent);
};

// =========== MANAGE FAMILY ===========
document.getElementById('btn-create-child').onclick = () => {
  document.getElementById('child-name-input').value = '';
  document.getElementById('create-child-error').textContent = '';
  selectedGender = '';
  document.querySelectorAll('#create-gender-picker .gender-opt').forEach(g => g.classList.remove('selected'));
  showScreen('screen-create-child');
  setTimeout(() => document.getElementById('child-name-input').focus(), 350);
};

document.getElementById('btn-invite-parent').onclick = async () => {
  const result = await createParentInviteCode(getFamilyId());
  if (result.error) { showToast('שגיאה ביצירת קוד'); return; }
  document.getElementById('parent-invite-code-value').textContent = result.code;
  showScreen('screen-parent-invite');
};

document.getElementById('btn-share-parent-code').onclick = () => {
  shareParentCode(document.getElementById('parent-invite-code-value').textContent);
};

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
  editingChildId = childId;
  editPhotoData = null;
  editPhotoCleared = false;

  document.getElementById('edit-child-name').value = child.name;
  editGender = child.gender;
  document.getElementById('edit-gender-male').classList.toggle('selected', child.gender === 'male');
  document.getElementById('edit-gender-female').classList.toggle('selected', child.gender === 'female');

  editColor = child.color || '';
  const colorEl = document.getElementById('edit-child-color-display');
  colorEl.style.background = child.color || 'var(--border)';
  colorEl.onclick = () => showEditColorModal(child.color);

  editEmoji = child.emoji || '';
  const emojiEl = document.getElementById('edit-child-emoji-display');
  emojiEl.textContent = child.emoji || '🙂';
  emojiEl.onclick = () => showEditEmojiModal(child.emoji);

  const preview = document.getElementById('edit-photo-preview');
  const placeholder = document.getElementById('edit-photo-placeholder');
  if (child.photo && child.photo.length > 10) {
    preview.src = child.photo;
    preview.style.display = 'block';
    placeholder.style.display = 'none';
  } else {
    preview.style.display = 'none';
    placeholder.style.display = '';
  }

  const inviteSection = document.getElementById('edit-child-invite-section');
  if (child.status === 'waiting' && child.inviteCode) {
    inviteSection.style.display = 'block';
    document.getElementById('edit-child-invite-code').textContent = child.inviteCode;
  } else {
    inviteSection.style.display = 'none';
  }

  document.getElementById('edit-child-error').textContent = '';
  showScreen('screen-edit-child');
}

document.getElementById('edit-gender-male').onclick = () => {
  editGender = 'male';
  document.getElementById('edit-gender-male').classList.add('selected');
  document.getElementById('edit-gender-female').classList.remove('selected');
};
document.getElementById('edit-gender-female').onclick = () => {
  editGender = 'female';
  document.getElementById('edit-gender-female').classList.add('selected');
  document.getElementById('edit-gender-male').classList.remove('selected');
};

document.getElementById('edit-photo-input').onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  editPhotoCleared = false;
  try {
    editPhotoData = await cropAndCompressPhoto(file);
    document.getElementById('edit-photo-preview').src = editPhotoData;
    document.getElementById('edit-photo-preview').style.display = 'block';
    document.getElementById('edit-photo-placeholder').style.display = 'none';
  } catch(err) {
    showToast('שגיאה בטעינת התמונה ⚠️');
  }
};

document.getElementById('btn-clear-photo').onclick = () => {
  editPhotoData = null;
  editPhotoCleared = true;
  document.getElementById('edit-photo-preview').style.display = 'none';
  document.getElementById('edit-photo-placeholder').style.display = '';
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
  showToast('נשמר בהצלחה! ✅');
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

// Emoji/Color modals
function showEditEmojiModal(current) {
  const ov = document.createElement('div'); ov.className = 'modal-overlay';
  const sh = document.createElement('div'); sh.className = 'modal-sheet';
  sh.innerHTML = `<div class="modal-handle"></div>
    <div class="modal-header"><h2>בחר אימוג'י</h2><button class="modal-close">✕</button></div>
    <div class="modal-body">
      <div class="emoji-grid">${CHILD_EMOJIS.map(e => `<div class="emoji-opt${e===current?' selected':''}" data-emoji="${e}">${e}</div>`).join('')}</div>
    </div>`;
  sh.querySelector('.modal-close').onclick = () => ov.remove();
  ov.onclick = e => { if (e.target === ov) ov.remove(); };
  sh.querySelectorAll('.emoji-opt').forEach(el => {
    el.onclick = () => {
      editEmoji = el.dataset.emoji;
      document.getElementById('edit-child-emoji-display').textContent = editEmoji;
      ov.remove();
    };
  });
  ov.appendChild(sh); document.body.appendChild(ov);
}

function showEditColorModal(current) {
  const ov = document.createElement('div'); ov.className = 'modal-overlay';
  const sh = document.createElement('div'); sh.className = 'modal-sheet';
  sh.innerHTML = `<div class="modal-handle"></div>
    <div class="modal-header"><h2>בחר צבע</h2><button class="modal-close">✕</button></div>
    <div class="modal-body">
      <div class="color-grid">${CHILD_COLORS.map(c => `<div class="color-opt${c===current?' selected':''}" data-color="${c}" style="background:${c}"></div>`).join('')}</div>
    </div>`;
  sh.querySelector('.modal-close').onclick = () => ov.remove();
  ov.onclick = e => { if (e.target === ov) ov.remove(); };
  sh.querySelectorAll('.color-opt').forEach(el => {
    el.onclick = () => {
      editColor = el.dataset.color;
      document.getElementById('edit-child-color-display').style.background = editColor;
      ov.remove();
    };
  });
  ov.appendChild(sh); document.body.appendChild(ov);
}

// =========== EDIT TASK BUTTONS ===========
document.getElementById('btn-et-save').onclick = () => saveEditedTask(getFamilyId());
document.getElementById('btn-et-hide').onclick = () => toggleHideTask(getFamilyId());
document.getElementById('btn-et-delete').onclick = () => deleteTask(getFamilyId());
document.getElementById('btn-back-edit-task').onclick = () => {
  showScreen('screen-edit-tasks');
  renderEditTasksList(getFamilyId());
};

// =========== SUGGESTIONS ===========
initSuggestions();

// =========== JOIN FAMILY ===========
const parentCodeDigits = document.querySelectorAll('.parent-code-digit');
parentCodeDigits.forEach((input, idx) => {
  input.addEventListener('input', (e) => {
    const val = e.target.value.replace(/\D/g, '');
    e.target.value = val.slice(0,1);
    if (val && idx < 5) parentCodeDigits[idx+1].focus();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Backspace' && !e.target.value && idx > 0) parentCodeDigits[idx-1].focus();
  });
  input.addEventListener('paste', (e) => {
    e.preventDefault();
    const paste = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0,6);
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
  renderDashboard(auth.currentUser);
};

document.getElementById('btn-create-new-family').onclick = async () => {
  const result = await createNewFamily(auth.currentUser);
  if (!result.success) { showToast('שגיאה, נסה שוב'); return; }
  // Reset onboarding state and go to step 1
  obGender = '';
  obChildPhoto = null;
  document.getElementById('ob1-name').value = '';
  document.getElementById('ob1-error').textContent = '';
  document.getElementById('ob1-photo-circle').innerHTML =
    `<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#818CF8" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>`;
  document.getElementById('ob1-gender-wrap').style.outline = '';
  document.querySelectorAll('.ob1-gender').forEach(b => {
    b.style.borderColor = 'var(--border)';
    b.style.background = 'white';
  });
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
    e.target.value = val.slice(0,1);
    if (val && idx < 5) codeDigits[idx+1].focus();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Backspace' && !e.target.value && idx > 0) codeDigits[idx-1].focus();
  });
  input.addEventListener('paste', (e) => {
    e.preventDefault();
    const paste = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0,6);
    paste.split('').forEach((ch, i) => { if (codeDigits[i]) codeDigits[i].value = ch; });
    if (paste.length > 0) codeDigits[Math.min(paste.length, 5)].focus();
  });
});

document.getElementById('btn-verify-code').onclick = async () => {
  const code = Array.from(codeDigits).map(d => d.value).join('');
  const err = document.getElementById('child-code-error');
  if (code.length < 6) { err.textContent = 'הכנס 6 ספרות'; return; }
  if (codeAttempts >= MAX_ATTEMPTS) { err.textContent = 'יותר מדי ניסיונות. נסה שוב מאוחר יותר'; return; }

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
  } catch(err) {
    showToast('שגיאה בטעינת התמונה ⚠️');
  }
};

document.getElementById('btn-finish-setup').onclick = async () => {
  const err = document.getElementById('setup-error');
  if (!selectedEmoji) { document.getElementById('emoji-error').textContent = 'חובה לבחור אימוג\'י'; return; }
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
    setTimeout(() => { window.location.href = 'tasks.html'; }, 800);
  } catch(e) {
    hideLoading();
    err.textContent = 'שגיאה, נסה שוב';
    console.error(e);
  }
};

// =========== ONBOARDING ===========
let obGender = '';
let obChildPhoto = null;

// Step 1 — gender buttons
document.querySelectorAll('.ob1-gender').forEach(btn => {
  btn.onclick = () => {
    obGender = btn.dataset.gender;
    document.querySelectorAll('.ob1-gender').forEach(b => {
      b.style.borderColor = b === btn ? '#6366F1' : '#E2E8F0';
      b.style.background  = b === btn ? '#EEF2FF' : '#F8FAFC';
    });
  };
});

// Step 1 — photo upload
document.getElementById('ob1-photo-input').onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    obChildPhoto = await cropAndCompressPhoto(file);
    document.getElementById('ob1-photo-circle').innerHTML =
      `<img src="${obChildPhoto}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
  } catch(err) {
    showToast('שגיאה בטעינת התמונה ⚠️');
  }
};

// Step 1 — back
document.getElementById('ob1-back').onclick = () => showScreen('screen-join-family');

// Reset onboarding step-1 form for adding another child
function resetOb1Form() {
  document.getElementById('ob1-name').value = '';
  obGender = '';
  obChildPhoto = null;
  document.getElementById('ob1-error').textContent = '';
  document.querySelectorAll('.ob1-gender').forEach(b => {
    b.style.borderColor = '#E2E8F0';
    b.style.background  = '#F8FAFC';
  });
  document.getElementById('ob1-photo-circle').innerHTML =
    `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#818CF8" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>`;
  document.getElementById('ob1-photo-input').value = '';
}

// Go to onboarding step 2 and generate invite code
async function goToOnboard2() {
  showScreen('screen-onboard-2');
  document.getElementById('ob2-code').textContent = '——————';
  const invResult = await createParentInviteCode(currentFamilyId);
  if (invResult && invResult.code) {
    document.getElementById('ob2-code').textContent = invResult.code;
  }
}

// Success popup after child added in onboarding
function showChildAddedPopup(name, gender, onAddMore, onContinue) {
  const isBoy = gender === 'male';
  const added = isBoy ? 'נוסף' : 'נוספה';
  const anotherLabel = isBoy ? 'הוסף ילד/ה נוספ/ת' : 'הוסף ילד/ה נוספ/ת';

  const backdrop = document.createElement('div');
  backdrop.style.cssText = 'position:fixed;inset:0;z-index:7000;background:rgba(15,23,42,0.55);display:flex;align-items:center;justify-content:center;padding:24px;';

  const card = document.createElement('div');
  card.style.cssText = 'background:white;border-radius:28px;padding:30px 24px 24px;width:100%;max-width:340px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,0.28);animation:popIn .38s cubic-bezier(0.34,1.4,0.64,1);direction:rtl;font-family:Heebo,sans-serif;';

  card.innerHTML = `
    <div style="font-size:3.2rem;margin-bottom:10px;">🎉</div>
    <div style="font-size:1.25rem;font-weight:900;color:#1E293B;margin-bottom:6px;">${name} ${added} בהצלחה!</div>
    <div style="font-size:0.86rem;color:#64748B;margin-bottom:24px;line-height:1.5;">${isBoy ? 'הוא' : 'היא'} כבר חלק מהמשפחה שלך ✨</div>
    <button id="pop-add-more" style="width:100%;padding:13px;background:#F1F5F9;border:2px dashed #CBD5E1;border-radius:16px;font-size:0.95rem;font-weight:800;font-family:Heebo,sans-serif;cursor:pointer;color:#475569;margin-bottom:10px;">➕ ${anotherLabel}</button>
    <button id="pop-continue" style="width:100%;padding:14px;background:linear-gradient(135deg,#6366F1,#4F46E5);border:none;border-radius:16px;font-size:1rem;font-weight:900;font-family:Heebo,sans-serif;cursor:pointer;color:white;box-shadow:0 6px 20px rgba(99,102,241,0.4);">המשך ←</button>
  `;

  backdrop.appendChild(card);
  document.body.appendChild(backdrop);

  card.querySelector('#pop-add-more').onclick = () => {
    backdrop.remove();
    onAddMore();
  };
  card.querySelector('#pop-continue').onclick = () => {
    backdrop.remove();
    onContinue();
  };
}

// Step 1 — next (save child → popup → screen 2)
document.getElementById('ob1-next').onclick = async () => {
  const name = document.getElementById('ob1-name').value.trim();
  const err  = document.getElementById('ob1-error');

  // אם השדה ריק וכבר יש ילד אחד לפחות — פשוט עובר למסך 2
  if (!name && childrenCache.length > 0) {
    goToOnboard2();
    return;
  }
  if (!name) {
    err.textContent = 'חובה להזין שם ילד/ה';
    const nameInput = document.getElementById('ob1-name');
    nameInput.style.borderColor = '#EF4444';
    nameInput.focus();
    navigator.vibrate && navigator.vibrate([80, 40, 80]);
    setTimeout(() => { nameInput.style.borderColor = 'var(--primary)'; }, 1800);
    return;
  }
  if (!obGender) {
    err.textContent = 'חובה לבחור בן או בת';
    const gWrap = document.getElementById('ob1-gender-wrap');
    gWrap.style.outline = '2.5px solid #EF4444';
    gWrap.style.borderRadius = '18px';
    navigator.vibrate && navigator.vibrate([80, 40, 80]);
    setTimeout(() => { gWrap.style.outline = ''; }, 1800);
    return;
  }
  err.textContent = '';

  // בדיקה: שם כפול
  const nameLC = name.toLowerCase();
  const duplicate = childrenCache.find(c => c.name && c.name.toLowerCase() === nameLC);
  if (duplicate) {
    const isMale = duplicate.gender === 'male';
    err.textContent = `${isMale ? 'ילד' : 'ילדה'} בשם "${name}" כבר ${isMale ? 'קיים' : 'קיימת'} במשפחה`;
    const nameInput = document.getElementById('ob1-name');
    nameInput.style.borderColor = '#F59E0B';
    nameInput.style.background  = '#FFFBEB';
    navigator.vibrate && navigator.vibrate([60, 30, 60]);
    setTimeout(() => {
      nameInput.style.borderColor = '#E2E8F0';
      nameInput.style.background  = '#F8FAFC';
    }, 2200);
    return;
  }

  const result = await createChild(currentFamilyId, name, obGender);
  if (result.error) { err.textContent = result.error; return; }

  // עדכן cache מיד — למניעת כפילות באותה סשן
  childrenCache.push({ id: result.childId, name, gender: obGender, photo: obChildPhoto || '' });

  if (obChildPhoto && result.childId) {
    await saveChild(currentFamilyId, result.childId, { photo: obChildPhoto });
  }

  const savedName   = name;
  const savedGender = obGender;
  resetOb1Form();

  showChildAddedPopup(
    savedName,
    savedGender,
    () => { /* onAddMore — form already reset, just stay on ob1 */ },
    () => goToOnboard2()
  );
};

// Step 2 — back
document.getElementById('ob2-back').onclick = () => showScreen('screen-onboard-1');

// Step 2 — skip
document.getElementById('ob2-skip').onclick = () => showScreen('screen-onboard-3');

// Step 2 — share
document.getElementById('ob2-share').onclick = () => {
  const code = document.getElementById('ob2-code').textContent.trim();
  shareParentCode(code);
};

// Step 3 — back
document.getElementById('ob3-back').onclick = () => showScreen('screen-onboard-2');

// Step 3 — allow notifications
document.getElementById('ob3-allow').onclick = async () => {
  if ('Notification' in window) {
    try { await Notification.requestPermission(); } catch(e) {}
  }
  finishOnboarding();
};

// Step 3 — later
document.getElementById('ob3-later').onclick = () => finishOnboarding();

function finishOnboarding() {
  renderDashboard(auth.currentUser);
}

// =========== DASH TOUR (spotlight-based, one-time) ===========
document.getElementById('tutorial-next').onclick = () => {}; // legacy no-op

async function startDashTour(familyId, uid) {
  const DONE_KEY = 'dashTourDone_' + uid;
  if (localStorage.getItem(DONE_KEY)) return;

  await new Promise(r => setTimeout(r, 600));
  const childCards = Array.from(document.querySelectorAll('#dash-children-grid > div'));
  const settingsBtn = document.getElementById('btn-open-menu');
  if (!settingsBtn) return;

  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;z-index:8500;pointer-events:all;';

  const spot = document.createElement('div');
  spot.style.cssText = 'position:fixed;border-radius:50%;pointer-events:none;z-index:8501;box-shadow:0 0 0 9999px rgba(15,23,42,0);transition:width .55s ease,height .55s ease,left .55s ease,top .55s ease,box-shadow .6s,border-radius .35s;';

  const infoCard = document.createElement('div');
  infoCard.style.cssText = 'position:fixed;background:white;border-radius:20px;padding:20px 22px;box-shadow:0 8px 40px rgba(0,0,0,0.22);width:min(300px,88vw);z-index:8503;opacity:0;transition:opacity .4s;left:50%;transform:translateX(-50%);pointer-events:auto;text-align:right;direction:rtl;font-family:Heebo,sans-serif;';

  document.body.appendChild(ov);
  document.body.appendChild(spot);
  document.body.appendChild(infoCard);

  // ── Helpers ──
  function setSpot(el, pad = 14) {
    spot.style.borderRadius = '50%';
    const r = el.getBoundingClientRect();
    const diag = Math.ceil(Math.hypot(r.width + pad*2, r.height + pad*2));
    spot.style.width = diag + 'px'; spot.style.height = diag + 'px';
    spot.style.left = (r.left + r.width/2 - diag/2) + 'px';
    spot.style.top  = (r.top  + r.height/2 - diag/2) + 'px';
  }
  function setSpotRect(el, pad = 0) {
    spot.style.borderRadius = '12px';
    const r = el.getBoundingClientRect();
    spot.style.width  = (r.width  + pad*2) + 'px';
    spot.style.height = (r.height + pad*2) + 'px';
    spot.style.left   = (r.left - pad) + 'px';
    spot.style.top    = (r.top  - pad) + 'px';
  }
  function fadeDark()  { spot.style.boxShadow = '0 0 0 9999px rgba(15,23,42,0.82)'; }
  function fadeLight() { spot.style.boxShadow = '0 0 0 9999px rgba(15,23,42,0)'; }
  function showCard(html, topY) {
    infoCard.innerHTML = html;
    infoCard.style.top = Math.min(topY, window.innerHeight - 280) + 'px';
    infoCard.style.opacity = '1';
  }
  function hideCard() { infoCard.style.opacity = '0'; }
  async function expandSpotToScreen() {
    spot.style.borderRadius = '50%';
    const diag = Math.hypot(window.innerWidth, window.innerHeight) * 2.4;
    spot.style.width  = diag + 'px'; spot.style.height = diag + 'px';
    spot.style.left   = (window.innerWidth/2  - diag/2) + 'px';
    spot.style.top    = (window.innerHeight/2 - diag/2) + 'px';
    await new Promise(r => setTimeout(r, 520));
  }
  function makeShutters() {
    const CSS = (pos) => `position:fixed;${pos}:0;left:0;right:0;height:0;background:#0F172A;z-index:9200;transition:height .38s ease-in;pointer-events:none;`;
    const t = document.createElement('div'); t.style.cssText = CSS('top');
    const b = document.createElement('div'); b.style.cssText = CSS('bottom');
    document.body.appendChild(t); document.body.appendChild(b);
    return [t, b];
  }
  async function shuttersClose([t, b]) {
    await new Promise(r => setTimeout(r, 40));
    t.style.height = '52vh'; b.style.height = '52vh';
    await new Promise(r => setTimeout(r, 440));
  }
  async function shuttersOpen([t, b]) {
    t.style.transition = 'height .38s ease-out';
    b.style.transition = 'height .38s ease-out';
    t.style.height = '0'; b.style.height = '0';
    await new Promise(r => setTimeout(r, 420));
    t.remove(); b.remove();
  }

  function endTour() {
    hideCard(); fadeLight();
    const st = document.createElement('div');
    st.style.cssText = 'position:fixed;top:0;left:0;right:0;height:0;background:#0F172A;z-index:9100;transition:height .45s ease-in;pointer-events:none;';
    const sb = document.createElement('div');
    sb.style.cssText = 'position:fixed;bottom:0;left:0;right:0;height:0;background:#0F172A;z-index:9100;transition:height .45s ease-in;pointer-events:none;';
    document.body.appendChild(st); document.body.appendChild(sb);
    setTimeout(() => { st.style.height = '52vh'; sb.style.height = '52vh'; }, 80);
    setTimeout(() => {
      ov.remove(); spot.remove(); infoCard.remove(); st.remove(); sb.remove();
      localStorage.setItem(DONE_KEY, '1');
      renderDashTaskRows(familyId);
      const banner = document.getElementById('quick-tasks-banner');
      if (banner && banner.style.display !== 'none') {
        setTimeout(() => {
          banner.scrollIntoView({ behavior: 'smooth', block: 'center' });
          const inner = document.getElementById('quick-tasks-inner');
          if (inner) {
            inner.style.transition = 'box-shadow 0.4s';
            inner.style.boxShadow = '0 0 0 5px rgba(99,102,241,0.5),0 0 0 14px rgba(99,102,241,0.15)';
            setTimeout(() => { inner.style.boxShadow = ''; inner.style.transition = ''; }, 2200);
          }
        }, 200);
      }
    }, 580);
  }

  // ── Phase 1: Settings button spotlight ──
  setSpot(settingsBtn, 14);
  await new Promise(r => setTimeout(r, 150));
  fadeDark();
  await new Promise(r => setTimeout(r, 650));

  const r1 = settingsBtn.getBoundingClientRect();
  showCard(`
    <div style="font-size:1.7rem;margin-bottom:10px;">⚙️</div>
    <div style="font-weight:900;font-size:1.05rem;color:#1E293B;margin-bottom:8px;">תפריט הניהול</div>
    <div style="font-size:0.84rem;color:#64748B;line-height:1.65;margin-bottom:14px;">
      כאן תמצא את <b>כל הפעולות</b> של האפליקציה.<br>בוא נראה מה יש שם 👀
    </div>
    <button id="dt-btn-1" style="background:linear-gradient(135deg,#6366F1,#4F46E5);color:white;border:none;border-radius:12px;padding:11px 24px;font-size:0.92rem;font-weight:800;font-family:Heebo,sans-serif;cursor:pointer;width:100%;">פתח תפריט ←</button>
  `, r1.bottom + 24);

  await new Promise(resolve => {
    document.getElementById('dt-btn-1').onclick = async () => {
      hideCard();
      await expandSpotToScreen();
      fadeLight();
      await new Promise(r => setTimeout(r, 160));

      // Shutter close
      const sh1 = makeShutters();
      await shuttersClose(sh1);

      // Open side menu while screen is covered
      openSideMenu({ auth, onAction: () => {} });
      await new Promise(r => setTimeout(r, 120));
      const menuEl = document.getElementById('side-menu');

      // Silently move spot to cover the menu (rectangular)
      spot.style.transition = 'none';
      if (menuEl) setSpotRect(menuEl, 0);
      await new Promise(r => setTimeout(r, 30));

      // Open shutters revealing menu inside spotlight
      await shuttersOpen(sh1);

      spot.style.transition = 'width .55s ease,height .55s ease,left .55s ease,top .55s ease,box-shadow .6s,border-radius .35s';
      fadeDark();
      await new Promise(r => setTimeout(r, 700));

      // ── Phase 1.5: Side menu card (left side, menu is on right) ──
      infoCard.style.left = '12px';
      infoCard.style.transform = 'none';
      infoCard.style.width = 'min(205px,46vw)';
      showCard(`
        <div style="font-size:1.4rem;margin-bottom:8px;">🗂️</div>
        <div style="font-weight:900;font-size:0.92rem;color:#1E293B;margin-bottom:8px;">מה בתפריט?</div>
        <div style="font-size:0.77rem;color:#475569;line-height:2.1;margin-bottom:12px;">
          👨‍👩‍👧‍👦 <b>ניהול משפחה</b><br>
          📋 <b>הוספת מטלות</b><br>
          🎁 <b>הוספת פרסים</b><br>
          ⭐ <b>ניהול ניקוד</b>
        </div>
        <button id="dt-btn-15" style="background:linear-gradient(135deg,#6366F1,#4F46E5);color:white;border:none;border-radius:12px;padding:10px 16px;font-size:0.86rem;font-weight:800;font-family:Heebo,sans-serif;cursor:pointer;width:100%;">הבא ←</button>
      `, Math.round(window.innerHeight * 0.28));

      await new Promise(resolve2 => {
        document.getElementById('dt-btn-15').onclick = async () => {
          hideCard();
          // Reset card to center for next phase
          infoCard.style.left = '50%';
          infoCard.style.transform = 'translateX(-50%)';
          infoCard.style.width = 'min(300px,88vw)';

          // Close side menu
          closeSideMenu();
          await new Promise(r => setTimeout(r, 200));

          if (!childCards.length) { endTour(); resolve2(); return; }

          // Expand spot to full screen
          await expandSpotToScreen();
          fadeLight();
          await new Promise(r => setTimeout(r, 160));

          // Shutter close
          const sh2 = makeShutters();
          await shuttersClose(sh2);

          // Reset spot to child card (circular)
          spot.style.transition = 'none';
          setSpot(childCards[0], 18);
          await new Promise(r => setTimeout(r, 30));

          // Open shutters
          await shuttersOpen(sh2);

          spot.style.transition = 'width .55s ease,height .55s ease,left .55s ease,top .55s ease,box-shadow .6s,border-radius .35s';

          // ── Phase 2: Child card spotlight ──
          fadeDark();
          await new Promise(r => setTimeout(r, 650));

          const r2 = childCards[0].getBoundingClientRect();
          showCard(`
            <div style="font-size:1.7rem;margin-bottom:10px;">📊</div>
            <div style="font-weight:900;font-size:1.05rem;color:#1E293B;margin-bottom:10px;">המדדים של הילד</div>
            <div style="font-size:0.84rem;color:#64748B;line-height:1.85;margin-bottom:12px;">
              <span style="display:inline-block;background:#FEF9C3;color:#713F12;border-radius:8px;padding:2px 9px;font-weight:700;">⭐ כוכבים השבוע</span><br>
              <span style="display:inline-block;background:#DCFCE7;color:#14532D;border-radius:8px;padding:2px 9px;font-weight:700;margin-top:4px;">🗓️ כוכבים החודש</span><br>
              <span style="display:inline-block;background:#FEE2E2;color:#991B1B;border-radius:8px;padding:2px 9px;font-weight:700;margin-top:4px;">✅ נותרו מטלות לביצוע</span>
            </div>
            <div style="font-size:0.8rem;color:#94A3B8;text-align:center;font-weight:700;border-top:1px solid #F1F5F9;padding-top:10px;">גע בכרטיס הילד כדי להמשיך ↑</div>
          `, r2.bottom + 18);

          const tapOnce = () => {
            ov.onclick = null;
            hideCard();
            fadeLight();
            setTimeout(endTour, 380);
            resolve2();
          };
          ov.onclick = tapOnce;
        };
      });

      resolve();
    };
  });
}

// =========== WHO SCREEN SLIDER ===========
(function initWhoSlider() {
  const slider = document.getElementById('who-slider');
  const track  = document.getElementById('who-track');
  const dots   = [0, 1, 2].map(i => document.getElementById('who-dot-' + i));
  if (!slider || !track) return;

  let current = 0;
  const total = 3;

  function goTo(idx) {
    current = Math.max(0, Math.min(idx, total - 1));
    track.style.transform = `translateX(-${current * (100 / total)}%)`;
    dots.forEach((d, i) => {
      if (!d) return;
      d.style.width      = i === current ? '22px' : '8px';
      d.style.background = i === current ? 'var(--primary)' : 'rgba(99,102,241,0.28)';
    });
  }

  dots.forEach((d, i) => { if (d) d.onclick = () => { clearAuto(); goTo(i); startAuto(2000); }; });

  let startX = 0, startY = 0, dragging = false;
  let autoTimeout, autoInterval;
  function startAuto(delay = 0) {
    clearAuto();
    autoTimeout = setTimeout(() => {
      autoInterval = setInterval(() => goTo((current + 1) % total), 3800);
    }, delay);
  }
  function clearAuto() { clearTimeout(autoTimeout); clearInterval(autoInterval); }

  slider.addEventListener('touchstart', e => {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    dragging = true;
    track.style.transition = 'none';
    clearAuto();
  }, { passive: true });

  slider.addEventListener('touchmove', e => {
    if (!dragging) return;
    const dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;
    if (Math.abs(dy) > Math.abs(dx) + 4) return;
    e.preventDefault();
    e.stopPropagation();
    const base   = -(current * (100 / total));
    const offset = (dx / slider.offsetWidth) * (100 / total);
    track.style.transform = `translateX(${base + offset}%)`;
  }, { passive: false });

  slider.addEventListener('touchend', e => {
    if (!dragging) return;
    dragging = false;
    track.style.transition = 'transform 0.38s cubic-bezier(0.4,0,0.2,1)';
    const dx = e.changedTouches[0].clientX - startX;
    if (Math.abs(dx) > 48) {
      // LTR: swipe left = next, swipe right = previous
      goTo(dx > 0 ? current - 1 : current + 1);
    } else {
      goTo(current);
    }
    startAuto(2000); // resume after 2s pause
  });

  startAuto();
})();
