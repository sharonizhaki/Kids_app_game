// =========== child-profile.js ===========
// עריכת פרופיל ילד: אימוג'י, צבע, תמונה.
// initProfile(db, renderChildFn) — קורא פעם אחת מ-child.js

import { doc, updateDoc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { state } from './child-state.js';
import { show } from './child-ui.js';
import { cropAndCompressPhoto } from './utils.js';

// -------- CONSTANTS --------
const PROFILE_EMOJIS = [
  '🦁','🐱','🦄','🐶','🐸','🦊','🐼','🦋','🌟','🎈',
  '🐯','🐰','🦜','🐻','🎀','🚀','⚽','🎸','🌈','🧸',
  '🐬','🦕','🐝','🍀',
];
const PROFILE_COLORS = [
  '#EF4444','#F59E0B','#10B981','#3B82F6','#8B5CF6',
  '#EC4899','#06B6D4','#F97316','#84CC16','#6366F1',
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

  // פתיחת פרופיל מהקליק על תמונת הראש
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
  };

  document.getElementById('btn-profile-save').onclick = saveProfile;
}

// -------- OPEN PROFILE SCREEN --------
function openChildProfile() {
  const { childData } = state;
  profileEmoji        = childData.emoji || '';
  profileColor        = childData.color || '';
  profilePhotoData    = null;
  profilePhotoCleared = false;

  document.getElementById('profile-child-name').textContent   = childData.name;
  document.getElementById('profile-child-gender').textContent =
    childData.gender === 'female' ? '👧 נקבה' : '👦 זכר';

  const colorEl = document.getElementById('profile-color-display');
  colorEl.style.background = childData.color || 'var(--border)';
  colorEl.onclick = () => showProfileColorModal();

  const emojiEl = document.getElementById('profile-emoji-display');
  emojiEl.textContent = childData.emoji || '—';
  emojiEl.onclick = () => showProfileEmojiModal();

  const preview     = document.getElementById('profile-photo-preview');
  const placeholder = document.getElementById('profile-photo-placeholder');
  if (childData.photo && childData.photo.length > 10) {
    preview.src            = childData.photo;
    preview.style.display  = 'block';
    placeholder.style.display = 'none';
  } else {
    preview.style.display     = 'none';
    placeholder.style.display = '';
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
  const ov = document.createElement('div'); ov.className = 'modal-overlay';
  const sh = document.createElement('div'); sh.className = 'modal-sheet';
  sh.innerHTML = `
    <div class="modal-handle"></div>
    <div class="modal-header">
      <h2>בחר אימוג'י</h2>
      <button class="modal-close">✕</button>
    </div>
    <div class="modal-body">
      <div class="emoji-grid">
        ${PROFILE_EMOJIS.map(e =>
          `<div class="emoji-opt${e === profileEmoji ? ' selected' : ''}" data-emoji="${e}">${e}</div>`
        ).join('')}
      </div>
    </div>`;
  sh.querySelector('.modal-close').onclick = () => ov.remove();
  ov.onclick = e => { if (e.target === ov) ov.remove(); };
  sh.querySelectorAll('.emoji-opt').forEach(el => {
    el.onclick = () => {
      profileEmoji = el.dataset.emoji;
      document.getElementById('profile-emoji-display').textContent = profileEmoji;
      ov.remove();
    };
  });
  ov.appendChild(sh);
  document.body.appendChild(ov);
}

// -------- COLOR PICKER MODAL --------
function showProfileColorModal() {
  const ov = document.createElement('div'); ov.className = 'modal-overlay';
  const sh = document.createElement('div'); sh.className = 'modal-sheet';
  sh.innerHTML = `
    <div class="modal-handle"></div>
    <div class="modal-header">
      <h2>בחר צבע</h2>
      <button class="modal-close">✕</button>
    </div>
    <div class="modal-body">
      <div class="color-grid">
        ${PROFILE_COLORS.map(c =>
          `<div class="color-opt${c === profileColor ? ' selected' : ''}" data-color="${c}" style="background:${c}"></div>`
        ).join('')}
      </div>
    </div>`;
  sh.querySelector('.modal-close').onclick = () => ov.remove();
  ov.onclick = e => { if (e.target === ov) ov.remove(); };
  sh.querySelectorAll('.color-opt').forEach(el => {
    el.onclick = () => {
      profileColor = el.dataset.color;
      document.getElementById('profile-color-display').style.background = profileColor;
      ov.remove();
    };
  });
  ov.appendChild(sh);
  document.body.appendChild(ov);
}
