// =========== js/notifications.js ===========
// לוגיקת FCM משותפת — בקשת הרשאה, קבלת token, שמירה ב-Firestore
// + תזכורות מקומיות מתוזמנות לילד

import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getMessaging, getToken, onMessage } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging.js';
import { doc, updateDoc, arrayUnion } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const VAPID_KEY = 'BBfifv9zJz2vwaxOegg1Kh0Z_jCa_L64ys7_c4Hs7JH1UG7B95tw_ORC5Vpdg2aw-zFPlD7IGL-_T4Ba-i-XvSw';

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDC0GADxe3qv6uv6s6fGR3O7_lL9iHl4ag",
  authDomain: "kidssapp-izhaki.firebaseapp.com",
  projectId: "kidssapp-izhaki",
  storageBucket: "kidssapp-izhaki.firebasestorage.app",
  messagingSenderId: "663906163746",
  appId: "1:663906163746:web:a4f66772a2ae0dedc47e7b"
};

let _messaging = null;

function _getMessaging() {
  if (_messaging) return _messaging;
  const app = getApps().length > 0 ? getApps()[0] : initializeApp(FIREBASE_CONFIG);
  _messaging = getMessaging(app);
  return _messaging;
}

// =========== הרשאה + FCM token ===========

export async function requestPushPermission() {
  try {
    if (!('Notification' in window)) return null;
    if (!('serviceWorker' in navigator)) return null;

    const reg = await navigator.serviceWorker.register('/firebase-messaging-sw.js');

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return null;

    const messaging = _getMessaging();
    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: reg,
    });

    return token || null;
  } catch (e) {
    console.warn('FCM requestPushPermission error:', e);
    return null;
  }
}

export async function saveParentFcmToken(db, familyId, token) {
  if (!token || !familyId) return;
  try {
    await updateDoc(doc(db, 'families', familyId), { fcmTokens: arrayUnion(token) });
  } catch (e) { console.warn('saveParentFcmToken error:', e); }
}

export async function saveChildFcmToken(db, familyId, childId, token) {
  if (!token || !familyId || !childId) return;
  try {
    await updateDoc(doc(db, 'families', familyId, 'children', childId), { fcmTokens: arrayUnion(token) });
  } catch (e) { console.warn('saveChildFcmToken error:', e); }
}

export function listenForegroundMessages(onNotif) {
  try {
    const messaging = _getMessaging();
    onMessage(messaging, payload => { if (typeof onNotif === 'function') onNotif(payload); });
  } catch (e) { console.warn('listenForegroundMessages error:', e); }
}

export function isPushGranted() {
  return 'Notification' in window && Notification.permission === 'granted';
}

export function isPushBlocked() {
  return 'Notification' in window && Notification.permission === 'denied';
}

// =========== תזכורות מקומיות מתוזמנות ===========

// ימים בשבוע — 0=ראשון ... 6=שבת (תואם JS getDay())
const DAY_NAMES_HE = ['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'];

/**
 * מקבל רשימת משימות של הילד, מחשב תזכורות להיום,
 * ומעביר ל-Service Worker לתזמון.
 *
 * @param {Array} tasks — מערך משימות מ-Firestore (כולל שדות: id, task, emoji, reminder, freq, days)
 */
export async function scheduleTaskReminders(tasks) {
  try {
    if (!('serviceWorker' in navigator)) return;
    if (Notification.permission !== 'granted') return;

    const reg = await navigator.serviceWorker.getRegistration('/firebase-messaging-sw.js');
    if (!reg || !reg.active) return;

    const now      = new Date();
    const reminders = [];

    // חשב תזכורות ל-7 ימים קדימה (כולל היום)
    for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
      const targetDate = new Date(now);
      targetDate.setDate(now.getDate() + dayOffset);
      targetDate.setHours(0, 0, 0, 0);

      const targetDayIdx = targetDate.getDay(); // 0=ראשון

      tasks.forEach(t => {
        if (!t.reminder) return;

        // בדוק אם המשימה רלוונטית ליום הזה
        if (!_isTaskDueOnDay(t, targetDayIdx)) return;

        // חשב timestamp מדויק של השעה ביום הזה
        const fireAt = _calcFireAtDate(now, targetDate, t.reminder);
        if (!fireAt) return;

        reminders.push({
          taskId:  t.id + '_' + dayOffset, // מפתח ייחודי לכל יום
          title:   (t.emoji || '🔔') + ' תזכורת: ' + t.task,
          body:    _reminderBody(t),
          fireAt,
        });
      });
    }

    reg.active.postMessage({
      type: 'SCHEDULE_REMINDERS',
      reminders,
    });

  } catch (e) {
    console.warn('scheduleTaskReminders error:', e);
  }
}

/**
 * ביטול כל התזכורות (למשל כשהילד מתנתק)
 */
export async function clearTaskReminders() {
  try {
    if (!('serviceWorker' in navigator)) return;
    const reg = await navigator.serviceWorker.getRegistration('/firebase-messaging-sw.js');
    if (reg?.active) reg.active.postMessage({ type: 'CLEAR_REMINDERS' });
  } catch (e) {}
}

// -------- helpers פרטיים --------

/**
 * בדיקה אם משימה רלוונטית ליום מסוים
 * dayIdx: 0=ראשון ... 6=שבת
 */
function _isTaskDueOnDay(task, dayIdx) {
  const freq = task.freq || 'daily';
  if (freq === 'daily')    return true;
  if (freq === 'once')     return true;
  if (freq === 'weekly')   return true;
  if (freq === '2week')    return true;
  if (freq === 'specific') {
    const days = (task.days || []).map(Number);
    return days.includes(dayIdx);
  }
  return true;
}

/**
 * חישוב timestamp של השעה הנדרשת בתאריך מסוים
 * now:        Date — הרגע הנוכחי
 * targetDate: Date — היום הרצוי (midnight)
 * reminder:   "HH:MM"
 * מחזיר null אם הזמן כבר עבר
 */
function _calcFireAtDate(now, targetDate, reminder) {
  const parts = (reminder || '').split(':');
  if (parts.length < 2) return null;
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (isNaN(h) || isNaN(m)) return null;

  const fireDate = new Date(targetDate);
  fireDate.setHours(h, m, 0, 0);

  // אם הזמן כבר עבר — לא מתזמנים
  if (fireDate.getTime() <= now.getTime()) return null;

  return fireDate.getTime();
}

function _reminderBody(task) {
  const pts = task.pts || 1;
  return `השלם את המשימה ותרוויח ${pts} ⭐`;
}
