// =========== main-points.js ===========
import { auth, db } from './firebase.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { getDocs, collection, query, where } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { showScreen, hideLoading } from './ui.js';
import { currentFamilyId, setCurrentFamilyId } from './auth.js';
import {
  loadCompletedTasks, loadPendingApprovals, loadAllPrizeRequests,
  renderMPTabs, renderMPFilters, renderMPList, renderPendingTab, showActiveTab,
  initPendingListener, initPrizeRequestsListener,
  resetMPState, setMPState,
} from './points.js';

async function checkAuth() {
  return new Promise((resolve) => {
    let timeoutId = setTimeout(() => { window.location.href = 'index.html'; }, 5000);
    const unsub = onAuthStateChanged(auth, (user) => {
      clearTimeout(timeoutId); unsub();
      if (!user || user.isAnonymous) window.location.href = 'index.html';
      else resolve(user);
    });
  });
}

function getFamilyId() { return currentFamilyId; }

document.getElementById('btn-back-to-parent')?.addEventListener('click', () => {
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

  const familyId = getFamilyId();
  hideLoading();
  resetMPState();

  // ניווט מכרטיס ילד בדשבורד → פתח היסטוריה מסוננת לאותו ילד
  const urlParams  = new URLSearchParams(window.location.search);
  const childName  = urlParams.get('childName');
  const tabParam   = urlParams.get('tab');
  if (childName) setMPState('history', 'child', childName);
  else if (tabParam) setMPState(tabParam, 'all', '');

  showScreen('screen-manage-points');

  await Promise.all([
    loadCompletedTasks(familyId),
    loadPendingApprovals(familyId),
    loadAllPrizeRequests(familyId),
  ]);

  renderMPTabs(familyId);
  showActiveTab(familyId);

  // listeners חיים
  initPendingListener(familyId, () => {
    renderMPTabs(familyId);
    const activeTab = document.querySelector('.mp-tab.active');
    if (activeTab?.dataset?.tab === 'pending') renderPendingTab(familyId);
  });

  initPrizeRequestsListener(familyId, () => {
    renderMPTabs(familyId);
    const activeTab = document.querySelector('.mp-tab.active');
    if (activeTab?.dataset?.tab === 'pending') renderPendingTab(familyId);
  });
})();
