import { db } from './firebase.js';

import { showScreen, showToast, showLoading, hideLoading, showConfirm } from './ui.js';
import { currentFamilyId, setCurrentFamilyId } from './auth.js';
import { loadChildren, childrenCache } from './family.js';
import {
  savePrize, loadPrizes, updatePrize, deletePrize, createQuickPrizes,
  loadPrizeRequests, countPendingRequests,
  approvePrizeRequest, declinePrizeRequest, reversePrizeRequest,
  renderPrizeEmojiGrid, renderPrizeAssignGrid, renderPrizeSuggestions,
  DECLINE_REASONS, startPrizeTour,
  setPrizeEmoji, setPrizePts, setPrizeChildren, resetPrizeState, getPrizeState
} from './prizes.js';

function getFamilyId() { return currentFamilyId; }
window.showScreen = showScreen;

// =========== STATE ===========
let editingPrize      = null; // הפרס שנערך כרגע
let epSelectedEmoji   = '';
let epSelectedPts     = 0;
let epAssignedChildren = [];
let currentReqFilter  = 'pending'; // pending | history
let pendingDeclineId  = null;      // request id ממתין לדחייה

// =========== BACK BUTTONS ===========
document.getElementById('btn-back-add-prize')?.addEventListener('click', () => {
  window.location.href = 'parent.html';
});
document.getElementById('btn-back-manage')?.addEventListener('click', () => {
  window.location.href = 'parent.html';
});
document.getElementById('btn-back-edit-prize')?.addEventListener('click', () => {
  showScreen('screen-manage-prizes');
  renderPrizesList();
});

// =========== QUICK PRIZES SECTION ===========
function quickBannerKey() { return `prizesQuickDismissed_${getFamilyId() || 'none'}`; }
function quickClickedKey() { return `prizesQuickClicked_${getFamilyId() || 'none'}`; }

function getQuickClicked() {
  try { return JSON.parse(localStorage.getItem(quickClickedKey()) || '[]'); } catch(e) { return []; }
}
function saveQuickClicked(cat) {
  const arr = getQuickClicked();
  if (!arr.includes(cat)) { arr.push(cat); localStorage.setItem(quickClickedKey(), JSON.stringify(arr)); }
}

function markQuickBtnDone(btn) {
  const labels = { treats: 'פינוקים', fun: 'פנאי', gifts: 'מתנות' };
  btn.style.background = 'rgba(22,163,74,0.10)';
  btn.style.borderColor = '#16A34A';
  btn.style.color = '#15803D';
  btn.textContent = `✅ ${labels[btn.dataset.cat] || ''}`;
  btn.style.cursor = 'default';
  btn.disabled = true;
}

function animateQuickAway() {
  const section = document.getElementById('prize-quick-section');
  if (!section || section.style.display === 'none') return;
  const h = section.offsetHeight;
  section.style.overflow = 'hidden';
  section.style.maxHeight = h + 'px';
  section.style.transition = 'transform 0.12s ease-out';
  section.style.transform = 'scale(1.03)';
  setTimeout(() => {
    section.style.transition = 'max-height 0.38s cubic-bezier(.4,0,.2,1),opacity 0.28s ease,transform 0.28s ease';
    section.style.maxHeight = '0';
    section.style.opacity = '0';
    section.style.transform = 'scale(0.88)';
    setTimeout(() => { section.style.display = 'none'; }, 400);
  }, 120);
}

function refreshQuickSection() {
  const section = document.getElementById('prize-quick-section');
  if (!section) return;
  if (localStorage.getItem(quickBannerKey()) === '1') { section.style.display = 'none'; return; }
  const clicked = getQuickClicked();
  document.querySelectorAll('.quick-prize-cat-btn').forEach(btn => {
    if (clicked.includes(btn.dataset.cat)) markQuickBtnDone(btn);
  });
}

async function handleQuickPrizes(triggerEl, category) {
  const fid = getFamilyId(); if (!fid) return;
  if (triggerEl) { triggerEl.disabled = true; triggerEl.style.opacity = '0.55'; }
  try {
    const ok = await createQuickPrizes(fid, category);
    if (ok && triggerEl) {
      saveQuickClicked(category);
      markQuickBtnDone(triggerEl);
      const allDone = [...document.querySelectorAll('.quick-prize-cat-btn')].every(b => b.disabled);
      if (allDone) {
        localStorage.setItem(quickBannerKey(), '1');
        setTimeout(animateQuickAway, 950);
      }
    }
  } finally {
    if (triggerEl && !triggerEl.textContent.includes('✅')) {
      triggerEl.disabled = false;
      triggerEl.style.opacity = '';
    }
  }
}

// =========== SUGGESTIONS ===========
function initPrizeSuggestions() {
  const btn  = document.getElementById('btn-prize-suggestions');
  const wrap = document.getElementById('prize-suggestions-wrap');
  if (!btn || !wrap) return;

  btn.addEventListener('click', () => {
    const isVisible = wrap.style.display !== 'none';
    wrap.style.display = isVisible ? 'none' : 'flex';
    if (!isVisible) {
      renderPrizeSuggestions(({ name, emoji, pts }) => {
        document.getElementById('prize-name-input').value = name;
        setPrizeEmoji(emoji);
        setPrizePts(pts);
        renderPrizeEmojiGrid('prize-emoji-grid', emoji, (e) => setPrizeEmoji(e));
        document.getElementById('prize-pts-input').value = pts;
        highlightShortcut('prize-pts-shortcut', pts);
        wrap.style.display = 'none';
      });
    }
  });
}

// =========== PTS SHORTCUTS ===========
function initPtsShortcuts(inputId, btnClass, onSelect) {
  document.getElementById(inputId)?.addEventListener('input', (e) => {
    const val = parseInt(e.target.value) || 0;
    onSelect(val);
    highlightShortcut(btnClass, val);
  });
  document.querySelectorAll(`.${btnClass}`).forEach(btn => {
    btn.addEventListener('click', () => {
      const val = parseInt(btn.dataset.val);
      document.getElementById(inputId).value = val;
      onSelect(val);
      highlightShortcut(btnClass, val);
    });
  });
}

function highlightShortcut(btnClass, val) {
  document.querySelectorAll(`.${btnClass}`).forEach(btn => {
    const isActive = parseInt(btn.dataset.val) === val;
    btn.style.background    = isActive ? '#FDE68A' : '#FEF3C7';
    btn.style.borderColor   = isActive ? '#F59E0B' : '#FDE68A';
    btn.style.color         = isActive ? '#78350F' : '#92400E';
    btn.style.fontWeight    = isActive ? '900' : '800';
  });
}

// =========== OPEN ADD PRIZE ===========
async function openAddPrize(familyId) {
  resetPrizeState();

  document.getElementById('prize-name-input').value  = '';
  document.getElementById('prize-desc-input').value  = '';
  document.getElementById('prize-pts-input').value   = '';
  document.getElementById('add-prize-error').textContent = '';
  document.getElementById('prize-suggestions-wrap').style.display = 'none';

  await loadChildren(familyId);

  if (childrenCache.length === 0) {
    showToast('יש להוסיף ילד תחילה');
    window.location.href = 'parent.html';
    return;
  }

  renderPrizeEmojiGrid('prize-emoji-grid', '', (e) => setPrizeEmoji(e));
  renderPrizeAssignGrid('prize-assign-grid', [], (children) => setPrizeChildren(children));

  refreshQuickSection();
  showScreen('screen-add-prize');

  // הפעל טיול אם לא נעשה עדיין
  setTimeout(async () => {
    try {
      const { getDoc, doc } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
      const { db } = await import('./firebase.js');
      const famDoc = await getDoc(doc(db, 'families', familyId));
      const tourDone = famDoc.exists() && famDoc.data().prizeTourDone;
      if (!tourDone) {
        startPrizeTour(familyId);
      } else {
        document.getElementById('prize-name-input').focus();
      }
    } catch(e) {
      document.getElementById('prize-name-input').focus();
    }
  }, 400);
}

// =========== SAVE PRIZE ===========
document.getElementById('btn-save-prize')?.addEventListener('click', async () => {
  const ok = await savePrize(getFamilyId());
  if (ok) window.location.href = 'parent.html';
});

// =========== PRIZES LIST (manage tab) ===========
async function renderPrizesList() {
  const list = document.getElementById('prizes-list');
  if (!list) return;
  list.innerHTML = '<div class="empty-state">טוען...</div>';

  const prizes = await loadPrizes(getFamilyId());
  await loadChildren(getFamilyId());

  if (prizes.length === 0) {
    list.innerHTML = `
      <div class="empty-state" style="padding:32px 0;">
        <div style="font-size:3rem;margin-bottom:12px;">🎁</div>
        <div style="font-weight:800;color:var(--text);margin-bottom:6px;">אין פרסים עדיין</div>
        <div style="font-size:0.82rem;color:var(--muted);">לחץ על הוסף פרס חדש להתחיל</div>
      </div>`;
    return;
  }

  list.innerHTML = prizes.map(prize => {
    const childNames = (prize.assignedChildren || [])
      .map(cid => childrenCache.find(c => c.id === cid)?.name || '')
      .filter(Boolean).join(' · ');
    const hiddenTag = prize.hidden
      ? '<span style="font-size:0.7rem;background:#FEF3C7;color:#92400E;padding:2px 7px;border-radius:8px;font-weight:800;">מוסתר</span>'
      : '';
    return `
      <div class="etask-item" data-prize-id="${prize.id}" style="cursor:pointer;">
        <div class="etask-emoji">${prize.emoji || '🎁'}</div>
        <div class="etask-info">
          <div class="etask-name">${prize.name}</div>
          <div class="etask-tags">
            <span class="etask-tag stars-tag">${prize.pts} ⭐</span>
            ${childNames ? `<span class="etask-tag child-tag">${childNames}</span>` : ''}
            ${hiddenTag}
          </div>
        </div>
        <div style="font-size:1.2rem;color:var(--muted);padding-right:4px;">←</div>
      </div>`;
  }).join('');

  list.querySelectorAll('.etask-item').forEach(el => {
    el.addEventListener('click', () => {
      const prizeId = el.dataset.prizeId;
      const prize = prizes.find(p => p.id === prizeId);
      if (prize) openEditPrize(prize);
    });
  });
}

// =========== OPEN EDIT PRIZE ===========
async function openEditPrize(prize) {
  editingPrize      = prize;
  epSelectedEmoji   = prize.emoji || '';
  epSelectedPts     = prize.pts   || 0;
  epAssignedChildren = prize.assignedChildren || [];

  document.getElementById('ep-name').value = prize.name || '';
  document.getElementById('ep-desc').value = prize.desc || '';
  document.getElementById('ep-pts').value  = prize.pts  || '';
  document.getElementById('ep-error').textContent = '';

  highlightShortcut('ep-pts-shortcut', prize.pts);

  await loadChildren(getFamilyId());
  renderPrizeEmojiGrid('ep-emoji-grid', epSelectedEmoji, (e) => { epSelectedEmoji = e; });
  renderPrizeAssignGrid('ep-assign-grid', epAssignedChildren, (children) => { epAssignedChildren = children; });

  // כפתור הסתר — טקסט דינמי
  document.getElementById('btn-ep-hide').textContent = prize.hidden ? '👁️ הצג' : '👁️ הסתר';

  showScreen('screen-edit-prize');
}

// =========== SAVE EDITED PRIZE ===========
document.getElementById('btn-ep-save')?.addEventListener('click', async () => {
  if (!editingPrize) return;
  const name = document.getElementById('ep-name').value.trim();
  const desc = document.getElementById('ep-desc').value.trim();
  const err  = document.getElementById('ep-error');

  if (!name) { err.textContent = 'חובה להכניס שם פרס'; return; }
  if (!epSelectedEmoji) { err.textContent = 'חובה לבחור אייקון'; return; }
  if (!epSelectedPts || epSelectedPts < 1) { err.textContent = 'חובה להזין מחיר'; return; }
  if (epAssignedChildren.length === 0) { err.textContent = 'חובה לשייך לפחות ילד אחד'; return; }
  err.textContent = '';

  showLoading('שומר...');
  const ok = await updatePrize(getFamilyId(), editingPrize.id, {
    name, emoji: epSelectedEmoji, pts: epSelectedPts,
    desc, assignedChildren: epAssignedChildren
  });
  hideLoading();
  if (ok) {
    showToast('פרס עודכן ✅');
    showScreen('screen-manage-prizes');
    renderPrizesList();
  }
});

// =========== HIDE / SHOW PRIZE ===========
document.getElementById('btn-ep-hide')?.addEventListener('click', async () => {
  if (!editingPrize) return;
  const newHidden = !editingPrize.hidden;
  showLoading(newHidden ? 'מסתיר...' : 'מציג...');
  const ok = await updatePrize(getFamilyId(), editingPrize.id, { hidden: newHidden });
  hideLoading();
  if (ok) {
    editingPrize.hidden = newHidden;
    document.getElementById('btn-ep-hide').textContent = newHidden ? '👁️ הצג' : '👁️ הסתר';
    showToast(newHidden ? 'פרס הוסתר' : 'פרס מוצג');
  }
});

// =========== DELETE PRIZE ===========
document.getElementById('btn-ep-delete')?.addEventListener('click', () => {
  if (!editingPrize) return;
  showConfirm('מחיקת פרס', `האם למחוק את הפרס "${editingPrize.name}"? הפעולה אינה הפיכה.`, async () => {
    const ok = await deletePrize(getFamilyId(), editingPrize.id);
    if (ok) {
      editingPrize = null;
      showScreen('screen-manage-prizes');
      renderPrizesList();
    }
  });
});

// =========== TABS ===========
function switchTab(tabName) {
  document.querySelectorAll('.manage-tab').forEach(btn => {
    const isActive = btn.dataset.tab === tabName;
    btn.style.background = isActive ? 'var(--primary)' : 'transparent';
    btn.style.color      = isActive ? 'white' : 'var(--muted)';
  });
  document.querySelectorAll('.tab-content').forEach(el => {
    el.style.display = 'none';
  });
  const activeTab = document.getElementById(`tab-${tabName}`);
  if (activeTab) activeTab.style.display = 'block';

  if (tabName === 'prizes')   renderPrizesList();
  if (tabName === 'requests') renderRequestsList();
  if (tabName === 'stats')    renderStats();
}

document.querySelectorAll('.manage-tab').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

// =========== REQUESTS LIST ===========
async function renderRequestsList() {
  const list = document.getElementById('requests-list');
  if (!list) return;
  list.innerHTML = '<div class="empty-state">טוען...</div>';

  await loadChildren(getFamilyId());
  const isPending = currentReqFilter === 'pending';
  const statuses  = isPending ? ['pending'] : ['approved', 'declined', 'reversed'];
  const all       = await loadPrizeRequests(getFamilyId());
  const filtered  = all.filter(r => statuses.includes(r.status));

  if (filtered.length === 0) {
    list.innerHTML = `
      <div class="empty-state" style="padding:32px 0;">
        <div style="font-size:3rem;margin-bottom:12px;">${isPending ? '✅' : '📜'}</div>
        <div style="font-weight:800;color:var(--text);">${isPending ? 'אין בקשות ממתינות' : 'אין היסטוריה'}</div>
      </div>`;
    return;
  }

  list.innerHTML = filtered.map(req => {
    const child = childrenCache.find(c => c.id === req.childId);
    const childName = child?.name || 'ילד לא ידוע';
    const date = req.requestedAt?.toDate
      ? req.requestedAt.toDate().toLocaleDateString('he-IL')
      : '';

    const statusTag = {
      pending:  '<span style="background:#FEF3C7;color:#92400E;font-size:0.7rem;font-weight:800;padding:2px 8px;border-radius:8px;">⏳ ממתין</span>',
      approved: '<span style="background:#D1FAE5;color:#065F46;font-size:0.7rem;font-weight:800;padding:2px 8px;border-radius:8px;">✅ אושר</span>',
      declined: '<span style="background:#FEE2E2;color:#991B1B;font-size:0.7rem;font-weight:800;padding:2px 8px;border-radius:8px;">❌ נדחה</span>',
      reversed: '<span style="background:#E0E7FF;color:#3730A3;font-size:0.7rem;font-weight:800;padding:2px 8px;border-radius:8px;">↩️ הוחזר</span>',
    }[req.status] || '';

    const actionBtns = req.status === 'pending' ? `
      <div style="display:flex;gap:8px;margin-top:10px;">
        <button class="btn-approve btn-sm btn" data-req-id="${req.id}"
          style="flex:1;padding:9px;font-size:0.82rem;background:linear-gradient(135deg,var(--success),#059669);color:white;border:none;border-radius:10px;font-weight:800;font-family:'Heebo',sans-serif;cursor:pointer;">
          ✅ אשר
        </button>
        <button class="btn-decline btn-sm btn" data-req-id="${req.id}" data-prize-name="${req.prizeName}"
          style="flex:1;padding:9px;font-size:0.82rem;background:linear-gradient(135deg,#EF4444,#DC2626);color:white;border:none;border-radius:10px;font-weight:800;font-family:'Heebo',sans-serif;cursor:pointer;">
          ❌ דחה
        </button>
      </div>` : '';

    const reverseBtn = req.status === 'approved' ? `
      <div style="margin-top:8px;">
        <button class="btn-reverse" data-req-id="${req.id}"
          style="width:100%;padding:8px;font-size:0.78rem;background:#E0E7FF;color:#3730A3;border:none;border-radius:10px;font-weight:800;font-family:'Heebo',sans-serif;cursor:pointer;">
          ↩️ החזר פרס
        </button>
      </div>` : '';

    const declineReasonHTML = req.status === 'declined' && req.declineReason
      ? `<div style="font-size:0.75rem;color:var(--muted);margin-top:4px;">סיבה: ${req.declineReason}</div>`
      : '';

    return `
      <div class="card" style="margin-bottom:10px;padding:14px 16px;">
        <div style="display:flex;align-items:center;gap:10px;">
          <div style="font-size:2rem;">${req.prizeEmoji || '🎁'}</div>
          <div style="flex:1;">
            <div style="font-weight:800;font-size:0.95rem;">${req.prizeName || 'פרס'}</div>
            <div style="font-size:0.78rem;color:var(--muted);">${childName} · ${req.pts} ⭐ · ${date}</div>
            ${declineReasonHTML}
          </div>
          ${statusTag}
        </div>
        ${actionBtns}
        ${reverseBtn}
      </div>`;
  }).join('');

  // אירועי approve
  list.querySelectorAll('.btn-approve').forEach(btn => {
    btn.addEventListener('click', async () => {
      const ok = await approvePrizeRequest(getFamilyId(), btn.dataset.reqId);
      if (ok) { renderRequestsList(); updateRequestsBadge(); }
    });
  });

  // אירועי decline — פותח modal
  list.querySelectorAll('.btn-decline').forEach(btn => {
    btn.addEventListener('click', () => {
      pendingDeclineId = btn.dataset.reqId;
      openDeclineModal();
    });
  });

  // אירועי reverse
  list.querySelectorAll('.btn-reverse').forEach(btn => {
    btn.addEventListener('click', async () => {
      showConfirm('החזרת פרס', 'הכוכבים יוחזרו לילד והפרס יסומן כלא מומש.', async () => {
        const ok = await reversePrizeRequest(getFamilyId(), btn.dataset.reqId);
        if (ok) renderRequestsList();
      });
    });
  });
}

// =========== REQ FILTER BUTTONS ===========
document.querySelectorAll('.req-filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    currentReqFilter = btn.dataset.filter;
    document.querySelectorAll('.req-filter-btn').forEach(b => {
      const isActive = b.dataset.filter === currentReqFilter;
      b.style.background   = isActive ? 'var(--primary)' : 'var(--card)';
      b.style.color        = isActive ? 'white' : 'var(--muted)';
      b.style.borderColor  = isActive ? 'var(--primary)' : 'var(--border)';
    });
    renderRequestsList();
  });
});

// =========== DECLINE MODAL ===========
function openDeclineModal() {
  const modal = document.getElementById('modal-decline');
  if (!modal) return;

  // בנה רשימת סיבות מובנות
  const reasonsList = document.getElementById('decline-reasons-list');
  let selectedReason = '';
  reasonsList.innerHTML = DECLINE_REASONS.map((r, i) =>
    `<button class="decline-reason-btn" data-reason="${r}"
      style="width:100%;text-align:right;padding:10px 14px;border:2px solid var(--border);border-radius:12px;
             background:var(--card);font-size:0.88rem;font-weight:700;font-family:'Heebo',sans-serif;cursor:pointer;
             transition:all 0.15s;color:var(--text);">
      ${r}
    </button>`
  ).join('');

  reasonsList.querySelectorAll('.decline-reason-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const wasSelected = btn.style.borderColor === 'var(--danger)' || btn.dataset.selected === '1';
      reasonsList.querySelectorAll('.decline-reason-btn').forEach(b => {
        b.style.borderColor = 'var(--border)';
        b.style.background  = 'var(--card)';
        b.dataset.selected  = '0';
      });
      if (!wasSelected) {
        btn.style.borderColor = '#EF4444';
        btn.style.background  = '#FEF2F2';
        btn.dataset.selected  = '1';
        selectedReason = btn.dataset.reason;
        document.getElementById('decline-custom-reason').value = '';
      } else {
        selectedReason = '';
      }
    });
  });

  document.getElementById('decline-custom-reason').value = '';
  modal.style.display = 'flex';
}

document.getElementById('btn-cancel-decline')?.addEventListener('click', () => {
  document.getElementById('modal-decline').style.display = 'none';
  pendingDeclineId = null;
});

document.getElementById('btn-confirm-decline')?.addEventListener('click', async () => {
  if (!pendingDeclineId) return;
  const customReason = document.getElementById('decline-custom-reason').value.trim();
  const selectedBtn  = document.querySelector('.decline-reason-btn[data-selected="1"]');
  const reason = customReason || selectedBtn?.dataset.reason || '';

  document.getElementById('modal-decline').style.display = 'none';
  const ok = await declinePrizeRequest(getFamilyId(), pendingDeclineId, reason);
  if (ok) {
    pendingDeclineId = null;
    renderRequestsList();
    updateRequestsBadge();
  }
});

// סגירת modal בלחיצה על רקע
document.getElementById('modal-decline')?.addEventListener('click', (e) => {
  if (e.target === document.getElementById('modal-decline')) {
    document.getElementById('modal-decline').style.display = 'none';
    pendingDeclineId = null;
  }
});

// =========== BADGE (בקשות ממתינות) ===========
async function updateRequestsBadge() {
  const badge = document.getElementById('requests-badge');
  if (!badge) return;
  const count = await countPendingRequests(getFamilyId());
  if (count > 0) {
    badge.textContent = count > 9 ? '9+' : count;
    badge.style.display = 'inline-block';
  } else {
    badge.style.display = 'none';
  }
}

// =========== STATS ===========
async function renderStats() {
  const container = document.getElementById('stats-content');
  if (!container) return;
  container.innerHTML = '<div class="empty-state">טוען...</div>';

  await loadChildren(getFamilyId());
  const allRequests = await loadPrizeRequests(getFamilyId());
  const approved    = allRequests.filter(r => r.status === 'approved' || r.status === 'reversed');

  if (approved.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="padding:32px 0;">
        <div style="font-size:3rem;margin-bottom:12px;">📊</div>
        <div style="font-weight:800;color:var(--text);">אין נתונים עדיין</div>
        <div style="font-size:0.82rem;color:var(--muted);margin-top:4px;">הנתונים יופיעו לאחר מימוש פרסים</div>
      </div>`;
    return;
  }

  // כוכבים שנגרעו סה"כ
  const totalPts = approved.reduce((sum, r) => sum + (r.pts || 0), 0);

  // הפרס הכי מבוקש
  const prizeCounts = {};
  approved.forEach(r => {
    const key = r.prizeName || 'לא ידוע';
    prizeCounts[key] = (prizeCounts[key] || 0) + 1;
  });
  const topPrize = Object.entries(prizeCounts).sort((a, b) => b[1] - a[1])[0];

  // סטטיסטיקה לפי ילד
  const byChild = {};
  approved.forEach(r => {
    const child = childrenCache.find(c => c.id === r.childId);
    const name = child?.name || 'לא ידוע';
    if (!byChild[name]) byChild[name] = { count: 0, pts: 0 };
    byChild[name].count++;
    byChild[name].pts += r.pts || 0;
  });

  container.innerHTML = `
    <!-- כרטיסי סיכום -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px;">
      <div class="card" style="text-align:center;padding:16px 12px;">
        <div style="font-size:1.8rem;font-weight:900;color:var(--primary);">${approved.length}</div>
        <div style="font-size:0.78rem;color:var(--muted);font-weight:700;">פרסים מומשו</div>
      </div>
      <div class="card" style="text-align:center;padding:16px 12px;">
        <div style="font-size:1.8rem;font-weight:900;color:#F59E0B;">${totalPts}</div>
        <div style="font-size:0.78rem;color:var(--muted);font-weight:700;">כוכבים שנגרעו ⭐</div>
      </div>
    </div>

    ${topPrize ? `
    <div class="card" style="margin-bottom:12px;padding:14px 16px;">
      <div style="font-size:0.78rem;font-weight:800;color:var(--muted);margin-bottom:6px;">🏆 הפרס הכי מבוקש</div>
      <div style="font-size:1rem;font-weight:900;">${topPrize[0]}</div>
      <div style="font-size:0.82rem;color:var(--muted);">מומש ${topPrize[1]} פעמים</div>
    </div>` : ''}

    <!-- לפי ילד -->
    <div class="card" style="padding:14px 16px;">
      <div style="font-size:0.78rem;font-weight:800;color:var(--muted);margin-bottom:10px;">👧👦 לפי ילד</div>
      ${Object.entries(byChild).map(([name, data]) => `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);">
          <div style="font-weight:800;font-size:0.9rem;">${name}</div>
          <div style="text-align:left;">
            <span style="font-size:0.82rem;color:var(--primary);font-weight:700;">${data.count} פרסים</span>
            <span style="font-size:0.78rem;color:var(--muted);margin-right:8px;">${data.pts} ⭐</span>
          </div>
        </div>`).join('')}
    </div>`;
}

// =========== ADD NEW PRIZE FROM MANAGE SCREEN ===========
document.getElementById('btn-add-new-prize')?.addEventListener('click', () => {
  openAddPrize(getFamilyId());
});

// =========== EDIT PRIZE — pts shortcuts ===========
document.getElementById('ep-pts')?.addEventListener('input', (e) => {
  epSelectedPts = parseInt(e.target.value) || 0;
  highlightShortcut('ep-pts-shortcut', epSelectedPts);
});
document.querySelectorAll('.ep-pts-shortcut').forEach(btn => {
  btn.addEventListener('click', () => {
    epSelectedPts = parseInt(btn.dataset.val);
    document.getElementById('ep-pts').value = epSelectedPts;
    highlightShortcut('ep-pts-shortcut', epSelectedPts);
  });
});

// =========== EXPORTED INIT (called by prizes.html after auth) ===========
export async function initPrizesPage(familyId) {
  setCurrentFamilyId(familyId);

  await loadChildren(familyId);
  hideLoading();

  // routing לפי prizesTab (localStorage) או ?mode (URL param)
  const prizesTab = localStorage.getItem('prizesTab');
  localStorage.removeItem('prizesTab');
  const params = new URLSearchParams(window.location.search);
  const mode = prizesTab || params.get('mode');

  if (mode === 'manage') {
    showScreen('screen-manage-prizes');
    switchTab('prizes');
    await updateRequestsBadge();
  } else {
    // ברירת מחדל: הוספת פרס
    await openAddPrize(familyId);
    initPrizeSuggestions();
    initPtsShortcuts('prize-pts-input', 'prize-pts-shortcut', (val) => setPrizePts(val));
    // quick prizes
    document.getElementById('btn-prize-quick-close')?.addEventListener('click', () => {
      localStorage.setItem(quickBannerKey(), '1');
      animateQuickAway();
    });
    document.querySelectorAll('.quick-prize-cat-btn').forEach(btn => {
      btn.addEventListener('click', function() { handleQuickPrizes(this, this.dataset.cat); });
    });
  }
}
