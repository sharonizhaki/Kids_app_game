import { auth, db } from './firebase.js';
import {
  doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc,
  collection, serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { showScreen, showToast, showLoading, hideLoading } from './ui.js';
import { generateCode } from './auth.js';

// =========== CONSTANTS ===========
export const CHILD_EMOJIS = ["🦁","🐱","🦄","🐶","🐸","🦊","🐼","🦋","🌟","🎈","🐯","🐰","🦜","🐻","🎀","🚀","⚽","🎸","🌈","🧸","🐬","🦕","🐝","🍀"];
export const CHILD_COLORS = ["#EF4444","#F59E0B","#10B981","#3B82F6","#8B5CF6","#EC4899","#06B6D4","#F97316","#84CC16","#6366F1"];
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
        <div class="child-card" onclick="${isWaiting ? `showChildInviteModal('${c.id}')` : `openEditChild('${c.id}')`}" style="box-shadow:0 2px 10px rgba(0,0,0,0.07),inset -4px 0 0 ${color},inset 0 -3px 0 ${color}70;">
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
export async function createChild(familyId, name, gender) {
  if (!name) return { error: 'חובה להכניס שם' };
  if (!gender) return { error: 'חובה לבחור מין' };

  showLoading('יוצר...');
  try {
    const code = generateCode();
    const childRef = doc(collection(db, 'families', familyId, 'children'));
    await setDoc(childRef, {
      name,
      gender,
      emoji: '',
      color: '',
      photo: '',
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
          <span style="font-size:0.92rem;font-weight:600;">פתח את האפליקציה במכשיר של הילד/ה</span>
        </div>
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
          <span style="background:var(--primary);color:white;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:0.85rem;font-weight:800;flex-shrink:0;">2</span>
          <span style="font-size:0.92rem;font-weight:600;">בחר <strong>"אני ילד/ה"</strong></span>
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

  sh.querySelector('#modal-share-code').onclick = () => shareCode(code, child.name);
  sh.querySelector('#modal-edit-child').onclick = () => {
    ov.remove();
    window.openEditChild(childId);
  };

  ov.appendChild(sh);
  document.body.appendChild(ov);
}

// =========== SHARE CODE ===========
export function shareCode(code, childName = '') {
  const url = window.location.origin + window.location.pathname.replace(/[^/]*$/, 'index.html');
  const nameStr = childName ? ` ל${childName}` : '';
  const greeting = childName ? `שלום ${childName}! ` : '';
  const text = `🏠 משימות משפחתיות — קוד הזמנה${nameStr}\n\n${greeting}קיבלת הזמנה להצטרף למשימות המשפחה.\n\n📱 שלב 1: פתח את הקישור במכשיר שלך\n👧 שלב 2: בחר "אני ילד/ה"\n🔢 שלב 3: הזן את הקוד: ${code}\n\n⏰ הקוד תקף ל-24 שעות\n\n🔗 ${url}`;
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
  // כיוון ורוחב של גריד הדשבורד
  const gap = count <= 2 ? 14 : 10;
  grid.style.gap = `${gap}px`;
  grid.style.justifyContent = count <= 2 ? 'center' : 'flex-start';
  grid.style.overflowX = count > 3 ? 'auto' : 'hidden';
  grid.style.paddingBottom = count > 3 ? '10px' : '0';
  if (count > 3) grid.style.scrollSnapType = 'x mandatory';

  // סגנון כרטיס: 1 ילד — רחב, 2-3 ילדים — גמיש (ממלא שורה), 4+ — קבוע לגלילה
  let cardFlexStyle;
  if (count === 1) cardFlexStyle = 'width:min(200px,80vw);flex-shrink:0;';
  else if (count <= 3) cardFlexStyle = 'flex:1;min-width:0;';
  else cardFlexStyle = 'width:110px;flex-shrink:0;';

  const startOfWeek = (() => { const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate() - d.getDay()); return d.getTime(); })();
  const startOfMonth = (() => { const d = new Date(); d.setDate(1); d.setHours(0,0,0,0); return d.getTime(); })();
  const todayStart = (() => { const d = new Date(); d.setHours(0,0,0,0); return d.getTime(); })();
  const dayOfWeek = new Date().getDay();

  // Load all tasks once
  let allFamilyTasks = [];
  try {
    const tSnap = await getDocs(collection(db, 'families', familyId, 'tasks'));
    allFamilyTasks = tSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(t => !t.hidden);
  } catch(e) {}

  const statsPromises = children.map(async (child) => {
    const childTasks = allFamilyTasks.filter(t =>
      (t.assignedChildren || []).includes(child.id) && isDueTodayFn(t, dayOfWeek)
    );
    try {
      const stateSnap = await getDoc(doc(db, 'families', familyId, 'children', child.id, 'state', 'current'));
      if (!stateSnap.exists()) return { weekly: 0, monthly: 0, remaining: childTasks.length };
      const hist = stateSnap.data().hist || [];
      const weekly  = hist.filter(h => (h.ts||0) >= startOfWeek).reduce((s,h) => s+(h.pts||0), 0);
      const monthly = hist.filter(h => (h.ts||0) >= startOfMonth).reduce((s,h) => s+(h.pts||0), 0);
      const completedTodayIds = new Set(hist.filter(h => (h.ts||0) >= todayStart).map(h => h.taskId));
      const remaining = Math.max(0, childTasks.filter(t => !completedTodayIds.has(t.id)).length);
      return { weekly, monthly, remaining };
    } catch(e) { return { weekly: 0, monthly: 0, remaining: childTasks.length }; }
  });

  const stats = await Promise.all(statsPromises);

  grid.innerHTML = children.map((child, i) => {
    const genderEmoji = child.gender === 'female' ? '👧' : '👦';
    const displayEmoji = child.emoji || genderEmoji;
    const hasPhoto = child.photo && child.photo.length > 10;
    const { weekly, monthly, remaining } = stats[i];
    const color = child.color || CHILD_COLORS[i % CHILD_COLORS.length];

    const photoHTML = hasPhoto
      ? `<img src="${child.photo}" alt="${child.name}" style="width:60px;height:60px;border-radius:50%;object-fit:cover;border:2px solid var(--border);">`
      : `<div style="width:60px;height:60px;border-radius:50%;background:linear-gradient(135deg,#E0E7FF,#C7D2FE);display:flex;align-items:center;justify-content:center;font-size:1.8rem;">${displayEmoji}</div>`;

    const remainingHTML = remaining > 0
      ? `<div style="background:#FEE2E2;border-radius:8px;padding:4px 6px;font-size:0.72rem;font-weight:700;color:#991B1B;">✅ נותרו ${remaining} מטלות</div>`
      : `<div style="background:#DCFCE7;border-radius:8px;padding:4px 6px;font-size:0.72rem;font-weight:700;color:#14532D;">✅ הכל בוצע!</div>`;

    return `
      <div style="${cardFlexStyle}background:white;border-radius:20px;box-shadow:0 2px 12px rgba(0,0,0,0.08),inset -4px 0 0 ${color},inset 0 -3px 0 ${color}70;padding:16px 10px 14px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:5px;">
        ${photoHTML}
        <div style="font-weight:800;font-size:0.9rem;color:var(--text);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;width:100%;">${child.name}</div>
        <div style="font-size:1.3rem;">${displayEmoji}</div>
        <div style="display:flex;flex-direction:column;gap:3px;width:100%;margin-top:2px;">
          <div style="background:#FEF9C3;border-radius:8px;padding:4px 6px;font-size:0.72rem;font-weight:700;color:#713F12;">⭐ כוכבים השבוע: ${weekly}</div>
          <div style="background:#DCFCE7;border-radius:8px;padding:4px 6px;font-size:0.72rem;font-weight:700;color:#14532D;">🗓️ כוכבים החודש: ${monthly}</div>
          ${remainingHTML}
        </div>
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

export async function renderDashTaskRows(familyId) {
  _dtrIntervals.forEach(clearInterval);
  _dtrIntervals.length = 0;
  const container = document.getElementById('dash-task-rows');
  if (!container) return;

  await loadChildren(familyId);
  const children = childrenCache;
  if (!children.length) { container.innerHTML = ''; return; }

  const todayStart = (() => { const d = new Date(); d.setHours(0,0,0,0); return d.getTime(); })();
  const dayOfWeek = new Date().getDay();

  let allFamilyTasks = [];
  try {
    const tSnap = await getDocs(collection(db, 'families', familyId, 'tasks'));
    allFamilyTasks = tSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(t => !t.hidden);
  } catch(e) { return; }

  if (!allFamilyTasks.length) { container.innerHTML = ''; return; }

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

  childRows.forEach(({ child, remaining }, ci) => {
    if (!remaining.length) return;
    const genderEmoji = child.gender === 'female' ? '👧' : '👦';
    const displayEmoji = child.emoji || genderEmoji;
    const color = child.color || CHILD_COLORS[ci % CHILD_COLORS.length];

    const row = document.createElement('div');
    row.className = 'dash-task-row';
    row.style.boxShadow = `0 2px 8px rgba(0,0,0,0.06),inset -4px 0 0 ${color},inset 0 -3px 0 ${color}70`;

    row.innerHTML = `
      <div class="dtr-name">
        <span style="font-size:1.1rem;">${displayEmoji}</span>
        <span style="font-weight:800;font-size:0.8rem;color:var(--text);white-space:nowrap;">${child.name}</span>
      </div>
      <div class="dtr-divider"></div>
      <div class="dtr-tasks">
        <span class="dtr-task-text">${remaining[0].emoji || '📋'} ${remaining[0].task}</span>
      </div>`;
    container.appendChild(row);

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
  });
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
