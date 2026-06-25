// =========== child-badges.js ===========
// מערכת הישגים: רצף ימים / כמות משימות / כמות כוכבים.

import { state }     from './child-state.js';
import { showToast } from './child-ui.js';

// -------- ACHIEVEMENT DEFINITIONS --------
const _taskLabel = n => n === 1 ? 'בצע משימה 1' : `בצע ${n} משימות`;

const _streak = n      => ({ id: `streak_${n}`,  cat: 'streak', n, reward: 1,               reached: cs => _curStreak(cs) >= n });
const _tasks  = (n, r) => ({ id: `tasks_${n}`,   cat: 'tasks',  n, reward: r,  label: _taskLabel(n), reached: cs => (cs.totalTasksDone || 0) >= n });
const _stars  = n      => ({ id: `stars_${n}`,   cat: 'stars',  n, reward: Math.round(n/2), label: `אסוף ${n} ⭐`, reached: cs => (cs.totalPtsEarned  || 0) >= n });

// רצף עד 50 ימים (⭐1 כל יום)
const STREAK_DAYS = Array.from({ length: 49 }, (_, i) => _streak(i + 1));

// משימות: 1, ואז 5,10,15,...100 (⭐1 עד ⭐21)
const TASK_MILESTONES = [
  _tasks(1,  1),
  ...[5,10,15,20,25,30,35,40,45,50,55,60,65,70,75,80,85,90,95,100].map((n,i) => _tasks(n, i+2)),
];

// כוכבים: 10,20,50,100,200,500 (פרס = סף÷2)
const STAR_MILESTONES = [10,20,50,100,200,500].map(_stars);

export const ACHIEVEMENT_DEFS = [...STREAK_DAYS, ...TASK_MILESTONES, ...STAR_MILESTONES];

// -------- COMPUTE STREAK --------
function _curStreak(cs) {
  const dailyPts = cs?.dailyPts || {};
  let streak = 0;
  const today = new Date();
  for (let i = 0; i < 365; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    if ((dailyPts[key] || 0) > 0) { streak++; }
    else if (i > 0) break;
  }
  return streak;
}

export function computeStreak() {
  const cs = state.childState;
  if (!cs) return 0;
  const s = _curStreak(cs);
  cs.streak = s;
  return s;
}

// -------- COLLECTABLE CHECK --------
export function checkCollectable() {
  const cs = state.childState;
  if (!cs) return [];
  const col = cs.achievementsCollected || {};
  return ACHIEVEMENT_DEFS.filter(a => !col[a.id] && a.reached(cs));
}

// -------- NAV BADGE --------
export function updateAchievementNavBadge() {
  const nb = document.getElementById('nav-badge-badges');
  if (!nb) return;
  if (checkCollectable().length > 0) { nb.textContent = ''; nb.style.display = 'flex'; }
  else                                { nb.style.display = 'none'; }
}

// -------- COLLECT --------
let _saveFn   = null;
let _renderFn = null;

export function collectAchievement(id) {
  const cs  = state.childState;
  if (!cs) return;
  const def = ACHIEVEMENT_DEFS.find(a => a.id === id);
  if (!def || !def.reached(cs)) return;
  if (!cs.achievementsCollected) cs.achievementsCollected = {};
  if (cs.achievementsCollected[id]) return;

  cs.achievementsCollected[id] = true;
  cs.pts = (cs.pts || 0) + def.reward;
  if (_saveFn)   _saveFn();
  if (_renderFn) _renderFn();
  showToast(`אספת ${def.reward} ⭐`);
  updateAchievementNavBadge();
  _renderScreen();
}

// -------- RENDER --------
let _activeTab = 'streak';

export function renderBadgesScreen(saveFn, renderFn) {
  if (saveFn)   _saveFn   = saveFn;
  if (renderFn) _renderFn = renderFn;
  _renderScreen();
  const nb = document.getElementById('nav-badge-badges');
  if (nb) nb.style.display = 'none';
}

function _renderScreen() {
  const cs = state.childState;
  if (!cs) return;
  _initTabs();
  const content = document.getElementById('ach-content');
  if (!content) return;
  content.innerHTML = '';
  const col    = cs.achievementsCollected || {};
  const streak = _curStreak(cs);
  if      (_activeTab === 'streak') _renderStreak(content, streak, col);
  else if (_activeTab === 'tasks')  _renderTasks(content, cs, col);
  else                              _renderStars(content, cs, col);
}

function _initTabs() {
  document.querySelectorAll('.ach-tab').forEach(t => {
    if (t._ach) return;
    t._ach = true;
    t.addEventListener('click', () => {
      document.querySelectorAll('.ach-tab').forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      _activeTab = t.dataset.tab;
      _renderScreen();
    });
  });
}

// ---- streak tab ----
function _renderStreak(el, streak, col) {
  const info = document.createElement('div');
  info.className = 'ach-counter-info';
  info.textContent = `רצף נוכחי: ${streak} ימים 🔥`;
  el.appendChild(info);

  const grid = document.createElement('div');
  grid.className = 'ach-streak-grid';
  STREAK_DAYS.forEach(def => {
    const isCol   = !!col[def.id];
    const isReach = streak >= def.n;
    const sq = document.createElement('div');
    sq.className = `ach-streak-sq ${isCol ? 'collected' : isReach ? 'collectable' : 'locked'}`;
    sq.innerHTML = `<div class="ach-sq-day">${def.n}</div><div class="ach-sq-star">${isCol ? '✓' : '⭐'}</div>`;
    if (isReach && !isCol) sq.addEventListener('click', () => collectAchievement(def.id));
    grid.appendChild(sq);
  });
  el.appendChild(grid);
}

// ---- tasks tab ----
function _renderTasks(el, cs, col) {
  const total = cs.totalTasksDone || 0;
  const info = document.createElement('div');
  info.className = 'ach-counter-info';
  info.textContent = `סה"כ משימות שביצעת: ${total}`;
  el.appendChild(info);

  const grid = document.createElement('div');
  grid.className = 'ach-grid ach-grid-4col';
  TASK_MILESTONES.forEach(def => {
    const isCol   = !!col[def.id];
    const isReach = total >= def.n;
    grid.appendChild(_makeCard(def, isCol, isReach));
  });
  el.appendChild(grid);
}

// ---- stars tab ----
function _renderStars(el, cs, col) {
  const total = cs.totalPtsEarned || 0;
  const info = document.createElement('div');
  info.className = 'ach-counter-info';
  info.textContent = `סה"כ כוכבים שהרווחת: ${total} ⭐`;
  el.appendChild(info);

  const grid = document.createElement('div');
  grid.className = 'ach-grid ach-grid-2col';
  STAR_MILESTONES.forEach(def => {
    const isCol   = !!col[def.id];
    const isReach = total >= def.n;
    grid.appendChild(_makeCard(def, isCol, isReach));
  });
  el.appendChild(grid);
}

// ---- card builder (tasks + stars) ----
function _makeCard(def, isCol, isReach) {
  const div = document.createElement('div');
  div.className = `ach-card ${isCol ? 'collected' : isReach ? 'collectable' : 'locked'}`;
  const getText = isCol ? `✓ ⭐${def.reward}` : `קבל ⭐${def.reward}`;
  div.innerHTML = `
    <div class="ach-card-task">${def.label}</div>
    <div class="ach-card-get">${getText}</div>`;
  if (isReach && !isCol) div.addEventListener('click', () => collectAchievement(def.id));
  return div;
}

// ---- backward compat stub ----
export function checkAndGrantBadges() { return []; }
