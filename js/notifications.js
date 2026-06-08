// =========== js/notifications.js ===========
// לוגיקת FCM משותפת — בקשת הרשאה, קבלת token, שמירה ב-Firestore

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
  // משתמש באפליקציה הקיימת אם כבר אותחלה
  const app = getApps().length > 0
    ? getApps()[0]
    : initializeApp(FIREBASE_CONFIG);
  _messaging = getMessaging(app);
  return _messaging;
}

/**
 * בקשת הרשאת Push + קבלת FCM token
 * מחזיר token או null אם לא אושר / לא נתמך
 */
export async function requestPushPermission() {
  try {
    if (!('Notification' in window)) return null;
    if (!('serviceWorker' in navigator)) return null;

    // רשום את ה-Service Worker אם עוד לא
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

/**
 * שמירת FCM token להורה ב-Firestore
 * families/{familyId}.fcmTokens → array
 */
export async function saveParentFcmToken(db, familyId, token) {
  if (!token || !familyId) return;
  try {
    await updateDoc(doc(db, 'families', familyId), {
      fcmTokens: arrayUnion(token),
    });
  } catch (e) {
    console.warn('saveParentFcmToken error:', e);
  }
}

/**
 * שמירת FCM token לילד ב-Firestore
 * families/{familyId}/children/{childId}.fcmTokens → array
 */
export async function saveChildFcmToken(db, familyId, childId, token) {
  if (!token || !familyId || !childId) return;
  try {
    await updateDoc(doc(db, 'families', familyId, 'children', childId), {
      fcmTokens: arrayUnion(token),
    });
  } catch (e) {
    console.warn('saveChildFcmToken error:', e);
  }
}

/**
 * האזנה להודעות כשהאפליקציה פתוחה (foreground)
 * onNotif(payload) — callback עם מידע ההתראה
 */
export function listenForegroundMessages(onNotif) {
  try {
    const messaging = _getMessaging();
    onMessage(messaging, payload => {
      if (typeof onNotif === 'function') onNotif(payload);
    });
  } catch (e) {
    console.warn('listenForegroundMessages error:', e);
  }
}

/**
 * בדיקה אם ההרשאה כבר ניתנה
 */
export function isPushGranted() {
  return 'Notification' in window && Notification.permission === 'granted';
}

/**
 * בדיקה אם ההרשאה נחסמה
 */
export function isPushBlocked() {
  return 'Notification' in window && Notification.permission === 'denied';
}
