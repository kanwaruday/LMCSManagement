// coordinator/transport-live.js with the shared campus picker: the picked schools filter the buses, 2+ schools overlay the
// moving/stopped/offline counts, a page-fixed campus (Office header) hides the picker. Fake DOM and Leaflet.
const fs = require('fs'), vm = require('vm'), assert = require('assert'), path = require('path');
const root = path.join(__dirname, '../..');
const node = () => ({ innerHTML: '', style: {}, parentNode: {}, addEventListener() {}, setAttribute() {}, appendChild() {}, hidden: false });
const kids = {};
const el = { set innerHTML(v) { this._h = v; }, get innerHTML() { return this._h; }, querySelector: (s) => kids[s] || (kids[s] = node()) };
const lf = { addTo: () => lf, bindTooltip: () => lf, bindPopup: () => lf, clearLayers() {}, setView: () => lf, fitBounds() {}, invalidateSize() {} };
const now = Date.now(), recent = new Date(now - 60000).toISOString();
const buses = [
  { reg: 'A1', campusId: 'LMS1', at: recent, speed: 20, lat: 31, lng: 77 }, { reg: 'A2', campusId: 'LMS1', at: recent, speed: 0, lat: 31, lng: 77 },
  { reg: 'B1', campusId: 'LMS4', at: recent, speed: 30, lat: 31, lng: 77 }, { reg: 'C1', campusId: '', at: recent, speed: 0, lat: 31, lng: 77 }];
const ctx = vm.createContext({ console, Date, Array, Object, String, Number, Math, JSON, encodeURIComponent, setInterval() {}, document: { hidden: false, createElement: node },
  L: { map: () => lf, tileLayer: () => lf, layerGroup: () => lf, circleMarker: () => lf },
  fetch: () => Promise.resolve({ json: () => Promise.resolve({ success: true, buses, fetchedAt: new Date().toISOString() }) }),
  localStorage: { getItem: () => null, setItem() {} }, LMCS: { campusLabel: (c) => c } });
ctx.window = ctx;
vm.runInContext(fs.readFileSync(path.join(root, 'assets/campus-picker.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'coordinator/transport-live.js'), 'utf8'), ctx);
const status = () => (kids['.tl-status'] || {}).innerHTML || '', flush = () => new Promise((r) => setTimeout(r, 0));
(async () => {
  // page-fixed campus (Office buses page): one school, a plain total, only that school's rows
  ctx.TransportLive.mount(el, { idToken: 't', campusId: 'ALL' }, { campus: 'LMS4' });
  await flush();
  assert.ok(/<b>1<\/b> moving, <b>0<\/b> stopped/.test(status()) && !/lmcs-ov/.test(status()), 'fixed campus: its own total');
  assert.ok(/B1/.test(kids['.tl-rows'].innerHTML) && !/A1|C1/.test(kids['.tl-rows'].innerHTML), 'fixed campus: only its buses');
  // the picker: All counts every bus (off-roster too); two schools overlay one count each
  let picked;
  ctx.LMCSCampus.mount = (e, o) => { picked = o.onChange; o.onChange(ctx.LMCSCampus.get(o.session)); }; // the picker's own DOM is Task 1's test
  ctx.TransportLive.mount(el, { idToken: 't', campusId: 'ALL' }, {});
  await flush();
  assert.ok(/<b>2<\/b> moving, <b>2<\/b> stopped/.test(status()), 'All: every bus, plain totals');
  picked({ all: false, campuses: ['LMS1', 'LMS4'] });
  assert.ok(/lmcs-ov/.test(status()) && /LMS 1 <b>1<\/b>/.test(status()) && /LMS 4 <b>1<\/b>/.test(status()), 'two schools: one moving count each');
  assert.ok(!/C1/.test(kids['.tl-rows'].innerHTML), 'off-roster bus hidden once narrowed');
  picked({ all: false, campuses: ['LMS1'] });
  assert.ok(/<b>1<\/b> moving, <b>1<\/b> stopped/.test(status()) && !/lmcs-ov/.test(status()), 'one school: a plain total');
  console.log('live picker: ok');
})().catch((e) => { console.error(e); process.exit(1); });
