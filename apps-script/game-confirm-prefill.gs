var CQ_PREFILL = CQ_PREFILL || {};

// Pre-fill adapters for setup quests: each returns [{ item, fields }] of values we already hold, or null when the source is
// unavailable. Public feeds only (roster, timetable) plus the principal allowlist; personal data (bank, phone, Aadhaar, PAN,
// address) is never read here. Symbols from other files are used inside function bodies only.
// ponytail: whole feeds are fetched once and sliced into the script cache (30 min / 6 h); adapters never fetch when opts.cacheOnly.

var CQ_ROSTER_TTL_S = 1800, CQ_TT_TTL_S = 21600, CQ_PUT_CHUNK = 20;

function cqSlug_(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 24); }

// '9:20' -> '09:20'; '01:15' -> '13:15'; bad -> ''
// ponytail: 12-hour times without am/pm read as a 07:00–18:59 school day; a 7 pm event would read wrong. Store am/pm in the timetable extractor if that ever matters.
function cqClock_(s) {
  const m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(String(s == null ? '' : s));
  if (!m) return '';
  let h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return '';
  if (h >= 1 && h <= 6) h += 12;
  return (h < 10 ? '0' : '') + h + ':' + m[2];
}

function cqCacheJson_(cache, key) {
  const v = cache.get(key);
  if (!v) return null;
  try { return JSON.parse(v); } catch (err) { return null; }
}

function cqPutAll_(cache, map, ttl) {
  const keys = Object.keys(map);
  for (let i = 0; i < keys.length; i += CQ_PUT_CHUNK) {
    const chunk = {};
    keys.slice(i, i + CQ_PUT_CHUNK).forEach(function (k) { chunk[k] = JSON.stringify(map[k]); });
    cache.putAll(chunk, ttl);
  }
}

function cqFetchJson_(url) {
  try {
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return null;
    const j = JSON.parse(res.getContentText());
    return j && typeof j === 'object' && j.success !== false ? j : null;
  } catch (err) { return null; }
}

// ── roster ───────────────────────────────────────────────────────────
function cqRosterRows_(code, cacheOnly) {
  const cache = CacheService.getScriptCache();
  const hit = cqCacheJson_(cache, 'cq_acad_' + code);
  if (hit) return hit;
  if (cacheOnly) return null;
  if (cache.get('cq_acad_built')) return [];
  const j = cqFetchJson_(TCH_ROSTER_URL + '?action=roster');
  if (!j || !Array.isArray(j.rows)) return null;
  const by = {};
  j.rows.forEach(function (r) {
    const c = String((r && r.employeeCode) || '').trim();
    if (!c) return;
    (by[c] = by[c] || []).push({ class: String(r.class || '').trim(), subject: String(r.subject || '').trim() });
  });
  const put = {};
  Object.keys(by).forEach(function (c) { put['cq_acad_' + c] = by[c]; });
  cqPutAll_(cache, put, CQ_ROSTER_TTL_S);
  cache.put('cq_acad_built', '1', CQ_ROSTER_TTL_S);
  return by[code] || [];
}

function cqPrefillMyClasses_(ctx, opts) {
  const code = tchCodeFor_(ctx.caller);
  if (!code) return [];
  const rows = cqRosterRows_(code, !!(opts && opts.cacheOnly));
  if (!rows) return null;
  const seen = {}, out = [];
  rows.forEach(function (r) {
    const item = 'c-' + cqSlug_(r.class) + '-' + cqSlug_(r.subject);
    if (seen[item]) return;
    seen[item] = true;
    out.push({ item: item, fields: { class: r.class, subject: r.subject } });
  });
  return out;
}

// ── timetable ────────────────────────────────────────────────────────
function cqTimetable_(cacheOnly) {
  const cache = CacheService.getScriptCache();
  if (cache.get('cq_tt_built')) return true;
  if (cacheOnly) return false;
  const j = cqFetchJson_(TCH_TIMETABLE_URL);
  if (!j) return false;
  const put = {}, sched = j.campusPeriodSchedule || {}, camps = j.campuses || {};
  Object.keys(sched).forEach(function (c) { put['cq_tt_bells_' + c] = sched[c]; });
  Object.keys(camps).forEach(function (c) {
    const names = {};
    Object.keys(camps[c] || {}).forEach(function (code) {
      const periods = (camps[c][code] && camps[c][code].periods) || [];
      const mine = [];
      periods.forEach(function (p) {
        if (p.class) names[p.class] = true;
        if (p.free) return;
        mine.push({ day: p.day, period: p.period, class: p.class || '', subject: p.subject || '', start: p.start, end: p.end });
      });
      put['cq_tt_code_' + code] = mine;
    });
    put['cq_tt_classes_' + c] = Object.keys(names);
  });
  cqPutAll_(cache, put, CQ_TT_TTL_S);
  cache.put('cq_tt_built', '1', CQ_TT_TTL_S);
  return true;
}

// the cached slice for key, [] when the timetable is built but has none, null when it is not built
function cqTtSlice_(key, cacheOnly) {
  if (!cqTimetable_(cacheOnly)) return null;
  return cqCacheJson_(CacheService.getScriptCache(), key) || [];
}

function cqCampusKey_(ctx) { return String((ctx && ctx.campus) || '').replace(/[^A-Za-z0-9]/g, ''); }

function cqPrefillBells_(ctx, opts) {
  const c = cqCampusKey_(ctx);
  if (!c) return [];
  const rows = cqTtSlice_('cq_tt_bells_' + c, !!(opts && opts.cacheOnly));
  if (!rows) return null;
  return rows.map(function (b) {
    return { item: 'p' + b.period, fields: { period: String(b.period), start: cqClock_(b.start), end: cqClock_(b.end) } };
  });
}

function cqFirstNumber_(s) { const m = /\d+/.exec(String(s)); return m ? Number(m[0]) : Infinity; }

function cqPrefillClasses_(ctx, opts) {
  const c = cqCampusKey_(ctx);
  if (!c) return [];
  const names = cqTtSlice_('cq_tt_classes_' + c, !!(opts && opts.cacheOnly));
  if (!names) return null;
  return names.filter(Boolean).sort(function (a, b) {
    const x = cqFirstNumber_(a), y = cqFirstNumber_(b);
    return x === y ? (a < b ? -1 : a > b ? 1 : 0) : (x < y ? -1 : 1);
  }).map(function (n) { return { item: 'k-' + cqSlug_(n), fields: { class: n } }; });
}

function cqPrefillMyPeriods_(ctx, opts) {
  const code = tchCodeFor_(ctx.caller);
  if (!code) return [];
  const rows = cqTtSlice_('cq_tt_code_' + code, !!(opts && opts.cacheOnly));
  if (!rows) return null;
  return rows.map(function (p) {
    return { item: String(p.day).toLowerCase() + '-' + p.period, fields: { day: p.day, period: String(p.period), class: p.class, subject: p.subject, start: cqClock_(p.start), end: cqClock_(p.end) } };
  });
}

// ── allowlist ────────────────────────────────────────────────────────
function cqPrefillAllowlist_(ctx, opts) {
  const rows = SpreadsheetApp.openById(GAME_ALLOWLIST_SHEET_ID).getSheets()[0].getDataRange().getValues();
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const email = String(rows[i][0] || '').trim().toLowerCase();
    if (!email) continue;
    const campus = String(rows[i][2] || '').trim().toUpperCase();
    if (ctx.campus && campus !== ctx.campus) continue;
    const roles = String(rows[i][3] || '').split(',').map(function (r) { return r.trim(); }).filter(Boolean).join(', ');
    out.push({ item: 'a-' + cqSlug_(email), fields: { name: String(rows[i][1] || '').trim(), email: email, campus: campus, roles: roles } });
  }
  return out;
}

// ── registration (this file's own functions only) ────────────────────
CQ_PREFILL['roster.myClasses'] = cqPrefillMyClasses_;
CQ_PREFILL['timetable.myPeriods'] = cqPrefillMyPeriods_;
CQ_PREFILL['timetable.bells'] = cqPrefillBells_;
CQ_PREFILL['timetable.classes'] = cqPrefillClasses_;
CQ_PREFILL['allowlist.people'] = cqPrefillAllowlist_;
