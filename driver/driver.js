// Driver portal page (driver/index.html), laid out for a driver on a phone who may read little: Hindi first and big, an icon on
// everything, one thing per screen, the one red button always in the bar at the bottom.
//   #        home: who and which bus, the one next step, the two jobs as big tiles, fills still waiting for signal
//   #fuel-N  the fuel fill, one step per screen in pump order (DriverLogic.FUEL_STEPS), then #fuel-6 = check and send
//   #sent    done (green), or saved on this phone (amber)
// Demo (?demo=1): a made-up bus, nothing sent. Live: the office links this phone to one driver and bus (a QR from
// coordinator/transport/drivers.html opens this page with #k=<token>); the token moves to localStorage, the fragment is stripped,
// and driverme (Roster web app, apps-script/driver-link.gs) says whose bus this is. A fuel fill goes to driverfuel
// (apps-script/driver-fuel.gs: a pending row the Fee Clerk later confirms against the bill). Each fill is kept in IndexedDB under
// its fillId before it is sent and leaves the phone only when the server answers success; with no signal (or a timeout) it waits
// there and is sent again on the 'online' event and on the next page load. The token is never logged or shown.
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const DEMO = new URLSearchParams(location.search).get('demo') === '1';
  const demoApi = DEMO ? {
    load: () => Promise.resolve({ name: 'Ramesh', reg: 'HP 34 X 0000', campus: 'LMS 1', runsNeeded: 1, runsDone: 0, lastFill: '2026-10-21', lastOdometer: 58000 }),
    send: (form, files, onProgress) => new Promise((ok) => { // a pretend upload, so the progress bar can be seen
      let p = 0; const t = setInterval(() => { p += 0.2; onProgress(Math.min(1, p)); if (p >= 1) { clearInterval(t); ok({ queued: !navigator.onLine }); } }, 250);
    }),
    waiting: () => Promise.resolve(0),
  } : null;
  const ROSTER_URL = 'https://script.google.com/macros/s/AKfycbyHiaZY_iWK2VTKKFJcCsBNnIbUndJYUSjnPkxvJ-dYavaihiul2xBJuJohPRsP9Spf/exec'; // = ROSTER_URL in assets/auth.js
  const TOKEN_KEY = 'lmcs.driverToken'; // also read by coordinator/capture/driver-mode.js
  const REFUSED_KEY = 'lmcs.driverRefused'; // fills the office refused after they waited on the phone, shown once on home
  const BUS_KEY = 'lmcs.driverBus'; // the last driverme answer (name, bus, last fill), so a fill can be logged at a pump with no signal
  function takeToken() {
    const t = DriverLogic.tokenFromHash(location.hash);
    if (t) { try { localStorage.setItem(TOKEN_KEY, t); } catch (e) { /* kept for this visit only */ } history.replaceState(null, '', location.pathname + location.search); return t; }
    try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; }
  }
  const live = !DEMO && (() => {
    const token = takeToken();
    return !token ? null : {
      load: async () => {
        let r;
        try { r = JSON.parse(await (await fetch(ROSTER_URL, { method: 'POST', body: JSON.stringify({ action: 'driverme', deviceToken: token }) })).text()); }
        catch (e) { throw Object.assign(new Error('Could not reach the office. Try again when there is signal.'), { offline: true }); }
        if (!r.success && r.code !== 'UNLINKED') throw Object.assign(new Error(r.error || 'The office could not answer.'), { offline: true }); // passing: keep the link
        if (!r.success) { try { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(BUS_KEY); } catch (e) { /* nothing kept */ } throw new Error(r.error || 'This phone is not linked. Ask the office for a new link.'); }
        try { localStorage.setItem(BUS_KEY, JSON.stringify(r)); } catch (e) { /* full */ }
        return r;
      },
      send: async (form, files, onProgress) => {
        const rec = { fillId: newFillId(), litres: form.litres, amount: form.amount, odometer: form.odometer, filledAt: new Date().toISOString(),
          bill: { mime: files.bill.type, base64: await toB64(files.bill) }, video: { mime: files.video.type, base64: await toB64(files.video) } };
        let kept = true;
        try { await queue.put(rec); } catch (e) { kept = false; } // private mode or a full phone: send it anyway
        const r = await post(token, rec, onProgress), o = DriverLogic.sendOutcome(r);
        if (o === 'sent' || o === 'refused') await queue.delete(rec.fillId).catch(() => {}); // refused: the form still holds it all
        if (o === 'refused') throw new Error(r.error || 'The office did not accept this fill.');
        if (o === 'retry' && !kept) throw new Error('Not sent and not saved: try again when there is signal.');
        return { queued: o === 'retry' };
      },
      flush: () => flush(token),
      waiting: () => queue.getAll().then((a) => a.length, () => 0),
    };
  })();
  const api = DEMO ? demoApi : live;

  // ---- live fuel: the phone's queue (IndexedDB 'lmcs-driver', store 'fills', keyed by fillId) and the post
  const queue = live && (() => { // demo: none
    const db = new Promise((ok, no) => {
      const req = indexedDB.open('lmcs-driver', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('fills', { keyPath: 'fillId' });
      req.onsuccess = () => ok(req.result); req.onerror = () => no(req.error);
    });
    const run = async (mode, op) => {
      const tx = (await db).transaction('fills', mode), req = op(tx.objectStore('fills'));
      return new Promise((ok, no) => { tx.oncomplete = () => ok(req.result); tx.onerror = tx.onabort = () => no(tx.error); });
    };
    return { put: (r) => run('readwrite', (st) => st.put(r)), getAll: () => run('readonly', (st) => st.getAll()), delete: (id) => run('readwrite', (st) => st.delete(id)) };
  })();
  function newFillId() { // a leading letter, as the server wants
    return 'F' + (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '') : Date.now().toString(36) + Math.random().toString(36).slice(2, 12));
  }
  const toB64 = (blob) => new Promise((ok, no) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(',')[1] || ''); r.onerror = () => no(new Error('Could not read the file. Take it again.'));
    r.readAsDataURL(blob);
  });
  // the server's JSON answer, or null for no answer (offline, a timeout, an HTML error page): a 25 MB video on a weak signal is slow,
  // so this is an XHR, which reports how much of the upload has gone (onProgress(0..1))
  function post(token, rec, onProgress) {
    return new Promise((ok) => {
      const x = new XMLHttpRequest();
      x.open('POST', ROSTER_URL); x.timeout = 300000;
      if (onProgress) x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
      x.onload = () => { try { ok(JSON.parse(x.responseText)); } catch (e) { ok(null); } };
      x.onerror = x.ontimeout = x.onabort = () => ok(null);
      x.send(JSON.stringify(Object.assign({ action: 'driverfuel', deviceToken: token }, rec)));
    });
  }
  let flushing = false;
  async function flush(token) { // resend what waits on the phone; a fill goes only on a server success
    if (flushing) return; flushing = true;
    try {
      for (const rec of await queue.getAll()) {
        const r = await post(token, rec), o = DriverLogic.sendOutcome(r);
        if (o === 'sent') await queue.delete(rec.fillId);
        if (o === 'refused') { // the office said no (the form is long gone): stop resending 25 MB, and tell the driver once, on home
          await queue.delete(rec.fillId);
          try { const n = JSON.parse(localStorage.getItem(REFUSED_KEY) || '[]'); n.push({ litres: rec.litres, at: rec.filledAt, why: String(r.error || '') }); localStorage.setItem(REFUSED_KEY, JSON.stringify(n.slice(-5))); } catch (e) { /* no storage */ }
        }
        if (o === 'retry') break; // no signal: the rest waits too
      }
    } catch (e) { /* no IndexedDB: nothing waits */ } finally { flushing = false; if (S.bus && !location.hash.slice(1)) showWaiting(); }
  }
  // the bill photo as sent: longest side 1600 px, JPEG 0.7 (as office/js/image.js), or the original if this phone cannot redraw it
  function shrinkBill(file) {
    const url = URL.createObjectURL(file);
    return new Promise((ok) => {
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight)), c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        c.toBlob((b) => ok(b || file), 'image/jpeg', 0.7);
      };
      img.onerror = () => ok(file);
      img.src = url;
    }).finally(() => URL.revokeObjectURL(url));
  }

  // ---- screens
  const STEPS = DriverLogic.FUEL_STEPS, CHECK = STEPS.length + 1; // #fuel-1..5, then #fuel-6 = check and send
  const S = { bus: null, form: {}, files: {}, urls: {}, fileErr: {}, shown: {}, failed: '', sending: false, sent: null };
  const routeHref = () => '../coordinator/transport/capture.html?' + (api === live ? 'driver=1&' : '') + 'mode=timelapse&reg=' + encodeURIComponent(S.bus.reg.replace(/\s/g, ''));
  const bar = (html) => { $('barIn').innerHTML = html; $('bar').hidden = !html; };
  const big = (hi, en) => `<span class="dr-hi">${esc(hi)}</span><span class="dr-en">${esc(en)}</span>`;

  function home() {
    const b = S.bus, need = Math.max(0, b.runsNeeded || 0), done = Math.min(need, b.runsDone || 0), routeDone = need > 0 && done >= need;
    const m = DriverLogic.missions(b), next = m.find((x) => x.primary);
    $('hello').textContent = 'नमस्ते, ' + b.name; $('reg').textContent = b.reg;
    // the one next step, always in this spot
    $('next').innerHTML = next.id === 'route'
      ? `<div class="gb-next-b"><span class="gb-next-k">अगला काम · Next</span><p class="gb-next-t">${big('रूट का वीडियो बनाएँ', 'Record your bus route')}</p>` +
        `<a class="gb-btn gb-btn-primary dr-big" href="${routeHref()}"><span aria-hidden="true">🎥</span>&nbsp;शुरू करें · Start</a></div>`
      : `<div class="gb-next-b"><span class="gb-next-k">अगला काम · Next</span><p class="gb-next-t">${big('डीज़ल भरवाया? यहाँ भेजें', 'Filled fuel? Send it here')}</p>` +
        `<a class="gb-btn gb-btn-primary dr-big" href="#fuel-1"><span aria-hidden="true">⛽</span>&nbsp;डीज़ल भेजें · Log fuel</a></div>`;
    const fuelLine = b.lastFill ? 'पिछली बार · Last: ' + m.find((x) => x.id === 'fuel').status.replace('Last fill: ', '') : 'अभी तक कोई नहीं · None yet';
    const routeLine = need === 0 ? 'अभी कोई रूट नहीं · No route planned' : routeDone ? 'हो गया · Done' : done + ' / ' + need + ' वीडियो · videos';
    const tile = (o) => `<li><a class="dr-tile${o.next ? ' is-next' : ''}${o.done ? ' is-done' : ''}" href="${o.href || '#'}"${o.href ? '' : ' aria-disabled="true"'}>` +
      `<span class="dr-ico" aria-hidden="true">${o.icon}</span><span class="dr-tile-b">${big(o.hi, o.en)}<span class="dr-en">${esc(o.line)}</span>${o.bar || ''}</span>` +
      (o.next ? '<span class="dr-state next">अगला</span>' : o.done ? '<span class="dr-state done">✓</span>' : '') + '</a></li>';
    $('tiles').innerHTML = tile({ icon: '⛽', hi: 'डीज़ल', en: 'Fuel fill', line: fuelLine, href: '#fuel-1', next: next.id === 'fuel' }) +
      tile({ icon: '🎥', hi: 'रूट वीडियो', en: 'Route video', line: routeLine, href: need && !routeDone ? routeHref() : '', next: next.id === 'route', done: routeDone,
        bar: need ? `<span class="gb-bar${routeDone ? ' gb-bar-ok' : ''}" aria-hidden="true"><i style="width:${Math.round(100 * done / need)}%"></i></span>` : '' });
    bar(`<div class="dr-nav" style="display:flex;flex:1;gap:4px"><a href="#" aria-current="page"><span aria-hidden="true">🏠</span>होम</a>` +
      `<a href="#fuel-1"><span aria-hidden="true">⛽</span>डीज़ल</a>` +
      (need && !routeDone ? `<a href="${routeHref()}"><span aria-hidden="true">🎥</span>रूट</a>` : '') + '</div>');
    showWaiting();
  }
  function showWaiting() {
    let refused = [];
    try { refused = JSON.parse(localStorage.getItem(REFUSED_KEY) || '[]'); localStorage.removeItem(REFUSED_KEY); } catch (e) { /* none */ }
    $('refused').innerHTML = refused.map((x) => `<span aria-hidden="true">⚠️</span> ${esc(x.litres)} L वाला डीज़ल ऑफिस ने नहीं लिया, दोबारा भरें · The office did not take the ${esc(x.litres)} L fill: ${esc(hiMsg(x.why))} Log it again.`).join('<br>');
    if (!api.waiting) return;
    api.waiting().then((n) => {
      $('waiting').innerHTML = n ? `<span aria-hidden="true">📶</span> ${n} डीज़ल फ़ोन में रखा है, नेटवर्क आने पर अपने आप जाएगा · ${n} fill${n > 1 ? 's' : ''} waiting for signal ` +
        '<button type="button" class="gb-btn" id="sendNow" style="margin-top:8px;width:100%">अभी भेजें · Send now</button>' : '';
      const b = $('sendNow'); if (b) b.onclick = () => { b.disabled = true; b.textContent = 'भेज रहे हैं… · Sending…'; live.flush(); };
    });
  }

  function stepDots(n) {
    $('steps').innerHTML = STEPS.map((s, i) => `<i class="${i + 1 < n ? 'on' : i + 1 === n ? 'now' : ''}"></i>`).join('') + `<i class="${n === CHECK ? 'now' : ''}"></i>`;
  }
  function fuelStep(n) {
    stepDots(n);
    if (n === CHECK) return checkScreen();
    const st = STEPS[n - 1], file = st.id === 'video' || st.id === 'bill', err = S.shown[st.id] ? stepErr(st.id) : '';
    let body = `<div class="dr-q"><span class="dr-ico" aria-hidden="true">${st.icon}</span><h2 style="margin:0">${big(st.hi, st.en)}</h2></div><p class="dr-help">${esc(st.help)}</p>`;
    if (file) {
      const has = S.files[st.id], acc = st.id === 'video' ? 'video/*' : 'image/*';
      const preview = !has ? '' : st.id === 'video' ? `<video src="${S.urls.video}" muted playsinline controls></video>` : `<img src="${S.urls.bill}" alt="पर्ची · The bill">`;
      const cam = `<input type="file" id="cam" data-id="${st.id}" accept="${acc}" capture="environment" aria-describedby="why">`;
      body += has // taken: the preview (it can play without reopening the camera), and Retake on its own strip
        ? `<div class="dr-shot has">${preview}<label class="dr-retake">✓ ठीक है · दोबारा लें? Retake${cam}</label></div>`
        : `<label class="dr-shot" id="shot"><span aria-hidden="true">${st.id === 'video' ? '🎥' : '📷'}</span><span>${st.id === 'video' ? 'वीडियो लें · Take video' : 'फ़ोटो लें · Take photo'}</span>${cam}</label>` +
          `<p class="dr-alt"><label>कैमरा नहीं खुला? गैलरी से चुनें · Choose from gallery<input type="file" data-id="${st.id}" accept="${acc}"></label></p>`;
    } else {
      body += `<label class="gb-sr" for="num">${esc(st.en)}</label><input class="dr-num" id="num" data-id="${st.id}" inputmode="${st.id === 'litres' ? 'decimal' : 'numeric'}" autocomplete="off" value="${esc(S.form[st.id] || '')}" aria-describedby="why"${err ? ' aria-invalid="true"' : ''}>`;
    }
    body += `<p class="dr-why" id="why" role="alert">${esc(err)}</p>` + (st.id === 'amount' ? '<p class="dr-warn" id="rate"></p>' : '');
    $('stage').innerHTML = body;
    if (st.id === 'amount') rateWarn();
    // the red button is always the next thing to do: on a photo or video step with nothing taken yet, that is the camera
    const shoot = file && !S.files[st.id];
    bar(`<div class="dr-act" style="display:flex;flex:1;gap:8px"><a class="gb-btn dr-back" href="${n === 1 ? '#' : '#fuel-' + (n - 1)}" aria-label="पीछे · Back">‹</a>` +
      (shoot ? `<label class="gb-btn gb-btn-primary dr-go" for="cam"><span aria-hidden="true">${st.id === 'video' ? '🎥' : '📷'}</span>&nbsp;${st.id === 'video' ? 'वीडियो लें · Video' : 'फ़ोटो लें · Photo'}</label>`
        : '<button type="button" class="gb-btn gb-btn-primary dr-go" id="go">आगे · Next ›</button>') + '</div>');
    if (shoot) return;
    $('go').onclick = () => { S.shown[st.id] = true; const e = stepErr(st.id); if (e) { $('why').textContent = e; const f = $('num'); if (f) { f.setAttribute('aria-invalid', 'true'); f.focus(); } return; } location.hash = 'fuel-' + (n + 1); };
    const f = $('num'); if (f) f.focus({ preventScroll: true });
  }
  const formNow = () => Object.assign({}, S.form, S.files);
  // the checks speak English (driver-logic.js, shared with the server's wording); the driver reads Hindi first
  const HI = [[/^Check the number/, 'नंबर ठीक करें'], [/^Whole number/, 'पूरा नंबर लिखें, बिना दशमलव'], [/^Less than last time/, 'पिछली बार से कम है'],
    [/^Too far since last time/, 'पिछली बार से बहुत ज़्यादा है'], [/^Check the amount/, 'रकम दोबारा देखें'], [/^Choose a video/, 'वीडियो चुनें'],
    [/^This video is larger/, 'वीडियो बहुत लंबा है, छोटा लें'], [/^Take a photo/, 'पर्ची की फ़ोटो लें'], [/^This photo is larger/, 'फ़ोटो बहुत बड़ी है, दोबारा लें']];
  const hiMsg = (m) => { if (!m || /[\u0900-\u097F]/.test(m)) return m || ''; const h = HI.find(([re]) => re.test(m)); return h ? h[1] + ' · ' + m : m; };
  const stepErr = (id) => hiMsg(S.fileErr[id] || DriverLogic.stepError(id, formNow(), S.bus.lastOdometer));
  function rateWarn() { const w = $('rate'); if (w) w.textContent = DriverLogic.checkFill(formNow(), S.bus.lastOdometer).warn ? hiMsg(DriverLogic.checkFill(formNow(), S.bus.lastOdometer).warn) : ''; }

  function checkScreen() {
    const c = DriverLogic.checkFill(formNow(), S.bus.lastOdometer);
    if (!c.ready) { const first = STEPS.findIndex((s) => stepErr(s.id)); S.shown[STEPS[first].id] = true; location.hash = 'fuel-' + (first + 1); return; }
    const row = (k, ico, hi, val) => `<li><a href="#fuel-${k}"><span class="dr-ico" aria-hidden="true">${ico}</span>${big(hi, '')}<b>${val}</b></a></li>`;
    $('stage').innerHTML = `<div class="dr-q"><span class="dr-ico" aria-hidden="true">✅</span><h2 style="margin:0">${big('सब ठीक है?', 'Check, then send')}</h2></div>` +
      '<p class="dr-help">कुछ बदलना हो तो उस पर दबाएँ · Tap a line to change it</p><ul class="dr-sum">' +
      row(1, '🎥', 'वीडियो', '<span class="ok">✓</span>') + row(2, '🧾', 'पर्ची', '<span class="ok">✓</span>') +
      row(3, '⛽', 'लीटर', esc(S.form.litres)) + row(4, '₹', 'रुपये', '₹' + esc(S.form.amount)) + row(5, '🚌', 'किलोमीटर', esc(S.form.odometer)) + '</ul>' +
      `<p class="dr-warn">${esc(hiMsg(c.warn))}</p><p class="dr-why" id="why" role="alert">${esc(S.failed)}</p>` +
      '<div class="dr-prog" id="prog" hidden><span class="gb-bar"><i style="width:0%"></i></span><p class="dr-en" id="progText" role="status"></p></div>';
    bar(`<div class="dr-act" style="display:flex;flex:1;gap:8px"><a class="gb-btn dr-back" href="#fuel-${STEPS.length}" aria-label="पीछे · Back">‹</a>` +
      '<button type="button" class="gb-btn gb-btn-primary dr-go" id="go"><span aria-hidden="true">📤</span>&nbsp;भेजें · Send</button></div>');
    $('go').onclick = send;
  }

  function send() {
    if (S.sending) return;
    S.sending = true; S.failed = '';
    const go = $('go'), back = document.querySelector('.dr-back');
    go.disabled = true; go.textContent = 'भेज रहे हैं… · Sending…'; if (back) back.hidden = true; // no way out half-way
    $('prog').hidden = false; $('why').textContent = '';
    $('stage').querySelector('.dr-sum').hidden = true; $('stage').querySelector('.dr-help').hidden = true; // while it goes, only the progress
    $('stage').querySelector('.dr-q').innerHTML = `<span class="dr-ico" aria-hidden="true">📤</span><h2>${big('भेज रहे हैं…', 'Sending to the office')}</h2>`;
    const fill = Object.assign({}, S.form);
    const onProgress = (p) => { // the bar moves as the video goes; at 100% the office is still saving it
      const pct = Math.round(100 * p); $('prog').querySelector('i').style.width = pct + '%';
      $('progText').textContent = pct < 100 ? `${pct}% · पेज खुला रखें · Keep this page open` + (api === live ? ' (यह फ़ोन में भी सेव है · it is also saved on this phone)' : '') : 'ऑफिस में सेव हो रहा है… · Saving at the office…';
    };
    api.send(fill, S.files, onProgress).then((r) => r, (e) => ({ failed: (e && e.message) || 'Not sent. Nothing was lost: try again.' })).then((r) => {
      S.sending = false;
      if (r.failed) { S.failed = hiMsg(r.failed); checkScreen(); return; }
      S.sent = { fill, queued: !!r.queued };
      const d = new Date(); S.bus.lastFill = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      S.bus.lastOdometer = Number(String(fill.odometer).replace(/,/g, ''));
      Object.values(S.urls).forEach((u) => URL.revokeObjectURL(u));
      S.form = {}; S.files = {}; S.urls = {}; S.fileErr = {}; S.shown = {};
      location.hash = 'sent';
    });
  }

  function sentScreen() {
    if (!S.sent) { location.hash = ''; return; }
    const q = S.sent.queued, f = S.sent.fill;
    $('doneBox').className = 'gb-done' + (q ? ' dr-wait' : '');
    $('doneBox').querySelector('.gb-done-tick').textContent = q ? '📶' : '✓';
    $('sentHi').textContent = q ? 'फ़ोन में सेव है' : 'भेज दिया';
    $('sentText').textContent = q ? 'Saved on this phone. It sends by itself when there is signal.' : 'Sent to the office. Thank you!';
    $('sentSummary').textContent = `${f.litres} L · ₹${f.amount} · ${f.odometer} km · ऑफिस पर्ची से मिलाएगा · The office checks it against the bill`;
    bar('<div class="dr-act" style="display:flex;flex:1"><a class="gb-btn gb-btn-primary dr-go" href="#"><span aria-hidden="true">🏠</span>&nbsp;होम · Home</a></div>');
    $('sentHi').focus();
  }

  function route() {
    if (!S.bus) return;
    const h = location.hash.slice(1), m = /^fuel-(\d)$/.exec(h), n = m ? Math.min(CHECK, Math.max(1, Number(m[1]))) : 0;
    if (S.sending && h !== 'fuel-' + CHECK) { location.hash = 'fuel-' + CHECK; return; } // never leave a send half-way
    $('home').hidden = !!(n || h === 'sent'); $('fuel').hidden = !n; $('sent').hidden = h !== 'sent';
    window.scrollTo(0, 0);
    if (n) fuelStep(n); else if (h === 'sent') sentScreen(); else home();
  }

  $('stage').addEventListener('input', (e) => {
    const id = e.target.dataset.id; if (!id || e.target.type === 'file') return;
    S.form[id] = e.target.value;
    if (S.shown[id]) { const er = stepErr(id); $('why').textContent = er; e.target.setAttribute('aria-invalid', er ? 'true' : 'false'); }
    rateWarn();
  });
  $('stage').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'num') { e.preventDefault(); $('go').click(); } });
  $('stage').addEventListener('change', async (e) => {
    const id = e.target.dataset.id; if (!id || e.target.type !== 'file') return;
    let file = e.target.files && e.target.files[0];
    if (!file) return; // cancelled: keep what was there
    if (id === 'bill' && /^image\//.test(file.type)) file = await shrinkBill(file);
    const bad = DriverLogic.fileError(id, file);
    S.fileErr[id] = bad; S.shown[id] = true;
    if (!bad) { if (S.urls[id]) URL.revokeObjectURL(S.urls[id]); S.files[id] = file; S.urls[id] = URL.createObjectURL(file); }
    fuelStep(STEPS.findIndex((s) => s.id === id) + 1);
  });
  window.addEventListener('hashchange', route);

  function stop(hi, en, ico) { $('home').hidden = true; $('closed').hidden = false; $('closedHi').textContent = hi; $('closedEn').textContent = en; if (ico) $('closed').querySelector('.dr-ico').textContent = ico; }
  if (!api) { stop('यह फ़ोन जुड़ा नहीं है', 'फ़ी क्लर्क से ड्राइवर का QR कोड माँगें · This phone is not linked yet. Ask your Fee Clerk for the driver link (a QR code).'); return; }
  if (api === live) { live.flush(); window.addEventListener('online', live.flush); } // fills saved on this phone go now
  $('demo').hidden = !DEMO;
  const cached = () => { try { return JSON.parse(localStorage.getItem(BUS_KEY) || 'null'); } catch (e) { return null; } };
  api.load().then((bus) => { S.bus = bus; route(); }, (e) => e.offline && cached()
    ? (S.bus = cached(), route()) // no signal: work from the last answer; the server still checks the link when the fill is sent
    : e.offline ? stop('नेटवर्क नहीं है', 'No signal. Open this page again when there is signal. Fills already saved on this phone are safe.', '📶')
    : stop('यह फ़ोन अब जुड़ा नहीं है', e.message + ' Ask your Fee Clerk for a new driver link (a QR code). · फ़ी क्लर्क से नया लिंक माँगें।'));
})();
