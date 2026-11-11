// Game doors open one panel of the Office home (Uday, 11 Nov: one door per panel): index.html#today, #handovers, #appointments.
// #erp-dues is erp-dues.js's own. An empty or unknown hash leaves the page at its top, as before.
export const PANELS = { today: 'today', handovers: 'handovers', appointments: 'appt-box' };
export const panelFor = (hash) => PANELS[String(hash || '').replace(/^#/, '')] || null;
export function goPanel(doc, hash) {
  const id = panelFor(hash), el = id && doc.getElementById(id);
  if (!el) return false;
  el.scrollIntoView({ block: 'start' });
  return true;
}
