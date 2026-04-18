// =========== points.js ===========
import { db } from './firebase.js';
import {
  doc, getDoc, getDocs, updateDoc, collection, onSnapshot, query, orderBy,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { showToast, showLoading, hideLoading, showConfirm } from './ui.js';
import { childrenCache, loadChildren } from './family.js';
import { FREQ_LABELS } from './tasks.js';
import { loadPrizeRequests, approvePrizeRequest, declinePrizeRequest } from './prizes.js';

// =========== STATE ===========
let allCompletedTasks  = [];
let allPendingApprovals = [];
let allPrizeRequests   = [];
let mpFilter    = 'all';
let mpSubFilter = '';
let mpTab       = 'pending';
let _familyId   = '';

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
    { key: 'pending',  label: '⏳ ממתינים', badge: totalPending },
    { key: 'history',  label: '📋 היסטוריה', badge: 0 },
    { key: 'summary',  label: '📊 סיכום',    badge: 0 },
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
  if (mpTab === 'summary')  renderSummaryTab(familyId);
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

  const pendingTasks  = allPendingApprovals.filter(p => p.status === 'pending');
  const pendingPrizes = allPrizeRequests.filter(r => r.status === 'pending');

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
          <div style="font-size:0.78rem;color:#64748B;">${childDisplay} · ${p.pts} ⭐ · ${p.day || ''} ${p.time || ''}</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;">
          <button class="btn-approve" style="background:linear-gradient(135deg,#10B981,#059669);color:white;border:none;border-radius:10px;padding:6px 12px;font-size:0.78rem;font-weight:800;font-family:'Heebo',sans-serif;cursor:pointer;">✅ אשר</button>
          <button class="btn-reject" style="background:#FEE2E2;color:#B91C1C;border:none;border-radius:10px;padding:6px 12px;font-size:0.78rem;font-weight:800;font-family:'Heebo',sans-serif;cursor:pointer;">❌ דחה</button>
        </div>`;
      card.querySelector('.btn-approve').onclick = () => resolveApproval(p, 'approved', familyId);
      card.querySelector('.btn-reject').onclick  = () => resolveApproval(p, 'rejected', familyId);
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
          <div style="font-size:0.78rem;color:#64748B;">${childDisplay} · ${r.pts || r.cost || 0} ⭐</div>
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
  if (tasks.length === 0) { list.innerHTML = '<div class="empty-state">אין מטלות שבוצעו</div>'; return; }
  list.innerHTML = tasks.map((t, i) => `
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
        <span class="etask-stars">${'⭐'.repeat(Math.min(t.pts||0,5))}</span>
      </div>
    </div>`).join('');
  attachMPSwipeHandlers(list, familyId || _familyId);
}

// =========== TAB: סיכום (פיד כרונולוגי) ===========
function renderSummaryTab(familyId) {
  const list = document.getElementById('mp-summary-list');
  if (!list) return;

  // מיזוג משימות + פרסים ממומשים לפיד אחד
  const feed = [];
  allCompletedTasks.forEach(t => {
    feed.push({ type: 'task', ts: t.ts, emoji: t.emoji, title: t.task,
      childName: t.childName, childEmoji: t.childEmoji, childColor: t.childColor || '#6366F1', pts: t.pts });
  });
  allPrizeRequests.filter(r => r.status === 'approved').forEach(r => {
    const child = childrenCache.find(c => c.id === r.childId);
    feed.push({ type: 'prize', ts: r.requestedAt?.toMillis?.() || r.requestedAt || 0,
      emoji: r.prizeEmoji || '🎁', title: r.prizeName || r.name || 'פרס',
      childName: child?.name || r.childName || '', childEmoji: child?.emoji || '👦',
      childColor: child?.color || '#F59E0B', pts: -(r.pts || r.cost || 0) });
  });
  feed.sort((a, b) => (b.ts || 0) - (a.ts || 0));

  if (feed.length === 0) { list.innerHTML = '<div class="empty-state">אין פעילות להצגה</div>'; return; }

  // כוכבים שבועיים לכל ילד
  const weeklyStars = {};
  childrenCache.forEach(c => { weeklyStars[c.name] = 0; });
  allCompletedTasks.forEach(t => {
    if (!weeklyStars[t.childName]) weeklyStars[t.childName] = 0;
    weeklyStars[t.childName] += t.pts || 0;
  });

  const summaryCards = childrenCache.map(child => {
    const stars = weeklyStars[child.name] || 0;
    return `<div style="background:white;border-radius:16px;padding:12px 16px;display:flex;align-items:center;gap:10px;box-shadow:0 2px 8px rgba(0,0,0,0.06);margin-bottom:8px;">
      <span style="font-size:1.6rem;">${child.emoji || '👦'}</span>
      <div style="flex:1;">
        <div style="font-weight:800;font-size:0.9rem;color:#0F172A;">${child.name}</div>
        <div style="font-size:0.78rem;color:#64748B;">השבוע</div>
      </div>
      <div style="font-size:1rem;font-weight:900;color:#D97706;background:#FEF3C7;border-radius:10px;padding:4px 10px;">${stars} ⭐</div>
    </div>`;
  }).join('');

  const feedHTML = feed.slice(0, 50).map(item => {
    const time = item.ts ? new Date(item.ts).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }) : '';
    const date = item.ts ? new Date(item.ts).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' }) : '';
    const isTask = item.type === 'task';
    const ptsLabel = isTask
      ? `<span style="font-size:0.78rem;font-weight:900;color:#D97706;background:#FEF3C7;border-radius:8px;padding:1px 7px;">+${item.pts} ⭐</span>`
      : `<span style="font-size:0.78rem;font-weight:900;color:#B91C1C;background:#FEE2E2;border-radius:8px;padding:1px 7px;">${item.pts} ⭐</span>`;
    return `
      <div style="background:white;border-radius:14px;padding:11px 14px;margin-bottom:7px;box-shadow:0 2px 6px rgba(0,0,0,0.05);display:flex;align-items:center;gap:10px;">
        <div style="width:38px;height:38px;border-radius:50%;background:${item.childColor}22;display:flex;align-items:center;justify-content:center;font-size:1.3rem;flex-shrink:0;">${item.emoji}</div>
        <div style="flex:1;min-width:0;">
          <div style="font-weight:800;font-size:0.88rem;color:#0F172A;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${item.title}</div>
          <div style="font-size:0.74rem;color:#94A3B8;">${item.childEmoji} ${item.childName} · ${date} ${time}</div>
        </div>
        ${ptsLabel}
      </div>`;
  }).join('');

  list.innerHTML = `
    <div style="font-size:0.82rem;font-weight:800;color:#64748B;margin-bottom:8px;">כוכבים השבוע</div>
    ${summaryCards}
    <div style="font-size:0.82rem;font-weight:800;color:#64748B;margin:16px 0 8px;">פעילות אחרונה</div>
    ${feedHTML}`;
}

// =========== APPROVAL ===========
async function resolveApproval(p, status, familyId) {
  if (status === 'approved') {
    showConfirm({ icon: p.emoji || '⭐', title: `לאשר: ${p.task}?`,
      message: `${p.childName} יקבל/תקבל ${p.pts} ⭐`,
      confirmText: '✅ אשר', confirmColor: 'linear-gradient(135deg,#10B981,#059669)',
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
          pts: p.pts || 0, time: p.time || '', day: p.day || '', ts: p.ts || Date.now() });
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
    showToast(status === 'approved' ? '✅ אושר! כוכבים נוספו' : '❌ הבקשה נדחתה');
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
      showConfirm({ icon: '↩️', title: 'לבטל את ביצוע המטלה?', message: 'הכוכבים יורדו מהילד',
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
      }
    }
    await loadCompletedTasks(familyId);
    hideLoading();
    showToast('ביצוע בוטל ↩️');
    renderMPList(familyId);
  } catch(e) { hideLoading(); console.error(e); }
}
