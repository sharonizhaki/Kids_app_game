import { auth, db } from './firebase.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getDocs, collection, query, where } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

import { showScreen, hideLoading } from './ui.js';
import { currentFamilyId, setCurrentFamilyId } from './auth.js';
import { loadCompletedTasks, renderMPFilters, renderMPList, resetMPState } from './points.js';

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

// =========== BACK ===========
document.getElementById('btn-back-to-parent')?.addEventListener('click', () => {
  window.location.href = 'parent.html';
});

// =========== INIT ===========
(async () => {
  const user = await checkAuth();

  try {
    let famSnap = await getDocs(query(collection(db, 'families'), where('parentUid', '==', user.uid)));
    if (famSnap.empty) famSnap = await getDocs(query(collection(db, 'families'), where('secondaryParentUid', '==', user.uid)));
    if (!famSnap.empty) setCurrentFamilyId(famSnap.docs[0].id);
    else { window.location.href = 'parent.html'; return; }
  } catch(e) { window.location.href = 'parent.html'; return; }

  hideLoading();
  resetMPState();
  showScreen('screen-manage-points');
  await loadCompletedTasks(getFamilyId());
  renderMPFilters();
  renderMPList(getFamilyId());
})();
