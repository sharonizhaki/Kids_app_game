import { auth, db } from './firebase.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getDocs, collection, query, where } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

import { showScreen, showToast, showLoading, hideLoading } from './ui.js';
import { currentFamilyId, setCurrentFamilyId } from './auth.js';
import { loadChildren } from './family.js';
import {
  openAddTask, saveTask, loadAllTasks,
  renderEditTasksFilters, renderEditTasksList,
  openEditTask, saveEditedTask, toggleHideTask, deleteTask,
  initSuggestions, startTaskTour, createQuickTasks
} from './tasks.js';

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
document.getElementById('btn-back-edit-task')?.addEventListener('click', () => {
  showScreen('screen-edit-tasks');
  renderEditTasksList(getFamilyId());
});

// =========== QUICK CATS FORM ===========
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

  // בדוק mode מה-URL
  const params = new URLSearchParams(window.location.search);
  const mode = params.get('mode');

  if (mode === 'edit') {
    showScreen('screen-edit-tasks');
    await loadAllTasks(getFamilyId());
    renderEditTasksFilters();
    renderEditTasksList(getFamilyId());
  } else {
    // ברירת מחדל: הוספת מטלה
    await openAddTask(getFamilyId());
  }

  // Quick cats form
  refreshFormQuickSection();
  document.getElementById('btn-form-quick-close')?.addEventListener('click', dismissFormQuickSection);
  document.querySelectorAll('.quick-cat-btn-form').forEach(btn => {
    btn.addEventListener('click', function() { handleQuickTasksForm(this, this.dataset.cat); });
  });

  initSuggestions();
})();

// =========== SAVE TASK ===========
document.getElementById('btn-save-task')?.addEventListener('click', async () => {
  await saveTask(getFamilyId());
  // אחרי שמירה — חזרה לדשבורד
  if (!document.getElementById('add-task-error').textContent) {
    window.location.href = 'parent.html';
  }
});

// =========== EDIT TASK BUTTONS ===========
document.getElementById('btn-et-save')?.addEventListener('click', () => saveEditedTask(getFamilyId()));
document.getElementById('btn-et-hide')?.addEventListener('click', () => toggleHideTask(getFamilyId()));
document.getElementById('btn-et-delete')?.addEventListener('click', () => deleteTask(getFamilyId()));
