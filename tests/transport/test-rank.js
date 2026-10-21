// coordinator/transport-rank.js: which vehicle needs what, and in what order. Every rule Uday set is a scenario here.
const assert = require('assert'), path = require('path');
const R = require(path.join(__dirname, '../../coordinator/transport-rank.js'));
const TODAY = '2026-10-21', KEYS = ['insurance', 'fitness', 'mv_tax', 'pollution', 'route_permit', 'speed_governor'];
const DOCS = KEYS.map((k) => ({ key: k, label: k }));
const none = () => ({ date: '', src: '', link: '', unread: [], noexp: [], other: [] });
const dated = (date, o) => Object.assign(none(), { date: date, src: 'drive', link: 'https://drive.google.com/file/d/' + 'x'.repeat(28) + '/view' }, o || {});
const wrongOnly = (id) => Object.assign(none(), { other: [{ link: 'https://drive.google.com/file/d/' + id.repeat(28) + '/view', note: 'initial compliance certificate' }] });
const allValid = () => ({ insurance: dated('2027-06-01'), fitness: dated('2027-06-01'), mv_tax: dated('2027-06-01'), pollution: dated('2027-06-01'), route_permit: dated('2030-01-01'), speed_governor: dated('2027-06-01') });
const bus = (reg, docs, o) => Object.assign({ reg: reg, bus: reg, campus: 'LMS 1', operational: true, route: '', driver: '', docs: Object.assign(allValid(), docs) }, o || {});
const blank = () => Object.fromEntries(KEYS.map((k) => [k, none()]));

const fleet = [
  bus('OK1', {}),
  bus('SOON', { fitness: dated('2026-10-31') }),
  bus('MISSING', { pollution: none() }),
  bus('WRONG', { pollution: wrongOnly('a') }),
  bus('EXPIRED_PUC', { pollution: dated('2025-08-01') }),
  bus('EXPIRED_LEGAL', { insurance: dated('2026-01-01') }),
  bus('NODOCS', blank()),
  bus('ALLWRONG', Object.fromEntries(KEYS.map((k, i) => [k, wrongOnly(String(i + 1))]))),
  bus('EOL', { insurance: dated('2021-03-08'), fitness: dated('2021-02-05') }, { operational: false }),
  bus('SG_OLD', { speed_governor: dated('2019-03-04') }),
  bus('NO_EXPIRY_INS', { insurance: Object.assign(none(), { noexp: [{ link: 'l', note: 'policy' }] }) }),
  bus('BADPROOF', { fitness: dated('2026-12-18', { link: 'https://drive.google.com/open?id=' + 'p'.repeat(28), src: 'form', other: [{ link: 'https://drive.google.com/file/d/' + 'p'.repeat(28) + '/view', note: 'fitness refused form' }] }) }),
];
const out = R.analyse(fleet, DOCS, TODAY);
const order = out.vehicles.map((v) => v.b.reg), tier = Object.fromEntries(out.vehicles.map((v) => [v.b.reg, v.tier]));

assert.deepStrictEqual(order.slice(0, 2).sort(), ['ALLWRONG', 'NODOCS'], 'vehicles with no valid paper at all are the biggest red flag and come first');
assert.strictEqual(tier.NODOCS, 'none'); assert.strictEqual(tier.ALLWRONG, 'none', 'only wrong papers = no documents');
assert.ok(order.indexOf('EXPIRED_LEGAL') < order.indexOf('EXPIRED_PUC'), 'an expired legal paper outranks an expired PUC');
assert.ok(order.indexOf('EXPIRED_PUC') < order.indexOf('WRONG'), 'expired outranks a wrong paper');
assert.ok(order.indexOf('WRONG') < order.indexOf('MISSING'), 'a wrong paper outranks a missing one');
assert.ok(order.indexOf('MISSING') < order.indexOf('SOON'), 'missing outranks due soon');
assert.ok(order.indexOf('SOON') < order.indexOf('OK1'), 'due soon outranks all current');
assert.strictEqual(order[order.length - 1], 'EOL', 'a bus past its service life is last, whatever its papers say');
assert.strictEqual(tier.EOL, 'eol'); assert.ok(out.items.every((i) => i.b.reg !== 'EOL'), 'end-of-life buses create no work items');

assert.strictEqual(tier.SG_OLD, 'ok', 'a speed governor never expires, even with a 2019 date on it');
assert.strictEqual(out.vehicles.find((v) => v.b.reg === 'SG_OLD').cells.speed_governor.t, 'onfile');
assert.strictEqual(R.cellState(none(), 'speed_governor', TODAY).t, 'missing', 'no speed governor certificate at all is still missing');
assert.strictEqual(R.cellState(wrongOnly('z'), 'speed_governor', TODAY).t, 'wrong', 'a wrong upload in the speed governor slot is flagged');
assert.strictEqual(tier.NO_EXPIRY_INS, 'ok', 'the right paper with no printed expiry is not a problem');

const bp = out.vehicles.find((v) => v.b.reg === 'BADPROOF');
assert.strictEqual(bp.cells.fitness.bad, true, 'a typed date whose own proof is the wrong paper is flagged'); assert.strictEqual(bp.tier, 'wrong');
assert.strictEqual(out.vehicles.find((v) => v.b.reg === 'WRONG').cells.pollution.t, 'wrong');
assert.strictEqual(out.vehicles.find((v) => v.b.reg === 'OK1').cells.fitness.bad, false);

const first = out.items[0];
assert.ok(['NODOCS', 'ALLWRONG'].includes(first.b.reg), 'the action list starts with the no-documents vehicles');
const ids = out.items.filter((i) => i.b.reg === 'EXPIRED_LEGAL').map((i) => i.kind);
assert.deepStrictEqual(ids, ['expired'], 'items carry one kind per paper');
assert.ok(out.vehicles.find((v) => v.b.reg === 'NODOCS').lines[0].text.startsWith('Upload all 6'), 'no-documents action text');
console.log('transport rank: all checks passed (' + out.vehicles.length + ' vehicles, order: ' + order.join(' > ') + ')');
