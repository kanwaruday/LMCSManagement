// LMCS Office Backend -- ledger summary: per school, money accounts, owed to suppliers, vehicles, fuel.
// Read only. Money is integer paise. A reversal is the opposite direction with the same fields, so plain
// signed sums (IN +, OUT -) net it out; only the fuel list drops reversed fills and reversals explicitly.

function officeLedgerActions_() {
  return {
    'ledger.summary': { roles: ['FinanceHead', 'Owner', 'Principal', 'Coordinator'], write: false, run: officeLedgerSummary_ },
  };
}

var OFFICE_LEDGER_GROUPS = ['fee', 'income', 'school', 'transport'];

// data {campus: 'LMS1'..|'ALL', from, to} within one financial year. officeHandle_ has already checked the
// campus ('ALL' only for callers holding ALL). Period figures use from..to; balances and owed are as at `to`.
function officeLedgerSummary_(ctx, data) {
  if (!officeIsoDate_(data.from) || !officeIsoDate_(data.to)) throw new Error('BAD_DATE');
  if (data.from > data.to) throw new Error('BAD_RANGE');
  const fy = officeFy_(data.from);
  if (officeFy_(data.to) !== fy) throw new Error('RANGE_SPANS_YEARS');
  const all = data.campus === 'ALL';
  if (!all) officeOpen_(data.campus, fy); // NO_BOOK for a single campus without one

  // Every campus book of the year: a settlement lives in the bank's book and may name another campus's credit account (P10b).
  const books = {};
  OFFICE_CAMPUSES.forEach(function (c) { if (officeHasBook_(c, fy)) books[c] = officeOpen_(c, fy); });
  const scope = Object.keys(books).filter(function (c) { return all || c === data.campus; });
  const rows = [], accountOpening = {};
  Object.keys(books).forEach(function (c) {
    officeRows_(books[c], 'DayBook').forEach(function (r) { if (r.entry_date <= data.to) rows.push(r); });
    officeRows_(books[c], 'Opening').forEach(function (r) { if (r.account) accountOpening[r.account] = r.amount_paise; });
  });
  const signed = function (r) { return r.direction === 'IN' ? r.amount_paise : -r.amount_paise; };

  // Balances as at `to`: per account, cash buckets, and settlements per credit account.
  const bal = {}, settled = {}, buckets = {};
  rows.forEach(function (r) {
    const a = officeRowAccount_(r);
    bal[a] = (bal[a] || 0) + signed(r);
    if (r.mode === 'cash') {
      const b = buckets[a] = buckets[a] || { petty: 0, fee: 0, other: 0 };
      b[r.bucket] = (b[r.bucket] || 0) + signed(r);
    }
    if (r.settles_account) settled[r.settles_account] = (settled[r.settles_account] || 0) + signed(r);
  });
  const accounts = officeAccounts_().filter(function (a) { return scope.indexOf(a.campus) !== -1; }).map(function (a) {
    const out = { id: a.id, label: a.label, kind: a.kind, campus: a.campus };
    const moved = bal[a.id] || 0;
    if (a.kind === 'cash') {
      const o = officeOpening_(books[a.campus]).cash, b = buckets[a.id] || { petty: 0, fee: 0, other: 0 };
      out.buckets = { petty: o.petty + b.petty, fee: o.fee + b.fee, other: o.other + b.other };
      out.balance_paise = out.buckets.petty + out.buckets.fee + out.buckets.other;
    } else if (a.kind === 'bank') {
      let open = accountOpening[a.id];
      // The default bank account falls back to the campus opening (bank + upi) when it has no account opening of its own.
      if (open === undefined) { const o = officeOpening_(books[a.campus]); open = a.id === 'bank:' + a.campus ? o.bank + o.upi : 0; }
      out.balance_paise = open + moved;
    } else {
      // owed = opening + bills (OUT on the account) - settlements naming it (OUT on a bank); reversals flip the sign.
      out.owed_paise = (accountOpening[a.id] || 0) - moved + (settled[a.id] || 0);
      out.balance_paise = -out.owed_paise;
    }
    return out;
  });

  // Period figures, from the scope's own books only.
  const period = rows.filter(function (r) { return r.entry_date >= data.from && scope.indexOf(r.campus) !== -1; });
  const reversed = {};
  period.forEach(function (r) { if (r.reverses) reversed[r.reverses] = true; });
  const byChargedTo = {}, inter = {}, vehicles = {}, fuel = {};
  period.forEach(function (r) {
    const cat = officeCategory_(r.category);
    if (!cat || OFFICE_LEDGER_GROUPS.indexOf(cat.group) === -1) return; // movements (deposits, settlements, transfers) are not income or cost
    const to = officeRowChargedTo_(r), v = signed(r);
    const s = byChargedTo[to] = byChargedTo[to] || {};
    s[cat.id] = (s[cat.id] || 0) + v;
    // OUT for another school = this campus paid for it (positive paise owed back).
    if (to !== r.campus) inter[r.campus + '|' + to] = (inter[r.campus + '|' + to] || 0) - v;
    if (r.vehicle && cat.pnl_column) {
      const vv = vehicles[r.vehicle] = vehicles[r.vehicle] || {};
      vv[cat.pnl_column] = (vv[cat.pnl_column] || 0) + v;
    }
    if (cat.id === 'fuel' && r.vehicle && !r.reverses && !reversed[r.id]) {
      (fuel[r.vehicle] = fuel[r.vehicle] || []).push({ id: r.id, date: r.entry_date, litres_ml: r.litres_ml, odometer_km: r.odometer_km, amount_paise: r.amount_paise });
    }
  });
  const interSchool = Object.keys(inter).filter(function (k) { return inter[k] !== 0; }).map(function (k) {
    const p = k.split('|');
    return { from: p[0], to: p[1], paise: inter[k] };
  });
  // km per litre: distance since the previous fill over the litres bought at that fill (burnt over this distance).
  Object.keys(fuel).forEach(function (reg) {
    fuel[reg].sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.odometer_km - b.odometer_km; });
    fuel[reg].forEach(function (f, i) {
      const p = fuel[reg][i - 1];
      f.km_per_litre = p && p.litres_ml > 0 ? Math.round((f.odometer_km - p.odometer_km) * 100000 / p.litres_ml) / 100 : null;
    });
  });
  return { byChargedTo: byChargedTo, accounts: accounts, interSchool: interSchool, vehicles: vehicles, fuel: fuel };
}
