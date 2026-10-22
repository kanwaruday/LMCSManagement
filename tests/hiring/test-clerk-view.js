// Run: node tests/hiring/test-clerk-view.js -- a Fee Clerk's applicant list carries no salary, notes or report contents.
const vm = require('vm'), fs = require('fs'), assert = require('assert'), path = require('path');
const ctx = vm.createContext({ console, Logger: { log() {} }, Session: { getScriptTimeZone: () => 'Asia/Kolkata' }, Utilities: { formatDate: () => '' }, APR_STATUS: { APPROVED: 'Approved', REJECTED: 'Rejected' } });
vm.runInContext(fs.readFileSync(path.join(__dirname, '../../apps-script/hiring.gs'), 'utf8'), ctx);
const a = () => ({ name: 'A', offerBreakdown: { cti: 1 }, notes: 'n', interviewReports: [{ Weaknesses: 'w' }], demoReports: [{}], interviewReportPdf: 'https://x', history: [{ notes: 'old' }], status: 'Demo Done' });
const clerk = ctx.hirForCaller_({ roles: ['FeeClerk'] }, [a()])[0];
['offerBreakdown', 'notes', 'interviewReports', 'demoReports', 'interviewReportPdf', 'history'].forEach((k) => assert.ok(!(k in clerk) || (Array.isArray(clerk[k]) && !clerk[k].length), k));
assert.strictEqual(clerk.status, 'Demo Done');
const p = ctx.hirForCaller_({ roles: ['Principal'] }, [a()])[0];
assert.strictEqual(p.notes, 'n'); assert.strictEqual(p.interviewReports.length, 1);
console.log('ok  - Fee Clerk view is stripped; Principal view is not');
