// The 🏠 Office / 🗺️ Routes switch under the next step (Uday, 28 Oct: every portal has a Home Base and a World). The hub and
// the quest screen each paint a .view-slot under their next step; the switch moves into whichever is showing. Routes = Fleet's
// LMCSRouteMap for this campus (read only, no money), loaded once; the rest of the page hides while it shows (office.css).
const ROUTE_ROLES = /(^|,)\s*(FeeClerk|Coordinator|Owner)\s*(,|$)/; // who transportworld serves among office users

export function mountWorld(root, session, backendUrl) {
  if (!ROUTE_ROLES.test(String(session.role || ''))) return;
  const e = (k) => (window.LMCSEmoji ? window.LMCSEmoji.get(k) + ' ' : '');
  const sw = document.createElement('div');
  sw.className = 'gb-switch'; sw.setAttribute('role', 'group'); sw.setAttribute('aria-label', 'View');
  sw.innerHTML = '<button type="button" aria-pressed="true" aria-controls="home">' + e('homeBase') + 'Office</button>' +
    '<button type="button" aria-pressed="false" aria-controls="world">' + e('world') + 'Routes</button>';
  const [home, world] = sw.querySelectorAll('button'), worldEl = document.getElementById('world');
  let map = null;
  const view = (w) => {
    root.classList.toggle('is-world', w); worldEl.hidden = !w;
    home.setAttribute('aria-pressed', String(!w)); world.setAttribute('aria-pressed', String(w));
    if (w && !map && window.LMCSRouteMap) map = window.LMCSRouteMap.mount(document.getElementById('world-map'), { session: (window.LMCS && window.LMCS.getSession()) || session, backendUrl, mode: 'metro', campus: /^LMS[1-6]$/.test(session.campus) ? session.campus : undefined });
  };
  home.onclick = () => view(false); world.onclick = () => view(true);
  const dock = () => {
    const slot = [...root.querySelectorAll('.view-slot')].find((s) => !s.closest('[hidden]'));
    if (slot && sw.parentNode !== slot) slot.append(sw);
  };
  new MutationObserver(dock).observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
  dock();
}
