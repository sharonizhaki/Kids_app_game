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

  list.querySelectorAll('.aq-card').forEach(card => _attachSwipe(card));

  list.querySelectorAll('.aq-btn-approve').forEach(btn =>
    btn.addEventListener('click', () => _handleApprove(btn.dataset.id, btn.dataset.type))
  );
  list.querySelectorAll('.aq-btn-reject').forEach(btn =>
    btn.addEventListener('click', () => _handleReject(btn.dataset.id, btn.dataset.type))
  );
}

// =========== CARD HTML ===========
function _buildCard(item) {
  const isTask    = item.type === 'task';
  const emoji     = isTask ? (item.emoji || '⭐') : (item.prizeEmoji || '🎁');
  const name      = isTask ? (item.task  || 'משימה') : (item.prizeName || 'פרס');
  const pts       = item.pts || 0;
  const childName  = item.childName  || '';
  const childEmoji = item.childEmoji || '👦';

  const typeTag = isTask
    ? `<span class="aq-type-tag aq-type-task">✅ משימה</span>`
    : `<span class="aq-type-tag aq-type-prize">🎁 פרס</span>`;

  const ptsTag = isTask
    ? `<span class="aq-pts">+${pts} ⭐</span>`
    : `<span class="aq-pts aq-pts-cost">-${pts} ⭐</span>`;

  const swipeHint = `<span class="aq-swipe-hint">← החלק לביטול &nbsp;|&nbsp; אישור החלק →</span>`;

  return `
    <div class="aq-wrap" data-id="${item.id}" data-type="${item.type}">
      <div class="aq-bg aq-bg-approve"><span>✅</span><span style="font-size:0.85rem;font-weight:800;margin-right:6px;">אישור</span></div>
      <div class="aq-bg aq-bg-reject"><span style="font-size:0.85rem;font-weight:800;margin-left:6px;">ביטול</span><span>❌</span></div>
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
        </div>
        <div class="aq-row-hint">${swipeHint}</div>
        <div class="aq-actions">
          <button class="aq-btn aq-btn-reject" data-id="${item.id}" data-type="${item.type}">❌ ביטול</button>
          <button class="aq-btn aq-btn-approve" data-id="${item.id}" data-type="${item.type}">✅ אשר</button>
        </div>
      </div>
    </div>`;
}

// =========== SWIPE ===========
function _attachSwipe(card) {
  const wrap = card.closest('.aq-wrap');
  if (!wrap) return;

  const bgApprove = wrap.querySelector('.aq-bg-approve');
  const bgReject  = wrap.querySelector('.aq-bg-reject');
  const THRESHOLD = 85;

  let startX   = 0;
  let deltaX   = 0;
  let dragging = false;

  card.addEventListener('touchstart', e => {
    startX   = e.touches[0].clientX;
    deltaX   = 0;
    dragging = true;
    card.style.transition = 'none';
  }, { passive: true });

  card.addEventListener('touchmove', e => {
    if (!dragging) return;
    deltaX = e.touches[0].clientX - startX;
    card.style.transform = `translateX(${deltaX}px)`;

    if (deltaX > 0) {
      bgApprove.style.opacity = Math.min(1, deltaX / THRESHOLD);
      bgReject.style.opacity  = 0;
    } else {
      bgReject.style.opacity  = Math.min(1, -deltaX / THRESHOLD);
      bgApprove.style.opacity = 0;
    }
  }, { passive: true });

  card.addEventListener('touchend', () => {
    if (!dragging) return;
    dragging = false;

    const id   = card.dataset.id;
    const type = card.dataset.type;

    card.style.transition = 'transform 0.3s cubic-bezier(.25,.8,.25,1)';

    if (deltaX >= THRESHOLD) {
      card.style.transform = 'translateX(110%)';
      setTimeout(() => _handleApprove(id, type), 260);
    } else if (deltaX <= -THRESHOLD) {
      card.style.transform = 'translateX(-110%)';
      setTimeout(() => _handleReject(id, type), 260);
    } else {
      card.style.transform = 'translateX(0)';
      bgApprove.style.opacity = 0;
      bgReject.style.opacity  = 0;
    }
    deltaX = 0;
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
    const childSnap = await getDoc(childRef);

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

    const data = approvalSnap.data();

    await Promise.all([
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
      )
    ]);

    hideLoading();
    showToast('המשימה לא אושרה');
  } catch (e) {
    hideLoading();
    showToast('שגיאה');
    console.error('_rejectTask error:', e);
  }
}
