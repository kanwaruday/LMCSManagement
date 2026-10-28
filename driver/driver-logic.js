// Driver portal (driver/index.html): the pure logic, so it is plain ES5 with no I/O, no DOM and no clock.
// Design: vault work/Driver Portal design.md. Two missions per driver, for their own bus only:
//   route: the bus's route videos (timelapse runs on the capture page); done when every run the bus needs is published.
//   fuel:  log a fill (litres, amount, odometer, bill photo, pump-meter video); an any-time action, never "done".
// The red button goes to one card only: the route while it is unfinished, else the fuel fill.
var DriverLogic = (function () {
  'use strict';
  // what a fill needs, in the order the screen asks it; label = English · Hindi, as the page shows it
  var FUEL_FIELDS = [
    { id: 'litres', label: 'Litres', hi: 'लीटर', type: 'decimal', min: 1, max: 400 },
    { id: 'amount', label: 'Amount ₹', hi: 'रकम', type: 'int', min: 1, max: 100000 },
    { id: 'odometer', label: 'Odometer km', hi: 'मीटर', type: 'int', min: 1, max: 9999999 },
    { id: 'bill', label: 'Bill photo', hi: 'पर्ची', type: 'file' },
    { id: 'video', label: 'Pump video', hi: 'मीटर का वीडियो', type: 'file' },
  ];
  var MAX_KM_SINCE_LAST = 5000; // more than this since the bus's last fill is almost surely a typo
  var RATE_MIN = 60, RATE_MAX = 150; // ₹ per litre outside this asks "check the amount" (a warning, never a block)

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function day(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m && MONTHS[Number(m[2]) - 1] ? Number(m[3]) + ' ' + MONTHS[Number(m[2]) - 1] : iso; }
  // plain digits with an optional decimal point; a comma is a thousands separator (58,210), so '45,5' reads 455 and is caught by
  // the range or odometer checks rather than guessed at
  function num(v) { var s = String(v == null ? '' : v).replace(/,/g, '').trim(); return /^\d+(\.\d+)?$/.test(s) ? Number(s) : NaN; }

  // one field's problem, or '' when it is fine. lastOdometer: the bus's last recorded odometer, or null.
  function fieldError(f, v, lastOdometer) {
    if (f.type === 'file') return v ? '' : 'missing';
    if (String(v == null ? '' : v).trim() === '') return 'missing';
    var n = num(v);
    if (isNaN(n)) return 'Check the number';
    if (f.type === 'int' && Math.floor(n) !== n) return 'Whole number';
    if (n < f.min || n > f.max) return 'Check the number';
    if (f.id === 'odometer' && lastOdometer != null) {
      if (n < lastOdometer) return 'Less than last time (' + lastOdometer + ')';
      if (n - lastOdometer > MAX_KM_SINCE_LAST) return 'Too far since last time (' + lastOdometer + ')';
    }
    return '';
  }

  // {missing: [ids], errors: {id: text}, warn: text, ready: bool} for a form {litres, amount, odometer, bill, video}
  function checkFill(form, lastOdometer) {
    var missing = [], errors = {};
    FUEL_FIELDS.forEach(function (f) {
      var e = fieldError(f, form[f.id], lastOdometer);
      if (e === 'missing') missing.push(f.id); else if (e) errors[f.id] = e;
    });
    var l = num(form.litres), a = num(form.amount), warn = '';
    if (!errors.litres && !errors.amount && l > 0 && a > 0 && (a / l < RATE_MIN || a / l > RATE_MAX)) warn = 'Check the amount: ₹' + Math.round(a / l) + ' a litre';
    return { missing: missing, errors: errors, warn: warn, ready: !missing.length && !Object.keys(errors).length };
  }

  // the send button's words: "Send" when ready, else how much is left
  function sendLabel(check) {
    var left = check.missing.length + Object.keys(check.errors).length;
    return left ? 'Send · ' + left + ' left' : 'Send';
  }

  // the home cards. bus: {reg, runsNeeded, runsDone, lastFill: 'yyyy-MM-dd' | null}
  function missions(bus) {
    var need = Math.max(0, bus.runsNeeded || 0), done = Math.min(need, Math.max(0, bus.runsDone || 0));
    var route = { id: 'route', title: 'Route video', hi: 'रूट वीडियो', done: need > 0 && done >= need, progress: need ? done / need : 0,
      status: need === 0 ? 'No route runs planned yet' : done >= need ? 'All ' + need + ' runs done' : done + ' of ' + need + ' runs done',
      action: done >= need ? '' : done ? 'Record the next run' : 'Record your route' };
    if (need === 0) route.action = '';
    var fuel = { id: 'fuel', title: 'Fuel filled?', hi: 'डीज़ल भरवाया?', done: false, progress: null,
      status: bus.lastFill ? 'Last fill: ' + day(bus.lastFill) : 'No fill logged yet', action: 'Log a fuel fill' };
    var routeNext = !!route.action;
    route.primary = routeNext; fuel.primary = !routeNext;
    return routeNext ? [route, fuel] : [fuel, route];
  }

  // a chosen file's problem ({type, size}), or ''. The server checks the bytes again with the same limits (apps-script/driver-fuel.gs).
  var BILL_MAX = 3 * 1024 * 1024, VIDEO_MAX = 25 * 1024 * 1024, VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/3gpp'];
  function fileError(id, f) {
    if (id === 'video') return VIDEO_TYPES.indexOf(f.type) === -1 ? 'Choose a video file (MP4, MOV or 3GP)'
      : f.size > VIDEO_MAX ? 'This video is larger than 25 MB. Record a shorter one (10–20 seconds).' : '';
    return !/^image\//.test(f.type || '') ? 'Take a photo of the bill' : f.size > BILL_MAX ? 'This photo is larger than 3 MB. Take it again.' : '';
  }

  // what to do with a queued fill after a send: 'sent' (the server answered success: drop it from the phone), 'refused' (the server
  // answered no: tell the driver), 'retry' (no answer, a timeout or an HTML error page: keep it and send again later)
  // Only an answer the server marks refused is final; any other failure (a lock timeout, a Drive error) is retried later.
  function sendOutcome(r) { return r && typeof r === 'object' ? (r.success ? 'sent' : r.refused ? 'refused' : 'retry') : 'retry'; }

  // the device token in a link's fragment (#k=<64 hex>), or '' for anything else
  function tokenFromHash(hash) { var m = /^#?k=([a-f0-9]{64})$/.exec(hash || ''); return m ? m[1] : ''; }

  // the fuel fill, one thing per screen, in the order it happens at the pump: film the meter while it runs, photograph the bill,
  // then copy three numbers (two from the bill, one from the dashboard). hi = the big Hindi prompt, en = the small English line.
  var FUEL_STEPS = [
    { id: 'video', icon: '🎥', hi: 'पंप मीटर का वीडियो', en: 'Film the pump meter', help: 'मीटर 0 से शुरू · Start at 0, stop when the pump stops (10–20 s)' },
    { id: 'bill', icon: '🧾', hi: 'पर्ची की फ़ोटो', en: 'Photo of the bill', help: 'पूरी पर्ची साफ़ दिखे · The whole bill, sharp' },
    { id: 'litres', icon: '⛽', hi: 'कितने लीटर?', en: 'Litres', help: 'पर्ची पर लिखा · As on the bill' },
    { id: 'amount', icon: '₹', hi: 'कितने रुपये?', en: 'Amount ₹', help: 'पर्ची पर लिखा · As on the bill' },
    { id: 'odometer', icon: '🚌', hi: 'बस के किलोमीटर', en: 'Odometer km', help: 'बस के डैशबोर्ड से · From the bus dashboard' },
  ];
  // one step's problem for the screen, or '' when that step may move on
  function stepError(id, form, lastOdometer) {
    var c = checkFill(form, lastOdometer);
    if (c.errors[id]) return c.errors[id];
    if (c.missing.indexOf(id) !== -1) return id === 'video' ? 'वीडियो लें · Take the video' : id === 'bill' ? 'फ़ोटो लें · Take the photo' : 'नंबर लिखें · Type the number';
    return '';
  }

  return { FUEL_FIELDS: FUEL_FIELDS, FUEL_STEPS: FUEL_STEPS, stepError: stepError, checkFill: checkFill, sendLabel: sendLabel, missions: missions, tokenFromHash: tokenFromHash,
    fileError: fileError, sendOutcome: sendOutcome };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = DriverLogic;
