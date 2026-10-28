// Driver device link, frontend: the fragment-to-token step (driver/driver-logic.js) and capture's driver-mode decision and link
// helpers (coordinator/capture/driver-mode.js, an ES module, so loaded with import()). Fake tokens only.
const path = require('path'), assert = require('assert');
if (require.main !== module) { module.exports = () => {}; return; }
const DL = require(path.join(__dirname, '../../driver/driver-logic.js'));
const TOKEN = 'ab12'.repeat(16);
const t = (name, fn) => Promise.resolve(fn()).then(() => console.log('ok  ' + name));
(async () => {
  const M = await import(path.join(__dirname, '../../coordinator/capture/driver-mode.js'));
  await t('tokenFromHash reads #k=<64 hex> and nothing else', () => {
    assert.strictEqual(DL.tokenFromHash('#k=' + TOKEN), TOKEN);
    for (const bad of ['', '#', '#fuel', '#k=', '#k=abc', '#k=' + TOKEN.toUpperCase(), '#k=' + TOKEN + 'x', '#x=1&k=' + TOKEN, null]) assert.strictEqual(DL.tokenFromHash(bad), '', String(bad));
  });
  await t('driver mode needs ?driver=1, a well-formed stored token and no staff session', () => {
    assert.strictEqual(M.wantsDriverMode('?driver=1&mode=timelapse', TOKEN, null), true);
    assert.strictEqual(M.wantsDriverMode('?mode=timelapse', TOKEN, null), false, 'no ?driver=1');
    assert.strictEqual(M.wantsDriverMode('?driver=1', null, null), false, 'no token');
    assert.strictEqual(M.wantsDriverMode('?driver=1', 'short', null), false, 'malformed token');
    assert.strictEqual(M.wantsDriverMode('?driver=1', TOKEN, { email: 'staff@example.test' }), false, 'a staff session wins');
  });
  await t('the link keeps the token in the fragment; WhatsApp text carries the link, encoded', () => {
    assert.strictEqual(M.linkUrl(TOKEN), 'https://kanwaruday.github.io/LMCSManagement/driver/#k=' + TOKEN);
    const w = M.whatsappUrl(TOKEN, 'A B');
    assert.ok(w.startsWith('https://wa.me/?text='));
    assert.ok(decodeURIComponent(w.slice(20)).includes(M.linkUrl(TOKEN)));
  });
  await t('name rule matches the server: letter first, letters/spaces/dots, 60 at most', () => {
    assert.ok(M.nameOk('  A. Test   Name ') && M.cleanName('  A. Test   Name ') === 'A. Test Name');
    for (const bad of ['', '=cmd', '1abc', 'A_B', 'A'.repeat(61)]) assert.ok(!M.nameOk(bad), bad);
  });
})().catch((e) => { console.error(e); process.exit(1); });
