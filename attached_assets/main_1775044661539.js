import { auth, db } from './firebase.js';
import {
  signInAnonymously
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  doc, updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

import { showScreen, showToast, showLoading, hideLoading, openSideMenu } from './ui.js';
import { initAuth, loginWithGoogle, loginWithFacebook, logoutParent, createNewFamily, joinFamily, currentFamilyId, setCurrentFamilyId, confirmDeleteAccount, deleteAccount } from './auth.js';
import {
  childrenCache, loadChildren, renderFamily,
  createChild, saveChild, deleteChild,
  createParentInviteCode, verifyChildCode,
  showChildInviteModal, shareCode, shareParentCode,
  CHILD_EMOJIS, CHILD_COLORS,
  renderDashboardChildren
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

// =========== GLOBALS (needed by inline onclick in HTML) ===========
window.showScreen = (id) => {
  showScreen(id);
  if (id === 'screen-dashboard' && currentFamilyId) {
    renderDashboardChildren(currentFamilyId);
    refreshQuickTasksBanner(currentFamilyId);
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

async function handleQuickTasks(fromDash) {
  const fid = getFamilyId();
  if (!fid) return;
  const btn = document.getElementById(fromDash ? 'btn-quick-tasks-dash' : 'btn-quick-tasks-form');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ יוצר משימות...'; }
  try {
    const ok = await createQuickTasks(fid);
    if (ok) {
      showToast('✅ 5 משימות נוצרו בהצלחה!');
      document.getElementById('quick-tasks-banner').style.display = 'none';
    }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = fromDash ? '✨ צור 5 משימות בסיסיות' : '⚡ 5 משימות אוטומטיות'; }
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

document.getElementById('btn-quick-tasks-dash').onclick = () => handleQuickTasks(true);
document.getElementById('btn-quick-tasks-form').onclick = () => handleQuickTasks(false);

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
    showScreen('screen-who');
  });
};

document.getElementById('btn-delete-account').onclick = () => {
  confirmDeleteAccount(() => {
    deleteAccount(currentFamilyId, () => {
      showScreen('screen-who');
    });
  });
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
      }
    });
  }
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
  const result = await createChild(getFamilyId(), name, selectedGender);
  if (result.error) {
    document.getElementById('create-child-error').textContent = result.error;
    return;
  }
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
  emojiEl.textContent = child.emoji || '—';
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

document.getElementById('edit-photo-input').onchange = (e) => {
  const file = e.target.files[0];
  if (!file) return;
  editPhotoCleared = false;
  const reader = new FileReader();
  reader.onload = (ev) => {
    editPhotoData = ev.target.result;
    document.getElementById('edit-photo-preview').src = editPhotoData;
    document.getElementById('edit-photo-preview').style.display = 'block';
    document.getElementById('edit-photo-placeholder').style.display = 'none';
  };
  reader.readAsDataURL(file);
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

document.getElementById('btn-delete-child').onclick = async () => {
  if (!confirm('למחוק את הילד/ה? פעולה זו לא ניתנת לביטול')) return;
  const result = await deleteChild(getFamilyId(), editingChildId);
  if (result.error) return;
  await loadChildren(getFamilyId());
  renderFamily(getFamilyId());
  showToast('נמחק! 🗑️');
  showScreen('screen-manage-family');
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

document.getElementById('child-photo-input').onchange = (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    childPhotoData = ev.target.result;
    document.getElementById('child-photo-preview').src = childPhotoData;
    document.getElementById('child-photo-preview').style.display = 'block';
    document.getElementById('child-photo-placeholder').style.display = 'none';
  };
  reader.readAsDataURL(file);
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
      b.style.borderColor = b === btn ? 'var(--primary)' : 'var(--border)';
      b.style.background  = b === btn ? '#EEF2FF' : 'white';
    });
  };
});

// Step 1 — photo upload
document.getElementById('ob1-photo-input').onchange = (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    obChildPhoto = ev.target.result;
    document.getElementById('ob1-photo-circle').innerHTML =
      `<img src="${obChildPhoto}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
  };
  reader.readAsDataURL(file);
};

// Step 1 — back
document.getElementById('ob1-back').onclick = () => showScreen('screen-join-family');

// Step 1 — next (save child → screen 2)
document.getElementById('ob1-next').onclick = async () => {
  const name = document.getElementById('ob1-name').value.trim();
  const err  = document.getElementById('ob1-error');
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

  const result = await createChild(currentFamilyId, name, obGender);
  if (result.error) { err.textContent = result.error; return; }

  if (obChildPhoto && result.childId) {
    await saveChild(currentFamilyId, result.childId, { photo: obChildPhoto });
  }

  // Step 2 — generate invite code
  showScreen('screen-onboard-2');
  document.getElementById('ob2-code').textContent = '——————';
  const invResult = await createParentInviteCode(currentFamilyId);
  if (invResult && invResult.code) {
    document.getElementById('ob2-code').textContent = invResult.code;
  }
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
  const uid = auth.currentUser?.uid;
  if (uid && !localStorage.getItem('tutorialDone_' + uid)) {
    setTimeout(showTutorial, 700);
  }
}

// =========== TUTORIAL ===========
const TUTORIAL_STEPS = [
  { emoji: '⭐', title: 'ברוכים הבאים!', text: 'כאן תנהלו את משימות הבית עם הילדים בקלות וכיף.' },
  { emoji: '⚙️', title: 'הגדרות המשפחה', text: 'לחץ ⚙️ בדשבורד כדי להוסיף ילדים, הורים ולנהל הכל.' },
  { emoji: '✅', title: 'הוסף משימות', text: 'הגדר משימות לכל ילד — כל ביצוע מרוויח כוכבים!' },
];
let tutStep = 0;

function showTutorial() {
  tutStep = 0;
  renderTutStep();
  document.getElementById('tutorial-overlay').style.display = 'flex';
}

function renderTutStep() {
  const s = TUTORIAL_STEPS[tutStep];
  document.getElementById('tutorial-content').innerHTML = `
    <div style="font-size:3.2rem;margin-bottom:16px;">${s.emoji}</div>
    <div style="font-size:1.35rem;font-weight:900;color:var(--text);margin-bottom:10px;">${s.title}</div>
    <div style="font-size:0.92rem;color:var(--muted);line-height:1.6;max-width:300px;margin:0 auto;">${s.text}</div>`;
  document.getElementById('tutorial-dots').innerHTML = TUTORIAL_STEPS.map((_, i) =>
    `<div style="width:${i===tutStep?'22px':'8px'};height:8px;border-radius:4px;background:${i===tutStep?'var(--primary)':'rgba(99,102,241,0.25)'};transition:all 0.3s;"></div>`
  ).join('');
  document.getElementById('tutorial-next').textContent =
    tutStep < TUTORIAL_STEPS.length - 1 ? 'הבא' : '🚀 קדימה!';
}

document.getElementById('tutorial-next').onclick = () => {
  if (tutStep < TUTORIAL_STEPS.length - 1) {
    tutStep++;
    renderTutStep();
  } else {
    document.getElementById('tutorial-overlay').style.display = 'none';
    const uid = auth.currentUser?.uid;
    if (uid) localStorage.setItem('tutorialDone_' + uid, '1');
  }
};

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

  dots.forEach((d, i) => { if (d) d.onclick = () => { clearAuto(); goTo(i); startAuto(5000); }; });

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
    if (Math.abs(dy) > Math.abs(dx)) return;
    const base   = -(current * (100 / total));
    // LTR: finger right → previous slide, finger left → next slide
    const offset = (dx / slider.offsetWidth) * (100 / total);
    track.style.transform = `translateX(${base + offset}%)`;
  }, { passive: true });

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
    startAuto(5000); // resume after 5s pause
  });

  startAuto();
})();
