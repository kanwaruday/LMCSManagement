var GAME_MODULE_ACTIONS = GAME_MODULE_ACTIONS || {};
var GAME_MODULE_MISSIONS = GAME_MODULE_MISSIONS || {};
var GAME_MODULE_QUESTS = GAME_MODULE_QUESTS || {};

// Ask Buddy v1: the Owner types a question in the floating Buddy panel; a worker on the Mac (tools/buddy_worker.py) pulls it,
// answers with a read-only Claude run and posts the reply back. Plan: docs/superpowers/plans/2026-10-27-owner-kingdom.md
// (Task B1 and "Security design").
// Store: the append-only `Buddy Inbox` tab in the Game workbook. A thread's state is DERIVED from its rows (ask, claim, reply,
// failed, confirm, decline, fclaim, forward_failed, forwarded); nothing is ever edited or deleted.
// Nothing can block the queue for good:
//   - a claimed ask whose worker went quiet is re-offered once after staleClaimMs, then `failed` gave_up (at the next pull);
//     if the worker is gone altogether (no pull for staleClaimMs), the Owner's next ask closes it as `failed` offline first;
//   - a confirmed proposal (forward) is claimed (`fclaim`) when pulled, so asks are served while it is being sent; a
//     reported `forward_failed` or a stale fclaim counts one failure; after maxForwardAttempts its proposalState is
//     `failed` (terminal, proposalNote tells the Owner) and it is never offered again; so does one still unsent proposalMs
//     after the confirm;
//   - with the desk offline (no pull within deskMs), a new ask replaces the caller's unclaimed queued one (`failed` superseded).
// Gates:
//   buddyask / buddythread / buddyconfirm: POST only, a verified caller with the Owner role (game.gs doPost calls
//     buddyOwnerAction_ directly). Deliberately NOT in GAME_MODULE_ACTIONS, so a GET (whose text lands in logs and
//     history) answers "Unknown action".
//   buddypull / buddyreply: the Mac worker, no Google token. Gated by Script Property BUDDY_WORKER_SECRET (>= 32 chars,
//     separate from GAME_PUSH_SECRET), compared in constant time, sent in the POST body only. It grants nothing else.
// Every typed cell is appended as plain text under gameWithLock_ and never read as a formula (buddyCell_).
// Errors are { success:false, code, error } with a fixed sentence per code; a raw exception is console.error'd only.
// Cache keys: 'buddy_pending' says when a pull must open the workbook ('1' = now, a number = not before that time in ms;
// absent = nothing to do), 'buddy_hb' = the worker's last pull (ms), for the "Buddy is offline" line.
// Uses game.gs / game-actions.gs / game-confirm.gs globals (gameNow_, gameBook_, gameWithLock_, gameAppendText_,
// gameDayKey_, CQ_CAMPUSES) only inside function bodies: load order is not ours.
// ponytail: every pull that has work re-reads the whole tab under the script lock; archive old rows if it passes a few thousand.

var BUDDY_TAB = 'Buddy Inbox';
var BUDDY_HEADER = ['Id', 'Kind', 'Email', 'Text', 'Meta', 'At', 'By'];
var BUDDY_LIMITS = { inFlight: 1, perHour: 20, perDayAll: 100, maxText: 2000, maxReply: 8000, maxSummary: 300,
  proposalMs: 86400000, staleClaimMs: 1200000, maxAttempts: 2, deskMs: 120000, minSecret: 32, maxForwardAttempts: 3 };
var BUDDY_FORWARD_FAILED = "Buddy couldn't pass this on. Try again later or send it on Telegram."; // thread.proposalNote when proposalState is 'failed'
var BUDDY_CODES = { BUDDY_OWNER_ONLY: 'Ask Buddy is for the Owner for now.', BUDDY_EMPTY: 'Type a question first.',
  BUDDY_TOO_LONG: 'That is a bit long. Please keep it under 2000 characters.',
  BUDDY_IN_FLIGHT: 'Buddy is still on your last question. One at a time.',
  BUDDY_HOURLY: 'That is 20 questions this hour. Please wait a little.', BUDDY_DAILY: 'Buddy has answered a lot today. Please try tomorrow.',
  BUDDY_NOT_FOUND: 'That conversation is not here.', BUDDY_PROPOSAL_CLOSED: 'That request was already answered or has expired.',
  BUDDY_BAD_STATE: 'That reply does not fit.', BUDDY_BUSY_SERVER: 'The system was busy. Please try again.',
  BUDDY_ERROR: 'Something went wrong. Try again.' };
var BUDDY_CACHE_S = 21600; // CacheService maximum (6 h)
var BUDDY_HOUR_MS = 3600000;

function buddyErr_(code) { const e = new Error(BUDDY_CODES[code] || code); e.code = code; return e; }
function buddyFail_(err) {
  if (err && err.code && Object.prototype.hasOwnProperty.call(BUDDY_CODES, err.code)) return { success: false, code: err.code, error: BUDDY_CODES[err.code] };
  console.error('buddy error: ' + (err && err.message)); // a raw message may carry data, so it is logged, never returned
  return { success: false, code: 'BUDDY_ERROR', error: BUDDY_CODES.BUDDY_ERROR };
}
function buddyNewId_(nowMs) { return 'b' + nowMs + '-' + String(Utilities.getUuid()).replace(/-/g, '').slice(0, 8).toLowerCase(); }
function buddyIdOk_(id) { return typeof id === 'string' && /^b\d{13}-[0-9a-f]{8}$/.test(id); }

// Only a string counts as text (an object or number from a crafted body is treated as empty).
function buddyClean_(v, max, cut) {
  let s = (typeof v === 'string' ? v : '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').trim();
  if (!s) throw buddyErr_('BUDDY_EMPTY');
  if (s.length > max) {
    if (!cut) throw buddyErr_('BUDDY_TOO_LONG');
    s = s.slice(0, max - 1) + '…';
  }
  return s;
}
function buddyCell_(s) { s = String(s); return /^[=+\-@]/.test(s) ? "'" + s : s; }
function buddyUncell_(s) { s = String(s == null ? '' : s); return /^'[=+\-@]/.test(s) ? s.slice(1) : s; } // Sheets may or may not keep the quote

function buddyContext_(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  if (typeof raw.page === 'string' && /^[\w\-./]{1,80}$/.test(raw.page)) out.page = raw.page;
  if (typeof raw.campus === 'string' && CQ_CAMPUSES.indexOf(raw.campus) !== -1) out.campus = raw.campus;
  return out;
}

function buddyMs_(iso) { const n = Date.parse(String(iso || '')); return isFinite(n) ? n : 0; }
function buddyMeta_(s) { try { const m = JSON.parse(String(s || '')); return m && typeof m === 'object' ? m : {}; } catch (err) { return {}; } }

// rows incl. header -> { id: Thread }. Rows for an unknown id, or that do not fit the thread's state, are ignored.
function buddyThreads_(rows, nowMs) {
  const out = {};
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i], id = String(r[0] || ''), kind = String(r[1] || ''), at = String(r[5] || ''), meta = buddyMeta_(r[4]);
    if (kind === 'ask') {
      if (!buddyIdOk_(id) || out[id]) continue;
      out[id] = { id: id, email: String(r[2] || '').trim().toLowerCase(), text: buddyUncell_(r[3]), context: buddyContext_(meta.context), askedAt: at,
        state: 'queued', attempts: 0, claimedAt: null, reply: null, route: null, repliedAt: null, proposal: null, proposalState: null, failReason: null,
        fwdAttempts: 0, fwdClaimedAt: null, proposalNote: null, _decision: null, _decidedAt: null, _forwarded: false, _fwdFailed: false };
      continue;
    }
    const t = out[id];
    if (!t) continue;
    const open = t.state === 'queued' || t.state === 'working';
    if (kind === 'claim' && open) { t.state = 'working'; t.attempts++; t.claimedAt = at; }
    else if (kind === 'reply' && open) {
      t.state = 'answered'; t.reply = buddyUncell_(r[3]); t.route = typeof meta.route === 'string' ? meta.route : null; t.repliedAt = at;
      t.proposal = meta.proposal && typeof meta.proposal.summary === 'string' && meta.proposal.summary ? { summary: meta.proposal.summary } : null;
    } else if (kind === 'failed' && open) { t.state = 'failed'; t.failReason = typeof meta.reason === 'string' ? meta.reason : null; }
    else if ((kind === 'confirm' || kind === 'decline') && t.proposal && !t._decision) { t._decision = kind === 'confirm' ? 'confirmed' : 'declined'; t._decidedAt = at; }
    else if (kind === 'fclaim' && t._decision === 'confirmed' && !t._forwarded) { t.fwdAttempts++; t.fwdClaimedAt = at; t._fwdFailed = false; }
    else if (kind === 'forward_failed' && t._decision === 'confirmed' && !t._fwdFailed) t._fwdFailed = true;
    else if (kind === 'forwarded' && t.proposal) t._forwarded = true;
  }
  Object.keys(out).forEach(function (id) {
    const t = out[id];
    if (t.proposal) {
      t.proposalState = t._forwarded ? 'forwarded' : t._decision ? t._decision : (nowMs - buddyMs_(t.repliedAt) > BUDDY_LIMITS.proposalMs ? 'expired' : 'open');
      if (t.proposalState === 'confirmed' && ((t.fwdAttempts >= BUDDY_LIMITS.maxForwardAttempts && (t._fwdFailed || buddyFwdStale_(t, nowMs))) ||
          nowMs - buddyMs_(t._decidedAt) > BUDDY_LIMITS.proposalMs)) { // 3 failures, or still unsent proposalMs after the confirm
        t.proposalState = 'failed'; t.proposalNote = BUDDY_FORWARD_FAILED;
      }
    }
  });
  return out;
}

function buddyList_(threads) { // oldest first (row order is time order; askedAt breaks nothing)
  return Object.keys(threads).map(function (k) { return threads[k]; }).sort(function (a, b) { return buddyMs_(a.askedAt) - buddyMs_(b.askedAt); });
}

function buddyRateCheck_(threads, email, nowMs) {
  const me = String(email || '').toLowerCase(), today = gameDayKey_(new Date(nowMs)), all = buddyList_(threads);
  const mine = all.filter(function (t) { return t.email === me; });
  if (mine.filter(function (t) { return t.state === 'queued' || t.state === 'working'; }).length >= BUDDY_LIMITS.inFlight) return 'BUDDY_IN_FLIGHT';
  if (mine.filter(function (t) { return nowMs - buddyMs_(t.askedAt) < BUDDY_HOUR_MS; }).length >= BUDDY_LIMITS.perHour) return 'BUDDY_HOURLY';
  if (all.filter(function (t) { return gameDayKey_(new Date(buddyMs_(t.askedAt))) === today; }).length >= BUDDY_LIMITS.perDayAll) return 'BUDDY_DAILY';
  return null;
}

function buddyStale_(t, nowMs) { return t.state === 'working' && nowMs - buddyMs_(t.claimedAt) > BUDDY_LIMITS.staleClaimMs; }
// a forward being sent: claimed, not reported failed, not done
function buddyFwdBusy_(t) { return t.fwdAttempts > 0 && !t._fwdFailed && !t._forwarded; }
function buddyFwdStale_(t, nowMs) { return buddyFwdBusy_(t) && nowMs - buddyMs_(t.fwdClaimedAt) > BUDDY_LIMITS.staleClaimMs; }

// Next work for the worker: a confirmed proposal not yet forwarded and not being sent (oldest confirm first), else the oldest
// queued ask, else a stale claim with attempts left. Pure. ('failed' proposals are never offered: buddyThreads_ sets it at
// maxForwardAttempts.)
function buddyPullable_(threads, nowMs) {
  const all = buddyList_(threads);
  const fwd = all.filter(function (t) { return t.proposalState === 'confirmed' && (!buddyFwdBusy_(t) || buddyFwdStale_(t, nowMs)); })
    .sort(function (a, b) { return buddyMs_(a._decidedAt) - buddyMs_(b._decidedAt); })[0];
  if (fwd) return { id: fwd.id, kind: 'forward', text: fwd.text, summary: fwd.proposal.summary, attempt: fwd.fwdAttempts + 1 };
  const t = all.filter(function (x) { return x.state === 'queued'; })[0] ||
    all.filter(function (x) { return buddyStale_(x, nowMs) && x.attempts < BUDDY_LIMITS.maxAttempts; })[0];
  return t ? { id: t.id, kind: 'ask', text: t.text, context: t.context, attempt: t.attempts + 1 } : null;
}

// Trimmed both sides (a pasted property often carries a newline); every character is compared, so the time does not say where they differ.
function buddySecretOk_(given) {
  const secret = String(PropertiesService.getScriptProperties().getProperty('BUDDY_WORKER_SECRET') || '').trim();
  const g = typeof given === 'string' ? given.trim() : '';
  if (secret.length < BUDDY_LIMITS.minSecret) return false; // missing or too short: refuse every worker call
  let diff = secret.length ^ g.length;
  for (let i = 0; i < Math.max(secret.length, g.length); i++) diff |= (secret.charCodeAt(i) || 0) ^ (g.charCodeAt(i) || 0);
  return diff === 0;
}

function buddyDesk_(nowMs) {
  const hb = CacheService.getScriptCache().get('buddy_hb'), n = Number(hb);
  if (!hb || !isFinite(n)) return { open: false, seenAt: null };
  return { open: nowMs - n <= BUDDY_LIMITS.deskMs, seenAt: new Date(n).toISOString() };
}

// gameWithLock_, with a lock timeout turned into BUDDY_BUSY_SERVER (an error inside fn passes through unchanged).
function buddyLocked_(fn) {
  let entered = false;
  try {
    return gameWithLock_(function () { entered = true; return fn(); });
  } catch (err) {
    if (!entered) throw buddyErr_('BUDDY_BUSY_SERVER');
    throw err;
  }
}
function buddySheet_(create) {
  const ss = gameBook_();
  let sh = ss.getSheetByName(BUDDY_TAB);
  if (!sh && create) { sh = ss.insertSheet(BUDDY_TAB); gameAppendText_(sh, [BUDDY_HEADER]); }
  return sh;
}
function buddyRows_(sh) { return sh ? sh.getDataRange().getValues() : [BUDDY_HEADER]; }
function buddyMark_() { CacheService.getScriptCache().put('buddy_pending', '1', BUDDY_CACHE_S); }

// ── Owner actions (verified caller) ──────────────────────────────────
// Ask Buddy v1 is hard-gated to ONE person: the Owner role AND the verified email equal to Script Property BUDDY_OWNER_EMAIL
// (case-insensitive). Forwards go to the master agent labelled as Uday's own words and answers read his vault, so another
// allowlist row with the Owner role is not enough. Property missing = everyone refused (fail closed). No email in the repo.
// Phase 3 adds `buddy.staffAsk` behind its own review.
function buddyOwnerAction_(caller, action, body) {
  try {
    if (!caller || !Array.isArray(caller.roles) || caller.roles.indexOf('Owner') === -1) throw buddyErr_('BUDDY_OWNER_ONLY');
    const owner = String(PropertiesService.getScriptProperties().getProperty('BUDDY_OWNER_EMAIL') || '').trim().toLowerCase();
    if (!owner || String(caller.email || '').trim().toLowerCase() !== owner) throw buddyErr_('BUDDY_OWNER_ONLY');
    body = body || {};
    if (action === 'buddyask') return buddyAsk_(caller, body);
    if (action === 'buddythread') return buddyThread_(caller);
    if (action === 'buddyconfirm') return buddyConfirm_(caller, body);
    throw buddyErr_('BUDDY_ERROR');
  } catch (err) { return buddyFail_(err); }
}

function buddyAsk_(caller, body) {
  const text = buddyClean_(body.text, BUDDY_LIMITS.maxText, false), context = buddyContext_(body.context);
  const email = String(caller.email).toLowerCase(), nowMs = gameNow_().getTime(), nowIso = new Date(nowMs).toISOString();
  const id = buddyLocked_(function () {
    const sh = buddySheet_(true), threads = buddyThreads_(buddyRows_(sh), nowMs);
    // The worker is gone (no pull for staleClaimMs, so no pull will re-offer it): close the caller's stuck claim as offline,
    // so the one-at-a-time rule cannot block them forever. With a live worker the pull handles stale claims itself.
    // staleClaimMs, not less: a live worker does not poll while one answer runs (claude timeout 15 min).
    const hb = Number(CacheService.getScriptCache().get('buddy_hb')), gone = !(nowMs - hb <= BUDDY_LIMITS.staleClaimMs);
    // Desk offline (no pull within deskMs): the caller's unclaimed queued ask is replaced by the new one ('superseded').
    const offline = !(nowMs - hb <= BUDDY_LIMITS.deskMs), close = [];
    Object.keys(threads).forEach(function (k) {
      const t = threads[k];
      if (t.email !== email) return;
      const reason = gone && buddyStale_(t, nowMs) ? 'offline' : offline && t.state === 'queued' ? 'superseded' : '';
      if (!reason) return;
      t.state = 'failed'; t.failReason = reason;
      close.push([t.id, 'failed', '', '', JSON.stringify({ reason: reason }), nowIso, 'system']);
    });
    gameAppendText_(sh, close);
    const code = buddyRateCheck_(threads, email, nowMs);
    if (code) throw buddyErr_(code);
    const newId = buddyNewId_(nowMs);
    gameAppendText_(sh, [[newId, 'ask', email, buddyCell_(text), JSON.stringify({ context: context }), nowIso, email]]);
    buddyMark_();
    return newId;
  });
  return { success: true, id: id, state: 'queued', desk: buddyDesk_(nowMs) };
}

function buddyPublic_(t) {
  const o = {};
  ['id', 'text', 'context', 'askedAt', 'state', 'attempts', 'claimedAt', 'reply', 'route', 'repliedAt', 'proposal', 'proposalState', 'proposalNote', 'failReason']
    .forEach(function (k) { o[k] = t[k]; });
  return o;
}

// A pure read: no lock, no write.
function buddyThread_(caller) {
  const email = String(caller.email).toLowerCase(), nowMs = gameNow_().getTime();
  const mine = buddyList_(buddyThreads_(buddyRows_(buddySheet_(false)), nowMs)).filter(function (t) { return t.email === email; });
  return { success: true, threads: mine.slice(-20).map(buddyPublic_), desk: buddyDesk_(nowMs) };
}

function buddyConfirm_(caller, body) {
  const id = body.id, decision = body.decision, email = String(caller.email).toLowerCase();
  if (!buddyIdOk_(id)) throw buddyErr_('BUDDY_NOT_FOUND');
  if (decision !== 'confirm' && decision !== 'decline') throw buddyErr_('BUDDY_BAD_STATE');
  const nowMs = gameNow_().getTime(), nowIso = new Date(nowMs).toISOString();
  return buddyLocked_(function () {
    const sh = buddySheet_(false), t = buddyThreads_(buddyRows_(sh), nowMs)[id];
    if (!t || t.email !== email) throw buddyErr_('BUDDY_NOT_FOUND');
    if (t.proposalState !== 'open') throw buddyErr_('BUDDY_PROPOSAL_CLOSED');
    gameAppendText_(sh, [[id, decision, email, '', '{}', nowIso, email]]);
    if (decision === 'confirm') buddyMark_();
    return { success: true, proposalState: decision === 'confirm' ? 'confirmed' : 'declined' };
  });
}

// ── Worker actions (shared secret, no Google token) ──────────────────
// The workbook is opened only when 'buddy_pending' says so, or when the worker has just come back (no heartbeat within
// deskMs: Mac asleep or worker stopped). The second case catches a flag that expired (6 h) or was evicted meanwhile.
function buddyPull_(body) {
  if (!buddySecretOk_(body && body.secret)) return { success: false, error: 'Not authorized' };
  try {
    const cache = CacheService.getScriptCache(), nowMs = gameNow_().getTime(), nowIso = new Date(nowMs).toISOString();
    const prevHb = Number(cache.get('buddy_hb'));
    cache.put('buddy_hb', String(nowMs), BUDDY_CACHE_S);
    const flag = cache.get('buddy_pending'), back = !(nowMs - prevHb <= BUDDY_LIMITS.deskMs); // NaN (no heartbeat) -> back
    if (!back && (flag === null || flag === undefined || (flag !== '1' && nowMs < Number(flag)))) return { success: true, items: [] };
    return buddyLocked_(function () {
      const sh = buddySheet_(false);
      if (!sh) { cache.remove('buddy_pending'); return { success: true, items: [] }; }
      const threads = buddyThreads_(buddyRows_(sh), nowMs), out = [];
      Object.keys(threads).forEach(function (id) { // a stale claim with no attempts left: give up
        const t = threads[id];
        if (buddyStale_(t, nowMs) && t.attempts >= BUDDY_LIMITS.maxAttempts) {
          out.push([id, 'failed', '', '', JSON.stringify({ reason: 'gave_up' }), nowIso, 'worker']);
          t.state = 'failed'; t.failReason = 'gave_up';
        }
        if (t.proposalState === 'failed' && !t._fwdFailed) { // last forward attempt went stale, or the confirm expired: record it
          const why = t.fwdAttempts >= BUDDY_LIMITS.maxForwardAttempts ? 'gave_up' : 'expired';
          out.push([id, 'forward_failed', '', '', JSON.stringify({ reason: why }), nowIso, 'worker']);
          t._fwdFailed = true;
        }
      });
      const item = buddyPullable_(threads, nowMs);
      if (item && item.kind === 'ask') {
        out.push([item.id, 'claim', '', '', JSON.stringify({ attempt: item.attempt }), nowIso, 'worker']);
        const t = threads[item.id]; t.state = 'working'; t.attempts = item.attempt; t.claimedAt = nowIso;
      } else if (item) {
        out.push([item.id, 'fclaim', '', '', JSON.stringify({ attempt: item.attempt }), nowIso, 'worker']);
        const t = threads[item.id]; t.fwdAttempts = item.attempt; t.fwdClaimedAt = nowIso; t._fwdFailed = false;
      }
      gameAppendText_(sh, out);
      // Next flag: '1' while more work waits; else wake at the earliest moment a claim goes stale; else nothing to do.
      const wake = Object.keys(threads).map(function (k) { return threads[k]; }).reduce(function (m, t) {
        if (t.state === 'working') m = Math.min(m, buddyMs_(t.claimedAt) + BUDDY_LIMITS.staleClaimMs + 1);
        if (t.proposalState === 'confirmed' && buddyFwdBusy_(t)) m = Math.min(m, buddyMs_(t.fwdClaimedAt) + BUDDY_LIMITS.staleClaimMs + 1);
        return m;
      }, Infinity);
      if (buddyPullable_(threads, nowMs)) cache.put('buddy_pending', '1', BUDDY_CACHE_S);
      else if (wake < Infinity) cache.put('buddy_pending', String(wake), BUDDY_CACHE_S);
      else cache.remove('buddy_pending');
      return { success: true, items: item ? [item] : [] };
    });
  } catch (err) { return buddyFail_(err); }
}

function buddyReply_(body) {
  if (!buddySecretOk_(body && body.secret)) return { success: false, error: 'Not authorized' };
  try {
    const id = body.id, kind = body.kind;
    if (!buddyIdOk_(id)) throw buddyErr_('BUDDY_NOT_FOUND');
    let text = '', meta;
    if (kind === 'reply') {
      text = buddyClean_(body.text, BUDDY_LIMITS.maxReply, true);
      if (body.route !== 'claude') throw buddyErr_('BUDDY_BAD_STATE');
      const p = body.proposal, s = p && typeof p === 'object' && typeof p.summary === 'string' ? p.summary : '';
      let summary = null;
      if (s.trim()) summary = buddyClean_(s.replace(/\n/g, ' '), BUDDY_LIMITS.maxSummary, true);
      meta = { route: 'claude', proposal: summary ? { summary: summary } : null };
    } else if (kind === 'failed') {
      if (['timeout', 'claude_error', 'gave_up'].indexOf(body.reason) === -1) throw buddyErr_('BUDDY_BAD_STATE');
      meta = { reason: body.reason };
    } else if (kind === 'forward_failed') {
      meta = { reason: 'send_error' }; // the worker's own error text stays in its local log
    } else if (kind === 'forwarded') {
      if (['sendmessage', 'telegram'].indexOf(body.via) === -1) throw buddyErr_('BUDDY_BAD_STATE');
      meta = { via: body.via };
    } else throw buddyErr_('BUDDY_BAD_STATE');
    const nowMs = gameNow_().getTime(), nowIso = new Date(nowMs).toISOString();
    return buddyLocked_(function () {
      const sh = buddySheet_(false), t = buddyThreads_(buddyRows_(sh), nowMs)[id];
      if (!t) throw buddyErr_('BUDDY_NOT_FOUND');
      const ok = kind === 'forwarded' ? t.proposalState === 'confirmed'
        : kind === 'forward_failed' ? t.proposalState === 'confirmed' && buddyFwdBusy_(t)
        : t.state === 'working';
      if (!ok) throw buddyErr_('BUDDY_BAD_STATE');
      gameAppendText_(sh, [[id, kind, '', text ? buddyCell_(text) : '', JSON.stringify(meta), nowIso, 'worker']]);
      if (kind === 'forward_failed') buddyMark_(); // retry (or settle as failed) at the next poll
      return { success: true };
    });
  } catch (err) { return buddyFail_(err); }
}
