// =========== child-notifications.js ===========
import {
  collection, getDocs, doc, updateDoc,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

let _db, _familyId, _childId;
let _notifications = [];

// =========== LAST-SEEN (localStorage) ===========
function _seenKey()    { return `notifLastSeen_${_familyId}_${_childId}`; }
function _getLastSeen(){ try { return parseInt(localStorage.getItem(_seenKey()) || '0', 10); } catch(e) { return 0; } }
function _setLastSeen(){ try { localStorage.setItem(_seenKey(), String(Date.now())); } catch(e) {} }

// טייפים שמציגים פופאפ בכניסה
const POPUP_TYPES = new Set([
  'task_cancelled', 'prize_approved', 'prize_declined',
  'prize_reversed', 'manual_pts',
]);

const TYPE_CFG = {
  task_approved:  { icon: '✅', title: 'משימה אושרה!' },
  task_rejected:  { icon: '❌', title: 'משימה לא אושרה' },
  task_cancelled: { icon: '↩️', title: 'משימה בוטלה' },
  prize_approved: { icon: '🎉', title: 'פרס אושר!' },
  prize_declined: { icon: '😔', title: 'פרס לא אושר' },
  prize_reversed: { icon: '↩️', title: 'פרס בוטל' },
  manual_pts:     { icon: '⭐', title: 'עדכון כוכבים' },
};

function _tsOf(n) {
  if (n.ts) return n.ts;
  if (n.createdAt?.seconds) return n.createdAt.seconds * 1000;
  return 0;
}

// =========== INIT ===========
export async function initNotifications(db_, familyId, childId) {
  _db = db_; _familyId = familyId; _childId = childId;
  await _load();
}

async function _load() {
  try {
    const snap = await getDocs(
      collection(_db, 'families', _familyId, 'children', _childId, 'notifications')
    );
    _notifications = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => _tsOf(b) - _tsOf(a));
  } catch(e) {
    _notifications = [];
  }
}

// =========== POPUP QUEUE ===========
export async function processNotificationPopups() {
  const queue = _notifications.filter(n => !n.read && POPUP_TYPES.has(n.type));
  if (!queue.length) return;

  for (const n of queue) {
    await _showPopup(n);
    await _markRead(n.id);
    n.read = true;
  }
  updateNotificationBadge();
  renderNotificationsScreen();
}

function _showPopup(n) {
  return new Promise(resolve => {
    const cfg  = TYPE_CFG[n.type] || { icon: '🔔', title: 'התראה' };
    const icon = n.prizeEmoji || n.emoji || cfg.icon;

    const ov = document.createElement('div');
    ov.className = 'notif-popup-ov';
    ov.innerHTML = `
      <div class="notif-popup-card">
        <div class="notif-popup-icon">${icon}</div>
        <div class="notif-popup-title">${cfg.title}</div>
        <div class="notif-popup-msg">${n.message || ''}</div>
        <button class="notif-popup-btn">הבנתי ✅</button>
      </div>`;

    const btn = ov.querySelector('.notif-popup-btn');
    btn.onclick = () => {
      ov.classList.add('notif-popup-out');
      setTimeout(() => { ov.remove(); resolve(); }, 280);
    };

    document.body.appendChild(ov);
    requestAnimationFrame(() => ov.classList.add('notif-popup-in'));
  });
}

async function _markRead(id) {
  try {
    await updateDoc(
      doc(_db, 'families', _familyId, 'children', _childId, 'notifications', id),
      { read: true }
    );
  } catch(e) {}
}

// =========== BADGE ===========
export function getUnreadCount() {
  const lastSeen = _getLastSeen();
  return _notifications.filter(n => _tsOf(n) > lastSeen).length;
}

export function updateNotificationBadge() {
  const count = getUnreadCount();
  const badge = document.getElementById('nav-badge-notifs');
  if (!badge) return;
  badge.textContent   = count || '';
  badge.style.display = count > 0 ? 'flex' : 'none';
}

// =========== SCREEN ===========
export function renderNotificationsScreen() {
  const list = document.getElementById('notifs-list');
  if (!list) return;

  // שמור את ה-lastSeen הישן לפני עדכון — לקביעת עיגולי "חדש" בביקור זה
  const prevSeen = _getLastSeen();
  // עדכן lastSeen עכשיו — הבאדג' ייעלם מיד, העיגולים ייעלמו בביקור הבא
  _setLastSeen();
  updateNotificationBadge();

  if (_notifications.length === 0) {
    list.innerHTML = `<div class="notifs-empty">אין התראות עדיין 🔔</div>`;
    return;
  }

  list.innerHTML = _notifications.map(n => {
    const cfg     = TYPE_CFG[n.type] || { icon: '🔔', title: 'התראה' };
    const icon    = n.prizeEmoji || n.emoji || cfg.icon;
    const ts      = _tsOf(n);
    const isNew   = ts > prevSeen;
    const timeStr = ts ? new Date(ts).toLocaleString('he-IL', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    }) : '';

    return `
      <div class="notif-item${isNew ? ' notif-unread' : ''}">
        <span class="notif-item-icon">${icon}</span>
        <div class="notif-item-body">
          <div class="notif-item-title">${cfg.title}</div>
          <div class="notif-item-msg">${n.message || ''}</div>
          ${timeStr ? `<div class="notif-item-time">${timeStr}</div>` : ''}
        </div>
        ${isNew ? '<span class="notif-dot"></span>' : ''}
      </div>`;
  }).join('');
}
