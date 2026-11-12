// proof-mirror.gs (Roster project, the one with Drive): every 10 minutes, copy lms-game's document proofs (PDFs and document-step
// files, never plain photos; lms-game migration 481 decides) into the school's Drive and tell lms-game the Drive id.
//   <PROOF_MIRROR_ROOT>/<School>/<Year>/<Quest>/<step> – <file>      owner_only items (AF forms F2/F3/F14/F15/F18, which may list
//   children's names) go under PROOF_MIRROR_OWNER_ROOT instead: a folder shared with the Owner only.
// Script properties (set by Uday's proof_mirror_keys.sh, never in the repo): PROOF_MIRROR_URL (the Edge Function), PROOF_MIRROR_KEY,
// PROOF_MIRROR_ROOT, PROOF_MIRROR_OWNER_ROOT. Logs carry codes only, never a file or school name.
// Uday runs installMirrorTrigger() once from the editor; it replaces any earlier mirror trigger.

var PM_MAX_ = 50, PM_BUDGET_MS_ = 4.5 * 60 * 1000;

function mirrorProofs() {
  const out = { listed: 0, saved: 0, failed: 0 };
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) { console.log('proof-mirror: busy'); return out; }
  try {
    const p = PropertiesService.getScriptProperties();
    const url = String(p.getProperty('PROOF_MIRROR_URL') || '').trim(), key = String(p.getProperty('PROOF_MIRROR_KEY') || '').trim();
    const roots = { normal: String(p.getProperty('PROOF_MIRROR_ROOT') || '').trim(), owner: String(p.getProperty('PROOF_MIRROR_OWNER_ROOT') || '').trim() };
    if (!/^https:\/\//.test(url) || !key || !roots.normal || !roots.owner) { console.error('proof-mirror: not_configured'); return out; }
    const res = UrlFetchApp.fetch(url, { method: 'get', headers: { 'x-mirror-key': key }, muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) { console.error('proof-mirror: list ' + res.getResponseCode()); return out; }
    let items;
    try { items = JSON.parse(res.getContentText()).items; } catch (e) { items = null; }
    if (!Array.isArray(items)) { console.error('proof-mirror: list_shape'); return out; }
    const started = Date.now(), folders = {}; // folder lookups cached for the run
    items.slice(0, PM_MAX_).forEach(function (it) {
      if (Date.now() - started > PM_BUDGET_MS_) return; // the next run picks the rest up
      out.listed++;
      try {
        const code = pmMirrorOne_(it, url, key, it && it.ownerOnly === true ? roots.owner : roots.normal, folders);
        if (code === 'ok') out.saved++; else { out.failed++; console.error('proof-mirror: ' + code); }
      } catch (e) { out.failed++; console.error('proof-mirror: error'); }
    });
    console.log('proof-mirror: listed ' + out.listed + ', saved ' + out.saved + ', failed ' + out.failed);
    return out;
  } finally { lock.releaseLock(); }
}

/** one item: fetch the signed URL, save (or find the earlier copy of) the file, write the Drive id back. Returns 'ok' or a code. */
function pmMirrorOne_(it, url, key, rootId, folders) {
  if (!it || typeof it.path !== 'string' || typeof it.url !== 'string' || !/^https:\/\//.test(it.url)) return 'item_shape';
  const parts = [it.school, it.year, it.quest].map(pmName_);
  const folder = pmFolder_(rootId, parts, folders);
  const name = pmName_(String(it.step || '') + ' – ' + String(it.file || 'file'));
  const prior = folder.getFilesByName(name); // a copy saved by a run whose write-back failed: reuse it, never a second copy
  let id;
  if (prior.hasNext()) id = prior.next().getId();
  else {
    const f = UrlFetchApp.fetch(it.url, { muteHttpExceptions: true });
    if (f.getResponseCode() !== 200) return 'fetch ' + f.getResponseCode();
    id = folder.createFile(f.getBlob().setName(name)).getId();
  }
  const w = UrlFetchApp.fetch(url, { method: 'post', contentType: 'application/json', headers: { 'x-mirror-key': key }, muteHttpExceptions: true,
    payload: JSON.stringify({ object_path: it.path, drive_file_id: id }) });
  return w.getResponseCode() === 200 ? 'ok' : 'writeback ' + w.getResponseCode();
}

/** a safe Drive name: no slashes or control characters, at most 120 characters, never empty */
function pmName_(s) {
  const t = String(s == null ? '' : s).replace(/[\/\\\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
  return t || 'Untitled';
}

function pmFolder_(rootId, parts, cache) {
  let k = rootId, f = cache[k] || (cache[k] = DriveApp.getFolderById(rootId));
  parts.forEach(function (n) {
    k += '/' + n;
    if (!cache[k]) { const it = f.getFoldersByName(n); cache[k] = it.hasNext() ? it.next() : f.createFolder(n); }
    f = cache[k];
  });
  return f;
}

function installMirrorTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'mirrorProofs') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('mirrorProofs').timeBased().everyMinutes(10).create();
  console.log('proof-mirror: trigger installed (every 10 minutes)');
}
