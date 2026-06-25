// =========== firebase-messaging-sw.js ===========
// חייב להיות בשורש הפרויקט (ליד index.html)

importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyDC0GADxe3qv6uv6s6fGR3O7_lL9iHl4ag",
  authDomain: "kidssapp-izhaki.firebaseapp.com",
  projectId: "kidssapp-izhaki",
  storageBucket: "kidssapp-izhaki.firebasestorage.app",
  messagingSenderId: "663906163746",
  appId: "1:663906163746:web:a4f66772a2ae0dedc47e7b"
});

const messaging = firebase.messaging();

// התראות ברקע (כשהאפליקציה סגורה / ברקע)
messaging.onBackgroundMessage(payload => {
  const { title, body, icon } = payload.notification || {};
  self.registration.showNotification(title || 'משימות משפחה', {
    body: body || '',
    icon: icon || '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    dir: 'rtl',
    lang: 'he',
    data: payload.data || {},
  });
});

// =========== תזכורות מקומיות מתוזמנות ===========
// מאגר ה-timeouts הפעילים (לביטול אם מגיע עדכון)
const _reminderTimeouts = {};

// קבלת הוראות תזכורת מהאפליקציה
self.addEventListener('message', event => {
  if (!event.data) return;

  if (event.data.type === 'SCHEDULE_REMINDERS') {
    _scheduleAll(event.data.reminders || []);
  }

  if (event.data.type === 'CLEAR_REMINDERS') {
    _clearAll();
  }
});

function _clearAll() {
  Object.values(_reminderTimeouts).forEach(id => clearTimeout(id));
  Object.keys(_reminderTimeouts).forEach(k => delete _reminderTimeouts[k]);
}

function _scheduleAll(reminders) {
  // נקה תזכורות ישנות לפני קביעת חדשות
  _clearAll();

  const now = Date.now();

  reminders.forEach(r => {
    const ms = r.fireAt - now;
    if (ms <= 0) return; // השעה כבר עברה היום

    const key = r.taskId + '_' + r.fireAt;
    _reminderTimeouts[key] = setTimeout(() => {
      self.registration.showNotification(r.title || 'תזכורת משימה 🔔', {
        body: r.body || '',
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        dir: 'rtl',
        lang: 'he',
        tag: 'reminder_' + r.taskId, // מונע כפילות
        renotify: false,
        data: { url: '/child.html' },
      });
      delete _reminderTimeouts[key];
    }, ms);
  });
}

// לחיצה על ההתראה — פותח את האפליקציה
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const data      = event.notification.data || {};
  const url       = data.url || '/child.html';
  const notifType = data.type || '';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.postMessage({ type: 'NOTIFICATION_CLICK', notifType });
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
