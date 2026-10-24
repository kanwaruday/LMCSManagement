// salTuitionFees_: a campus on two rows merges instead of the last row wiping the rest (LMS 3 showed one grade).
const vm = require('vm'), fs = require('fs'), assert = require('assert');
const src = fs.readFileSync(require('path').join(__dirname, '../../apps-script/salary.gs'), 'utf8');
const fn = src.slice(src.indexOf('function salTuitionFees_'), src.indexOf('// Editor-run check of the Tuition Fees tab'));
const sheet = [['Campus', 'M1', 'C1-C10', 'C2'], ['LMS 3', 1000, 2000, ''], ['LMS 3', '', '', 1950], ['LMS 1', 900, '', '']];
const ctx = vm.createContext({ CacheService: { getScriptCache: () => ({ get: () => null, put() {} }) }, SAL_TAB_TUITION_FEES: 't', SAL_CONFIG_CACHE_SECONDS: 1,
  salConfigValues_: () => sheet, salNormalizeCampus_: (c) => ({ 'LMS 3': 'LMS3', 'LMS 1': 'LMS1' }[String(c)] || ''), salParseNumber_: Number });
vm.runInContext(fn, ctx);
const out = JSON.parse(JSON.stringify(ctx.salTuitionFees_()));
assert.deepStrictEqual(out.LMS3, { M1: 1000, 'C1-C10': 2000, C2: 1950 });
assert.deepStrictEqual(out.LMS1, { M1: 900 });
console.log('tuition fees merge: ok');
