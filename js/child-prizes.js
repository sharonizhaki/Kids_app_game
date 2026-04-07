// =========== child-prizes.js ===========
// חנות פרסים לילד: טעינה, הצגה, שליחת בקשה, מעקב סטטוס.

import {
  collection, getDocs, addDoc, query, where, onSnapshot, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

import { state }                    from './child-state.js';
import { showConfirm, showToast }   from './child-ui.js';

let _db = null;

// -------- INIT --------
export function initPrizes(db) {
  _db = db;
  // listener חי על הבקשות של הילד
  const reqRef = query(
    collection(_db, 'families', state.familyId, 'prizeRequests'),
    where('childId', '==', state.childId),
  );
  onSnapshot(reqRef, () => renderPrizesScreen());
}

// -------- RENDER PRIZES SCREEN --------
export async function renderPrizesScreen() {
  if (!_db) return;

  // סה"כ מצטבר (שבועי + מצטבר)
  const totalPts = (state.childState?.monthlyPts || 0) + (state.childState?.pts || 0);
  const el = document.getElementById('prizes-stars-val');
  if (el) el.textContent = `${totalPts} ⭐`;

  // טען פרסים
  let prizes = [];
  try {
    const snap = await getDocs(collection(_db, 'families', state.familyId, 'prizes'));
    prizes = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(p => p.active !== false)
      .filter(p => !p.assignedChildren || p.assignedChildren.length === 0 || p.assignedChildren.includes(state.childId))
      .sort((a, b) => (a.cost || 0) - (b.cost || 0));
  } catch (e) { prizes = []; }

  // טען בקשות
  let requests = [];
  try {
    const reqSnap = await getDocs(
      query(collection(_db, 'families', state.familyId, 'prizeRequests'),
        where('childId', '==', state.childId)),
    );
    requests = reqSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) { requests = []; }

  const pendingByPrize = {};
  requests.forEach(r => { pendingByPrize[r.prizeId] = r; });

  // pending section
  const pendingRequests = requests.filter(r => r.status !== 'rejected' || _isRecent(r.resolvedAt));
  renderPendingSection(pendingRequests);

  // prizes grid
  const grid = document.getElementById('prizes-grid');
  if (!grid) return;

  if (prizes.length === 0) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;">
      עדיין לא הוגדרו פרסים 🎁<br><small>ההורים יגדירו בקרוב</small>
    </div>`;
    return;
  }

  grid.innerHTML = prizes.map(prize => {
    const canAfford  = totalPts >= (prize.cost || 0);
    const myRequest  = pendingByPrize[prize.id];
    const isPending  = myRequest?.status === 'pending';
    const isApproved = myRequest?.status === 'approved';

    const lockHTML = !canAfford ? `
      <div class="prize-lock-overlay">
        <span class="prize-lock-icon">🔒</span>
        <span class="prize-lock-needed">עוד ${(prize.cost || 0) - totalPts} ⭐</span>
      </div>` : '';

    const actionHTML = isApproved
      ? `<div class="prize-pending-tag">✅ אושר!</div>`
      : isPending
        ? `<div class="prize-pending-tag">⏳ ממתין לאישור</div>`
        : canAfford
          ? `<button class="prize-request-btn" data-prize-id="${prize.id}">אני רוצה! 🎁</button>`
          : '';

    return `
      <div class="prize-card${!canAfford ? ' prize-locked' : ''}" data-prize-id="${prize.id}">
        <span class="prize-emoji">${prize.emoji || '🎁'}</span>
        <span class="prize-title">${prize.title}</span>
        <span class="prize-cost">${prize.cost || 0} ⭐</span>
        ${actionHTML}
        ${lockHTML}
      </div>`;
  }).join('');

  grid.querySelectorAll('.prize-request-btn').forEach(btn => {
    const prizeId = btn.dataset.prizeId;
    const prize   = prizes.find(p => p.id === prizeId);
    btn.onclick = () => confirmPrizeRequest(prize);
  });

  // badge על nav
  const pendingCount = requests.filter(r => r.status === 'pending').length;
  const badge = document.getElementById('nav-badge-prizes');
  if (badge) {
    badge.textContent   = pendingCount || '';
    badge.style.display = pendingCount > 0 ? 'flex' : 'none';
  }
}

function renderPendingSection(requests) {
  const section = document.getElementById('prizes-pending-section');
  const list    = document.getElementById('prizes-pending-list');
  if (!section || !list) return;

  if (requests.length === 0) { section.style.display = 'none'; return; }
  section.style.display = 'block';

  const STATUS_LABEL = { pending: '⏳ ממתין לאישור', approved: '✅ אושר!', rejected: '❌ לא אושר' };
  const STATUS_CLS   = { pending: 'status-pending', approved: 'status-approved', rejected: 'status-rejected' };

  list.innerHTML = requests.map(r => `
    <div class="pending-req-card">
      <span class="pending-req-emoji">${r.prizeEmoji || '🎁'}</span>
      <div class="pending-req-info">
        <div class="pending-req-title">${r.prizeTitle}</div>
        <div class="pending-req-status">${r.cost || 0} ⭐</div>
      </div>
      <span class="pending-req-badge ${STATUS_CLS[r.status] || 'status-pending'}">
        ${STATUS_LABEL[r.status] || '⏳'}
      </span>
    </div>`).join('');
}

// -------- CONFIRM & SEND REQUEST --------
function confirmPrizeRequest(prize) {
  const totalPts = (state.childState?.monthlyPts || 0) + (state.childState?.pts || 0);
  showConfirm({
    icon:         prize.emoji || '🎁',
    title:        `לבקש: ${prize.title}?`,
    message:      `עולה ${prize.cost} ⭐ — יש לך ${totalPts} ⭐. ההורים יאשרו את הבקשה.`,
    confirmText:  'שלח בקשה! 🎁',
    confirmClass: 'confirm-btn-success',
    onConfirm:    () => sendPrizeRequest(prize),
  });
}

async function sendPrizeRequest(prize) {
  try {
    await addDoc(collection(_db, 'families', state.familyId, 'prizeRequests'), {
      prizeId:    prize.id,
      prizeTitle: prize.title,
      prizeEmoji: prize.emoji || '🎁',
      cost:       prize.cost || 0,
      childId:    state.childId,
      childName:  state.childData?.name || '',
      status:     'pending',
      createdAt:  serverTimestamp(),
      resolvedAt: null,
    });
    showToast({ message: 'הבקשה נשלחה! ⏳', color: state.childData?.color });
    renderPrizesScreen();
  } catch (e) {
    console.error('sendPrizeRequest error:', e);
  }
}

// -------- HELPERS --------
function _isRecent(ts) {
  if (!ts) return false;
  const ms = ts?.toMillis ? ts.toMillis() : ts;
  return Date.now() - ms < 3 * 24 * 60 * 60 * 1000;
}
