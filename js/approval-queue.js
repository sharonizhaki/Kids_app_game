// =========== approval-queue.js ===========
// תור אישורים בזמן אמת — משימות ופרסים ממתינים לאישור הורה

import { db } from './firebase.js';
import {
  collection, query, where, onSnapshot,
  doc, getDoc, updateDoc, setDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { showToast, showLoading, hideLoading } from './ui.js';
import { approvePrizeRequest, declinePrizeRequest } from './prizes.js';

let _familyId  = null;
let _taskItems  = [];
let _prizeItems = [];
let _unsubs     = [];

// =========== INIT ===========
export function initApprovalQueue(familyId) {
  _familyId = familyId;

  const taskUnsub = onSnapshot(
    query(
      collection(db, 'families', familyId, 'pendingApprovals'),
      where('status', '==', 'pending')
    ),
    snap => {
      _taskItems = snap.docs.map(d => ({ id: d.id, type: 'task', ...d.data() }));
      _renderQueue();
    },
    err => console.error('pendingApprovals listener:', err)
  );

  const prizeUnsub = onSnapshot(
    query(
      collection(db, 'families', familyId, 'prizeRequests'),
      where('status', '==', 'pending')
    ),
    snap => {
      _prizeItems = snap.docs.map(d => ({ id: d.id, type: 'prize', ...d.data() }));
      _renderQueue();
    },
    err => console.error('prizeRequests listener:', err)
  );

  _unsubs = [taskUnsub, prizeUnsub];
}

export function destroyApprovalQueue() {
  _unsubs.forEach(u => u());
  _unsubs = [];
}

// =========== RENDER ===========
function _renderQueue() {
  const section = document.getElementById('approval-queue');
  if (!section) return;

  const all = [..._taskItems, ..._prizeItems].sort((a, b) => {
    const ta = a.createdAt?.seconds || (a.ts ? a.ts / 1000 : 0);
    const tb = b.createdAt?.seconds || (b.ts ? b.ts / 1000 : 0);
    return ta - tb;
  });

  if (all.length === 0) {
    section.style.display = 'none';
    return;
  }

  section.style.display = 'block';

  const badge = document.getElementById('approval-count');
  if (badge) badge.textContent = all.length;

  const list = document.getElementById('approval-list');
  if (!list) return;

  list.innerHTML = all.map(item => _buildCard(item)).join('');

  list.querySelectorAll('.aq-btn-approve').forEach(btn =>
    btn.addEventListener('click', () => _handleApprove(btn.dataset.id, btn.dataset.type))
  );
  list.querySelectorAll('.aq-btn-reject').forEach(btn =>
    btn.addEventListener('click', () => _handleReject(btn.dataset.id, btn.dataset.type))
  );
  list.querySelectorAll('.aq-photo-thumb').forEach(img =>
    img.addEventListener('click', () => _openLightbox(img.src))
  );
}

// =========== CARD HTML ===========
function _buildCard(item) {
  const isTask     = item.type === 'task';
  const emoji      = isTask ? (item.emoji || '⭐') : (item.prizeEmoji || '🎁');
  const name       = isTask ? (item.task  || 'משימה') : (item.prizeName || 'פרס');
  const pts        = item.pts || 0;
  const childName  = item.childName  || '';
  const childEmoji = item.childEmoji || '👦';
  const photoUrl   = item.photoUrl   || '';

  const typeTag = isTask
    ? `<span class="aq-type-tag aq-type-task">✅ משימה</span>`
    : `<span class="aq-type-tag aq-type-prize">🎁 פרס</span>`;

  const starsStr = isTask
    ? '+' + ('⭐'.repeat(Math.min(pts, 5)) || '⭐')
    : '⭐ ' + pts;
  const ptsTag = isTask
    ? `<span class="aq-pts">${starsStr}</span>`
    : `<span class="aq-pts aq-pts-cost">${starsStr}</span>`;

  const photoThumb = photoUrl
    ? `<img class="aq-photo-thumb" src="${photoUrl}" alt="צפה בתמונה" title="לחץ להגדלה">`
    : '';

  return `
    <div class="aq-wrap" data-id="${item.id}" data-type="${item.type}">
      <div class="aq-card" data-id="${item.id}" data-type="${item.type}">
        <div class="aq-row-top">
          <span class="aq-child-emoji">${childEmoji}</span>
          <span class="aq-child-name">${childName}</span>
          ${typeTag}
        </div>
        <div class="aq-row-mid">
          <span class="aq-task-emoji">${emoji}</span>
          <span class="aq-task-name">${name}</span>
          ${ptsTag}
          ${photoThumb}
        </div>
        <div class="aq-actions">
          <button class="aq-btn aq-btn-reject" data-id="${item.id}" data-type="${item.type}">❌ ביטול</button>
          <button class="aq-btn aq-btn-approve" data-id="${item.id}" data-type="${item.type}">✅ אשר</button>
        </div>
      </div>
    </div>`;
}

// =========== PHOTO LIGHTBOX ===========
function _openLightbox(src) {
  const existing = document.getElementById('aq-lightbox');
  if (existing) existing.remove();

  const box = document.createElement('div');
  box.id = 'aq-lightbox';
  box.className = 'aq-lightbox';
  box.innerHTML = `
    <button class="aq-lightbox-close" id="aq-lightbox-close">✕</button>
    <img src="${src}" alt="תמונת משימה">
  `;
  document.body.appendChild(box);

  box.addEventListener('click', e => {
    if (e.target === box || e.target.id === 'aq-lightbox-close') box.remove();
  });
}

// =========== ACTIONS ===========
async function _handleApprove(id, type) {
  if (!_familyId) return;
  if (type === 'prize') {
    await approvePrizeRequest(_familyId, id);
  } else {
    await _approveTask(_familyId, id);
  }
}

async function _handleReject(id, type) {
  if (!_familyId) return;
  if (type === 'prize') {
    await declinePrizeRequest(_familyId, id);
  } else {
    await _rejectTask(_familyId, id);
  }
}

// =========== TASK APPROVE ===========
async function _approveTask(familyId, docId) {
  showLoading('מאשר משימה...');
  try {
    const approvalRef  = doc(db, 'families', familyId, 'pendingApprovals', docId);

    const approvalSnap = await getDoc(approvalRef);
    if (!approvalSnap.exists()) { hideLoading(); return; }

    const data     = approvalSnap.data();
    const pts      = data.pts || 0;
    const childRef = doc(db, 'families', familyId, 'children', data.childId);
    const realStateRef = doc(db, 'families', familyId, 'children', data.childId, 'state', 'current');

    const [childSnap, stateSnap] = await Promise.all([
      getDoc(childRef),
      getDoc(realStateRef),
    ]);

    const updates = [
      updateDoc(approvalRef, { status: 'approved', resolvedAt: serverTimestamp() })
    ];

    if (childSnap.exists()) {
      const cd = childSnap.data();
      updates.push(
        updateDoc(childRef, {
          pts:        (cd.pts        || 0) + pts,
          monthlyPts: (cd.monthlyPts || 0) + pts,
          wk:         (cd.wk         || 0) + pts,
          mk:         (cd.mk         || 0) + pts,
        })
      );
      updates.push(
        setDoc(
          doc(collection(db, 'families', familyId, 'children', data.childId, 'notifications')),
          {
            type:     'task_approved',
            taskId:   data.taskId  || '',
            taskName: data.task    || '',
            emoji:    data.emoji   || '⭐',
            pts,
            message:  `המשימה "${data.task}" אושרה! 🎉 קיבלת ${pts} כוכבים ⭐`,
            read:     false,
            createdAt: serverTimestamp(),
          }
        )
      );
    }

    // עדכון state/current של הילד — כמו _finalizeTask בצד הילד
    if (stateSnap.exists()) {
      const cs = stateSnap.data();

      const tsDate  = data.ts ? new Date(data.ts) : new Date();
      const dateKey = `${tsDate.getFullYear()}-${String(tsDate.getMonth()+1).padStart(2,'0')}-${String(tsDate.getDate()).padStart(2,'0')}`;

      const hist = Array.isArray(cs.hist) ? [...cs.hist] : [];
      hist.unshift({
        taskId: data.taskId || '',
        task:   data.task   || '',
        emoji:  data.emoji  || '⭐',
        pts,
        time:   data.time   || '',
        day:    data.day    || '',
        ts:     data.ts     || Date.now(),
      });
      if (hist.length > 50) hist.pop();

      const comp = cs.comp ? { ...cs.comp } : {};
      const taskKey = data.taskId || '';
      if (taskKey) {
        const c = comp[taskKey] || { wc: 0, d: '', count: 0, lastTs: 0 };
        comp[taskKey] = { wc: (c.wc||0)+1, d: dateKey, count: (c.count||0)+1, lastTs: Date.now() };
      }

      const dailyPts = cs.dailyPts ? { ...cs.dailyPts } : {};
      dailyPts[dateKey] = (dailyPts[dateKey] || 0) + pts;

      const pending = Array.isArray(cs.pending)
        ? cs.pending.map(p =>
            p.taskId === data.taskId && Math.abs((p.ts || 0) - (data.ts || 0)) < 10000
              ? { ...p, status: 'approved' }
              : p
          )
        : [];

      updates.push(updateDoc(realStateRef, {
        pts:      (cs.pts || 0) + pts,
        hist,
        comp,
        dailyPts,
        pending,
        lastActive: dateKey,
      }));
    }

    await Promise.all(updates);
    hideLoading();
    showToast(`✅ אושר! ${pts > 0 ? `+${pts} כוכבים לילד` : ''}`);
  } catch (e) {
    hideLoading();
    showToast('שגיאה באישור המשימה');
    console.error('_approveTask error:', e);
  }
}

// =========== TASK REJECT ===========
async function _rejectTask(familyId, docId) {
  showLoading('דוחה...');
  try {
    const approvalRef  = doc(db, 'families', familyId, 'pendingApprovals', docId);
    const approvalSnap = await getDoc(approvalRef);
    if (!approvalSnap.exists()) { hideLoading(); return; }

    const data     = approvalSnap.data();
    const stateRef = doc(db, 'families', familyId, 'children', data.childId, 'state', 'current');

    const ops = [
      updateDoc(approvalRef, { status: 'rejected', resolvedAt: serverTimestamp() }),
      setDoc(
        doc(collection(db, 'families', familyId, 'children', data.childId, 'notifications')),
        {
          type:     'task_rejected',
          taskId:   data.taskId || '',
          taskName: data.task   || '',
          emoji:    data.emoji  || '⭐',
          pts:      data.pts    || 0,
          message:  `המשימה "${data.task}" לא אושרה`,
          read:     false,
          createdAt: serverTimestamp(),
        }
      ),
    ];

    // עדכון מערך pending בצד הילד — הסרת "ממתין" כדי שהמשימה תחזור להיות פעילה
    const stateSnap = await getDoc(stateRef);
    if (stateSnap.exists()) {
      const cs = stateSnap.data();
      if (cs.pending?.length) {
        const updated = cs.pending.map(p =>
          p.taskId === data.taskId && Math.abs((p.ts || 0) - (data.ts || 0)) < 10000
            ? { ...p, status: 'rejected' }
            : p
        );
        ops.push(updateDoc(stateRef, { pending: updated }));
      }
    }

    await Promise.all(ops);
    hideLoading();
    showToast('המשימה לא אושרה');
  } catch (e) {
    hideLoading();
    showToast('שגיאה');
    console.error('_rejectTask error:', e);
  }
}
