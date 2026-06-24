// =========== functions/index.js ===========
const { onSchedule }                          = require('firebase-functions/v2/scheduler');
const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore');
const admin = require('firebase-admin');

admin.initializeApp();

const db  = admin.firestore();
const fcm = admin.messaging();

const REGION = 'europe-west1';

// =========== helper: שלח Push לרשימת tokens ===========
async function sendPush(tokens, title, body, data = {}) {
  if (!tokens || tokens.length === 0) return [];
  const unique = [...new Set(tokens.filter(Boolean))];
  if (unique.length === 0) return [];
  try {
    const res = await fcm.sendEachForMulticast({
      notification: { title, body },
      data,
      tokens: unique,
      webpush: {
        notification: { icon: '/icons/icon-192.png', dir: 'rtl' },
        fcmOptions: { link: data.url || '/' },
      },
    });
    const failed = [];
    res.responses.forEach((r, i) => {
      if (!r.success) {
        const code = r.error?.code;
        if (
          code === 'messaging/invalid-registration-token' ||
          code === 'messaging/registration-token-not-registered'
        ) failed.push(unique[i]);
      }
    });
    return failed;
  } catch (e) {
    console.error('sendPush error:', e);
    return [];
  }
}

async function removeStaleTokens(ref, field, staleTokens) {
  if (!staleTokens || staleTokens.length === 0) return;
  const snap = await ref.get();
  if (!snap.exists) return;
  const existing = snap.data()[field] || [];
  const cleaned = existing.filter(t => !staleTokens.includes(t));
  await ref.update({ [field]: cleaned });
}

async function sendPushToAllParents(title, body, data = {}) {
  const familiesSnap = await db.collection('families').get();
  if (familiesSnap.empty) return;
  await Promise.all(familiesSnap.docs.map(async (familyDoc) => {
    const tokens = familyDoc.data().fcmTokens || [];
    if (tokens.length === 0) return;
    const stale = await sendPush(tokens, title, body, data);
    if (stale.length > 0) await removeStaleTokens(familyDoc.ref, 'fcmTokens', stale);
  }));
}

// =========== helpers לזמן ירושלים ===========

function getJerusalemParts(date) {
  const TZ = 'Asia/Jerusalem';
  const h       = parseInt(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: '2-digit',   hour12: false }).format(date), 10);
  const m       = parseInt(new Intl.DateTimeFormat('en-US', { timeZone: TZ, minute: '2-digit', hour12: false }).format(date), 10);
  const dateKey = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  const [y, mo, d] = dateKey.split('-').map(Number);
  const dayIdx  = new Date(y, mo - 1, d).getDay(); // 0=ראשון
  return { h, m, dateKey, dayIdx };
}

function isTaskDueOnDay(task, dayIdx) {
  const freq = task.freq || 'daily';
  if (freq === 'specific') return (task.days || []).map(Number).includes(dayIdx);
  return true;
}

function isTaskDoneToday(task, comp, dateKey) {
  const c = (comp || {})[task.id];
  if (!c) return false;
  const freq = task.freq || 'daily';
  if (freq === 'daily'  || freq === 'specific') return c.d === dateKey;
  if (freq === 'once')                          return (c.count || 0) >= 1;
  if (freq === 'weekly' || freq === '2week')    return (c.wc || 0) >= 1;
  return false;
}

// =========================================================
// SCHEDULED NOTIFICATIONS — Gen2
// =========================================================

// כל 15 דקות — בדיקת תזכורות משימות לילדים
exports.taskReminderCheck = onSchedule(
  { schedule: '*/15 * * * *', timeZone: 'Asia/Jerusalem', region: REGION },
  async () => {
    const now = new Date();
    const { h, m, dateKey, dayIdx } = getJerusalemParts(now);

    // חלון זמן: slot של 15 דקות מעוגל למטה
    const slotStart = Math.floor((h * 60 + m) / 15) * 15;
    const slotEnd   = slotStart + 15;

    const familiesSnap = await db.collection('families').get();
    if (familiesSnap.empty) return;

    await Promise.all(familiesSnap.docs.map(async (familyDoc) => {
      const familyId = familyDoc.id;

      // קרא את כל המשימות עם reminder
      const tasksSnap = await db.collection('families', familyId, 'tasks').get();
      const dueTasks  = tasksSnap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(t => {
          if (!t.reminder || t.hidden) return false;
          const [rh, rm] = t.reminder.split(':').map(Number);
          if (isNaN(rh) || isNaN(rm)) return false;
          const reminderMins = rh * 60 + rm;
          return reminderMins >= slotStart && reminderMins < slotEnd;
        })
        .filter(t => isTaskDueOnDay(t, dayIdx));

      if (dueTasks.length === 0) return;

      // קרא את כל הילדים
      const childrenSnap = await db.collection('families', familyId, 'children').get();
      if (childrenSnap.empty) return;

      await Promise.all(childrenSnap.docs.map(async (childDoc) => {
        const childId   = childDoc.id;
        const childData = childDoc.data();
        const tokens    = childData.fcmTokens || [];
        if (tokens.length === 0) return;

        // קרא state של הילד לבדיקת "כבר בוצע"
        let comp = {};
        try {
          const stateSnap = await db.doc(`families/${familyId}/children/${childId}/state/current`).get();
          if (stateSnap.exists) comp = stateSnap.data().comp || {};
        } catch (_) {}

        // משימות שמוקצות לילד זה, הרלוונטיות היום, ועוד לא בוצעו
        const pending = dueTasks.filter(t =>
          (t.assignedChildren || []).includes(childId) &&
          !isTaskDoneToday(t, comp, dateKey)
        );
        if (pending.length === 0) return;

        // שלח push אחד עם כל המשימות הממתינות
        const title = pending.length === 1
          ? `${pending[0].emoji || '🔔'} תזכורת: ${pending[0].task}`
          : `🔔 ${pending.length} משימות ממתינות לך`;
        const body = pending.length === 1
          ? `השלם ותרוויח ${pending[0].pts || 1} ⭐`
          : pending.map(t => `${t.emoji || '•'} ${t.task}`).join(' | ');

        const stale = await sendPush(tokens, title, body, {
          url: '/child.html', type: 'task_reminder',
        });
        if (stale.length > 0) await removeStaleTokens(childDoc.ref, 'fcmTokens', stale);
      }));
    }));
  }
);

exports.eveningParentNotification = onSchedule(
  { schedule: '0 20 * * *', timeZone: 'Asia/Jerusalem', region: REGION },
  async () => {
    await sendPushToAllParents(
      '🌙 זמן משפחה!',
      'בדוק מה הילדים עשו היום ואשר משימות ופרסים',
      { url: '/parent.html', type: 'evening_reminder' }
    );
  }
);


exports.eveningChildNotification = onSchedule(
  { schedule: '0 19 * * *', timeZone: 'Asia/Jerusalem', region: REGION },
  async () => {
    const familiesSnap = await db.collection('families').get();
    if (familiesSnap.empty) return;
    await Promise.all(familiesSnap.docs.map(async (familyDoc) => {
      const childrenSnap = await familyDoc.ref.collection('children').get();
      if (childrenSnap.empty) return;
      await Promise.all(childrenSnap.docs.map(async (childDoc) => {
        const tokens = childDoc.data().fcmTokens || [];
        if (tokens.length === 0) return;
        const stale = await sendPush(
          tokens,
          '🌟 מה עם הכוכבים?',
          'סיימת את כל המשימות להיום?',
          { url: '/child.html', type: 'evening_child_reminder' }
        );
        if (stale.length > 0) await removeStaleTokens(childDoc.ref, 'fcmTokens', stale);
      }));
    }));
  }
);

// =========================================================
// FIRESTORE TRIGGERS — Gen2
// =========================================================

// ילד סיים משימה → התראה להורה
exports.fsApprovalCreated = onDocumentCreated(
  { document: 'families/{familyId}/pendingApprovals/{approvalId}', region: REGION },
  async (event) => {
    const data = event.data.data();
    const { familyId } = event.params;
    if (!data || data.status !== 'pending') return;

    const familyRef = db.doc(`families/${familyId}`);
    const familySnap = await familyRef.get();
    if (!familySnap.exists) return;

    const tokens = familySnap.data().fcmTokens || [];
    if (tokens.length === 0) return;

    const stale = await sendPush(
      tokens,
      `${data.emoji || '✅'} ${data.childName || 'הילד'} סיים משימה!`,
      `"${data.task || 'משימה'}" ממתינה לאישורך`,
      { url: '/parent.html', type: 'pending_task' }
    );
    if (stale.length > 0) await removeStaleTokens(familyRef, 'fcmTokens', stale);
  }
);

// ילד ביקש פרס → התראה להורה
exports.fsPrizeCreated = onDocumentCreated(
  { document: 'families/{familyId}/prizeRequests/{requestId}', region: REGION },
  async (event) => {
    const data = event.data.data();
    const { familyId } = event.params;
    if (!data || data.status !== 'pending') return;

    const familyRef = db.doc(`families/${familyId}`);
    const familySnap = await familyRef.get();
    if (!familySnap.exists) return;

    const tokens = familySnap.data().fcmTokens || [];
    if (tokens.length === 0) return;

    const stale = await sendPush(
      tokens,
      `${data.prizeEmoji || '🎁'} ${data.childName || 'הילד'} ביקש פרס!`,
      `"${data.prizeName || 'פרס'}" ממתין לאישורך`,
      { url: '/parent.html', type: 'prize_request' }
    );
    if (stale.length > 0) await removeStaleTokens(familyRef, 'fcmTokens', stale);
  }
);

// הורה אישר/דחה משימה → התראה לילד
exports.fsApprovalUpdated = onDocumentUpdated(
  { document: 'families/{familyId}/pendingApprovals/{approvalId}', region: REGION },
  async (event) => {
    const before = event.data.before.data();
    const after  = event.data.after.data();
    const { familyId } = event.params;
    if (!before || !after) return;
    if (before.status !== 'pending') return;
    if (after.status !== 'approved' && after.status !== 'rejected') return;

    const childId = after.childId;
    if (!childId) return;

    const childRef  = db.doc(`families/${familyId}/children/${childId}`);
    const childSnap = await childRef.get();
    if (!childSnap.exists) return;

    const tokens = childSnap.data().fcmTokens || [];
    if (tokens.length === 0) return;

    const approved = after.status === 'approved';
    const pts = after.pts || 0;

    const stale = await sendPush(
      tokens,
      approved ? `${after.emoji || '✅'} המשימה אושרה! 🎉` : `${after.emoji || '❌'} המשימה לא אושרה`,
      approved ? `"${after.task}" — קיבלת ${pts} כוכבים ⭐` : `"${after.task}" — נסה שוב`,
      { url: '/child.html', type: approved ? 'task_approved' : 'task_rejected' }
    );
    if (stale.length > 0) await removeStaleTokens(childRef, 'fcmTokens', stale);
  }
);

// הורה שינה כוכבים ידנית → התראה לילד
exports.fsChildPtsUpdated = onDocumentUpdated(
  { document: 'families/{familyId}/children/{childId}', region: REGION },
  async (event) => {
    const before = event.data.before.data();
    const after  = event.data.after.data();
    if (!before || !after) return;

    const prevPts = before.pts ?? 0;
    const newPts  = after.pts  ?? 0;
    if (prevPts === newPts) return;

    const tokens = after.fcmTokens || [];
    if (tokens.length === 0) return;

    const diff    = newPts - prevPts;
    const added   = diff > 0;
    const absDiff = Math.abs(diff);

    const title = added
      ? `⭐ קיבלת ${absDiff} כוכב${absDiff !== 1 ? 'ים' : ''}!`
      : `💫 הופחתו ${absDiff} כוכב${absDiff !== 1 ? 'ים' : ''}`;
    const body = added
      ? `יש לך עכשיו ${newPts} כוכבים — כל הכבוד! 🎉`
      : `יש לך עכשיו ${newPts} כוכבים`;

    const childRef = event.data.after.ref;

    const stale = await sendPush(tokens, title, body, {
      url: '/child.html',
      type: added ? 'pts_added' : 'pts_deducted',
    });
    if (stale.length > 0) await removeStaleTokens(childRef, 'fcmTokens', stale);
  }
);

// הורה אישר/דחה פרס → התראה לילד
exports.fsPrizeUpdated = onDocumentUpdated(
  { document: 'families/{familyId}/prizeRequests/{requestId}', region: REGION },
  async (event) => {
    const before = event.data.before.data();
    const after  = event.data.after.data();
    const { familyId } = event.params;
    if (!before || !after) return;
    if (before.status !== 'pending') return;
    if (after.status !== 'approved' && after.status !== 'declined') return;

    const childId = after.childId;
    if (!childId) return;

    const childRef  = db.doc(`families/${familyId}/children/${childId}`);
    const childSnap = await childRef.get();
    if (!childSnap.exists) return;

    const tokens = childSnap.data().fcmTokens || [];
    if (tokens.length === 0) return;

    const approved = after.status === 'approved';

    const stale = await sendPush(
      tokens,
      approved ? `${after.prizeEmoji || '🎁'} הפרס אושר! 🎉` : `${after.prizeEmoji || '😔'} הפרס לא אושר`,
      approved ? `"${after.prizeName}" — תהנה! 🎊` : `"${after.prizeName}" — אולי בפעם הבאה`,
      { url: '/child.html', type: approved ? 'prize_approved' : 'prize_declined' }
    );
    if (stale.length > 0) await removeStaleTokens(childRef, 'fcmTokens', stale);
  }
);
