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
    if (r.mode === 'cash' && OFFICE_BUCKETS.indexOf(r.bucket) !== -1) {
      const b = buckets[a] = buckets[a] || { petty: 0, fee: 0, other: 0 };
      b[r.bucket] += signed(r);
    }
    if (r.settles_account) settled[r.settles_account] = (settled[r.settles_account] || 0) + signed(r);
  });
  const accounts = officeAccounts_().filter(function (a) { return scope.indexOf(a.campus) !== -1; }).map(function (a) {
    const out = { id: a.id, label: a.label, kind: a.kind, campus: a.campus };
    const moved = bal[a.id] || 0;
    if (a.kind === 'cash') {
      const o = officeOpening_(books[a.campus]).cash, b = buckets[a.id] || { petty: 0, fee: 0, other: 0 };
      out.buckets = { petty: o.petty + b.petty, fee: o.fee + b.fee, other: o.other + b.other };
      out.balance_paise = o.petty + o.fee + o.other + moved; // every signed row, so a stray bucket never drops money (P12)
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
  const inPeriod = function (r) { return r.entry_date >= data.from && scope.indexOf(r.campus) !== -1; };
  const byChargedTo = {}, inter = {}, collections = {};
  let vehicles = {};
  rows.filter(inPeriod).forEach(function (r) {
    // Student collections: per head (blank for old or imported rows) and per school; a reversal nets out by sign.
    if (r.category === 'student_collection' || r.category === 'student_collection_paid') {
      const k = r.category === 'student_collection' ? 'collected_paise' : 'paid_paise', v0 = r.category === 'student_collection' ? signed(r) : -signed(r);
      const zero = function () { return { collected_paise: 0, paid_paise: 0, balance_paise: 0 }; };
      const head = collections[r.collection || ''] = collections[r.collection || ''] || Object.assign(zero(), { bySchool: {} });
      const sch = head.bySchool[officeRowChargedTo_(r)] = head.bySchool[officeRowChargedTo_(r)] || zero();
      [head, sch].forEach(function (x) { x[k] += v0; x.balance_paise = x.collected_paise - x.paid_paise; });
    }
    // A fund transfer (bank to bank) or cash handover is owed back by the receiving campus; counted once, on the OUT leg
    // (payee = to-account; only a handover's cash_transfer carries settles, daybook.add refuses it).
    if (r.category === 'fund_transfer_out' || (r.category === 'cash_transfer' && r.settles)) {
      const dest = officeAccount_(String(r.payee || ''));
      if (dest) inter[r.campus + '|' + dest.campus] = (inter[r.campus + '|' + dest.campus] || 0) - signed(r);
    }
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
  });
  const interSchool = Object.keys(inter).filter(function (k) { return inter[k] !== 0; }).map(function (k) {
    const p = k.split('|');
    return { from: p[0], to: p[1], paise: inter[k] };
  });
  // Fuel (P12): each vehicle's fills from every campus book up to `to` (reversed fills and reversals left out), so a
  // period's first fill and fills at other campuses have their previous fill. km per litre = distance since the previous
  // fill over the litres bought at that fill (burnt over this distance); null when the distance is negative or the fill
  // carries an odometer note (meter changed, garbled reading). Then only fills in the period and scope are listed.
  const reversed = {};
  rows.forEach(function (r) { if (r.reverses) reversed[r.reverses] = true; });
  const fills = {};
  rows.forEach(function (r) {
    if (r.category === 'fuel' && r.vehicle && !r.reverses && !reversed[r.id]) (fills[r.vehicle] = fills[r.vehicle] || []).push(r);
  });
  const fuel = {};
  Object.keys(fills).forEach(function (reg) {
    const seq = fills[reg].sort(function (a, b) { return a.entry_date < b.entry_date ? -1 : a.entry_date > b.entry_date ? 1 : a.odometer_km - b.odometer_km; });
    seq.forEach(function (r, i) {
      if (!inPeriod(r)) return;
      const p = seq[i - 1], km = p ? r.odometer_km - p.odometer_km : -1;
      (fuel[reg] = fuel[reg] || []).push({ id: r.id, date: r.entry_date, litres_ml: r.litres_ml, odometer_km: r.odometer_km, amount_paise: r.amount_paise,
        km_per_litre: p && km >= 0 && p.litres_ml > 0 && !r.odometer_note ? Math.round(km * 100000 / p.litres_ml) / 100 : null });
    });
  });
  // Per-bus money is for the Owner, Coordinators and Finance (Uday, 29 Oct, "yes": the school lock's money rule). A Principal with
  // none of those roles gets no vehicle costs and, per bus, the fills only: how many, when, km per litre, never a rupee or a litre.
  const r = (ctx && ctx.caller && ctx.caller.roles) || [];
  if (r.indexOf('Principal') !== -1 && !['Owner', 'Coordinator', 'FinanceHead'].some(function (x) { return r.indexOf(x) !== -1; })) {
    vehicles = {};
    Object.keys(fuel).forEach(function (reg) { fuel[reg] = fuel[reg].map(function (f) { return { id: f.id, date: f.date, km_per_litre: f.km_per_litre }; }); });
  }
  return { byChargedTo: byChargedTo, accounts: accounts, interSchool: interSchool, vehicles: vehicles, fuel: fuel, collections: collections };
}
