// =========== stats.js ===========
import { db } from './firebase.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { childrenCache, loadChildren } from './family.js';
import { showLoading, hideLoading } from './ui.js';

let _statsPeriod = 'week';
let _statsData   = [];
let _familyId    = '';

export async function loadAndRenderStats(familyId) {
  if (familyId) _familyId = familyId;
  showLoading('טוען סטטיסטיקות...');

  await loadChildren(_familyId);
  _statsData = [];

  const now = Date.now();
  const cutoffs = {
    week:  now - 7  * 24 * 60 * 60 * 1000,
    month: now - 30 * 24 * 60 * 60 * 1000,
    all:   0,
  };
  const cutoff = cutoffs[_statsPeriod] ?? 0;

  for (const child of childrenCache) {
    try {
      const snap = await getDoc(doc(db, 'families', _familyId, 'children', child.id, 'state', 'current'));
      const st   = snap.exists() ? snap.data() : {};
      const hist = Array.isArray(st.hist) ? st.hist : [];
      const filtered = hist.filter(h => (h.ts || 0) >= cutoff);

      const taskFreq = {};
      filtered.forEach(h => { taskFreq[h.task] = (taskFreq[h.task] || 0) + 1; });
      const topTask = Object.entries(taskFreq).sort((a, b) => b[1] - a[1])[0];

      _statsData.push({
        id:             child.id,
        name:           child.name,
        emoji:          child.emoji || (child.gender === 'female' ? '👧' : '👦'),
        color:          child.color || '#6366F1',
        currentBalance: st.pts || 0,
        tasksCompleted: filtered.length,
        starsEarned:    filtered.reduce((s, h) => s + (h.pts || 0), 0),
        topTask:        topTask ? `${topTask[0]} (${topTask[1]}×)` : null,
      });
    } catch(e) { /* skip */ }
  }

  hideLoading();
  _renderStatsContent();
}

function _renderStatsContent() {
  const el = document.getElementById('stats-content');
  if (!el) return;

  if (_statsData.length === 0) {
    el.innerHTML = '<div class="empty-state">אין ילדים במשפחה</div>';
    return;
  }

  const maxStars = Math.max(..._statsData.map(d => d.starsEarned), 1);
  const maxTasks = Math.max(..._statsData.map(d => d.tasksCompleted), 1);
  const sorted   = [..._statsData].sort((a, b) => b.starsEarned - a.starsEarned);
  const periodLabel = { week: 'השבוע', month: 'החודש', all: 'בסה"כ' }[_statsPeriod];

  el.innerHTML = sorted.map((d, i) => `
    <div style="background:white;border-radius:20px;padding:16px 18px;margin-bottom:12px;box-shadow:0 2px 12px rgba(0,0,0,0.07);">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">
        <span style="font-size:1.2rem;width:22px;text-align:center;flex-shrink:0;">${i === 0 && d.starsEarned > 0 ? '🏆' : ''}</span>
        <span style="font-size:2rem;flex-shrink:0;">${d.emoji}</span>
        <div style="flex:1;min-width:0;">
          <div style="font-weight:900;font-size:1rem;color:#0F172A;">${d.name}</div>
          <div style="font-size:0.72rem;color:#94A3B8;font-weight:600;">יתרה נוכחית: ${d.currentBalance} ⭐</div>
        </div>
        <div style="text-align:left;flex-shrink:0;">
          <div style="font-size:1.7rem;font-weight:900;color:#D97706;line-height:1;">${d.starsEarned}</div>
          <div style="font-size:0.65rem;color:#94A3B8;font-weight:700;">כוכבים ${periodLabel}</div>
        </div>
      </div>

      <div style="margin-bottom:9px;">
        <div style="display:flex;justify-content:space-between;font-size:0.72rem;font-weight:700;color:#64748B;margin-bottom:4px;">
          <span>⭐ כוכבים שנצברו</span><span>${d.starsEarned}</span>
        </div>
        <div style="background:#F1F5F9;border-radius:8px;height:9px;overflow:hidden;">
          <div style="height:100%;border-radius:8px;background:linear-gradient(90deg,#F59E0B,#D97706);width:${maxStars > 0 ? Math.round((d.starsEarned/maxStars)*100) : 0}%;transition:width 0.4s;"></div>
        </div>
      </div>

      <div style="margin-bottom:${d.topTask ? '9px' : '0'};">
        <div style="display:flex;justify-content:space-between;font-size:0.72rem;font-weight:700;color:#64748B;margin-bottom:4px;">
          <span>✅ משימות שבוצעו</span><span>${d.tasksCompleted}</span>
        </div>
        <div style="background:#F1F5F9;border-radius:8px;height:9px;overflow:hidden;">
          <div style="height:100%;border-radius:8px;background:linear-gradient(90deg,#6366F1,#4F46E5);width:${maxTasks > 0 ? Math.round((d.tasksCompleted/maxTasks)*100) : 0}%;transition:width 0.4s;"></div>
        </div>
      </div>

      ${d.topTask ? `<div style="background:#F8FAFC;border-radius:10px;padding:6px 10px;font-size:0.73rem;color:#64748B;margin-top:4px;">
        🥇 משימה מובילה: <strong style="color:#0F172A;">${d.topTask}</strong>
      </div>` : ''}
    </div>`).join('');
}

export function initStatsPeriodChips(familyId) {
  document.querySelectorAll('.stats-period-chip').forEach(chip => {
    chip.classList.toggle('active', chip.dataset.period === _statsPeriod);
    chip.onclick = async () => {
      _statsPeriod = chip.dataset.period;
      document.querySelectorAll('.stats-period-chip').forEach(c =>
        c.classList.toggle('active', c.dataset.period === _statsPeriod)
      );
      await loadAndRenderStats(familyId);
    };
  });
}
