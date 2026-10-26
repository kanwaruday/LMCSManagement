// Backend /exec URL of the office Apps Script web app (not a secret, like the other portals' URLs).
// The shell shows "backend not configured" if this is ever empty.
export const OFFICE_BACKEND_URL = 'https://script.google.com/macros/s/AKfycbzdVhCwnTnMybe6cdcDC87PbINCFG1n6U7UncMHDvk9eHFG6hC4dn7oEiqJKki4-lULEw/exec';
// Coordinator backend /exec URL (copy of BACKEND_URL in coordinator/shared.js). Used only to read the bus list for "Import buses from Transport".
// Hiring lives on the PDR backend (same value as hiring/index.html PDR_BACKEND_URL).
export const PDR_BACKEND_URL = 'https://script.google.com/macros/s/AKfycbzpkFLy4KvTdSJfioz6wlgRGLjvO_GvbffhOYBb-hHybFtjGTk0ps-GzXz0FrQ9GmYdfg/exec';
export const COORD_BACKEND_URL = 'https://script.google.com/macros/s/AKfycbwilcvrgZQga_qo1A-fBTUzKLifrBYIwlPHoWMITmchf5sZOYjKIJ7_4J0TeBF_-6B6/exec';
// Game backend /exec URL (Buddy on the Starting data page): the same value as GAME_BACKEND_URL in the four homes (tests/office/test-starting-data-view.js checks).
export const GAME_BACKEND_URL = 'https://script.google.com/macros/s/AKfycbyyk7XpT86JqZRQ3ldFxesPw4ICK6WVAdsgsecEzWPViKasRs4agbYJ3Re_y_lY7mxyCA/exec';
