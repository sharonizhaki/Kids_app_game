import { auth, db } from './firebase.js';
import {
  doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc,
  collection, serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { showScreen, showToast, showLoading, hideLoading } from './ui.js';
import { generateCode } from './auth.js';

// =========== CONSTANTS ===========
export const CHILD_EMOJIS = ["🦁","🐱","🦄","🐶","🐸","🦊","🐼","🦋","🌟","🎈","🐯","🐰","🦜","🐻","🎀","🚀","⚽","🎸","🌈","🧸","🐬","🦕","🐝","🍀"];
export const CHILD_COLORS = ["#EF4444","#F59E0B","#10B981","#3B82F6","#8B5CF6","#EC4899","#06B6D4","#F97316","#84CC16","#6366F1"];
const CODE_EXPIRY_MS = 24 * 60 * 60 * 1000;

// =========== STATE ===========
export let childrenCache = [];
export let editingChildId = null;

// =========== LOAD CHILDREN ===========
export async function loadChildren(familyId) {
  if (!familyId) return;
  const snap = await getDocs(collection(db, 'families', familyId, 'children'));
  childrenCache = [];
  snap.forEach(d => childrenCache.push({ id: d.id, ...d.data() }));
}

// =========== RENDER FAMILY GRID ===========
export function renderFamily(familyId) {
  const grid = document.getElementById('family-grid');
  if (childrenCache.length === 0) {
    grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1;">עדיין לא נוספו ילדים</div>';
  } else {
    grid.innerHTML = childrenCache.map(c => {
      const genderEmoji = c.gender === 'male' ? '👦' : '👧';
      const hasPhoto = c.photo && c.photo.length > 10;
      const photoHTML = hasPhoto
        ? `<img src="${c.photo}" alt="${c.name}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`
        : `<span style="font-size:1.8rem;">${c.emoji || genderEmoji}</span>`;
      const isWaiting = c.status === 'waiting';
      return `
        <div class="child-card" onclick="${isWaiting ? `showChildInviteModal('${c.id}')` : `openEditChild('${c.id}')`}">
          <div class="cc-photo">${photoHTML}</div>
          <div class="cc-name">${c.name}</div>
          <div class="cc-gender">${genderEmoji} ${c.gender === 'male' ? 'זכר' : 'נקבה'}</div>
          ${isWaiting ? `
            <span class="cc-status waiting">ממתין לכניסה</span>
            <span class="cc-code">${c.inviteCode || ''}</span>
          ` : `
            <span class="cc-status active">פעיל ✅</span>
          `}
        </div>`;
    }).join('');
  }
  renderParentsList(familyId);
}

// =========== RENDER PARENTS LIST ===========
async function renderParentsList(familyId) {
  const list = document.getElementById('parents-list');
  if (!familyId) { list.innerHTML = ''; return; }
  try {
    const famDoc = await getDoc(doc(db, 'families', familyId));
    if (!famDoc.exists()) return;
    const fam = famDoc.data();
    let html = `<div class="card" style="padding:14px 16px;margin-bottom:8px;">
      <div style="display:flex;align-items:center;gap:10px;">
        <span style="font-size:1.4rem;">👑</span>
        <div style="flex:1;">
          <strong style="font-size:0.92rem;">${fam.parentName || 'הורה ראשי'}</strong>
          <div style="font-size:0.78rem;color:var(--muted);">${fam.parentEmail || ''}</div>
        </div>
        <span style="font-size:0.72rem;background:#DBEAFE;color:#1D4ED8;padding:3px 8px;border-radius:6px;font-weight:600;">ראשי</span>
      </div>
    </div>`;
    if (fam.secondaryParentUid) {
      html += `<div class="card" style="padding:14px 16px;margin-bottom:8px;">
        <div style="display:flex;align-items:center;gap:10px;">
          <span style="font-size:1.4rem;">👫</span>
          <div style="flex:1;">
            <strong style="font-size:0.92rem;">${fam.secondaryParentName || 'הורה משני'}</strong>
            <div style="font-size:0.78rem;color:var(--muted);">${fam.secondaryParentEmail || ''}</div>
          </div>
          <span style="font-size:0.72rem;background:#DCFCE7;color:#15803D;padding:3px 8px;border-radius:6px;font-weight:600;">משני</span>
        </div>
      </div>`;
    }
    list.innerHTML = html;
  } catch(e) { console.error(e); }
}

// =========== CREATE CHILD ===========
export async function createChild(familyId, name, gender) {
  if (!name) return { error: 'חובה להכניס שם' };
  if (!gender) return { error: 'חובה לבחור מין' };

  showLoading('יוצר...');
  try {
    const code = generateCode();
    const childRef = doc(collection(db, 'families', familyId, 'children'));
    await setDoc(childRef, {
      name,
      gender,
      emoji: '',
      color: '',
      photo: '',
      inviteCode: code,
      codeCreatedAt: Timestamp.now(),
      codeAttempts: 0,
      status: 'waiting',
      anonUid: '',
      createdAt: serverTimestamp()
    });
    await setDoc(doc(db, 'inviteCodes', code), {
      familyId,
      childId: childRef.id,
      createdAt: Timestamp.now(),
      used: false
    });
    hideLoading();
    return { success: true, code };
  } catch(e) {
    hideLoading();
    console.error(e);
    return { error: 'שגיאה ביצירה, נסה שוב' };
  }
}

// =========== SAVE CHILD ===========
export async function saveChild(familyId, childId, updates) {
  showLoading('שומר...');
  try {
    await updateDoc(doc(db, 'families', familyId, 'children', childId), updates);
    hideLoading();
    return { success: true };
  } catch(e) {
    hideLoading();
    console.error(e);
    return { error: 'שגיאה בשמירה' };
  }
}

// =========== DELETE CHILD ===========
export async function deleteChild(familyId, childId) {
  showLoading('מוחק...');
  try {
    const child = childrenCache.find(c => c.id === childId);
    if (child?.inviteCode) {
      try { await deleteDoc(doc(db, 'inviteCodes', child.inviteCode)); } catch(e) {}
    }
    await deleteDoc(doc(db, 'families', familyId, 'children', childId));
    hideLoading();
    return { success: true };
  } catch(e) {
    hideLoading();
    console.error(e);
    return { error: 'שגיאה במחיקה' };
  }
}

// =========== INVITE PARENT CODE ===========
export async function createParentInviteCode(familyId) {
  showLoading('יוצר קוד...');
  try {
    const code = generateCode();
    await setDoc(doc(db, 'parentInviteCodes', code), {
      familyId,
      createdAt: Timestamp.now(),
      used: false
    });
    hideLoading();
    return { success: true, code };
  } catch(e) {
    hideLoading();
    console.error(e);
    return { error: 'שגיאה ביצירת קוד' };
  }
}

// =========== VERIFY CHILD CODE ===========
export async function verifyChildCode(code) {
  try {
    const codeSnap = await getDoc(doc(db, 'inviteCodes', code));
    if (!codeSnap.exists()) return { error: 'קוד שגוי, נסה שוב' };

    const codeData = codeSnap.data();
    const created = codeData.createdAt?.toDate ? codeData.createdAt.toDate() : new Date(0);
    if (Date.now() - created.getTime() > CODE_EXPIRY_MS) return { error: 'הקוד פג תוקף. בקש קוד חדש מההורים' };
    if (codeData.used) return { error: 'הקוד כבר שומש' };

    const childSnap = await getDoc(doc(db, 'families', codeData.familyId, 'children', codeData.childId));
    if (!childSnap.exists()) return { error: 'שגיאה, פנה להורים' };

    return {
      success: true,
      familyId: codeData.familyId,
      childId: codeData.childId,
      code,
      ...childSnap.data()
    };
  } catch(e) {
    console.error(e);
    return { error: 'שגיאה, נסה שוב' };
  }
}

// =========== CHILD INVITE MODAL ===========
export function showChildInviteModal(childId, familyId) {
  const child = childrenCache.find(c => c.id === childId);
  if (!child) return;
  const code = child.inviteCode || '------';

  const ov = document.createElement('div'); ov.className = 'modal-overlay';
  const sh = document.createElement('div'); sh.className = 'modal-sheet';
  sh.innerHTML = `<div class="modal-handle"></div>
    <div class="modal-header"><h2>🔑 קוד הזמנה — ${child.name}</h2><button class="modal-close">✕</button></div>
    <div class="modal-body">
      <div style="text-align:right;margin-bottom:16px;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
          <span style="background:var(--primary);color:white;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:0.85rem;font-weight:800;flex-shrink:0;">1</span>
          <span style="font-size:0.92rem;font-weight:600;">פתח את האפליקציה במכשיר של הילד/ה</span>
        </div>
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
          <span style="background:var(--primary);color:white;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:0.85rem;font-weight:800;flex-shrink:0;">2</span>
          <span style="font-size:0.92rem;font-weight:600;">בחר <strong>"אני ילד/ה"</strong></span>
        </div>
        <div style="display:flex;align-items:center;gap:10px;">
          <span style="background:var(--primary);color:white;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:0.85rem;font-weight:800;flex-shrink:0;">3</span>
          <span style="font-size:0.92rem;font-weight:600;">הזן את הקוד למטה</span>
        </div>
      </div>
      <p style="color:var(--muted);font-size:0.82rem;text-align:center;margin-bottom:10px;">הקוד תקף ל-24 שעות ולבן משפחה אחד</p>
      <div class="invite-code-display">${code}</div>
      <div style="display:flex;gap:10px;margin-top:16px;">
        <button class="btn btn-primary btn-sm" id="modal-share-code" style="flex:1;">📤 שתף קוד</button>
        <button class="btn btn-secondary btn-sm" id="modal-edit-child" style="flex:1;">✏️ עריכה</button>
      </div>
    </div>`;

  sh.querySelector('.modal-close').onclick = () => ov.remove();
  ov.onclick = e => { if (e.target === ov) ov.remove(); };

  sh.querySelector('#modal-share-code').onclick = () => shareCode(code, child.name);
  sh.querySelector('#modal-edit-child').onclick = () => {
    ov.remove();
    window.openEditChild(childId);
  };

  ov.appendChild(sh);
  document.body.appendChild(ov);
}

// =========== SHARE CODE ===========
export function shareCode(code, childName = '') {
  const url = window.location.origin + window.location.pathname.replace(/[^/]*$/, 'index.html');
  const nameStr = childName ? ` ל${childName}` : '';
  const greeting = childName ? `שלום ${childName}! ` : '';
  const text = `🏠 משימות משפחתיות — קוד הזמנה${nameStr}\n\n${greeting}קיבלת הזמנה להצטרף למשימות המשפחה.\n\n📱 שלב 1: פתח את הקישור במכשיר שלך\n👧 שלב 2: בחר "אני ילד/ה"\n🔢 שלב 3: הזן את הקוד: ${code}\n\n⏰ הקוד תקף ל-24 שעות\n\n🔗 ${url}`;
  if (navigator.share) {
    navigator.share({ title: 'קוד הזמנה', text }).catch(() => {});
  } else {
    navigator.clipboard.writeText(text).then(() => showToast('הקוד הועתק! 📋'));
  }
}

export function shareParentCode(code) {
  const url = window.location.origin + window.location.pathname.replace(/[^/]*$/, 'index.html');
  const text = `🏠 משימות משפחתיות — הזמנה להורה נוסף\n\nשלום! קיבלת הזמנה להצטרף כהורה לניהול משימות המשפחה.\n\n📱 שלב 1: פתח את הקישור במכשיר שלך\n👨‍👩‍👧‍👦 שלב 2: בחר "הורה" והתחבר עם Google או Facebook\n🔢 שלב 3: הזן את הקוד: ${code}\n\n⏰ הקוד תקף ל-24 שעות\n\n🔗 ${url}`;
  if (navigator.share) {
    navigator.share({ title: 'הזמנה להצטרפות כהורה', text }).catch(() => {});
  } else {
    navigator.clipboard.writeText(text).then(() => showToast('הקוד הועתק! 📋'));
  }
}
