// =========== placeholder-anim.js ===========
// אפקט מכונת כתיבה על placeholder של input/textarea

const _active = new WeakMap();

/**
 * מפעיל אנימציית מכונת כתיבה על placeholder של input/textarea.
 * מפסיק בfocus, חוזר בblur (אם ריק).
 *
 * @param {HTMLElement} el       — input או textarea
 * @param {string[]}    phrases  — רשימת ביטויים לסיבוב
 * @param {object}      [opts]
 * @param {number}      [opts.typeMs=75]   — ms בין אות לאות בהקלדה
 * @param {number}      [opts.deleteMs=35] — ms בין אות לאות במחיקה
 * @param {number}      [opts.pauseMs=1600] — המתנה אחרי גמר הקלדה
 */
export function animatePlaceholder(el, phrases, { typeMs = 75, deleteMs = 35, pauseMs = 1600 } = {}) {
  if (!el || !phrases || phrases.length === 0) return;

  let stopped   = false;
  let phraseIdx = 0;
  let timeoutId = null;

  function stop() {
    stopped = true;
    clearTimeout(timeoutId);
  }

  function start() {
    stopped = false;
    tick('typing', 0);
  }

  function tick(phase, charIdx) {
    if (stopped) return;

    const phrase = phrases[phraseIdx % phrases.length];

    if (phase === 'typing') {
      el.placeholder = phrase.slice(0, charIdx + 1);
      if (charIdx + 1 < phrase.length) {
        timeoutId = setTimeout(() => tick('typing', charIdx + 1), typeMs);
      } else {
        timeoutId = setTimeout(() => tick('deleting', phrase.length - 1), pauseMs);
      }
    } else {
      el.placeholder = phrase.slice(0, charIdx);
      if (charIdx > 0) {
        timeoutId = setTimeout(() => tick('deleting', charIdx - 1), deleteMs);
      } else {
        phraseIdx++;
        timeoutId = setTimeout(() => tick('typing', 0), 250);
      }
    }
  }

  // עצור כשמתמקדים, חזור כשעוזבים (אם ריק)
  el.addEventListener('focus', stop);
  el.addEventListener('blur', () => {
    if (!el.value.trim()) start();
  });

  // שמור reference לביטול עתידי
  const prev = _active.get(el);
  if (prev) prev();
  _active.set(el, stop);

  start();
}
