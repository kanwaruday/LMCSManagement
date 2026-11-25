// node tests/game/test-form-links.js -- forms-fix (29 Oct): link targets and retired forms, asserted on the page sources
const assert = require('assert'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..', '..'), read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

// 1. the PDR page no longer embeds any Google Form (principal/index.html's HOSTS check went with batch (a))
const pdr = read('principals-daily-reporting/index.html');
assert.ok(!/docs\.google\.com\/forms|<iframe|FORM_IDS/.test(pdr), 'X1: no SS form embed left');
assert.ok(pdr.includes('../principal/support-sessions.html'), 'the SS tab points at P3');
// 4. the PDR page opens the report tab / approvals tab from its hash
assert.ok(/location\.hash === '#approvals' \|\| location\.hash === '#principal'/.test(pdr), 'hash opens the tab');
// X5: no Staff Document Submission form links
assert.ok(!/forms\.gle|DOC_FORM/.test(read('hiring/index.html') + read('office/js/hiring.js')), 'X5 retired');
// CP2: the admin page points at the setup quest
assert.ok(read('curriculum-progress/course-mapping-admin.html').includes('moving into the game'), 'CP2 pointer');
console.log('form links: ok');
