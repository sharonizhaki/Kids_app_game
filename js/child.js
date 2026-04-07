// =========== child.js ===========
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signOut }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
  getFirestore, doc, getDoc, setDoc, getDocs,
  collection, updateDoc, onSnapshot,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

import { state }                                              from './child-state.js';
import { show, showToast, showConfirm }                      from './child-ui.js';
import {
  isDone, renderCategories, renderHistory,
  renderPendingSection, initTasksModule,
} from './child-tasks.js';
import { initProfile }                                        from './child-profile.js';
import { initPrizes, renderPrizesScreen }                    from './child-prizes.js';
import {
  checkAndGrantBadges, computeStreak,
  renderBadgesScreen, renderWeekGraph,
} from './child-badges.js';
import { startOnboarding }                                    from './child-onboarding.js';

// -------- FIREBASE --------
const firebaseConfig = {
  apiKey:            'AIzaSyDC0GADxe3qv6uv6s6fGR3O7_lL9iHl4ag',
  authDomain:        'kidssapp-izhaki.firebaseapp.com',
  databaseURL:       'https://kidssapp-izhaki-default-rtdb.europe-west1.firebasedatabase.app',
  projectId:         'kidssapp-izhaki',
  storageBucket:     'kidssapp-izhaki.firebasestorage.app',
  messagingSenderId: '663906163746',
  appId:             '1:663906163746:web:a4f66772a2ae0dedc47e7b',
};
const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

// -------- GREETINGS --------
const GREETINGS_M = ['יאללה נתחיל! 💪','בוא נעשה את זה! 🚀','היום תהיה מדהים! ✨','מוכן לאסוף כוכבים? 🔥','הגיבור שלנו הגיע! 🦸‍♂️'];
const GREETINGS_F = ['יאללה נתחילי! 💪','בואי נעשה את זה! 🚀','היום תהיי מדהימה! ✨','מוכנה לאסוף כוכבים? 🔥','הגיבורה שלנו הגיעה! 🦸‍♀️'];

// -------- COLOR UTILS --------
function darkenColor(hex) {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  return `rgb(${Math.max(0,r-40)},${Math.max(0,g-40)},${Math.max(0,b-40)})`;
}
function lightenColor(hex) {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  return `rgb(${Math.min(255,r+60)},${Math.min(255,g+60)},${Math.min(255,b+60)})`;
}

// -------- DATE KEYS --------
function weekKey() {
  const d = new Date(), day = d.getDay();
  const sun = new Date(d); sun.setDate(d.getDate() - day);
  return `w-${sun.getFullYear()}-${String(sun.getMonth()+1).padStart(2,'0')}-${String(sun.getDate()).padStart(2,'0')}`;
}
function monthKey() {
  const d = new Date();
  return `m-${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}
function defaultState() {
  return {
    pts: 0, monthlyPts: 0, comp: {}, hist: [],
    lastActive: '', wk: weekKey(), mk: monthKey(),
    streak: 0, dailyPts: {}, badges: [], pending: [],
  };
}

// -------- SAVE STATE --------
export async function saveState() {
  try {
    const ref = doc(db, 'families', state.familyId, 'children', state.childId, 'state', 'current');
    await updateDoc(ref, state.childState).catch(async () => setDoc(ref, state.childState));
  } catch (e) { console.error('saveState error:', e); }
}

// -------- RENDER CHILD --------
export function renderChild() {
  const { childData, childState } = state;
  if (!childData || !childState) return;

  // header
  const photoEl = document.getElementById('child-header-photo');
  const emojiEl = document.getElementById('child-header-emoji');
  if (childData.photo && childData.photo.length > 10) {
    photoEl.innerHTML = `<img src="${childData.photo}" alt="${childData.name}">`;
  } else if (emojiEl) {
    emojiEl.textContent = childData.emoji || '⭐';
  }
  const titleEl = document.getElementById('child-title');
  if (titleEl) titleEl.textContent = childData.name;

  const navIcon = document.getElementById('nav-profile-icon');
  if (navIcon) navIcon.textContent = childData.emoji || '👤';

  // greeting
  const color = childData.color || '#6366F1';
  const gc    = document.getElementById('greeting-card');
  if (gc) {
    gc.style.background = `linear-gradient(135deg, ${color}, ${darkenColor(color)})`;
    gc.style.boxShadow  = `0 6px 24px ${color}55`;
  }
  const greetings = childData.gender === 'female' ? GREETINGS_F : GREETINGS_M;
  const gtEl = document.getElementById('greeting-text');
  if (gtEl) gtEl.textContent = `שלום ${childData.name}! ${greetings[Math.floor(Math.random()*greetings.length)]}`;

  const todayDone = state.tasksData.filter(t => isDone(t)).length;
  const gsEl = document.getElementById('greeting-sub');
  if (gsEl) gsEl.textContent = todayDone > 0
    ? `ביצעת ${todayDone} משימות היום - כל הכבוד! 🎉`
    : (childData.gender === 'female' ? 'בחרי קטגוריה והתחילי!' : 'בחר קטגוריה והתחל!');

  // stats
  const pts   = childState.pts || 0;
  const pbVal = document.getElementById('pb-val');
  const moVal = document.getElementById('monthly-val');
  if (pbVal) pbVal.textContent = pts;
  if (moVal) moVal.textContent = (childState.monthlyPts || 0) + pts;

  // streak
  const streak     = computeStreak();
  const streakVal  = document.getElementById('streak-val');
  const streakCard = document.getElementById('streak-card');
  if (streakVal)  streakVal.textContent = streak;
  if (streakCard) streakCard.classList.toggle('active', streak >= 2);

  // progress
  const ptEl = document.getElementById('progress-text');
  if (ptEl) ptEl.textContent = `${pts} / 100 כוכבים`;
  const pf = document.getElementById('progress-fill');
  if (pf) {
    pf.style.background = `linear-gradient(90deg, ${color}, ${lightenColor(color)})`;
    pf.style.width = '0%';
    const pl = document.getElementById('progress-pts-label');
    if (pl) pl.textContent = pts > 2 ? `${pts} ⭐` : '';
    setTimeout(() => { pf.style.width = Math.min(100, pts) + '%'; }, 100);
  }

  // sub-modules
  renderWeekGraph();
  renderPendingSection();
  renderCategories(saveState, renderChild);
  renderHistory();

  // badges
  const newBadges = checkAndGrantBadges(saveState);
  if (newBadges.length > 0) {
    const nb = document.getElementById('nav-badge-badges');
    if (nb) { nb.textContent = '!'; nb.style.display = 'flex'; }
  }
}

// -------- BOTTOM NAV --------
function initNav() {
  const navBtns = document.querySelectorAll('.nav-btn');
  navBtns.forEach(btn => {
    btn.onclick = () => {
      const tab = btn.dataset.tab;
      navBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      show(btn.dataset.screen);
      if (tab === 'prizes') renderPrizesScreen();
      if (tab === 'badges') {
        renderBadgesScreen();
        const nb = document.getElementById('nav-badge-badges');
        if (nb) nb.style.display = 'none';
      }
    };
  });
}

// -------- AUTH & LOAD --------
function clearStorage() {
  ['childId','childFamilyId','childAnonUid'].forEach(k => localStorage.removeItem(k));
}

if (!state.childId || !state.familyId) {
  window.location.href = 'index.html';
} else {
  let authResolved = false;

  const authFallback = setTimeout(() => {
    if (!authResolved) {
      authResolved = true;
      clearStorage();
      window.location.href = 'index.html';
    }
  }, 10000);

  const unsubAuth = onAuthStateChanged(auth, user => {
    if (authResolved) return;
    clearTimeout(authFallback);
    authResolved = true;
    unsubAuth();
    if (!user) { clearStorage(); window.location.href = 'index.html'; }
    else loadChild();
  });
}

async function loadChild() {
  try {
    const childSnap = await getDoc(doc(db, 'families', state.familyId, 'children', state.childId));
    if (!childSnap.exists()) { clearStorage(); window.location.href = 'index.html'; return; }
    state.childData = childSnap.data();
    if (state.childData.color)
      document.documentElement.style.setProperty('--child-color', state.childData.color);

    const stateSnap = await getDoc(
      doc(db, 'families', state.familyId, 'children', state.childId, 'state', 'current')
    );
    if (stateSnap.exists()) {
      state.childState = stateSnap.data();
      const cs = state.childState;
      if (cs.monthlyPts === undefined) cs.monthlyPts = 0;
      if (!cs.mk)       cs.mk       = monthKey();
      if (!cs.dailyPts) cs.dailyPts = {};
      if (!cs.badges)   cs.badges   = [];
      if (!cs.pending)  cs.pending  = [];
      if (cs.streak === undefined) cs.streak = 0;

      let changed = false;
      if (cs.mk !== monthKey()) { cs.monthlyPts = 0; cs.mk = monthKey(); changed = true; }
      if (cs.wk !== weekKey()) {
        cs.monthlyPts = (cs.monthlyPts || 0) + (cs.pts || 0);
        cs.pts = 0; cs.comp = {}; cs.wk = weekKey(); changed = true;
      }
      if (changed) await saveState();
    } else {
      state.childState = defaultState();
      await saveState();
    }

    try {
      const tasksSnap = await getDocs(collection(db, 'families', state.familyId, 'tasks'));
      state.tasksData = [];
      tasksSnap.forEach(d => {
        const data = d.data();
        if (data.assignedChildren?.includes(state.childId))
          state.tasksData.push({ id: d.id, ...data });
      });
    } catch (e) { state.tasksData = []; }

    // init modules — חשוב: initTasksModule לפני initProfile ו-initPrizes
    initTasksModule(db);
    initProfile(db, renderChild);
    initPrizes(db);
    initNav();

    // -------- ONBOARDING CHECK --------
    if (!state.childData.onboarded) {
      window._childShowFn = { show };
      startOnboarding(db, () => {
        renderChild();
        show('screen-child');
      });
      return;
    }

    renderChild();
    show('screen-child');

    onSnapshot(collection(db, 'families', state.familyId, 'tasks'), snap => {
      state.tasksData = [];
      snap.forEach(d => {
        const data = d.data();
        if (data.assignedChildren?.includes(state.childId))
          state.tasksData.push({ id: d.id, ...data });
      });
      renderCategories(saveState, renderChild);
    });

    // listener על pendingApprovals — עדכון real-time כשהורה מאשר/דוחה
    onSnapshot(
      collection(db, 'families', state.familyId, 'pendingApprovals'),
      snap => {
        const cs = state.childState;
        if (!cs) return;
        snap.docChanges().forEach(change => {
          const data = change.doc.data();
          if (data.childId !== state.childId) return;
          if (change.type === 'modified' || change.type === 'added') {
            const idx = (cs.pending || []).findIndex(
              p => p.taskId === data.taskId && Math.abs(p.ts - data.ts) < 5000
            );
            if (idx !== -1) {
              cs.pending[idx].status = data.status;
              saveState();
              renderPendingSection();
            }
          }
        });
      }
    );

  } catch (e) {
    console.error('loadChild error:', e);
    show('screen-child');
  }
}

// -------- LOGOUT --------
document.getElementById('btn-child-logout').onclick = () => {
  showConfirm({
    icon: '🚪', title: 'לצאת מהחשבון?',
    message: 'תצטרך להזין קוד כדי להיכנס שוב',
    confirmText: 'יציאה', confirmClass: 'confirm-btn-danger',
    onConfirm: () => {
      clearStorage();
      signOut(auth).then(() => { window.location.href = 'index.html'; });
    },
  });
};
