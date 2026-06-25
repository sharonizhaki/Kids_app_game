// =========== child-badges.js ===========
// מערכת הישגים: רצף ימים / כמות משימות / כמות כוכבים.

import { state }     from './child-state.js';
import { showToast } from './child-ui.js';

// -------- ACHIEVEMENT DEFINITIONS --------
const _streak = n      => ({ id: `streak_${n}`,  cat: 'streak', n, reward: 1,              label: `יום ${n}`,     reached: cs => _curStreak(cs) >= n });
const _tasks  = (n, r) => ({ id: `tasks_${n}`,   cat: 'tasks',  n, reward: r,              label: `${n} משימות`, reached: cs => (cs.totalTasksDone || 0) >= n });
const _stars  = n      => ({ id: `stars_${n}`,   cat: 'stars',  n, reward: Math.round(n/2), label: `${n} ⭐`,      reached: cs => (cs.totalPtsEarned  || 0) >= n });

export const ACHIEVEMENT_DEFS = [
  ...[1,2,3,4,5,6,7,8,9,10].map(_streak),
  _tasks(1,1), _tasks(5,2), _tasks(10,3), _tasks(15,4), _tasks(20,5),
  _tasks(25,6), _tasks(30,7), _tasks(35,8), _tasks(40,9), _tasks(45,10), _tasks(50,11),
  _stars(10), _stars(20), _stars(50), _stars(100), _stars(200), _stars(500),
];

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
  showToast({ message: `אספת ${def.reward} ⭐`, color: state.childData?.color });
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
  ACHIEVEMENT_DEFS.filter(a => a.cat === 'streak').forEach(def => {
    const isCol   = !!col[def.id];
    const isReach = streak >= def.n;
    const sq = document.createElement('div');
    sq.className = `ach-streak-sq ${isCol ? 'collected' : isReach ? 'collectable' : 'locked'}`;
    sq.innerHTML = `<div class="ach-sq-day">יום ${def.n}</div><div class="ach-sq-star">${isCol ? '✓' : '⭐'}</div>`;
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
  grid.className = 'ach-grid';
  ACHIEVEMENT_DEFS.filter(a => a.cat === 'tasks').forEach(def => {
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
  ACHIEVEMENT_DEFS.filter(a => a.cat === 'stars').forEach(def => {
    const isCol   = !!col[def.id];
    const isReach = total >= def.n;
    grid.appendChild(_makeCard(def, isCol, isReach));
  });
  el.appendChild(grid);
}

function _makeCard(def, isCol, isReach) {
  const div = document.createElement('div');
  div.className = `ach-card ${isCol ? 'collected' : isReach ? 'collectable' : 'locked'}`;
  div.innerHTML = `
    <div class="ach-card-reward">${isCol ? '✓' : `⭐${def.reward}`}</div>
    <div class="ach-card-label">${def.label}</div>`;
  if (isReach && !isCol) div.addEventListener('click', () => collectAchievement(def.id));
  return div;
}

// ---- backward compat stub ----
export function checkAndGrantBadges() { return []; }
