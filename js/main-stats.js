// =========== main-stats.js ===========
import { auth, db } from './firebase.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { getDocs, collection, query, where } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { showScreen, hideLoading } from './ui.js';
import { currentFamilyId, setCurrentFamilyId } from './auth.js';
import { loadAndRenderStats, initStatsPeriodChips } from './stats.js';

async function checkAuth() {
  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => { window.location.href = 'index.html'; }, 5000);
    const unsub = onAuthStateChanged(auth, (user) => {
      clearTimeout(timeoutId); unsub();
      if (!user || user.isAnonymous) window.location.href = 'index.html';
      else resolve(user);
    });
  });
}

document.getElementById('btn-back-stats')?.addEventListener('click', () => {
  window.location.href = 'parent.html';
});

(async () => {
  const user = await checkAuth();
  try {
    let famSnap = await getDocs(query(collection(db, 'families'), where('parentUid', '==', user.uid)));
    if (famSnap.empty)
      famSnap = await getDocs(query(collection(db, 'families'), where('secondaryParentUid', '==', user.uid)));
    if (!famSnap.empty) setCurrentFamilyId(famSnap.docs[0].id);
    else { window.location.href = 'parent.html'; return; }
  } catch(e) { window.location.href = 'parent.html'; return; }

  const familyId = currentFamilyId;
  hideLoading();
  showScreen('screen-stats');
  initStatsPeriodChips(familyId);
  await loadAndRenderStats(familyId);
})();
