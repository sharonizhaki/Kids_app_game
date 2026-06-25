import { auth, db } from './firebase.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getDocs, collection, query, where } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

import { showScreen, showToast, showLoading, hideLoading } from './ui.js';
import { initParentNav } from './parent-nav.js';
import { currentFamilyId, setCurrentFamilyId } from './auth.js';
import { loadChildren } from './family.js';
import {
  openAddTask, saveTask, loadAllTasks,
  renderEditTasksFilters, renderEditTasksList,
  openEditTask, saveEditedTask, toggleHideTask, deleteTask,
  initSuggestions, startTaskTour, createQuickTasks, startEditTasksTour
} from './tasks.js';
import { animatePlaceholder } from './placeholder-anim.js';

const TASK_NAME_PHRASES = [
  'צחצוח שיניים', 'סידור חדר', 'שיעורי בית', 'לקפל כביסה',
  'ניגון על פסנתר', 'פעילות גופנית', 'לעזור בבישול', 'טיפול בחיית המחמד',
];

// =========== GUARD ===========
async function checkAuth() {
  return new Promise((resolve) => {
    let timeoutId = setTimeout(() => { window.location.href = 'index.html'; }, 5000);
    const unsub = onAuthStateChanged(auth, (user) => {
      clearTimeout(timeoutId);
      unsub();
      if (!user || user.isAnonymous) window.location.href = 'index.html';
      else resolve(user);
    });
  });
}

function getFamilyId() { return currentFamilyId; }

window.showScreen = showScreen;

// =========== BACK BUTTON ===========
// חזרה תמיד ל-parent.html
document.getElementById('btn-back-to-parent')?.addEventListener('click', () => {
  window.location.href = 'parent.html';
});
document.getElementById('btn-back-edit-list')?.addEventListener('click', () => {
  window.location.href = 'parent.html';
});
document.getElementById('btn-add-task-from-edit')?.addEventListener('click', () => {
  openAddTask(getFamilyId());
});
document.getElementById('btn-back-edit-task')?.addEventListener('click', () => {
  showScreen('screen-edit-tasks');
  renderEditTasksFilters();
  renderEditTasksList(getFamilyId());
});

// =========== QUICK CATS FORM ===========
// משתמש באותו key כמו הבאנר בדשבורד כדי לסנכרן ביניהם
function formQuickBannerKey() { return `quickBannerDismissed_${getFamilyId() || 'none'}`; }
function formQuickClickedKey() { return `quickBannerClicked_${getFamilyId() || 'none'}`; }
function formGetClicked() { try { return JSON.parse(localStorage.getItem(formQuickClickedKey()) || '[]'); } catch(e) { return []; } }
function formSaveClicked(cat) {
  const arr = formGetClicked();
  if (!arr.includes(cat)) { arr.push(cat); localStorage.setItem(formQuickClickedKey(), JSON.stringify(arr)); }
}

function markFormBtnDone(btn) {
  const labels = { hygiene: 'היגיינה', chores: 'מטלות בית', study: 'לימודים' };
  btn.style.background = 'rgba(22,163,74,0.10)';
  btn.style.borderColor = '#16A34A';
  btn.style.color = '#15803D';
  btn.textContent = `✅ ${labels[btn.dataset.cat] || ''}`;
  btn.style.cursor = 'default';
  btn.disabled = true;
}

function refreshFormQuickSection() {
  const section = document.getElementById('form-quick-cats-section');
  if (!section) return;
  if (localStorage.getItem(formQuickBannerKey()) === '1') { section.style.display = 'none'; return; }
  const clicked = formGetClicked();
  document.querySelectorAll('.quick-cat-btn-form').forEach(btn => {
    if (clicked.includes(btn.dataset.cat)) markFormBtnDone(btn);
  });
}

function animateFormQuickAway() {
  const section = document.getElementById('form-quick-cats-section');
  if (!section || section.style.display === 'none') return;
  const h = section.offsetHeight;
  section.style.overflow = 'hidden';
  section.style.maxHeight = h + 'px';
  section.style.transition = 'transform 0.12s ease-out';
  section.style.transform = 'scale(1.03)';
  setTimeout(() => {
    section.style.transition = 'max-height 0.38s cubic-bezier(.4,0,.2,1),opacity 0.28s ease,transform 0.28s ease';
    section.style.maxHeight = '0'; section.style.opacity = '0'; section.style.transform = 'scale(0.88)';
    setTimeout(() => { section.style.display = 'none'; }, 400);
  }, 120);
}

function dismissFormQuickSection() {
  localStorage.setItem(formQuickBannerKey(), '1');
  animateFormQuickAway();
}

async function handleQuickTasksForm(triggerEl, category) {
  const fid = getFamilyId(); if (!fid) return;
  if (triggerEl) { triggerEl.disabled = true; triggerEl.style.opacity = '0.55'; }
  try {
    const ok = await createQuickTasks(fid, category);
    if (ok && triggerEl) {
      const catLabels = { hygiene: 'היגיינה 🧼', chores: 'מטלות בית 🏠', study: 'לימודים 📚' };
      const catName = catLabels[category] || category;
      showQuickTasksConfirm(catName);
      formSaveClicked(category);
      markFormBtnDone(triggerEl);
      const allDone = [...document.querySelectorAll('.quick-cat-btn-form')].every(b => b.disabled || b.textContent.includes('✅'));
      if (allDone) {
        localStorage.setItem(formQuickBannerKey(), '1');
        setTimeout(animateFormQuickAway, 950);
      }
    }
  } finally {
    if (triggerEl && !triggerEl.textContent.includes('✅')) { triggerEl.disabled = false; triggerEl.style.opacity = ''; }
  }
}

function showQuickTasksConfirm(catName) {
  const existing = document.getElementById('quick-tasks-confirm-modal');
  if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'quick-tasks-confirm-modal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;padding:24px;';
  modal.innerHTML = `
    <div style="background:#fff;border-radius:24px;padding:28px 24px 24px;max-width:320px;width:100%;text-align:center;box-shadow:0 8px 40px rgba(0,0,0,0.18);">
      <div style="font-size:2.8rem;margin-bottom:10px;">✅</div>
      <h3 style="font-size:1.1rem;font-weight:900;color:#111;margin:0 0 8px;">3 משימות נוצרו בהצלחה!</h3>
      <p style="font-size:0.85rem;color:#666;margin:0 0 22px;">משימות בקטגורית ${catName} נוספו לכל הילדים</p>
      <button id="btn-quick-confirm-close" style="width:100%;padding:12px;background:linear-gradient(135deg,#7C3AED,#5B21B6);color:#fff;border:none;border-radius:14px;font-size:0.95rem;font-weight:800;font-family:'Heebo',sans-serif;cursor:pointer;">סגור</button>
    </div>`;
  document.body.appendChild(modal);
  document.getElementById('btn-quick-confirm-close').onclick = () => modal.remove();
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
}

// =========== INIT ===========
(async () => {
  const user = await checkAuth();

  try {
    let famSnap = await getDocs(query(collection(db, 'families'), where('parentUid', '==', user.uid)));
    if (famSnap.empty) famSnap = await getDocs(query(collection(db, 'families'), where('secondaryParentUid', '==', user.uid)));
    if (!famSnap.empty) setCurrentFamilyId(famSnap.docs[0].id);
    else { window.location.href = 'parent.html'; return; }
  } catch(e) { window.location.href = 'parent.html'; return; }

  await loadChildren(getFamilyId());
  hideLoading();
  initParentNav(null, null);

  // בדוק mode מ-sessionStorage (מועבר מ-parent.html)
  const mode = sessionStorage.getItem('tasksMode') || new URLSearchParams(window.location.search).get('mode') || 'add';
  sessionStorage.removeItem('tasksMode');

  if (mode === 'edit') {
    showScreen('screen-edit-tasks');
    await loadAllTasks(getFamilyId());
    renderEditTasksFilters();
    renderEditTasksList(getFamilyId());
    const etTourKey = `editTasksTourDone_${getFamilyId() || 'none'}`;
    if (!localStorage.getItem(etTourKey)) {
      setTimeout(() => startEditTasksTour(getFamilyId()), 900);
    }
  } else {
    // ברירת מחדל: הוספת משימה
    await openAddTask(getFamilyId());
  }

  // Quick cats form
  refreshFormQuickSection();
  document.getElementById('btn-form-quick-close')?.addEventListener('click', dismissFormQuickSection);
  document.querySelectorAll('.quick-cat-btn-form').forEach(btn => {
    btn.addEventListener('click', function() { handleQuickTasksForm(this, this.dataset.cat); });
  });

  initSuggestions();

  const taskNameInput = document.getElementById('task-name-input');
  if (taskNameInput) animatePlaceholder(taskNameInput, TASK_NAME_PHRASES);
})();

// =========== SAVE TASK ===========
document.getElementById('btn-save-task')?.addEventListener('click', async () => {
  await saveTask(getFamilyId());
  // הניווט מטופל על ידי הפופ-אפ בתוך saveTask
});

// =========== EDIT TASK BUTTONS ===========
document.getElementById('btn-et-save')?.addEventListener('click', () => saveEditedTask(getFamilyId()));
document.getElementById('btn-et-hide')?.addEventListener('click', () => toggleHideTask(getFamilyId()));
document.getElementById('btn-et-delete')?.addEventListener('click', () => deleteTask(getFamilyId()));
