// node tests/game/test-form-links.js -- forms-fix (29 Oct): link targets and retired forms, asserted on the page sources
const assert = require('assert'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..', '..'), read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

// 1. the Support Sessions room is gold, and the PDR page no longer embeds any Google Form
assert.ok(/const HOSTS = \[[^\]]*'ss'[^\]]*\]/.test(read('principal/index.html')), "'ss' is in HOSTS");
const pdr = read('principals-daily-reporting/index.html');
assert.ok(!/docs\.google\.com\/forms|<iframe|FORM_IDS/.test(pdr), 'X1: no SS form embed left');
assert.ok(pdr.includes('../principal/support-sessions.html'), 'the SS tab points at P3');
// 4. the PDR page opens the report tab / approvals tab from its hash
assert.ok(/location\.hash === '#approvals' \|\| location\.hash === '#principal'/.test(pdr), 'hash opens the tab');
// 3. HQ is linked from the Coordinator home
assert.ok(read('coordinator/index.html').includes("'hq.html'"), 'C7: hq.html linked');
// 8. the dead Mark Inactive tab is gone, Payroll is linked instead
const staff = read('staff/add-employee.html');
assert.ok(!/data-tab="inactive"|submitInactive|panel-inactive/.test(staff) && staff.includes('../payroll/index.html'), 'S5 folded into Payroll');
// X5: no Staff Document Submission form links
assert.ok(!/forms\.gle|DOC_FORM/.test(read('hiring/index.html') + read('office/js/hiring.js')), 'X5 retired');
// CP2: the admin page points at the setup quest
assert.ok(read('curriculum-progress/course-mapping-admin.html').includes('Course maps and terms'), 'CP2 pointer');
console.log('form links: ok');
