import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, getDocs, collection, updateDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDC0GADxe3qv6uv6s6fGR3O7_lL9iHl4ag",
  authDomain: "kidssapp-izhaki.firebaseapp.com",
  databaseURL: "https://kidssapp-izhaki-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "kidssapp-izhaki",
  storageBucket: "kidssapp-izhaki.firebasestorage.app",
  messagingSenderId: "663906163746",
  appId: "1:663906163746:web:a4f66772a2ae0dedc47e7b"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// =========== STATE ===========
let childId = localStorage.getItem('childId');
let familyId = localStorage.getItem('childFamilyId');
let childData = null;
let tasksData = [];
let childState = null;

const FREQ_LABEL = { daily: "כל יום", "2week": "פעמיים בשבוע", weekly: "פעם בשבוע", once: "חד פעמית", specific: "ימים ספציפיים" };
const FREQ_CLS = { daily: "freq-daily", "2week": "freq-2week", weekly: "freq-weekly" };
const DAYS = ["ראשון","שני","שלישי","רביעי","חמישי","שישי","שבת"];

const GREETINGS_M = ["יאללה נתחיל! 💪","בוא נעשה את זה! 🚀","היום תהיה מדהים! ✨","מוכן לאסוף כוכבים? 🔥","הגיבור שלנו הגיע! 🦸‍♂️"];
const GREETINGS_F = ["יאללה נתחילי! 💪","בואי נעשה את זה! 🚀","היום תהיי מדהימה! ✨","מוכנה לאסוף כוכבים? 🔥","הגיבורה שלנו הגיעה! 🦸‍♀️"];

// =========== HELPERS ===========
function starsText(n) {
  return '⭐'.repeat(Math.min(Math.max(n || 0, 0), 5));
}

function show(id) {
  document.querySelectorAll('.screen').forEach(s => { s.classList.remove('active','visible'); });
  const next = document.getElementById(id);
  next.classList.add('active');
  requestAnimationFrame(() => requestAnimationFrame(() => next.classList.add('visible')));
}

function showToast(pts) {
  const el = document.getElementById('toast');
  el.innerHTML = `כל הכבוד! 🎉<br><span style="font-size:1.2rem">+${starsText(pts)}</span>`;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 1800);
  const c = childData?.color || '#6366F1';
  const colors = [c, '#FCD34D', '#10B981', '#EC4899', '#3B82F6'];
  confetti({ particleCount: 80, spread: 70, origin: { y: 0.6 }, colors });
  setTimeout(() => confetti({ particleCount: 50, angle: 60, spread: 55, origin: { x: 0, y: 0.65 }, colors }), 200);
  setTimeout(() => confetti({ particleCount: 50, angle: 120, spread: 55, origin: { x: 1, y: 0.65 }, colors }), 400);
}

function showConfirm({ icon, title, message, confirmText, confirmClass, onConfirm }) {
  const ov = document.createElement('div');
  ov.className = 'modal-overlay';
  const sh = document.createElement('div');
  sh.className = 'modal-sheet';
  sh.innerHTML = `
    <div class="modal-handle"></div>
    <div class="confirm-body">
      <div class="confirm-icon">${icon}</div>
      <div class="confirm-title">${title}</div>
      <div class="confirm-msg">${message}</div>
      <div class="confirm-btns">
        <button class="confirm-btn confirm-btn-cancel">ביטול</button>
        <button class="confirm-btn ${confirmClass || 'confirm-btn-danger'}">${confirmText}</button>
      </div>
    </div>`;
  sh.querySelector('.confirm-btn-cancel').onclick = () => ov.remove();
  sh.querySelector(`.${confirmClass || 'confirm-btn-danger'}`).onclick = () => { ov.remove(); onConfirm(); };
  ov.onclick = e => { if (e.target === ov) ov.remove(); };
  ov.appendChild(sh);
  document.body.appendChild(ov);
}

function weekKey() {
  const d = new Date(), day = d.getDay();
  const sun = new Date(d); sun.setDate(d.getDate() - day);
  const mm = String(sun.getMonth() + 1).padStart(2, '0');
  const dd = String(sun.getDate()).padStart(2, '0');
  return `w-${sun.getFullYear()}-${mm}-${dd}`;
}
function monthKey() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `m-${d.getFullYear()}-${mm}`;
}
function todayKey() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function defaultState() {
  return { pts: 0, monthlyPts: 0, comp: {}, hist: [], lastActive: "", wk: weekKey(), mk: monthKey() };
}

// =========== AUTH & LOAD ===========
if (!childId || !familyId) {
  window.location.href = 'index.html';
} else {
  let authResolved = false;
  const unsubAuth = onAuthStateChanged(auth, (user) => {
    if (authResolved) return;
    authResolved = true;
    unsubAuth();
    if (!user) {
      localStorage.removeItem('childId');
      localStorage.removeItem('childFamilyId');
      localStorage.removeItem('childAnonUid');
      window.location.href = 'index.html';
    } else {
      loadChild();
    }
  });
}

async function loadChild() {
  try {
    const childSnap = await getDoc(doc(db, 'families', familyId, 'children', childId));
    if (!childSnap.exists()) {
      localStorage.removeItem('childId');
      localStorage.removeItem('childFamilyId');
      localStorage.removeItem('childAnonUid');
      window.location.href = 'index.html';
      return;
    }
    childData = childSnap.data();

    if (childData.color) {
      document.documentElement.style.setProperty('--child-color', childData.color);
    }

    const stateSnap = await getDoc(doc(db, 'families', familyId, 'children', childId, 'state', 'current'));
    if (stateSnap.exists()) {
      childState = stateSnap.data();
      if (childState.monthlyPts === undefined) childState.monthlyPts = 0;
      if (!childState.mk) childState.mk = monthKey();

      let changed = false;
      if (childState.mk !== monthKey()) {
        childState.monthlyPts = 0;
        childState.mk = monthKey();
        changed = true;
      }
      if (childState.wk !== weekKey()) {
        childState.monthlyPts = (childState.monthlyPts || 0) + (childState.pts || 0);
        childState.pts = 0;
        childState.comp = {};
        childState.wk = weekKey();
        changed = true;
      }
      if (changed) await saveState();
    } else {
      childState = defaultState();
      await saveState();
    }

    try {
      const tasksSnap = await getDocs(collection(db, 'families', familyId, 'tasks'));
      tasksData = [];
      tasksSnap.forEach(d => {
        const data = d.data();
        if (data.assignedChildren && data.assignedChildren.includes(childId)) {
          tasksData.push({ id: d.id, ...data });
        }
      });
    } catch(e) {
      tasksData = [];
    }

    renderChild();
    show('screen-child');

    onSnapshot(collection(db, 'families', familyId, 'tasks'), (snap) => {
      tasksData = [];
      snap.forEach(d => {
        const data = d.data();
        if (data.assignedChildren && data.assignedChildren.includes(childId)) {
          tasksData.push({ id: d.id, ...data });
        }
      });
      renderCategories();
    });

  } catch(e) {
    console.error('Error loading child:', e);
    show('screen-child');
  }
}

async function saveState() {
  try {
    const stateRef = doc(db, 'families', familyId, 'children', childId, 'state', 'current');
    await updateDoc(stateRef, childState).catch(async () => {
      const { setDoc } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
      await setDoc(stateRef, childState);
    });
  } catch(e) {
    console.error('Error saving state:', e);
  }
}

// =========== RENDER ===========
function renderChild() {
  if (!childData || !childState) return;

  const photoEl = document.getElementById('child-header-photo');
  const emojiEl = document.getElementById('child-header-emoji');
  if (childData.photo && childData.photo.length > 10) {
    photoEl.innerHTML = `<img src="${childData.photo}" alt="${childData.name}">`;
  } else {
    emojiEl.textContent = childData.emoji || '⭐';
  }
  document.getElementById('child-title').textContent = childData.name;

  const gc = document.getElementById('greeting-card');
  gc.style.background = `linear-gradient(135deg, ${childData.color || '#6366F1'}, ${darkenColor(childData.color || '#6366F1')})`;
  gc.style.boxShadow = `0 6px 24px ${childData.color || '#6366F1'}55`;

  const greetings = childData.gender === 'female' ? GREETINGS_F : GREETINGS_M;
  document.getElementById('greeting-text').textContent = `שלום ${childData.name}! ${greetings[Math.floor(Math.random() * greetings.length)]}`;

  const todayDone = tasksData.filter(t => isDone(t)).length;
  const subText = todayDone > 0
    ? `ביצעת ${todayDone} משימות היום - כל הכבוד! 🎉`
    : (childData.gender === 'female' ? 'בחרי קטגוריה והתחילי!' : 'בחר קטגוריה והתחל!');
  document.getElementById('greeting-sub').textContent = subText;

  document.getElementById('pb-val').textContent = childState.pts || 0;
  document.getElementById('monthly-val').textContent = (childState.monthlyPts || 0) + (childState.pts || 0);

  const pts = childState.pts || 0;
  const pct = Math.min(100, Math.round(pts / 100 * 100));
  document.getElementById('progress-text').textContent = `${pts} / 100 כוכבים`;
  const pf = document.getElementById('progress-fill');
  pf.style.background = `linear-gradient(90deg, ${childData.color || '#6366F1'}, ${lightenColor(childData.color || '#6366F1')})`;
  pf.style.width = '0%';
  const pl = document.getElementById('progress-pts-label');
  if (pl) pl.textContent = pts > 2 ? `${pts} ⭐` : '';
  setTimeout(() => pf.style.width = pct + '%', 100);

  renderCategories();
  renderHistory();
}

function renderCategories() {
  const grid = document.getElementById('cats-grid');
  const visibleTasks = tasksData.filter(t => !t.hidden);
  if (visibleTasks.length === 0) {
    grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1;">עדיין לא הוגדרו מטלות 📋<br><small style="color:var(--muted);">ההורים צריכים להוסיף מטלות</small></div>';
    return;
  }

  const cats = {};
  visibleTasks.forEach(t => {
    const cat = t.cat || 'כללי';
    if (!cats[cat]) cats[cat] = [];
    cats[cat].push(t);
  });

  grid.innerHTML = Object.entries(cats).map(([cat, tasks]) => {
    const dn = tasks.filter(t => isDone(t)).length;
    const icon = tasks[0]?.catIcon || '📋';
    return `<button class="cat-btn" data-cat="${cat}">
      <span class="cat-icon">${icon}</span>
      <span class="cat-name">${cat}</span>
      ${dn === tasks.length ? '<span class="cat-done">✅ הושלם!</span>' : `<span class="cat-count">${dn}/${tasks.length} בוצעו</span>`}
    </button>`;
  }).join('');

  grid.querySelectorAll('.cat-btn').forEach(b => {
    b.onclick = () => showCatModal(b.dataset.cat);
  });
}

function renderHistory() {
  const hl = document.getElementById('user-hist');
  const items = (childState.hist || []).slice(0, 10);
  hl.innerHTML = items.length ? items.map(h => `
    <div class="hi-item">
      <span class="hi-emoji">${h.emoji || '⭐'}</span>
      <div class="hi-info"><strong>${h.task}</strong><span>${h.day} ${h.time}</span></div>
      <span class="hi-pts">${starsText(h.pts)}</span>
    </div>`).join('') : '<div class="empty-state">עדיין לא ביצעת משימות</div>';
}

// =========== TASK LOGIC ===========
function isDone(t) {
  const c = childState.comp?.[t.id];
  if (!c) return false;
  if (t.freq === 'daily') return c.d === todayKey();
  if (t.freq === 'specific') return c.d === todayKey();
  if (t.freq === 'once') return (c.count || 0) >= 1;
  if (t.freq === '2week') return c.wc >= (t.limit || 2);
  if (t.freq === 'weekly') return c.wc >= 1;
  return false;
}

function completeTask(t) {
  const d = new Date();
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const day = DAYS[d.getDay()];

  childState.pts = (childState.pts || 0) + t.pts;
  const c = childState.comp?.[t.id] || { wc: 0, d: '', count: 0, lastTs: 0 };
  c.wc++; c.d = todayKey(); c.count++; c.lastTs = Date.now();
  if (!childState.comp) childState.comp = {};
  childState.comp[t.id] = c;

  childState.lastActive = todayKey();

  if (!childState.hist) childState.hist = [];
  childState.hist.unshift({
    taskId: t.id,
    task: t.task,
    emoji: t.emojis?.split?.(' ')?.[0] || t.emoji || '⭐',
    pts: t.pts,
    time,
    day,
    ts: Date.now()
  });
  if (childState.hist.length > 50) childState.hist.pop();

  saveState();
}

// =========== MODALS ===========
function closeModals() { document.querySelectorAll('.modal-overlay').forEach(m => m.remove()); }

function makeModal(title) {
  const ov = document.createElement('div'); ov.className = 'modal-overlay';
  const sh = document.createElement('div'); sh.className = 'modal-sheet';
  sh.innerHTML = `<div class="modal-handle"></div>
    <div class="modal-header"><h2>${title}</h2><button class="modal-close">✕</button></div>
    <div class="modal-body"></div>`;
  sh.querySelector('.modal-close').onclick = () => ov.remove();
  ov.appendChild(sh);
  ov.onclick = e => { if (e.target === ov) ov.remove(); };
  document.body.appendChild(ov);
  return sh.querySelector('.modal-body');
}

function showCatModal(cat) {
  const tasks = tasksData.filter(t => (t.cat || 'כללי') === cat && !t.hidden);
  const body = makeModal(`${tasks[0]?.catIcon || '📋'} ${cat}`);
  tasks.forEach(t => {
    const done = isDone(t);
    const d = document.createElement('div');
    d.className = `task-card${done ? ' done' : ''}`;
    d.innerHTML = `<div class="tc-left">
      <span class="tc-emoji">${t.emoji || '⭐'}</span>
      <div class="tc-info"><strong>${t.task}</strong><span class="freq-tag ${FREQ_CLS[t.freq] || ''}">${FREQ_LABEL[t.freq] || ''}</span></div>
    </div>
    <span class="tc-pts">${done ? '✅' : starsText(t.pts)}</span>`;
    if (!done) d.onclick = () => showTaskDetail(t);
    body.appendChild(d);
  });
}

function showTaskDetail(t) {
  closeModals();
  const body = makeModal(t.task);
  if (t.emojis || t.emoji) {
    const emojiDisplay = document.createElement('span');
    emojiDisplay.className = 'task-emoji-display';
    emojiDisplay.textContent = t.emojis || t.emoji;
    body.appendChild(emojiDisplay);
  }
  const desc = document.createElement('p'); desc.className = 'td-desc'; desc.textContent = t.desc || '';
  const meta = document.createElement('div'); meta.className = 'td-meta';
  meta.innerHTML = `<span>${starsText(t.pts)}</span><span>🔁 ${FREQ_LABEL[t.freq] || ''}</span>`;
  const btn = document.createElement('button'); btn.className = 'done-btn'; btn.textContent = '✅ בוצע!';
  btn.onclick = () => {
    completeTask(t);
    closeModals();
    showToast(t.pts);
    renderChild();
  };
  body.append(desc, meta, btn);
}

// =========== LOGOUT ===========
document.getElementById('btn-child-logout').onclick = () => {
  showConfirm({
    icon: '🚪',
    title: 'לצאת מהחשבון?',
    message: 'תצטרך להזין קוד כדי להיכנס שוב',
    confirmText: 'יציאה',
    confirmClass: 'confirm-btn-danger',
    onConfirm: () => {
      localStorage.removeItem('childId');
      localStorage.removeItem('childFamilyId');
      localStorage.removeItem('childAnonUid');
      signOut(auth).then(() => { window.location.href = 'index.html'; });
    }
  });
};

// =========== COLOR UTILS ===========
function darkenColor(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgb(${Math.max(0, r - 40)},${Math.max(0, g - 40)},${Math.max(0, b - 40)})`;
}
function lightenColor(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgb(${Math.min(255, r + 60)},${Math.min(255, g + 60)},${Math.min(255, b + 60)})`;
}

// =========== CHILD PROFILE EDIT ===========
const PROFILE_EMOJIS = ["🦁","🐱","🦄","🐶","🐸","🦊","🐼","🦋","🌟","🎈","🐯","🐰","🦜","🐻","🎀","🚀","⚽","🎸","🌈","🧸","🐬","🦕","🐝","🍀"];
const PROFILE_COLORS = ["#EF4444","#F59E0B","#10B981","#3B82F6","#8B5CF6","#EC4899","#06B6D4","#F97316","#84CC16","#6366F1"];
let profileEmoji = '';
let profileColor = '';
let profilePhotoData = null;
let profilePhotoCleared = false;

document.getElementById('child-header-photo').onclick = () => {
  if (!childData) return;
  openChildProfile();
};

function openChildProfile() {
  profileEmoji = childData.emoji || '';
  profileColor = childData.color || '';
  profilePhotoData = null;
  profilePhotoCleared = false;

  document.getElementById('profile-child-name').textContent = childData.name;
  document.getElementById('profile-child-gender').textContent = childData.gender === 'female' ? '👧 נקבה' : '👦 זכר';

  const colorEl = document.getElementById('profile-color-display');
  colorEl.style.background = childData.color || 'var(--border)';
  colorEl.onclick = () => showProfileColorModal();

  const emojiEl = document.getElementById('profile-emoji-display');
  emojiEl.textContent = childData.emoji || '—';
  emojiEl.onclick = () => showProfileEmojiModal();

  const preview = document.getElementById('profile-photo-preview');
  const placeholder = document.getElementById('profile-photo-placeholder');
  if (childData.photo && childData.photo.length > 10) {
    preview.src = childData.photo;
    preview.style.display = 'block';
    placeholder.style.display = 'none';
  } else {
    preview.style.display = 'none';
    placeholder.style.display = '';
  }

  document.getElementById('profile-error').textContent = '';
  show('screen-child-profile');
}

function showProfileEmojiModal() {
  const ov = document.createElement('div'); ov.className = 'modal-overlay';
  const sh = document.createElement('div'); sh.className = 'modal-sheet';
  sh.innerHTML = `<div class="modal-handle"></div>
    <div class="modal-header"><h2>בחר אימוג'י</h2><button class="modal-close">✕</button></div>
    <div class="modal-body">
      <div class="emoji-grid">${PROFILE_EMOJIS.map(e => `<div class="emoji-opt${e===profileEmoji?' selected':''}" data-emoji="${e}">${e}</div>`).join('')}</div>
    </div>`;
  sh.querySelector('.modal-close').onclick = () => ov.remove();
  ov.onclick = e => { if (e.target === ov) ov.remove(); };
  sh.querySelectorAll('.emoji-opt').forEach(el => {
    el.onclick = () => {
      profileEmoji = el.dataset.emoji;
      document.getElementById('profile-emoji-display').textContent = profileEmoji;
      ov.remove();
    };
  });
  ov.appendChild(sh);
  document.body.appendChild(ov);
}

function showProfileColorModal() {
  const ov = document.createElement('div'); ov.className = 'modal-overlay';
  const sh = document.createElement('div'); sh.className = 'modal-sheet';
  sh.innerHTML = `<div class="modal-handle"></div>
    <div class="modal-header"><h2>בחר צבע</h2><button class="modal-close">✕</button></div>
    <div class="modal-body">
      <div class="color-grid">${PROFILE_COLORS.map(c => `<div class="color-opt${c===profileColor?' selected':''}" data-color="${c}" style="background:${c}"></div>`).join('')}</div>
    </div>`;
  sh.querySelector('.modal-close').onclick = () => ov.remove();
  ov.onclick = e => { if (e.target === ov) ov.remove(); };
  sh.querySelectorAll('.color-opt').forEach(el => {
    el.onclick = () => {
      profileColor = el.dataset.color;
      document.getElementById('profile-color-display').style.background = profileColor;
      ov.remove();
    };
  });
  ov.appendChild(sh);
  document.body.appendChild(ov);
}

// =========== PHOTO UPLOAD ===========
function cropAndCompressPhoto(file, size = 300, quality = 0.75) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) return reject(new Error('לא קובץ תמונה'));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('שגיאה בקריאת הקובץ'));
    reader.onload = (ev) => {
      const img = new Image();
      img.onerror = () => reject(new Error('שגיאה בטעינת התמונה'));
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext('2d');
        const side = Math.min(img.width, img.height);
        const sx = (img.width - side) / 2;
        const sy = Math.max(0, (img.height - side) / 2 - img.height * 0.05);
        ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });
}

document.getElementById('profile-photo-input').onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  profilePhotoCleared = false;
  try {
    profilePhotoData = await cropAndCompressPhoto(file);
    document.getElementById('profile-photo-preview').src = profilePhotoData;
    document.getElementById('profile-photo-preview').style.display = 'block';
    document.getElementById('profile-photo-placeholder').style.display = 'none';
  } catch(err) {
    document.getElementById('profile-error').textContent = 'שגיאה בטעינת התמונה ⚠️';
  }
};

document.getElementById('btn-profile-clear-photo').onclick = () => {
  profilePhotoData = null;
  profilePhotoCleared = true;
  document.getElementById('profile-photo-preview').style.display = 'none';
  document.getElementById('profile-photo-placeholder').style.display = '';
  document.getElementById('profile-photo-input').value = '';
};

document.getElementById('btn-profile-back').onclick = () => show('screen-child');

document.getElementById('btn-profile-save').onclick = async () => {
  const err = document.getElementById('profile-error');
  try {
    const updates = {};
    if (profileEmoji && profileEmoji !== childData.emoji) updates.emoji = profileEmoji;
    if (profileColor && profileColor !== childData.color) updates.color = profileColor;
    if (profilePhotoData) updates.photo = profilePhotoData;
    if (profilePhotoCleared) updates.photo = '';

    if (Object.keys(updates).length === 0) {
      show('screen-child');
      return;
    }

    await updateDoc(doc(db, 'families', familyId, 'children', childId), updates);

    Object.assign(childData, updates);
    if (updates.color) {
      document.documentElement.style.setProperty('--child-color', updates.color);
    }

    renderChild();
    show('screen-child');
  } catch(e) {
    err.textContent = 'שגיאה בשמירה, נסה שוב';
    console.error(e);
  }
};
