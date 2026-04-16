// =========== child-profile.js ===========
// עריכת פרופיל ילד: אימוג'י, צבע, תמונה.
// initProfile(db, renderChildFn) — קורא פעם אחת מ-child.js

import { doc, updateDoc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { state } from './child-state.js';
import { show } from './child-ui.js';
import { cropAndCompressPhoto } from './ui.js';
import { SPLAT_SVG } from './icons.js';

// -------- CONSTANTS --------
const PROFILE_EMOJIS = [
  '🦁','🐱','🦄','🐶','🐸','🦊','🐼','🦋','🌟','🎈',
  '🐯','🐰','🦜','🐻','🎀','🚀','⚽','🎸','🌈','🧸',
  '🐬','🦕','🐝','🍀',
];
const PROFILE_COLORS = [
  '#10B981','#3B82F6','#06B6D4','#8B5CF6','#EC4899','#EF4444','#F97316','#F59E0B',
];

// -------- LOCAL STATE --------
let _db            = null;
let _renderChildFn = null;
let profileEmoji   = '';
let profileColor   = '';
let profilePhotoData    = null;
let profilePhotoCleared = false;

// -------- INIT (קריאה חד-פעמית) --------
export function initProfile(db, renderChildFn) {
  _db            = db;
  _renderChildFn = renderChildFn;

  document.getElementById('child-header-photo').onclick = () => {
    if (state.childData) openChildProfile();
  };

  document.getElementById('btn-profile-back').onclick = () => show('screen-child');

  document.getElementById('profile-photo-input').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    profilePhotoCleared = false;
    try {
      profilePhotoData = await cropAndCompressPhoto(file);
      document.getElementById('profile-photo-preview').src = profilePhotoData;
      document.getElementById('profile-photo-preview').style.display = 'block';
      document.getElementById('profile-photo-placeholder').style.display = 'none';
      const upload = document.getElementById('profile-photo-upload');
      upload.style.border = 'none'; upload.style.width = '85px'; upload.style.height = '85px';
      const clearBtn = document.getElementById('btn-profile-clear-photo');
      clearBtn.innerHTML = '🗑️ מחק';
      clearBtn.style.display = 'block';
    } catch (err) {
      document.getElementById('profile-error').textContent = 'שגיאה בטעינת התמונה ⚠️';
    }
  };

  document.getElementById('btn-profile-clear-photo').onclick = () => {
    profilePhotoData    = null;
    profilePhotoCleared = true;
    document.getElementById('profile-photo-preview').style.display = 'none';
    document.getElementById('profile-photo-placeholder').style.display = '';
    document.getElementById('profile-photo-input').value = '';
    const upload = document.getElementById('profile-photo-upload');
    upload.style.border = '3px dashed var(--border)'; upload.style.width = '95px'; upload.style.height = '95px';
    const clearBtn = document.getElementById('btn-profile-clear-photo');
    clearBtn.style.display = 'none';
    clearBtn.innerHTML = '🗑️ מחק';
  };

  document.getElementById('btn-profile-save').onclick = saveProfile;
}

// -------- OPEN PROFILE SCREEN --------
export function openChildProfile() {
  const { childData } = state;
  profileEmoji        = childData.emoji || '';
  profileColor        = childData.color || '';
  profilePhotoData    = null;
  profilePhotoCleared = false;

  document.getElementById('profile-child-name').textContent   = childData.name;
  document.getElementById('profile-child-gender').textContent =
    childData.gender === 'female' ? '👧 נקבה' : '👦 זכר';

  const colorEl = document.getElementById('profile-color-display');
  colorEl.innerHTML = childData.color ? SPLAT_SVG(childData.color, 118) : SPLAT_SVG('#94A3B8', 118, true);
  colorEl.style.background = 'transparent';
  colorEl.style.border = 'none';
  colorEl.onclick = () => showProfileColorModal();

  const emojiEl = document.getElementById('profile-emoji-display');
  emojiEl.textContent = childData.emoji || '';
  if (childData.emoji) {
    emojiEl.style.background = 'none';
    emojiEl.style.border = 'none';
    emojiEl.style.fontSize = '80px';
  } else {
    emojiEl.style.background = '';
    emojiEl.style.border = '';
    emojiEl.style.fontSize = '';
  }
  emojiEl.onclick = () => showProfileEmojiModal();

  const preview     = document.getElementById('profile-photo-preview');
  const placeholder = document.getElementById('profile-photo-placeholder');
  const upload      = document.getElementById('profile-photo-upload');
  const clearBtn    = document.getElementById('btn-profile-clear-photo');
  if (childData.photo && childData.photo.length > 10) {
    preview.src            = childData.photo;
    preview.style.display  = 'block';
    placeholder.style.display = 'none';
    upload.style.border = 'none'; upload.style.width = '85px'; upload.style.height = '85px';
    clearBtn.innerHTML = '🗑️ מחק';
    clearBtn.style.display = 'block';
  } else {
    preview.style.display     = 'none';
    placeholder.style.display = '';
    upload.style.border = '3px dashed var(--border)'; upload.style.width = '95px'; upload.style.height = '95px';
    clearBtn.style.display = 'none';
  }

  document.getElementById('profile-error').textContent = '';
  show('screen-child-profile');
}

// -------- SAVE --------
async function saveProfile() {
  const err = document.getElementById('profile-error');
  try {
    const updates = {};
    if (profileEmoji && profileEmoji !== state.childData.emoji) updates.emoji = profileEmoji;
    if (profileColor && profileColor !== state.childData.color) updates.color = profileColor;
    if (profilePhotoData)    updates.photo = profilePhotoData;
    if (profilePhotoCleared) updates.photo = '';

    if (Object.keys(updates).length === 0) { show('screen-child'); return; }

    await updateDoc(
      doc(_db, 'families', state.familyId, 'children', state.childId),
      updates,
    );
    Object.assign(state.childData, updates);
    if (updates.color) document.documentElement.style.setProperty('--child-color', updates.color);
    _renderChildFn();
    show('screen-child');
  } catch (e) {
    err.textContent = 'שגיאה בשמירה, נסה שוב';
    console.error(e);
  }
}

// -------- EMOJI PICKER MODAL --------
function showProfileEmojiModal() {
  let tempEmoji = profileEmoji;
  const ov = document.createElement('div'); ov.className = 'modal-overlay';
  const sh = document.createElement('div'); sh.className = 'modal-sheet';
  sh.innerHTML = `
    <div class="modal-handle"></div>
    <div class="modal-header">
      <h2>בחר אימוג'י</h2>
      <button class="modal-close">✕</button>
    </div>
    <div class="modal-body">
      <div id="emoji-preview-display" style="font-size:4rem;text-align:center;min-height:64px;margin-bottom:12px;transition:transform 0.2s cubic-bezier(.34,1.28,.64,1);">${tempEmoji || '?'}</div>
      <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:6px;margin-bottom:16px;">
        ${PROFILE_EMOJIS.map(e =>
          `<div class="emoji-opt${e === tempEmoji ? ' selected' : ''}" data-emoji="${e}" style="font-size:1.6rem;aspect-ratio:1;display:flex;align-items:center;justify-content:center;border-radius:12px;cursor:pointer;">${e}</div>`
        ).join('')}
      </div>
      <button id="emoji-confirm-btn" style="width:100%;padding:14px;background:linear-gradient(135deg,var(--child-color,#6366F1),#8B5CF6);border:none;border-radius:16px;font-size:1rem;font-weight:900;font-family:'Heebo',sans-serif;cursor:pointer;color:white;">אישור ✓</button>
    </div>`;
  sh.querySelector('.modal-close').onclick = () => ov.remove();
  ov.onclick = e => { if (e.target === ov) ov.remove(); };

  const preview = sh.querySelector('#emoji-preview-display');

  sh.querySelectorAll('.emoji-opt').forEach(el => {
    el.onclick = () => {
      const prev = tempEmoji;
      tempEmoji = el.dataset.emoji;
      sh.querySelectorAll('.emoji-opt').forEach(x => x.classList.remove('selected'));
      el.classList.add('selected');
      if (tempEmoji !== prev) {
        preview.style.transform = 'scale(0.6)';
        setTimeout(() => {
          preview.textContent = tempEmoji;
          preview.style.transform = 'scale(1)';
        }, 120);
      }
    };
  });

  sh.querySelector('#emoji-confirm-btn').onclick = () => {
    if (!tempEmoji) { ov.remove(); return; }
    profileEmoji = tempEmoji;
    const ed = document.getElementById('profile-emoji-display');
    ed.textContent = profileEmoji;
    ed.style.background = 'none';
    ed.style.border = 'none';
    ed.style.fontSize = '80px';
    ov.remove();
  };

  ov.appendChild(sh);
  document.body.appendChild(ov);
}

// -------- COLOR PICKER MODAL --------
function showProfileColorModal() {
  const ov = document.createElement('div'); ov.className = 'modal-overlay';
  const sh = document.createElement('div'); sh.className = 'modal-sheet';
  let tempColor = profileColor;
  sh.innerHTML = `
    <div class="modal-handle"></div>
    <div class="modal-header"><h2>בחר צבע 🎨</h2><button class="modal-close">✕</button></div>
    <div class="modal-body">
      <div class="splat-modal-preview" id="modal-color-preview">
        ${profileColor ? SPLAT_SVG(profileColor, 115) : SPLAT_SVG('#94A3B8', 115, true)}
      </div>
      <div class="splat-color-grid">
        ${PROFILE_COLORS.map(c => `<div class="splat-color-opt${c === profileColor ? ' splat-selected' : ''}" data-color="${c}">${SPLAT_SVG(c, 70)}</div>`).join('')}
      </div>
      <button class="splat-confirm-btn" id="modal-color-confirm">אישור ✓</button>
    </div>`;
  sh.querySelector('.modal-close').onclick = () => ov.remove();
  ov.onclick = e => { if (e.target === ov) ov.remove(); };
  sh.querySelectorAll('.splat-color-opt').forEach(el => {
    el.onclick = () => {
      tempColor = el.dataset.color;
      sh.querySelectorAll('.splat-color-opt').forEach(x => x.classList.remove('splat-selected'));
      el.classList.add('splat-selected');
      const prev = sh.querySelector('#modal-color-preview');
      prev.style.transition = 'transform 0.25s cubic-bezier(.34,1.5,.64,1), opacity 0.15s';
      prev.style.opacity = '0'; prev.style.transform = 'scale(0.7)';
      setTimeout(() => { prev.innerHTML = SPLAT_SVG(tempColor, 115); prev.style.opacity = '1'; prev.style.transform = 'scale(1)'; }, 150);
    };
  });
  sh.querySelector('#modal-color-confirm').onclick = () => {
    if (!tempColor) { ov.remove(); return; }
    profileColor = tempColor;
    const colorEl = document.getElementById('profile-color-display');
    colorEl.innerHTML = SPLAT_SVG(profileColor, 118);
    colorEl.style.background = 'transparent'; colorEl.style.border = 'none';
    ov.remove();
  };
  ov.appendChild(sh); document.body.appendChild(ov);
}
