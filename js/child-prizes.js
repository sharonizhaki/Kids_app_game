// =========== child-prizes.js ===========
// חנות פרסים לילד: טעינה, הצגה, שליחת בקשה, מעקב סטטוס.

import {
  collection, getDocs, addDoc, query, where, onSnapshot, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

import { state }                    from './child-state.js';
import { showToast }                from './child-ui.js';

let _db = null;

// -------- PRIZE CAROUSEL --------
let _carouselPrizes  = [];
let _carouselIndex   = 0;
let _carouselTimer   = null;
let _totalPtsCache   = 0;

function startPrizeCarousel(prizes, totalPts) {
  _carouselPrizes = prizes;
  _totalPtsCache  = totalPts;
  _carouselIndex  = 0;

  // ניקוי טיימר קודם
  if (_carouselTimer) clearInterval(_carouselTimer);

  _renderCarouselDots();
  _showCarouselPrize(_carouselIndex);

  if (prizes.length > 1) {
    _carouselTimer = setInterval(() => {
      _carouselIndex = (_carouselIndex + 1) % _carouselPrizes.length;
      _animateCarousel(_carouselIndex);
    }, 2000);
  }
}

function _renderCarouselDots() {
  const dotsEl = document.getElementById('ppcard-dots');
  if (!dotsEl) return;
  dotsEl.innerHTML = _carouselPrizes.map((_, i) =>
    `<span class="ppcard-dot${i === 0 ? ' active' : ''}"></span>`
  ).join('');
}

function _animateCarousel(idx) {
  const row = document.getElementById('ppcard-prize-row');
  if (!row) return;

  row.classList.add('fade-out');
  setTimeout(() => {
    _showCarouselPrize(idx);
    row.classList.remove('fade-out');
  }, 220);
}

function _showCarouselPrize(idx) {
  const prize   = _carouselPrizes[idx];
  const missing = Math.max(0, (prize.cost || 0) - _totalPtsCache);
  const pct     = Math.min(100, Math.round((_totalPtsCache / (prize.cost || 1)) * 100));

  const emojiEl     = document.getElementById('ppcard-emoji');
  const nameEl      = document.getElementById('ppcard-name');
  const remainEl    = document.getElementById('ppcard-remaining');
  const fillEl      = document.getElementById('ppcard-bar-fill');
  const labelEl     = document.getElementById('ppcard-bar-label');

  if (emojiEl)  emojiEl.textContent  = prize.emoji || '🎁';
  if (nameEl)   nameEl.textContent   = prize.title || '';
  if (remainEl) remainEl.textContent = missing > 0 ? `עוד ${missing} ⭐ להשגה` : '✅ אפשר לבקש!';
  if (fillEl)   fillEl.style.width   = `${pct}%`;
  if (labelEl)  labelEl.textContent  = `${_totalPtsCache}/${prize.cost || 0} ⭐`;

  // עדכון נקודות
  const dots = document.querySelectorAll('.ppcard-dot');
  dots.forEach((d, i) => d.classList.toggle('active', i === idx));
}

// -------- RENDER HOME PRIZE CARD --------
export async function renderHomePrizeCard(db, familyId, childId, totalPts) {
  if (!db) return;
  try {
    const snap = await getDocs(collection(db, 'families', familyId, 'prizes'));
    const prizes = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(p => p.active !== false)
      .filter(p => !p.assignedChildren || p.assignedChildren.length === 0 || p.assignedChildren.includes(childId))
      .sort((a, b) => (a.cost || 0) - (b.cost || 0));

    if (prizes.length === 0) {
      const nameEl = document.getElementById('ppcard-name');
      if (nameEl) nameEl.textContent = 'ממתין שההורים יצרו מתנות';
      const dotsEl = document.getElementById('ppcard-dots');
      if (dotsEl) dotsEl.innerHTML = '';
      return;
    }

    startPrizeCarousel(prizes, totalPts);
  } catch(e) {
    console.error('renderHomePrizeCard error:', e);
  }
}
  _db = db;
  const reqRef = query(
    collection(_db, 'families', state.familyId, 'prizeRequests'),
    where('childId', '==', state.childId),
  );
  onSnapshot(reqRef, () => renderPrizesScreen());
}

// -------- RENDER PRIZES SCREEN --------
export async function renderPrizesScreen() {
  if (!_db) return;

  const totalPts = (state.childState?.monthlyPts || 0) + (state.childState?.pts || 0);
  const el = document.getElementById('prizes-stars-val');
  if (el) el.textContent = `${totalPts} ⭐`;

  // טען פרסים — ממוינים מהזול ליקר
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
    const missing    = (prize.cost || 0) - totalPts;
    const pct        = canAfford ? 100 : Math.round((totalPts / (prize.cost || 1)) * 100);

    // כרטיס נעול — overlay כהה + progress bar
    const lockHTML = !canAfford ? `
      <div class="prize-lock-overlay">
        <span class="prize-lock-icon">🔒</span>
        <span class="prize-lock-needed">עוד ${missing} ⭐</span>
        <div class="prize-lock-bar-wrap">
          <div class="prize-lock-bar">
            <div class="prize-lock-bar-fill" style="width:${pct}%"></div>
          </div>
        </div>
      </div>` : '';

    // כפתור / סטטוס
    let actionHTML = '';
    if (isApproved) {
      actionHTML = `<div class="prize-status-tag prize-status-approved">✅ אושר!</div>`;
    } else if (isPending) {
      actionHTML = `
        <button class="prize-request-btn prize-btn-pending" disabled>אני רוצה! 🎁</button>
        <div class="prize-status-tag prize-status-pending">⏳ ממתין לאישור הורה</div>`;
    } else if (canAfford) {
      actionHTML = `<button class="prize-request-btn" data-prize-id="${prize.id}">אני רוצה! 🎁</button>`;
    }

    return `
      <div class="prize-card${!canAfford ? ' prize-locked' : ''}" data-prize-id="${prize.id}">
        <span class="prize-emoji">${prize.emoji || '🎁'}</span>
        <span class="prize-title">${prize.title}</span>
        <span class="prize-cost">${prize.cost || 0} ⭐</span>
        ${actionHTML}
        ${lockHTML}
      </div>`;
  }).join('');

  grid.querySelectorAll('.prize-request-btn:not([disabled])').forEach(btn => {
    const prizeId = btn.dataset.prizeId;
    const prize   = prizes.find(p => p.id === prizeId);
    btn.onclick = () => showPrizeConfirmModal(prize, totalPts);
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

// -------- PRIZE CONFIRM MODAL (מותאם) --------
function showPrizeConfirmModal(prize, totalPts) {
  const ov = document.createElement('div');
  ov.className = 'modal-overlay';

  const descHTML = prize.desc
    ? `<div style="font-size:0.88rem;color:#64748B;line-height:1.6;margin-bottom:6px;background:#F8FAFC;border-radius:12px;padding:10px 14px;text-align:right;">${prize.desc}</div>`
    : '';

  ov.innerHTML = `
    <div style="background:#fff;border-radius:24px;width:88%;max-width:380px;animation:modalPop 0.25s cubic-bezier(.4,0,.2,1);">
      <div style="width:44px;height:5px;background:#E2E8F0;border-radius:3px;margin:14px auto 0;"></div>
      <div style="padding:24px 24px 28px;">
        <div style="font-size:2.8rem;text-align:center;margin-bottom:10px;">${prize.emoji || '🎁'}</div>
        <div style="font-size:1.05rem;font-weight:800;margin-bottom:8px;color:#1E293B;text-align:center;">${prize.title}</div>
        ${descHTML}
        <div style="font-size:0.85rem;color:#94A3B8;font-weight:600;text-align:center;margin-bottom:20px;">
          עולה ${prize.cost} ⭐ — יש לך ${totalPts} ⭐
        </div>
        <div style="display:flex;gap:10px;flex-direction:row-reverse;">
          <button id="prize-confirm-send" style="flex:1;padding:14px;background:linear-gradient(135deg,#6366F1,#818CF8);color:white;border:none;border-radius:14px;font-size:1rem;font-weight:800;cursor:pointer;font-family:'Heebo',sans-serif;box-shadow:0 4px 14px rgba(99,102,241,0.3);">שלח בקשה 🎁</button>
          <button id="prize-confirm-cancel" style="flex:1;padding:14px;background:#F1F5F9;color:#1E293B;border:none;border-radius:14px;font-size:1rem;font-weight:700;cursor:pointer;font-family:'Heebo',sans-serif;">ביטול</button>
        </div>
      </div>
    </div>`;

  ov.onclick = e => { if (e.target === ov) ov.remove(); };
  ov.querySelector('#prize-confirm-cancel').onclick = () => ov.remove();
  ov.querySelector('#prize-confirm-send').onclick = () => {
    ov.remove();
    sendPrizeRequest(prize);
  };

  document.body.appendChild(ov);
}

// -------- SEND REQUEST --------
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
