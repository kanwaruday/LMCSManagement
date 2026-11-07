// node tests/game/test-ties-review.js -- the Principal's read-only "Teachers' class confirmations" on the Setup ground
// (assets/game/ties-review.js, principal/index.html), over N1's erpread what=ties rows. Synthetic staff only, never a student.
const assert = require('assert'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..', '..');

// a tiny DOM: enough for el(), textContent, classes, attributes, buttons
function fakeNode(tag) {
  const n = { tagName: tag.toUpperCase(), children: [], className: '', attrs: {}, listeners: {}, _text: '',
    appendChild(c) { this.children.push(c); return c; }, setAttribute(k, v) { this.attrs[k] = v; },
    addEventListener(ev, fn) { this.listeners[ev] = fn; },
    get textContent() { return this._text + this.children.map((c) => c.textContent).join(' '); }, set textContent(v) { this._text = String(v); this.children = []; } };
  return n;
}
global.document = { createElement: fakeNode };
const T = require(path.join(root, 'assets/game/ties-review.js'));
const all = (n, out = []) => { out.push(n); n.children.forEach((c) => all(c, out)); return out; };
const byClass = (n, c) => all(n).filter((x) => (' ' + x.className + ' ').includes(' ' + c + ' '));

const ROWS = [
  { teacher: 'Teacher B', empCode: 'X/1', kind: 'subject', class: 'Class 7', subject: 'Math', seededSection: 'A', section: 'A', state: 'confirmed' },
  { teacher: 'Teacher A', empCode: 'X/2', kind: 'subject', class: 'Class 8', subject: 'Science', seededSection: 'A', section: 'B', state: 'corrected' },
  { teacher: 'Teacher C', empCode: 'X/3', kind: 'class', class: 'Class 6', subject: '', seededSection: 'B', section: '', state: 'pending' },
  { teacher: 'Teacher D', empCode: 'X/4', kind: 'subject', class: 'Class 9', subject: 'Hindi', seededSection: 'A', section: '', state: 'notmine' },
  { teacher: '', empCode: '', kind: 'subject', class: 'Class 10', subject: 'Art', seededSection: '', section: '', state: 'fix', fix: 'No teacher on this row' },
  { teacher: 'Teacher A', empCode: 'X/2', kind: 'subject', class: 'Class 6', subject: 'Science', seededSection: 'C', section: 'C', state: 'confirmed' }];

// counts and order: what needs the Principal first (corrected, to check, fix, not mine, confirmed), then teacher, then class
assert.deepStrictEqual(T.counts(ROWS), { corrected: 1, pending: 1, fix: 1, notmine: 1, confirmed: 2 });
assert.deepStrictEqual(T.counts([{ state: 'weird' }]), { corrected: 0, pending: 0, fix: 0, notmine: 0, confirmed: 0 });
assert.deepStrictEqual(T.order(ROWS).map((r) => r.state + ':' + r.teacher + ':' + r.class),
  ['corrected:Teacher A:Class 8', 'pending:Teacher C:Class 6', 'fix::Class 10', 'notmine:Teacher D:Class 9', 'confirmed:Teacher A:Class 6', 'confirmed:Teacher B:Class 7']);
assert.deepStrictEqual(T.order([{ state: 'pending', teacher: 'T', class: 'Class 10' }, { state: 'pending', teacher: 'T', class: 'Class 9' }]).map((r) => r.class), ['Class 9', 'Class 10'], 'classes in number order');
assert.strictEqual(T.sectionText(ROWS[1]), 'Sheet said A → teacher says B');
assert.strictEqual(T.sectionText(Object.assign({}, ROWS[1], { classCorrected: true })), 'Sheet said A → teacher says B (class changed)');
assert.strictEqual(T.sectionText(ROWS[0]), 'Section A');
assert.strictEqual(T.sectionText(ROWS[4]), 'No teacher on this row');

// the screen: counts in the brief's order, then the list; no approve button unless a handler is given
let box = T.node({ ok: true, data: { success: true, configured: true, rows: ROWS } });
assert.ok(box.textContent.includes("Teachers' class confirmations"));
assert.deepStrictEqual(byClass(box, 'tr-chip').map((c) => c.textContent.trim()), ['2 Confirmed', '1 Corrected', '1 To check', '1 Not my class', '1 Fix in the sheet']);
assert.strictEqual(byClass(box, 'tr-row').length, 6);
assert.strictEqual(byClass(box, 'tr-approve').length, 0, 'not wired until Uday answers');
assert.ok(byClass(box, 'tr-row')[2].textContent.includes('No teacher on the sheet'), 'a fix row without a teacher says so');
let got = null;
box = T.node({ ok: true, data: { configured: true, rows: ROWS } }, { onApprove: (r) => { got = r; } });
const btns = byClass(box, 'tr-approve');
assert.strictEqual(btns.length, 1, 'only the corrected row gets the button');
btns[0].listeners.click(); assert.strictEqual(got.state, 'corrected');
// the quiet states
assert.ok(T.node(null).textContent.includes('Loading'));
assert.ok(T.node({ ok: false, error: '' }).textContent.includes("couldn't be loaded"));
assert.ok(T.node({ ok: false, error: 'You can only see your own school.' }).textContent.includes('your own school'));
assert.ok(T.node({ ok: true, data: { configured: false, rows: [] } }).textContent.includes("isn't connected yet"));
assert.ok(T.node({ ok: true, data: { configured: true, rows: [] } }).textContent.includes('No timetable classes'));

// the read: erpread what=ties for the session's own school only; nothing without a school
let asked = null;
global.fetch = (url) => { asked = url; return Promise.resolve({ json: () => ({ success: true, configured: true, rows: [] }) }); };
(async () => {
  let r = await T.load({ campusId: 'LMS4', idToken: 't' }, 'https://gas.test/exec');
  assert.ok(r.ok && /action=erpread&what=ties&campus=LMS4&idToken=t$/.test(asked));
  asked = null;
  r = await T.load({ campusId: 'ALL', idToken: 't' }, 'https://gas.test/exec');
  assert.strictEqual(r.ok, false); assert.strictEqual(asked, null, 'no school, no read');
  r = await T.load({ campus: 'LMS3', campusId: 'LMS4', idToken: 't' }, 'https://gas.test/exec');
  assert.ok(/campus=LMS3/.test(asked), "the Owner's view-as school (session.campus) wins");
  global.fetch = () => Promise.resolve({ json: () => ({ success: false, error: 'Not yours' }) });
  r = await T.load({ campusId: 'LMS4', idToken: 't' }, 'https://gas.test/exec');
  assert.deepStrictEqual(r, { ok: false, error: 'Not yours' });

  // read-only and staff-only: no writes, no student fields, text as text nodes
  const src = fs.readFileSync(path.join(root, 'assets/game/ties-review.js'), 'utf8');
  const code = src.replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/method:\s*'POST'|innerHTML/.test(code), 'read-only, text as text nodes');
  assert.ok(!/what=(students|attendance|marks)|\.(students?|photo|face)\b/.test(code), 'never asks for or reads a student field');
  assert.deepStrictEqual((code.match(/\br\.(\w+)/g) || []).map((x) => x.slice(2)).filter((k, i, a) => k !== 'json' && a.indexOf(k) === i).sort(),
    ['class', 'classCorrected', 'fix', 'section', 'seededSection', 'state', 'subject', 'teacher'], 'only staff and class fields of a row');
  // the page: loaded, on the Setup ground, rebuilt fresh in the HUD sheet, and no approve handler passed yet
  const page = fs.readFileSync(path.join(root, 'principal/index.html'), 'utf8');
  assert.ok(page.includes('assets/game/ties-review.js') && /function setupBody\(base\)[\s\S]*?LMCSTiesReview\.node\(TIES\)/.test(page) && /loadTies\(session\);/.test(page));
  assert.ok(/function setupFresh_\(b\)[\s\S]*?LMCSTiesReview\.node\(TIES\)/.test(page) && /key === 'setup'[^\n]*setupFresh_\(b\)/.test(page), 'the sheet builds the list fresh, not a clone');
  assert.ok(!/onApprove/.test(page), 'Approve correction is not wired until Uday answers');
  console.log('test-ties-review: ok');
})().catch((e) => { console.error(e); process.exit(1); });
