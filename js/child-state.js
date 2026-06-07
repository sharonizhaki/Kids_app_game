// =========== child-state.js ===========
// State משותף לכל מודולי צד הילד.
// כל מודול מייבא אובייקט זה ומשנה אותו ישירות (by reference).

export const state = {
  childId:    localStorage.getItem('childId'),
  familyId:   localStorage.getItem('childFamilyId'),
  childData:  null,   // { name, gender, emoji, color, photo, ... }
  tasksData:  [],     // [{ id, task, pts, freq, cat, catIcon, emoji, assignedChildren, ... }]
  childState: null,   // { pts, monthlyPts, comp, hist, lastActive, wk, mk, streak, dailyPts, badges, pending }
};

// מחזירה צורה זכר (male) או נקבה (female) לפי מין הילד הנוכחי
export function g(male, female) {
  return state.childData?.gender === 'female' ? female : male;
}
