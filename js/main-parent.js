import { auth, db } from './firebase.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { onSnapshot, doc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

import { showScreen, showToast, showLoading, hideLoading, openSideMenu, closeSideMenu, showConfirm } from './ui.js';
import { cropAndCompressPhoto } from './ui.js';
import { logoutParent, currentFamilyId, setCurrentFamilyId, confirmDeleteAccount, deleteAccount } from './auth.js';
import {
  childrenCache, clearChildrenCache, loadChildren, renderFamily,
  createChild, saveChild, deleteChild,
  createParentInviteCode, shareCode, shareParentCode,
  CHILD_EMOJIS, CHILD_COLORS, colorGradient,
  renderDashboardChildren, renderDashTaskRows, saveWeeklySnapshot,
  showChildInviteModal, initDashboardListeners
} from './family.js';
import { SPLAT_SVG } from './icons.js';
import { createQuickTasks } from './tasks.js';
import { createQuickPrizes } from './prizes.js';
import { requestPushPermission, saveParentFcmToken } from './notifications.js';
import { initApprovalQueue } from './approval-queue.js';

let isPrimaryParent = true;

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

// =========== ACTIVITY BADGE (מרכז פעילות) ===========
function _activitySeenKey(familyId) { return `activityLastSeen_${familyId}`; }

function _getLastSeen(familyId) {
  try { return parseInt(localStorage.getItem(_activitySeenKey(familyId)) || '0', 10); } catch(e) { return 0; }
}

function _markActivitySeen(familyId) {
  try { localStorage.setItem(_activitySeenKey(familyId), String(Date.now())); } catch(e) {}
}

function _setActivityBadge(count) {
  _currentActivityCount = count;
  const badge = document.getElementById('activity-badge');
  if (!badge) return;
  badge.style.display = count > 0 ? 'block' : 'none';
}

let _activityUnsubs = [];
let _activityHistMap = {};
let _currentActivityCount = 0;

function initActivityBadgeListeners(familyId) {
  _activityUnsubs.forEach(u => u());
  _activityUnsubs = [];
  _activityHistMap = {};

  function recompute() {
    const since = _getLastSeen(familyId);
    let total = 0;
    for (const hist of Object.values(_activityHistMap)) {
      total += hist.filter(h => (h.ts || 0) > since).length;
    }
    _setActivityBadge(total);
  }

  for (const child of childrenCache) {
    const stateRef = doc(db, 'families', familyId, 'children', child.id, 'state', 'current');
    const u = onSnapshot(stateRef, snap => {
      _activityHistMap[child.id] = snap.exists() ? (snap.data().hist || []) : [];
      recompute();
    }, () => {});
    _activityUnsubs.push(u);
  }
}

window.goToActivityCenter = function() {
  _markActivitySeen(currentFamilyId);
  _setActivityBadge(0);
  window.location.href = 'points.html?tab=history';
};

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

function _showQuickConfirm({ modalId, emoji, accentFrom, accentTo, title, body, btnId, onConfirm }) {
  const existing = document.getElementById(modalId);
  if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = modalId;
  modal.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;padding:24px;';
  modal.innerHTML = `
    <div class="qc-bg" style="position:absolute;inset:0;background:rgba(15,23,42,0.55);backdrop-filter:blur(3px);opacity:0;transition:opacity 0.22s ease;"></div>
    <div class="qc-card" style="position:relative;background:#fff;border-radius:28px;padding:32px 24px 24px;max-width:300px;width:100%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,0.22);transform:scale(0.75) translateY(24px);opacity:0;transition:transform 0.32s cubic-bezier(.34,1.56,.64,1),opacity 0.24s ease;">
      <div style="width:72px;height:72px;border-radius:50%;background:linear-gradient(135deg,${accentFrom},${accentTo});display:flex;align-items:center;justify-content:center;font-size:2.2rem;margin:0 auto 16px;box-shadow:0 6px 20px ${accentFrom}55;">${emoji}</div>
      <div style="font-size:1.15rem;font-weight:900;color:#0F172A;margin-bottom:6px;">${title}</div>
      <div style="font-size:0.84rem;color:#64748B;line-height:1.55;margin-bottom:24px;">${body}</div>
      <button id="${btnId}" style="width:100%;padding:14px;background:linear-gradient(135deg,${accentFrom},${accentTo});color:#fff;border:none;border-radius:16px;font-size:1rem;font-weight:800;font-family:'Heebo',sans-serif;cursor:pointer;box-shadow:0 4px 14px ${accentFrom}66;">אישור ✓</button>
    </div>`;
  document.body.appendChild(modal);
  requestAnimationFrame(() => {
    modal.querySelector('.qc-bg').style.opacity = '1';
    const card = modal.querySelector('.qc-card');
    card.style.transform = 'scale(1) translateY(0)';
    card.style.opacity = '1';
  });
  const close = (runCallback) => {
    modal.querySelector('.qc-bg').style.opacity = '0';
    const card = modal.querySelector('.qc-card');
    card.style.transform = 'scale(0.88) translateY(10px)';
    card.style.opacity = '0';
    setTimeout(() => { modal.remove(); if (runCallback && onConfirm) onConfirm(); }, 260);
  };
  document.getElementById(btnId).onclick = () => close(true);
  modal.querySelector('.qc-bg').addEventListener('click', () => close(false));
}

function showQuickTasksConfirm(catName, onConfirm) {
  _showQuickConfirm({
    modalId: 'quick-tasks-confirm-modal',
    emoji: '⚡',
    accentFrom: '#6366F1',
    accentTo: '#8B5CF6',
    title: '3 משימות נוצרו!',
    body: `משימות ${catName} נוספו לכל הילדים בהצלחה<br><span style="font-size:0.78rem;color:#94A3B8;margin-top:10px;display:block;">ניתן לערוך ולמחוק במסך <strong style="color:#6366F1;">עריכת משימות</strong> בתפריט <strong style="color:#6366F1;">הגדרות</strong> ⚙️</span>`,
    btnId: 'btn-quick-confirm-close',
    onConfirm
  });
}

async function handleQuickTasks(triggerEl, category) {
  const fid = getFamilyId();
  if (!fid) return;
  if (triggerEl) { triggerEl.disabled = true; triggerEl.style.opacity = '0.55'; }
  try {
    const ok = await createQuickTasks(fid, category);
    if (ok && triggerEl) {
      const catLabels = { hygiene: 'היגיינה 🧼', chores: 'מטלות בית 🏠', study: 'לימודים 📚' };
      const catName = catLabels[category] || category;
      saveClickedCategory(category);
      markButtonDone(triggerEl);
      const allDone = [...document.querySelectorAll('#quick-tasks-inner .quick-cat-btn')].every(b => b.disabled || b.innerHTML.includes('✅'));
      if (allDone) {
        localStorage.setItem(quickBannerKey(), '1');
        showQuickTasksConfirm(catName, () => animateBannerAway());
      } else {
        showQuickTasksConfirm(catName);
      }
    }
  } finally {
    if (triggerEl && !triggerEl.innerHTML.includes('✅')) { triggerEl.disabled = false; triggerEl.style.opacity = ''; }
  }
}

// =========== QUICK PRIZES BANNER ===========
function quickPrizesBannerKey() { return `quickPrizesBannerDismissed_${currentFamilyId || 'none'}`; }
function quickPrizesClickedKey() { return `quickPrizesClicked_${currentFamilyId || 'none'}`; }

function getPrizesClickedCategories() {
  try { return JSON.parse(localStorage.getItem(quickPrizesClickedKey()) || '[]'); } catch(e) { return []; }
}
function savePrizesClickedCategory(cat) {
  const clicked = getPrizesClickedCategories();
  if (!clicked.includes(cat)) { clicked.push(cat); localStorage.setItem(quickPrizesClickedKey(), JSON.stringify(clicked)); }
}

function markPrizeButtonDone(btn) {
  const cat = btn.dataset.cat;
  const labels = { treats: 'פינוקים', fun: 'פנאי', gifts: 'מתנות' };
  btn.style.opacity = '1';
  btn.style.background = 'rgba(22,163,74,0.10)';
  btn.style.borderColor = '#16A34A';
  btn.innerHTML = `<div style="font-size:1.5rem;margin-bottom:4px;">✅</div><div style="font-size:0.78rem;font-weight:800;color:#15803D;">${labels[cat] || ''}</div><div style="font-size:0.65rem;color:#15803D;margin-top:2px;">נוסף!</div>`;
  btn.style.cursor = 'default';
  btn.disabled = true;
}

function refreshQuickPrizesBanner() {
  const banner = document.getElementById('quick-prizes-banner');
  if (!banner) return;
  if (localStorage.getItem(quickPrizesBannerKey()) === '1') { banner.style.display = 'none'; return; }
  banner.style.display = 'block';
  const clicked = getPrizesClickedCategories();
  document.querySelectorAll('#quick-prizes-inner .quick-prize-dash-btn').forEach(btn => {
    if (clicked.includes(btn.dataset.cat)) markPrizeButtonDone(btn);
  });
  const allDone = [...document.querySelectorAll('#quick-prizes-inner .quick-prize-dash-btn')].every(b => b.disabled);
  if (allDone) { localStorage.setItem(quickPrizesBannerKey(), '1'); banner.style.display = 'none'; }
}

function animatePrizesBannerAway() {
  const inner = document.getElementById('quick-prizes-inner');
  const banner = document.getElementById('quick-prizes-banner');
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

function dismissQuickPrizesBanner() {
  localStorage.setItem(quickPrizesBannerKey(), '1');
  animatePrizesBannerAway();
}

function showQuickPrizesConfirm(catName, onConfirm) {
  _showQuickConfirm({
    modalId: 'quick-prizes-confirm-modal',
    emoji: '🎁',
    accentFrom: '#F59E0B',
    accentTo: '#D97706',
    title: '3 פרסים נוצרו!',
    body: `פרסים ${catName} נוספו לרשימה בהצלחה<br><span style="font-size:0.78rem;color:#94A3B8;margin-top:10px;display:block;">ניתן לערוך ולמחוק במסך <strong style="color:#D97706;">עריכת פרסים</strong> בתפריט <strong style="color:#D97706;">הגדרות</strong> ⚙️</span>`,
    btnId: 'btn-quick-prizes-confirm-close',
    onConfirm
  });
}

async function handleQuickPrizes(triggerEl, category) {
  const fid = getFamilyId();
  if (!fid) return;
  if (triggerEl) { triggerEl.disabled = true; triggerEl.style.opacity = '0.55'; }
  try {
    const ok = await createQuickPrizes(fid, category);
    if (ok && triggerEl) {
      const catLabels = { treats: 'פינוקים 🍦', fun: 'פנאי 🎮', gifts: 'מתנות 🎁' };
      const catName = catLabels[category] || category;
      savePrizesClickedCategory(category);
      markPrizeButtonDone(triggerEl);
      const allDone = [...document.querySelectorAll('#quick-prizes-inner .quick-prize-dash-btn')].every(b => b.disabled || b.innerHTML.includes('✅'));
      if (allDone) {
        localStorage.setItem(quickPrizesBannerKey(), '1');
        showQuickPrizesConfirm(catName, () => animatePrizesBannerAway());
      } else {
        showQuickPrizesConfirm(catName);
      }
    }
  } finally {
    if (triggerEl && !triggerEl.innerHTML.includes('✅')) { triggerEl.disabled = false; triggerEl.style.opacity = ''; }
  }
}
(async () => {
  const user = await checkAuth();

  // familyId — נטען מ-auth module
  const { getDocs, collection, query, where } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
  try {
    let famSnap = await getDocs(query(collection(db, 'families'), where('parentUid', '==', user.uid)));
    isPrimaryParent = !famSnap.empty;
    if (famSnap.empty) famSnap = await getDocs(query(collection(db, 'families'), where('secondaryParentUid', '==', user.uid)));
    if (!famSnap.empty) setCurrentFamilyId(famSnap.docs[0].id);
    else { window.location.href = 'index.html'; return; }
  } catch(e) { window.location.href = 'index.html'; return; }

  const name = user.displayName ? user.displayName.split(' ')[0] : 'הורה';
  document.getElementById('dash-greeting').textContent = `שלום, ${name}`;

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
  renderDashboardChildren(currentFamilyId); // טעינה מוקדמת — לפני הבאנרים
  refreshQuickTasksBanner();
  refreshQuickPrizesBanner();
  saveWeeklySnapshot(currentFamilyId).catch(() => {});
  initApprovalQueue(currentFamilyId);

  // שמירת FCM token של ההורה בכל כניסה
  try {
    const token = await requestPushPermission();
    if (token) await saveParentFcmToken(db, currentFamilyId, token);
  } catch(e) { console.warn('FCM parent token error:', e); }
  initDashboardListeners(currentFamilyId);
  initActivityBadgeListeners(currentFamilyId);

  // Quick banner buttons
  document.getElementById('btn-quick-banner-close').addEventListener('click', dismissQuickBanner);
  document.querySelectorAll('.quick-cat-btn').forEach(btn => {
    btn.addEventListener('click', function() { handleQuickTasks(this, this.dataset.cat); });
  });

  document.getElementById('btn-quick-prizes-close').addEventListener('click', dismissQuickPrizesBanner);
  document.querySelectorAll('.quick-prize-dash-btn').forEach(btn => {
    btn.addEventListener('click', function() { handleQuickPrizes(this, this.dataset.cat); });
  });

  // הפעל טוטוריאל חד-פעמי לדשבורד
  const uid = user.uid;
  if (!localStorage.getItem('dashTourDone_' + uid)) {
    setTimeout(() => startDashTour(currentFamilyId, uid), 3500);
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
  window.location.href = 'points.html?tab=history';
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

document.getElementById('btn-delete-account').onclick = async () => {
  await confirmDeleteAccount(() => {
    deleteAccount(getFamilyId(), () => {
      clearChildrenCache();
      window.location.href = 'index.html';
    });
  }, getFamilyId());
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
    isPrimary: isPrimaryParent,
    activityCount: _currentActivityCount,
    onAction: (action) => {
      if (action === 'manage-family') document.getElementById('btn-manage-family').click();
      else if (action === 'add-tasks') document.getElementById('btn-add-tasks').click();
      else if (action === 'edit-tasks') document.getElementById('btn-edit-tasks').click();
      else if (action === 'add-prizes') document.getElementById('btn-add-prizes').click();
      else if (action === 'manage-prizes') document.getElementById('btn-manage-prizes').click();
      else if (action === 'manage-points') document.getElementById('btn-manage-points').click();
      else if (action === 'contact') window.open('mailto:support@example.com', '_blank');
      else if (action === 'terms') window.open('terms.html', '_blank');
      else if (action === 'delete-account') document.getElementById('btn-delete-account').click();
      else if (action === 'stats') window.location.href = 'stats.html';
      else if (action === 'replay-tour') startDashTour(currentFamilyId, auth.currentUser?.uid);
    }
  });
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
  ncpc.style.border = '3px dashed #818CF8'; ncpc.style.width = '95px'; ncpc.style.height = '95px';
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
    <div style="background:linear-gradient(135deg,#EDE9FE,#DDD6FE);border-radius:18px;padding:14px 16px;margin-bottom:12px;">
      <div style="font-size:0.72rem;font-weight:700;color:#7C3AED;margin-bottom:6px;">קוד כניסה ל${isBoy ? 'ילד' : 'ילדה'}</div>
      <div style="font-size:2rem;font-weight:900;color:#5B21B6;letter-spacing:8px;direction:ltr;font-variant-numeric:tabular-nums;">${inviteCode}</div>
      <div style="font-size:0.7rem;color:#A78BFA;margin-top:6px;font-weight:600;">⏰ תקף ל-24 שעות</div>
    </div>` : '';

  card.innerHTML = `
    <div style="width:72px;height:72px;background:linear-gradient(135deg,#EDE9FE,#DDD6FE);border-radius:22px;display:flex;align-items:center;justify-content:center;font-size:2.6rem;margin:0 auto 12px;">🎉</div>
    <div style="font-size:1.25rem;font-weight:900;color:#1E293B;margin-bottom:4px;">${name} ${isBoy ? 'נוסף' : 'נוספה'} בהצלחה!</div>
    <div style="font-size:0.86rem;color:#64748B;margin-bottom:18px;">${isBoy ? 'הוא' : 'היא'} כבר חלק מהמשפחה ✨</div>
    ${codeBlock}
    ${inviteCode ? `<button id="pop-share-code" style="width:100%;padding:13px;background:linear-gradient(135deg,#7C3AED,#5B21B6);border:none;border-radius:16px;font-size:0.95rem;font-weight:900;font-family:Heebo,sans-serif;cursor:pointer;color:white;margin-bottom:10px;">📤 שתף קוד עם ה${isBoy ? 'ילד' : 'ילדה'}</button>` : ''}
    <button id="pop-back" style="width:100%;padding:13px;background:#F5F3FF;border:2px solid #DDD6FE;border-radius:16px;font-size:0.95rem;font-weight:800;font-family:Heebo,sans-serif;cursor:pointer;color:#6D28D9;">סגור</button>`;

  backdrop.appendChild(card);
  document.body.appendChild(backdrop);

  if (inviteCode) {
    card.querySelector('#pop-share-code').onclick = () => {
      shareCode(inviteCode, name, selectedGender);
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
    ncpc.style.border = 'none'; ncpc.style.width = '85px'; ncpc.style.height = '85px';
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
    photoCircle.style.border = 'none'; photoCircle.style.width = '85px'; photoCircle.style.height = '85px';
    clearBtn.innerHTML = '🗑️ מחק';
    clearBtn.style.display = 'block';
  } else {
    photoCircle.innerHTML = svgPlaceholder;
    photoCircle.style.border = '3px dashed #818CF8'; photoCircle.style.width = '95px'; photoCircle.style.height = '95px';
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
    pc.style.border = 'none'; pc.style.width = '85px'; pc.style.height = '85px';
    const clearBtn = document.getElementById('btn-clear-photo');
    clearBtn.innerHTML = '🗑️ מחק';
    clearBtn.style.display = 'block';
  } catch(err) { showToast('שגיאה ⚠️'); }
};

document.getElementById('btn-clear-photo').onclick = () => {
  editPhotoData = null; editPhotoCleared = true;
  const pc = document.getElementById('edit-child-photo-circle');
  pc.innerHTML = _editSvgPlaceholder;
  pc.style.border = '3px dashed #818CF8'; pc.style.width = '95px'; pc.style.height = '95px';
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
    message: 'כל המשימות, הנקודות וההיסטוריה יימחקו לצמיתות',
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
  shareCode(code, child?.name, child?.gender);
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
      text: 'כאן תוכל לראות את כל הילדים — כוכבים שצברו השבוע והחודש, ומשימות שנותרו להיום'
    },
    {
      el: '#dash-task-section',
      title: 'משימות להיום 📋',
      text: 'כאן מוצגות המשימות שנותרו לביצוע היום לכל ילד — מתחלפות אוטומטית אם יש כמה'
    },
    {
      el: '#btn-open-menu',
      title: 'תפריט הגדרות ⚙️',
      text: 'כאן תוכל לנהל משפחה, משימות, פרסים, נקודות ועוד — הכל במקום אחד',
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

  function applyShutters(el) {
    const rect = el.getBoundingClientRect();
    if (!rect.height) return false;
    shutterTop.style.height = Math.max(0, rect.top - PAD) + 'px';
    shutterBottom.style.height = Math.max(0, window.innerHeight - rect.bottom - PAD) + 'px';
    const fitsBelow = rect.bottom + 200 < window.innerHeight;
    card.style.top    = fitsBelow ? (rect.bottom + 10) + 'px' : 'auto';
    card.style.bottom = fitsBelow ? 'auto' : (window.innerHeight - rect.top + 10) + 'px';
    return true;
  }

  function showStep(idx) {
    const step = visibleSteps[idx];
    const rawEl = document.querySelector(step.el);
    if (!rawEl) { endTour(); return; }

    const el = step.exact ? rawEl : (rawEl.closest('.card') || rawEl.closest('[style]') || rawEl);

    card.classList.remove('visible');
    void card.offsetWidth;
    shutterTop.style.height = '0px';
    shutterBottom.style.height = '0px';

    // גלול את מסך הדשבורד (לא body) כדי להביא את האלמנט למרכז
    const screen = document.querySelector('.screen.active') || document.getElementById('screen-dashboard');
    if (screen) {
      const screenRect = screen.getBoundingClientRect();
      const elRect = rawEl.getBoundingClientRect();
      const desired = screen.scrollTop + (elRect.top - screenRect.top) - (window.innerHeight / 2 - elRect.height / 2);
      screen.scrollTo({ top: Math.max(0, desired), behavior: 'smooth' });
    }

    setTimeout(() => {
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

      document.getElementById('tour-next').onclick = () => {
        currentStep++;
        if (currentStep >= visibleSteps.length) endTour(); else showStep(currentStep);
      };
      document.getElementById('tour-skip')?.addEventListener('click', endTour);

      applyShutters(el);
      setTimeout(() => card.classList.add('visible'), 130);

      // חישוב מחדש אחרי 600ms — אם הדף השתנה (גריד נטען וכו')
      setTimeout(() => applyShutters(el), 700);
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
