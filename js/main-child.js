// =========== main-child.js ===========
import { auth, db }                                          from './firebase.js';
import { onAuthStateChanged, signOut }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
  doc, getDoc, setDoc, getDocs,
  collection, updateDoc, onSnapshot, query, where,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

import { state }                                              from './child-state.js';
import { show, showToast, showConfirm }                      from './child-ui.js';
import {
  isDone, renderCategories, renderHistory,
  renderPendingSection, initTasksModule, showTaskSuccessPopup,
} from './child-tasks.js';
import { initProfile, openChildProfile }                      from './child-profile.js';
import { initPrizes, renderPrizesScreen }                    from './child-prizes.js';
import {
  checkAndGrantBadges, computeStreak,
  renderBadgesScreen,
} from './child-badges.js';
import { startOnboarding }                                    from './child-onboarding.js';
import {
  initNotifications, processNotificationPopups,
  renderNotificationsScreen, updateNotificationBadge,
} from './child-notifications.js';
import { listenForegroundMessages, isPushGranted, isPushBlocked, requestPushPermission, saveChildFcmToken } from './notifications.js';

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

// -------- PRIZE PROGRESS BAR --------
let _prizes        = [];   // פרסים זמינים — מתעדכן מ-Firestore
let _prizeRotIdx   = 0;    // אינדקס מתנה נוכחית
let _prizeRotTimer = null; // setInterval

export function setPrizesForBar(prizes) {
  _prizes = prizes;
  _prizeRotIdx = 0;
  _startPrizeRotation();
}

function _startPrizeRotation() {
  if (_prizeRotTimer) clearInterval(_prizeRotTimer);
  _renderPrizeBar();
  if (_prizes.length > 1) {
    _prizeRotTimer = setInterval(() => {
      _prizeRotIdx = (_prizeRotIdx + 1) % _prizes.length;
      _renderPrizeBarAnimated();
    }, 2000);
  }
}

function _renderPrizeBar() {
  const totalPts = state.childState?.pts || 0;
  const color    = state.childData?.color || '#7C3AED';

  const emojiEl     = document.getElementById('ppcard-emoji');
  const nameEl      = document.getElementById('ppcard-name');
  const remainEl    = document.getElementById('ppcard-remaining');
  const fillEl      = document.getElementById('ppcard-bar-fill');
  const labelEl     = document.getElementById('ppcard-bar-label');

  if (!emojiEl) return;

  if (_prizes.length === 0) {
    emojiEl.textContent   = '🎁';
    nameEl.textContent    = 'ממתין שההורים יצרו מתנות';
    remainEl.textContent  = '';
    fillEl.style.width    = '0%';
    labelEl.textContent   = '';
    return;
  }

  const prize   = _prizes[_prizeRotIdx];
  const cost    = prize.pts || 0;
  const pct     = cost > 0 ? Math.min(100, Math.round((totalPts / cost) * 100)) : 100;
  const remain  = Math.max(0, cost - totalPts);

  emojiEl.textContent  = prize.emoji || '🎁';
  nameEl.textContent   = prize.name || prize.title || '';
  remainEl.textContent = remain > 0 ? `עוד ${remain} ⭐` : '✅ הגעת!';
  fillEl.style.background = `linear-gradient(90deg, ${color}, ${lightenColor(color)})`;
  fillEl.style.width   = pct + '%';
  labelEl.textContent  = `${totalPts} / ${cost} ⭐`;
}

function _renderPrizeBarAnimated() {
  const row = document.getElementById('ppcard-prize-row');
  if (!row) { _renderPrizeBar(); return; }
  row.style.transition  = 'opacity 0.3s ease';
  row.style.opacity     = '0';
  setTimeout(() => {
    _renderPrizeBar();
    row.style.opacity = '1';
  }, 300);
}

// -------- RENDER CHILD --------
export function renderChild() {
  const { childData, childState } = state;
  if (!childData || !childState) return;

  // ---- כרטיס פרופיל ----
  const photoEl = document.getElementById('child-header-photo');
  const emojiEl = document.getElementById('child-header-emoji');
  if (childData.photo && childData.photo.length > 10) {
    photoEl.innerHTML = `<img src="${childData.photo}" alt="${childData.name}">`;
  } else if (emojiEl) {
    emojiEl.textContent = childData.emoji || '⭐';
  }

  const titleEl = document.getElementById('child-title');
  if (titleEl) titleEl.textContent = childData.name;

  const todayDone = state.tasksData.filter(t => isDone(t)).length;
  const tasksEl = document.getElementById('cpc-tasks-today');
  if (tasksEl) tasksEl.textContent = `${todayDone} משימות היום`;

  // סה"כ מצטבר
  const totalPts = (childState.monthlyPts || 0) + (childState.pts || 0);
  const totalEl  = document.getElementById('cpc-total-val');
  if (totalEl) totalEl.textContent = totalPts;

  // nav icon — תמונה או אימוג'י
  const navIcon = document.getElementById('nav-profile-icon');
  if (navIcon) {
    if (childData.photo && childData.photo.length > 10) {
      navIcon.innerHTML = `<img src="${childData.photo}" alt="${childData.name}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
      navIcon.style.cssText = 'width:28px;height:28px;border-radius:50%;overflow:hidden;display:flex;border:2px solid var(--child-color);flex-shrink:0;';
    } else {
      navIcon.textContent = childData.emoji || '👤';
      navIcon.style.cssText = '';
    }
  }

  // ---- greeting ----
  const color = childData.color || '#7C3AED';
  const gc    = document.getElementById('greeting-card');
  if (gc) {
    gc.style.background = `linear-gradient(135deg, ${color}, ${darkenColor(color)})`;
    gc.style.boxShadow  = `0 6px 24px ${color}55`;
  }
  const greetings = childData.gender === 'female' ? GREETINGS_F : GREETINGS_M;
  const gtEl = document.getElementById('greeting-text');
  if (gtEl) gtEl.textContent = `שלום ${childData.name}! ${greetings[Math.floor(Math.random()*greetings.length)]}`;

  const gsEl = document.getElementById('greeting-sub');
  if (gsEl) gsEl.textContent = todayDone > 0
    ? `ביצעת ${todayDone} משימות היום - כל הכבוד! 🎉`
    : (childData.gender === 'female' ? 'בחרי קטגוריה והתחילי!' : 'בחר קטגוריה והתחל!');

  // ---- stats ----
  const pts   = childState.pts || 0;
  const pbVal = document.getElementById('pb-val');
  if (pbVal) pbVal.textContent = pts;

  // streak
  const streak     = computeStreak();
  const streakVal  = document.getElementById('streak-val');
  const streakCard = document.getElementById('streak-card');
  if (streakVal)  streakVal.textContent = streak;
  if (streakCard) streakCard.classList.toggle('active', streak >= 2);

  // ---- prize bar (רק עדכן נתון, הרוטציה רצה לבד) ----
  _renderPrizeBar();

  // sub-modules
  renderPendingSection(saveState, renderChild);
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
      if (tab === 'profile') {
        if (state.childData) openChildProfile();
        return;
      }
      if (tab === 'notifs') {
        show('screen-child-notifs');
        renderNotificationsScreen();
        return;
      }
      show(btn.dataset.screen);
      if (tab === 'prizes') renderPrizesScreen();
      if (tab === 'badges') {
        renderBadgesScreen();
        const nb = document.getElementById('nav-badge-badges');
        if (nb) nb.style.display = 'none';
      }
    };
  });

  // כפתורי חזרה ופרופיל ממסך התראות
  document.getElementById('btn-notifs-back')?.addEventListener('click', () => {
    show('screen-child');
    navBtns.forEach(b => b.classList.remove('active'));
    document.querySelector('.nav-btn[data-tab="home"]')?.classList.add('active');
  });
  function updateNotifBtn() {
    const icon  = document.getElementById('notif-btn-icon');
    const label = document.getElementById('notif-btn-label');
    if (!icon || !label) return;
    if (isPushGranted()) {
      icon.textContent = '🔔'; icon.style.color = '#7C3AED';
      label.textContent = 'פעיל'; label.style.color = '#7C3AED';
    } else if (isPushBlocked()) {
      icon.textContent = '🔕'; icon.style.color = '#94A3B8';
      label.textContent = 'חסום'; label.style.color = '#94A3B8';
    } else {
      icon.textContent = '🔔'; icon.style.color = '#94A3B8';
      label.textContent = 'כבוי'; label.style.color = '#94A3B8';
    }
  }
  updateNotifBtn();

  document.getElementById('btn-notif-toggle')?.addEventListener('click', async () => {
    if (isPushGranted()) {
      showToast('התראות פעילות ✓');
    } else if (isPushBlocked()) {
      showToast('לאפשר התראות: הגדרות הדפדפן ← אתר ← התראות');
    } else {
      try {
        const token = await requestPushPermission();
        if (token) {
          await saveChildFcmToken(db, state.familyId, state.childId, token);
          showToast('התראות הופעלו! 🔔');
        }
      } catch(e) { /* blocked */ }
      updateNotifBtn();
    }
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

      // ⬇ לא מאפסים monthlyPts — הוא מצטבר לנצח
      // רק מעבירים את השבועי למצטבר בסוף שבוע
      let changed = false;

      // תיקון פריטים תקועים: pending ישן מעל 60 שניות → failed → כפתור "שלח שוב"
      // ניקוי פריטים שאושרו (approved) אך נתקעו לפני הוספת ה-setTimeout
      const now = Date.now();
      const beforeLen = cs.pending.length;
      cs.pending = cs.pending.filter(p => {
        if (p.status === 'approved') return false;
        if (p.status === 'pending' && (now - (p.ts || 0)) > 60_000) {
          p.status = 'failed';
        }
        return true;
      });
      if (cs.pending.length !== beforeLen) changed = true;

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

    // טען פרסים לבר
    try {
      const prizesSnap = await getDocs(collection(db, 'families', state.familyId, 'prizes'));
      const prizes = prizesSnap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(p => p.active !== false)
        .filter(p => !p.hidden)
        .filter(p => !p.assignedChildren || p.assignedChildren.length === 0 || p.assignedChildren.includes(state.childId))
        .sort((a, b) => (a.cost || 0) - (b.cost || 0));
      setPrizesForBar(prizes);
    } catch (e) { setPrizesForBar([]); }

    // init modules
    initTasksModule(db);
    initProfile(db, renderChild);
    initPrizes(db);
    initNav();

    // שמור FCM token של הילד בכל כניסה
    try {
      const token = await requestPushPermission();
      if (token) await saveChildFcmToken(db, state.familyId, state.childId, token);
    } catch(e) { console.warn('FCM child token error:', e); }

    // טען התראות
    await initNotifications(db, state.familyId, state.childId);
    updateNotificationBadge();

    // תזמון תזכורות + האזנה להודעות foreground
    (async () => {
      try {
        // הצג toast כשמגיעה הודעה בזמן שהאפליקציה פתוחה
        if (isPushGranted()) {
          listenForegroundMessages(payload => {
            const title = payload.notification?.title || '';
            const body  = payload.notification?.body  || '';
            if (title || body) showToast((title + ' ' + body).trim());
          });
        }
      } catch(e) { console.warn('child notifications error:', e); }
    })();

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

    // הצג פופאפים על התראות שלא נקראו (אחרי שהממשק נטען)
    setTimeout(() => processNotificationPopups(), 600);

    // listener על tasks
    onSnapshot(collection(db, 'families', state.familyId, 'tasks'), snap => {
      state.tasksData = [];
      snap.forEach(d => {
        const data = d.data();
        if (data.assignedChildren?.includes(state.childId))
          state.tasksData.push({ id: d.id, ...data });
      });
      renderChild();
    });

    // listener על prizes — לעדכן את בר המתנות בזמן אמת
    onSnapshot(collection(db, 'families', state.familyId, 'prizes'), snap => {
      const prizes = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(p => p.active !== false)
        .filter(p => !p.hidden)
        .filter(p => !p.assignedChildren || p.assignedChildren.length === 0 || p.assignedChildren.includes(state.childId))
        .sort((a, b) => (a.cost || 0) - (b.cost || 0));
      setPrizesForBar(prizes);
    });

    // listener על pendingApprovals
    onSnapshot(
      collection(db, 'families', state.familyId, 'pendingApprovals'),
      snap => {
        const cs = state.childState;
        if (!cs) return;
        snap.docChanges().forEach(change => {
          const data = change.doc.data();
          if (data.childId !== state.childId) return;

          const idx = (cs.pending || []).findIndex(
            p => p.taskId === data.taskId && Math.abs((p.ts || 0) - (data.ts || 0)) < 5000
          );

          // כשהורה מאשר בזמן שהילד פתוח — עדכן זיכרון מיד
          if (change.type === 'modified' && data.status === 'approved' && idx !== -1) {
            const pts = data.pts || 0;

            cs.pending[idx].status = 'approved';
            cs.pts = (cs.pts || 0) + pts;

            const tsDate  = data.ts ? new Date(data.ts) : new Date();
            const dateKey = `${tsDate.getFullYear()}-${String(tsDate.getMonth()+1).padStart(2,'0')}-${String(tsDate.getDate()).padStart(2,'0')}`;

            // סמן משימה כ"בוצעה היום" — כך isDone יחזיר true ולא תופיע שוב
            if (!cs.comp) cs.comp = {};
            const taskKey = data.taskId || '';
            if (taskKey) {
              const c = cs.comp[taskKey] || { wc: 0, d: '', count: 0, lastTs: 0 };
              cs.comp[taskKey] = { wc: (c.wc||0)+1, d: dateKey, count: (c.count||0)+1, lastTs: Date.now() };
            }

            if (!cs.hist) cs.hist = [];
            const alreadyInHist = cs.hist.some(
              h => h.taskId === data.taskId && Math.abs((h.ts || 0) - (data.ts || 0)) < 5000
            );
            if (!alreadyInHist) {
              cs.hist.unshift({
                taskId: data.taskId || '',
                task:   data.task   || '',
                emoji:  data.emoji  || '⭐',
                pts,
                time:   data.time   || '',
                day:    data.day    || '',
                ts:     data.ts     || Date.now(),
              });
              if (cs.hist.length > 50) cs.hist.pop();
            }

            if (!cs.dailyPts) cs.dailyPts = {};
            cs.dailyPts[dateKey] = (cs.dailyPts[dateKey] || 0) + pts;

            saveState();
            renderChild();
            if (pts > 0) showTaskSuccessPopup(pts);

            // הסר את ה"אושר" מהתור אחרי 4 שניות
            setTimeout(() => {
              const rmIdx = (state.childState?.pending || []).findIndex(
                p => p.taskId === data.taskId && p.status === 'approved'
              );
              if (rmIdx !== -1) {
                state.childState.pending.splice(rmIdx, 1);
                saveState();
                renderChild();
              }
            }, 4000);

            return;
          }

          // דחייה — הסר מהמערך כדי שהמשימה תחזור להיות זמינה
          if (change.type === 'modified' && data.status === 'rejected') {
            // נסה לפי idx מדויק; fallback — לפי taskId בלבד
            const removeIdx = idx !== -1 ? idx
              : (cs.pending || []).findIndex(p => p.taskId === data.taskId && p.status === 'pending');
            if (removeIdx !== -1) cs.pending.splice(removeIdx, 1);
            saveState();
            renderChild();
            return;
          }

          // עדכון סטטוס בלבד (added)
          if ((change.type === 'modified' || change.type === 'added') && idx !== -1) {
            cs.pending[idx].status = data.status;
            saveState();
            renderChild();
          }
        });
      }
    );

    // listener על prizeRequests — ניכוי מצטבר כשמאושר
    onSnapshot(
      query(
        collection(db, 'families', state.familyId, 'prizeRequests'),
        where('childId', '==', state.childId),
      ),
      snap => {
        const cs = state.childState;
        if (!cs) return;
        snap.docChanges().forEach(change => {
          const data = change.doc.data();
          // רק כשעבר מ-pending ל-approved
          if (change.type === 'modified' && data.status === 'approved' && !data._deducted) {
            const cost = data.cost || 0;
            if (cost > 0) {
              cs.monthlyPts = Math.max(0, (cs.monthlyPts || 0) - cost);
              saveState();
              renderChild();
              const prizesScreen = document.getElementById('screen-prizes-child');
              if (prizesScreen && prizesScreen.classList.contains('active')) renderPrizesScreen();
              showToast(`${data.prizeEmoji || '🎁'} ${data.prizeTitle} אושר!`);
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