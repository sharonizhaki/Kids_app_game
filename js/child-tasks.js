// =========== child-tasks.js ===========
// לוגיקת משימות: isDone, completeTask (עם pending), render קטגוריות, היסטוריה, modals.

import {
  collection, addDoc, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import {
  ref, uploadString, getDownloadURL,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js';

import { state }                                    from './child-state.js';
import { storage }                                   from './firebase.js';
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
export function completeTask(t, saveStateFn, photoUrl = '') {
  if (t.requireApproval) {
    _submitPending(t, saveStateFn, photoUrl);
  } else {
    _finalizeTask(t, saveStateFn, photoUrl);
  }
}

// -------- FINALIZE --------
export function _finalizeTask(t, saveStateFn, photoUrl = '') {
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
    ...(photoUrl ? { photoUrl } : {}),
  });
  if (cs.hist.length > 50) cs.hist.pop();

  saveStateFn();
}

// -------- SUBMIT PENDING --------
async function _submitPending(t, saveStateFn, photoUrl = '') {
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
    ...(photoUrl ? { photoUrl } : {}),
  });
  saveStateFn();

  if (_db && state.familyId && state.childId) {
    try {
      let storedPhotoUrl = '';
      if (photoUrl && storage) {
        try {
          const photoRef = ref(storage, `pendingPhotos/${state.familyId}/${ts}.jpg`);
          await uploadString(photoRef, photoUrl, 'data_url');
          storedPhotoUrl = await getDownloadURL(photoRef);
        } catch (uploadErr) {
          console.warn('photo upload failed, continuing without photo:', uploadErr);
        }
      }
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
          ...(storedPhotoUrl ? { photoUrl: storedPhotoUrl } : {}),
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
  const active  = pending.filter(p => p.status === 'pending');

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
        עדיין לא הוגדרו משימות 📋
        <br><small style="color:var(--muted);">ההורים צריכים להוסיף משימות</small>
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
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:2px;">
          <span class="freq-tag ${freqCls}">${FREQ_LABEL[t.freq] || ''}</span>
          ${t.pts ? `<span style="font-size:0.72rem;font-weight:800;color:#F59E0B;background:#FFFBEB;border:1px solid #FDE68A;border-radius:20px;padding:1px 7px;">⭐ ${t.pts}</span>` : ''}
        </div>
        ${t.desc ? `<span class="task-row-note">📝 ${t.desc}</span>` : ''}
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
      btnPhoto.innerHTML = `📸 צלם<span class="photo-req-label">חובת צילום</span>`;
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
      btnPhoto.onclick = () => _handleComplete(t, true, saveStateFn, renderChildFn, ov);

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

// -------- ENCOURAGEMENT MESSAGES --------
const ENCOURAGE = [
  { msg: 'כל הכבוד! אלוף אמיתי!', icon: '🏆' },
  { msg: 'מדהים! המשך כך!', icon: '🌟' },
  { msg: 'וואו, עשית את זה!', icon: '🔥' },
  { msg: 'ענק! אתה סופר-גיבור!', icon: '🦸' },
  { msg: 'יש! אתה הכי טוב!', icon: '💪' },
  { msg: 'בום! משימה הושלמה!', icon: '🎉' },
  { msg: 'אחלה עבודה, מלך!', icon: '👑' },
  { msg: 'פנטסטי! אין עליך!', icon: '✨' },
];

function getEncourage() {
  return ENCOURAGE[Math.floor(Math.random() * ENCOURAGE.length)];
}

// -------- FLYING STAR ANIMATION --------
function flyStarToCounter(pts) {
  const counterEl = document.getElementById('cpc-total-val');
  if (!counterEl) return;

  const targetRect = counterEl.getBoundingClientRect();
  const targetX    = targetRect.left + targetRect.width / 2;
  const targetY    = targetRect.top  + targetRect.height / 2;

  // נקודת מוצא — מרכז המסך (איפה שהמודאל היה)
  const startX = window.innerWidth  / 2;
  const startY = window.innerHeight / 2;

  const star = document.createElement('div');
  star.className = 'flying-star';
  star.textContent = '⭐';
  star.style.cssText = `
    position: fixed;
    left: ${startX}px;
    top: ${startY}px;
    font-size: 2rem;
    z-index: 9999;
    pointer-events: none;
    transform: translate(-50%, -50%);
    transition: none;
  `;
  document.body.appendChild(star);

  // force reflow
  star.getBoundingClientRect();

  star.style.transition = 'left 0.7s cubic-bezier(.4,0,.2,1), top 0.7s cubic-bezier(.4,0,.2,1), opacity 0.3s ease 0.5s, font-size 0.7s ease';
  star.style.left       = `${targetX}px`;
  star.style.top        = `${targetY}px`;
  star.style.fontSize   = '0.8rem';
  star.style.opacity    = '0';

  setTimeout(() => {
    star.remove();
    // flash על מספר הכוכבים
    counterEl.style.transition = 'transform 0.2s cubic-bezier(.34,1.5,.64,1)';
    counterEl.style.transform  = 'scale(1.4)';
    setTimeout(() => { counterEl.style.transform = 'scale(1)'; }, 220);
  }, 750);
}

// -------- TASK SUCCESS POPUP --------
function showApprovalSentPopup(withPhoto) {
  document.querySelectorAll('.task-approval-popup').forEach(el => el.remove());

  const popup = document.createElement('div');
  popup.className = 'task-approval-popup';
  popup.innerHTML = `
    <div class="tap-icon">${withPhoto ? '📸' : '⏳'}</div>
    <div class="tap-title">${withPhoto ? 'תמונה נשלחה!' : 'נשלח לאישור!'}</div>
    <div class="tap-sub">ממתין לאישור הורה</div>
  `;
  document.body.appendChild(popup);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => { popup.classList.add('tap-show'); });
  });

  setTimeout(() => {
    popup.classList.remove('tap-show');
    setTimeout(() => popup.remove(), 350);
  }, 2200);
}

export function showTaskSuccessPopup(pts) {
  const enc = getEncourage();

  // הסר popup קודם אם יש
  document.querySelectorAll('.task-success-popup').forEach(el => el.remove());

  const popup = document.createElement('div');
  popup.className = 'task-success-popup';
  popup.innerHTML = `
    <div class="tsp-icon">${enc.icon}</div>
    <div class="tsp-msg">${enc.msg}</div>
    <div class="tsp-pts">+${pts} ⭐</div>
  `;
  document.body.appendChild(popup);

  // אנימציה
  requestAnimationFrame(() => {
    requestAnimationFrame(() => { popup.classList.add('tsp-show'); });
  });

  setTimeout(() => {
    popup.classList.remove('tsp-show');
    setTimeout(() => popup.remove(), 350);
  }, 1800);

  // כוכב עף
  flyStarToCounter(pts);
}

// -------- PHOTO PREVIEW MODAL --------
function _showPhotoPreview(photoUrl, onSend, onRetake, onCancel) {
  const prev = document.getElementById('_photo-preview-modal');
  if (prev) prev.remove();

  const modal = document.createElement('div');
  modal.id = '_photo-preview-modal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.82);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px;gap:16px;';
  modal.innerHTML = `
    <img src="${photoUrl}" style="max-width:100%;max-height:55vh;border-radius:16px;object-fit:contain;box-shadow:0 8px 32px rgba(0,0,0,0.5);">
    <div style="display:flex;gap:12px;width:100%;max-width:340px;">
      <button id="_ph-retake" style="flex:1;padding:13px 0;border-radius:14px;border:2px solid #A78BFA;background:#1E1B4B;color:#C4B5FD;font-size:0.95rem;font-weight:800;font-family:'Heebo',sans-serif;cursor:pointer;">🔄 צלם שוב</button>
      <button id="_ph-send"   style="flex:2;padding:13px 0;border-radius:14px;border:none;background:linear-gradient(135deg,#7C3AED,#5B21B6);color:white;font-size:0.95rem;font-weight:900;font-family:'Heebo',sans-serif;cursor:pointer;box-shadow:0 4px 16px rgba(124,58,237,0.45);">שלח ✓</button>
    </div>
    <button id="_ph-cancel" style="background:none;border:none;color:#94A3B8;font-size:0.85rem;font-family:'Heebo',sans-serif;cursor:pointer;padding:4px 12px;">ביטול</button>
  `;
  document.body.appendChild(modal);
  modal.querySelector('#_ph-send').onclick   = () => { modal.remove(); onSend(); };
  modal.querySelector('#_ph-retake').onclick = () => { modal.remove(); onRetake(); };
  modal.querySelector('#_ph-cancel').onclick = () => { modal.remove(); onCancel(); };
}

// -------- HANDLE COMPLETE --------
function _handleComplete(t, withPhoto, saveStateFn, renderChildFn, ov) {
  if (withPhoto) {
    _openCamera(t, saveStateFn, renderChildFn, ov);
    return;
  }
  completeTask(t, saveStateFn);
  ov.remove();
  if (t.requireApproval) {
    showApprovalSentPopup(false);
  } else {
    showTaskSuccessPopup(t.pts);
  }
  renderChildFn();
}

function _openCamera(t, saveStateFn, renderChildFn, ov) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.capture = 'environment';
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    const photoUrl = await _compressPhoto(file);
    _showPhotoPreview(
      photoUrl,
      () => {
        completeTask(t, saveStateFn, photoUrl);
        ov.remove();
        if (t.requireApproval) showApprovalSentPopup(true);
        else showTaskSuccessPopup(t.pts);
        renderChildFn();
      },
      () => _openCamera(t, saveStateFn, renderChildFn, ov),
      () => {}
    );
  };
  input.click();
}
// -------- COMPRESS PHOTO --------
function _compressPhoto(file) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const MAX = 800;
        let w = img.width, h = img.height;
        if (w > MAX) { h = Math.round(h * MAX / w); w = MAX; }
        if (h > MAX) { w = Math.round(w * MAX / h); h = MAX; }
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL('image/jpeg', 0.72));
      };
      img.onerror = () => resolve('');
      img.src = e.target.result;
    };
    reader.onerror = () => resolve('');
    reader.readAsDataURL(file);
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
