// =========== child-tasks.js ===========
// לוגיקת משימות: isDone, completeTask, render קטגוריות, render היסטוריה, modals.

import { state } from './child-state.js';
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

// -------- DATE HELPERS --------
export function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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

// -------- COMPLETE TASK --------
// saveStateFn — async פונקציה לשמירת state ל-Firestore
export function completeTask(t, saveStateFn) {
  const d = new Date();
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const day  = DAYS[d.getDay()];
  const dateKey = todayKey();
  const cs = state.childState;

  // כוכבים
  cs.pts = (cs.pts || 0) + t.pts;

  // comp
  const c = cs.comp?.[t.id] || { wc: 0, d: '', count: 0, lastTs: 0 };
  c.wc++; c.d = dateKey; c.count++; c.lastTs = Date.now();
  if (!cs.comp) cs.comp = {};
  cs.comp[t.id] = c;

  // streak + dailyPts
  cs.lastActive = dateKey;
  if (!cs.dailyPts) cs.dailyPts = {};
  cs.dailyPts[dateKey] = (cs.dailyPts[dateKey] || 0) + t.pts;

  // hist
  if (!cs.hist) cs.hist = [];
  cs.hist.unshift({
    taskId: t.id,
    task:   t.task,
    emoji:  t.emojis?.split?.(' ')?.[0] || t.emoji || '⭐',
    pts:    t.pts,
    time,
    day,
    ts:     Date.now(),
  });
  if (cs.hist.length > 50) cs.hist.pop();

  saveStateFn();
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

  // קיבוץ לפי קטגוריה
  const cats = {};
  visibleTasks.forEach(t => {
    const cat = t.cat || 'כללי';
    if (!cats[cat]) cats[cat] = [];
    cats[cat].push(t);
  });

  grid.innerHTML = Object.entries(cats).map(([cat, tasks]) => {
    const dn   = tasks.filter(t => isDone(t)).length;
    const icon = tasks[0]?.catIcon || '📋';
    const allDone = dn === tasks.length;
    return `
      <button class="cat-btn${allDone ? ' cat-btn-done' : ''}" data-cat="${cat}">
        <span class="cat-icon">${icon}</span>
        <span class="cat-name">${cat}</span>
        ${allDone
          ? '<span class="cat-done">✅ הושלם!</span>'
          : `<span class="cat-count">${dn}/${tasks.length} בוצעו</span>`}
      </button>`;
  }).join('');

  grid.querySelectorAll('.cat-btn').forEach(b => {
    b.onclick = () => showCatModal(b.dataset.cat, saveStateFn, renderChildFn);
  });
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

// -------- CATEGORY MODAL --------
function showCatModal(cat, saveStateFn, renderChildFn) {
  const tasks = state.tasksData.filter(t => (t.cat || 'כללי') === cat && !t.hidden);
  const body  = makeModal(`${tasks[0]?.catIcon || '📋'} ${cat}`);

  tasks.forEach(t => {
    const done = isDone(t);
    const d = document.createElement('div');
    d.className = `task-card${done ? ' done' : ''}`;
    d.innerHTML = `
      <div class="tc-left">
        <span class="tc-emoji">${t.emoji || '⭐'}</span>
        <div class="tc-info">
          <strong>${t.task}</strong>
          <span class="freq-tag ${FREQ_CLS[t.freq] || ''}">${FREQ_LABEL[t.freq] || ''}</span>
        </div>
      </div>
      <span class="tc-pts">${done ? '✅' : starsText(t.pts)}</span>`;
    if (!done) d.onclick = () => showTaskDetail(t, saveStateFn, renderChildFn);
    body.appendChild(d);
  });
}

// -------- TASK DETAIL MODAL --------
function showTaskDetail(t, saveStateFn, renderChildFn) {
  closeModals();
  const body = makeModal(t.task);

  if (t.emojis || t.emoji) {
    const emojiDisplay = document.createElement('span');
    emojiDisplay.className = 'task-emoji-display';
    emojiDisplay.textContent = t.emojis || t.emoji;
    body.appendChild(emojiDisplay);
  }

  const desc = document.createElement('p');
  desc.className = 'td-desc';
  desc.textContent = t.desc || '';

  const meta = document.createElement('div');
  meta.className = 'td-meta';
  meta.innerHTML = `
    <span>${starsText(t.pts)}</span>
    <span>🔁 ${FREQ_LABEL[t.freq] || ''}</span>`;

  const btn = document.createElement('button');
  btn.className = 'done-btn';
  btn.textContent = '✅ בוצע!';
  btn.onclick = () => {
    completeTask(t, saveStateFn);
    closeModals();
    showToast({ pts: t.pts, color: state.childData?.color });
    renderChildFn();
  };

  body.append(desc, meta, btn);
}
