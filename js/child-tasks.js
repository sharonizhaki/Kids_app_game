// =========== child-tasks.js ===========
// לוגיקת משימות: isDone, completeTask (עם pending), render קטגוריות, היסטוריה, modals.

import {
  collection, addDoc, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

import { state }                                    from './child-state.js';
import { starsText, makeModal, closeModals, showToast } from './child-ui.js';

// -------- CONSTANTS --------
export const FREQ_LABEL = {
  daily:    'כל יום',
  '2week':  'פעמיים בשבוע',
  weekly:   'פעם בשבוע',
  once:     'חד פעמית',
  specific: 'ימים ספציפיים',
};
export const FREQ_CLS = {
  daily:   'freq-daily',
  '2week': 'freq-2week',
  weekly:  'freq-weekly',
};
const DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

// db מועבר מ-child.js בעת init
let _db = null;
export function initTasksModule(db) { _db = db; }

// -------- DATE HELPERS --------
export function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// -------- IS DONE --------
export function isDone(t) {
  const c = state.childState?.comp?.[t.id];
  if (!c) return false;
  if (t.freq === 'daily')    return c.d === todayKey();
  if (t.freq === 'specific') return c.d === todayKey();
  if (t.freq === 'once')     return (c.count || 0) >= 1;
  if (t.freq === '2week')    return c.wc >= (t.limit || 2);
  if (t.freq === 'weekly')   return c.wc >= 1;
  return false;
}

// -------- IS PENDING --------
export function isPending(t) {
  return (state.childState?.pending || []).some(
    p => p.taskId === t.id && p.status === 'pending'
  );
}

// -------- COMPLETE TASK (entry point) --------
export function completeTask(t, saveStateFn) {
  if (t.requireApproval) {
    _submitPending(t, saveStateFn);
  } else {
    _finalizeTask(t, saveStateFn);
  }
}

// -------- FINALIZE --------
export function _finalizeTask(t, saveStateFn) {
  const d       = new Date();
  const time    = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  const day     = DAYS[d.getDay()];
  const dateKey = todayKey();
  const cs      = state.childState;

  cs.pts = (cs.pts || 0) + t.pts;

  const c = cs.comp?.[t.id] || { wc: 0, d: '', count: 0, lastTs: 0 };
  c.wc++; c.d = dateKey; c.count++; c.lastTs = Date.now();
  if (!cs.comp) cs.comp = {};
  cs.comp[t.id] = c;

  cs.lastActive = dateKey;
  if (!cs.dailyPts) cs.dailyPts = {};
  cs.dailyPts[dateKey] = (cs.dailyPts[dateKey] || 0) + t.pts;

  if (!cs.hist) cs.hist = [];
  cs.hist.unshift({
    taskId: t.id,
    task:   t.task,
    emoji:  t.emojis?.split?.(' ')?.[0] || t.emoji || '⭐',
    pts:    t.pts,
    time, day,
    ts:     Date.now(),
  });
  if (cs.hist.length > 50) cs.hist.pop();

  saveStateFn();
}

// -------- SUBMIT PENDING --------
async function _submitPending(t, saveStateFn) {
  const d    = new Date();
  const time = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  const day  = DAYS[d.getDay()];
  const cs   = state.childState;
  const ts   = Date.now();

  if (!cs.pending) cs.pending = [];
  cs.pending.push({
    taskId: t.id,
    task:   t.task,
    emoji:  t.emojis?.split?.(' ')?.[0] || t.emoji || '⭐',
    pts:    t.pts,
    time, day, ts,
    status: 'pending',
  });
  saveStateFn();

  if (_db && state.familyId && state.childId) {
    try {
      await addDoc(
        collection(_db, 'families', state.familyId, 'pendingApprovals'),
        {
          taskId:     t.id,
          task:       t.task,
          emoji:      t.emojis?.split?.(' ')?.[0] || t.emoji || '⭐',
          pts:        t.pts,
          time, day, ts,
          childId:    state.childId,
          childName:  state.childData?.name  || '',
          childEmoji: state.childData?.emoji || '👦',
          status:     'pending',
          createdAt:  serverTimestamp(),
        }
      );
    } catch (e) { console.error('pendingApprovals write error:', e); }
  }
}

// -------- RENDER PENDING SECTION --------
export function renderPendingSection() {
  const section = document.getElementById('pending-section');
  if (!section) return;

  const pending = (state.childState?.pending || []);
  const active  = pending.filter(p => p.status !== 'rejected');

  if (active.length === 0) { section.style.display = 'none'; return; }
  section.style.display = 'block';

  const list = document.getElementById('pending-list');
  if (!list) return;

  list.innerHTML = active.map(p => `
    <div class="pending-item">
      <span class="pending-emoji">${p.emoji || '⭐'}</span>
      <div class="pending-info">
        <strong>${p.task}</strong>
        <span>${p.day} ${p.time}</span>
      </div>
      <span class="pending-badge ${p.status === 'approved' ? 'pending-approved' : 'pending-waiting'}">
        ${p.status === 'approved' ? '✅ אושר!' : '⏳ ממתין'}
      </span>
    </div>`).join('');
}

// -------- CATEGORY COLORS (dynamic palette) --------
const CAT_PALETTES = [
  { bg: '#fff3e0', text: '#b45309' }, // כתום
  { bg: '#e8f5e9', text: '#166534' }, // ירוק
  { bg: '#e3f2fd', text: '#1e40af' }, // כחול
  { bg: '#fce4ec', text: '#9d174d' }, // ורוד
  { bg: '#f3e8ff', text: '#6b21a8' }, // סגול
  { bg: '#e0f7fa', text: '#0e7490' }, // טורקיז
  { bg: '#fef9c3', text: '#854d0e' }, // צהוב
  { bg: '#ffe4e6', text: '#9f1239' }, // אדום בהיר
  { bg: '#ecfdf5', text: '#065f46' }, // מנטה
  { bg: '#fdf4ff', text: '#7e22ce' }, // לילך
];

// מיפוי שם קטגוריה → palette index (נשמר בזיכרון בריצה)
const _catColorMap = {};
let _catColorCounter = 0;

function getCatPalette(catName) {
  if (_catColorMap[catName] === undefined) {
    _catColorMap[catName] = _catColorCounter % CAT_PALETTES.length;
    _catColorCounter++;
  }
  return CAT_PALETTES[_catColorMap[catName]];
}

// -------- RENDER CATEGORIES GRID --------
export function renderCategories(saveStateFn, renderChildFn) {
  const grid = document.getElementById('cats-grid');
  if (!grid) return;

  const visibleTasks = state.tasksData.filter(t => !t.hidden);
  if (visibleTasks.length === 0) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1;">
        עדיין לא הוגדרו מטלות 📋
        <br><small style="color:var(--muted);">ההורים צריכים להוסיף מטלות</small>
      </div>`;
    return;
  }

  const cats = {};
  visibleTasks.forEach(t => {
    const cat = t.cat || 'כללי';
    if (!cats[cat]) cats[cat] = [];
    cats[cat].push(t);
  });

  grid.innerHTML = Object.entries(cats).map(([cat, tasks]) => {
    const dn      = tasks.filter(t => isDone(t)).length;
    const pn      = tasks.filter(t => !isDone(t) && isPending(t)).length;
    const allDone = dn === tasks.length;
    const icon    = tasks[0]?.catIcon || '📋';
    const pal     = getCatPalette(cat);

    return `
      <button class="cat-btn${allDone ? ' cat-btn-done' : ''}" data-cat="${cat}"
        style="--cat-bg:${pal.bg};--cat-text:${pal.text};background:${pal.bg};">
        <span class="cat-icon">${icon}</span>
        <span class="cat-name">${cat}</span>
        ${allDone
          ? '<span class="cat-done">✅ הושלם!</span>'
          : `<span class="cat-count">${dn}/${tasks.length} בוצעו${pn > 0 ? ` · ${pn} ⏳` : ''}</span>`}
      </button>`;
  }).join('');

  grid.querySelectorAll('.cat-btn').forEach(b => {
    b.onclick = () => showCatModal(b.dataset.cat, saveStateFn, renderChildFn);
  });
}

// -------- CATEGORY MODAL — NEW --------
function showCatModal(cat, saveStateFn, renderChildFn) {
  const tasks = state.tasksData.filter(t => (t.cat || 'כללי') === cat && !t.hidden);
  const pal   = getCatPalette(cat);
  const icon  = tasks[0]?.catIcon || '📋';

  // overlay
  const ov = document.createElement('div');
  ov.className = 'modal-overlay';
  ov.onclick = e => { if (e.target === ov) ov.remove(); };

  // sheet
  const sh = document.createElement('div');
  sh.className = 'modal-sheet';
  sh.style.cssText = 'overflow:hidden;';

  // header צבעוני
  const header = document.createElement('div');
  header.className = 'task-modal-header';
  header.style.cssText = `background:${pal.bg};`;
  header.innerHTML = `
    <span class="task-modal-header-emoji">${icon}</span>
    <span class="task-modal-header-title" style="color:${pal.text};">${cat}</span>
    <button class="task-modal-close" style="color:${pal.text};">✕</button>`;
  header.querySelector('.task-modal-close').onclick = () => ov.remove();

  const body = document.createElement('div');
  body.style.cssText = 'overflow-y:auto;max-height:65vh;';

  tasks.forEach(t => {
    const done    = isDone(t);
    const pending = !done && isPending(t);

    const row = document.createElement('div');
    row.className = `task-row-item${done ? ' task-row-done' : pending ? ' task-row-pending' : ''}`;

    // תוכן שורה
    const freqCls = FREQ_CLS[t.freq] || '';
    row.innerHTML = `
      <span class="task-row-emoji">${t.emoji || '⭐'}</span>
      <div class="task-row-info">
        <strong>${t.task}</strong>
        <span class="freq-tag ${freqCls}">${FREQ_LABEL[t.freq] || ''}</span>
      </div>
      <div class="task-row-actions"></div>`;

    const actions = row.querySelector('.task-row-actions');

    if (done) {
      actions.innerHTML = `<span style="font-size:1.3rem;">✅</span>`;
    } else if (pending) {
      actions.innerHTML = `<span style="font-size:1.1rem;">⏳</span>`;
    } else if (t.requireApproval) {
      // חובה לצלם
      const btnPhoto = document.createElement('button');
      btnPhoto.className = 'task-btn-photo-required';
      btnPhoto.textContent = '📸 צלם';
      btnPhoto.onclick = () => _handleComplete(t, true, saveStateFn, renderChildFn, ov);
      actions.appendChild(btnPhoto);
    } else {
      // ✅ + 📸 אופציונלי
      const btnDone = document.createElement('button');
      btnDone.className = 'task-btn-done';
      btnDone.textContent = '✅ סיימתי';
      btnDone.onclick = () => _handleComplete(t, false, saveStateFn, renderChildFn, ov);

      const btnPhoto = document.createElement('button');
      btnPhoto.className = 'task-btn-photo';
      btnPhoto.textContent = '📸';
      btnPhoto.title = 'צלם תמונה (אופציונלי)';
      btnPhoto.onclick = () => _handleComplete(t, false, saveStateFn, renderChildFn, ov);

      actions.appendChild(btnDone);
      actions.appendChild(btnPhoto);
    }

    body.appendChild(row);
  });

  sh.appendChild(header);
  sh.appendChild(body);
  ov.appendChild(sh);
  document.body.appendChild(ov);
}

// -------- HANDLE COMPLETE --------
function _handleComplete(t, withPhoto, saveStateFn, renderChildFn, ov) {
  completeTask(t, saveStateFn);
  ov.remove();
  if (t.requireApproval) {
    showToast({ message: 'נשלח לאישור הורה! ⏳', color: state.childData?.color });
  } else {
    showToast({ pts: t.pts, color: state.childData?.color });
  }
  renderChildFn();
}
// -------- RENDER HISTORY --------
export function renderHistory() {
  const hl = document.getElementById('user-hist');
  if (!hl) return;
  const items = (state.childState?.hist || []).slice(0, 10);
  hl.innerHTML = items.length
    ? items.map(h => `
        <div class="hi-item">
          <span class="hi-emoji">${h.emoji || '⭐'}</span>
          <div class="hi-info">
            <strong>${h.task}</strong>
            <span>${h.day} ${h.time}</span>
          </div>
          <span class="hi-pts">${starsText(h.pts)}</span>
        </div>`).join('')
    : '<div class="empty-state">עדיין לא ביצעת משימות</div>';
}
