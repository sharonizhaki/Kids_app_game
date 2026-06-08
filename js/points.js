// =========== points.js ===========
import { db } from './firebase.js';
import {
  doc, getDoc, getDocs, updateDoc, addDoc, collection, onSnapshot, query, orderBy, where,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { showToast, showLoading, hideLoading, showConfirm } from './ui.js';
import { childrenCache, loadChildren } from './family.js';
import { FREQ_LABELS } from './tasks.js';
import { loadPrizeRequests, approvePrizeRequest, declinePrizeRequest, reversePrizeRequest } from './prizes.js';

// =========== STATE ===========
let allCompletedTasks  = [];
let allPendingApprovals = [];
let allPrizeRequests   = [];
let allRejectedItems   = [];
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
  if (mpTab === 'history')  { renderMPFilters(); renderMPList(familyId); }
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
  for (const child of childrenCache) {
    try {
      const stateSnap = await getDoc(doc(db, 'families', familyId, 'children', child.id, 'state', 'current'));
      if (!stateSnap.exists()) continue;
      const st = stateSnap.data();
      if (!st.hist?.length) continue;
      st.hist.forEach((h, idx) => {
        const taskInfo = taskMap[h.task] || {};
        allCompletedTasks.push({
          childId: child.id, childName: child.name,
          childEmoji: child.emoji || (child.gender === 'female' ? '👧' : '👦'),
          childColor: child.color || '#6366F1',
          task: h.task, emoji: h.emoji || taskInfo.emoji || '⭐',
          pts: h.pts || 0, cat: taskInfo.cat || '',
          time: h.time || '', day: h.day || '', ts: h.ts || 0, histIdx: idx,
          photoUrl: h.photoUrl || '',
        });
      });
    } catch(e) {}
  }
  allCompletedTasks.sort((a, b) => (b.ts || 0) - (a.ts || 0));
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
  const approvedPrizes  = allPrizeRequests.filter(r => r.status === 'approved')
                            .sort((a, b) => (b.requestedAt?.toMillis?.() || b.requestedAt || 0)
                                          - (a.requestedAt?.toMillis?.() || a.requestedAt || 0))
                            .slice(0, 10);

  if (pendingTasks.length === 0 && pendingPrizes.length === 0 && approvedPrizes.length === 0) {
    list.innerHTML = '<div class="empty-state" style="padding:40px 0;">🎉<br><br>אין בקשות ממתינות</div>';
    return;
  }

  list.innerHTML = '';

  // משימות ממתינות
  if (pendingTasks.length > 0) {
    const sec = document.createElement('div');
    sec.innerHTML = `<div class="mp-section-title" style="display:flex;align-items:center;gap:6px;margin-bottom:8px;">
      <span style="font-size:1rem;">✅</span><span>אישור משימות</span>
      <span style="background:#6366F1;color:white;border-radius:10px;font-size:0.7rem;font-weight:900;padding:1px 7px;">${pendingTasks.length}</span>
    </div>`;
    pendingTasks.forEach(p => {
      const child = childrenCache.find(c => c.id === p.childId);
      const childDisplay = child ? `${child.emoji || '👦'} ${child.name}` : p.childName || 'ילד';
      const card = document.createElement('div');
      card.className = 'approval-card';
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
      <span style="background:#F59E0B;color:white;border-radius:10px;font-size:0.7rem;font-weight:900;padding:1px 7px;">${pendingPrizes.length}</span>
    </div>`;
    pendingPrizes.forEach(r => {
      const child = childrenCache.find(c => c.id === r.childId);
      const childDisplay = child ? `${child.emoji || '👦'} ${child.name}` : r.childName || 'ילד';
      const card = document.createElement('div');
      card.style.cssText = 'background:white;border-radius:16px;padding:14px 16px;margin-bottom:8px;box-shadow:0 2px 8px rgba(0,0,0,0.06);display:flex;align-items:center;gap:10px;';
      card.innerHTML = `
        <span style="font-size:1.8rem;">${r.prizeEmoji || '🎁'}</span>
        <div style="flex:1;min-width:0;">
          <div style="font-weight:800;font-size:0.92rem;color:#0F172A;margin-bottom:2px;">${r.prizeName || r.name || ''}</div>
          <div style="font-size:0.78rem;color:#64748B;">${childDisplay} · ⭐ ${r.pts || r.cost || 0}</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;">
          <button class="btn-prize-approve" style="background:linear-gradient(135deg,#F59E0B,#D97706);color:white;border:none;border-radius:10px;padding:6px 12px;font-size:0.78rem;font-weight:800;font-family:'Heebo',sans-serif;cursor:pointer;">✅ אשר</button>
          <button class="btn-prize-reject" style="background:#FEE2E2;color:#B91C1C;border:none;border-radius:10px;padding:6px 12px;font-size:0.78rem;font-weight:800;font-family:'Heebo',sans-serif;cursor:pointer;">❌ דחה</button>
        </div>`;
      card.querySelector('.btn-prize-approve').onclick = async () => {
        showConfirm({ icon: r.prizeEmoji || '🎁', title: `לאשר: ${r.prizeName || r.name}?`,
          message: `${child?.name || ''} יממש את הפרס`, confirmText: '✅ אשר',
          confirmColor: 'linear-gradient(135deg,#F59E0B,#D97706)',
          onConfirm: async () => {
            await approvePrizeRequest(familyId, r.id);
            await loadAllPrizeRequests(familyId);
            renderMPTabs(familyId); renderPendingTab(familyId);
          }
        });
      };
      card.querySelector('.btn-prize-reject').onclick = async () => {
        await declinePrizeRequest(familyId, r.id);
        await loadAllPrizeRequests(familyId);
        renderMPTabs(familyId); renderPendingTab(familyId);
      };
      sec.appendChild(card);
    });
    list.appendChild(sec);
  }

  // פרסים שכבר אושרו — אפשר לבטל
  if (approvedPrizes.length > 0) {
    const sec = document.createElement('div');
    sec.style.marginTop = (pendingTasks.length > 0 || pendingPrizes.length > 0) ? '20px' : '0';
    sec.innerHTML = `<div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;font-size:0.82rem;font-weight:800;color:#64748B;">
      <span>🎁</span><span>פרסים שמומשו</span>
      <span style="font-size:0.7rem;color:#94A3B8;font-weight:600;">(אפשר לבטל)</span>
    </div>`;
    approvedPrizes.forEach(r => {
      const child = childrenCache.find(c => c.id === r.childId);
      const childDisplay = child ? `${child.emoji || '👦'} ${child.name}` : r.childName || 'ילד';
      const dateStr = r.requestedAt?.toDate
        ? r.requestedAt.toDate().toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' })
        : r.requestedAt
          ? new Date(r.requestedAt).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' })
          : '';
      const card = document.createElement('div');
      card.style.cssText = 'background:#FFFBEB;border:1.5px solid #FDE68A;border-radius:16px;padding:12px 14px;margin-bottom:8px;display:flex;align-items:center;gap:10px;';
      card.innerHTML = `
        <span style="font-size:1.6rem;">${r.prizeEmoji || '🎁'}</span>
        <div style="flex:1;min-width:0;">
          <div style="font-weight:800;font-size:0.9rem;color:#0F172A;margin-bottom:2px;">${r.prizeName || r.name || ''}</div>
          <div style="font-size:0.75rem;color:#92400E;">${childDisplay} · ⭐ ${r.pts || r.cost || 0} · ${dateStr}</div>
        </div>
        <button class="btn-prize-reverse"
          style="background:#FEF3C7;color:#92400E;border:1.5px solid #FDE68A;border-radius:10px;padding:6px 10px;
                 font-size:0.75rem;font-weight:800;font-family:'Heebo',sans-serif;cursor:pointer;white-space:nowrap;">
          ↩️ בטל
        </button>`;
      card.querySelector('.btn-prize-reverse').onclick = () => {
        showConfirm({
          icon: r.prizeEmoji || '🎁',
          title: `לבטל: ${r.prizeName || r.name}?`,
          message: `${child?.name || ''} יקבל בחזרה ${r.pts || r.cost || 0} ⭐`,
          confirmText: '↩️ בטל מימוש',
          confirmColor: 'linear-gradient(135deg,#F59E0B,#D97706)',
          onConfirm: async () => {
            await reversePrizeRequest(familyId, r.id);
            await loadAllPrizeRequests(familyId);
            renderMPTabs(familyId); renderPendingTab(familyId);
          }
        });
      };
      sec.appendChild(card);
    });
    list.appendChild(sec);
  }
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
  } else if (mpFilter === 'day') {
    options = [
      { key: 'ראשון', label: "א'" }, { key: 'שני', label: "ב'" },
      { key: 'שלישי', label: "ג'" }, { key: 'רביעי', label: "ד'" },
      { key: 'חמישי', label: "ה'" }, { key: 'שישי', label: "ו'" },
      { key: 'שבת', label: "ש'" },
    ];
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
  let tasks = [...allCompletedTasks];
  if (mpFilter === 'child'  && mpSubFilter) tasks = tasks.filter(t => t.childName === mpSubFilter);
  if (mpFilter === 'cat'    && mpSubFilter) tasks = tasks.filter(t => (t.cat || '📋 ללא') === mpSubFilter);
  if (mpFilter === 'stars'  && mpSubFilter) tasks = tasks.filter(t => t.pts === parseInt(mpSubFilter));
  if (mpFilter === 'day'    && mpSubFilter) tasks = tasks.filter(t => t.day === mpSubFilter);
  if (tasks.length === 0) {
    list.innerHTML = allRejectedItems.length === 0
      ? '<div class="empty-state">אין משימות שבוצעו</div>'
      : '';
  }
  if (tasks.length > 0) list.innerHTML = tasks.map((t, i) => `
    <div class="etask-wrap" data-idx="${i}" data-child-id="${t.childId}" data-hist-idx="${t.histIdx}">
      <div class="etask-actions"><div class="etask-action act-delete" data-act="undo"><span>↩️</span>בטל</div></div>
      <div class="etask-card">
        <span class="etask-emoji">${t.emoji}</span>
        <div class="etask-info">
          <strong>${t.task}</strong>
          <div class="etask-meta">
            <span class="etask-tag child-tag">${t.childEmoji} ${t.childName}</span>
            ${t.cat ? `<span class="etask-tag cat-tag">${t.cat}</span>` : ''}
            <span class="etask-tag freq-tag">${t.day} ${t.time}</span>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
          <span class="etask-stars">${'⭐'.repeat(Math.min(t.pts||0,5))}</span>
          ${t.photoUrl ? `<button class="btn-hist-photo" data-idx="${i}" style="background:#EDE9FE;border:none;border-radius:8px;width:28px;height:28px;font-size:0.85rem;cursor:pointer;display:flex;align-items:center;justify-content:center;">📷</button>` : ''}
        </div>
      </div>
    </div>`).join('');
  attachMPSwipeHandlers(list, familyId || _familyId);
  list.querySelectorAll('.btn-hist-photo').forEach(btn => {
    const idx = parseInt(btn.dataset.idx);
    btn.onclick = (e) => { e.stopPropagation(); showPhotoLightbox(tasks[idx].photoUrl); };
  });

  // קטע "לא אושרו"
  if (allRejectedItems.length > 0) {
    const sec = document.createElement('div');
    sec.style.marginTop = tasks.length > 0 ? '20px' : '0';
    sec.innerHTML = `
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;font-size:0.82rem;font-weight:800;color:#64748B;">
        <span>❌</span><span>לא אושרו</span>
        <span style="font-size:0.7rem;color:#94A3B8;font-weight:600;">(אפשר לאשר בדיעבד)</span>
      </div>`;
    allRejectedItems.forEach(item => {
      const card = document.createElement('div');
      card.style.cssText = 'background:#FEF2F2;border:1.5px solid #FECACA;border-radius:14px;padding:12px 14px;margin-bottom:8px;display:flex;align-items:center;gap:10px;';
      if (item.type === 'rejected_task') {
        card.innerHTML = `
          <span style="font-size:1.6rem;">${item.emoji}</span>
          <div style="flex:1;min-width:0;">
            <div style="font-weight:800;font-size:0.88rem;color:#0F172A;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${item.task}</div>
            <div style="display:flex;align-items:center;gap:6px;margin-top:3px;flex-wrap:wrap;">
              <span style="background:#FEE2E2;color:#B91C1C;border-radius:6px;padding:1px 7px;font-size:0.68rem;font-weight:900;">❌ לא אושר</span>
              <span style="font-size:0.75rem;color:#64748B;">${item.childEmoji} ${item.childName}</span>
              <span style="font-size:0.75rem;color:#64748B;">${'⭐'.repeat(Math.min(item.pts||0,5)) || '⭐'}</span>
            </div>
          </div>
          ${item.photoUrl ? `<button class="btn-rej-photo" style="background:#EDE9FE;border:none;border-radius:8px;width:30px;height:30px;font-size:0.85rem;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;">📷</button>` : ''}
          <button class="btn-restore-task" style="background:linear-gradient(135deg,#7C3AED,#5B21B6);color:white;border:none;border-radius:10px;padding:7px 10px;font-size:0.73rem;font-weight:800;font-family:'Heebo',sans-serif;cursor:pointer;white-space:nowrap;flex-shrink:0;">✅ אשר</button>`;
        card.querySelector('.btn-restore-task').onclick = () => _restoreRejectedTask(familyId || _familyId, item);
        if (item.photoUrl) card.querySelector('.btn-rej-photo').onclick = () => showPhotoLightbox(item.photoUrl);
      } else {
        card.innerHTML = `
          <span style="font-size:1.6rem;">${item.prizeEmoji}</span>
          <div style="flex:1;min-width:0;">
            <div style="font-weight:800;font-size:0.88rem;color:#0F172A;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${item.prizeName}</div>
            <div style="display:flex;align-items:center;gap:6px;margin-top:3px;flex-wrap:wrap;">
              <span style="background:#FEE2E2;color:#B91C1C;border-radius:6px;padding:1px 7px;font-size:0.68rem;font-weight:900;">❌ לא אושר</span>
              <span style="font-size:0.75rem;color:#64748B;">${item.childEmoji} ${item.childName}</span>
              <span style="font-size:0.75rem;color:#64748B;">⭐ ${item.pts}</span>
            </div>
          </div>
          <button class="btn-restore-prize" style="background:linear-gradient(135deg,#F59E0B,#D97706);color:white;border:none;border-radius:10px;padding:7px 10px;font-size:0.73rem;font-weight:800;font-family:'Heebo',sans-serif;cursor:pointer;white-space:nowrap;flex-shrink:0;">✅ אשר</button>`;
        card.querySelector('.btn-restore-prize').onclick = () => _restoreRejectedPrize(familyId || _familyId, item);
      }
      sec.appendChild(card);
    });
    list.appendChild(sec);
  }
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
      <div style="background:white;border-radius:20px;padding:16px 18px;margin-bottom:12px;box-shadow:0 2px 12px rgba(0,0,0,0.06);">

        <div style="font-size:0.82rem;font-weight:800;color:#64748B;margin-bottom:10px;">👶 בחר ילד</div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:18px;">
          ${childrenCache.map(c => `
            <div data-child-id="${c.id}" class="manual-child-pill"
              style="display:flex;flex-direction:column;align-items:center;gap:4px;padding:8px 12px;
                     border-radius:16px;border:2.5px solid ${c.id === selChildId ? 'var(--primary)' : 'var(--border)'};
                     background:${c.id === selChildId ? '#EDE9FE' : 'white'};cursor:pointer;min-width:60px;transition:all 0.15s;">
              <span style="font-size:1.8rem;">${c.emoji || '👦'}</span>
              <span style="font-size:0.72rem;font-weight:800;color:${c.id === selChildId ? 'var(--primary)' : '#64748B'};">${c.name}</span>
            </div>`).join('')}
        </div>

        <div style="font-size:0.82rem;font-weight:800;color:#64748B;margin-bottom:8px;">📌 סוג פעולה</div>
        <div style="display:flex;gap:8px;margin-bottom:18px;">
          <button id="btn-type-add"
            style="flex:1;padding:10px;border-radius:12px;font-family:'Heebo',sans-serif;font-weight:900;font-size:0.88rem;cursor:pointer;transition:all 0.15s;
                   border:2px solid ${isAdding ? '#10B981' : 'var(--border)'};
                   background:${isAdding ? 'linear-gradient(135deg,#D1FAE5,#A7F3D0)' : 'white'};
                   color:${isAdding ? '#065F46' : '#64748B'};">➕ הוסף כוכבים</button>
          <button id="btn-type-remove"
            style="flex:1;padding:10px;border-radius:12px;font-family:'Heebo',sans-serif;font-weight:900;font-size:0.88rem;cursor:pointer;transition:all 0.15s;
                   border:2px solid ${!isAdding ? '#EF4444' : 'var(--border)'};
                   background:${!isAdding ? 'linear-gradient(135deg,#FEE2E2,#FECACA)' : 'white'};
                   color:${!isAdding ? '#B91C1C' : '#64748B'};">➖ הפחת כוכבים</button>
        </div>

        <div style="font-size:0.82rem;font-weight:800;color:#64748B;margin-bottom:8px;">⭐ כמות</div>
        <div style="display:flex;align-items:center;justify-content:center;gap:20px;margin-bottom:18px;">
          <button id="btn-amt-minus"
            style="width:46px;height:46px;border-radius:50%;border:2px solid var(--border);background:white;
                   font-size:1.5rem;font-weight:900;cursor:pointer;color:#64748B;font-family:'Heebo',sans-serif;line-height:1;">−</button>
          <div style="text-align:center;min-width:64px;">
            <div style="font-size:3rem;font-weight:900;color:${isAdding ? '#10B981' : '#EF4444'};line-height:1;">${manualAmt}</div>
            <div style="font-size:0.72rem;color:#94A3B8;font-weight:700;">כוכבים ⭐</div>
          </div>
          <button id="btn-amt-plus"
            style="width:46px;height:46px;border-radius:50%;border:2px solid var(--border);background:white;
                   font-size:1.5rem;font-weight:900;cursor:pointer;color:#64748B;font-family:'Heebo',sans-serif;line-height:1;">+</button>
        </div>

        <div style="font-size:0.82rem;font-weight:800;color:#64748B;margin-bottom:6px;">📝 סיבה (לא חובה)</div>
        <textarea id="manual-reason" rows="3"
          placeholder="לדוגמה: עזרה ספונטנית בבישול&#10;התנהגות יוצאת דופן&#10;תיקון שגיאת ניקוד"
          style="width:100%;border:2px solid var(--border);border-radius:12px;padding:10px 12px;
                 font-size:0.85rem;font-family:'Heebo',sans-serif;resize:none;box-sizing:border-box;
                 outline:none;color:#0F172A;background:#F8FAFC;direction:rtl;"></textarea>

        <button id="btn-manual-submit"
          style="width:100%;margin-top:14px;padding:14px;border-radius:14px;font-size:1rem;font-weight:900;
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

    await addDoc(collection(db, 'families', familyId, 'children', childId, 'notifications'), {
      type:    'manual_pts',
      pts:      amount,
      isAdd,
      reason,
      message: `${isAdd ? '➕' : '➖'} ${amount} ⭐${reason ? `: ${reason}` : ''}`,
      read:    false,
      ts:      Date.now(),
    });

    hideLoading();
    const child = childrenCache.find(c => c.id === childId);
    showToast(`${isAdd ? '➕' : '➖'} ${amount} ⭐ עודכן עבור ${child?.name || 'ילד'}`);
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
    await loadPendingApprovals(familyId);
    renderMPTabs(familyId);
    renderPendingTab(familyId);
  } catch(e) { hideLoading(); console.error(e); showToast('שגיאה, נסה שוב'); }
}

// =========== SWIPE ===========
function attachMPSwipeHandlers(list, familyId) {
  list.querySelectorAll('.etask-wrap').forEach(wrap => {
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
        confirmText: 'בטל ביצוע', confirmColor: 'linear-gradient(135deg,#F59E0B,#D97706)',
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
        st.pts = Math.max(0, (st.pts || 0) - (histItem.pts || 0));
        st.hist.splice(histIdx, 1);
        const tasksSnap = await getDocs(collection(db, 'families', familyId, 'tasks'));
        tasksSnap.forEach(d => {
          const td = d.data();
          if (td.task === histItem.task && st.comp?.[d.id]) {
            const c = st.comp[d.id];
            c.wc = Math.max(0, (c.wc || 0) - 1);
            if (c.wc === 0) delete st.comp[d.id];
            else { c.d = ''; c.lastTs = 0; }
          }
        });
        await updateDoc(stateRef, st);

        // התראה לילד על ביטול המשימה
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
    await loadCompletedTasks(familyId);
    hideLoading();
    showToast('ביצוע בוטל ↩️');
    renderMPList(familyId);
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
    confirmColor: 'linear-gradient(135deg,#F59E0B,#D97706)',
    onConfirm: async () => {
      await approvePrizeRequest(familyId, item.id);
      await Promise.all([loadRejectedItems(familyId), loadAllPrizeRequests(familyId)]);
      renderMPTabs(familyId);
      renderMPList(familyId);
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
