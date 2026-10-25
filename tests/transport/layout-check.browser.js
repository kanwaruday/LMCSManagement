// Browser layout checks, not run by verify.mjs (they need a real browser): layoutTest for the Transport page's Vehicle by document grid, captureLayoutTest (at the bottom) for the Capture page.
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
// button is not fully on screen at the top of the page (above the fold) or is under 88 px tall.
window.captureLayoutTest = async function () {
  const f = [], facts = {}, de = document.documentElement;
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
  return { pass: f.length === 0, failures: f, facts };
};
