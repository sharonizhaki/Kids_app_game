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

    return `
      <button class="cat-btn${allDone ? ' cat-btn-done' : ''}" data-cat="${cat}">
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

// -------- SWIPE HELPER --------
// מחבר סווייפ שמאלה (≥80px) ל-task card — פותח מודל פרטים
function attachSwipe(cardEl, onSwipe) {
  let startX = 0;
  let startY = 0;
  let dragging = false;
  const THRESHOLD = 80; // px לסווייפ
  const MAX_VERTICAL = 30; // px מקסימום אנכי לפני ביטול

  cardEl.addEventListener('touchstart', (e) => {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    dragging = true;
  }, { passive: true });

  cardEl.addEventListener('touchmove', (e) => {
    if (!dragging) return;
    const dx = startX - e.touches[0].clientX; // חיובי = שמאלה (RTL: פעולה)
    const dy = Math.abs(e.touches[0].clientY - startY);

    // אם גלילה אנכית — מבטל
    if (dy > MAX_VERTICAL) { dragging = false; cardEl.style.transform = ''; cardEl.classList.remove('swiping','swipe-ready'); return; }

    if (dx > 0) {
      cardEl.classList.add('swiping');
      const clamped = Math.min(dx, THRESHOLD * 1.2);
      cardEl.style.transform = `translateX(-${clamped}px)`;
      if (dx >= THRESHOLD) {
        cardEl.classList.add('swipe-ready');
      } else {
        cardEl.classList.remove('swipe-ready');
      }
    }
  }, { passive: true });

  const onEnd = (e) => {
    if (!dragging) return;
    dragging = false;
    const dx = startX - (e.changedTouches?.[0]?.clientX ?? startX);
    // animate back
    cardEl.classList.remove('swiping');
    cardEl.style.transform = '';
    cardEl.classList.remove('swipe-ready');

    if (dx >= THRESHOLD) {
      onSwipe();
    }
  };

  cardEl.addEventListener('touchend',    onEnd, { passive: true });
  cardEl.addEventListener('touchcancel', onEnd, { passive: true });
}

// -------- CATEGORY MODAL --------
function showCatModal(cat, saveStateFn, renderChildFn) {
  const tasks = state.tasksData.filter(t => (t.cat || 'כללי') === cat && !t.hidden);
  const body  = makeModal(`${tasks[0]?.catIcon || '📋'} ${cat}`);

  tasks.forEach(t => {
    const done    = isDone(t);
    const pending = !done && isPending(t);

    // wrapper — רקע צבעוני + clipping לסווייפ
    const wrap = document.createElement('div');
    wrap.className = 'task-card-wrap';

    // שכבת reveal מתחת (נראית בסווייפ)
    const reveal = document.createElement('div');
    reveal.className = 'task-card-reveal';
    reveal.innerHTML = done ? '' : pending ? '' : '👈 החלק לפרטים';
    wrap.appendChild(reveal);

    // הכרטיס עצמו
    const d = document.createElement('div');
    d.className = `task-card${done ? ' done' : pending ? ' task-pending' : ''}`;
    d.innerHTML = `
      <div class="tc-left">
        <span class="tc-emoji">${t.emoji || '⭐'}</span>
        <div class="tc-info">
          <strong>${t.task}</strong>
          <span class="freq-tag ${FREQ_CLS[t.freq] || ''}">${FREQ_LABEL[t.freq] || ''}</span>
          ${t.requireApproval ? '<span class="approval-tag">👁️ דורש אישור</span>' : ''}
        </div>
      </div>
      <span class="tc-pts">${done ? '✅' : pending ? '⏳' : starsText(t.pts)}</span>
      ${!done && !pending ? '<span class="task-card-hint">←</span>' : ''}`;

    // סווייפ — רק לכרטיסים פעילים
    if (!done && !pending) {
      attachSwipe(d, () => {
        showTaskDetail(t, saveStateFn, renderChildFn);
      });
    }

    wrap.appendChild(d);
    body.appendChild(wrap);
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
  desc.className   = 'td-desc';
  desc.textContent = t.desc || '';

  const meta = document.createElement('div');
  meta.className = 'td-meta';
  meta.innerHTML = `
    <span>${starsText(t.pts)}</span>
    <span>🔁 ${FREQ_LABEL[t.freq] || ''}</span>
    ${t.requireApproval ? '<span class="approval-meta-tag">👁️ דורש אישור הורה</span>' : ''}`;

  const btn = document.createElement('button');
  btn.className   = 'done-btn';
  btn.textContent = t.requireApproval ? '📤 שלח לאישור הורה' : '✅ בוצע!';
  btn.onclick = () => {
    completeTask(t, saveStateFn);
    closeModals();
    if (t.requireApproval) {
      showToast({ message: 'נשלח לאישור הורה! ⏳', color: state.childData?.color });
    } else {
      showToast({ pts: t.pts, color: state.childData?.color });
    }
    renderChildFn();
  };

  body.append(desc, meta, btn);
}
