// =========== points.js ===========
// ניהול ניקוד + אישור/דחיית ביצועים שדורשים אישור הורה.

import { db } from './firebase.js';
import {
  doc, getDoc, getDocs, updateDoc, collection, onSnapshot,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { showToast, showLoading, hideLoading, showConfirm } from './ui.js';
import { childrenCache, loadChildren } from './family.js';
import { FREQ_LABELS } from './tasks.js';

// =========== STATE ===========
let allCompletedTasks = [];
let allPendingApprovals = [];
let mpFilter    = 'all';
let mpSubFilter = '';
let mpTab       = 'completed'; // 'completed' | 'pending'

// =========== TABS ===========
export function renderMPTabs(familyId) {
  const tabsEl = document.getElementById('mp-tabs');
  if (!tabsEl) return;

  const pendingCount = allPendingApprovals.filter(p => p.status === 'pending').length;
  tabsEl.innerHTML = `
    <button class="mp-tab${mpTab==='completed'?' active':''}" data-tab="completed">📋 בוצעו</button>
    <button class="mp-tab${mpTab==='pending'?' active':''}" data-tab="pending">
      ⏳ ממתין לאישור
      ${pendingCount > 0 ? `<span class="mp-tab-badge">${pendingCount}</span>` : ''}
    </button>`;

  tabsEl.querySelectorAll('.mp-tab').forEach(btn => {
    btn.onclick = () => {
      mpTab = btn.dataset.tab;
      renderMPTabs(familyId);
      if (mpTab === 'completed') {
        document.getElementById('mp-filter-section').style.display = '';
        renderMPList(familyId);
      } else {
        document.getElementById('mp-filter-section').style.display = 'none';
        renderPendingList(familyId);
      }
    };
  });
}

// =========== LOAD COMPLETED TASKS ===========
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
          childId:    child.id,
          childName:  child.name,
          childEmoji: child.emoji || (child.gender === 'female' ? '👧' : '👦'),
          task:   h.task,
          emoji:  h.emoji || taskInfo.emoji || '⭐',
          pts:    h.pts || 0,
          cat:    taskInfo.cat || '',
          time:   h.time || '',
          day:    h.day  || '',
          ts:     h.ts   || 0,
          histIdx: idx,
        });
      });
    } catch(e) { console.error(e); }
  }
  allCompletedTasks.sort((a, b) => (b.ts || 0) - (a.ts || 0));
}

// =========== LOAD PENDING APPROVALS ===========
export async function loadPendingApprovals(familyId) {
  allPendingApprovals = [];
  await loadChildren(familyId);
  try {
    const snap = await getDocs(collection(db, 'families', familyId, 'pendingApprovals'));
    allPendingApprovals = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.ts || 0) - (a.ts || 0));
  } catch(e) { console.error(e); }
}

// =========== LIVE LISTENER FOR PENDING ===========
export function initPendingListener(familyId, onUpdate) {
  return onSnapshot(
    collection(db, 'families', familyId, 'pendingApprovals'),
    async () => {
      await loadPendingApprovals(familyId);
      onUpdate();
    }
  );
}

// =========== RENDER PENDING LIST ===========
export function renderPendingList(familyId) {
  const list = document.getElementById('mp-list');
  if (!list) return;

  const pending  = allPendingApprovals.filter(p => p.status === 'pending');
  const resolved = allPendingApprovals.filter(p => p.status !== 'pending');

  if (allPendingApprovals.length === 0) {
    list.innerHTML = '<div class="empty-state">אין בקשות ממתינות 🎉</div>';
    return;
  }

  list.innerHTML = '';

  if (pending.length > 0) {
    const title = document.createElement('div');
    title.className = 'mp-section-title';
    title.textContent = 'ממתין לאישורך';
    list.appendChild(title);
    pending.forEach(p => list.appendChild(buildApprovalCard(p, familyId, true)));
  }

  if (resolved.length > 0) {
    const title = document.createElement('div');
    title.className = 'mp-section-title';
    title.style.marginTop = '16px';
    title.textContent = 'טופלו';
    list.appendChild(title);
    resolved.slice(0, 20).forEach(p => list.appendChild(buildApprovalCard(p, familyId, false)));
  }
}

function buildApprovalCard(p, familyId, showActions) {
  const child = childrenCache.find(c => c.id === p.childId);
  const childDisplay = child ? `${child.emoji || '👦'} ${child.name}` : p.childName || 'ילד';

  const STATUS_LABEL = { pending: '⏳ ממתין', approved: '✅ אושר', rejected: '❌ נדחה' };
  const STATUS_CLS   = { pending: 'status-pending', approved: 'status-approved', rejected: 'status-rejected' };

  const card = document.createElement('div');
  card.className = 'approval-card';
  card.innerHTML = `
    <span class="approval-emoji">${p.emoji || '⭐'}</span>
    <div class="approval-info">
      <strong>${p.task}</strong>
      <span>${childDisplay} · ${'⭐'.repeat(Math.min(p.pts||0,5))} · ${p.day || ''} ${p.time || ''}</span>
    </div>
    <div class="approval-right">
      <span class="approval-status-badge ${STATUS_CLS[p.status] || ''}">${STATUS_LABEL[p.status] || ''}</span>
      ${showActions ? `
        <div class="approval-btns">
          <button class="approval-btn approve-btn" data-id="${p.id}">✅ אשר</button>
          <button class="approval-btn reject-btn"  data-id="${p.id}">❌ דחה</button>
        </div>` : ''}
    </div>`;

  if (showActions) {
    card.querySelector('.approve-btn').onclick = () => resolveApproval(p, 'approved', familyId);
    card.querySelector('.reject-btn').onclick  = () => resolveApproval(p, 'rejected', familyId);
  }
  return card;
}

// =========== RESOLVE APPROVAL ===========
async function resolveApproval(p, status, familyId) {
  if (status === 'approved') {
    showConfirm({
      icon:        p.emoji || '⭐',
      title:       `לאשר: ${p.task}?`,
      message:     `${p.childName} יקבל/תקבל ${p.pts} ⭐`,
      confirmText: '✅ אשר',
      confirmColor: 'linear-gradient(135deg,#10B981,#059669)',
      onConfirm:   () => _doResolve(p, 'approved', familyId),
    });
  } else {
    _doResolve(p, 'rejected', familyId);
  }
}

async function _doResolve(p, status, familyId) {
  showLoading(status === 'approved' ? 'מאשר...' : 'דוחה...');
  try {
    // עדכן את pendingApprovals doc
    await updateDoc(
      doc(db, 'families', familyId, 'pendingApprovals', p.id),
      { status, resolvedAt: Date.now() }
    );

    if (status === 'approved') {
      // הוסף כוכבים לילד — עדכן childState
      const stateRef  = doc(db, 'families', familyId, 'children', p.childId, 'state', 'current');
      const stateSnap = await getDoc(stateRef);
      if (stateSnap.exists()) {
        const cs = stateSnap.data();

        // כוכבים
        cs.pts = (cs.pts || 0) + (p.pts || 0);

        // comp
        if (!cs.comp) cs.comp = {};
        const c = cs.comp[p.taskId] || { wc: 0, d: '', count: 0, lastTs: 0 };
        const dateKey = p.ts
          ? new Date(p.ts).toISOString().slice(0,10)
          : new Date().toISOString().slice(0,10);
        c.wc++; c.d = dateKey; c.count++; c.lastTs = p.ts || Date.now();
        cs.comp[p.taskId] = c;

        // dailyPts
        if (!cs.dailyPts) cs.dailyPts = {};
        cs.dailyPts[dateKey] = (cs.dailyPts[dateKey] || 0) + (p.pts || 0);

        // hist
        if (!cs.hist) cs.hist = [];
        cs.hist.unshift({
          taskId: p.taskId,
          task:   p.task,
          emoji:  p.emoji || '⭐',
          pts:    p.pts || 0,
          time:   p.time || '',
          day:    p.day  || '',
          ts:     p.ts   || Date.now(),
        });
        if (cs.hist.length > 50) cs.hist.pop();

        // הסר מ-pending המקומי של הילד
        if (cs.pending) {
          cs.pending = cs.pending.map(pp =>
            pp.taskId === p.taskId && Math.abs((pp.ts||0) - (p.ts||0)) < 5000
              ? { ...pp, status: 'approved' }
              : pp
          );
        }

        await updateDoc(stateRef, cs);
      }
    } else {
      // rejected — סמן בpending של הילד
      const stateRef  = doc(db, 'families', familyId, 'children', p.childId, 'state', 'current');
      const stateSnap = await getDoc(stateRef);
      if (stateSnap.exists()) {
        const cs = stateSnap.data();
        if (cs.pending) {
          cs.pending = cs.pending.map(pp =>
            pp.taskId === p.taskId && Math.abs((pp.ts||0) - (p.ts||0)) < 5000
              ? { ...pp, status: 'rejected' }
              : pp
          );
          await updateDoc(stateRef, { pending: cs.pending });
        }
      }
    }

    hideLoading();
    showToast(status === 'approved' ? '✅ אושר! כוכבים נוספו' : '❌ הבקשה נדחתה');
    await loadPendingApprovals(familyId);
    renderPendingList(familyId);
    renderMPTabs(familyId);
  } catch (e) {
    hideLoading();
    console.error('resolveApproval error:', e);
    showToast('שגיאה, נסה שוב');
  }
}

// =========== RENDER FILTERS (completed tab) ===========
export function renderMPFilters() {
  document.querySelectorAll('#mp-filter .filter-chip').forEach(f => {
    f.classList.toggle('active', f.dataset.filter === mpFilter);
    f.onclick = () => {
      mpFilter    = f.dataset.filter;
      mpSubFilter = '';
      renderMPFilters();
      renderMPSubFilter();
      renderMPList();
    };
  });
  renderMPSubFilter();
}

function renderMPSubFilter() {
  const sub = document.getElementById('mp-sub-filter');
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
      { key: 'ראשון', label: "א'" }, { key: 'שני',   label: "ב'" },
      { key: 'שלישי', label: "ג'" }, { key: 'רביעי', label: "ד'" },
      { key: 'חמישי', label: "ה'" }, { key: 'שישי',  label: "ו'" },
      { key: 'שבת',   label: "ש'" },
    ];
  }

  sub.style.display = 'flex';
  sub.innerHTML = options.map(o =>
    `<span class="sub-chip${mpSubFilter===o.key?' active':''}" data-key="${o.key}">${o.label}</span>`
  ).join('');
  sub.querySelectorAll('.sub-chip').forEach(chip => {
    chip.onclick = () => {
      mpSubFilter = mpSubFilter === chip.dataset.key ? '' : chip.dataset.key;
      renderMPSubFilter();
      renderMPList();
    };
  });
}

// =========== RENDER COMPLETED LIST ===========
export function renderMPList(familyId) {
  const list = document.getElementById('mp-list');
  let tasks = [...allCompletedTasks];

  if (mpFilter === 'child'  && mpSubFilter) tasks = tasks.filter(t => t.childName === mpSubFilter);
  if (mpFilter === 'cat'    && mpSubFilter) tasks = tasks.filter(t => (t.cat || '📋 ללא') === mpSubFilter);
  if (mpFilter === 'stars'  && mpSubFilter) tasks = tasks.filter(t => t.pts === parseInt(mpSubFilter));
  if (mpFilter === 'day'    && mpSubFilter) tasks = tasks.filter(t => t.day === mpSubFilter);

  if (tasks.length === 0) {
    list.innerHTML = '<div class="empty-state">אין מטלות שבוצעו השבוע</div>';
    return;
  }

  list.innerHTML = tasks.map((t, i) => `
    <div class="etask-wrap" data-idx="${i}" data-child-id="${t.childId}" data-hist-idx="${t.histIdx}">
      <div class="etask-actions">
        <div class="etask-action act-delete" data-act="undo"><span>↩️</span>בטל</div>
      </div>
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
        <span class="etask-stars">${'⭐'.repeat(Math.min(t.pts||0, 5))}</span>
      </div>
    </div>`).join('');

  attachMPSwipeHandlers(list, familyId);
}

// =========== SWIPE HANDLERS ===========
function attachMPSwipeHandlers(list, familyId) {
  list.querySelectorAll('.etask-wrap').forEach(wrap => {
    const card    = wrap.querySelector('.etask-card');
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
      showConfirm({
        icon: '↩️', title: 'לבטל את ביצוע המטלה?',
        message: 'הכוכבים יורדו מהילד',
        confirmText: 'בטל ביצוע',
        confirmColor: 'linear-gradient(135deg,#F59E0B,#D97706)',
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
      const st       = stateSnap.data();
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

// =========== RESET STATE ===========
export function resetMPState() {
  mpFilter    = 'all';
  mpSubFilter = '';
  mpTab       = 'completed';
}
