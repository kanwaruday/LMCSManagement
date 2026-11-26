// LMCS Office Backend -- Day Book: entries, reversal, balances. Append-only: a correction is a new
// opposite-direction entry whose `reverses` names the original. Money is integer paise throughout.

function officeDaybookActions_() {
  return {
    'daybook.add': { roles: ['FeeClerk', 'AdminManager', 'FinanceHead', 'Owner'], write: true, run: officeDaybookAdd_ },
    'daybook.reverse': { roles: ['FeeClerk', 'AdminManager', 'FinanceHead', 'Owner'], write: true, run: officeDaybookReverse_ },
    'daybook.attach_video': { roles: ['FeeClerk', 'Owner'], write: true, run: officeDaybookAttachVideo_ },
    'daybook.list': { roles: OFFICE_ALL_ROLES, write: false, run: officeDaybookList_ },
    'daybook.balances': { roles: OFFICE_ALL_ROLES, write: false, run: officeDaybookBalances_ },
    // lane-d (game Day Book slice 1, Uday 19 Nov: daily expenses "set up and flawless first"): the end-of-day cash count per bucket
    'daybook.count': { roles: ['FeeClerk', 'AdminManager', 'FinanceHead', 'Owner'], write: true, run: officeDaybookCount_ },
    'daybook.counts': { roles: OFFICE_ALL_ROLES, write: false, run: officeDaybookCounts_ },
    // lane-d slice 2 (Uday, 19 Nov: "a cash entry above 2000 should be sent for approvals"): the Principal (or the Owner) decides
    'daybook.pending': { roles: OFFICE_ALL_ROLES, write: false, run: officeDaybookPending_ },
    // lane-d (Uday, 26 Nov): payments above the cash limit are requests the Finance Head approves and pays by bank
    'payreq.add': { roles: ['FeeClerk', 'AdminManager', 'Principal', 'Owner'], write: true, run: officePayRequestAdd_ },
    'payreq.list': { roles: OFFICE_ALL_ROLES, write: false, run: officePayRequestList_ },
    'payreq.decide': { roles: ['FinanceHead', 'Owner'], write: true, run: officePayRequestDecide_ },
    'payreq.paid': { roles: ['FinanceHead', 'Owner'], write: true, run: officePayRequestPaid_ },
    'payreq.proof': { roles: ['FinanceHead', 'Owner'], write: true, run: officePayRequestProof_ },
    'sync.export': { roles: ['Owner'], write: false, run: officeSyncExport_ }, // lane-d: read-only copy of one tab, paged, for the Mac sync into the game's database
    'daybook.decide': { roles: ['Principal', 'Owner'], write: true, run: officeDaybookDecide_ },
  };
}

var OFFICE_BUCKETS = ['petty', 'fee', 'other'];
var OFFICE_COLLECTION_CATEGORIES = ['student_collection', 'student_collection_paid'];
var OFFICE_DEPOSIT_LEG_CATEGORIES = ['deposit_cash_out', 'deposit_bank_in'];

// Strict ISO calendar date: shape and a real day (rejects 2026-02-30).
function officeIsoDate_(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s; // invalid month/day gives Invalid Date, which has no ISO string
}

// Defaults for rows written before Day Book v2 (blank account / charged_to).
function officeRowAccount_(row) { return row.account || (row.mode === 'cash' ? 'cash:' : 'bank:') + row.campus; }
function officeRowChargedTo_(row) { return row.charged_to || row.campus; }

function officeBlank_(v) { return v === undefined || v === null || v === ''; }

// Fee Clerk / Admin Manager (no FinanceHead or Owner role, P8): own campus, cash accounts, credit bills only for
// vehicle categories; no bank rows or settlements (own cash transfers are allowed, P10). Used by daybook.add and daybook.reverse.
function officeAssertAccountAllowed_(caller, acct, cat) {
  if (caller.roles.indexOf('FinanceHead') !== -1 || caller.roles.indexOf('Owner') !== -1) return;
  const id = cat && cat.id;
  if (id === 'credit_settlement' || acct.kind === 'bank' ||
      (acct.kind === 'credit' && !(cat && cat.needs_vehicle)) ||
      (caller.campuses.indexOf('ALL') === -1 && caller.campuses.indexOf(acct.campus) === -1)) throw officeCoded_('FORBIDDEN_ACCOUNT');
}

function officeDaybookAdd_(ctx, data) {
  if (!data.id) throw new Error('MISSING_ID');
  if (!officeIsoDate_(data.entry_date)) throw new Error('BAD_DATE');
  if (data.entry_date > officeToday_()) throw new Error('FUTURE_DATE');
  // P9: a retry of a saved entry is a duplicate before any validation, so a later config change (account or
  // vehicle switched off, day closed) never strands it in the outbox.
  const ss = officeOpen_(data.campus, officeFy_(data.entry_date));
  if (officeRows_(ss, 'DayBook').some(function (r) { return r.id === String(data.id); })) return { id: String(data.id), duplicate: true };
  const waiting = officeRows_(ss, 'Pending').filter(function (r) { return r.id === String(data.id); })[0];
  if (waiting) return { id: waiting.id, duplicate: true, pending: !officeDecision_(ss, waiting.id) };
  // typeof number only: "1,234.50" and other strings never reach arithmetic; floats and 0/negatives fail safe-integer > 0.
  if (typeof data.amount_paise !== 'number' || !Number.isSafeInteger(data.amount_paise) || data.amount_paise <= 0) throw new Error('BAD_AMOUNT');
  const cat = officeCategory_(data.category);
  if (!cat) throw new Error('BAD_CATEGORY');
  if (OFFICE_DEPOSIT_LEG_CATEGORIES.indexOf(cat.id) !== -1) throw officeCoded_('DEPOSIT_LEG_CATEGORY'); // only deposit.add writes legs (R37)
  if (!cat.active) throw new Error('CATEGORY_INACTIVE');
  if (data.direction !== 'IN' && data.direction !== 'OUT') throw new Error('DIRECTION_MISMATCH');
  if (cat.direction !== data.direction) throw new Error('DIRECTION_MISMATCH');

  // Money account: who may use it, then that it is this campus's, then what it may carry.
  // Entries queued before accounts existed carry none: cash or bank of their own campus.
  if (officeBlank_(data.account)) data.account = (data.mode === 'cash' ? 'cash:' : 'bank:') + data.campus;
  const acct = officeAccount_(String(data.account || ''));
  if (!acct || !acct.active) throw new Error('BAD_ACCOUNT');
  officeAssertAccountAllowed_(ctx.caller, acct, cat);
  if (acct.campus !== data.campus) throw new Error('BAD_ACCOUNT');
  let settlesAccount = '';
  if (cat.id === 'credit_settlement') {
    const sa = officeAccount_(String(data.settles_account || ''));
    if (acct.kind !== 'bank' || !sa || !sa.active || sa.kind !== 'credit') throw new Error('SETTLEMENT_ACCOUNT_REQUIRED');
    settlesAccount = sa.id;
  } else if (!officeBlank_(data.settles_account) || !officeBlank_(data.settles)) throw new Error('NOT_A_SETTLEMENT');
  // Credit is an expense when incurred, so only expense categories; cash_transfer moves cash only.
  if (acct.kind === 'credit' && (cat.direction !== 'OUT' || (cat.group !== 'school' && cat.group !== 'transport'))) throw officeCoded_('FORBIDDEN_ACCOUNT');
  if (cat.id === 'cash_transfer' && acct.kind !== 'cash') throw officeCoded_('FORBIDDEN_ACCOUNT');

  // mode is derived from the account kind; only a bank account lets the client choose (bank or upi).
  const mode = acct.kind === 'bank' ? data.mode : acct.kind;
  if (acct.kind === 'bank' ? ['bank', 'upi'].indexOf(mode) === -1 : !officeBlank_(data.mode) && data.mode !== acct.kind) throw new Error('BAD_MODE');
  if (mode === 'cash' && OFFICE_BUCKETS.indexOf(data.bucket) === -1) throw new Error('BUCKET_REQUIRED');
  if (mode !== 'cash' && data.bucket) throw new Error('BUCKET_NOT_ALLOWED');

  const chargedTo = officeBlank_(data.charged_to) ? data.campus : data.charged_to;
  if (chargedTo !== 'CHAIRMAN' && OFFICE_CAMPUSES.indexOf(chargedTo) === -1) throw new Error('BAD_CHARGED_TO');

  const vehicle = officeNormReg_(data.vehicle);
  if (cat.needs_vehicle) {
    if (!vehicle) throw new Error('VEHICLE_REQUIRED');
    if (vehicle === 'FLEET' && cat.id === 'fuel') throw new Error('VEHICLE_REQUIRED'); // a fill needs one real meter (P9)
    if (vehicle !== 'FLEET' && !officeVehicles_().some(function (v) { return v.active && officeNormReg_(v.reg) === vehicle; })) throw new Error('BAD_VEHICLE');
  } else if (vehicle) throw new Error('BAD_VEHICLE');

  const isFuel = cat.id === 'fuel';
  if (isFuel) {
    if (typeof data.litres_ml !== 'number' || !Number.isSafeInteger(data.litres_ml) || data.litres_ml <= 0) throw new Error('LITRES_REQUIRED');
    if (typeof data.odometer_km !== 'number' || !Number.isSafeInteger(data.odometer_km) || data.odometer_km < 0) throw new Error('ODOMETER_REQUIRED');
  } else if (!officeBlank_(data.litres_ml) || !officeBlank_(data.odometer_km)) throw new Error('BAD_FIELD');
  // Every payment carries a photo of the bill or the signed receipt (deposit legs and reversals never come through here).
  if (data.direction === 'OUT') {
    if (!data.file_id) throw officeCoded_('FILE_REQUIRED');
    if (!officeRecentBooks_(data.campus).some(function (b) {
      return officeRows_(b, 'Files').some(function (f) { return f.id === String(data.file_id) && f.campus === data.campus; });
    })) throw officeCoded_('FILE_MISSING'); // same check as deposit.add
  }
  // A fuel fill may carry the driver's video of the fill (a fuel_video file of this campus); the fuel check shows it as proof.
  const videoId = officeBlank_(data.video_file_id) ? '' : String(data.video_file_id);
  if (videoId) {
    if (!isFuel) throw new Error('BAD_FIELD');
    if (!officeRecentBooks_(data.campus).some(function (b) {
      return officeRows_(b, 'Files').some(function (f) { return f.id === videoId && f.campus === data.campus && f.category === 'fuel_video'; });
    })) throw officeCoded_('VIDEO_MISSING');
  }
  // Garage data: a service bill says which parts it was for (comma-separated ids, in the order tapped). Other categories ignore the field.
  const offered = officeComponentsFor_(cat.id).map(function (c) { return c.id; });
  let components = '';
  if (offered.length) {
    const picked = Array.isArray(data.components) ? data.components : officeBlank_(data.components) ? [] : null;
    if (picked && !picked.length) throw officeCoded_('COMPONENTS_REQUIRED');
    if (!picked || picked.some(function (c) { return offered.indexOf(c) === -1; })) throw officeCoded_('BAD_COMPONENT');
    components = picked.filter(function (c, i) { return picked.indexOf(c) === i; }).join(',');
  }
  const odometerNote = isFuel ? String(data.odometer_note || '').trim() : '';

  // Student collections are tracked per head; no other category carries one.
  const collection = String(officeBlank_(data.collection) ? '' : data.collection);
  if (OFFICE_COLLECTION_CATEGORIES.indexOf(cat.id) !== -1) {
    if (!collection) throw officeCoded_('COLLECTION_REQUIRED');
    const head = officeCollection_(collection);
    if (!head || !head.active) throw officeCoded_('BAD_COLLECTION');
  } else if (collection) throw new Error('BAD_FIELD');

  // Day close is the cash count: it freezes cash-account rows only (bank, UPI and credit carry their real date).
  if (acct.kind === 'cash') officeAssertOpen_(ss, data.entry_date);
  if (isFuel && !odometerNote && data.odometer_km < officeLastOdometer_(data.campus, vehicle, data.entry_date)) throw officeCoded_('ODOMETER_BACKWARDS');
  const warnings = officeRepeatWarnings_(data); // lane-d go-live: money in gets the same-person warning too   // lane-d: worked out before the row lands, so it never matches itself
  const row = {
    id: data.id, campus: data.campus, entry_date: data.entry_date, direction: data.direction, mode: mode,
    bucket: mode === 'cash' ? data.bucket : '', category: data.category, amount_paise: data.amount_paise,
    payee: data.payee || '', narration: data.narration || '', file_id: data.file_id || '', reverses: '',
    account: acct.id, charged_to: chargedTo, vehicle: vehicle, litres_ml: isFuel ? data.litres_ml : '', odometer_km: isFuel ? data.odometer_km : '',
    odometer_note: odometerNote, supplier_bill_no: String(data.supplier_bill_no || '').trim(), settles_account: settlesAccount,
    settles: settlesAccount ? String(data.settles || '').trim() : '', source: 'live', collection: collection, components: components, video_file_id: videoId,
  };
  // lane-d (Uday, 26 Nov): cash payments stop at the school's limit (₹5,000 by default), together with the day's other cash payments to the same
  // payee (no splitting a bill in two). Above it the payment is a bank payment request to the Finance Head (office-payreq.gs), never cash.
  const limit = officeApprovalLimit_(data.campus), cashOut = mode === 'cash' && data.direction === 'OUT';
  if (cashOut && !officeRows_(ss, 'DayBook').some(function (r) { return r.id === String(data.id); }) && data.amount_paise + officeSameDayPayee_(ss, row) > limit) throw officeCoded_('CASH_ABOVE_LIMIT');
  const saved = officeDaybookWrite_(ss, ctx, row, 'daybook.add');
  return warnings.length ? Object.assign({}, saved, { warnings: warnings }) : saved;
}

// lane-d: a payment that looks like one already in the books (it is still saved: the clerk reverses it if it was a mistake).
//   same_bill_photo         the bill photo's bytes are on another payment that isn't reversed (file.upload's fingerprint)
//   same_payee_amount_day   another payment that day to the same payee for the same amount, not reversed
function officeRepeatWarnings_(data) {
  const books = officeRecentBooks_(data.campus), out = [];
  const rows = books.reduce(function (acc, b) { return acc.concat(officeRows_(b, 'DayBook')); }, []);
  const files = books.reduce(function (acc, b) { return acc.concat(officeRows_(b, 'Files')); }, []);
  const reversed = {}; rows.forEach(function (r) { if (r.reverses) reversed[r.reverses] = true; });
  const live = rows.filter(function (r) { return r.direction === data.direction && !r.reverses && !reversed[r.id]; }); // same direction only
  const mine = files.filter(function (f) { return f.id === String(data.file_id); })[0];
  if (data.direction === 'OUT' && mine && mine.fingerprint) {
    const same = {}; files.forEach(function (f) { if (f.fingerprint === mine.fingerprint && f.id !== mine.id) same[f.id] = true; });
    if (live.some(function (r) { return same[r.file_id] || r.file_id === mine.id; })) out.push('same_bill_photo');
  }
  const payee = String(data.payee || '').trim().toLowerCase();
  if (payee && live.some(function (r) { return r.entry_date === data.entry_date && Number(r.amount_paise) === data.amount_paise && String(r.payee || '').trim().toLowerCase() === payee; })) out.push('same_payee_amount_day');
  return out;
}

// Highest odometer of the vehicle's fuel fills dated on or before `date` in the campus's recent books (P4).
// Reversed fills and reversals are left out, so a mistyped reading that was reversed stops counting. -1 when none.
function officeLastOdometer_(campus, vehicle, date) {
  const rows = officeRecentBooks_(campus).reduce(function (acc, b) { return acc.concat(officeRows_(b, 'DayBook')); }, []);
  const reversed = {};
  rows.forEach(function (r) { if (r.reverses) reversed[r.reverses] = true; });
  return rows.reduce(function (m, r) {
    if (r.category !== 'fuel' || r.reverses || reversed[r.id] || r.entry_date > date || typeof r.odometer_km !== 'number' || !isFinite(r.odometer_km) || officeNormReg_(r.vehicle) !== vehicle) return m;
    return Math.max(m, r.odometer_km);
  }, -1);
}

function officeDaybookWrite_(ss, ctx, row, action, createdBy) {
  officeAssertCashFloor_(ss, row);
  const res = officeAppend_(ss, 'DayBook', row, ctx.caller, { action: action, campus: row.campus, createdBy: createdBy });
  if (row.category === 'fuel' && !res.duplicate) { // feeds the GPS fuel checks; a failure here never loses the entry
    try { officeFuelMirror_(row.campus, Object.assign({}, row, { id: res.id })); } catch (err) { console.error('Fuel mirror: ' + err.message); }
  }
  const cat = officeCategory_(row.category);
  if (cat && cat.pnl_column === 'service' && !res.duplicate) { // Fleet Operations' service bills (and their reversals); same rule as fuel
    try { officeServiceMirror_(row.campus, Object.assign({}, row, { id: res.id })); } catch (err) { console.error('Service mirror: ' + err.message); }
  }
  return { id: res.id, duplicate: res.duplicate };
}

// lane-d (G2b FIX): cash never goes below zero, on any day. A cash OUT lowers the closing of its own day and of every later day, so
// the lowest end-of-day closing of that bucket from its date to the end of the book must still cover it (a backdated payment can't
// empty a later day). Every cash row is written here (add, reverse, deposit legs, handover), each as its action's first write, and
// the dispatcher holds the script lock around the whole action, so the check and the write are one step for two clerks at once.
// ponytail: one financial year's book; a payment backdated into last year isn't checked against this year's days (the book's
// opening is carried by hand at 1 April), add a cross-year walk if backdating across 1 April is ever allowed.
function officeAssertCashFloor_(ss, row) {
  if (row.mode !== 'cash' || row.direction !== 'OUT') return;
  const rows = officeRows_(ss, 'DayBook');
  if (rows.some(function (r) { return r.id === String(row.id); })) return; // a retry: the row is already counted
  let run = officeBalances_(officeOpening_(ss), rows, row.entry_date).closing.cash[row.bucket], low = run;
  const later = rows.filter(function (r) { return r.mode === 'cash' && r.bucket === row.bucket && r.entry_date > row.entry_date; })
    .sort(function (a, b) { return a.entry_date < b.entry_date ? -1 : a.entry_date > b.entry_date ? 1 : 0; });
  later.forEach(function (r, i) {
    run += r.direction === 'IN' ? r.amount_paise : -r.amount_paise;
    if (i === later.length - 1 || later[i + 1].entry_date !== r.entry_date) low = Math.min(low, run); // end of that day
  });
  if (row.amount_paise > low) throw officeCoded_('INSUFFICIENT_CASH');
  // lane-d slice 2 (G2b low): a payment backdated into last year also leaves this year's cash short (its opening was carried over),
  // so it must fit under the lowest closing of every day in this year's book too
  const nowFy = officeFy_(officeToday_());
  if (officeFy_(row.entry_date) !== nowFy && officeHasBook_(row.campus, nowFy)) {
    const cur = officeOpen_(row.campus, nowFy), curRows = officeRows_(cur, 'DayBook').filter(function (r) { return r.mode === 'cash' && r.bucket === row.bucket; })
      .sort(function (a, b) { return a.entry_date < b.entry_date ? -1 : a.entry_date > b.entry_date ? 1 : 0; });
    let run2 = officeOpening_(cur).cash[row.bucket], low2 = run2;
    curRows.forEach(function (r, i) {
      run2 += r.direction === 'IN' ? r.amount_paise : -r.amount_paise;
      if (i === curRows.length - 1 || curRows[i + 1].entry_date !== r.entry_date) low2 = Math.min(low2, run2);
    });
    if (row.amount_paise > low2) throw officeCoded_('INSUFFICIENT_CASH');
  }
}

// ── lane-d slice 2: cash approvals (Uday, 19 Nov: "a cash entry above 2000 should be sent for approvals") ──
// A gated payment is saved to Pending with the exact DayBook row it becomes. Approving writes that row (same id, dated as entered,
// still the clerk's) through officeDaybookWrite_, so the cash floor and the day's close apply at approval time; rejecting needs a
// reason. Either way one Decisions row; the entry is decided once. The entry stays listed (pending / rejected) in daybook.list.
// The day's other cash payments to this payee (live, not reversed; or waiting for approval), in paise. Payee compared trimmed,
// lower-case, spaces collapsed; a blank payee matches nothing.
function officePayeeKey_(s) { return String(s || '').trim().toLowerCase().replace(/\s+/g, ' '); }
function officeSameDayPayee_(ss, row) {
  const key = officePayeeKey_(row.payee);
  if (!key) return 0;
  const same = function (r) { return r.entry_date === row.entry_date && r.mode === 'cash' && r.direction === 'OUT' && !r.reverses && officePayeeKey_(r.payee) === key; };
  const book = officeRows_(ss, 'DayBook'), reversed = {}, decided = {};
  book.forEach(function (r) { if (r.reverses) reversed[r.reverses] = true; });
  officeRows_(ss, 'Decisions').forEach(function (d) { decided[d.entry_id] = true; });
  const live = book.filter(function (r) { return same(r) && !reversed[r.id]; });
  const waiting = officeRows_(ss, 'Pending').filter(function (p) { return !decided[p.id]; }).map(function (p) { return JSON.parse(p.row); }).filter(same);
  return live.concat(waiting).reduce(function (n, r) { return n + r.amount_paise; }, 0);
}

function officePendingAdd_(ss, ctx, row, extra) {
  const res = officeAppend_(ss, 'Pending', {
    id: row.id, campus: row.campus, entry_date: row.entry_date, direction: row.direction, mode: row.mode, bucket: row.bucket, category: row.category,
    amount_paise: row.amount_paise, payee: row.payee, narration: row.narration, file_id: row.file_id, account: row.account, row: JSON.stringify(row),
  }, ctx.caller, { action: 'daybook.add', campus: row.campus });
  return Object.assign({ id: res.id, duplicate: res.duplicate, pending: true, limit_paise: officeApprovalLimit_(row.campus) }, extra || {});
}
function officeDecision_(ss, entryId) { return officeRows_(ss, 'Decisions').filter(function (d) { return d.entry_id === entryId; })[0] || null; }

// {state?: 'pending'|'approved'|'rejected'} -> {entries}: this school's gated payments in this year's and last year's books, newest first
function officeDaybookPending_(ctx, data) {
  const out = [];
  officeRecentBooks_(data.campus).forEach(function (b) {
    const dec = {};
    officeRows_(b, 'Decisions').forEach(function (d) { dec[d.entry_id] = d; });
    officeRows_(b, 'Pending').forEach(function (p) {
      const d = dec[p.id], state = d ? d.state : 'pending';
      if (data.state && data.state !== state) return;
      const r = Object.assign({}, p, { reverses: JSON.parse(p.row).reverses || '' }); delete r.row; // a reversal waiting says what it reverses
      out.push(Object.assign(r, { state: state, decided_by: d ? d.created_by : '', decided_at: d ? d.created_at : '', reason: d ? d.reason : '' }));
    });
  });
  return { entries: out.sort(function (a, b) { return a.created_at < b.created_at ? 1 : -1; }), limit_paise: officeApprovalLimit_(data.campus) };
}

// {id (this decision's), entry_id, approve: boolean, reason?} -> {entry_id, state, duplicate}
function officeDaybookDecide_(ctx, data) {
  if (!data.id) throw new Error('MISSING_ID');
  if (typeof data.approve !== 'boolean') throw new Error('BAD_FIELD');
  const book = officeRecentBooks_(data.campus).filter(function (b) { return officeRows_(b, 'Pending').some(function (p) { return p.id === String(data.entry_id); }); })[0];
  if (!book) throw new Error('NOT_FOUND');
  const p = officeRows_(book, 'Pending').filter(function (x) { return x.id === String(data.entry_id); })[0];
  if (p.campus !== data.campus) throw new Error('NOT_FOUND');
  const prior = officeDecision_(book, p.id);
  if (prior) {
    if (prior.id === String(data.id)) return { entry_id: p.id, state: prior.state, duplicate: true }; // a retry of this decision
    throw officeCoded_('ALREADY_DECIDED');
  }
  if (String(p.created_by).toLowerCase() === String(ctx.caller.email).toLowerCase() && ctx.caller.roles.indexOf('Owner') === -1) throw officeCoded_('OWN_ENTRY'); // nobody approves their own payment (the Owner may)
  const reason = String(data.reason || '').trim();
  if (!data.approve && reason.length < 3) throw officeCoded_('REASON_REQUIRED');
  if (data.approve) {
    officeAssertOpen_(book, p.entry_date); // a closed day takes no cash row: the Owner reopens it first
    officeDaybookWrite_(book, ctx, JSON.parse(p.row), 'daybook.approve', p.created_by); // INSUFFICIENT_CASH here if the cash isn't there now
  }
  officeAppend_(book, 'Decisions', { id: String(data.id), campus: p.campus, entry_id: p.id, state: data.approve ? 'approved' : 'rejected', reason: reason.slice(0, 300) },
    ctx.caller, { action: 'daybook.decide', campus: p.campus });
  return { entry_id: p.id, state: data.approve ? 'approved' : 'rejected', duplicate: false };
}

// Reversal is dated today and written to today's book. The original, its reversals and a retry of this same
// request are all looked up in today's book and the previous financial year's (if configured; R15, R41).
function officeDaybookReverse_(ctx, data) {
  if (!data.id) throw new Error('MISSING_ID');
  const books = officeRecentBooks_(data.campus), ss = books[0];
  const all = books.reduce(function (acc, b) { return acc.concat(officeRows_(b, 'DayBook')); }, []);
  if (all.some(function (r) { return r.id === String(data.id); })) return { id: String(data.id), duplicate: true }; // retry, even across 1 April
  // lane-d slice 2: a reversal waiting for approval (a retry of it, or a second request while it waits)
  const waitingRev = books.reduce(function (acc, b) {
    const decided = {};
    officeRows_(b, 'Decisions').forEach(function (d) { decided[d.entry_id] = true; });
    return acc.concat(officeRows_(b, 'Pending').filter(function (p) { return !decided[p.id]; }));
  }, []);
  if (waitingRev.some(function (p) { return p.id === String(data.id); })) return { id: String(data.id), duplicate: true, pending: true };
  if (waitingRev.some(function (p) { return JSON.parse(p.row).reverses === String(data.reverses); })) throw officeCoded_('REVERSAL_PENDING');
  // lane-d: a reversal says why (at least 3 characters); the row keeps it and the list shows it with who reversed
  if (String(data.narration || '').trim().length < 3) throw officeCoded_('REASON_REQUIRED');
  const orig = all.filter(function (r) { return r.id === String(data.reverses) && r.campus === data.campus; })[0];
  if (!orig) throw new Error('NOT_FOUND');
  // A leg reversed alone would split a deposit; correcting a deposit is a later feature (R37).
  if (/:(out|in)$/.test(orig.id) || OFFICE_DEPOSIT_LEG_CATEGORIES.indexOf(orig.category) !== -1) throw officeCoded_('DEPOSIT_LEG');
  // A fund transfer leg reverses both legs, each in its own book (a reversal row itself is not reversed again).
  if (OFFICE_FUND_LEG_CATEGORIES.indexOf(orig.category) !== -1) {
    if (orig.reverses) throw officeCoded_('FUND_LEG');
    return officeFundReverse_(ctx, orig, data.narration);
  }
  if (orig.reverses || all.some(function (r) { return r.reverses === orig.id; })) throw new Error('ALREADY_REVERSED');
  const handover = officeHandoverOnReverse_(orig); // HANDOVER_ACCEPTED, or the pending/disputed handover this reversal closes
  const account = officeRowAccount_(orig);
  const acct = officeAccount_(account) || { id: account, kind: orig.mode === 'cash' ? 'cash' : orig.mode === 'credit' ? 'credit' : 'bank', campus: orig.campus };
  officeAssertAccountAllowed_(ctx.caller, acct, officeCategory_(orig.category)); // inactive categories still reverse
  // defence in depth: day.close refuses today, but a closed today must never take a cash row
  if (orig.mode === 'cash') officeAssertOpen_(ss, officeToday_());
  const row = {
    id: data.id, campus: data.campus, entry_date: officeToday_(), direction: orig.direction === 'IN' ? 'OUT' : 'IN',
    mode: orig.mode, bucket: orig.bucket, category: orig.category, amount_paise: orig.amount_paise, payee: orig.payee,
    narration: String(data.narration).trim(), file_id: '', reverses: orig.id,
    account: account, charged_to: officeRowChargedTo_(orig), vehicle: orig.vehicle, litres_ml: orig.litres_ml, odometer_km: orig.odometer_km,
    odometer_note: orig.odometer_note, supplier_bill_no: orig.supplier_bill_no, settles_account: orig.settles_account, settles: orig.settles,
    source: orig.source || 'live', legacy_category: orig.legacy_category, mapped_by: orig.mapped_by, collection: orig.collection, components: orig.components,
  };
  // lane-d slice 2 (G2): taking back a cash receipt above the limit pays cash out, so it waits for approval like a payment would
  // (it counts only once approved; its reason is the row's narration). A handover leg is never a cash IN, so it never waits here.
  if (!handover && orig.mode === 'cash' && orig.direction === 'IN' && orig.amount_paise > officeApprovalLimit_(data.campus)) return officePendingAdd_(ss, ctx, row);
  if (handover) officeHandoverEvent_(ctx, handover, 'closed'); // before the row: a retry finding closed writes the missing reversal
  return officeDaybookWrite_(ss, ctx, row, 'daybook.reverse');
}

// Attaches the driver's fill video to a saved fuel entry. The day book stays append-only: the link is a new Files row (category
// fuel_video, belongs_to = the entry id, the same Drive file) in the book that holds the entry. A second video needs replace:true; the
// latest link wins. Same-campus Fee Clerk or Owner (campus enforced by the caller check); fuel entries that are not reversed only.
function officeDaybookAttachVideo_(ctx, data) {
  if (!data.id) throw new Error('MISSING_ID');
  const books = officeRecentBooks_(data.campus);
  const files = books.reduce(function (acc, b) { return acc.concat(officeRows_(b, 'Files')); }, []);
  if (files.some(function (f) { return f.id === String(data.id); })) return { id: String(data.id), duplicate: true }; // retry, even across 1 April
  const home = books.filter(function (b) { return officeRows_(b, 'DayBook').some(function (r) { return r.id === String(data.entry_id) && r.campus === data.campus; }); })[0];
  if (!home) throw new Error('NOT_FOUND');
  const all = books.reduce(function (acc, b) { return acc.concat(officeRows_(b, 'DayBook')); }, []);
  const entry = all.filter(function (r) { return r.id === String(data.entry_id); })[0];
  if (entry.category !== 'fuel') throw officeCoded_('NOT_FUEL');
  if (entry.reverses || all.some(function (r) { return r.reverses === entry.id; })) throw new Error('ALREADY_REVERSED');
  const video = files.filter(function (f) { return f.id === String(data.file_id) && f.campus === data.campus && f.category === 'fuel_video'; })[0];
  if (!video) throw officeCoded_('VIDEO_MISSING');
  if ((entry.video_file_id || officeVideoLinks_(files)[entry.id]) && data.replace !== true) throw officeCoded_('VIDEO_EXISTS');
  officeAppend_(home, 'Files', { id: data.id, campus: data.campus, drive_id: video.drive_id, name: video.name, size: video.size, fingerprint: video.fingerprint,
    category: 'fuel_video', belongs_to: entry.id }, ctx.caller, { action: 'daybook.attach_video' });
  try { officeFuelMirror_(data.campus); } catch (err) { console.error('Fuel mirror: ' + err.message); } // the Coordinator sees hasVideo on its next push
  return { id: String(data.id) };
}

function officeDaybookList_(ctx, data) {
  if (!officeIsoDate_(data.from)) throw new Error('BAD_DATE');
  const to = data.to === undefined || data.to === '' ? data.from : data.to;
  if (!officeIsoDate_(to)) throw new Error('BAD_DATE');
  const fy = officeFy_(data.from);
  if (officeFy_(to) !== fy) throw new Error('RANGE_SPANS_YEARS');
  const ss = officeOpen_(data.campus, fy);
  const links = officeVideoLinks_(officeRows_(ss, 'Files')); // a fill video attached after the save shows as the entry's video_file_id
  const noBus = officeNoBusMoney_(ctx && ctx.caller); // office-ledger.gs: a Principal sees the school's money, not which bus it went on
  // lane-d: each entry says who reversed it, when and why, even when the reversal sits on a later day or in next year's book
  const rev = {};
  officeRecentBooks_(data.campus).forEach(function (b) { officeRows_(b, 'DayBook').forEach(function (r) { if (r.reverses) rev[r.reverses] = r; }); });
  // lane-d slice 2: a gated payment shows in its day as pending or rejected (it counts nowhere); an approved one says who approved it
  const dec = {};
  officeRows_(ss, 'Decisions').forEach(function (d) { dec[d.entry_id] = d; });
  const waiting = officeRows_(ss, 'Pending').filter(function (p) { return p.entry_date >= data.from && p.entry_date <= to && (!dec[p.id] || dec[p.id].state === 'rejected'); })
    .map(function (p) { const r = Object.assign({}, JSON.parse(p.row), { created_at: p.created_at, created_by: p.created_by }), d = dec[p.id];
      return Object.assign(r, { approval: d ? 'rejected' : 'pending', decided_by: d ? d.created_by : '', reject_reason: d ? d.reason : '' }); });
  return { entries: officeRows_(ss, 'DayBook').filter(function (r) { return r.entry_date >= data.from && r.entry_date <= to; })
    .map(function (r) { const d = dec[r.id]; return d && d.state === 'approved' ? Object.assign({}, r, { approval: 'approved', decided_by: d.created_by }) : r; })
    .concat(waiting)
    .map(function (r) { const x = rev[r.id]; return x ? Object.assign({}, r, { reversed_by: x.created_by, reversed_on: x.entry_date, reversal_reason: x.narration }) : r; })
    .map(function (r) { return links[r.id] ? Object.assign({}, r, { video_file_id: links[r.id] }) : r; })
    .map(function (r) { return noBus && r.vehicle ? Object.assign({}, r, { vehicle: '', litres_ml: '', odometer_km: '', odometer_note: '' }) : r; }) };
}

function officeDaybookBalances_(ctx, data) {
  if (!officeIsoDate_(data.date)) throw new Error('BAD_DATE');
  const ss = officeOpen_(data.campus, officeFy_(data.date));
  return officeBalances_(officeOpening_(ss), officeRows_(ss, 'DayBook'), data.date);
}

// Pure. `opening` is officeOpening_ shape; result.opening is that plus every row before `date`;
// in/out are `date`'s movements; closing = opening + in - out. Rows after `date` are ignored.
function officeBalances_(opening, rows, date) {
  const zero = function () { return { cash: { petty: 0, fee: 0, other: 0 }, bank: 0, upi: 0 }; };
  const add = function (acc, r, sign) {
    if (r.mode === 'credit') return; // a supplier credit line is neither cash nor bank (owed amounts: ledger.summary)
    if (r.mode === 'cash') acc.cash[r.bucket] += sign * r.amount_paise; else acc[r.mode] += sign * r.amount_paise;
  };
  const open = zero(), inn = zero(), out = zero(), close = zero();
  [open, close].forEach(function (a) {
    a.cash.petty = opening.cash.petty; a.cash.fee = opening.cash.fee; a.cash.other = opening.cash.other; a.bank = opening.bank; a.upi = opening.upi;
  });
  rows.forEach(function (r) {
    if (r.entry_date > date) return;
    const sign = r.direction === 'IN' ? 1 : -1;
    if (r.entry_date < date) { add(open, r, sign); add(close, r, sign); return; }
    add(r.direction === 'IN' ? inn : out, r, 1);
    add(close, r, sign);
  });
  return { opening: open, in: inn, out: out, closing: close };
}

// lane-d: the end-of-day cash count. The Fee Clerk types what each cash bucket physically holds; the difference against the day's
// closing is saved with it, and a difference that isn't zero needs a one-line reason. One count per bucket per day is kept (a later
// count of the same day and bucket is a new row; the latest wins in daybook.counts). Today or a past open day only.
function officeDaybookCount_(ctx, data) {
  if (!data.id) throw new Error('MISSING_ID');
  if (!officeIsoDate_(data.count_date) || data.count_date > officeToday_()) throw new Error('BAD_DATE');
  if (OFFICE_BUCKETS.indexOf(data.bucket) === -1) throw new Error('BUCKET_REQUIRED');
  if (typeof data.counted_paise !== 'number' || !Number.isSafeInteger(data.counted_paise) || data.counted_paise < 0) throw new Error('BAD_AMOUNT');
  const ss = officeOpen_(data.campus, officeFy_(data.count_date));
  if (officeRows_(ss, 'CashCounts').some(function (r) { return r.id === String(data.id); })) return { id: String(data.id), duplicate: true };
  officeAssertOpen_(ss, data.count_date);
  const closing = officeBalances_(officeOpening_(ss), officeRows_(ss, 'DayBook'), data.count_date).closing.cash[data.bucket];
  const diff = data.counted_paise - closing, reason = String(data.reason || '').trim();
  if (diff !== 0 && reason.length < 3) throw officeCoded_('REASON_REQUIRED');
  const res = officeAppend_(ss, 'CashCounts', { id: data.id, campus: data.campus, count_date: data.count_date, bucket: data.bucket,
    counted_paise: data.counted_paise, closing_paise: closing, difference_paise: diff, reason: reason }, ctx.caller, { action: 'daybook.count', campus: data.campus });
  return { id: res.id, duplicate: res.duplicate, closing_paise: closing, difference_paise: diff };
}
// a day's counts, the latest per bucket, with who counted
function officeDaybookCounts_(ctx, data) {
  if (!officeIsoDate_(data.date)) throw new Error('BAD_DATE');
  const latest = {};
  officeRows_(officeOpen_(data.campus, officeFy_(data.date)), 'CashCounts').forEach(function (r) {
    if (r.count_date === data.date && (!latest[r.bucket] || String(r.created_at) >= String(latest[r.bucket].created_at))) latest[r.bucket] = r;
  });
  return { counts: OFFICE_BUCKETS.filter(function (b) { return latest[b]; }).map(function (b) { return latest[b]; }) };
}

// lane-d (Uday 26 Nov, "bring that to the newer game"): a read-only, paged copy of one tab of one school's book, for db/import/daybook-sync.mjs
// (the Mac, Jarvis runs it). Owner scope only; reached through the game key (gameSyncExport). Writes nothing. Rows are returned as the sheet holds them.
var OFFICE_SYNC_TABS = ['DayBook', 'Opening', 'Closes', 'Reopens', 'Pending', 'Decisions'];
function officeSyncExport_(ctx, data) {
  if (OFFICE_SYNC_TABS.indexOf(data.tab) === -1) throw new Error('BAD_INPUT');
  if (!/^\d{4}-\d{2}$/.test(String(data.fy || ''))) throw new Error('BAD_INPUT');
  const offset = Number(data.offset || 0), limit = Math.min(Number(data.limit || 500), 500);
  if (!(offset >= 0 && limit >= 1)) throw new Error('BAD_INPUT');
  if (!officeHasBook_(data.campus, data.fy)) return { rows: [], total: 0, no_book: true };
  const all = officeRows_(officeOpen_(data.campus, data.fy), data.tab).filter(function (r) { return String(r.id || '') !== ''; });
  return { rows: all.slice(offset, offset + limit), total: all.length, no_book: false };
}
