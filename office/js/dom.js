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
  control.setAttribute('aria-describedby', id + '-err');
  return { root: h('div', {}, h('label', { for: id }, label), control, hint ? h('div', { class: 'meta' }, hint) : null, err), err, control };
}
