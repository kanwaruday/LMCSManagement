// Driver mode of the capture page: a driver's phone is linked to one bus by a device token (driver/index.html, #k=<token>),
// so the page skips the staff sign-in, offers the timelapse only, and posts deviceToken instead of idToken.
// Staff mode is untouched: a signed-in LMCS session always wins over a stored token.
export const TOKEN_KEY = 'lmcs.driverToken';
export const TOKEN_RE = /^[a-f0-9]{64}$/;
// search: location.search; token: the stored token or null; session: LMCS.getSession()
export function wantsDriverMode(search, token, session) {
  return new URLSearchParams(search).get('driver') === '1' && TOKEN_RE.test(token || '') && !session;
}

// ── Fee Clerk side (coordinator/transport/drivers.html) ──
export const DRIVER_PAGE = 'https://kanwaruday.github.io/LMCSManagement/driver/';
// the link a driver scans; the token is in the fragment, so it never reaches a server log
export const linkUrl = (token) => DRIVER_PAGE + '#k=' + token;
export const whatsappUrl = (token, name) => 'https://wa.me/?text=' + encodeURIComponent('LMCS driver link for ' + name + '. Open it once on your own phone: ' + linkUrl(token));
// same rule as the server (driver-link.gs): starts with a letter, then letters, spaces and dots; 60 characters at most
export const cleanName = (s) => String(s || '').trim().replace(/\s+/g, ' ');
export const nameOk = (s) => { const n = cleanName(s); return n.length <= 60 && /^[A-Za-z][A-Za-z .]*$/.test(n); };
