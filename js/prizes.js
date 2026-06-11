import { db } from './firebase.js';
import {
  doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc,
  collection, serverTimestamp, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { showToast, showLoading, hideLoading, showConfirm, highlightField } from './ui.js';
import { childrenCache, loadChildren } from './family.js';

// =========== CONSTANTS ===========

export const PRIZE_EMOJIS = [
  '🎬','🍕','🎮','🚲','🍦','🍫','🧁','🍭','🎁','🏆',
  '📱','🎨','🎵','🎤','🎠','🛹','⚽','🏊','🎯','🧩',
  '📚','🎪','🎡','🛍️','✈️','🎸','🎲','🪄','🌟','🎀'
];

export const PRIZE_SUGGESTIONS = [
  { name:'צעצוע קטן',              emoji:'🧸', pts:50  },
  { name:'שעת מסך נוספת',          emoji:'📱', pts:50  },
  { name:'ארוחת בוקר מפנקת',       emoji:'🥞', pts:50  },
  { name:'בגד חדש',                emoji:'👕', pts:250 },
  { name:'ליל חברים',              emoji:'🎉', pts:250 },
  { name:'נעליים חדשות',           emoji:'👟', pts:250 },
  { name:'ציוד חדש לתחביב',        emoji:'🎨', pts:400 },
  { name:'לונה פארק',              emoji:'🎡', pts:500 },
  { name:'משחק כדורגל',            emoji:'⚽', pts:500 },
];

// 3 פרסים מהירים לכל קטגוריה
export const QUICK_PRIZES_TREATS = [
  { name:'גלידה מפנקת',    emoji:'🍨', pts:50 },
  { name:'20 ש"ח לקיוסק',  emoji:'💵', pts:50 },
  { name:'מגש פיצה',       emoji:'🍕', pts:50 },
];

export const QUICK_PRIZES_FUN = [
  { name:'סרט בקולנוע',  emoji:'🎦', pts:150 },
  { name:'באולינג',      emoji:'🎳', pts:150 },
  { name:'חדר בריחה',    emoji:'🔐', pts:150 },
];

export const QUICK_PRIZES_GIFTS = [
  { name:'ספר חדש',          emoji:'📚', pts:250 },
  { name:'משחק חדש לסוני',   emoji:'🎮', pts:250 },
  { name:'משחק קופסא',       emoji:'🎲', pts:250 },
];

export const QUICK_PRIZE_SETS = {
  treats: QUICK_PRIZES_TREATS,
  fun:    QUICK_PRIZES_FUN,
  gifts:  QUICK_PRIZES_GIFTS,
};

// סיבות דחייה מובנות
export const DECLINE_REASONS = [
  'עדיין לא צברת מספיק כוכבים',
  'לא הגיע הזמן המתאים',
  'צריך לדבר על זה קודם',
];

// =========== ADD PRIZE STATE ===========
let prizeSelectedEmoji = '';
let prizeSelectedPts   = 0;
let prizeAssignedChildren = [];
let prizeRepeatAfterClaim = true;

export function setPrizeEmoji(e)    { prizeSelectedEmoji = e; }
export function setPrizePts(p)      { prizeSelectedPts = p; }
export function setPrizeChildren(c) { prizeAssignedChildren = c; }
export function setPrizeRepeat(v)   { prizeRepeatAfterClaim = v; }
export function resetPrizeState()   {
  prizeSelectedEmoji = '';
  prizeSelectedPts   = 0;
  prizeAssignedChildren = [];
  prizeRepeatAfterClaim = true;
}

// =========== FIREBASE: PRIZES ===========

/** שמור פרס חדש */
export async function savePrize(familyId) {
  const name = document.getElementById('prize-name-input').value.trim();
  const desc = document.getElementById('prize-desc-input').value.trim();
  const err  = document.getElementById('add-prize-error');

  if (!name) {
    err.textContent = 'נא להכניס שם פרס';
    highlightField(document.getElementById('prize-name-input'));
    return false;
  }
  if (!prizeSelectedEmoji) {
    err.textContent = 'נא לבחור אייקון';
    highlightField(document.getElementById('prize-emoji-grid'));
    return false;
  }
  if (!prizeSelectedPts || prizeSelectedPts < 1) {
    err.textContent = 'נא לבחור כוכבים';
    highlightField(document.getElementById('prize-pts-slider'));
    return false;
  }
  if (prizeAssignedChildren.length === 0) {
    err.textContent = 'נא לשייך לפחות ילד אחד';
    document.querySelectorAll('#prize-assign-grid .assign-opt').forEach(el => {
      el.classList.add('assign-error');
      el.addEventListener('click', () => el.classList.remove('assign-error'), { once: true });
      setTimeout(() => el.classList.remove('assign-error'), 1600);
    });
    return false;
  }
  err.textContent = '';

  showLoading('שומר פרס...');
  try {
    const ref = doc(collection(db, 'families', familyId, 'prizes'));
    await setDoc(ref, {
      name,
      emoji: prizeSelectedEmoji,
      pts: prizeSelectedPts,
      desc,
      hidden: false,
      assignedChildren: prizeAssignedChildren,
      repeatAfterClaim: prizeRepeatAfterClaim,
      createdAt: serverTimestamp()
    });
    hideLoading();
    showToast('פרס נוסף! 🎁');
    return true;
  } catch(e) {
    hideLoading();
    document.getElementById('add-prize-error').textContent = 'שגיאה בשמירה, נסה שוב';
    console.error(e);
    return false;
  }
}

/** יצירת 3 פרסים מהירים לפי קטגוריה */
export async function createQuickPrizes(familyId, category) {
  await loadChildren(familyId);
  const childIds = childrenCache.map(c => c.id);
  if (!childIds.length) { showToast('יש להוסיף ילד תחילה'); return false; }

  const prizes = (QUICK_PRIZE_SETS[category] || QUICK_PRIZES_TREATS).slice(0, 3);
  showLoading('יוצר פרסים...');
  try {
    await Promise.all(prizes.map(p =>
      setDoc(doc(collection(db, 'families', familyId, 'prizes')), {
        name: p.name,
        emoji: p.emoji,
        pts: p.pts,
        desc: '',
        hidden: false,
        assignedChildren: childIds,
        createdAt: serverTimestamp()
      })
    ));
    hideLoading();
    showToast('3 פרסים נוצרו! 🎁');
    return true;
  } catch(e) {
    hideLoading();
    showToast('שגיאה ביצירת פרסים');
    console.error(e);
    return false;
  }
}

/** טען את כל הפרסים של המשפחה */
export async function loadPrizes(familyId) {
  try {
    const snap = await getDocs(
      query(collection(db, 'families', familyId, 'prizes'), orderBy('createdAt', 'asc'))
    );
    const prizes = [];
    snap.forEach(d => prizes.push({ id: d.id, ...d.data() }));
    return prizes;
  } catch(e) {
    console.error(e);
    return [];
  }
}

/** עדכון פרס קיים */
export async function updatePrize(familyId, prizeId, data) {
  try {
    await updateDoc(doc(db, 'families', familyId, 'prizes', prizeId), data);
    return true;
  } catch(e) {
    console.error(e);
    return false;
  }
}

/** מחיקת פרס */
export async function deletePrize(familyId, prizeId) {
  try {
    await deleteDoc(doc(db, 'families', familyId, 'prizes', prizeId));
    showToast('פרס נמחק');
    return true;
  } catch(e) {
    console.error(e);
    return false;
  }
}

// =========== FIREBASE: PRIZE REQUESTS ===========

/** טען בקשות פרסים — אפשר לסנן לפי status */
export async function loadPrizeRequests(familyId, status = null) {
  try {
    const col = collection(db, 'families', familyId, 'prizeRequests');
    const snap = await getDocs(query(col, orderBy('requestedAt', 'desc')));
    const requests = [];
    snap.forEach(d => {
      const data = d.data();
      if (!status || data.status === status) {
        requests.push({ id: d.id, ...data });
      }
    });
    return requests;
  } catch(e) {
    console.error(e);
    return [];
  }
}

/** כמה בקשות ממתינות — לbadge בתפריט */
export async function countPendingRequests(familyId) {
  try {
    const snap = await getDocs(collection(db, 'families', familyId, 'prizeRequests'));
    let count = 0;
    snap.forEach(d => { if (d.data().status === 'pending') count++; });
    return count;
  } catch(e) {
    return 0;
  }
}

/** אישור בקשה — גורע כוכבים מהילד */
export async function approvePrizeRequest(familyId, requestId) {
  showLoading('מאשר...');
  try {
    const reqRef  = doc(db, 'families', familyId, 'prizeRequests', requestId);
    const reqSnap = await getDoc(reqRef);
    if (!reqSnap.exists()) { hideLoading(); showToast('הבקשה לא נמצאה'); return false; }

    const req = reqSnap.data();
    const childRef = doc(db, 'families', familyId, 'children', req.childId);
    const childSnap = await getDoc(childRef);
    if (!childSnap.exists()) { hideLoading(); return false; }

    const currentPts = childSnap.data().pts || 0;
    const newPts = Math.max(0, currentPts - req.pts);

    await Promise.all([
      updateDoc(childRef, { pts: newPts }),
      updateDoc(reqRef, {
        status: 'approved',
        resolvedAt: serverTimestamp()
      }),
      setDoc(doc(collection(db, 'families', familyId, 'children', req.childId, 'notifications')), {
        type: 'prize_approved',
        prizeId:   req.prizeId,
        prizeName: req.prizeName,
        prizeEmoji:req.prizeEmoji,
        pts:       req.pts,
        message:   `הפרס "${req.prizeName}" אושר! 🎉 נגרעו ${req.pts} כוכבים`,
        read: false,
        createdAt: serverTimestamp()
      })
    ]);

    hideLoading();
    showToast('הפרס אושר! ✅');
    return true;
  } catch(e) {
    hideLoading();
    showToast('שגיאה באישור');
    console.error(e);
    return false;
  }
}

/** דחיית בקשה — עם סיבה אופציונלית */
export async function declinePrizeRequest(familyId, requestId, reason = '') {
  showLoading('דוחה...');
  try {
    const reqRef  = doc(db, 'families', familyId, 'prizeRequests', requestId);
    const reqSnap = await getDoc(reqRef);
    if (!reqSnap.exists()) { hideLoading(); return false; }

    const req = reqSnap.data();
    await Promise.all([
      updateDoc(reqRef, {
        status: 'declined',
        declineReason: reason || '',
        resolvedAt: serverTimestamp()
      }),
      setDoc(doc(collection(db, 'families', familyId, 'children', req.childId, 'notifications')), {
        type: 'prize_declined',
        prizeId:    req.prizeId,
        prizeName:  req.prizeName,
        prizeEmoji: req.prizeEmoji,
        reason:     reason || '',
        message:    `הבקשה לפרס "${req.prizeName}" נדחתה` + (reason ? `: ${reason}` : ''),
        read: false,
        createdAt: serverTimestamp()
      })
    ]);

    hideLoading();
    showToast('הבקשה נדחתה');
    return true;
  } catch(e) {
    hideLoading();
    showToast('שגיאה');
    console.error(e);
    return false;
  }
}

/** החזרת פרס — מחזיר כוכבים לילד */
export async function reversePrizeRequest(familyId, requestId) {
  showLoading('מחזיר פרס...');
  try {
    const reqRef  = doc(db, 'families', familyId, 'prizeRequests', requestId);
    const reqSnap = await getDoc(reqRef);
    if (!reqSnap.exists()) { hideLoading(); return false; }

    const req = reqSnap.data();
    const childRef  = doc(db, 'families', familyId, 'children', req.childId);
    const childSnap = await getDoc(childRef);
    if (!childSnap.exists()) { hideLoading(); return false; }

    const currentPts = childSnap.data().pts || 0;

    await Promise.all([
      updateDoc(childRef, { pts: currentPts + req.pts }),
      updateDoc(reqRef, {
        status: 'reversed',
        reversedAt: serverTimestamp()
      }),
      setDoc(doc(collection(db, 'families', familyId, 'children', req.childId, 'notifications')), {
        type: 'prize_reversed',
        prizeName:  req.prizeName,
        prizeEmoji: req.prizeEmoji,
        pts:        req.pts,
        message:    `הפרס "${req.prizeName}" הוחזר — קיבלת בחזרה ${req.pts} כוכבים ⭐`,
        read: false,
        createdAt: serverTimestamp()
      })
    ]);

    hideLoading();
    showToast('הפרס הוחזר, הכוכבים זוכו בחזרה ⭐');
    return true;
  } catch(e) {
    hideLoading();
    showToast('שגיאה');
    console.error(e);
    return false;
  }
}

// =========== UI HELPERS ===========

/** רינדור grid אייקונים לפרסים */
export function renderPrizeEmojiGrid(containerId, selectedEmoji, onChange) {
  const grid = document.getElementById(containerId);
  if (!grid) return;
  const SHOW_INITIAL = 11;

  function buildGrid(showAll) {
    const visible = showAll ? PRIZE_EMOJIS : PRIZE_EMOJIS.slice(0, SHOW_INITIAL);
    const remaining = PRIZE_EMOJIS.length - SHOW_INITIAL;
    grid.innerHTML = visible.map(e =>
      `<div class="task-emoji-opt${e === selectedEmoji ? ' selected' : ''}" data-emoji="${e}">${e}</div>`
    ).join('') + (!showAll && remaining > 0
      ? `<div class="task-emoji-opt" id="${containerId}-show-more" style="font-size:0.72rem;font-weight:800;color:var(--primary);background:#EEF2FF;border:1.5px dashed var(--primary);">+${remaining}</div>`
      : '');

    grid.querySelectorAll('.task-emoji-opt').forEach(el => {
      if (el.id === `${containerId}-show-more`) {
        el.onclick = () => buildGrid(true);
      } else {
        el.onclick = () => {
          grid.querySelectorAll('.task-emoji-opt').forEach(x => x.classList.remove('selected'));
          el.classList.add('selected');
          selectedEmoji = el.dataset.emoji;
          onChange(el.dataset.emoji);
        };
      }
    });
  }

  const currentIdx = PRIZE_EMOJIS.indexOf(selectedEmoji);
  buildGrid(currentIdx >= SHOW_INITIAL);
}

/** רינדור assign grid (זהה למשימות) */
export function renderPrizeAssignGrid(containerId, selectedIds, onChange) {
  const grid = document.getElementById(containerId);
  if (!grid) return;
  let assigned = [...selectedIds];
  grid.innerHTML = childrenCache.map(c => {
    const genderEmoji = c.gender === 'boy' ? '👦' : '👧';
    const hasPhoto = c.photo && c.photo.length > 10;
    const photoHTML = hasPhoto
      ? `<img src="${c.photo}" alt="${c.name}">`
      : `<span>${c.emoji || genderEmoji}</span>`;
    const isSelected = assigned.includes(c.id);
    const color    = c.color || '#6366F1';
    const bg       = colorGradient ? colorGradient(color) : color;
    const selStyle = isSelected ? `border-color:${color};background:${bg};box-shadow:0 0 0 3px ${color}33;` : '';
    return `<div class="assign-opt${isSelected ? ' selected' : ''}" data-child-id="${c.id}" data-color="${color}" style="${selStyle}">
      <div class="assign-photo">${photoHTML}</div>
      <span class="assign-name">${c.name}</span>
    </div>`;
  }).join('');
  grid.querySelectorAll('.assign-opt').forEach(el => {
    el.onclick = () => {
      el.classList.toggle('selected');
      const cid   = el.dataset.childId;
      const color = el.dataset.color || '#6366F1';
      const bg    = colorGradient ? colorGradient(color) : color;
      if (el.classList.contains('selected')) {
        el.style.borderColor = color;
        el.style.background  = bg;
        el.style.boxShadow   = `0 0 0 3px ${color}33`;
      } else {
        el.style.borderColor = '';
        el.style.background  = '';
        el.style.boxShadow   = '';
      }
      if (assigned.includes(cid)) assigned = assigned.filter(id => id !== cid);
      else assigned.push(cid);
      onChange(assigned);
    };
  });
}

/** רינדור רשימת הצעות פרסים */
export function renderPrizeSuggestions(onSelect) {
  const wrap = document.getElementById('prize-suggestions-wrap');
  if (!wrap) return;
  wrap.innerHTML = PRIZE_SUGGESTIONS.map(s =>
    `<div class="suggestion-chip" data-name="${s.name}" data-emoji="${s.emoji}" data-pts="${s.pts}">
      ${s.emoji} ${s.name} <span style="color:var(--muted);font-size:0.78rem;">${s.pts}⭐</span>
    </div>`
  ).join('');
  wrap.querySelectorAll('.suggestion-chip').forEach(el => {
    el.onclick = () => {
      onSelect({ name: el.dataset.name, emoji: el.dataset.emoji, pts: parseInt(el.dataset.pts) });
      document.getElementById('prize-suggestions-wrap').style.display = 'none';
    };
  });
}

// =========== GUIDED TOUR ===========
export function startPrizeTour(familyId) {
  const quickVisible = getComputedStyle(
    document.getElementById('prize-quick-section') || document.createElement('div')
  ).display !== 'none';

  const step1Text = quickVisible
    ? 'הכנס שם לפרס, לחץ "💡 רעיונות לדוגמא" לרשימה מוכנה — או צור 3 פרסים אוטומטיים בלחיצה על הקטגוריה'
    : 'הכנס שם לפרס ולחץ "💡 רעיונות לדוגמא" לקבל השראה';

  const steps = [
    { el: '#prize-name-input',      title: 'שם הפרס',         text: step1Text },
    { el: '#prize-assign-grid',     title: 'שיוך לילד/ים',    text: 'בחר לאיזה ילד/ים הפרס זמין — ניתן לשייך לכמה ילדים בו-זמנית' },
    { el: '#prize-emoji-grid',      title: 'אייקון',           text: 'בחר אייקון שמייצג את הפרס — יופיע לילד במסך הפרסים שלו' },
    { el: '#prize-pts-slider',      title: 'מחיר בכוכבים ⭐',  text: 'גרור את הסליידר כדי לקבוע כמה כוכבים עולה הפרס' },
    { el: '#prize-repeat-toggle',   title: 'תיאור ואפשרויות', text: 'הוסף תיאור קצר, ובחר אם הפרס יחזור להיות זמין לאחר מימוש', exact: false },
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
    if (getComputedStyle(rawEl).display === 'none') {
      currentStep++;
      if (currentStep >= steps.length) endTour(); else showStep(currentStep);
      return;
    }
    const el = step.exact ? rawEl : (rawEl.closest('.form-section') || rawEl);

    card.classList.remove('visible');
    void card.offsetWidth;
    shutterTop.style.height = '0px';
    shutterBottom.style.height = '0px';
    const isLastStep = idx === steps.length - 1;
    rawEl.scrollIntoView({ behavior: 'smooth', block: isLastStep ? 'start' : 'center' });

    setTimeout(() => {
      const rect = el.getBoundingClientRect();
      shutterTop.style.height    = Math.max(0, rect.top - PAD) + 'px';
      shutterBottom.style.height = Math.max(0, window.innerHeight - rect.bottom - PAD) + 'px';

      const dotsHTML = steps.map((_, i) =>
        `<span class="tour-dot${i === idx ? ' active' : ''}"></span>`
      ).join('');

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

      setTimeout(() => card.classList.add('visible'), 130);
    }, 520);
  }

  function endTour() {
    card.classList.remove('visible');
    shutterTop.style.height    = Math.ceil(window.innerHeight / 2 + 2) + 'px';
    shutterBottom.style.height = Math.ceil(window.innerHeight / 2 + 2) + 'px';
    setTimeout(() => {
      overlay.remove();
      document.body.style.overflow = '';
      updateDoc(doc(db, 'families', familyId), { prizeTourDone: true }).catch(() => {});
      setTimeout(() => document.getElementById('prize-name-input')?.focus(), 200);
    }, 540);
  }

  overlay.onclick = (e) => e.stopPropagation();
  showStep(0);
}
