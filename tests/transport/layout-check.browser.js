// Browser layout checks, not run by verify.mjs (they need a real browser): layoutTest for the Transport page's Vehicle by document grid, captureLayoutTest for the Capture page, setupLayoutTest (at the bottom) for the Fleet setup page.
// Use: load the Transport page (or a local copy with sample data), paste this file into the console, then run
//   await layoutTest()   -> { pass, failures[], facts{} } for the current window width.
// Fails when a column is cut off with no way to scroll, the page scrolls sideways, the header or the vehicle column
// does not stay pinned, or a paper column is squeezed under 60px. Check at 1920, 1440, 1280, 1024, 768 and 375.
// Note: a hidden browser tab draws no frames, so resize observers do not fire there; reload at each width instead.
window.layoutTest = async function () {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const f = [], facts = {};
  const box = document.querySelector('.tw.stick'); if (!box) return { pass: false, failures: ['no table'] };
  const de = document.documentElement, br = box.getBoundingClientRect();
  facts.viewport = innerWidth; facts.box = Math.round(box.clientWidth); facts.table = box.scrollWidth;
  facts.mode = getComputedStyle(box).overflowX;
  if (de.scrollWidth > de.clientWidth + 1) f.push('page scrolls sideways (' + de.scrollWidth + ' > ' + de.clientWidth + ')');
  const ths = [...box.querySelectorAll('thead th')];
  const canScroll = ['auto', 'scroll'].includes(facts.mode) && box.scrollWidth > box.clientWidth;
  if (!canScroll) ths.forEach((th) => { if (th.getBoundingClientRect().right > br.right + 1) f.push('column cut off with no scroll: ' + th.innerText.split('\n')[0]); });
  facts.fits = box.scrollWidth <= box.clientWidth + 1;
  // every paper column reachable: scroll to the far right and check the last header is inside the box
  if (canScroll) {
    box.scrollLeft = box.scrollWidth; await sleep(80);
    const last = ths[ths.length - 1].getBoundingClientRect(), b2 = box.getBoundingClientRect();
    if (last.right > b2.right + 1) f.push('last column unreachable even when scrolled');
    const firstCell = box.querySelector('tbody tr:not(.grp) td');
    if (firstCell && firstCell.getBoundingClientRect().left < b2.left - 1) f.push('vehicle column scrolls away (should stay pinned)');
    box.scrollLeft = 0; await sleep(50);
  }
  // header stays in view when scrolling down (page or box)
  const th = ths[0];
  if (canScroll && box.scrollHeight > box.clientHeight) { box.scrollTop = 300; await sleep(80); if (Math.abs(th.getBoundingClientRect().top - box.getBoundingClientRect().top) > 2) f.push('header does not stay pinned inside the box'); box.scrollTop = 0; }
  else { const y0 = th.getBoundingClientRect().top + scrollY; scrollTo(0, y0 + 400); await sleep(80); if (Math.abs(th.getBoundingClientRect().top) > 2) f.push('header does not stay pinned to the page'); scrollTo(0, 0); await sleep(50); }
  // no paper header or date cell squeezed to unreadable
  const narrow = ths.slice(-6).filter((t) => t.getBoundingClientRect().width < 60).map((t) => t.innerText.split('\n')[0]);
  if (narrow.length) f.push('paper columns under 60px: ' + narrow.join(', '));
  facts.colWidths = ths.map((t) => t.innerText.split('\n')[0] + ':' + Math.round(t.getBoundingClientRect().width)).join(' ');
  return { pass: f.length === 0, failures: f, facts };
};

// Capture page (coordinator/transport/capture.html), phone width. Load it at 375 px (and at 375x667 for a small phone),
// paste this file into the console, then run   await captureLayoutTest()   on the start screen and again during a run.
// Fails when the page scrolls sideways, anything visible sticks out past the right edge, or, during a run, the STOP HERE
// button is not fully on screen at the top of the page (above the fold) or is under 88 px tall. On the safety check
// (Inspection) it also fails when a Yes/No button is under 48 px tall, Take photo / Retake / the date field is under 48 px,
// the strip of slots does not fit the width, or the pinned HUD (count + slots) takes more than 30% of the screen height.
// On the safety check's summary it fails when its strip of slots does not fit; on the start screen, when a Carry on /
// End it / Discard it button (or its armed "Tap again" state) is under 48 px tall. Whole-screen pass: a folded card's line
// is under 56 px, the focused field sits under the pinned HUD, a count run's on-board box overflows or its Change count is
// under 48 px, or an open sheet has Save / Back / Cancel below the bottom of the screen.
window.captureLayoutTest = async function () {
  const f = [], facts = {}, de = document.documentElement;
  const a = document.activeElement, pinned = a && a.closest && a.closest('#inspect') && document.querySelector('#inspect .cap-hud'); // where the page is now
  const under = pinned && getComputedStyle(pinned).position === 'sticky' && a.getBoundingClientRect().top < pinned.getBoundingClientRect().bottom - 1 && !pinned.contains(a);
  scrollTo(0, 0); await new Promise((r) => setTimeout(r, 50));
  facts.viewport = innerWidth + 'x' + innerHeight;
  if (de.scrollWidth > de.clientWidth + 1) f.push('page scrolls sideways (' + de.scrollWidth + ' > ' + de.clientWidth + ')');
  const out = [...document.querySelectorAll('body *')].filter((e) => e.getClientRects().length && e.getBoundingClientRect().right > innerWidth + 1);
  if (out.length) f.push('sticks out on the right: ' + out.slice(0, 5).map((e) => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '')).join(', '));
  const stop = document.getElementById('stopHere'), running = stop && stop.getClientRects().length;
  facts.screen = running ? 'run' : 'start';
  if (running) {
    const r = stop.getBoundingClientRect();
    facts.stopHere = Math.round(r.top) + '..' + Math.round(r.bottom) + ' of ' + innerHeight;
    if (r.bottom > innerHeight) f.push('STOP HERE is below the fold');
    if (r.height < 88) f.push('STOP HERE is under 88 px tall');
  }
  const insp = document.getElementById('inspect');
  if (insp && insp.getClientRects().length) {
    facts.screen = 'inspection';
    if ([...insp.querySelectorAll('.cap-yn button')].some((b) => b.getBoundingClientRect().height < 48)) f.push('a Yes/No button is under 48 px tall');
    const strip = document.getElementById('slots'), last = strip.lastElementChild;
    facts.slots = strip.children.length;
    if (last && last.getBoundingClientRect().right > strip.getBoundingClientRect().right + 1) f.push('the strip of slots does not fit the width');
    if ([...insp.querySelectorAll('.cap-photo,.cap-took .cap-btn,.cap-slot input')].some((b) => b.getBoundingClientRect().height < 48)) f.push('a photo button or date field is under 48 px tall');
    const hud = insp.querySelector('.cap-hud');
    facts.hud = hud ? getComputedStyle(hud).position + ' ' + Math.round(hud.getBoundingClientRect().height) : 'none';
    if (hud && getComputedStyle(hud).position === 'sticky' && hud.getBoundingClientRect().height > innerHeight * 0.3) f.push('the pinned HUD takes more than 30% of the screen');
    if ([...insp.querySelectorAll('.cap-fold')].some((b) => b.getBoundingClientRect().height < 56)) f.push('a folded card is under 56 px tall');
    facts.folded = insp.querySelectorAll('.cap-fold').length;
  }
  if (under) f.push('the focused field is under the pinned HUD');
  const cnt = document.getElementById('countBox');
  if (running && cnt && cnt.getClientRects().length) {
    if (cnt.scrollHeight > cnt.clientHeight + 1) f.push('the on-board box overflows (' + cnt.scrollHeight + ' > ' + cnt.clientHeight + ')');
    const fix = document.getElementById('fixCount');
    if (fix.getClientRects().length && fix.getBoundingClientRect().height < 48) f.push('Change count is under 48 px tall');
  }
  const sheet = document.getElementById('sheetWrap');
  if (sheet && !sheet.hidden && [...sheet.querySelectorAll('.cap-primary, .cap-end, [data-a="cancel"]')].some((b) => b.getBoundingClientRect().bottom > innerHeight + 1)) f.push('a sheet action (Save, Back, Cancel) is below the bottom of the screen'); // a long list of stops scrolls
  const deb = document.querySelector('#summary:not([hidden]) .cap-debrief .cap-slots');
  if (deb) { facts.screen = 'inspection summary'; const l = deb.lastElementChild; if (l && l.getBoundingClientRect().right > deb.getBoundingClientRect().right + 1) f.push('the summary strip of slots does not fit the width'); }
  if ([...document.querySelectorAll('.cap-resume .cap-btn')].some((b) => b.getClientRects().length && b.getBoundingClientRect().height < 48)) f.push('a Carry on / End it / Discard it button is under 48 px tall');
  return { pass: f.length === 0, failures: f, facts };
};

// Fleet setup page (coordinator/transport/setup.html), phone width: run   await setupLayoutTest()   on the board, a bus and a
// quest form (375x667, 320x568 and 740x360). Fails when the page scrolls sideways, anything visible sticks out past the right
// edge, a button, link button, field, select or "Kilometres, workshop, cost" toggle is under 48 px tall, a team bar does not read
// "<campus> fleet: N of M buses ready", a bus card has no ring or its ring is squeezed, a bus does not list its six quests, an
// Owner's gap row does not lead with its count, the waiting banner shows empty, or on a quest its strip of slots does not fit or
// the pinned HUD takes over 30% of the screen.
window.setupLayoutTest = async function () {
  const f = [], facts = {}, de = document.documentElement, vis = (e) => e.getClientRects().length > 0;
  facts.viewport = innerWidth + 'x' + innerHeight;
  if (de.scrollWidth > de.clientWidth + 1) f.push('page scrolls sideways (' + de.scrollWidth + ' > ' + de.clientWidth + ')');
  const out = [...document.querySelectorAll('body *')].filter((e) => vis(e) && e.getBoundingClientRect().right > innerWidth + 1);
  if (out.length) f.push('sticks out on the right: ' + out.slice(0, 5).map((e) => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '.' + e.className)).join(', '));
  facts.screen = ['quest', 'bus', 'board'].find((id) => !document.getElementById(id).hidden) || 'none';
  const small = [...document.querySelectorAll('.fs button, .fs a.cap-primary, .fs input:not([type=file]), .fs select, .fs summary')]
    .filter((e) => vis(e) && e.getBoundingClientRect().height < 47.5).map((e) => (e.textContent || e.id || e.tagName).trim().slice(0, 20) + ':' + Math.round(e.getBoundingClientRect().height));
  if (small.length) f.push('under 48 px: ' + small.slice(0, 5).join(', '));
  if (facts.screen === 'board') {
    const bars = [...document.querySelectorAll('#teams li p')].map((p) => p.textContent);
    facts.teams = bars.join(' | ');
    if (bars.some((t) => !/^LMS \d fleet: \d+ of \d+ buses ready$/.test(t))) f.push('a team bar does not read "<campus> fleet: N of M buses ready"');
    const cards = [...document.querySelectorAll('.fs-bus')];
    facts.buses = cards.length;
    if (cards.some((c) => { const r = c.querySelector('.fs-ring'); return !r || r.getBoundingClientRect().width < 48; })) f.push('a bus card has no ring, or its ring is squeezed');
  }
  if (facts.screen === 'bus' && document.querySelectorAll('#bus .fs-quest').length !== 6) f.push('the bus does not list its six quests');
  // the Owner's gaps: every row leads with its count; the waiting banner never shows empty (all refused: only the refused list)
  const gapRows = [...document.querySelectorAll('#gapList .fs-row')].filter(vis);
  if (gapRows.some((r) => !/^\d+$/.test((r.querySelector('.fs-gapn') || {}).textContent || ''))) f.push('a gap row does not lead with its count');
  const pend = document.getElementById('pending');
  if (pend && vis(pend) && !pend.textContent.trim()) f.push('the waiting banner shows with nothing in it');
  facts.refused = document.querySelectorAll('#refused li').length;
  // a quest: its strip of slots fits the width, and the pinned HUD takes at most 30% of the screen
  if (facts.screen === 'quest') {
    const hud = document.querySelector('#quest .cap-hud'), strip = document.getElementById('needSlots');
    if (strip && vis(strip) && strip.scrollWidth > strip.clientWidth + 1) f.push('the quest strip of slots does not fit');
    if (hud && getComputedStyle(hud).position === 'sticky' && hud.getBoundingClientRect().height > innerHeight * 0.3) f.push('the pinned quest HUD takes over 30% of the screen (' + Math.round(hud.getBoundingClientRect().height) + 'px)');
    const a = document.activeElement; // whole-screen pass: a focused field is never left under the pinned HUD
    if (hud && a && hud.parentNode.contains(a) && !hud.contains(a) && getComputedStyle(hud).position === 'sticky' && a.getBoundingClientRect().top < hud.getBoundingClientRect().bottom - 1) f.push('the focused field is under the pinned quest HUD');
  }
  return { pass: f.length === 0, failures: f, facts };
};
