import { auth, db } from './firebase.js';
import {
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  GoogleAuthProvider,
  FacebookAuthProvider,
  onAuthStateChanged,
  signOut,
  deleteUser,
  reauthenticateWithPopup,
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  signInWithEmailLink
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, deleteField,
  collection, query, where, serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { showToast, showLoading, hideLoading, showConnectionError } from './ui.js';

// =========== STATE ===========
export let currentParentUid = null;
export let currentFamilyId = null;

export function setCurrentFamilyId(id) { currentFamilyId = id; }

const CODE_EXPIRY_MS = 24 * 60 * 60 * 1000;

// =========== ERROR MESSAGES ===========
const AUTH_ERROR_MESSAGES = {
  'auth/unauthorized-domain': 'הדומיין הנוכחי אינו מורשה ב-Firebase. יש להוסיף אותו ברשימת הדומיינים המורשים במסוף Firebase.',
  'auth/popup-blocked': 'הדפדפן חסם את החלון הקופץ. מנסה להפנות...',
  'auth/network-request-failed': 'שגיאת רשת. בדוק את החיבור לאינטרנט.',
  'auth/too-many-requests': 'יותר מדי ניסיונות. נסה שוב מאוחר יותר.',
  'auth/user-disabled': 'החשבון הושבת.',
  'auth/account-exists-with-different-credential': 'חשבון קיים עם אמצעי התחברות אחר (כנראה Google). נסה להתחבר עם Google.',
  'auth/cancelled-popup-request': null,
  'auth/popup-closed-by-user': null,
};

function getAuthErrorMsg(code, fallback) {
  if (AUTH_ERROR_MESSAGES[code] === null) return null;
  return AUTH_ERROR_MESSAGES[code] || fallback || `שגיאה: ${code}`;
}

// =========== AUTH STATE ===========
// נקרא רק מ-index.html
export function initAuth(onParentReady, onNoFamily) {
  function checkChildLocal() {
    const savedChildId = localStorage.getItem('childId');
    const savedFamilyId = localStorage.getItem('childFamilyId');
    if (savedChildId && savedFamilyId) {
      window.location.href = 'child.html';
      return true;
    }
    return false;
  }

  // Handle redirect result (after signInWithRedirect)
  getRedirectResult(auth).then(result => {
    // result is null if no redirect happened; Firebase handles auth state via onAuthStateChanged
  }).catch(e => {
    console.warn('getRedirectResult error:', e.code, e.message);
    const msg = getAuthErrorMsg(e.code, `שגיאה בהתחברות: ${e.code}`);
    if (msg) {
      const errEl = document.getElementById('login-error');
      if (errEl) errEl.textContent = msg;
    }
    hideLoading();
  });

  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      checkChildLocal();
      return;
    }

    if (user.isAnonymous) {
      checkChildLocal();
      return;
    }

    // Google/Facebook user — parent
    currentParentUid = user.uid;

    let authSettled = false;

    const firestoreWork = async () => {
      let famSnap = await getDocs(query(collection(db, 'families'), where('parentUid', '==', user.uid)));
      if (authSettled) return;
      if (!famSnap.empty) {
        authSettled = true;
        currentFamilyId = famSnap.docs[0].id;
        onParentReady(user);
        return;
      }
      famSnap = await getDocs(query(collection(db, 'families'), where('secondaryParentUid', '==', user.uid)));
      if (authSettled) return;
      if (!famSnap.empty) {
        authSettled = true;
        currentFamilyId = famSnap.docs[0].id;
        onParentReady(user);
        return;
      }
      authSettled = true;
      onNoFamily();
    };

    const connectionTimeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('connection-timeout')), 8000)
    );

    try {
      await Promise.race([firestoreWork(), connectionTimeout]);
    } catch(e) {
      if (e.message === 'connection-timeout') {
        console.warn('Firestore timeout — showing connection error');
        authSettled = true;
        hideLoading();
        showConnectionError();
      } else {
        console.error('Firestore error:', e);
        if (!authSettled) { authSettled = true; onNoFamily(); }
      }
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
    const popupErrors = ['auth/popup-blocked','auth/popup-closed-by-user','auth/cancelled-popup-request'];
    if (popupErrors.includes(e.code)) {
      showLoading('מעביר ל-Google...');
      try {
        await signInWithRedirect(auth, provider);
      } catch(e2) {
        hideLoading();
        return getAuthErrorMsg(e2.code, `שגיאה: ${e2.code || e2.message}`);
      }
    } else {
      return getAuthErrorMsg(e.code, `שגיאה: ${e.code || e.message}`);
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
    const popupErrors = ['auth/popup-blocked','auth/popup-closed-by-user','auth/cancelled-popup-request'];
    if (popupErrors.includes(e.code)) {
      showLoading('מעביר ל-Facebook...');
      try {
        await signInWithRedirect(auth, provider);
      } catch(e2) {
        hideLoading();
        return getAuthErrorMsg(e2.code, `שגיאה: ${e2.code || e2.message}`);
      }
    } else {
      return getAuthErrorMsg(e.code, `שגיאה: ${e.code || e.message}`);
    }
  }
  return null;
}

// =========== MAGIC LINK ===========
export async function sendMagicLink(email) {
  const actionCodeSettings = {
    url: window.location.origin + '/index.html',
    handleCodeInApp: true,
  };
  try {
    await sendSignInLinkToEmail(auth, email, actionCodeSettings);
    localStorage.setItem('emailForSignIn', email);
    return { success: true };
  } catch(e) {
    console.error('sendMagicLink error:', e);
    const msgs = {
      'auth/invalid-email': 'כתובת מייל לא תקינה',
      'auth/missing-email': 'חסרה כתובת מייל',
    };
    return { error: msgs[e.code] || `שגיאה: ${e.code}` };
  }
}

export async function completeMagicLinkSignIn() {
  if (!isSignInWithEmailLink(auth, window.location.href)) return false;
  let email = localStorage.getItem('emailForSignIn');
  if (!email) {
    email = window.prompt('הכנס את כתובת המייל שהזנת בהתחברות');
    if (!email) return false;
  }
  try {
    await signInWithEmailLink(auth, email, window.location.href);
    localStorage.removeItem('emailForSignIn');
    window.history.replaceState(null, '', window.location.pathname);
    return true;
  } catch(e) {
    console.error('completeMagicLinkSignIn error:', e);
    return false;
  }
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
async function isPrimaryParentForFamily(familyId, uid) {
  if (!familyId || !uid) return false;
  const famSnap = await getDoc(doc(db, 'families', familyId));
  if (!famSnap.exists()) return false;
  return famSnap.data().parentUid === uid;
}

export async function confirmDeleteAccount(onConfirmed, familyId = currentFamilyId) {
  const user = auth.currentUser;
  const isPrimary = user ? await isPrimaryParentForFamily(familyId, user.uid) : true;

  const bodyText = isPrimary
    ? 'פעולה זו תמחק לצמיתות את חשבונך, את כל הילדים, המשימות וכל נתוני המשפחה. <strong>לא ניתן לשחזר.</strong>'
    : 'פעולה זו תמחק לצמיתות רק את <strong>חשבונך</strong> ותסיר אותך מהמשפחה. הילדים, המשימות ושאר נתוני המשפחה <strong>יישארו ללא שינוי</strong>. לא ניתן לשחזר את חשבונך.';

  const confirmLabel = isPrimary ? '🗑️ כן, מחק הכל' : '🗑️ כן, מחק את החשבון שלי';

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
      <p style="font-size:0.85rem;color:var(--muted);margin-bottom:20px;">${bodyText}</p>
      <div style="display:flex;gap:10px;">
        <button class="btn btn-danger btn-sm" id="confirm-delete-btn" style="flex:1;">${confirmLabel}</button>
        <button class="btn btn-secondary btn-sm" id="cancel-delete-btn" style="flex:1;">ביטול</button>
      </div>
    </div>`;
  sh.querySelector('.modal-close').onclick = () => ov.remove();
  sh.querySelector('#cancel-delete-btn').onclick = () => ov.remove();
  sh.querySelector('#confirm-delete-btn').onclick = () => { ov.remove(); onConfirmed(); };
  ov.onclick = e => { if (e.target === ov) ov.remove(); };
  ov.appendChild(sh);
  document.body.appendChild(ov);
}

async function safeDeleteCollection(snap) {
  for (const d of snap.docs) {
    try { await deleteDoc(d.ref); } catch(e) { console.warn('safeDelete failed:', d.ref.path, e); }
  }
}

async function deleteFamilyData(familyId) {
  console.log('[deleteAccount] מוחק משפחה:', familyId);
  try {
    const childrenSnap = await getDocs(collection(db, 'families', familyId, 'children'));
    for (const childDoc of childrenSnap.docs) {
      const childData = childDoc.data();
      if (childData.inviteCode) {
        try { await deleteDoc(doc(db, 'inviteCodes', childData.inviteCode)); } catch(e) {}
      }
      try {
        const stateSnap = await getDocs(collection(db, 'families', familyId, 'children', childDoc.id, 'state'));
        await safeDeleteCollection(stateSnap);
      } catch(e) {}
      try {
        const notifSnap = await getDocs(collection(db, 'families', familyId, 'children', childDoc.id, 'notifications'));
        await safeDeleteCollection(notifSnap);
      } catch(e) {}
      try { await deleteDoc(childDoc.ref); } catch(e) { console.error('child delete failed:', childDoc.id, e); }
    }
  } catch(e) { console.error('children fetch failed:', e); }

  for (const sub of ['tasks', 'weeklyHistory', 'prizes', 'prizeRequests', 'pendingApprovals']) {
    try {
      const snap = await getDocs(collection(db, 'families', familyId, sub));
      await safeDeleteCollection(snap);
    } catch(e) {}
  }

  try {
    const parentCodesSnap = await getDocs(query(collection(db, 'parentInviteCodes'), where('familyId', '==', familyId)));
    await safeDeleteCollection(parentCodesSnap);
  } catch(e) {}

  try { await deleteDoc(doc(db, 'families', familyId)); } catch(e) {}
}

async function removeSecondaryParentFromFamily(familyId, uid) {
  console.log('[deleteAccount] מסיר הורה משני מהמשפחה:', familyId);
  const famRef = doc(db, 'families', familyId);
  const famSnap = await getDoc(famRef);
  if (!famSnap.exists()) return;
  const fam = famSnap.data();
  if (fam.secondaryParentUid !== uid) return;
  await updateDoc(famRef, {
    secondaryParentUid: deleteField(),
    secondaryParentName: deleteField(),
    secondaryParentEmail: deleteField(),
  });
}

async function deleteAccountData(familyId, user) {
  if (!familyId || !user) return;
  const famSnap = await getDoc(doc(db, 'families', familyId));
  if (!famSnap.exists()) return;
  const fam = famSnap.data();
  if (fam.parentUid === user.uid) {
    await deleteFamilyData(familyId);
  } else if (fam.secondaryParentUid === user.uid) {
    await removeSecondaryParentFromFamily(familyId, user.uid);
  }
}

async function finishDeleteAccount(user, onDone) {
  if (user) await deleteUser(user);
  hideLoading();
  currentParentUid = null;
  currentFamilyId = null;
  onDone();
}

export async function deleteAccount(familyId, onDone) {
  showLoading('מוחק חשבון...');
  const user = auth.currentUser;
  try {
    await deleteAccountData(familyId, user);
    await finishDeleteAccount(user, onDone);
  } catch(e) {
    hideLoading();
    if (e.code === 'auth/requires-recent-login') {
      const providerId = user?.providerData?.[0]?.providerId;
      if (user && providerId === 'google.com') {
        try {
          showToast('מאמת זהות... 🔒');
          await reauthenticateWithPopup(user, new GoogleAuthProvider());
          showLoading('מוחק חשבון...');
          await deleteAccountData(familyId, user);
          await finishDeleteAccount(user, onDone);
          return;
        } catch(reAuthErr) {
          showToast('אימות נכשל ⚠️');
          await signOut(auth);
          currentParentUid = null;
          currentFamilyId = null;
          window.location.href = 'index.html';
          return;
        }
      }
      showToast('יש להתחבר מחדש לפני מחיקה 🔒');
      await signOut(auth);
      currentParentUid = null;
      currentFamilyId = null;
      window.location.href = 'index.html';
    } else {
      console.error('deleteAccount error:', e);
      showToast('שגיאה במחיקה ⚠️');
    }
  }
}
