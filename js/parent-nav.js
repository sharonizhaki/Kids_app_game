import { auth } from './firebase.js';
import { openSideMenu } from './ui.js';

let _activePage = null;
let _getMenuParams = null;

export function initParentNav(activePage, getMenuParams) {
  _activePage = activePage;
  _getMenuParams = getMenuParams || null;
  if (!document.getElementById('parent-bottom-nav')) _render();
}

function _render() {
  document.body.classList.add('has-bottom-nav');
  const nav = document.createElement('nav');
  nav.id = 'parent-bottom-nav';
  nav.className = 'parent-bottom-nav';
  nav.innerHTML = `
    <button class="pbn-tab${_activePage === 'menu' ? ' pbn-active' : ''}" data-tab="menu">
      <span class="pbn-icon">☰</span>
      <span class="pbn-label">תפריט</span>
    </button>
    <button class="pbn-tab${_activePage === 'home' ? ' pbn-active' : ''}" data-tab="home">
      <span class="pbn-icon">🏠</span>
      <span class="pbn-label">בית</span>
    </button>
    <button class="pbn-tab${_activePage === 'activity' ? ' pbn-active' : ''}" data-tab="activity">
      <span class="pbn-icon">⭐</span>
      <span class="pbn-label">מרכז פעילות</span>
    </button>
    <button class="pbn-tab${_activePage === 'family' ? ' pbn-active' : ''}" data-tab="family">
      <span class="pbn-icon">👨‍👩‍👧</span>
      <span class="pbn-label">ניהול משפחה</span>
    </button>
  `;
  document.body.appendChild(nav);
  nav.querySelectorAll('.pbn-tab').forEach(btn =>
    btn.addEventListener('click', () => _onTab(btn.dataset.tab))
  );
}

function _onTab(tab) {
  if (tab === 'menu') {
    if (_activePage === 'home') {
      document.getElementById('btn-open-menu')?.click();
    } else {
      const p = _getMenuParams?.() || {};
      openSideMenu({
        auth,
        isPrimary: p.isPrimary ?? true,
        activityCount: p.activityCount ?? 0,
        notifStatus: p.notifStatus ?? 'default',
        onAction: p.onAction ?? _defaultAction,
      });
    }
    return;
  }
  if (tab === 'home') {
    if (_activePage !== 'home') _navigate('parent.html');
    return;
  }
  if (tab === 'activity') {
    if (_activePage !== 'activity') _navigate('points.html');
    return;
  }
  if (tab === 'family') {
    if (_activePage === 'home') {
      window.showScreen?.('screen-manage-family');
    } else {
      _navigate('parent.html?screen=manage-family');
    }
  }
}

function _defaultAction(action) {
  const map = {
    'manage-family': 'parent.html?screen=manage-family',
    'add-tasks': 'tasks.html',
    'edit-tasks': 'tasks.html?mode=edit',
    'add-prizes': 'prizes.html',
    'manage-prizes': 'prizes.html?mode=manage',
    'manage-points': 'points.html',
    'stats': 'stats.html',
  };
  if (map[action]) _navigate(map[action]);
}

function _navigate(url) {
  sessionStorage.setItem('parentNav', '1');
  window.location.href = url;
}
