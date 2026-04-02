import { db } from './firebase.js';
import {
  doc, getDoc, getDocs, updateDoc, collection
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { showToast, showLoading, hideLoading } from './ui.js';
import { childrenCache, loadChildren } from './family.js';
import { FREQ_LABELS } from './tasks.js';

// =========== STATE ===========
let allCompletedTasks = [];
let mpFilter = 'all';
let mpSubFilter = '';

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
      if (!st.hist || !st.hist.length) continue;
      st.hist.forEach((h, idx) => {
        const taskInfo = taskMap[h.task] || {};
        allCompletedTasks.push({
          childId: child.id,
          childName: child.name,
          childEmoji: child.emoji || (child.gender === 'female' ? '👧' : '👦'),
          task: h.task,
          emoji: h.emoji || taskInfo.emoji || '⭐',
          pts: h.pts || 0,
          cat: taskInfo.cat || '',
          time: h.time || '',
          day: h.day || '',
          ts: h.ts || 0,
          histIdx: idx
        });
      });
    } catch(e) { console.error(e); }
  }
  allCompletedTasks.sort((a, b) => (b.ts || 0) - (a.ts || 0));
}

// =========== RENDER FILTERS ===========
export function renderMPFilters() {
  document.querySelectorAll('#mp-filter .filter-chip').forEach(f => {
    f.classList.toggle('active', f.dataset.filter === mpFilter);
    f.onclick = () => {
      mpFilter = f.dataset.filter;
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
      { key: 'ראשון', label: "א'" },
      { key: 'שני', label: "ב'" },
      { key: 'שלישי', label: "ג'" },
      { key: 'רביעי', label: "ד'" },
      { key: 'חמישי', label: "ה'" },
      { key: 'שישי', label: "ו'" },
      { key: 'שבת', label: "ש'" }
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

// =========== RENDER LIST ===========
export function renderMPList(familyId) {
  const list = document.getElementById('mp-list');
  let tasks = [...allCompletedTasks];

  if (mpFilter === 'child' && mpSubFilter) tasks = tasks.filter(t => t.childName === mpSubFilter);
  if (mpFilter === 'cat' && mpSubFilter) tasks = tasks.filter(t => (t.cat || '📋 ללא') === mpSubFilter);
  if (mpFilter === 'stars' && mpSubFilter) tasks = tasks.filter(t => t.pts === parseInt(mpSubFilter));
  if (mpFilter === 'day' && mpSubFilter) tasks = tasks.filter(t => t.day === mpSubFilter);

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
    const card = wrap.querySelector('.etask-card');
    const childId = wrap.dataset.childId;
    const histIdx = parseInt(wrap.dataset.histIdx);
    let startX = 0, currentX = 0, swiping = false, swiped = false;

    card.addEventListener('touchstart', (e) => {
      startX = e.touches[0].clientX;
      currentX = 0; swiping = true; swiped = false;
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
      if (swiped) {
        card.style.transition = 'transform 0.2s ease';
        card.style.transform = 'translateX(0)';
        swiped = false;
      }
    });

    wrap.querySelector('[data-act="undo"]').onclick = async () => {
      if (!confirm('לבטל את ביצוע המטלה? הכוכבים יורדו מהילד')) return;
      await undoTask(familyId, childId, histIdx);
    };
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.etask-wrap')) {
      list.querySelectorAll('.etask-card').forEach(c => {
        c.style.transition = 'transform 0.2s ease';
        c.style.transform = 'translateX(0)';
      });
    }
  });
}

// =========== UNDO TASK ===========
async function undoTask(familyId, childId, histIdx) {
  showLoading('מבטל...');
  try {
    const stateRef = doc(db, 'families', familyId, 'children', childId, 'state', 'current');
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
  } catch(e) {
    hideLoading();
    console.error(e);
  }
}

// =========== RESET STATE ===========
export function resetMPState() {
  mpFilter = 'all';
  mpSubFilter = '';
}
