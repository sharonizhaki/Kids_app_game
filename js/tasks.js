import { db } from './firebase.js';
import {
  doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc,
  collection, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { showScreen, showToast, showLoading, hideLoading, highlightField } from './ui.js';
import { childrenCache, loadChildren } from './family.js';

// =========== CONSTANTS ===========
export const TASK_EMOJIS = ["🪥","🛏️","🚿","🧹","🧼","👕","🗑️","🍽️","🎒","📚","📖","✏️","🧮","🎨","🎵","💪","🌱","🐕","🍳","🚲","🧸","🎯","🎹","⭐","🏃","🧃","🍎","🦷","🎮","🌙"];
export const DEFAULT_CATS = ['🧼 היגיינה','🏠 מטלות בית','📚 לימודים','🎯 אחריות','⭐ מיוחדות'];
export const FREQ_LABELS = { daily:'📆 כל יום', weekly:'📋 פעם בשבוע', once:'☝️ חד פעמית', specific:'🗓️ ימים ספציפיים', '2week':'🔁 פעמיים בשבוע' };
export const TASK_SUGGESTIONS = [
  {name:'צחצוח שיניים בוקר', emoji:'🪥', cat:'🧼 היגיינה', pts:1, freq:'daily'},
  {name:'צחצוח שיניים ערב', emoji:'🪥', cat:'🧼 היגיינה', pts:1, freq:'daily'},
  {name:'סידור המיטה', emoji:'🛏️', cat:'🏠 מטלות בית', pts:1, freq:'daily'},
  {name:'מקלחת', emoji:'🚿', cat:'🧼 היגיינה', pts:2, freq:'daily'},
  {name:'קריאה 15 דקות', emoji:'📖', cat:'📚 לימודים', pts:3, freq:'daily'},
  {name:'תרגול חשבון', emoji:'🧮', cat:'📚 לימודים', pts:3, freq:'daily'},
  {name:'סידור חדר', emoji:'🧹', cat:'🏠 מטלות בית', pts:2, freq:'weekly'},
  {name:'לקפל כביסה', emoji:'👕', cat:'🏠 מטלות בית', pts:3, freq:'weekly'},
  {name:'להכין תיק', emoji:'🎒', cat:'🎯 אחריות', pts:2, freq:'daily'},
  {name:'לערוך שולחן', emoji:'🍽️', cat:'🏠 מטלות בית', pts:1, freq:'daily'},
  {name:'לזרוק זבל', emoji:'🗑️', cat:'🏠 מטלות בית', pts:1, freq:'daily'},
  {name:'תרגול אנגלית', emoji:'📚', cat:'📚 לימודים', pts:3, freq:'daily'},
  {name:'יום בלי מסכים', emoji:'⭐', cat:'⭐ מיוחדות', pts:5, freq:'weekly'},
  {name:'לעזור לבשל', emoji:'🍳', cat:'⭐ מיוחדות', pts:4, freq:'weekly'},
  {name:'לצייר ציור למישהו', emoji:'🎨', cat:'⭐ מיוחדות', pts:3, freq:'weekly'},
];

// =========== ADD TASK STATE ===========
let taskSelectedEmoji = '';
let taskSelectedStars = 1;
let taskSelectedFreq = '';
let taskSelectedDays = [];
let taskAssignedChildren = [];
let taskSelectedCat = '';

// =========== EDIT TASK STATE ===========
export let allTasksFlat = [];
let editingTask = null;
let etSelectedCat = '';
let etSelectedEmoji = '';
let etSelectedStars = 0;
let etSelectedFreq = '';
let etSelectedDays = [];
let etFilter = 'all';
let etSubFilter = '';

// =========== OPEN ADD TASK ===========
export async function openAddTask(familyId) {
  // Reset
  document.getElementById('task-name-input').value = '';
  taskSelectedStars = 1;
  document.querySelectorAll('#task-stars-picker .star-btn').forEach(s => s.classList.remove('filled'));
  taskSelectedCat = '';
  document.getElementById('task-new-cat-input') && (document.getElementById('task-new-cat-input').value = '');
  document.getElementById('new-cat-input-wrap').style.display = 'none';
  document.getElementById('task-desc-input').value = '';
  document.getElementById('task-reminder-input').value = '';
  document.getElementById('add-task-error').textContent = '';
  document.getElementById('suggestions-wrap').style.display = 'none';
  document.getElementById('task-days-grid').style.display = 'none';
  taskSelectedEmoji = '';
  taskSelectedFreq = '';
  taskSelectedDays = [];
  taskAssignedChildren = [];

  // Build category list
  await loadChildren(familyId);
  const existingCats = new Set(DEFAULT_CATS);
  try {
    const tasksSnap = await getDocs(collection(db, 'families', familyId, 'tasks'));
    tasksSnap.forEach(d => { if (d.data().cat) existingCats.add(d.data().cat); });
  } catch(e) {}
  renderCatScroll([...existingCats], 'task-cat-scroll', 'new-cat-input-wrap', 'task-new-cat-input', (cat) => { taskSelectedCat = cat; });

  // Emoji grid
  renderTaskEmojiGrid('task-emoji-grid', '', (emoji) => { taskSelectedEmoji = emoji; });

  // Stars picker
  initStarsPicker('task-stars-picker', 1, (val) => { taskSelectedStars = val; });

  // Frequency
  initFreqGrid('task-freq-grid', 'task-days-grid', '', [], (freq) => { taskSelectedFreq = freq; }, (days) => { taskSelectedDays = days; });

  // If no children — show warning modal and abort navigation
  if (childrenCache.length === 0) {
    const modal = document.getElementById('modal-no-child');
    modal.style.display = 'flex';
    hideLoading();
    return;
  }

  // Assign grid
  renderAssignGrid('task-assign-grid', [], (children) => { taskAssignedChildren = children; });

  showScreen('screen-add-task');

  setTimeout(async () => {
    try {
      const famDoc = await getDoc(doc(db, 'families', familyId));
      const tourDone = famDoc.exists() && famDoc.data().taskTourDone;
      if (!tourDone) {
        startTaskTour(familyId);
      } else {
        document.getElementById('task-name-input').focus();
      }
    } catch(e) {
      document.getElementById('task-name-input').focus();
    }
  }, 400);
}

// =========== SAVE TASK ===========
export async function saveTask(familyId) {
  const name = document.getElementById('task-name-input').value.trim();
  const cat = taskSelectedCat || (document.getElementById('task-new-cat-input')?.value?.trim()) || '';
  const desc = document.getElementById('task-desc-input').value.trim();
  const reminder = document.getElementById('task-reminder-input').value;
  const err = document.getElementById('add-task-error');

  if (!name) { err.textContent = 'חובה להכניס שם מטלה'; highlightField(document.getElementById('task-name-input')); return; }
  if (!cat) { err.textContent = 'חובה לבחור קטגוריה'; highlightField(document.getElementById('task-cat-scroll')); return; }
  if (taskAssignedChildren.length === 0) { err.textContent = 'חובה לשייך לפחות ילד אחד'; highlightField(document.getElementById('task-assign-grid')); return; }
  if (!taskSelectedEmoji) { err.textContent = 'חובה לבחור אייקון'; highlightField(document.getElementById('task-emoji-grid')); return; }
  if (!taskSelectedStars || taskSelectedStars < 1) { err.textContent = 'חובה לבחור כוכבים'; highlightField(document.getElementById('task-stars-picker')); return; }
  if (!taskSelectedFreq) { err.textContent = 'חובה לבחור תדירות'; highlightField(document.getElementById('task-freq-grid')); return; }
  err.textContent = '';

  showLoading('שומר מטלה...');
  try {
    const taskRef = doc(collection(db, 'families', familyId, 'tasks'));
    await setDoc(taskRef, {
      task: name,
      emoji: taskSelectedEmoji,
      cat,
      catIcon: taskSelectedEmoji,
      pts: taskSelectedStars,
      freq: taskSelectedFreq,
      days: taskSelectedFreq === 'specific' ? taskSelectedDays : [],
      desc,
      reminder: reminder || '',
      hidden: false,
      assignedChildren: taskAssignedChildren,
      createdAt: serverTimestamp()
    });
    hideLoading();
    showToast('מטלה נוספה! ✅');
    showScreen('screen-dashboard');
  } catch(e) {
    hideLoading();
    document.getElementById('add-task-error').textContent = 'שגיאה בשמירה, נסה שוב';
    console.error(e);
  }
}

// =========== LOAD ALL TASKS ===========
export async function loadAllTasks(familyId) {
  allTasksFlat = [];
  await loadChildren(familyId);
  try {
    const snap = await getDocs(collection(db, 'families', familyId, 'tasks'));
    snap.forEach(d => {
      const data = d.data();
      const assigned = data.assignedChildren || [];
      if (assigned.length === 0) {
        allTasksFlat.push({ taskId: d.id, childId: '', childName: 'לא משויך', ...data });
      } else {
        assigned.forEach(cid => {
          const child = childrenCache.find(c => c.id === cid);
          allTasksFlat.push({ taskId: d.id, childId: cid, childName: child?.name || 'לא ידוע', ...data });
        });
      }
    });
  } catch(e) { console.error(e); }
}

// =========== RENDER EDIT TASKS FILTERS ===========
export function renderEditTasksFilters() {
  document.querySelectorAll('#edit-tasks-filter .filter-chip').forEach(f => {
    f.classList.toggle('active', f.dataset.filter === etFilter);
    f.onclick = () => {
      etFilter = f.dataset.filter;
      etSubFilter = '';
      renderEditTasksFilters();
      renderEditSubFilter('edit-tasks-sub-filter');
      renderEditTasksList();
    };
  });
  renderEditSubFilter('edit-tasks-sub-filter');
}

function renderEditSubFilter(subId) {
  const sub = document.getElementById(subId);
  if (etFilter === 'all') { sub.style.display = 'none'; return; }

  let options = [];
  if (etFilter === 'child') {
    const names = [...new Set(allTasksFlat.map(t => t.childName))];
    options = names.map(n => {
      const child = childrenCache.find(c => c.name === n);
      const emoji = child?.emoji || (child?.gender === 'female' ? '👧' : '👦');
      return { key: n, label: `${emoji} ${n}` };
    });
  } else if (etFilter === 'cat') {
    const cats = [...new Set(allTasksFlat.map(t => t.cat || '📋 ללא קטגוריה'))];
    options = cats.map(c => ({ key: c, label: c }));
  } else if (etFilter === 'stars') {
    options = [1,2,3,4,5].map(n => ({ key: String(n), label: '⭐'.repeat(n) }));
  } else if (etFilter === 'freq') {
    const freqs = [...new Set(allTasksFlat.map(t => t.freq))];
    options = freqs.map(f => ({ key: f, label: FREQ_LABELS[f] || f }));
  }

  sub.style.display = 'flex';
  sub.innerHTML = options.map(o => `<span class="sub-chip${etSubFilter===o.key?' active':''}" data-key="${o.key}">${o.label}</span>`).join('');
  sub.querySelectorAll('.sub-chip').forEach(chip => {
    chip.onclick = () => {
      etSubFilter = etSubFilter === chip.dataset.key ? '' : chip.dataset.key;
      renderEditSubFilter(subId);
      renderEditTasksList();
    };
  });
}

// =========== SVG ICONS ===========
const SVG_EDIT  = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
const SVG_EYE   = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
const SVG_EYEOFF= `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;
const SVG_TRASH = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`;

function buildMetaTags(t) {
  const childTag  = `<span class="etask-tag child-tag">${t.childName}</span>`;
  const catTag    = t.cat ? `<span class="etask-tag cat-tag">${t.cat}</span>` : '';
  const freqTag   = `<span class="etask-tag freq-tag">${FREQ_LABELS[t.freq] || t.freq || ''}</span>`;
  const starsTag  = t.pts > 0 ? `<span class="etask-tag stars-tag">${'⭐'.repeat(Math.min(t.pts,5))}</span>` : '';
  const hiddenTag = t.hidden ? '<span class="etask-tag hidden-tag">מוסתר</span>' : '';
  const tags = { child: childTag, cat: catTag, freq: freqTag, stars: starsTag };
  let order;
  if      (etFilter === 'child') order = ['child','cat','freq','stars'];
  else if (etFilter === 'cat')   order = ['cat','child','freq','stars'];
  else if (etFilter === 'stars') order = ['stars','child','cat','freq'];
  else if (etFilter === 'freq')  order = ['freq','child','cat','stars'];
  else                           order = ['child','cat','freq','stars'];
  return order.map(k => tags[k]).filter(Boolean).join('') + hiddenTag;
}

// =========== RENDER EDIT TASKS LIST ===========
export function renderEditTasksList(familyId) {
  const list = document.getElementById('edit-tasks-list');
  let tasks = [...allTasksFlat];

  // filter
  if (etFilter === 'child'  && etSubFilter) tasks = tasks.filter(t => t.childName === etSubFilter);
  if (etFilter === 'cat'    && etSubFilter) tasks = tasks.filter(t => (t.cat || '') === etSubFilter);
  if (etFilter === 'stars'  && etSubFilter) tasks = tasks.filter(t => t.pts === parseInt(etSubFilter));
  if (etFilter === 'freq'   && etSubFilter) tasks = tasks.filter(t => t.freq === etSubFilter);

  // sort
  if (etFilter === 'stars') tasks.sort((a,b) => (b.pts||0) - (a.pts||0));
  else if (etFilter === 'cat')   tasks.sort((a,b) => (a.cat||'').localeCompare(b.cat||''));
  else if (etFilter === 'child') tasks.sort((a,b) => (a.childName||'').localeCompare(b.childName||''));
  else if (etFilter === 'freq')  tasks.sort((a,b) => (a.freq||'').localeCompare(b.freq||''));
  else tasks.sort((a,b) => b.taskId.localeCompare(a.taskId)); // newest first (by doc ID)

  if (tasks.length === 0) { list.innerHTML = '<div class="empty-state">אין מטלות להצגה</div>'; return; }

  list.innerHTML = tasks.map(t => `
    <div class="etask-wrap" data-child-id="${t.childId}" data-task-id="${t.taskId}" data-hidden="${t.hidden?'1':'0'}">
      <div class="etask-card${t.hidden?' hidden-task':''}">
        <span class="etask-emoji">${t.emoji || '📋'}</span>
        <div class="etask-info">
          <strong>${t.task}</strong>
          <div class="etask-meta">${buildMetaTags(t)}</div>
        </div>
        <div class="etask-btns">
          <button class="etask-btn btn-edit" title="ערוך">${SVG_EDIT}</button>
          <button class="etask-btn ${t.hidden?'btn-vis-show':'btn-vis-hide'}" title="${t.hidden?'הצג':'הסתר'}">${t.hidden?SVG_EYE:SVG_EYEOFF}</button>
          <button class="etask-btn btn-del" title="מחק">${SVG_TRASH}</button>
        </div>
      </div>
    </div>`).join('');

  // attach handlers
  list.querySelectorAll('.etask-wrap').forEach(wrap => {
    const taskId  = wrap.dataset.taskId;
    const childId = wrap.dataset.childId;

    wrap.querySelector('.btn-edit').onclick = (e) => {
      e.stopPropagation();
      openEditTask(childId, taskId, familyId);
    };
    wrap.querySelector('.etask-card').onclick = () => openEditTask(childId, taskId, familyId);

    wrap.querySelector('.btn-vis-hide, .btn-vis-show')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      const isHidden = wrap.dataset.hidden === '1';
      showLoading(isHidden ? 'מציג...' : 'מסתיר...');
      try {
        await updateDoc(doc(db, 'families', familyId, 'tasks', taskId), { hidden: !isHidden });
        await loadAllTasks(familyId);
        hideLoading();
        showToast(isHidden ? '👁️ מוצג' : '🙈 מוסתר');
        renderEditTasksList(familyId);
      } catch(e) { hideLoading(); }
    });

    wrap.querySelector('.btn-del').onclick = async (e) => {
      e.stopPropagation();
      if (!confirm('למחוק את המטלה?')) return;
      showLoading('מוחק...');
      try {
        await deleteDoc(doc(db, 'families', familyId, 'tasks', taskId));
        await loadAllTasks(familyId);
        hideLoading();
        showToast('🗑️ נמחק');
        renderEditTasksList(familyId);
      } catch(e) { hideLoading(); }
    };
  });
}

// =========== OPEN EDIT SINGLE TASK ===========
export function openEditTask(childId, taskId, familyId) {
  const t = allTasksFlat.find(x => x.childId === childId && x.taskId === taskId);
  if (!t) return;
  let etAssignedChildren = [childId];
  editingTask = { childId, taskId, data: t, getAssigned: () => etAssignedChildren };

  document.getElementById('et-name').value = t.task || '';
  document.getElementById('et-desc').value = t.desc || '';
  document.getElementById('et-reminder').value = t.reminder || '';
  document.getElementById('et-error').textContent = '';

  // Assign grid
  const assignGrid = document.getElementById('et-assign-grid');
  assignGrid.innerHTML = childrenCache.map(c => {
    const genderEmoji = c.gender === 'male' ? '👦' : '👧';
    const hasPhoto = c.photo && c.photo.length > 10;
    const photoHTML = hasPhoto ? `<img src="${c.photo}" alt="${c.name}">` : `<span>${c.emoji || genderEmoji}</span>`;
    return `<div class="assign-opt${c.id === childId?' selected':''}" data-child-id="${c.id}">
      <div class="assign-photo">${photoHTML}</div>
      <span class="assign-name">${c.name}</span>
    </div>`;
  }).join('');
  assignGrid.querySelectorAll('.assign-opt').forEach(el => {
    el.onclick = () => {
      el.classList.toggle('selected');
      const cid = el.dataset.childId;
      if (etAssignedChildren.includes(cid)) etAssignedChildren = etAssignedChildren.filter(id => id !== cid);
      else etAssignedChildren.push(cid);
    };
  });

  // Category
  etSelectedCat = t.cat || 'כללי';
  const cats = [...new Set([...DEFAULT_CATS, ...allTasksFlat.map(x => x.cat).filter(Boolean)])];
  renderCatScroll(cats, 'et-cat-scroll', 'et-new-cat-wrap', 'et-new-cat', (cat) => { etSelectedCat = cat; }, etSelectedCat);

  // Emoji
  etSelectedEmoji = t.emoji || '';
  renderTaskEmojiGrid('et-emoji-grid', etSelectedEmoji, (emoji) => { etSelectedEmoji = emoji; });

  // Stars
  etSelectedStars = t.pts || 0;
  initStarsPicker('et-stars-picker', etSelectedStars, (val) => { etSelectedStars = val; });

  // Frequency
  etSelectedFreq = t.freq || 'daily';
  etSelectedDays = t.days || [];
  initFreqGrid('et-freq-grid', 'et-days-grid', etSelectedFreq, etSelectedDays,
    (freq) => { etSelectedFreq = freq; },
    (days) => { etSelectedDays = days; }
  );

  document.getElementById('btn-et-hide').textContent = t.hidden ? '👁️ הצג' : '👁️ הסתר';
  showScreen('screen-edit-task');
}

// =========== SAVE EDITED TASK ===========
export async function saveEditedTask(familyId) {
  if (!editingTask) return;
  const name = document.getElementById('et-name').value.trim();
  const err = document.getElementById('et-error');
  if (!name) { err.textContent = 'חובה להכניס שם'; highlightField(document.getElementById('et-name')); return; }
  const cat = etSelectedCat || document.getElementById('et-new-cat')?.value?.trim() || '';
  if (!cat) { err.textContent = 'חובה לבחור קטגוריה'; highlightField(document.getElementById('et-cat-scroll')); return; }
  const assigned = editingTask.getAssigned();
  if (!assigned || assigned.length === 0) { err.textContent = 'חובה לשייך לפחות ילד אחד'; highlightField(document.getElementById('et-assign-grid')); return; }
  if (!etSelectedEmoji) { err.textContent = 'חובה לבחור אייקון'; highlightField(document.getElementById('et-emoji-grid')); return; }
  if (!etSelectedStars) { err.textContent = 'חובה לבחור כוכבים'; highlightField(document.getElementById('et-stars-picker')); return; }
  err.textContent = '';

  showLoading('שומר...');
  try {
    await updateDoc(doc(db, 'families', familyId, 'tasks', editingTask.taskId), {
      task: name, emoji: etSelectedEmoji, cat, catIcon: etSelectedEmoji,
      pts: etSelectedStars, freq: etSelectedFreq,
      days: etSelectedFreq === 'specific' ? etSelectedDays : [],
      desc: document.getElementById('et-desc').value.trim(),
      reminder: document.getElementById('et-reminder').value || '',
      assignedChildren: assigned
    });
    await loadAllTasks(familyId);
    hideLoading();
    showToast('נשמר! ✅');
    showScreen('screen-edit-tasks');
    renderEditTasksList(familyId);
  } catch(e) { hideLoading(); document.getElementById('et-error').textContent = 'שגיאה בשמירה'; console.error(e); }
}

// =========== TOGGLE HIDE TASK ===========
export async function toggleHideTask(familyId) {
  if (!editingTask) return;
  const isHidden = editingTask.data.hidden;
  showLoading(isHidden ? 'מציג...' : 'מסתיר...');
  try {
    await updateDoc(doc(db, 'families', familyId, 'tasks', editingTask.taskId), { hidden: !isHidden });
    await loadAllTasks(familyId);
    hideLoading();
    showToast(isHidden ? 'המטלה מוצגת! 👁️' : 'המטלה מוסתרת! 🙈');
    showScreen('screen-edit-tasks');
    renderEditTasksList(familyId);
  } catch(e) { hideLoading(); console.error(e); }
}

// =========== DELETE TASK ===========
export async function deleteTask(familyId) {
  if (!editingTask) return;
  if (!confirm('למחוק את המטלה? לא ניתן לשחזר')) return;
  showLoading('מוחק...');
  try {
    await deleteDoc(doc(db, 'families', familyId, 'tasks', editingTask.taskId));
    await loadAllTasks(familyId);
    hideLoading();
    showToast('נמחק! 🗑️');
    showScreen('screen-edit-tasks');
    renderEditTasksList(familyId);
  } catch(e) { hideLoading(); console.error(e); }
}

// =========== SUGGESTIONS ===========
export function initSuggestions() {
  document.getElementById('btn-task-suggestions').onclick = () => {
    const wrap = document.getElementById('suggestions-wrap');
    if (wrap.style.display === 'none') {
      wrap.style.display = 'flex';
      wrap.innerHTML = TASK_SUGGESTIONS.map((s, i) => `<span class="suggestion-chip" data-idx="${i}">${s.emoji} ${s.name}</span>`).join('');
      wrap.querySelectorAll('.suggestion-chip').forEach(chip => {
        chip.onclick = () => {
          const s = TASK_SUGGESTIONS[parseInt(chip.dataset.idx)];
          document.getElementById('task-name-input').value = s.name;
          taskSelectedStars = s.pts;
          document.querySelectorAll('#task-stars-picker .star-btn').forEach(st => st.classList.toggle('filled', parseInt(st.dataset.val) <= taskSelectedStars));
          selectCatByName(s.cat, 'task-cat-scroll', 'new-cat-input-wrap', (cat) => { taskSelectedCat = cat; });
          taskSelectedEmoji = s.emoji;
          document.querySelectorAll('#task-emoji-grid .task-emoji-opt').forEach(el => el.classList.toggle('selected', el.dataset.emoji === s.emoji));
          taskSelectedFreq = s.freq;
          document.querySelectorAll('#task-freq-grid .freq-opt').forEach(el => el.classList.toggle('selected', el.dataset.freq === s.freq));
          wrap.style.display = 'none';
        };
      });
    } else {
      wrap.style.display = 'none';
    }
  };
}

// =========== HELPERS ===========
export function renderCatScroll(cats, scrollId, newWrapId, newInputId, onSelect, current = '') {
  const scroll = document.getElementById(scrollId);
  scroll.innerHTML = cats.map(c => `<span class="cat-chip${c===current?' selected':''}" data-cat="${c}">${c}</span>`).join('') +
    `<span class="cat-chip new-cat" id="btn-new-cat-${scrollId}">+ חדשה</span>`;

  scroll.querySelectorAll('.cat-chip:not(.new-cat)').forEach(chip => {
    chip.onclick = () => {
      scroll.querySelectorAll('.cat-chip').forEach(x => x.classList.remove('selected'));
      chip.classList.add('selected');
      onSelect(chip.dataset.cat);
      document.getElementById(newWrapId).style.display = 'none';
    };
  });

  document.getElementById(`btn-new-cat-${scrollId}`).onclick = () => {
    scroll.querySelectorAll('.cat-chip').forEach(x => x.classList.remove('selected'));
    document.getElementById(`btn-new-cat-${scrollId}`).classList.add('selected');
    onSelect('');
    document.getElementById(newWrapId).style.display = 'block';
    document.getElementById(newInputId).focus();
  };
}

function selectCatByName(name, scrollId, newWrapId, onSelect) {
  const scroll = document.getElementById(scrollId);
  let selectedChip = null;
  scroll.querySelectorAll('.cat-chip').forEach(x => {
    const isMatch = x.dataset.cat === name;
    x.classList.toggle('selected', isMatch);
    if (isMatch) selectedChip = x;
  });
  onSelect(name);
  document.getElementById(newWrapId).style.display = 'none';
  if (selectedChip) selectedChip.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
}

export function renderTaskEmojiGrid(gridId, current, onSelect) {
  const grid = document.getElementById(gridId);
  const SHOW_INITIAL = 11;

  function buildGrid(showAll) {
    const visible = showAll ? TASK_EMOJIS : TASK_EMOJIS.slice(0, SHOW_INITIAL);
    const remaining = TASK_EMOJIS.length - SHOW_INITIAL;
    grid.innerHTML = visible.map(e =>
      `<div class="task-emoji-opt${e === current ? ' selected' : ''}" data-emoji="${e}">${e}</div>`
    ).join('') + (!showAll && remaining > 0
      ? `<div class="task-emoji-opt" id="${gridId}-show-more" style="font-size:0.72rem;font-weight:800;color:var(--primary);background:#EEF2FF;border:1.5px dashed var(--primary);">+${remaining}</div>`
      : '');

    grid.querySelectorAll('.task-emoji-opt').forEach(el => {
      if (el.id === `${gridId}-show-more`) {
        el.onclick = () => buildGrid(true);
      } else {
        el.onclick = () => {
          grid.querySelectorAll('.task-emoji-opt').forEach(x => x.classList.remove('selected'));
          el.classList.add('selected');
          onSelect(el.dataset.emoji);
        };
      }
    });
  }

  // if selected emoji is beyond initial set, expand fully from start
  const currentIdx = TASK_EMOJIS.indexOf(current);
  buildGrid(currentIdx >= SHOW_INITIAL);
}

export function initStarsPicker(pickerId, current, onChange) {
  document.querySelectorAll(`#${pickerId} .star-btn`).forEach(s => {
    s.classList.toggle('filled', parseInt(s.dataset.val) <= current);
    s.onclick = () => {
      const val = parseInt(s.dataset.val);
      onChange(val);
      document.querySelectorAll(`#${pickerId} .star-btn`).forEach(x => x.classList.toggle('filled', parseInt(x.dataset.val) <= val));
    };
  });
}

export function initFreqGrid(gridId, daysGridId, currentFreq, currentDays, onFreqChange, onDaysChange) {
  document.querySelectorAll(`#${gridId} .freq-opt`).forEach(el => {
    el.classList.toggle('selected', el.dataset.freq === currentFreq);
    el.onclick = () => {
      document.querySelectorAll(`#${gridId} .freq-opt`).forEach(x => x.classList.remove('selected'));
      el.classList.add('selected');
      onFreqChange(el.dataset.freq);
      document.getElementById(daysGridId).style.display = el.dataset.freq === 'specific' ? 'flex' : 'none';
    };
  });
  document.getElementById(daysGridId).style.display = currentFreq === 'specific' ? 'flex' : 'none';
  document.querySelectorAll(`#${daysGridId} .day-opt`).forEach(el => {
    el.classList.toggle('selected', currentDays.includes(parseInt(el.dataset.day)));
    el.onclick = () => {
      const day = parseInt(el.dataset.day);
      el.classList.toggle('selected');
      const days = [...currentDays];
      const idx = days.indexOf(day);
      if (idx > -1) days.splice(idx, 1); else days.push(day);
      onDaysChange(days);
    };
  });
}

export function renderAssignGrid(gridId, selectedIds, onChange) {
  const grid = document.getElementById(gridId);
  let assigned = [...selectedIds];
  grid.innerHTML = childrenCache.map(c => {
    const genderEmoji = c.gender === 'male' ? '👦' : '👧';
    const hasPhoto = c.photo && c.photo.length > 10;
    const photoHTML = hasPhoto ? `<img src="${c.photo}" alt="${c.name}">` : `<span>${c.emoji || genderEmoji}</span>`;
    const isSelected = selectedIds.includes(c.id);
    return `<div class="assign-opt${isSelected?' selected':''}" data-child-id="${c.id}">
      <div class="assign-photo">${photoHTML}</div>
      <span class="assign-name">${c.name}</span>
    </div>`;
  }).join('');
  grid.querySelectorAll('.assign-opt').forEach(el => {
    el.onclick = () => {
      el.classList.toggle('selected');
      const cid = el.dataset.childId;
      if (assigned.includes(cid)) assigned = assigned.filter(id => id !== cid);
      else assigned.push(cid);
      onChange(assigned);
    };
  });
}

// =========== QUICK AUTO-CREATE 5 TASKS ===========
const AUTO_TASKS = [
  { task:'צחצוח שיניים בוקר', emoji:'🪥', cat:'🧼 היגיינה',   pts:1, freq:'daily' },
  { task:'צחצוח שיניים ערב',  emoji:'🪥', cat:'🧼 היגיינה',   pts:1, freq:'daily' },
  { task:'מקלחת',              emoji:'🚿', cat:'🧼 היגיינה',   pts:2, freq:'daily' },
  { task:'סידור מיטה',         emoji:'🛏️', cat:'🏠 מטלות בית', pts:1, freq:'daily' },
  { task:'לזרוק זבל',          emoji:'🗑️', cat:'🏠 מטלות בית', pts:1, freq:'daily' },
];

export async function createQuickTasks(familyId) {
  await loadChildren(familyId);
  const childIds = childrenCache.map(c => c.id);
  if (!childIds.length) { showToast('יש להוסיף ילד תחילה'); return false; }

  await Promise.all(AUTO_TASKS.map(t =>
    setDoc(doc(collection(db, 'families', familyId, 'tasks')), {
      task: t.task, emoji: t.emoji, cat: t.cat, catIcon: t.emoji,
      pts: t.pts, freq: t.freq, days: [], desc: '', reminder: '',
      hidden: false, assignedChildren: childIds, createdAt: serverTimestamp()
    })
  ));
  return true;
}

// =========== GUIDED TOUR ===========
export function startTaskTour(familyId) {
  const steps = [
    { el: '#task-name-input',         title: 'שם המטלה',      text: 'הכנס שם למטלה, לחץ "💡 משימות לדוגמא" לרעיונות מוכנים' },
    { el: '#task-cat-scroll',         title: 'קטגוריה',       text: 'בחר קטגוריה — היגיינה, לימודים, מטלות בית... או צור קטגוריה חדשה' },
    { el: '#task-assign-grid',        title: 'שיוך לילד/ים',  text: 'כאן מופיעים הילדים שלך — בחר לאיזה ילד/ים המטלה משויכת' },
    { el: '#task-emoji-grid',         title: 'אייקון',         text: 'בחר אייקון שיופיע ליד שם המטלה' },
    { el: '#task-stars-picker',       title: 'כוכבים',        text: 'כמה כוכבים שווה המטלה? לחץ על הכוכב הרצוי' },
    { el: '#task-freq-grid',          title: 'תדירות',        text: 'מתי יוכל הילד לבצע את המשימה — כל יום, פעם בשבוע, ימים ספציפיים, או חד פעמית' },
    { el: '#task-reminder-desc-wrap', title: 'תזכורת ותיאור', text: 'בחר שעה לתזכורת ומתחת הוסף הסבר קצר על המטלה — שניהם לא חובה' },
  ];

  let currentStep = 0;
  const PAD = 6;
  document.body.style.overflow = 'hidden';

  const overlay = document.createElement('div');
  overlay.className = 'tour-overlay';
  overlay.id = 'tour-overlay';
  overlay.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

  const shutterTop = document.createElement('div');
  shutterTop.className = 'tour-shutter-top';
  shutterTop.style.height = '0px';

  const shutterBottom = document.createElement('div');
  shutterBottom.className = 'tour-shutter-bottom';
  shutterBottom.style.height = '0px';

  const card = document.createElement('div');
  card.className = 'tour-card';

  overlay.appendChild(shutterTop);
  overlay.appendChild(shutterBottom);
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  function showStep(idx) {
    const step = steps[idx];
    const rawEl = document.querySelector(step.el);
    if (!rawEl) { endTour(); return; }
    const el = rawEl.closest('.form-section') || rawEl;

    card.classList.remove('visible');
    void card.offsetWidth; // force reflow so animation resets cleanly
    shutterTop.style.height = '0px';
    shutterBottom.style.height = '0px';
    rawEl.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // wait for shutters to fully close + scroll to settle
    setTimeout(() => {
      const rect = el.getBoundingClientRect();

      // Open spotlight shutters
      shutterTop.style.height = Math.max(0, rect.top - PAD) + 'px';
      shutterBottom.style.height = Math.max(0, window.innerHeight - rect.bottom - PAD) + 'px';

      // Populate card while spotlight is opening (no delay — just hidden via clip-path)
      const dotsHTML = steps.map((_, i) => `<span class="tour-dot${i === idx ? ' active' : ''}"></span>`).join('');
      card.innerHTML = `
        <div class="tour-card-btns" style="margin-bottom:10px;">
          <span dir="ltr" style="font-size:0.78rem;color:var(--muted);">${idx + 1} / ${steps.length}</span>
          ${idx < steps.length - 1 ? '<button class="tour-skip-btn" id="tour-skip">דלג</button>' : ''}
        </div>
        <h4>${step.title}</h4>
        <p>${step.text}</p>
        <div style="display:flex;align-items:center;justify-content:space-between;">
          <div style="display:flex;gap:5px;">${dotsHTML}</div>
          <button class="tour-next-btn" id="tour-next">${idx === steps.length - 1 ? 'סיום ✅' : 'הבא ←'}</button>
        </div>`;

      const fitsBelow = rect.bottom + 180 < window.innerHeight;
      card.style.top    = fitsBelow ? (rect.bottom + 8) + 'px' : 'auto';
      card.style.bottom = fitsBelow ? 'auto' : (window.innerHeight - rect.top + 8) + 'px';

      document.getElementById('tour-next').onclick = () => {
        currentStep++;
        if (currentStep >= steps.length) endTour(); else showStep(currentStep);
      };
      document.getElementById('tour-skip')?.addEventListener('click', endTour);

      // Iris-open animation — starts ~130ms after spotlight begins (synced)
      setTimeout(() => card.classList.add('visible'), 130);
    }, 520);
  }

  function endTour() {
    card.classList.remove('visible');
    // close shutters inward to cover full screen — no exposed area
    shutterTop.style.height = Math.ceil(window.innerHeight / 2 + 2) + 'px';
    shutterBottom.style.height = Math.ceil(window.innerHeight / 2 + 2) + 'px';
    setTimeout(() => {
      overlay.remove();
      document.body.style.overflow = '';
      import('./firebase.js').then(({ db }) => {
        updateDoc(doc(db, 'families', familyId), { taskTourDone: true }).catch(() => {});
      });
      setTimeout(() => document.getElementById('task-name-input').focus(), 200);
    }, 540);
  }

  overlay.onclick = (e) => e.stopPropagation();
  showStep(0);
}
