// Campus picker glue for the Curriculum pages (daily-progress, cwa-gap-report, unmapped-chapters). These pages index
// schools by lmsIdx (0..5) and CM_SCHOOLS; the shared picker speaks LMS codes. This is the one place that maps between them.
// Load after assets/campus-picker.js. The session limit (a campus-scoped Principal) is kept on top of the picker, because
// these pages read the sheets directly: under "All" the picker keeps every row, so we clamp to the session's own scope here.
window.CurrPick = (function () {
  let sel = { all: true, campuses: [] }, limit = null, handle = null;
  const code = (i) => 'LMS' + (i + 1);
  const multi = () => !sel.all && sel.campuses.length > 1;

  // Mounts the picker in slot. onChange (optional) fires on later changes only; the page paints itself after its data loads.
  function mount(slot, session, onChange) {
    const id = session && String(session.campusId || '').toUpperCase();
    limit = id === 'ALL' ? null : LMCSCampus.scope(session); // no or blank session: scope is [], so no rows (fails closed)
    let ready = false;
    handle = LMCSCampus.mount(slot, { session, label: 'School', onChange: function (s) { sel = s; if (ready && onChange) onChange(s); } });
    ready = true;
    return handle;
  }
  // Rows (anything with an lmsIdx, or another index field named by key) of the picked schools.
  function pick(rows, key) {
    const k = key || 'lmsIdx';
    const tagged = (rows || []).map(function (x) { return { x: x, campus: code(x[k]) }; });
    return LMCSCampus.filter(tagged, sel).filter(function (t) { return !limit || limit.includes(t.campus); }).map(function (t) { return t.x; });
  }
  // A count of rows: one number, or (2+ schools picked) one per school with its colour.
  function count(rows, key) {
    if (!multi()) return String(rows.length);
    const k = key || 'lmsIdx', v = {};
    sel.campuses.forEach(function (c) { v[c] = 0; });
    rows.forEach(function (x) { const c = code(x[k]); if (c in v) v[c]++; });
    return LMCSCampus.overlay(v, sel);
  }
  return { mount, pick, count, code, get: function () { return sel; }, reset: function () { if (handle) handle.set('ALL'); },
    // 'LMS4' or 'LMS1+LMS2' for file names ('+', so the gap report's one-school filename check ignores a multi-school export); '' when All.
    tag: function () { return sel.all ? '' : sel.campuses.join('+'); } };
})();
