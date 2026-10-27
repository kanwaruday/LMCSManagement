// LMCS Office Backend -- cash handover between campuses (a Fee Clerk hands cash to another school or HES).
// The sender's OUT leg (<id>-out, cash_transfer) is written at once; the handover waits in the Config Handovers tab until
// the receiving campus accepts it (IN leg <id>-in, cash_received, dated the acceptance day) or disputes it. A disputed
// handover is settled by the sender reversing the OUT leg (daybook.reverse), which closes it. Legs link via `settles`;
// `payee` names the other cash account. Both are movement categories; ledger.summary counts the pair once (OUT leg).

function officeHandoverActions_() {
  const desk = ['FeeClerk', 'AdminManager', 'FinanceHead', 'Owner'];
  return {
    'cash.handover': { roles: desk, write: true, run: officeCashHandover_ },
    'cash.accept': { roles: desk, write: true, run: officeCashAccept_ },
    'cash.dispute': { roles: desk, write: true, run: officeCashDispute_ },
    'cash.handovers': { roles: OFFICE_ALL_ROLES, write: false, run: officeCashHandovers_ },
  };
}

// {id: {..first row, state, dispute_note}} from the Handovers events; the latest row per handover is its state.
function officeHandovers_() {
  const out = {};
  officeRows_(officeConfigBook_(), 'Handovers').forEach(function (r) {
    if (r.state === 'pending') out[r.id] = Object.assign({}, r, { dispute_note: '' });
    else if (out[r.handover]) { out[r.handover].state = r.state; if (r.state === 'disputed') out[r.handover].dispute_note = r.note; }
  });
  return out;
}

function officeHandoverEvent_(ctx, ho, state, note) {
  return officeAppend_(officeConfigBook_(), 'Handovers', { id: ho.id + ':' + state, handover: ho.id, state: state, note: note || '' }, ctx.caller,
    { action: 'cash.' + state, campus: state === 'closed' ? ho.from_campus : ho.to_campus, auditSs: officeOpen_(state === 'closed' ? ho.from_campus : ho.to_campus, officeFy_(officeToday_())) });
}

function officeCashHandover_(ctx, data) {
  if (!data.id) throw new Error('MISSING_ID');
  if (!officeIsoDate_(data.date)) throw new Error('BAD_DATE');
  if (data.date > officeToday_()) throw new Error('FUTURE_DATE');
  const from = officeAccount_(String(data.from_account || '')), to = officeAccount_(String(data.to_account || ''));
  if (!from || !to) throw new Error('BAD_ACCOUNT');
  officeAssertCampus_(ctx.caller, from.campus); // the sender's own cash box
  const id = String(data.id), ss = officeOpen_(from.campus, officeFy_(data.date));
  const hasLeg = officeRows_(ss, 'DayBook').some(function (r) { return r.id === id + '-out'; });
  if (hasLeg && officeHandovers_()[id]) return { id: id, duplicate: true }; // retry
  if (from.kind !== 'cash' || to.kind !== 'cash' || (!hasLeg && (!from.active || !to.active))) throw new Error('BAD_ACCOUNT');
  if (from.campus === to.campus) throw officeCoded_('SAME_CAMPUS');
  if (typeof data.amount_paise !== 'number' || !Number.isSafeInteger(data.amount_paise) || data.amount_paise <= 0) throw new Error('BAD_AMOUNT');
  if (OFFICE_BUCKETS.indexOf(data.bucket) === -1) throw new Error('BUCKET_REQUIRED');
  if (!hasLeg) officeAssertOpen_(ss, data.date); // a cash row: frozen with its day (a retry only repairs the record)
  const note = String(data.note || '').trim();
  const leg = officeDaybookWrite_(ss, ctx, {
    id: id + '-out', campus: from.campus, entry_date: data.date, direction: 'OUT', mode: 'cash', bucket: data.bucket, category: 'cash_transfer',
    amount_paise: data.amount_paise, payee: to.id, narration: 'Cash handed over to ' + to.campus + (note ? ': ' + note : ''), file_id: '', reverses: '',
    account: from.id, charged_to: from.campus, settles: id + '-in', source: 'live',
  }, 'cash.handover');
  officeAppend_(officeConfigBook_(), 'Handovers', {
    id: id, handover: id, state: 'pending', from_account: from.id, to_account: to.id, from_campus: from.campus, to_campus: to.campus,
    amount_paise: data.amount_paise, bucket: data.bucket, handover_date: data.date, note: note, by_name: ctx.caller.name || '',
  }, ctx.caller, { action: 'cash.handover', campus: from.campus, auditSs: ss });
  return { id: id, duplicate: leg.duplicate };
}

// The receiving campus's handover, or throws (NOT_FOUND, FORBIDDEN_CAMPUS, HANDOVER_SELF: the sender never accepts or disputes).
function officeHandoverFor_(ctx, id) {
  const ho = officeHandovers_()[String(id || '')];
  if (!ho) throw new Error('NOT_FOUND');
  officeAssertCampus_(ctx.caller, ho.to_campus);
  if (String(ctx.caller.email).toLowerCase() === String(ho.created_by).toLowerCase()) throw officeCoded_('HANDOVER_SELF');
  return ho;
}

// Day Book rows of a campus's recent books matching `test`.
function officeRecentRows_(campus, test) {
  return officeRecentBooks_(campus).reduce(function (acc, b) { return acc.concat(officeRows_(b, 'DayBook')); }, []).filter(test);
}

// data.handover names the handover (data.id is the request's own outbox id, like daybook.reverse's).
function officeCashAccept_(ctx, data) {
  const ho = officeHandoverFor_(ctx, data.handover);
  if (officeRecentRows_(ho.to_campus, function (r) { return r.id === ho.id + '-in'; }).length) return { id: ho.id, duplicate: true }; // retry
  // The state event is written before the leg: accepted with no IN row yet is a crashed accept, which this repairs.
  if ((ho.state !== 'pending' && ho.state !== 'accepted') ||
      officeRecentRows_(ho.from_campus, function (r) { return r.reverses === ho.id + '-out'; }).length) throw officeCoded_('HANDOVER_NOT_PENDING');
  // Dated the acceptance day (today, which day.close never closes; asserted anyway like reversals).
  const today = officeToday_(), ss = officeOpen_(ho.to_campus, officeFy_(today));
  officeAssertOpen_(ss, today);
  officeHandoverEvent_(ctx, ho, 'accepted');
  officeDaybookWrite_(ss, ctx, {
    id: ho.id + '-in', campus: ho.to_campus, entry_date: today, direction: 'IN', mode: 'cash', bucket: ho.bucket, category: 'cash_received',
    amount_paise: ho.amount_paise, payee: ho.from_account, narration: 'Cash handed over by ' + ho.from_campus + (ho.by_name ? ' (' + ho.by_name + ')' : '') + (ho.note ? ': ' + ho.note : ''),
    file_id: '', reverses: '', account: ho.to_account, charged_to: ho.to_campus, settles: ho.id + '-out', source: 'live',
  }, 'cash.accept');
  return { id: ho.id, duplicate: ho.state === 'accepted' };
}

function officeCashDispute_(ctx, data) {
  const ho = officeHandoverFor_(ctx, data.handover);
  const note = String(data.note || '').trim();
  if (!note) throw officeCoded_('NOTE_REQUIRED');
  if (ho.state === 'disputed') return { id: ho.id, duplicate: true };
  if (ho.state !== 'pending') throw officeCoded_('HANDOVER_NOT_PENDING');
  officeHandoverEvent_(ctx, ho, 'disputed', note);
  return { id: ho.id, duplicate: false };
}

// Open handovers (pending or disputed) the caller sends or receives; receiver = the caller may accept it.
function officeCashHandovers_(ctx) {
  const holds = function (c) { return ctx.caller.campuses.indexOf('ALL') !== -1 || ctx.caller.campuses.indexOf(c) !== -1; };
  const all = officeHandovers_();
  return { handovers: Object.keys(all).map(function (k) { return all[k]; }).filter(function (ho) {
    return (ho.state === 'pending' || ho.state === 'disputed') && (holds(ho.from_campus) || holds(ho.to_campus));
  }).map(function (ho) {
    return { id: ho.id, state: ho.state, from_campus: ho.from_campus, to_campus: ho.to_campus, from_account: ho.from_account, to_account: ho.to_account,
      amount_paise: ho.amount_paise, bucket: ho.bucket, date: ho.handover_date, note: ho.note, by: ho.created_by, by_name: ho.by_name, dispute_note: ho.dispute_note,
      receiver: holds(ho.to_campus) && String(ctx.caller.email).toLowerCase() !== String(ho.created_by).toLowerCase() };
  }) };
}

// daybook.reverse of a handover leg (a cash_transfer / cash_received row carrying `settles`). An accepted handover (state, or
// an IN row already written) is not reversed, either leg; otherwise the OUT leg's reversal closes the handover. Returns the
// handover to close (daybook.reverse writes the closed event before the reversal row), or null (already closed: the
// reversal row is what a retry still writes).
function officeHandoverOnReverse_(orig) {
  if ((orig.category !== 'cash_transfer' && orig.category !== 'cash_received') || !orig.settles) return null;
  const ho = officeHandovers_()[orig.id.replace(/-(out|in)$/, '')];
  if (!ho) return null;
  if (ho.state === 'accepted' || orig.category === 'cash_received' ||
      officeRecentRows_(ho.to_campus, function (r) { return r.id === ho.id + '-in'; }).length) throw officeCoded_('HANDOVER_ACCEPTED');
  return ho.state === 'closed' ? null : ho;
}
