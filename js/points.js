// =========== points.js ===========
import { db } from './firebase.js';
import {
  doc, getDoc, getDocs, updateDoc, addDoc, collection, onSnapshot, query, orderBy, where,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { showToast, showLoading, hideLoading, showConfirm } from './ui.js';
import { childrenCache, loadChildren } from './family.js';
import { FREQ_LABELS } from './tasks.js';
import { loadPrizeRequests, approvePrizeRequest, declinePrizeRequest, reversePrizeRequest } from './prizes.js';
import { animatePlaceholder } from './placeholder-anim.js';

const MANUAL_REASON_PHRASES = [
  'עזרה ספונטנית בבישול', 'יום הולדת', 'התנהגות יפה', 'עזרה לאח/אחות',
];

// =========== STATE ===========
let allCompletedTasks  = [];
let allPendingApprovals = [];
let allPrizeRequests   = [];
let allRejectedItems   = [];
let allCancelledTasks  = [];
let _unifiedItems      = [];
let allManualPtsEvents = [];
let mpFilter    = 'all';
let mpSubFilter = '';
let mpTab       = 'pending';
let _familyId   = '';

// =========== SET STATE (from URL params) ===========
export function setMPState(tab, filter, subFilter) {
  if (tab)                   mpTab       = tab;
  if (filter)                mpFilter    = filter;
  if (subFilter !== undefined) mpSubFilter = subFilter;
}

// =========== RESET ===========
export function resetMPState() {
  mpFilter    = 'all';
  mpSubFilter = '';
  mpTab       = 'pending';
}

// =========== TABS ===========
export function renderMPTabs(familyId) {
  if (familyId) _familyId = familyId;
  const tabsEl = document.getElementById('mp-tabs');
  if (!tabsEl) return;

  const pendingTaskCount  = allPendingApprovals.filter(p => p.status === 'pending').length;
  const pendingPrizeCount = allPrizeRequests.filter(r => r.status === 'pending').length;
  const totalPending = pendingTaskCount + pendingPrizeCount;

  const tabs = [
    { key: 'history',  label: '📋 היסטוריה', badge: 0 },
    { key: 'pending',  label: '⏳ ממתינים', badge: totalPending },
    { key: 'manual',   label: '✏️ ניקוד',    badge: 0 },
  ];

  tabsEl.innerHTML = tabs.map(t => `
    <button class="mp-tab${mpTab === t.key ? ' active' : ''}" data-tab="${t.key}"
      style="flex:1;padding:9px 4px;font-size:0.82rem;font-weight:800;font-family:'Heebo',sans-serif;border:none;border-radius:10px;cursor:pointer;transition:all 0.2s;position:relative;">
      ${t.label}
      ${t.badge > 0 ? `<span style="position:absolute;top:4px;left:6px;min-width:18px;height:18px;background:#EF4444;color:white;border-radius:50%;font-size:0.65rem;font-weight:900;line-height:18px;text-align:center;padding:0 3px;">${t.badge}</span>` : ''}
    </button>`).join('');

  tabsEl.querySelectorAll('.mp-tab').forEach(btn => {
    btn.onclick = () => {
      mpTab = btn.dataset.tab;
      renderMPTabs(_familyId);
      showActiveTab(_familyId);
    };
  });
}

export function showActiveTab(familyId) {
  document.querySelectorAll('.mp-tab-content').forEach(el => el.style.display = 'none');
  const el = document.getElementById(`tab-${mpTab}`);
  if (el) el.style.display = 'block';

  if (mpTab === 'pending')  renderPendingTab(familyId);
  if (mpTab === 'history')  {
    _histLastSeen = _getHistLastSeen(familyId || _familyId);
    _markHistSeen(familyId || _familyId);
    renderMPFilters(); renderMPList(familyId);
  }
  if (mpTab === 'manual')   renderManualTab(familyId);
}

// =========== LOAD DATA ===========
export async function loadCompletedTasks(familyId) {
  allCompletedTasks = [];
  await loadChildren(familyId);
  let taskMap = {};
  try {
    const tasksSnap = await getDocs(collection(db, 'families', familyId, 'tasks'));
    tasksSnap.forEach(d => { taskMap[d.data().task] = d.data(); });
  } catch(e) {}

  const histEntries = [];
  const histKeys    = new Set();

  for (const child of childrenCache) {
    try {
      const stateSnap = await getDoc(doc(db, 'families', familyId, 'children', child.id, 'state', 'current'));
      if (!stateSnap.exists()) continue;
      const st = stateSnap.data();
      if (!st.hist?.length) continue;
      st.hist.forEach((h, idx) => {
        const key = `${h.taskId || h.task}_${h.ts || 0}`;
        histKeys.add(key);
        const taskInfo = taskMap[h.task] || {};
        histEntries.push({
          childId: child.id, childName: child.name,
          childEmoji: child.emoji || (child.gender === 'female' ? '👧' : '👦'),
          childColor: child.color || '#7C3AED',
          task: h.task, emoji: h.emoji || taskInfo.emoji || '⭐',
          pts: h.pts || 0, cat: taskInfo.cat || '',
          time: h.time || '', day: h.day || '', ts: h.ts || 0, histIdx: idx,
          photoUrl: h.photoUrl || '',
        });
      });
    } catch(e) {}
  }

  // טען גם משימות שאושרו מ-pendingApprovals ישירות — מניעת פספוס אם hist לא עודכן
  try {
    const approvedSnap = await getDocs(query(
      collection(db, 'families', familyId, 'pendingApprovals'),
      where('status', '==', 'approved')
    ));
    approvedSnap.forEach(d => {
      const data = d.data();
      const key  = `${data.taskId || data.task}_${data.ts || 0}`;
      if (histKeys.has(key)) return;
      const child    = childrenCache.find(c => c.id === data.childId);
      const taskInfo = taskMap[data.task] || {};
      histEntries.push({
        childId:    data.childId,
        childName:  data.childName  || child?.name  || '',
        childEmoji: data.childEmoji || child?.emoji || (child?.gender === 'female' ? '👧' : '👦'),
        childColor: child?.color    || '#7C3AED',
        task:    data.task  || '',
        emoji:   data.emoji || taskInfo.emoji || '⭐',
        pts:     data.pts   || 0,
        cat:     taskInfo.cat || '',
        time:    data.time  || '',
        day:     data.day   || '',
        ts:      data.ts    || 0,
        histIdx: -1,
        photoUrl: data.photoUrl || '',
        fromApproval: true,
      });
    });
  } catch(e) {}

  allCompletedTasks = histEntries.sort((a, b) => (b.ts || 0) - (a.ts || 0));
}

export async function loadPendingApprovals(familyId) {
  allPendingApprovals = [];
  await loadChildren(familyId);
  try {
    const snap = await getDocs(collection(db, 'families', familyId, 'pendingApprovals'));
    allPendingApprovals = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.ts || 0) - (a.ts || 0));
  } catch(e) {}
}

export async function loadAllPrizeRequests(familyId) {
  try {
    allPrizeRequests = await loadPrizeRequests(familyId);
  } catch(e) { allPrizeRequests = []; }
}

export async function loadRejectedItems(familyId) {
  allRejectedItems = [];
  await loadChildren(familyId);
  try {
    const [rejTaskSnap, decPrizeSnap] = await Promise.all([
      getDocs(query(collection(db, 'families', familyId, 'pendingApprovals'), where('status', '==', 'rejected'))),
      getDocs(query(collection(db, 'families', familyId, 'prizeRequests'),    where('status', '==', 'declined'))),
    ]);
    rejTaskSnap.forEach(d => {
      const data = d.data();
      const child = childrenCache.find(c => c.id === data.childId);
      const ts = data.resolvedAt ? (typeof data.resolvedAt === 'object' ? (data.resolvedAt.seconds || 0) * 1000 : data.resolvedAt) : (data.ts || 0);
      allRejectedItems.push({
        id: d.id, type: 'rejected_task',
        childId: data.childId,
        childName: data.childName || child?.name || '',
        childEmoji: data.childEmoji || child?.emoji || '👦',
        task: data.task || '', emoji: data.emoji || '⭐',
        pts: data.pts || 0, taskId: data.taskId || '',
        time: data.time || '', day: data.day || '',
        ts, photoUrl: data.photoUrl || '',
      });
    });
    decPrizeSnap.forEach(d => {
      const data = d.data();
      const child = childrenCache.find(c => c.id === data.childId);
      const ts = data.requestedAt?.toMillis ? data.requestedAt.toMillis() : (data.requestedAt || 0);
      allRejectedItems.push({
        id: d.id, type: 'rejected_prize',
        childId: data.childId,
        childName: data.childName || child?.name || '',
        childEmoji: data.childEmoji || child?.emoji || '👦',
        prizeName: data.prizeName || data.name || '',
        prizeEmoji: data.prizeEmoji || '🎁',
        pts: data.pts || data.cost || 0, ts,
      });
    });
    allRejectedItems.sort((a, b) => (b.ts || 0) - (a.ts || 0));
  } catch(e) { console.error('loadRejectedItems:', e); }
}

export async function loadCancelledTasks(familyId) {
  allCancelledTasks = [];
  await loadChildren(familyId);
  try {
    const snap = await getDocs(query(
      collection(db, 'families', familyId, 'pendingApprovals'),
      where('status', '==', 'cancelled')
    ));
    snap.forEach(d => {
      const data = d.data();
      const child = childrenCache.find(c => c.id === data.childId);
      allCancelledTasks.push({
        id: d.id,
        childId:    data.childId,
        childName:  data.childName  || child?.name  || '',
        childEmoji: data.childEmoji || child?.emoji || '👦',
        task:       data.task    || '',
        emoji:      data.emoji   || '⭐',
        pts:        data.pts     || 0,
        taskId:     data.taskId  || '',
        freq:       data.freq    || 'daily',
        time:       data.time    || '',
        day:        data.day     || '',
        ts:         data.cancelledAt || data.ts || 0,
        taskTs:     data.ts      || 0,
      });
    });
    allCancelledTasks.sort((a, b) => (b.ts || 0) - (a.ts || 0));
  } catch(e) { console.error('loadCancelledTasks:', e); }
}

export async function loadManualPtsHistory(familyId) {
  allManualPtsEvents = [];
  await loadChildren(familyId);
  try {
    for (const child of childrenCache) {
      const snap = await getDocs(query(
        collection(db, 'families', familyId, 'children', child.id, 'notifications'),
        where('type', '==', 'manual_pts')
      ));
      snap.forEach(d => {
        const data = d.data();
        allManualPtsEvents.push({
          _status:    'manual_pts',
          childId:    child.id,
          childName:  child.name  || '',
          childEmoji: child.emoji || '👦',
          pts:        data.pts    || 0,
          isAdd:      data.isAdd  ?? true,
          reason:     data.reason || '',
          ts:         data.ts     || 0,
        });
      });
    }
    allManualPtsEvents.sort((a, b) => (b.ts || 0) - (a.ts || 0));
  } catch(e) { console.error('loadManualPtsHistory:', e); }
}

export function initPendingListener(familyId, onUpdate) {
  return onSnapshot(collection(db, 'families', familyId, 'pendingApprovals'), async () => {
    await loadPendingApprovals(familyId);
    onUpdate();
  });
}

export function initPrizeRequestsListener(familyId, onUpdate) {
  return onSnapshot(collection(db, 'families', familyId, 'prizeRequests'), async () => {
    await loadAllPrizeRequests(familyId);
    onUpdate();
  });
}

// =========== TAB: ממתינים ===========
export function renderPendingTab(familyId) {
  const list = document.getElementById('mp-pending-list');
  if (!list) return;

  const pendingTasks    = allPendingApprovals.filter(p => p.status === 'pending');
  const pendingPrizes   = allPrizeRequests.filter(r => r.status === 'pending');

  if (pendingTasks.length === 0 && pendingPrizes.length === 0) {
    list.innerHTML = '<div class="empty-state" style="padding:40px 0;">🎉<br><br>אין בקשות ממתינות</div>';
    return;
  }

  list.innerHTML = '';

  // משימות ממתינות
  if (pendingTasks.length > 0) {
    const sec = document.createElement('div');
    sec.innerHTML = `<div class="mp-section-title" style="display:flex;align-items:center;gap:6px;margin-bottom:8px;">
      <span style="font-size:1rem;">✅</span><span>אישור משימות</span>
      <span style="background:#7C3AED;color:white;border-radius:10px;font-size:0.7rem;font-weight:900;padding:1px 7px;">${pendingTasks.length}</span>
    </div>`;
    pendingTasks.forEach(p => {
      const child = childrenCache.find(c => c.id === p.childId);
      const childDisplay = child ? `${child.emoji || '👦'} ${child.name}` : p.childName || 'ילד';
      const card = document.createElement('div');
      card.className = 'approval-card';
      card.dataset.approvalId = p.id;
      card.style.cssText = 'background:white;border-radius:16px;padding:14px 16px;margin-bottom:8px;box-shadow:0 2px 8px rgba(0,0,0,0.06);display:flex;align-items:center;gap:10px;';
      card.innerHTML = `
        <span style="font-size:1.8rem;">${p.emoji || '⭐'}</span>
        <div style="flex:1;min-width:0;">
          <div style="font-weight:800;font-size:0.92rem;color:#0F172A;margin-bottom:2px;">${p.task}</div>
          <div style="font-size:0.78rem;color:#64748B;">${childDisplay} · ${'⭐'.repeat(Math.min(p.pts||0,5)) || '⭐'} · ${p.day || ''} ${p.time || ''}</div>
          ${p.photoUrl ? `<button class="btn-photo-view" style="margin-top:5px;background:#EDE9FE;color:#7C3AED;border:none;border-radius:8px;padding:4px 10px;font-size:0.75rem;font-weight:800;font-family:'Heebo',sans-serif;cursor:pointer;">📷 צפה בתמונה</button>` : ''}
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;">
          <button class="btn-approve" style="background:linear-gradient(135deg,#7C3AED,#5B21B6);color:white;border:none;border-radius:10px;padding:6px 12px;font-size:0.78rem;font-weight:800;font-family:'Heebo',sans-serif;cursor:pointer;">✅ אשר</button>
          <button class="btn-reject" style="background:#FEE2E2;color:#B91C1C;border:none;border-radius:10px;padding:6px 12px;font-size:0.78rem;font-weight:800;font-family:'Heebo',sans-serif;cursor:pointer;">❌ דחה</button>
        </div>`;
      card.querySelector('.btn-approve').onclick = () => resolveApproval(p, 'approved', familyId);
      card.querySelector('.btn-reject').onclick  = () => resolveApproval(p, 'rejected', familyId);
      if (p.photoUrl) card.querySelector('.btn-photo-view').onclick = () => showPhotoModal(p, familyId);
      sec.appendChild(card);
    });
    list.appendChild(sec);
  }

  // פרסים ממתינים
  if (pendingPrizes.length > 0) {
    const sec = document.createElement('div');
    sec.style.marginTop = pendingTasks.length > 0 ? '16px' : '0';
    sec.innerHTML = `<div class="mp-section-title" style="display:flex;align-items:center;gap:6px;margin-bottom:8px;">
      <span style="font-size:1rem;">🎁</span><span>בקשות פרסים</span>
      <span style="background:#7C3AED;color:white;border-radius:10px;font-size:0.7rem;font-weight:900;padding:1px 7px;">${pendingPrizes.length}</span>
    </div>`;
    pendingPrizes.forEach(r => {
      const child = childrenCache.find(c => c.id === r.childId);
      const childDisplay = child ? `${child.emoji || '👦'} ${child.name}` : r.childName || 'ילד';
      const card = document.createElement('div');
      card.dataset.approvalId = r.id;
      card.style.cssText = 'background:white;border-radius:16px;padding:14px 16px;margin-bottom:8px;box-shadow:0 2px 8px rgba(0,0,0,0.06);display:flex;align-items:center;gap:10px;';
      card.innerHTML = `
        <span style="font-size:1.8rem;">${r.prizeEmoji || '🎁'}</span>
        <div style="flex:1;min-width:0;">
          <div style="font-weight:800;font-size:0.92rem;color:#0F172A;margin-bottom:2px;">${r.prizeName || r.name || ''}</div>
          <div style="font-size:0.78rem;color:#64748B;">${childDisplay} · ⭐ ${r.pts || r.cost || 0}</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;">
          <button class="btn-prize-approve" style="background:linear-gradient(135deg,#7C3AED,#5B21B6);color:white;border:none;border-radius:10px;padding:6px 12px;font-size:0.78rem;font-weight:800;font-family:'Heebo',sans-serif;cursor:pointer;">✅ אשר</button>
          <button class="btn-prize-reject" style="background:#FEE2E2;color:#B91C1C;border:none;border-radius:10px;padding:6px 12px;font-size:0.78rem;font-weight:800;font-family:'Heebo',sans-serif;cursor:pointer;">❌ דחה</button>
        </div>`;
      const _fadeRemoveCard = () => {
        card.style.transition = 'opacity 0.18s, transform 0.18s';
        card.style.opacity = '0';
        card.style.transform = 'scale(0.95)';
        setTimeout(() => card.remove(), 180);
      };
      card.querySelector('.btn-prize-approve').onclick = async () => {
        showConfirm({ icon: r.prizeEmoji || '🎁', title: `לאשר: ${r.prizeName || r.name}?`,
          message: `${child?.name || ''} יממש את הפרס`, confirmText: '✅ אשר',
          confirmColor: 'linear-gradient(135deg,#7C3AED,#5B21B6)',
          onConfirm: async () => {
            _fadeRemoveCard();
            await approvePrizeRequest(familyId, r.id);
            await loadAllPrizeRequests(familyId);
            renderMPTabs(familyId); renderPendingTab(familyId);
          }
        });
      };
      card.querySelector('.btn-prize-reject').onclick = async () => {
        _fadeRemoveCard();
        await declinePrizeRequest(familyId, r.id);
        await loadAllPrizeRequests(familyId);
        renderMPTabs(familyId); renderPendingTab(familyId);
      };
      sec.appendChild(card);
    });
    list.appendChild(sec);
  }

}

// =========== HISTORY LAST-SEEN ===========
let _histLastSeen = 0;
function _histSeenKey(fid) { return `activityLastSeen_${fid}`; }
function _getHistLastSeen(fid) {
  try { return parseInt(localStorage.getItem(_histSeenKey(fid)) || '0', 10); } catch(e) { return 0; }
}
function _markHistSeen(fid) {
  try { localStorage.setItem(_histSeenKey(fid), String(Date.now())); } catch(e) {}
}

// =========== HISTORY HELPERS ===========
function _tsToDateKey(ts) {
  if (!ts) return '1970-01-01';
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function _dateKeyToLabel(dateKey) {
  if (dateKey === '1970-01-01') return 'לא ידוע';
  const [y, m, d] = dateKey.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const names = ['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'];
  return `${names[date.getDay()]} ${d}.${m}`;
}
function _renderUnifiedCardHtml(item, idx) {
  const emoji    = item.emoji || item.prizeEmoji || '⭐';
  const taskName = item.task  || item.prizeName  || '';

  const isNew = _histLastSeen > 0 && (item.ts || 0) > _histLastSeen;
  const newDot = isNew ? `<span style="position:absolute;top:10px;left:10px;width:9px;height:9px;background:#EF4444;border-radius:50%;border:2px solid white;"></span>` : '';

  if (item._status === 'approved') {
    return `
      <div class="etask-wrap" data-idx="${idx}" data-child-id="${item.childId}" data-hist-idx="${item.histIdx}" style="position:relative;">
        ${newDot}
        <div class="etask-actions"><div class="etask-action act-delete" data-act="undo"><span>↩️</span>בטל</div></div>
        <div class="etask-card">
          <span class="etask-emoji">${emoji}</span>
          <div class="etask-info">
            <strong>${taskName}</strong>
            <div class="etask-meta">
              <span class="etask-tag child-tag">${item.childEmoji} ${item.childName}</span>
              ${item.cat ? `<span class="etask-tag cat-tag">${item.cat}</span>` : ''}
              <span class="etask-tag freq-tag">${item.day} ${item.time}</span>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
            <span class="etask-stars">${'⭐'.repeat(Math.min(item.pts||0,5))}</span>
            ${item.photoUrl ? `<button class="btn-hist-photo" data-idx="${idx}" style="background:#EDE9FE;border:none;border-radius:8px;width:28px;height:28px;font-size:0.85rem;cursor:pointer;display:flex;align-items:center;justify-content:center;">📷</button>` : ''}
          </div>
        </div>
      </div>`;
  }

  if (item._status === 'manual_pts') {
    const isAdd  = item.isAdd;
    const bg     = isAdd ? '#F0FDF4' : '#FFF7ED';
    const border = isAdd ? '#BBF7D0' : '#FED7AA';
    const color  = isAdd ? '#166534' : '#9A3412';
    const label  = isAdd ? `➕ ${item.pts} ⭐ הוספו` : `➖ ${item.pts} ⭐ הופחתו`;
    return `
      <div class="etask-wrap etask-dimmed">
        <div class="etask-card" style="background:${bg};border:1.5px solid ${border};">
          <span class="etask-emoji">${isAdd ? '➕' : '➖'}</span>
          <div class="etask-info">
            <strong style="color:${color};">${label}</strong>
            <div class="etask-meta">
              <span class="etask-tag child-tag">${item.childEmoji} ${item.childName}</span>
              ${item.reason ? `<span style="font-size:0.75rem;color:#64748B;">${item.reason}</span>` : ''}
            </div>
          </div>
        </div>
      </div>`;
  }

  if (item._status === 'prize') {
    return `
      <div class="etask-wrap etask-dimmed">
        <div class="etask-card" style="background:#FFFBEB;border:1.5px solid #FDE68A;">
          <span class="etask-emoji">${item.prizeEmoji || '🎁'}</span>
          <div class="etask-info">
            <strong>${item.prizeName}</strong>
            <div class="etask-meta">
              <span style="background:#FEF3C7;color:#92400E;border-radius:6px;padding:1px 7px;font-size:0.68rem;font-weight:900;">🎁 מומש</span>
              <span class="etask-tag child-tag">${item.childEmoji} ${item.childName}</span>
              <span style="font-size:0.75rem;color:#64748B;">⭐ ${item.pts}</span>
            </div>
          </div>
          <button class="btn-prize-reverse-unified" data-idx="${idx}"
            style="background:#FEF3C7;color:#92400E;border:1.5px solid #FDE68A;border-radius:10px;padding:6px 10px;font-size:0.75rem;font-weight:800;font-family:'Heebo',sans-serif;cursor:pointer;white-space:nowrap;flex-shrink:0;">
            ↩️ בטל
          </button>
        </div>
      </div>`;
  }

  const badge = item._status === 'rejected'
    ? `<span style="background:#FEE2E2;color:#B91C1C;border-radius:6px;padding:1px 7px;font-size:0.68rem;font-weight:900;">❌ לא אושר</span>`
    : `<span style="background:#FEF3C7;color:#92400E;border-radius:6px;padding:1px 7px;font-size:0.68rem;font-weight:900;">↩️ בוטל</span>`;
  const photoBtn = item.photoUrl
    ? `<button class="btn-hist-photo-rej" data-idx="${idx}" style="background:#EDE9FE;border:none;border-radius:8px;width:28px;height:28px;font-size:0.85rem;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;">📷</button>`
    : '';
  return `
    <div class="etask-wrap etask-dimmed">
      <div class="etask-card" style="opacity:0.5;">
        <span class="etask-emoji">${emoji}</span>
        <div class="etask-info">
          <strong>${taskName}</strong>
          <div class="etask-meta">
            ${badge}
            <span class="etask-tag child-tag">${item.childEmoji} ${item.childName}</span>
            <span class="etask-stars" style="font-size:0.8rem;">${'⭐'.repeat(Math.min(item.pts||0,5))}</span>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
          ${photoBtn}
          <button class="btn-retroapprove" data-idx="${idx}"
            style="background:linear-gradient(135deg,#7C3AED,#5B21B6);color:white;border:none;border-radius:10px;padding:7px 10px;font-size:0.73rem;font-weight:800;font-family:'Heebo',sans-serif;cursor:pointer;white-space:nowrap;">אשר</button>
        </div>
      </div>
    </div>`;
}

// =========== TAB: היסטוריה ===========
export function renderMPFilters() {
  document.querySelectorAll('#mp-filter .filter-chip').forEach(f => {
    f.classList.toggle('active', f.dataset.filter === mpFilter);
    f.onclick = () => {
      mpFilter = f.dataset.filter; mpSubFilter = '';
      renderMPFilters(); renderMPSubFilter(); renderMPList(_familyId);
    };
  });
  renderMPSubFilter();
}

function renderMPSubFilter() {
  const sub = document.getElementById('mp-sub-filter');
  if (!sub) return;
  if (mpFilter === 'all') { sub.style.display = 'none'; return; }
  let options = [];
  if (mpFilter === 'child') {
    const names = [...new Set(allCompletedTasks.map(t => t.childName))];
    options = names.map(n => {
      const ct = allCompletedTasks.find(t => t.childName === n);
      return { key: n, label: `${ct?.childEmoji || '👦'} ${n}` };
    });
  } else if (mpFilter === 'cat') {
    const cats = [...new Set(allCompletedTasks.map(t => t.cat || '📋 ללא'))];
    options = cats.map(c => ({ key: c, label: c }));
  } else if (mpFilter === 'stars') {
    options = [1,2,3,4,5].map(n => ({ key: String(n), label: '⭐'.repeat(n) }));
  }
  sub.style.display = 'flex';
  sub.innerHTML = options.map(o =>
    `<span class="sub-chip${mpSubFilter===o.key?' active':''}" data-key="${o.key}">${o.label}</span>`
  ).join('');
  sub.querySelectorAll('.sub-chip').forEach(chip => {
    chip.onclick = () => {
      mpSubFilter = mpSubFilter === chip.dataset.key ? '' : chip.dataset.key;
      renderMPSubFilter(); renderMPList(_familyId);
    };
  });
}

export function renderMPList(familyId) {
  if (familyId) _familyId = familyId;
  const list = document.getElementById('mp-list');
  if (!list) return;

  // --- approved tasks (filtered) ---
  let approved = [...allCompletedTasks];
  if (mpFilter === 'child' && mpSubFilter) approved = approved.filter(t => t.childName === mpSubFilter);
  if (mpFilter === 'cat'   && mpSubFilter) approved = approved.filter(t => (t.cat || '📋 ללא') === mpSubFilter);
  if (mpFilter === 'stars' && mpSubFilter) approved = approved.filter(t => t.pts === parseInt(mpSubFilter));

  // --- rejected / cancelled (filter by child & stars when active) ---
  let rejected  = [...allRejectedItems];
  let cancelled = [...allCancelledTasks];
  if (mpFilter === 'child' && mpSubFilter) {
    rejected  = rejected.filter(t => t.childName === mpSubFilter);
    cancelled = cancelled.filter(t => t.childName === mpSubFilter);
  }
  if (mpFilter === 'stars' && mpSubFilter) {
    rejected  = rejected.filter(t => t.pts === parseInt(mpSubFilter));
    cancelled = cancelled.filter(t => t.pts === parseInt(mpSubFilter));
  }

  // --- approved prizes ---
  let prizes = allPrizeRequests
    .filter(r => r.status === 'approved')
    .slice(0, 10)
    .map(r => {
      const child = childrenCache.find(c => c.id === r.childId);
      const ts = r.requestedAt?.toMillis ? r.requestedAt.toMillis() : (r.requestedAt || 0);
      return {
        _status: 'prize', _prizeObj: r,
        prizeEmoji: r.prizeEmoji || '🎁',
        prizeName:  r.prizeName || r.name || '',
        pts:        r.pts || r.cost || 0,
        childId:    r.childId,
        childName:  r.childName || child?.name || '',
        childEmoji: child?.emoji || '👦',
        ts,
      };
    });
  if (mpFilter === 'child' && mpSubFilter) prizes = prizes.filter(p => p.childName === mpSubFilter);
  if (mpFilter === 'cat' || mpFilter === 'stars') prizes = [];

  // --- manual pts events (all & child filter only) ---
  let manualPts = [];
  if (mpFilter === 'all' || mpFilter === 'child') {
    manualPts = [...allManualPtsEvents];
    if (mpFilter === 'child' && mpSubFilter) manualPts = manualPts.filter(e => e.childName === mpSubFilter);
  }

  // --- הגנה מפני כפילות: הסר מ-approved כל פריט שיש לו מקביל ב-cancelled ---
  // (race condition: onSnapshot מפעיל לפני שה-updateDoc של hist מתפשט)
  // taskTs = הזמן המקורי של ביצוע המשימה (data.ts ב-pendingApprovals),
  // שמתאים ל-ts ב-allCompletedTasks (שמגיע מ-hist[].ts)
  const cancelledKeys = new Set(
    cancelled.map(t => `${t.childId}|${t.task}|${t.taskTs}`)
  );
  approved = approved.filter(t => !cancelledKeys.has(`${t.childId}|${t.task}|${t.ts}`));

  // --- build unified sorted list ---
  _unifiedItems = [];
  approved.forEach(t  => _unifiedItems.push({ ...t, _status: 'approved'  }));
  rejected.forEach(t  => _unifiedItems.push({ ...t, _status: 'rejected'  }));
  cancelled.forEach(t => _unifiedItems.push({ ...t, _status: 'cancelled' }));
  prizes.forEach(p    => _unifiedItems.push(p));
  manualPts.forEach(e => _unifiedItems.push(e));
  _unifiedItems.sort((a, b) => (b.ts || 0) - (a.ts || 0));

  if (_unifiedItems.length === 0) {
    list.innerHTML = '<div class="empty-state">אין משימות שבוצעו</div>';
    return;
  }

  // --- group by date ---
  const groups = new Map();
  _unifiedItems.forEach((item, idx) => {
    const dk = _tsToDateKey(item.ts);
    if (!groups.has(dk)) groups.set(dk, []);
    groups.get(dk).push({ item, idx });
  });
  const sortedDates = [...groups.keys()].sort().reverse();

  let html = '';
  sortedDates.forEach(dk => {
    html += `<div class="mp-date-sep">${_dateKeyToLabel(dk)}</div>`;
    groups.get(dk).forEach(({ item, idx }) => html += _renderUnifiedCardHtml(item, idx));
  });
  list.innerHTML = html;

  // swipe on approved cards only
  attachMPSwipeHandlers(list, familyId);

  // photo buttons (approved)
  list.querySelectorAll('.btn-hist-photo').forEach(btn => {
    const idx = parseInt(btn.dataset.idx);
    btn.onclick = (e) => { e.stopPropagation(); showPhotoLightbox(_unifiedItems[idx].photoUrl); };
  });

  // retroapprove buttons (rejected / cancelled)
  list.querySelectorAll('.btn-retroapprove').forEach(btn => {
    const idx  = parseInt(btn.dataset.idx);
    const item = _unifiedItems[idx];
    btn.onclick = () => {
      if (item._status === 'rejected') {
        if (item.type === 'rejected_task') _restoreRejectedTask(familyId || _familyId, item);
        else _restoreRejectedPrize(familyId || _familyId, item);
      } else {
        _reApproveTask(familyId || _familyId, item);
      }
    };
  });

  // photo buttons (rejected)
  list.querySelectorAll('.btn-hist-photo-rej').forEach(btn => {
    const idx = parseInt(btn.dataset.idx);
    btn.onclick = (e) => { e.stopPropagation(); showPhotoLightbox(_unifiedItems[idx].photoUrl); };
  });

  // prize reverse buttons
  list.querySelectorAll('.btn-prize-reverse-unified').forEach(btn => {
    const idx   = parseInt(btn.dataset.idx);
    const item  = _unifiedItems[idx];
    const child = childrenCache.find(c => c.id === item.childId);
    btn.onclick = () => showConfirm({
      icon:         item.prizeEmoji,
      title:        `לבטל: ${item.prizeName}?`,
      message:      `${child?.name || item.childName} יקבל בחזרה ${item.pts} ⭐`,
      confirmText:  '↩️ בטל מימוש',
      confirmColor: 'linear-gradient(135deg,#7C3AED,#5B21B6)',
      onConfirm: async () => {
        await reversePrizeRequest(familyId || _familyId, item._prizeObj.id);
        await loadAllPrizeRequests(familyId || _familyId);
        renderMPTabs(familyId || _familyId);
        renderMPList(familyId || _familyId);
      }
    });
  });
}

// =========== TAB: ניקוד ידני ===========
export function renderManualTab(familyId) {
  const container = document.getElementById('mp-manual-content');
  if (!container) return;

  if (childrenCache.length === 0) {
    container.innerHTML = '<div class="empty-state">אין ילדים במשפחה</div>';
    return;
  }

  let selChildId = childrenCache[0]?.id || '';
  let manualAmt  = 5;
  let isAdding   = true;

  function draw() {
    container.innerHTML = `
      <div style="background:white;border-radius:20px;padding:12px 14px;margin-bottom:8px;box-shadow:0 2px 12px rgba(0,0,0,0.06);">

        <div style="font-size:0.82rem;font-weight:800;color:#64748B;margin-bottom:8px;">👶 בחר ילד</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
          ${childrenCache.map(c => `
            <div data-child-id="${c.id}" class="manual-child-pill"
              style="display:flex;flex-direction:column;align-items:center;gap:2px;padding:6px 10px;
                     border-radius:16px;border:2.5px solid ${c.id === selChildId ? 'var(--primary)' : 'var(--border)'};
                     background:${c.id === selChildId ? '#EDE9FE' : 'white'};cursor:pointer;min-width:56px;transition:all 0.15s;">
              <span style="font-size:1.6rem;">${c.emoji || '👦'}</span>
              <span style="font-size:0.72rem;font-weight:800;color:${c.id === selChildId ? 'var(--primary)' : '#64748B'};">${c.name}</span>
            </div>`).join('')}
        </div>

        <div style="font-size:0.82rem;font-weight:800;color:#64748B;margin-bottom:6px;">📌 סוג פעולה</div>
        <div style="display:flex;gap:8px;margin-bottom:10px;">
          <button id="btn-type-add"
            style="flex:1;padding:8px;border-radius:12px;font-family:'Heebo',sans-serif;font-weight:900;font-size:0.88rem;cursor:pointer;transition:all 0.15s;
                   border:2px solid ${isAdding ? '#10B981' : 'var(--border)'};
                   background:${isAdding ? 'linear-gradient(135deg,#D1FAE5,#A7F3D0)' : 'white'};
                   color:${isAdding ? '#065F46' : '#64748B'};">➕ הוסף כוכבים</button>
          <button id="btn-type-remove"
            style="flex:1;padding:8px;border-radius:12px;font-family:'Heebo',sans-serif;font-weight:900;font-size:0.88rem;cursor:pointer;transition:all 0.15s;
                   border:2px solid ${!isAdding ? '#EF4444' : 'var(--border)'};
                   background:${!isAdding ? 'linear-gradient(135deg,#FEE2E2,#FECACA)' : 'white'};
                   color:${!isAdding ? '#B91C1C' : '#64748B'};">➖ הפחת כוכבים</button>
        </div>

        <div style="font-size:0.82rem;font-weight:800;color:#64748B;margin-bottom:6px;">⭐ כמות</div>
        <div style="display:flex;align-items:center;justify-content:center;gap:20px;margin-bottom:10px;">
          <button id="btn-amt-minus"
            style="width:42px;height:42px;border-radius:50%;border:2px solid var(--border);background:white;
                   font-size:1.4rem;font-weight:900;cursor:pointer;color:#64748B;font-family:'Heebo',sans-serif;line-height:1;">−</button>
          <div style="text-align:center;min-width:56px;">
            <div style="font-size:2.5rem;font-weight:900;color:${isAdding ? '#10B981' : '#EF4444'};line-height:1;">${manualAmt}</div>
            <div style="font-size:0.72rem;color:#94A3B8;font-weight:700;">כוכבים ⭐</div>
          </div>
          <button id="btn-amt-plus"
            style="width:42px;height:42px;border-radius:50%;border:2px solid var(--border);background:white;
                   font-size:1.4rem;font-weight:900;cursor:pointer;color:#64748B;font-family:'Heebo',sans-serif;line-height:1;">+</button>
        </div>

        <div style="font-size:0.82rem;font-weight:800;color:#64748B;margin-bottom:4px;">📝 סיבה (לא חובה)</div>
        <textarea id="manual-reason" rows="2"
          placeholder="לדוגמה: עזרה ספונטנית בבישול או סתם מאהבה"
          style="width:100%;border:2px solid var(--border);border-radius:12px;padding:8px 12px;
                 font-size:0.85rem;font-family:'Heebo',sans-serif;resize:none;box-sizing:border-box;
                 outline:none;color:#0F172A;background:#F8FAFC;direction:rtl;"></textarea>

        <button id="btn-manual-submit"
          style="width:100%;margin-top:8px;padding:13px;border-radius:14px;font-size:1rem;font-weight:900;
                 border:none;cursor:pointer;font-family:'Heebo',sans-serif;color:white;
                 background:${isAdding ? 'linear-gradient(135deg,#10B981,#059669)' : 'linear-gradient(135deg,#EF4444,#DC2626)'};">
          ${isAdding ? '➕' : '➖'} ${manualAmt} ⭐ עבור ${childrenCache.find(c => c.id === selChildId)?.name || ''}
        </button>
      </div>`;

    container.querySelectorAll('.manual-child-pill').forEach(pill => {
      pill.onclick = () => { selChildId = pill.dataset.childId; draw(); };
    });
    container.querySelector('#btn-type-add').onclick    = () => { isAdding = true;  draw(); };
    container.querySelector('#btn-type-remove').onclick  = () => { isAdding = false; draw(); };
    container.querySelector('#btn-amt-minus').onclick    = () => { manualAmt = Math.max(1,   manualAmt - 1); draw(); };
    container.querySelector('#btn-amt-plus').onclick     = () => { manualAmt = Math.min(100, manualAmt + 1); draw(); };
    container.querySelector('#btn-manual-submit').onclick = () => {
      const reason = container.querySelector('#manual-reason')?.value?.trim() || '';
      submitManualPoints(familyId, selChildId, manualAmt, isAdding, reason);
    };

    const reasonEl = container.querySelector('#manual-reason');
    if (reasonEl) animatePlaceholder(reasonEl, MANUAL_REASON_PHRASES);
  }

  draw();
}

async function submitManualPoints(familyId, childId, amount, isAdd, reason) {
  showLoading(isAdd ? 'מוסיף כוכבים...' : 'מפחית כוכבים...');
  try {
    const stateRef  = doc(db, 'families', familyId, 'children', childId, 'state', 'current');
    const stateSnap = await getDoc(stateRef);
    const st     = stateSnap.exists() ? stateSnap.data() : { pts: 0 };
    const delta  = isAdd ? amount : -amount;
    const newPts = Math.max(0, (st.pts || 0) + delta);
    await updateDoc(stateRef, { pts: newPts });

    const childRef = doc(db, 'families', familyId, 'children', childId);
    await updateDoc(childRef, { pts: newPts });

    const manualTitle = isAdd
      ? `ההורים הוסיפו לך ${amount} ⭐`
      : `ההורים הפחיתו לך ${amount} ⭐`;
    const manualMsg = isAdd
      ? `ההורים החליטו להוסיף לך ${amount} כוכבים${reason ? ` — ${reason}` : ' 🎉'}`
      : `ההורים החליטו להפחית לך ${amount} כוכבים${reason ? ` — ${reason}` : ''}`;

    await addDoc(collection(db, 'families', familyId, 'children', childId, 'notifications'), {
      type:    'manual_pts',
      pts:      amount,
      isAdd,
      reason,
      title:   manualTitle,
      message: manualMsg,
      read:    false,
      ts:      Date.now(),
    });

    hideLoading();
    const child = childrenCache.find(c => c.id === childId);
    showToast(`${isAdd ? '➕' : '➖'} ${amount} ⭐ עודכן עבור ${child?.name || 'ילד'}`);
    // רענון מיידי של תצוגת הכוכבים וההיסטוריה
    await loadCompletedTasks(familyId);
    renderMPTabs(familyId);
    if (mpTab === 'manual') renderManualTab(familyId);
  } catch(e) {
    hideLoading();
    console.error(e);
    showToast('שגיאה, נסה שוב');
  }
}

// =========== APPROVAL ===========
async function resolveApproval(p, status, familyId) {
  if (status === 'approved') {
    showConfirm({ icon: p.emoji || '⭐', title: `לאשר: ${p.task}?`,
      message: `${p.childName} יקבל/תקבל ${p.pts} ⭐`,
      confirmText: '✅ אשר', confirmColor: 'linear-gradient(135deg,#7C3AED,#5B21B6)',
      onConfirm: () => _doResolve(p, 'approved', familyId),
    });
  } else {
    _doResolve(p, 'rejected', familyId);
  }
}

async function _doResolve(p, status, familyId) {
  // הסרה מיידית של הכרטיס מה-UI לפני תגובת השרת
  const cardEl = document.querySelector(`[data-approval-id="${p.id}"]`);
  if (cardEl) {
    cardEl.style.transition = 'opacity 0.18s, transform 0.18s';
    cardEl.style.opacity = '0';
    cardEl.style.transform = 'scale(0.95)';
    setTimeout(() => cardEl.remove(), 180);
  }
  showLoading(status === 'approved' ? 'מאשר...' : 'דוחה...');
  try {
    await updateDoc(doc(db, 'families', familyId, 'pendingApprovals', p.id), { status, resolvedAt: Date.now() });
    if (status === 'approved') {
      const stateRef  = doc(db, 'families', familyId, 'children', p.childId, 'state', 'current');
      const stateSnap = await getDoc(stateRef);
      if (stateSnap.exists()) {
        const cs = stateSnap.data();
        cs.pts = (cs.pts || 0) + (p.pts || 0);
        if (!cs.comp) cs.comp = {};
        const c = cs.comp[p.taskId] || { wc: 0, d: '', count: 0, lastTs: 0 };
        const dateKey = p.ts ? new Date(p.ts).toISOString().slice(0,10) : new Date().toISOString().slice(0,10);
        c.wc++; c.d = dateKey; c.count++; c.lastTs = p.ts || Date.now();
        cs.comp[p.taskId] = c;
        if (!cs.dailyPts) cs.dailyPts = {};
        cs.dailyPts[dateKey] = (cs.dailyPts[dateKey] || 0) + (p.pts || 0);
        if (!cs.hist) cs.hist = [];
        cs.hist.unshift({ taskId: p.taskId, task: p.task, emoji: p.emoji || '⭐',
          pts: p.pts || 0, time: p.time || '', day: p.day || '', ts: p.ts || Date.now(),
          ...(p.photoUrl ? { photoUrl: p.photoUrl } : {}) });
        if (cs.hist.length > 50) cs.hist.pop();
        if (cs.pending) {
          cs.pending = cs.pending.map(pp =>
            pp.taskId === p.taskId && Math.abs((pp.ts||0) - (p.ts||0)) < 5000
              ? { ...pp, status: 'approved' } : pp);
        }
        await updateDoc(stateRef, cs);
      }
    } else {
      const stateRef  = doc(db, 'families', familyId, 'children', p.childId, 'state', 'current');
      const stateSnap = await getDoc(stateRef);
      if (stateSnap.exists()) {
        const cs = stateSnap.data();
        if (cs.pending) {
          cs.pending = cs.pending.map(pp =>
            pp.taskId === p.taskId && Math.abs((pp.ts||0) - (p.ts||0)) < 5000
              ? { ...pp, status: 'rejected' } : pp);
          await updateDoc(stateRef, { pending: cs.pending });
        }
      }
    }
    hideLoading();
    if (status === 'approved') showStarsAddedPopup(p.childName, p.pts);
    else showToast('❌ הבקשה נדחתה');
    await Promise.all([
      loadPendingApprovals(familyId),
      loadCompletedTasks(familyId),
      loadRejectedItems(familyId),
    ]);
    renderMPTabs(familyId);
    renderPendingTab(familyId);
    const activeTab = document.querySelector('.mp-tab.active');
    if (activeTab?.dataset?.tab === 'history') { renderMPFilters(); renderMPList(familyId); }
  } catch(e) { hideLoading(); console.error(e); showToast('שגיאה, נסה שוב'); }
}

// =========== SWIPE ===========
function attachMPSwipeHandlers(list, familyId) {
  list.querySelectorAll('.etask-wrap:not(.etask-dimmed)').forEach(wrap => {
    const card = wrap.querySelector('.etask-card');
    const childId = wrap.dataset.childId;
    const histIdx = parseInt(wrap.dataset.histIdx);
    let startX = 0, currentX = 0, swiping = false, swiped = false;
    card.addEventListener('touchstart', (e) => {
      startX = e.touches[0].clientX; currentX = 0; swiping = true; swiped = false;
      card.style.transition = 'none';
    }, { passive: true });
    card.addEventListener('touchmove', (e) => {
      if (!swiping) return;
      currentX = Math.max(0, Math.min(e.touches[0].clientX - startX, 70));
      card.style.transform = `translateX(${currentX}px)`;
      if (currentX > 10) swiped = true;
    }, { passive: true });
    card.addEventListener('touchend', () => {
      swiping = false;
      card.style.transition = 'transform 0.2s ease';
      card.style.transform = currentX > 40 ? 'translateX(70px)' : 'translateX(0)';
      if (currentX <= 40) swiped = false;
    });
    card.addEventListener('click', () => {
      if (swiped) { card.style.transition = 'transform 0.2s ease'; card.style.transform = 'translateX(0)'; swiped = false; }
    });
    wrap.querySelector('[data-act="undo"]').onclick = () => {
      showConfirm({ icon: '↩️', title: 'לבטל את ביצוע המשימה?', message: 'הכוכבים יורדו מהילד',
        confirmText: 'בטל ביצוע', confirmColor: 'linear-gradient(135deg,#7C3AED,#5B21B6)',
        onConfirm: () => undoTask(familyId, childId, histIdx),
      });
    };
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.etask-wrap')) {
      list.querySelectorAll('.etask-card').forEach(c => {
        c.style.transition = 'transform 0.2s ease'; c.style.transform = 'translateX(0)';
      });
    }
  });
}

// =========== UNDO TASK ===========
async function undoTask(familyId, childId, histIdx) {
  showLoading('מבטל...');
  try {
    const stateRef  = doc(db, 'families', familyId, 'children', childId, 'state', 'current');
    const stateSnap = await getDoc(stateRef);
    if (stateSnap.exists()) {
      const st = stateSnap.data();
      const histItem = st.hist?.[histIdx];
      if (histItem) {
        const newPts  = Math.max(0, (st.pts || 0) - (histItem.pts || 0));
        const newHist = st.hist.filter((_, i) => i !== histIdx);

        // נקה comp[taskId] כדי שהמשימה תהיה זמינה שוב לילד
        const newComp = { ...(st.comp || {}) };
        const taskKey = histItem.taskId || '';
        if (taskKey && newComp[taskKey]) {
          const c = newComp[taskKey];
          c.wc = (c.wc || 1) - 1;
          if (c.wc <= 0) delete newComp[taskKey];
          else newComp[taskKey] = c;
        }

        // עדכון ממוקד — Firestore cache מתעדכן לפני ש-addDoc יפעיל onSnapshot
        await updateDoc(stateRef, { hist: newHist, pts: newPts, comp: newComp });

        // סמן את ה-pendingApproval המקורי (approved) כ-cancelled_by_parent
        // חיפוש בזיכרון — ללא Firestore composite index
        const matchingApproval = allPendingApprovals.find(p =>
          p.childId === childId &&
          p.status  === 'approved' &&
          p.taskId  === (histItem.taskId || '') &&
          Math.abs((p.ts || 0) - (histItem.ts || 0)) < 5000
        );
        if (matchingApproval) {
          try {
            await updateDoc(
              doc(db, 'families', familyId, 'pendingApprovals', matchingApproval.id),
              { status: 'cancelled_by_parent' }
            );
          } catch(e) {}
        }

        // מצא את המשימה כדי לקבל freq
        let taskFreq = 'daily';
        let taskDocId = histItem.taskId || '';
        try {
          const tasksSnap = await getDocs(collection(db, 'families', familyId, 'tasks'));
          tasksSnap.forEach(d => {
            if (d.id === histItem.taskId || d.data().task === histItem.task) {
              taskFreq  = d.data().freq || 'daily';
              taskDocId = d.id;
            }
          });
        } catch(e) {}

        // צור רשומת "בוטל" ב-pendingApprovals — ממתינה להחלטת ההורה
        const child = childrenCache.find(c => c.id === childId);
        await addDoc(collection(db, 'families', familyId, 'pendingApprovals'), {
          status:     'cancelled',
          childId,
          childName:  child?.name  || '',
          childEmoji: child?.emoji || '👦',
          task:       histItem.task  || '',
          emoji:      histItem.emoji || '⭐',
          pts:        histItem.pts   || 0,
          taskId:     taskDocId,
          freq:       taskFreq,
          time:       histItem.time  || '',
          day:        histItem.day   || '',
          ts:         histItem.ts    || Date.now(),
          cancelledAt: Date.now(),
        });

        // התראה לילד על ביטול
        await addDoc(collection(db, 'families', familyId, 'children', childId, 'notifications'), {
          type:     'task_cancelled',
          taskName: histItem.task  || '',
          emoji:    histItem.emoji || '↩️',
          pts:      histItem.pts   || 0,
          message:  `המשימה "${histItem.task}" בוטלה על ידי ההורה↩️${histItem.pts ? ` נגרעו ${histItem.pts} ⭐` : ''}`,
          read:     false,
          ts:       Date.now(),
        });
      }
    }
    await Promise.all([loadCompletedTasks(familyId), loadCancelledTasks(familyId)]);
    hideLoading();
    showToast('ביצוע בוטל — ממתין להחלטה ↩️');
    renderMPList(familyId);
    renderMPTabs(familyId);
  } catch(e) { hideLoading(); console.error(e); }
}

// =========== PHOTO MODAL (אישורים) ===========
function showPhotoModal(p, familyId) {
  const existing = document.getElementById('photo-modal-overlay');
  if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'photo-modal-overlay';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.92);z-index:4000;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:16px;';
  modal.innerHTML = `
    <div style="width:100%;max-width:440px;background:#1E293B;border-radius:24px;overflow:hidden;box-shadow:0 24px 60px rgba(0,0,0,0.4);">
      <div style="padding:14px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid rgba(255,255,255,0.08);">
        <span style="font-size:1.6rem;">${p.emoji || '⭐'}</span>
        <div style="flex:1;min-width:0;">
          <div style="font-weight:800;font-size:0.92rem;color:white;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${p.task}</div>
          <div style="font-size:0.75rem;color:#94A3B8;">${p.childName} · ${'⭐'.repeat(Math.min(p.pts||0,5)) || '⭐'} · ${p.day || ''} ${p.time || ''}</div>
        </div>
        <button id="pm-close" style="background:rgba(255,255,255,0.1);border:none;border-radius:50%;width:32px;height:32px;color:white;font-size:1rem;cursor:pointer;flex-shrink:0;">✕</button>
      </div>
      <img src="${p.photoUrl}" style="width:100%;max-height:52vh;object-fit:contain;background:#0F172A;display:block;" />
      <div style="padding:12px 14px;display:flex;gap:10px;">
        <button id="pm-approve" style="flex:2;padding:13px;background:linear-gradient(135deg,#7C3AED,#5B21B6);color:white;border:none;border-radius:14px;font-size:0.95rem;font-weight:800;font-family:'Heebo',sans-serif;cursor:pointer;box-shadow:0 4px 14px rgba(124,58,237,0.35);">✅ אשר</button>
        <button id="pm-reject" style="flex:1;padding:13px;background:#FEE2E2;color:#B91C1C;border:none;border-radius:14px;font-size:0.95rem;font-weight:800;font-family:'Heebo',sans-serif;cursor:pointer;">❌ דחה</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  modal.querySelector('#pm-close').onclick = () => modal.remove();
  modal.querySelector('#pm-approve').onclick = () => { modal.remove(); resolveApproval(p, 'approved', familyId); };
  modal.querySelector('#pm-reject').onclick  = () => { modal.remove(); resolveApproval(p, 'rejected', familyId); };
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
}

// =========== PHOTO LIGHTBOX (היסטוריה) ===========
function showPhotoLightbox(photoUrl) {
  const existing = document.getElementById('photo-lightbox-overlay');
  if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'photo-lightbox-overlay';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.95);z-index:4000;display:flex;align-items:center;justify-content:center;padding:20px;';
  modal.innerHTML = `
    <div style="position:relative;width:100%;max-width:440px;">
      <button id="lb-close" style="position:absolute;top:-14px;left:0;background:rgba(255,255,255,0.15);border:none;border-radius:50%;width:36px;height:36px;color:white;font-size:1.1rem;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:1;">✕</button>
      <img src="${photoUrl}" style="width:100%;max-height:72vh;object-fit:contain;border-radius:16px;display:block;" />
    </div>`;
  document.body.appendChild(modal);
  modal.querySelector('#lb-close').onclick = () => modal.remove();
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
}

// =========== RESTORE REJECTED ITEMS ===========
async function _restoreRejectedTask(familyId, item) {
  showConfirm({
    icon: item.emoji || '⭐',
    title: `לאשר בדיעבד: ${item.task}?`,
    message: `${item.childName} יקבל ${'⭐'.repeat(Math.min(item.pts||0,5)) || item.pts + ' ⭐'}`,
    confirmText: '✅ אשר',
    confirmColor: 'linear-gradient(135deg,#7C3AED,#5B21B6)',
    onConfirm: async () => {
      await _doResolve(item, 'approved', familyId);
      await Promise.all([loadRejectedItems(familyId), loadCompletedTasks(familyId)]);
      renderMPList(familyId);
    },
  });
}

async function _restoreRejectedPrize(familyId, item) {
  showConfirm({
    icon: item.prizeEmoji || '🎁',
    title: `לאשר בדיעבד: ${item.prizeName}?`,
    message: `${item.childName} יממש את הפרס (⭐ ${item.pts})`,
    confirmText: '✅ אשר',
    confirmColor: 'linear-gradient(135deg,#7C3AED,#5B21B6)',
    onConfirm: async () => {
      await approvePrizeRequest(familyId, item.id);
      await Promise.all([loadRejectedItems(familyId), loadAllPrizeRequests(familyId)]);
      renderMPTabs(familyId);
      renderMPList(familyId);
    },
  });
}

// =========== RE-APPROVE / PERMANENTLY CANCEL ===========
async function _reApproveTask(familyId, item) {
  showConfirm({
    icon: item.emoji || '⭐',
    title: `לאשר בכל זאת: ${item.task}?`,
    message: `${item.childName} יקבל בחזרה ${item.pts} ⭐`,
    confirmText: '✅ אשר',
    confirmColor: 'linear-gradient(135deg,#7C3AED,#5B21B6)',
    onConfirm: async () => {
      showLoading('מאשר...');
      try {
        // עדכן סטטוס לאושר
        await updateDoc(doc(db, 'families', familyId, 'pendingApprovals', item.id), {
          status: 'approved', resolvedAt: Date.now(),
        });

        // החזר כוכבים + הוסף להיסטוריה (comp נשאר כמו שהוא)
        const stateRef  = doc(db, 'families', familyId, 'children', item.childId, 'state', 'current');
        const stateSnap = await getDoc(stateRef);
        if (stateSnap.exists()) {
          const cs = stateSnap.data();
          cs.pts = (cs.pts || 0) + (item.pts || 0);
          if (!cs.hist) cs.hist = [];
          const dateKey = item.ts ? new Date(item.ts).toISOString().slice(0,10) : new Date().toISOString().slice(0,10);
          cs.hist.unshift({
            taskId: item.taskId, task: item.task, emoji: item.emoji || '⭐',
            pts: item.pts || 0, time: item.time || '', day: item.day || '',
            ts: item.ts || Date.now(),
          });
          if (cs.hist.length > 50) cs.hist.pop();
          if (!cs.dailyPts) cs.dailyPts = {};
          cs.dailyPts[dateKey] = (cs.dailyPts[dateKey] || 0) + (item.pts || 0);
          await updateDoc(stateRef, cs);
        }

        // התראה לילד
        await addDoc(collection(db, 'families', familyId, 'children', item.childId, 'notifications'), {
          type: 'task_approved', taskName: item.task, emoji: item.emoji || '✅',
          pts: item.pts || 0,
          message: `המשימה "${item.task}" אושרה בדיעבד! קיבלת ${item.pts} ⭐`,
          read: false, ts: Date.now(),
        });

        hideLoading();
        showStarsAddedPopup(item.childName, item.pts);
        await Promise.all([loadCompletedTasks(familyId), loadCancelledTasks(familyId)]);
        renderMPTabs(familyId);
        renderPendingTab(familyId);
        renderMPList(familyId);
      } catch(e) { hideLoading(); console.error(e); showToast('שגיאה, נסה שוב'); }
    },
  });
}

async function _permanentlyCancelTask(familyId, item) {
  showConfirm({
    icon: '🗑',
    title: `לבטל סופית: ${item.task}?`,
    message: `המשימה תחזור להיות זמינה לביצוע מחדש`,
    confirmText: '🗑 בטל סופית',
    confirmColor: 'linear-gradient(135deg,#EF4444,#B91C1C)',
    onConfirm: async () => {
      showLoading('מבטל סופית...');
      try {
        // עדכן סטטוס
        await updateDoc(doc(db, 'families', familyId, 'pendingApprovals', item.id), {
          status: 'permanently_cancelled', resolvedAt: Date.now(),
        });

        // נקה את comp[taskId] — המשימה תהיה זמינה שוב לילד
        const stateRef  = doc(db, 'families', familyId, 'children', item.childId, 'state', 'current');
        const stateSnap = await getDoc(stateRef);
        if (stateSnap.exists()) {
          const st = stateSnap.data();
          if (item.taskId && st.comp?.[item.taskId]) {
            const c = st.comp[item.taskId];
            c.wc = Math.max(0, (c.wc || 0) - 1);
            if (c.wc === 0) delete st.comp[item.taskId];
            else { c.d = ''; c.lastTs = 0; }
            await updateDoc(stateRef, st);
          }
        }

        hideLoading();
        showToast('בוטל סופית — המשימה זמינה שוב');
        await loadCancelledTasks(familyId);
        renderMPTabs(familyId);
        renderPendingTab(familyId);
      } catch(e) { hideLoading(); console.error(e); showToast('שגיאה, נסה שוב'); }
    },
  });
}

// =========== STARS ADDED POPUP ===========
function showStarsAddedPopup(childName, pts) {
  const existing = document.getElementById('stars-popup-overlay');
  if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'stars-popup-overlay';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.45);z-index:4000;display:flex;align-items:center;justify-content:center;padding:20px;pointer-events:none;';
  modal.innerHTML = `
    <div style="background:white;border-radius:24px;padding:28px 32px;text-align:center;box-shadow:0 20px 60px rgba(124,58,237,0.2);animation:fadeIn 0.2s ease;pointer-events:auto;">
      <div style="font-size:2.8rem;margin-bottom:6px;">⭐</div>
      <div style="font-size:1.15rem;font-weight:900;color:#0F172A;margin-bottom:4px;">אושר!</div>
      <div style="font-size:0.88rem;color:#64748B;font-weight:600;">${childName} קיבל/ה ${pts} כוכבים</div>
    </div>`;
  document.body.appendChild(modal);
  setTimeout(() => modal.remove(), 2200);
}
