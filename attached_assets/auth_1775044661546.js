import { auth, db } from './firebase.js';
import {
  signInWithPopup,
  signInWithRedirect,
  GoogleAuthProvider,
  FacebookAuthProvider,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  doc, getDoc, getDocs, setDoc, updateDoc,
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
  try {
    showLoading('מתחבר...');
    await signInWithPopup(auth, provider);
  } catch(e) {
    hideLoading();
    if (['auth/popup-blocked','auth/popup-closed-by-user','auth/cancelled-popup-request'].includes(e.code)) {
      showLoading('מעביר ל-Google...');
      try {
        await signInWithRedirect(auth, provider);
      } catch(e2) {
        hideLoading();
        return `שגיאה: ${e2.code || e2.message}`;
      }
    } else {
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
