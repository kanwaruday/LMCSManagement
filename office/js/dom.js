// Tiny element builder: children are always appended as text nodes, so server strings can never become markup.
export function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, '');
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  kids.flat().forEach((c) => { if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c))); });
  return e;
}
// Labelled field: <label for> + control + error line.
export function field(id, label, control, hint) {
  control.id = id;
  const err = h('p', { class: 'err', role: 'alert', id: id + '-err' });
  control.setAttribute('aria-describedby', (hint ? id + '-hint ' : '') + id + '-err'); // the hint is read out with the field, not only seen
  return { root: h('div', {}, h('label', { for: id }, label), control, hint ? h('div', { class: 'meta', id: id + '-hint' }, hint) : null, err), err, control };
}
// replaceChildren that skips null/false children (a bare replaceChildren(null) would insert the text "null").
export function setKids(el, ...kids) {
  el.replaceChildren(...kids.flat().filter((c) => c != null && c !== false));
}

// The done state after a save (assets/game/base.css gb-done): replaces the form (or sits above it with keep) until "again" brings the form back.
// Call it once the entry is in the outbox; offline, it says plainly that the entry is queued on this phone.
export const place = (c) => String(c || '').replace(/^LMS(\d)$/, 'LMS $1');
export function showDone(form, line, { again = '', keep = false } = {}) {
  form.parentNode.querySelectorAll(':scope > .gb-done').forEach((d) => d.remove());
  const acts = h('div', { class: 'gb-row-acts' }, h('a', { class: 'gb-btn gb-btn-primary', href: 'index.html' }, 'Back to Today'));
  const block = h('div', { class: 'gb-done', role: 'status' }, h('div', { class: 'gb-done-tick', 'aria-hidden': 'true' }, '✓'), h('h2', {}, 'Saved'), h('p', {}, line),
    typeof navigator !== 'undefined' && navigator.onLine === false ? h('p', { class: 'gb-done-queued' }, "Saved on this phone; it sends when you're online.") : null, acts);
  if (again) acts.append(h('button', { type: 'button', class: 'gb-btn gb-btn-quiet', onclick: () => { block.remove(); form.hidden = false; } }, again));
  if (!keep) form.hidden = true;
  form.before(block);
  block.scrollIntoView({ block: 'center' });
  return block;
}
