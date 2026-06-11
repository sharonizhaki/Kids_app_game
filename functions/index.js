// =========== functions/index.js — Gen2 v2 ===========
const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const admin = require('firebase-admin');

admin.initializeApp();

const db = admin.firestore();
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

// =========== helper: שלח Push לכל ההורים ===========
async function sendPushToAllParents(title, body, data = {}) {
  const familiesSnap = await db.collection('families').get();
  if (familiesSnap.empty) return;

  const promises = familiesSnap.docs.map(async (familyDoc) => {
    const tokens = familyDoc.data().fcmTokens || [];
    if (tokens.length === 0) return;
    const stale = await sendPush(tokens, title, body, data);
    if (stale.length > 0) await removeStaleTokens(familyDoc.ref, 'fcmTokens', stale);
  });

  await Promise.all(promises);
}

// =========================================================
// SCHEDULED NOTIFICATIONS — הורים
// =========================================================

// הודעת ערב יומית — 20:00 שעון ירושלים
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

// הודעות בדיקה — 10:00-13:00
exports.testNotification10 = onSchedule(
  { schedule: '0 10 * * *', timeZone: 'Asia/Jerusalem', region: REGION },
  async () => {
    await sendPushToAllParents('🔔 הודעת בדיקה', 'בדיקה — 10:00', { url: '/parent.html', type: 'test' });
  }
);

exports.testNotification11 = onSchedule(
  { schedule: '0 11 * * *', timeZone: 'Asia/Jerusalem', region: REGION },
  async () => {
    await sendPushToAllParents('🔔 הודעת בדיקה', 'בדיקה — 11:00', { url: '/parent.html', type: 'test' });
  }
);

exports.testNotification12 = onSchedule(
  { schedule: '0 12 * * *', timeZone: 'Asia/Jerusalem', region: REGION },
  async () => {
    await sendPushToAllParents('🔔 הודעת בדיקה', 'בדיקה — 12:00', { url: '/parent.html', type: 'test' });
  }
);

exports.testNotification13 = onSchedule(
  { schedule: '0 13 * * *', timeZone: 'Asia/Jerusalem', region: REGION },
  async () => {
    await sendPushToAllParents('🔔 הודעת בדיקה', 'בדיקה — 13:00', { url: '/parent.html', type: 'test' });
  }
);

// =========================================================
// TRIGGERS — Gen2
// =========================================================

exports.fsApprovalCreated = onDocumentCreated(
  { document: 'families/{familyId}/pendingApprovals/{approvalId}', region: REGION },
  async (event) => {
    const data = event.data.data();
    const familyId = event.params.familyId;
    if (!data || data.status !== 'pending') return null;

    const familyRef = db.doc(`families/${familyId}`);
    const familySnap = await familyRef.get();
    if (!familySnap.exists) return null;

    const tokens = familySnap.data().fcmTokens || [];
    if (tokens.length === 0) return null;

    const stale = await sendPush(
      tokens,
      `${data.emoji || '✅'} ${data.childName || 'הילד'} סיים משימה!`,
      `"${data.task || 'משימה'}" ממתינה לאישורך`,
      { url: '/parent.html', type: 'pending_task' }
    );
    if (stale.length > 0) await removeStaleTokens(familyRef, 'fcmTokens', stale);
    return null;
  }
);

exports.fsPrizeCreated = onDocumentCreated(
  { document: 'families/{familyId}/prizeRequests/{requestId}', region: REGION },
  async (event) => {
    const data = event.data.data();
    const familyId = event.params.familyId;
    if (!data || data.status !== 'pending') return null;

    const familyRef = db.doc(`families/${familyId}`);
    const familySnap = await familyRef.get();
    if (!familySnap.exists) return null;

    const tokens = familySnap.data().fcmTokens || [];
    if (tokens.length === 0) return null;

    const stale = await sendPush(
      tokens,
      `${data.prizeEmoji || '🎁'} ${data.childName || 'הילד'} ביקש פרס!`,
      `"${data.prizeName || 'פרס'}" ממתין לאישורך`,
      { url: '/parent.html', type: 'prize_request' }
    );
    if (stale.length > 0) await removeStaleTokens(familyRef, 'fcmTokens', stale);
    return null;
  }
);

exports.fsApprovalUpdated = onDocumentUpdated(
  { document: 'families/{familyId}/pendingApprovals/{approvalId}', region: REGION },
  async (event) => {
    const before = event.data.before.data();
    const after = event.data.after.data();
    const familyId = event.params.familyId;
    if (!before || !after) return null;
    if (before.status !== 'pending') return null;
    if (after.status !== 'approved' && after.status !== 'rejected') return null;

    const childId = after.childId;
    if (!childId) return null;

    const childRef = db.doc(`families/${familyId}/children/${childId}`);
    const childSnap = await childRef.get();
    if (!childSnap.exists) return null;

    const tokens = childSnap.data().fcmTokens || [];
    if (tokens.length === 0) return null;

    const approved = after.status === 'approved';
    const pts = after.pts || 0;

    const stale = await sendPush(
      tokens,
      approved ? `${after.emoji || '✅'} המשימה אושרה! 🎉` : `${after.emoji || '❌'} המשימה לא אושרה`,
      approved ? `"${after.task}" — קיבלת ${pts} כוכבים ⭐` : `"${after.task}" — נסה שוב`,
      { url: '/child.html', type: approved ? 'task_approved' : 'task_rejected' }
    );
    if (stale.length > 0) await removeStaleTokens(childRef, 'fcmTokens', stale);
    return null;
  }
);

exports.fsPrizeUpdated = onDocumentUpdated(
  { document: 'families/{familyId}/prizeRequests/{requestId}', region: REGION },
  async (event) => {
    const before = event.data.before.data();
    const after = event.data.after.data();
    const familyId = event.params.familyId;
    if (!before || !after) return null;
    if (before.status !== 'pending') return null;
    if (after.status !== 'approved' && after.status !== 'declined') return null;

    const childId = after.childId;
    if (!childId) return null;

    const childRef = db.doc(`families/${familyId}/children/${childId}`);
    const childSnap = await childRef.get();
    if (!childSnap.exists) return null;

    const tokens = childSnap.data().fcmTokens || [];
    if (tokens.length === 0) return null;

    const approved = after.status === 'approved';

    const stale = await sendPush(
      tokens,
      approved ? `${after.prizeEmoji || '🎁'} הפרס אושר! 🎉` : `${after.prizeEmoji || '😔'} הפרס לא אושר`,
      approved ? `"${after.prizeName}" — תהנה! 🎊` : `"${after.prizeName}" — אולי בפעם הבאה`,
      { url: '/child.html', type: approved ? 'prize_approved' : 'prize_declined' }
    );
    if (stale.length > 0) await removeStaleTokens(childRef, 'fcmTokens', stale);
    return null;
  }
);
