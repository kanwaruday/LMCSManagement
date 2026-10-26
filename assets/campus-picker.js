// One campus picker for the whole portal (2026-10-26, per Uday: "All Campuses and then School wise, also allowing for
// more than 1 school being selected and then overlaying"). Load after auth.js, with campus-picker.css.
//   LMCSCampus.mount(el, {session, multi, hes, onChange, label}) -> {get(), set(sel)}
//   sel = {all, campuses}: with all, campuses is the whole scope. Scope comes from the session only; never widened.
window.LMCSCampus = (function () {
  const CODES = ['LMS1', 'LMS2', 'LMS3', 'LMS4', 'LMS5', 'LMS6'];
  const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const short = (c) => c.replace(/^LMS(\d)$/, 'LMS $1');
  const full = (c) => (window.LMCS && window.LMCS.campusLabel ? window.LMCS.campusLabel(c) : short(c));

  function scope(session, opts) {
    if (!session || !session.campusId) return [];
    const ids = String(session.campusId).split(',').map((s) => s.trim().toUpperCase());
    if (ids.includes('ALL')) return opts && opts.hes ? CODES.concat('HES') : CODES.slice();
    return CODES.filter((c) => ids.includes(c)).concat(opts && opts.hes && ids.includes('HES') ? ['HES'] : []);
  }

  const copy = (s) => ({ all: s.all, campuses: s.campuses.slice() }); // pages can't mutate picker state
  const key = (session, multi) => (multi ? 'lmcs-campus:' : 'lmcs-campus1:') + ((session && session.email) || '');
  function read(k) { try { const o = JSON.parse(localStorage.getItem(k)); return o && o.v === 1 ? o.sel : null; } catch (_) { return null; } }
  function write(k, sel) { try { localStorage.setItem(k, JSON.stringify({ v: 1, sel })); } catch (_) { /* private mode: just don't remember */ } }

  // Any raw choice ('ALL', [codes], {all, campuses}) -> a valid sel inside scope.
  function normalize(raw, sc, multi) {
    const list = raw && raw.campuses && !raw.all ? raw.campuses : Array.isArray(raw) ? raw : [];
    const picked = sc.filter((c) => list.includes(c));
    if (!multi) return { all: false, campuses: picked.length ? [picked[0]] : sc.slice(0, 1) };
    return picked.length ? { all: false, campuses: picked } : { all: true, campuses: sc.slice() };
  }

  function get(session, opts) {
    const o = opts || {}, multi = o.multi !== false;
    return normalize(read(key(session, multi)), scope(session, o), multi);
  }

  function mount(el, opts) {
    const o = opts || {}, multi = o.multi !== false;
    const session = o.session || (window.LMCS && window.LMCS.getSession && window.LMCS.getSession());
    const sc = scope(session, o), k = key(session, multi);
    let sel = normalize(read(k), sc, multi);
    if (typeof el === 'string') el = document.querySelector(el);

    const group = document.createElement('div');
    group.className = 'lmcs-campus-picker';
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', o.label || 'Campus');
    const buttons = (multi ? ['ALL'] : []).concat(sc).map((code) => {
      const b = document.createElement('button');
      b.setAttribute('type', 'button');
      b.setAttribute('data-code', code);
      b.className = 'lmcs-campus-chip';
      b.textContent = code === 'ALL' ? 'All campuses' : short(code);
      b.setAttribute('aria-label', code === 'ALL' ? 'All campuses' : full(code));
      b.setAttribute('title', code === 'ALL' ? 'All campuses' : full(code));
      if (code !== 'ALL') b.style.setProperty('--chip-dot', color(code));
      b.addEventListener('click', () => pick(code));
      group.appendChild(b);
      return b;
    });
    if (el) { el.innerHTML = ''; el.appendChild(group); el.hidden = sc.length <= 1; }

    function paint() {
      buttons.forEach((b) => {
        const c = b.getAttribute('data-code');
        b.setAttribute('aria-pressed', String(c === 'ALL' ? sel.all : !sel.all && sel.campuses.includes(c)));
      });
    }
    function apply(next) {
      if (JSON.stringify(next) === JSON.stringify(sel)) return;
      sel = next;
      write(k, multi && sel.all ? 'ALL' : sel.campuses);
      paint();
      if (o.onChange) o.onChange(copy(sel));
    }
    function pick(code) {
      if (!multi) return apply(normalize([code], sc, false));
      if (code === 'ALL') return apply(normalize('ALL', sc, true));
      const cur = sel.all ? [] : sel.campuses;
      apply(normalize(cur.includes(code) ? cur.filter((c) => c !== code) : cur.concat(code), sc, true)); // empty -> All
    }

    paint();
    if (o.onChange) o.onChange(copy(sel));
    return { get: () => copy(sel), set: (raw) => apply(normalize(raw, sc, multi)) };
  }

  function color(code) {
    return CODES.includes(code) || code === 'HES' ? `var(--campus-${code.toLowerCase()})` : 'var(--gray)';
  }

  // values {LMS1: 12, ...}. 2+ schools picked: one colour-dotted value per school. Else: the single total.
  // ponytail: the single total is a sum; pages whose number is a rate (%, average) must compute it themselves.
  function overlay(values, sel, fmt) {
    const f = fmt || String, v = values || {};
    const has = (c) => v[c] !== undefined && v[c] !== null && !Number.isNaN(v[c]);
    const show = (c) => (has(c) ? esc(f(v[c])) : '–');
    if (!sel.all && sel.campuses.length >= 2) {
      return '<span class="lmcs-ov">' + sel.campuses.map((c) =>
        `<span class="lmcs-ov-item" title="${esc(full(c))}"><i class="lmcs-ov-dot" style="background:${color(c)}"></i>${esc(short(c))} <b>${show(c)}</b></span>`
      ).join('') + '</span>';
    }
    const present = sel.campuses.filter(has);
    return present.length ? esc(f(present.reduce((s, c) => s + Number(v[c]), 0))) : '–';
  }

  // All: every row as given. Schools picked: only rows of those schools (rows with no campus are hidden).
  function filter(rows, sel, k) {
    const f = k || 'campus';
    if (sel.all) return (rows || []).slice(); // All: the backend already scoped the rows, keep every one (even with no campus)
    return (rows || []).filter((r) => r && sel.campuses.includes(r[f]));
  }

  return { scope, mount, get, color, overlay, filter };
})();
