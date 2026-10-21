// Money and date formatting for the Office portal. Money is integer paise, dates are ISO.

// 12345650 -> '₹1,23,456.50' (Indian grouping: last 3 digits, then pairs).
export function formatInr(paise) {
  const neg = paise < 0;
  const abs = Math.abs(Math.round(paise));
  const rupees = String(Math.floor(abs / 100));
  const frac = String(abs % 100).padStart(2, '0');
  const head = rupees.slice(0, -3).replace(/\B(?=(\d{2})+$)/g, ',');
  const grouped = rupees.length > 3 ? head + ',' + rupees.slice(-3) : rupees;
  return (neg ? '-' : '') + '₹' + grouped + '.' + frac;
}

// '₹ 1,234.50' -> 123450. Digits only (no float maths), > 0, at most 2 decimals; otherwise null.
export function parseRupeesToPaise(text) {
  const m = /^\s*₹?\s*(\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})*,\d{3}|\d+)(?:\.(\d{1,2}))?\s*$/.exec(String(text));
  if (!m) return null;
  const paise = Number(m[1].replace(/,/g, '')) * 100 + Number((m[2] || '').padEnd(2, '0'));
  return paise > 0 && Number.isSafeInteger(paise) ? paise : null;
}

export const isoToDmy = (iso) => iso.split('-').reverse().join('/');
export const dmyToIso = (dmy) => dmy.split('/').reverse().join('-');
