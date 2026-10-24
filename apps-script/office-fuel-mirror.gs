// LMCS Office Backend -- copies every campus's fuel fills (last 120 days, reversed entries removed) to the "Fuel Fills" tab of the
// transport workbook, where the Coordinator backend checks each fill against the km the bus's GPS recorded
// (coordinator-transport-gps.gs). Runs whenever a fuel fill or its reversal is saved, for that campus only.
// Columns: id | campus | date | reg | litres | odometer | amount_rs | odometer_note (a meter change: no odometer comparison).

const OFFICE_FUEL_MIRROR_SS = '1VXTMZjqCS82ftB1rwoN4BzoiOTP7-Vg0m5vTH01Tfzc'; // "LMCS TRANSPORT DOCUMENT SUBMISSION FORM (Responses)"
const OFFICE_FUEL_MIRROR_TAB = 'Fuel Fills';
const OFFICE_FUEL_MIRROR_DAYS = 120;

/** DayBook rows -> fill rows, oldest first. A reversal row and the entry it reverses are both left out. */
function officeFuelFills_(rows, since) {
  const reversed = {};
  rows.forEach(function (r) { if (r.reverses) reversed[r.reverses] = true; });
  return rows.filter(function (r) {
    return r.category === 'fuel' && !r.reverses && !reversed[r.id] && r.vehicle && String(r.entry_date) >= since;
  }).map(function (r) {
    const n = function (v, div) { return v === '' || v == null ? '' : Number(v) / div; }; // blank stays blank: a pre-23-Oct row has no litres or odometer
    return [String(r.id), r.campus, String(r.entry_date), r.vehicle, n(r.litres_ml, 1000), n(r.odometer_km, 1), n(r.amount_paise, 100), String(r.odometer_note || '')];
  }).sort(function (a, b) { return a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0; });
}

/** Rewrites one campus's rows of the tab after a fuel fill or its reversal is saved (`written` = that new row, which the
 *  memoised book read may not show yet). Other campuses' rows are kept as they are. */
function officeFuelMirror_(campus, written) {
  const since = officeAddDays_(officeToday_(), -OFFICE_FUEL_MIRROR_DAYS);
  let rows = officeRecentBooks_(campus).reduce(function (acc, b) { return acc.concat(officeRows_(b, 'DayBook')); }, [])
    .filter(function (r) { return r.campus === campus; });
  if (written && !rows.some(function (r) { return r.id === written.id; })) rows.push(written);
  const ss = SpreadsheetApp.openById(OFFICE_FUEL_MIRROR_SS);
  const sh = ss.getSheetByName(OFFICE_FUEL_MIRROR_TAB) || ss.insertSheet(OFFICE_FUEL_MIRROR_TAB);
  const head = ['id', 'campus', 'date', 'reg', 'litres', 'odometer', 'amount_rs', 'odometer_note'];
  const keep = sh.getLastRow() > 1 ? sh.getDataRange().getValues().slice(1).filter(function (r) { return r[1] !== campus; }) : [];
  const out = [head].concat(keep, officeFuelFills_(rows, since));
  sh.clear();
  sh.getRange(1, 1, out.length, head.length).setNumberFormat('@').setValues(out.map(function (r) { return r.map(String); })); // text: dates stay yyyy-MM-dd
}

/** From the Today screen: refresh this campus's rows once a day, so fills saved before the mirror existed (or while it failed)
 *  still reach the checks. Errors are logged, never shown. */
function officeFuelMirrorDaily_(campus) {
  const cache = CacheService.getScriptCache(), key = 'office_fuel_mirror_' + campus;
  if (cache.get(key)) return;
  let lock = null;
  try {
    const l = LockService.getScriptLock(); // a fuel save rewrites the tab under this lock: never interleave with it
    if (!l.tryLock(3000)) return;
    lock = l;
    cache.put(key, '1', 6 * 3600); // set first: a failing mirror must not slow every Today load
    officeFuelMirror_(campus);
  } catch (err) { console.error('Fuel mirror: ' + err.message); } finally { if (lock) lock.releaseLock(); }
}
