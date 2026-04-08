// =========== child-badges.js ===========
// הגדרות badges, בדיקת הענקה אוטומטית, render מסך הישגים.

import { state }          from './child-state.js';
import { showToast }      from './child-ui.js';

// -------- BADGE DEFINITIONS --------
// condition(childState) → true אם הבadge הושג
export const BADGE_DEFS = [
  {
    id:        'first_task',
    icon:      '🌟',
    name:      'הצעד הראשון',
    desc:      'בצע/י את המשימה הראשונה שלך',
    condition: cs => (cs.hist?.length || 0) >= 1,
  },
  {
    id:        'week_10',
    icon:      '🔥',
    name:      'שבוע חזק',
    desc:      'צבור/י 10 כוכבים בשבוע אחד',
    condition: cs => (cs.pts || 0) >= 10,
  },
  {
    id:        'week_50',
    icon:      '💎',
    name:      'שבוע מושלם',
    desc:      'צבור/י 50 כוכבים בשבוע אחד',
    condition: cs => (cs.pts || 0) >= 50,
  },
  {
    id:        'streak_3',
    icon:      '🗓️',
    name:      '3 ימים ברצף',
    desc:      'היה/י פעיל/ה 3 ימים ברצף',
    condition: cs => (cs.streak || 0) >= 3,
  },
  {
    id:        'streak_7',
    icon:      '🏆',
    name:      'שבוע שלם',
    desc:      'היה/י פעיל/ה 7 ימים ברצף',
    condition: cs => (cs.streak || 0) >= 7,
  },
  {
    id:        'streak_14',
    icon:      '👑',
    name:      'אלוף/ת הרצף',
    desc:      'היה/י פעיל/ה 14 ימים ברצף',
    condition: cs => (cs.streak || 0) >= 14,
  },
  {
    id:        'total_100',
    icon:      '🎯',
    name:      '100 כוכבים',
    desc:      'צבור/י 100 כוכבים כולל',
    condition: cs => ((cs.monthlyPts || 0) + (cs.pts || 0)) >= 100,
  },
  {
    id:        'total_500',
    icon:      '🚀',
    name:      'סופר-כוכב',
    desc:      'צבור/י 500 כוכבים כולל',
    condition: cs => ((cs.monthlyPts || 0) + (cs.pts || 0)) >= 500,
  },
  {
    id:        'tasks_20',
    icon:      '📋',
    name:      'עובד/ת קשה',
    desc:      'בצע/י 20 משימות',
    condition: cs => (cs.hist?.length || 0) >= 20,
  },
  {
    id:        'tasks_100',
    icon:      '🏅',
    name:      'מאסטר משימות',
    desc:      'בצע/י 100 משימות',
    condition: cs => (cs.hist?.length || 0) >= 100,
  },
];

// -------- CHECK & GRANT NEW BADGES --------
// מחזיר מערך של badge ids חדשים שהוענקו
export function checkAndGrantBadges(saveStateFn) {
  const cs      = state.childState;
  if (!cs) return [];
  if (!cs.badges) cs.badges = [];

  const earned     = new Set(cs.badges);
  const newlyEarned = [];

  BADGE_DEFS.forEach(b => {
    if (!earned.has(b.id) && b.condition(cs)) {
      cs.badges.push(b.id);
      newlyEarned.push(b);
    }
  });

  if (newlyEarned.length > 0) {
    saveStateFn();
    // הצג toast על badge ראשון חדש
    const first = newlyEarned[0];
    setTimeout(() => {
      showToast({
        message: `הישג חדש! ${first.icon} ${first.name}`,
        color: state.childData?.color,
      });
    }, 1200);
  }

  return newlyEarned;
}

// -------- COMPUTE STREAK --------
// מחשב streak מ-dailyPts ומעדכן את childState.streak
export function computeStreak() {
  const cs = state.childState;
  if (!cs) return 0;

  const dailyPts = cs.dailyPts || {};
  let streak     = 0;
  const today    = new Date();

  for (let i = 0; i < 365; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    if ((dailyPts[key] || 0) > 0) {
      streak++;
    } else {
      if (i > 0) break; // היום עוד לא עשה כלום — לא שובר streak
    }
  }
  cs.streak = streak;
  return streak;
}

// -------- RENDER BADGES SCREEN --------
export function renderBadgesScreen() {
  const cs      = state.childState;
  const earned  = new Set(cs?.badges || []);
  const earnedCount = earned.size;

  // summary
  const summary = document.getElementById('badges-summary');
  if (summary) {
    summary.innerHTML = `
      <div class="badges-summary-count">${earnedCount} / ${BADGE_DEFS.length}</div>
      <div class="badges-summary-label">הישגים שהושגו 🏆</div>`;
  }

  // grid
  const grid = document.getElementById('badges-grid');
  if (!grid) return;

  // earned קודם, אחר כך נעולים
  const sorted = [
    ...BADGE_DEFS.filter(b =>  earned.has(b.id)),
    ...BADGE_DEFS.filter(b => !earned.has(b.id)),
  ];

  grid.innerHTML = sorted.map(b => {
    const isEarned = earned.has(b.id);
    return `
      <div class="badge-card${isEarned ? '' : ' badge-locked'}">
        <span class="badge-icon">${b.icon}</span>
        <span class="badge-name">${b.name}</span>
        <span class="badge-desc">${b.desc}</span>
        ${isEarned ? '<span class="badge-earned">✅ הושג!</span>' : ''}
      </div>`;
  }).join('');

  // badge על nav
  const navBadge = document.getElementById('nav-badge-badges');
  if (navBadge) {
    navBadge.style.display = 'none'; // מוסתר לאחר כניסה למסך
  }
}
