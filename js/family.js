import { auth, db } from './firebase.js';
import {
  doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc,
  collection, serverTimestamp, Timestamp, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { showScreen, showToast, showLoading, hideLoading } from './ui.js';
import { generateCode } from './auth.js';

// =========== CONSTANTS ===========
export const CHILD_EMOJIS = ["🦁","🐱","🦄","🐶","🐸","🦊","🐼","🦋","🌟","🎈","🐯","🐰","🦜","🐻","🎀","🚀","⚽","🎸","🌈","🧸","🐬","🦕","🐝","🍀"];
export const CHILD_COLORS = ["#10B981","#3B82F6","#06B6D4","#8B5CF6","#EC4899","#EF4444","#F97316","#F59E0B"];
export function colorGradient(hex) {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  const lr = Math.round(r+(255-r)*0.52), lg = Math.round(g+(255-g)*0.52), lb = Math.round(b+(255-b)*0.52);
  return `linear-gradient(135deg,rgb(${lr},${lg},${lb}),${hex})`;
}
const CODE_EXPIRY_MS = 24 * 60 * 60 * 1000;

// =========== STATE ===========
export let childrenCache = [];
export let editingChildId = null;
export function clearChildrenCache() { childrenCache = []; }

// =========== LOAD CHILDREN ===========
export async function loadChildren(familyId) {
  if (!familyId) return;
  const snap = await getDocs(collection(db, 'families', familyId, 'children'));
  childrenCache = [];
  snap.forEach(d => childrenCache.push({ id: d.id, ...d.data() }));
  childrenCache.sort((a, b) => (a.createdAt?.toMillis?.() ?? 0) - (b.createdAt?.toMillis?.() ?? 0));
}

// =========== RENDER FAMILY GRID ===========
export function renderFamily(familyId) {
  const grid = document.getElementById('family-grid');
  const count = childrenCache.length;
  // ≤3 ילדים: מותאמים לרוחב שורה אחת. 4+ ילדים: גלילה אופקית
  grid.classList.toggle('fit-row', count === 3);
  grid.classList.toggle('scrollable', count > 3);
  grid.style.justifyContent = count <= 2 ? 'center' : 'flex-start';
  if (childrenCache.length === 0) {
    grid.innerHTML = '<div class="empty-state">עדיין לא נוספו ילדים</div>';
  } else {
    grid.innerHTML = childrenCache.map((c, ci) => {
      const genderEmoji = c.gender === 'male' ? '👦' : '👧';
      const hasPhoto = c.photo && c.photo.length > 10;
      const photoHTML = hasPhoto
        ? `<img src="${c.photo}" alt="${c.name}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`
        : `<span style="font-size:1.8rem;">${c.emoji || genderEmoji}</span>`;
      const isWaiting = c.status === 'waiting';
      const color = c.color || CHILD_COLORS[ci % CHILD_COLORS.length];
      return `
        <div class="child-card" onclick="${isWaiting ? `showChildInviteModal('${c.id}')` : `location.href='points.html?childName=${encodeURIComponent(c.name)}'`}" style="box-shadow:0 2px 10px rgba(0,0,0,0.07),inset -4px 0 0 ${color},inset 0 -3px 0 ${color}70;">
          <div class="cc-photo">${photoHTML}</div>
          <div class="cc-name">${c.name}</div>
          <div class="cc-gender">${genderEmoji} ${c.gender === 'male' ? 'זכר' : 'נקבה'}</div>
          ${isWaiting ? `
            <span class="cc-status waiting">ממתין לכניסה</span>
            <span class="cc-code">${c.inviteCode || ''}</span>
          ` : `
            <span class="cc-status active">פעיל ✅</span>
          `}
        </div>`;
    }).join('');
  }
  renderParentsList(familyId);
}

// =========== RENDER PARENTS LIST ===========
async function renderParentsList(familyId) {
  const list = document.getElementById('parents-list');
  if (!familyId) { list.innerHTML = ''; return; }
  try {
    const famDoc = await getDoc(doc(db, 'families', familyId));
    if (!famDoc.exists()) return;
    const fam = famDoc.data();
    let html = `<div class="card" style="padding:14px 16px;margin-bottom:8px;">
      <div style="display:flex;align-items:center;gap:10px;">
        <span style="font-size:1.4rem;">👑</span>
        <div style="flex:1;">
          <strong style="font-size:0.92rem;">${fam.parentName || 'הורה ראשי'}</strong>
          <div style="font-size:0.78rem;color:var(--muted);">${fam.parentEmail || ''}</div>
        </div>
        <span style="font-size:0.72rem;background:#DBEAFE;color:#1D4ED8;padding:3px 8px;border-radius:6px;font-weight:600;">ראשי</span>
      </div>
    </div>`;
    if (fam.secondaryParentUid) {
      html += `<div class="card" style="padding:14px 16px;margin-bottom:8px;">
        <div style="display:flex;align-items:center;gap:10px;">
          <span style="font-size:1.4rem;">👫</span>
          <div style="flex:1;">
            <strong style="font-size:0.92rem;">${fam.secondaryParentName || 'הורה משני'}</strong>
            <div style="font-size:0.78rem;color:var(--muted);">${fam.secondaryParentEmail || ''}</div>
          </div>
          <span style="font-size:0.72rem;background:#DCFCE7;color:#15803D;padding:3px 8px;border-radius:6px;font-weight:600;">משני</span>
        </div>
      </div>`;
    }
    list.innerHTML = html;
  } catch(e) { console.error(e); }
}

// =========== CREATE CHILD ===========
export async function createChild(familyId, name, gender, opts = {}) {
  if (!name) return { error: 'חובה להכניס שם' };
  if (!gender) return { error: 'חובה לבחור מין' };

  showLoading('יוצר...');
  try {
    const code = generateCode();
    const childRef = doc(collection(db, 'families', familyId, 'children'));
    await setDoc(childRef, {
      name,
      gender,
      emoji: opts.emoji || '',
      color: opts.color || '',
      photo: opts.photo || '',
      inviteCode: code,
      codeCreatedAt: Timestamp.now(),
      codeAttempts: 0,
      status: 'waiting',
      anonUid: '',
      createdAt: serverTimestamp()
    });
    await setDoc(doc(db, 'inviteCodes', code), {
      familyId,
      childId: childRef.id,
      createdAt: Timestamp.now(),
      used: false
    });
    hideLoading();
    return { success: true, code, childId: childRef.id };
  } catch(e) {
    hideLoading();
    console.error(e);
    return { error: 'שגיאה ביצירה, נסה שוב' };
  }
}

// =========== SAVE CHILD ===========
export async function saveChild(familyId, childId, updates) {
  showLoading('שומר...');
  try {
    await updateDoc(doc(db, 'families', familyId, 'children', childId), updates);
    hideLoading();
    return { success: true };
  } catch(e) {
    hideLoading();
    console.error(e);
    return { error: 'שגיאה בשמירה' };
  }
}

// =========== DELETE CHILD ===========
export async function deleteChild(familyId, childId) {
  showLoading('מוחק...');
  try {
    const child = childrenCache.find(c => c.id === childId);
    if (child?.inviteCode) {
      try { await deleteDoc(doc(db, 'inviteCodes', child.inviteCode)); } catch(e) {}
    }
    await deleteDoc(doc(db, 'families', familyId, 'children', childId));
    hideLoading();
    return { success: true };
  } catch(e) {
    hideLoading();
    console.error(e);
    return { error: 'שגיאה במחיקה' };
  }
}

// =========== INVITE PARENT CODE ===========
export async function createParentInviteCode(familyId) {
  showLoading('יוצר קוד...');
  try {
    const code = generateCode();
    await setDoc(doc(db, 'parentInviteCodes', code), {
      familyId,
      createdAt: Timestamp.now(),
      used: false
    });
    hideLoading();
    return { success: true, code };
  } catch(e) {
    hideLoading();
    console.error(e);
    return { error: 'שגיאה ביצירת קוד' };
  }
}

// =========== VERIFY CHILD CODE ===========
export async function verifyChildCode(code) {
  try {
    const codeSnap = await getDoc(doc(db, 'inviteCodes', code));
    if (!codeSnap.exists()) return { error: 'קוד שגוי, נסה שוב' };

    const codeData = codeSnap.data();
    const created = codeData.createdAt?.toDate ? codeData.createdAt.toDate() : new Date(0);
    if (Date.now() - created.getTime() > CODE_EXPIRY_MS) return { error: 'הקוד פג תוקף. בקש קוד חדש מההורים' };
    if (codeData.used) return { error: 'הקוד כבר שומש' };

    const childSnap = await getDoc(doc(db, 'families', codeData.familyId, 'children', codeData.childId));
    if (!childSnap.exists()) return { error: 'שגיאה, פנה להורים' };

    return {
      success: true,
      familyId: codeData.familyId,
      childId: codeData.childId,
      code,
      ...childSnap.data()
    };
  } catch(e) {
    console.error(e);
    return { error: 'שגיאה, נסה שוב' };
  }
}

// =========== CHILD INVITE MODAL ===========
export function showChildInviteModal(childId, familyId) {
  const child = childrenCache.find(c => c.id === childId);
  if (!child) return;
  const code = child.inviteCode || '------';

  const ov = document.createElement('div'); ov.className = 'modal-overlay';
  const sh = document.createElement('div'); sh.className = 'modal-sheet';
  sh.innerHTML = `<div class="modal-handle"></div>
    <div class="modal-header"><h2>🔑 קוד הזמנה — ${child.name}</h2><button class="modal-close">✕</button></div>
    <div class="modal-body">
      <div style="text-align:right;margin-bottom:16px;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
          <span style="background:var(--primary);color:white;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:0.85rem;font-weight:800;flex-shrink:0;">1</span>
          <span style="font-size:0.92rem;font-weight:600;">פתח${child.gender === 'female' ? 'י' : ''} את האפליקציה במכשיר של ${child.gender === 'female' ? 'הילדה' : 'הילד'}</span>
        </div>
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
          <span style="background:var(--primary);color:white;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:0.85rem;font-weight:800;flex-shrink:0;">2</span>
          <span style="font-size:0.92rem;font-weight:600;">${child.gender === 'female' ? 'בחרי' : 'בחר'} <strong>"אני ילד/ה"</strong></span>
        </div>
        <div style="display:flex;align-items:center;gap:10px;">
          <span style="background:var(--primary);color:white;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:0.85rem;font-weight:800;flex-shrink:0;">3</span>
          <span style="font-size:0.92rem;font-weight:600;">הזן את הקוד למטה</span>
        </div>
      </div>
      <p style="color:var(--muted);font-size:0.82rem;text-align:center;margin-bottom:10px;">הקוד תקף ל-24 שעות ולבן משפחה אחד</p>
      <div class="invite-code-display">${code}</div>
      <div style="display:flex;gap:10px;margin-top:16px;">
        <button class="btn btn-primary btn-sm" id="modal-share-code" style="flex:1;">📤 שתף קוד</button>
        <button class="btn btn-secondary btn-sm" id="modal-edit-child" style="flex:1;">✏️ עריכה</button>
      </div>
    </div>`;

  sh.querySelector('.modal-close').onclick = () => ov.remove();
  ov.onclick = e => { if (e.target === ov) ov.remove(); };

  sh.querySelector('#modal-share-code').onclick = () => shareCode(code, child.name, child.gender);
  sh.querySelector('#modal-edit-child').onclick = () => {
    ov.remove();
    window.openEditChild(childId);
  };

  ov.appendChild(sh);
  document.body.appendChild(ov);
}

// =========== SHARE CODE ===========
export function shareCode(code, childName = '', gender = '') {
  const url = window.location.origin + window.location.pathname.replace(/[^/]*$/, 'index.html');
  const nameStr = childName ? ` ל${childName}` : '';
  const greeting = childName ? `שלום ${childName}! ` : '';
  const step2verb = gender === 'female' ? 'בחרי' : 'בחר';
  const step1verb = gender === 'female' ? 'פתחי' : 'פתח';
  const text = `🏠 משימות משפחתיות — קוד הזמנה${nameStr}\n\n${greeting}קיבלת הזמנה להצטרף למשימות המשפחה.\n\n📱 שלב 1: ${step1verb} את הקישור במכשיר שלך\n👧 שלב 2: ${step2verb} "אני ילד/ה"\n🔢 שלב 3: הזן את הקוד: ${code}\n\n⏰ הקוד תקף ל-24 שעות\n\n🔗 ${url}`;
  if (navigator.share) {
    navigator.share({ title: 'קוד הזמנה', text }).catch(() => {});
  } else {
    navigator.clipboard.writeText(text).then(() => showToast('הקוד הועתק! 📋'));
  }
}

// =========== DASHBOARD CHILDREN CARDS ===========
function isDueTodayFn(task, dayOfWeek) {
  if (!task.freq || task.freq === 'daily') return true;
  if (task.freq === 'weekly' || task.freq === '2week' || task.freq === 'once') return true;
  if (task.freq === 'specific' && Array.isArray(task.days)) return task.days.map(Number).includes(dayOfWeek);
  return true;
}

export async function renderDashboardChildren(familyId) {
  const grid = document.getElementById('dash-children-grid');
  if (!grid) return;

  // skeleton מיידי לפני קריאות Firestore
  if (!grid.querySelector('.child-dash-card')) {
    grid.innerHTML = `
      <style>@keyframes skelPulse{0%,100%{opacity:1}50%{opacity:.45}}</style>
      <div style="display:flex;gap:14px;width:100%;justify-content:center;">
        ${[0,1].map(() => `
          <div style="flex:1;min-width:0;max-width:160px;background:#F1F5F9;border-radius:20px;padding:18px 12px;text-align:center;animation:skelPulse 1.4s ease-in-out infinite;">
            <div style="width:68px;height:68px;border-radius:50%;background:#E2E8F0;margin:0 auto 10px;"></div>
            <div style="height:13px;background:#E2E8F0;border-radius:6px;width:60%;margin:0 auto 8px;"></div>
            <div style="height:10px;background:#E2E8F0;border-radius:6px;width:80%;margin:0 auto;"></div>
          </div>`).join('')}
      </div>`;
  }

  await loadChildren(familyId);
  const children = childrenCache;

  if (children.length === 0) {
    grid.innerHTML = `
      <div style="width:min(200px,80vw);background:#F8FAFC;border:2.5px dashed var(--border);border-radius:20px;padding:24px 16px;text-align:center;color:var(--muted);">
        <div style="font-size:2.2rem;margin-bottom:8px;">👶</div>
        <div style="font-size:0.85rem;font-weight:600;">עדיין אין ילדים</div>
      </div>`;
    return;
  }

  const count = children.length;
  grid.style.gap = count <= 2 ? '14px' : '10px';
  grid.style.justifyContent = count <= 2 ? 'center' : 'flex-start';
  grid.style.overflowX = count > 3 ? 'auto' : 'hidden';
  grid.style.paddingBottom = count > 3 ? '10px' : '0';
  if (count > 3) grid.style.scrollSnapType = 'x mandatory';

  let cardFlexStyle;
  if (count === 1) cardFlexStyle = 'width:min(180px,75vw);flex-shrink:0;';
  else if (count <= 3) cardFlexStyle = 'flex:1;min-width:0;';
  else cardFlexStyle = 'width:120px;flex-shrink:0;';

  const startOfWeek  = (() => { const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate() - d.getDay()); return d.getTime(); })();
  const todayStart   = (() => { const d = new Date(); d.setHours(0,0,0,0); return d.getTime(); })();
  const dayOfWeek    = new Date().getDay();

  let allFamilyTasks = [];
  try {
    const tSnap = await getDocs(collection(db, 'families', familyId, 'tasks'));
    allFamilyTasks = tSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(t => !t.hidden);
  } catch(e) {}

  // טען בקשות פרסים ממתינות
  let pendingPrizeRequests = {};
  try {
    const reqSnap = await getDocs(collection(db, 'families', familyId, 'prizeRequests'));
    reqSnap.forEach(d => {
      const r = d.data();
      if (r.status === 'pending') {
        pendingPrizeRequests[r.childId] = (pendingPrizeRequests[r.childId] || 0) + 1;
      }
    });
  } catch(e) {}

  const statsPromises = children.map(async (child) => {
    const childTasks = allFamilyTasks.filter(t =>
      (t.assignedChildren || []).includes(child.id) && isDueTodayFn(t, dayOfWeek)
    );
    try {
      const stateSnap = await getDoc(doc(db, 'families', familyId, 'children', child.id, 'state', 'current'));
      if (!stateSnap.exists()) return { weekly: 0, total: childTasks.length, done: 0, pts: 0 };
      const data = stateSnap.data();
      const hist = data.hist || [];
      const pts = data.pts || 0;
      const weekly = hist.filter(h => (h.ts||0) >= startOfWeek).reduce((s,h) => s+(h.pts||0), 0);
      const completedTodayIds = new Set(hist.filter(h => (h.ts||0) >= todayStart).map(h => h.taskId));
      const done = childTasks.filter(t => completedTodayIds.has(t.id)).length;
      return { weekly, total: childTasks.length, done, pts };
    } catch(e) { return { weekly: 0, total: childTasks.length, done: 0, pts: 0 }; }
  });

  const stats = await Promise.all(statsPromises);

  grid.innerHTML = children.map((child, i) => {
    const hasPhoto = child.photo && child.photo.length > 10;
    const color    = child.color || CHILD_COLORS[i % CHILD_COLORS.length];
    const { weekly, total, done, pts } = stats[i];
    const pending  = pendingPrizeRequests[child.id] || 0;
    const isWaiting = child.status === 'waiting';

    // תמונה או עיגול צבעוני
    const photoHTML = hasPhoto
      ? `<img src="${child.photo}" alt="${child.name}" style="width:68px;height:68px;border-radius:50%;object-fit:cover;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.15);">`
      : `<div style="width:68px;height:68px;border-radius:50%;background:${colorGradient(color)};display:flex;align-items:center;justify-content:center;font-size:2rem;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.15);">
           ${child.gender === 'female' ? '👧' : '👦'}
         </div>`;

    // פס התקדמות
    const pct = total > 0 ? Math.round((done / total) * 100) : 100;
    const allDone = total === 0 || done >= total;
    const barColor = allDone ? '#10B981' : (pct >= 50 ? '#F59E0B' : '#EF4444');
    const progressBar = `
      <div style="width:100%;background:#F1F5F9;border-radius:99px;height:7px;margin-top:8px;overflow:hidden;">
        <div style="height:100%;border-radius:99px;background:${barColor};width:${pct}%;transition:width 0.6s ease;"></div>
      </div>
      <div style="font-size:0.68rem;font-weight:700;color:${barColor};margin-top:3px;">
        ${allDone ? '✅ הכל בוצע!' : `${done}/${total} משימות`}
      </div>`;

    // badge פרסים ממתינים
    const prizeBadge = pending > 0
      ? `<div style="background:#EF4444;color:white;border-radius:20px;padding:3px 8px;font-size:0.68rem;font-weight:800;margin-top:4px;display:inline-flex;align-items:center;gap:3px;">
           🎁 ${pending} ממתין${pending > 1 ? 'ות' : 'ת'}
         </div>`
      : '';

    // badge ממתין לכניסה
    const waitingBadge = isWaiting
      ? `<div style="background:#FEF3C7;color:#92400E;border-radius:20px;padding:3px 8px;font-size:0.68rem;font-weight:800;margin-top:4px;">⏳ ממתין</div>`
      : '';

    const onclick = isWaiting
      ? `showChildInviteModal('${child.id}')`
      : pending > 0
        ? `location.href='points.html?tab=pending'`
        : `location.href='points.html?childName=${encodeURIComponent(child.name)}'`;

    return `
      <div class="child-dash-card" onclick="${onclick}" style="${cardFlexStyle}background:white;border-radius:20px;
           box-shadow:0 2px 12px rgba(0,0,0,0.08),inset 0 -4px 0 ${color};
           padding:16px 10px 14px;text-align:center;display:flex;flex-direction:column;
           align-items:center;cursor:pointer;-webkit-tap-highlight-color:transparent;
           transition:transform 0.15s;active:transform:scale(0.97);">
        <div style="position:relative;margin-bottom:6px;">
          ${photoHTML}
          ${pending > 0 ? `<div style="position:absolute;top:-2px;left:-2px;width:16px;height:16px;background:#EF4444;border-radius:50%;border:2px solid white;"></div>` : ''}
        </div>
        <div style="font-weight:800;font-size:0.88rem;color:var(--text);white-space:nowrap;
                    overflow:hidden;text-overflow:ellipsis;width:100%;">${child.name}</div>
        <div style="display:flex;justify-content:space-between;width:100%;font-size:0.72rem;font-weight:700;margin-top:4px;direction:rtl;">
          <span style="color:#F59E0B;">⭐ ${weekly} השבוע</span>
          <span style="color:#7C3AED;">⭐ ${pts} סה"כ</span>
        </div>
        ${progressBar}
        ${prizeBadge}
        ${waitingBadge}
      </div>`;
  }).join('');
}

// =========== WEEKLY HISTORY SNAPSHOT ===========
function _getWeekId(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7; d.setUTCDate(d.getUTCDate() + 4 - day);
  const yr = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const wk = Math.ceil((((d - yr) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(wk).padStart(2,'0')}`;
}

export async function saveWeeklySnapshot(familyId) {
  const now = new Date();
  const thisSunday = new Date(now); thisSunday.setHours(0,0,0,0); thisSunday.setDate(now.getDate() - now.getDay());
  const lastSunday = new Date(thisSunday); lastSunday.setDate(thisSunday.getDate() - 7);
  const weekId = _getWeekId(lastSunday);
  const savedKey = `weekSnap_${familyId}_${weekId}`;
  if (localStorage.getItem(savedKey)) return;

  const children = childrenCache;
  if (!children.length) return;

  const weekStart = lastSunday.getTime();
  const weekEnd   = thisSunday.getTime();
  const monthStart = (() => { const d = new Date(now); d.setDate(1); d.setHours(0,0,0,0); return d.getTime(); })();

  const childrenData = {};
  for (const child of children) {
    try {
      const stSnap = await getDoc(doc(db, 'families', familyId, 'children', child.id, 'state', 'current'));
      const hist = stSnap.exists() ? (stSnap.data().hist || []) : [];
      const weekPts  = hist.filter(h => (h.ts||0) >= weekStart && (h.ts||0) < weekEnd).reduce((s,h) => s+(h.pts||0), 0);
      const monthPts = hist.filter(h => (h.ts||0) >= monthStart).reduce((s,h) => s+(h.pts||0), 0);
      childrenData[child.id] = { name: child.name, weekPts, monthPts };
    } catch(e) {}
  }

  try {
    await setDoc(doc(db, 'families', familyId, 'weeklyHistory', weekId), {
      weekId, weekStart, weekEnd, children: childrenData, savedAt: Date.now()
    });
    localStorage.setItem(savedKey, '1');
  } catch(e) {}
}

// =========== DASH TASK ROWS ===========
const _dtrIntervals = [];

const PLACEHOLDER_HTML = `<div class="dash-task-placeholder" style="background:white;border-radius:14px;padding:14px 16px;text-align:center;color:#CBD5E1;font-size:0.82rem;font-weight:600;box-shadow:0 2px 8px rgba(0,0,0,0.05);border:2px dashed #E2E8F0;">כאן יוצגו המשימות להיום</div>`;

function buildChildPlaceholders(children) {
  return children.map((child, ci) => {
    const genderEmoji = child.gender === 'female' ? '👧' : '👦';
    const displayEmoji = child.emoji || genderEmoji;
    const color = child.color || CHILD_COLORS[ci % CHILD_COLORS.length];
    return `<div style="background:white;border-radius:14px;padding:10px 14px;margin-bottom:7px;box-shadow:0 2px 8px rgba(0,0,0,0.06),inset -4px 0 0 ${color},inset 0 -3px 0 ${color}70;display:flex;align-items:center;gap:10px;">
      <div style="display:flex;align-items:center;gap:5px;flex-shrink:0;min-width:68px;">
        <span style="font-size:1.1rem;">${displayEmoji}</span>
        <span style="font-weight:800;font-size:0.8rem;color:var(--text);white-space:nowrap;">${child.name}</span>
      </div>
      <div style="width:1px;height:22px;background:#E2E8F0;flex-shrink:0;"></div>
      <div style="flex:1;font-size:0.8rem;color:#CBD5E1;font-weight:600;">אין משימות להיום ✓</div>
    </div>`;
  }).join('');
}

export async function renderDashTaskRows(familyId) {
  _dtrIntervals.forEach(clearInterval);
  _dtrIntervals.length = 0;
  const container = document.getElementById('dash-task-rows');
  if (!container) return;

  await loadChildren(familyId);
  const children = childrenCache;
  if (!children.length) { container.innerHTML = PLACEHOLDER_HTML; return; }

  const todayStart = (() => { const d = new Date(); d.setHours(0,0,0,0); return d.getTime(); })();
  const dayOfWeek = new Date().getDay();

  let allFamilyTasks = [];
  try {
    const tSnap = await getDocs(collection(db, 'families', familyId, 'tasks'));
    allFamilyTasks = tSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(t => !t.hidden);
  } catch(e) { container.innerHTML = buildChildPlaceholders(children); return; }

  if (!allFamilyTasks.length) { container.innerHTML = buildChildPlaceholders(children); return; }

  const childRows = await Promise.all(children.map(async (child) => {
    const childTasks = allFamilyTasks.filter(t =>
      (t.assignedChildren || []).includes(child.id) && isDueTodayFn(t, dayOfWeek)
    );
    try {
      const stSnap = await getDoc(doc(db, 'families', familyId, 'children', child.id, 'state', 'current'));
      const hist = stSnap.exists() ? (stSnap.data().hist || []) : [];
      const completedIds = new Set(hist.filter(h => (h.ts||0) >= todayStart).map(h => h.taskId));
      const remaining = childTasks.filter(t => !completedIds.has(t.id));
      return { child, remaining };
    } catch(e) { return { child, remaining: childTasks }; }
  }));

  container.innerHTML = '';

  let anyRows = false;
  childRows.forEach(({ child, remaining }, ci) => {
    const genderEmoji = child.gender === 'female' ? '👧' : '👦';
    const displayEmoji = child.emoji || genderEmoji;
    const color = child.color || CHILD_COLORS[ci % CHILD_COLORS.length];

    const row = document.createElement('div');
    row.className = 'dash-task-row';
    row.style.boxShadow = `0 2px 8px rgba(0,0,0,0.06),inset -4px 0 0 ${color},inset 0 -3px 0 ${color}70`;

    if (!remaining.length) {
      row.innerHTML = `
        <div class="dtr-name">
          <span style="font-size:1.1rem;">${displayEmoji}</span>
          <span style="font-weight:800;font-size:0.8rem;color:var(--text);white-space:nowrap;">${child.name}</span>
        </div>
        <div class="dtr-divider"></div>
        <div class="dtr-tasks">
          <span class="dtr-task-text" style="color:#10B981;">✅ הכל בוצע!</span>
        </div>`;
    } else {
      anyRows = true;
      row.innerHTML = `
        <div class="dtr-name">
          <span style="font-size:1.1rem;">${displayEmoji}</span>
          <span style="font-weight:800;font-size:0.8rem;color:var(--text);white-space:nowrap;">${child.name}</span>
        </div>
        <div class="dtr-divider"></div>
        <div class="dtr-tasks">
          <span class="dtr-task-text">${remaining[0].emoji || '📋'} ${remaining[0].task}</span>
        </div>`;

      if (remaining.length > 1) {
        let idx = 0;
        const taskEl = row.querySelector('.dtr-task-text');
        _dtrIntervals.push(setInterval(() => {
          idx = (idx + 1) % remaining.length;
          taskEl.style.opacity = '0';
          setTimeout(() => {
            taskEl.textContent = `${remaining[idx].emoji || '📋'} ${remaining[idx].task}`;
            taskEl.style.opacity = '1';
          }, 300);
        }, 3000));
      }
    }
    container.appendChild(row);
  });
}

// =========== DASHBOARD LIVE LISTENERS ===========
export function initDashboardListeners(familyId) {
  let renderTimer = null;
  let renderChildTimer = null;

  function scheduleRenderAll() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(() => {
      renderDashboardChildren(familyId);
      renderDashTaskRows(familyId);
    }, 120);
  }

  function scheduleRenderChildren() {
    clearTimeout(renderChildTimer);
    renderChildTimer = setTimeout(() => {
      renderDashboardChildren(familyId);
    }, 120);
  }

  const unsubTasks = onSnapshot(
    collection(db, 'families', familyId, 'tasks'),
    () => scheduleRenderAll(),
    () => {}
  );

  const unsubPrizeReq = onSnapshot(
    collection(db, 'families', familyId, 'prizeRequests'),
    () => scheduleRenderChildren(),
    () => {}
  );

  const childStateUnsubs = [];
  for (const child of childrenCache) {
    const stateRef = doc(db, 'families', familyId, 'children', child.id, 'state', 'current');
    const u = onSnapshot(stateRef, () => scheduleRenderAll(), () => {});
    childStateUnsubs.push(u);
  }

  return function unsub() {
    clearTimeout(renderTimer);
    clearTimeout(renderChildTimer);
    unsubTasks();
    unsubPrizeReq();
    childStateUnsubs.forEach(u => u());
  };
}

export function shareParentCode(code) {
  const url = window.location.origin + window.location.pathname.replace(/[^/]*$/, 'index.html');
  const text = `🏠 משימות משפחתיות — הזמנה להורה נוסף\n\nשלום! קיבלת הזמנה להצטרף כהורה לניהול משימות המשפחה.\n\n📱 שלב 1: פתח את הקישור במכשיר שלך\n👨‍👩‍👧‍👦 שלב 2: בחר "הורה" והתחבר עם Google או Facebook\n🔢 שלב 3: הזן את הקוד: ${code}\n\n⏰ הקוד תקף ל-24 שעות\n\n🔗 ${url}`;
  if (navigator.share) {
    navigator.share({ title: 'הזמנה להצטרפות כהורה', text }).catch(() => {});
  } else {
    navigator.clipboard.writeText(text).then(() => showToast('הקוד הועתק! 📋'));
  }
}
