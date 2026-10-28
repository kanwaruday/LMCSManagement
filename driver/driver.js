// Driver portal page (driver/index.html). Home = the driver's mission cards; #fuel = the fuel fill; #sent = the thank-you.
// Sign-in and where a fill is stored are still open with Uday (vault work/Driver Portal design.md), so for now the page runs
// only as a demo (?demo=1, a made-up bus, nothing sent); without it, it says sign-in is coming. The backend adapter lands with
// those answers: load() returns the driver's bus, send() stores the fill.
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const DEMO = new URLSearchParams(location.search).get('demo') === '1';
  const api = DEMO ? {
    load: () => Promise.resolve({ name: 'Ramesh', reg: 'HP 34 X 0000', campus: 'LMS 1', runsNeeded: 2, runsDone: 1, lastFill: '2026-10-21', lastOdometer: 58000 }),
    send: () => new Promise((ok) => setTimeout(() => ok({ queued: !navigator.onLine }), 400)),
  } : null;
  const S = { bus: null, form: {}, files: {} };

  function home() {
    const cards = DriverLogic.missions(S.bus);
    $('cards').innerHTML = cards.map((m) => {
      const pill = m.done ? '<span class="gb-pill gb-pill-ok">Done</span>' : m.primary ? '<span class="gb-pill gb-pill-next">Next</span>'
        : m.progress != null && m.progress > 0 ? '<span class="gb-pill gb-pill-warn">In progress</span>' : '';
      const bar = m.progress == null ? '' : `<span class="gb-bar${m.done ? ' gb-bar-ok' : ''}" aria-hidden="true"><i style="width:${Math.round(100 * m.progress)}%"></i></span>`;
      const href = m.id === 'fuel' ? '#fuel' : `../coordinator/transport/capture.html?mode=timelapse&reg=${encodeURIComponent(S.bus.reg.replace(/\s/g, ''))}`;
      const btn = m.action ? `<a class="gb-btn dr-big${m.primary ? ' gb-btn-primary' : ''}" href="${href}">${esc(m.action)}</a>` : '';
      return `<li class="gb-card dr-card">${pill ? `<p>${pill}</p>` : ''}<h2>${esc(m.title)}<span class="dr-hi">${esc(m.hi)}</span></h2>${bar}<p class="gb-muted">${esc(m.status)}</p>${btn}</li>`;
    }).join('');
  }

  function fuelForm() {
    S.form = {}; S.files = {};
    $('fuelForm').innerHTML = DriverLogic.FUEL_FIELDS.map((f) => f.type === 'file'
      ? `<p class="dr-fld" id="l-${f.id}">${esc(f.label)}<span class="dr-hi">${esc(f.hi)}</span></p>` +
        `<label class="gb-btn dr-big dr-file" id="b-${f.id}"><input type="file" data-id="${f.id}" accept="${f.id === 'video' ? 'video/*' : 'image/*'}" capture="environment" aria-labelledby="l-${f.id}"><span>${f.id === 'video' ? '🎥 Record pump meter' : '📷 Take bill photo'}</span></label>`
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
      if (f.type === 'file') return;
      const msg = c.errors[f.id] || (shown && c.missing.includes(f.id) ? 'Fill this in' : '');
      const show = shown || S.touched?.[f.id] ? msg : '';
      $('w-' + f.id).textContent = show; $('f-' + f.id).setAttribute('aria-invalid', show ? 'true' : 'false');
    });
    $('warn').textContent = c.warn;
    $('send').textContent = DriverLogic.sendLabel(c);
    $('send').setAttribute('aria-disabled', c.ready ? 'false' : 'true');
    return c;
  }

  function route() {
    const h = location.hash.slice(1);
    $('home').hidden = h !== ''; $('fuel').hidden = h !== 'fuel'; $('sent').hidden = h !== 'sent';
    $('back').hidden = h === ''; $('back').href = '#';
    if (h === 'fuel') { S.touched = {}; fuelForm(); }
    if (h === '') { home(); $('sentSummary').textContent = ''; }
    if (h === 'sent' && !$('sentSummary').textContent) location.hash = '';
    window.scrollTo(0, 0);
  }

  $('fuelForm').addEventListener('input', (e) => { const id = e.target.dataset.id; if (id && e.target.type !== 'file') { S.form[id] = e.target.value; refresh(false); } });
  $('fuelForm').addEventListener('focusout', (e) => { const id = e.target.dataset.id; if (id && e.target.type !== 'file') { S.touched[id] = true; refresh(false); } });
  $('fuelForm').addEventListener('change', (e) => {
    const id = e.target.dataset.id; if (!id || e.target.type !== 'file') return;
    const file = e.target.files && e.target.files[0]; S.files[id] = file || null;
    const b = $('b-' + id); b.toggleAttribute('data-has', !!file);
    b.querySelector('span').textContent = file ? (id === 'video' ? '✓ Video taken · retake' : '✓ Photo taken · retake') : (id === 'video' ? '🎥 Record pump meter' : '📷 Take bill photo');
    refresh(false);
  });
  $('fuelForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const c = refresh(true), btn = $('send');
    if (!c.ready) { const first = $('fuelForm').querySelector('[aria-invalid="true"]') || $('fuelForm').querySelector('.dr-file:not([data-has])'); if (first) first.focus(); return; }
    if (btn.dataset.busy) return;
    btn.dataset.busy = '1'; btn.textContent = 'Sending…'; btn.setAttribute('aria-disabled', 'true');
    const fill = Object.assign({}, S.form);
    api.send(fill, S.files).then((r) => {
      $('sentText').textContent = r.queued ? 'Saved on this phone. It sends by itself when there is signal.' : 'Sent to the office. Thank you!';
      $('sent').querySelector('.dr-done').style.cssText = r.queued ? 'background:var(--gb-warn-soft);color:var(--gb-warn)' : '';
      $('sentSummary').innerHTML = `${esc(fill.litres)} L · ₹${esc(fill.amount)} · odometer ${esc(fill.odometer)} · bill ✓ · video ✓<br><span class="gb-muted">The office checks it against the bill.</span>`;
      S.bus.lastFill = new Date().toISOString().slice(0, 10); S.bus.lastOdometer = Number(String(fill.odometer).replace(/,/g, ''));
      location.hash = 'sent';
    }).catch(() => { $('warn').textContent = 'Not sent. Nothing was lost: try again.'; })
      .finally(() => { delete btn.dataset.busy; refresh(true); });
  });
  window.addEventListener('hashchange', route);

  if (!api) { $('home').hidden = true; $('closed').hidden = false; return; }
  $('demo').hidden = !DEMO;
  api.load().then((bus) => {
    S.bus = bus;
    $('hello').textContent = 'Namaste, ' + bus.name; $('busline').textContent = 'Bus ' + bus.reg + ' · ' + bus.campus;
    route();
  });
})();
