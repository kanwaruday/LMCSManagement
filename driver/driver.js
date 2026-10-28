// Driver portal page (driver/index.html). Home = the driver's mission cards; #fuel = the fuel fill; #sent = the thank-you.
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
    load: () => Promise.resolve({ name: 'Ramesh', reg: 'HP 34 X 0000', campus: 'LMS 1', runsNeeded: 2, runsDone: 1, lastFill: '2026-10-21', lastOdometer: 58000 }),
    send: () => new Promise((ok) => setTimeout(() => ok({ queued: !navigator.onLine }), 400)),
  } : null;
  const ROSTER_URL = 'https://script.google.com/macros/s/AKfycbyHiaZY_iWK2VTKKFJcCsBNnIbUndJYUSjnPkxvJ-dYavaihiul2xBJuJohPRsP9Spf/exec'; // = ROSTER_URL in assets/auth.js
  const TOKEN_KEY = 'lmcs.driverToken'; // also read by coordinator/capture/driver-mode.js
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
        catch (e) { throw new Error('Could not reach the office. Try again when there is signal.'); }
        if (!r.success) { try { localStorage.removeItem(TOKEN_KEY); } catch (e) { /* nothing kept */ } throw new Error(r.error || 'This phone is not linked. Ask the office for a new link.'); }
        return r;
      },
      send: async (form, files) => {
        const rec = { fillId: newFillId(), litres: form.litres, amount: form.amount, odometer: form.odometer, filledAt: new Date().toISOString(),
          bill: { mime: files.bill.type, base64: await toB64(files.bill) }, video: { mime: files.video.type, base64: await toB64(files.video) } };
        let kept = true;
        try { await queue.put(rec); } catch (e) { kept = false; } // private mode or a full phone: send it anyway
        const r = await post(token, rec), o = DriverLogic.sendOutcome(r);
        if (o === 'sent' || o === 'refused') await queue.delete(rec.fillId).catch(() => {}); // refused: the form still holds it all
        if (o === 'refused') throw new Error(r.error || 'The office did not accept this fill.');
        if (o === 'retry' && !kept) throw new Error('Not sent and not saved: try again when there is signal.');
        return { queued: o === 'retry' };
      },
      flush: () => flush(token),
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
  // the server's JSON answer, or null for no answer (offline, a timeout, an HTML error page): a 25 MB video on a weak signal is slow
  async function post(token, rec) {
    const ac = new AbortController(), timer = setTimeout(() => ac.abort(), 180000);
    try { return JSON.parse(await (await fetch(ROSTER_URL, { method: 'POST', signal: ac.signal, body: JSON.stringify(Object.assign({ action: 'driverfuel', deviceToken: token }, rec)) })).text()); }
    catch (e) { return null; } finally { clearTimeout(timer); }
  }
  let flushing = false;
  async function flush(token) { // resend what waits on the phone; a fill goes only on a server success
    if (flushing) return; flushing = true;
    try {
      for (const rec of await queue.getAll()) {
        const o = DriverLogic.sendOutcome(await post(token, rec));
        if (o === 'sent') await queue.delete(rec.fillId);
        if (o === 'retry') break; // no signal: the rest waits too
      }
    } catch (e) { /* no IndexedDB: nothing waits */ } finally { flushing = false; }
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
  const S = { bus: null, form: {}, files: {}, fileErr: {}, touched: {}, failed: '' };

  function home() {
    const cards = DriverLogic.missions(S.bus);
    $('cards').innerHTML = cards.map((m) => {
      const pill = m.done ? '<span class="gb-pill gb-pill-ok">Done</span>' : m.primary ? '<span class="gb-pill gb-pill-next">Next</span>'
        : m.progress != null && m.progress > 0 ? '<span class="gb-pill gb-pill-warn">In progress</span>' : '';
      const bar = m.progress == null ? '' : `<span class="gb-bar${m.done ? ' gb-bar-ok' : ''}" aria-hidden="true"><i style="width:${Math.round(100 * m.progress)}%"></i></span>`;
      const href = m.id === 'fuel' ? '#fuel' : `../coordinator/transport/capture.html?${api === live ? 'driver=1&' : ''}mode=timelapse&reg=${encodeURIComponent(S.bus.reg.replace(/\s/g, ''))}`;
      const btn = m.action ?
        `<a class="gb-btn dr-big${m.primary ? ' gb-btn-primary' : ''}" href="${href}">${esc(m.action)}</a>` : '';
      return `<li class="gb-card dr-card">${pill ? `<p>${pill}</p>` : ''}<h2>${esc(m.title)}<span class="dr-hi">${esc(m.hi)}</span></h2>${bar}<p class="gb-muted">${esc(m.status)}</p>${btn}</li>`;
    }).join('');
  }

  const fileText = (id, has) => has ? '✓ ' + (id === 'video' ? 'Video' : 'Photo') + ' taken · retake'
    : '<span aria-hidden="true">' + (id === 'video' ? '🎥' : '📷') + '</span> ' + (id === 'video' ? 'Record pump meter' : 'Take bill photo');

  function fuelForm() {
    S.form = {}; S.files = {}; S.fileErr = {}; S.touched = {}; S.failed = '';
    $('fuelForm').innerHTML = DriverLogic.FUEL_FIELDS.map((f) => f.type === 'file'
      ? `<p class="dr-fld" id="l-${f.id}">${esc(f.label)}<span class="dr-hi">${esc(f.hi)}</span></p>` +
        `<label class="gb-btn dr-big dr-file" id="b-${f.id}"><input type="file" data-id="${f.id}" accept="${f.id === 'video' ? 'video/*' : 'image/*'}" capture="environment" aria-describedby="w-${f.id}"><span>${fileText(f.id, false)}</span></label><p class="dr-why" id="w-${f.id}"></p>`
      : `<label class="dr-fld" for="f-${f.id}">${esc(f.label)}<span class="dr-hi">${esc(f.hi)}</span></label>` +
        `<input class="dr-in" id="f-${f.id}" data-id="${f.id}" inputmode="${f.type === 'decimal' ? 'decimal' : 'numeric'}" autocomplete="off" aria-describedby="w-${f.id}"><p class="dr-why" id="w-${f.id}"></p>`).join('') +
      '<p id="warn" class="dr-warn" role="status"></p>' +
      '<div class="gb-row-acts"><button type="submit" id="send" class="gb-btn gb-btn-primary dr-big"></button></div>';
    refresh(false);
  }

  // shown: whether to show each field's problem (after a send attempt, or once that field was left)
  function refresh(shown) {
    const c = DriverLogic.checkFill(Object.assign({}, S.form, S.files), S.bus.lastOdometer);
    DriverLogic.FUEL_FIELDS.forEach((f) => {
      const file = f.type === 'file';
      const msg = S.fileErr[f.id] || c.errors[f.id] || (c.missing.includes(f.id) ? (file ? 'Take this before sending' : 'Fill this in') : '');
      const show = shown || S.touched[f.id] ? msg : '';
      $('w-' + f.id).textContent = show;
      (file ? $('fuelForm').querySelector(`input[data-id="${f.id}"]`) : $('f-' + f.id)).setAttribute('aria-invalid', show ? 'true' : 'false');
    });
    $('warn').textContent = S.failed || c.warn;
    $('send').textContent = DriverLogic.sendLabel(c);
    $('send').setAttribute('aria-disabled', c.ready ? 'false' : 'true');
    return c;
  }

  function route() {
    if (!S.bus) return;
    let h = location.hash.slice(1);
    if (h !== 'fuel' && h !== 'sent') h = '';
    $('home').hidden = h !== ''; $('fuel').hidden = h !== 'fuel'; $('sent').hidden = h !== 'sent';
    $('back').hidden = h === ''; $('back').href = '#';
    if (h === 'fuel') fuelForm();
    if (h === '') { home(); $('sentSummary').textContent = ''; }
    if (h === 'sent' && !$('sentSummary').textContent) { location.hash = ''; return; }
    window.scrollTo(0, 0);
    const target = h === 'sent' ? $('sentText') : h === 'fuel' ? $('f-litres') : null; // where the eye (and a screen reader) goes next
    if (target) { if (h === 'sent') target.tabIndex = -1; target.focus(); }
  }

  $('fuelForm').addEventListener('input', (e) => { const id = e.target.dataset.id; if (id && e.target.type !== 'file') { S.form[id] = e.target.value; refresh(false); } });
  $('fuelForm').addEventListener('focusout', (e) => { const id = e.target.dataset.id; if (id && e.target.type !== 'file') { S.touched[id] = true; refresh(false); } });
  $('fuelForm').addEventListener('change', async (e) => {
    const id = e.target.dataset.id; if (!id || e.target.type !== 'file') return;
    let file = e.target.files && e.target.files[0];
    if (file && id === 'bill' && /^image\//.test(file.type)) file = await shrinkBill(file);
    const bad = file ? DriverLogic.fileError(id, file) : '';
    S.files[id] = file && !bad ? file : null; S.fileErr[id] = bad; S.touched[id] = true;
    const b = $('b-' + id); b.toggleAttribute('data-has', !!S.files[id]);
    b.querySelector('span').innerHTML = fileText(id, !!S.files[id]);
    refresh(false);
  });
  $('fuelForm').addEventListener('submit', (e) => {
    e.preventDefault();
    S.failed = '';
    DriverLogic.FUEL_FIELDS.forEach((f) => { S.touched[f.id] = true; }); // a send attempt shows every problem, and they stay shown
    const c = refresh(true), btn = $('send');
    if (!c.ready) { const first = $('fuelForm').querySelector('[aria-invalid="true"]'); if (first) first.focus(); return; }
    if (btn.dataset.busy) return;
    btn.dataset.busy = '1'; btn.textContent = 'Sending…'; btn.setAttribute('aria-disabled', 'true');
    const fill = Object.assign({}, S.form);
    api.send(fill, S.files).then((r) => r, (e) => ({ failed: (e && e.message) || 'Not sent. Nothing was lost: try again.' })).then((r) => {
      delete btn.dataset.busy;
      if (r.failed) { S.failed = r.failed; refresh(true); return; }
      $('sentText').textContent = r.queued ? 'Saved on this phone. It sends by itself when there is signal.' : 'Sent to the office. Thank you!';
      $('sent').querySelector('.dr-done').style.cssText = r.queued ? 'background:var(--gb-warn-soft);color:var(--gb-warn)' : '';
      $('sentSummary').innerHTML = `${esc(fill.litres)} L · ₹${esc(fill.amount)} · odometer ${esc(fill.odometer)} · bill ✓ · video ✓<br><span class="gb-muted">The office checks it against the bill.</span>`;
      const d = new Date(); S.bus.lastFill = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); S.bus.lastOdometer = Number(String(fill.odometer).replace(/,/g, ''));
      location.hash = 'sent';
    });
  });
  window.addEventListener('hashchange', route);

  if (!api) { $('home').hidden = true; $('closed').hidden = false; return; }
  if (api === live) { live.flush(); window.addEventListener('online', live.flush); } // fills saved on this phone go now
  $('demo').hidden = !DEMO;
  api.load().then((bus) => {
    S.bus = bus;
    $('hello').textContent = 'Namaste, ' + bus.name; $('busline').textContent = 'Bus ' + bus.reg + ' · ' + bus.campus;
    route();
  }, (e) => { // the server's own words: an unlinked phone is told to ask the office
    $('home').hidden = true; $('closed').hidden = false;
    $('closed').innerHTML = esc(e.message) + '<br>ऑफिस से नया लिंक माँगें।';
  });
})();
