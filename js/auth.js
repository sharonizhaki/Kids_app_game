import { auth, db } from './firebase.js';
import {
  signInWithPopup,
  signInWithRedirect,
  GoogleAuthProvider,
  FacebookAuthProvider,
  onAuthStateChanged,
  signOut,
  deleteUser
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc,
  collection, query, where, serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { showScreen, showToast, showLoading, hideLoading } from './ui.js';

// =========== STATE ===========
export let currentParentUid = null;
export let currentFamilyId = null;

export function setCurrentFamilyId(id) { currentFamilyId = id; }

const CODE_EXPIRY_MS = 24 * 60 * 60 * 1000;

// =========== AUTH STATE ===========
export function initAuth(onParentReady, onNoFamily) {
  function checkChildLocal() {
    const savedChildId = localStorage.getItem('childId');
    const savedFamilyId = localStorage.getItem('childFamilyId');
    if (savedChildId && savedFamilyId) {
      window.location.href = 'tasks.html';
      return true;
    }
    return false;
  }

  const splashTimeout = setTimeout(() => {
    if (!auth.currentUser) {
      hideLoading();
      if (!checkChildLocal()) showScreen('screen-who');
    }
  }, 1500);

  onAuthStateChanged(auth, async (user) => {
    clearTimeout(splashTimeout);

    if (!user) {
      hideLoading();
      if (!checkChildLocal()) showScreen('screen-who');
      return;
    }

    if (user.isAnonymous) {
      if (!checkChildLocal()) showScreen('screen-who');
      return;
    }

    // Google/Facebook user — parent
    currentParentUid = user.uid;
    try {
      let famSnap = await getDocs(query(collection(db, 'families'), where('parentUid', '==', user.uid)));
      if (!famSnap.empty) {
        currentFamilyId = famSnap.docs[0].id;
        onParentReady(user);
        return;
      }
      famSnap = await getDocs(query(collection(db, 'families'), where('secondaryParentUid', '==', user.uid)));
      if (!famSnap.empty) {
        currentFamilyId = famSnap.docs[0].id;
        onParentReady(user);
        return;
      }
      onNoFamily();
    } catch(e) {
      console.error('Firestore error:', e);
      onNoFamily();
    }
  });
}

// =========== GOOGLE LOGIN ===========
export async function loginWithGoogle() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    await signInWithPopup(auth, provider);
  } catch(e) {
    if (['auth/popup-blocked','auth/popup-closed-by-user','auth/cancelled-popup-request'].includes(e.code)) {
      showLoading('מעביר ל-Google...');
      try {
        await signInWithRedirect(auth, provider);
      } catch(e2) {
        hideLoading();
        return `שגיאה: ${e2.code || e2.message}`;
      }
    } else if (e.code !== 'auth/cancelled-popup-request') {
      return `שגיאה: ${e.code || e.message}`;
    }
  }
  return null;
}

// =========== FACEBOOK LOGIN ===========
export async function loginWithFacebook() {
  const provider = new FacebookAuthProvider();
  try {
    showLoading('מתחבר...');
    await signInWithPopup(auth, provider);
  } catch(e) {
    hideLoading();
    if (['auth/popup-blocked','auth/popup-closed-by-user','auth/cancelled-popup-request'].includes(e.code)) {
      showLoading('מעביר ל-Facebook...');
      try {
        await signInWithRedirect(auth, provider);
      } catch(e2) {
        hideLoading();
        return `שגיאה: ${e2.code || e2.message}`;
      }
    } else if (e.code === 'auth/account-exists-with-different-credential') {
      return 'חשבון קיים עם Google. התחבר עם Google במקום.';
    } else {
      return `שגיאה: ${e.code || e.message}`;
    }
  }
  return null;
}

// =========== LOGOUT ===========
export async function logoutParent(onDone) {
  await signOut(auth);
  currentParentUid = null;
  currentFamilyId = null;
  onDone();
}

// =========== CREATE NEW FAMILY ===========
export async function createNewFamily(user) {
  showLoading('יוצר משפחה...');
  try {
    const famRef = doc(collection(db, 'families'));
    currentFamilyId = famRef.id;
    await setDoc(famRef, {
      parentUid: user.uid,
      parentName: user.displayName || '',
      parentEmail: user.email || '',
      createdAt: serverTimestamp()
    });
    hideLoading();
    showToast('משפחה נוצרה! 🏠');
    return { success: true };
  } catch(e) {
    hideLoading();
    console.error(e);
    return { success: false };
  }
}

// =========== JOIN FAMILY (secondary parent) ===========
export async function joinFamily(code) {
  showLoading('בודק...');
  try {
    const codeSnap = await getDoc(doc(db, 'parentInviteCodes', code));
    if (!codeSnap.exists()) { hideLoading(); return { error: 'קוד שגוי' }; }
    const codeData = codeSnap.data();

    const created = codeData.createdAt?.toDate ? codeData.createdAt.toDate() : new Date(0);
    if (Date.now() - created.getTime() > CODE_EXPIRY_MS) { hideLoading(); return { error: 'הקוד פג תוקף' }; }
    if (codeData.used) { hideLoading(); return { error: 'הקוד כבר שומש' }; }

    const user = auth.currentUser;
    await updateDoc(doc(db, 'families', codeData.familyId), {
      secondaryParentUid: user.uid,
      secondaryParentName: user.displayName || '',
      secondaryParentEmail: user.email || ''
    });
    await updateDoc(doc(db, 'parentInviteCodes', code), { used: true });

    currentFamilyId = codeData.familyId;
    hideLoading();
    showToast('הצטרפת למשפחה! 🎉');
    return { success: true };
  } catch(e) {
    hideLoading();
    console.error(e);
    return { error: 'שגיאה, נסה שוב' };
  }
}

// =========== GENERATE INVITE CODE ===========
export function generateCode() {
  let code = '';
  for (let i = 0; i < 6; i++) code += Math.floor(Math.random() * 10);
  return code;
}

// =========== DELETE ACCOUNT ===========
export function confirmDeleteAccount(onConfirmed) {
  const ov = document.createElement('div');
  ov.className = 'modal-overlay';

  const sh = document.createElement('div');
  sh.className = 'modal-sheet';
  sh.innerHTML = `
    <div class="modal-handle"></div>
    <div class="modal-header">
      <h2>⚠️ מחיקת חשבון</h2>
      <button class="modal-close">✕</button>
    </div>
    <div class="modal-body">
      <p style="font-size:0.95rem;font-weight:600;margin-bottom:8px;">האם אתה בטוח שברצונך למחוק את החשבון?</p>
      <p style="font-size:0.85rem;color:var(--muted);margin-bottom:20px;">פעולה זו תמחק לצמיתות את חשבונך, את כל הילדים, המטלות וכל נתוני המשפחה. <strong>לא ניתן לשחזר.</strong></p>
      <div style="display:flex;gap:10px;">
        <button class="btn btn-danger btn-sm" id="confirm-delete-btn" style="flex:1;">🗑️ כן, מחק הכל</button>
        <button class="btn btn-secondary btn-sm" id="cancel-delete-btn" style="flex:1;">ביטול</button>
      </div>
    </div>`;

  sh.querySelector('.modal-close').onclick = () => ov.remove();
  sh.querySelector('#cancel-delete-btn').onclick = () => ov.remove();
  sh.querySelector('#confirm-delete-btn').onclick = () => {
    ov.remove();
    onConfirmed();
  };
  ov.onclick = e => { if (e.target === ov) ov.remove(); };

  ov.appendChild(sh);
  document.body.appendChild(ov);
}

async function safeDeleteCollection(snap) {
  for (const d of snap.docs) {
    try { await deleteDoc(d.ref); } catch(e) { console.warn('safeDelete failed:', d.ref.path, e); }
  }
}

export async function deleteAccount(familyId, onDone) {
  showLoading('מוחק חשבון...');
  try {
    if (familyId) {
      // מחיקת ילדים וקודי ההזמנה שלהם
      try {
        const childrenSnap = await getDocs(collection(db, 'families', familyId, 'children'));
        for (const childDoc of childrenSnap.docs) {
          const childData = childDoc.data();
          if (childData.inviteCode) {
            try { await deleteDoc(doc(db, 'inviteCodes', childData.inviteCode)); } catch(e) {}
          }
          try { await deleteDoc(childDoc.ref); } catch(e) { console.warn('child delete failed', e); }
        }
      } catch(e) { console.warn('children fetch failed', e); }

      // מחיקת מטלות
      try {
        const tasksSnap = await getDocs(collection(db, 'families', familyId, 'tasks'));
        await safeDeleteCollection(tasksSnap);
      } catch(e) { console.warn('tasks fetch failed', e); }

      // מחיקת היסטוריית שבועות
      try {
        const histSnap = await getDocs(collection(db, 'families', familyId, 'weeklyHistory'));
        await safeDeleteCollection(histSnap);
      } catch(e) { console.warn('weeklyHistory fetch failed', e); }

      // מחיקת קודי הזמנה להורים
      try {
        const parentCodesSnap = await getDocs(
          query(collection(db, 'parentInviteCodes'), where('familyId', '==', familyId))
        );
        await safeDeleteCollection(parentCodesSnap);
      } catch(e) { console.warn('parentCodes fetch failed', e); }

      // מחיקת מסמך המשפחה — חובה שיצליח
      await deleteDoc(doc(db, 'families', familyId));
    }

    // מחיקת משתמש מ-Firebase Auth
    const user = auth.currentUser;
    if (user) await deleteUser(user);

    hideLoading();
    currentParentUid = null;
    currentFamilyId = null;
    onDone();
  } catch(e) {
    hideLoading();
    if (e.code === 'auth/requires-recent-login') {
      showToast('יש להתחבר מחדש לפני מחיקת החשבון 🔒');
      await signOut(auth);
      currentParentUid = null;
      currentFamilyId = null;
      showScreen('screen-who');
    } else {
      console.error('deleteAccount error:', e.code, e.message);
      showToast('שגיאה במחיקה, נסה שוב ⚠️');
    }
  }
}
