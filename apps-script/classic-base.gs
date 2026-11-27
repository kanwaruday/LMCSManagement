// Where the classic pages are served (moved off GitHub Pages when the repo went private, Nov 2026). ONE value for every project (this is a `shared` file):
// Script property CLASSIC_BASE (ends in /); default = the Cloudflare Pages site. Used for the links in emails/calendar events and for the JSON files
// the backend reads from the pages (data/event-proposals.json, teacher/data/timetable.json). The pages themselves use relative links and need no host.
function classicBase_() {
  const v = String(PropertiesService.getScriptProperties().getProperty('CLASSIC_BASE') || '').trim();
  return /^https:\/\/[^\s]+$/.test(v) ? v.replace(/\/*$/, '/') : 'https://lmcs-classic.pages.dev/';
}
