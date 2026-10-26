// Shared episode engine: one file, deployed to BOTH the LMCS Game Backend (Teacher chapter quest) and the
// Owner Backend (academics). Neither forks it. Pure functions over the CW/HW feed (cwRecords): no I/O.
// Episode = a teacher's entries on one chapter, from the first through the first CWA. Later entries are post-CWA.
// An entry with more than maxEntryTags tags still counts for periods and tags, but is never a CWA marker and
// never remediation evidence. Names are prefixed ownAcad/acadRem and use var, so they cannot clash in a project.

var OWN_ACAD_TAGS = ['Chapter Teaching', 'Question & Answers', 'New Words', 'Activity', 'CWA', 'Remediation', 'OTT', 'RT', 'Laboratory', 'Field Trip'];
var OWN_ACAD_CODES = 'TQNACROVLF'; // one code per canonical tag, in order; '?' = Other
var OWN_ACAD_DAY_MS = 86400000;

// Deliberately differs from chapterNormalizeName in ChapterTracker.gs: that one strips everything outside [a-z0-9],
// which blanks every non-Latin chapter name (all Devanagari collapses to '' and unrelated Hindi/Sanskrit chapters
// collide or get dropped). Here letters, combining marks (Devanagari vowel signs, virama) and digits of any script
// are kept; each run of anything else becomes one space. So 'Light' -> 'light', 'The Lost-Child!' -> 'the lost child'.
function ownAcadNormChapter_(s) {
  return String(s || '').normalize('NFC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim();
}

// "Activity, cwa" -> ['Activity','CWA']: canonical names, anything unknown -> 'Other', once per tag
function ownAcadTags_(cwTag) {
  var out = [];
  String(cwTag || '').split(/[,;]/).forEach(function (t) {
    t = t.trim().toLowerCase();
    if (!t) return;
    var i = OWN_ACAD_TAGS.map(function (c) { return c.toLowerCase(); }).indexOf(t);
    var tag = i < 0 ? 'Other' : OWN_ACAD_TAGS[i];
    if (out.indexOf(tag) < 0) out.push(tag);
  });
  return out;
}

function ownAcadRules_(rules) {
  rules = rules || {};
  return {
    remWindowDays: rules.remWindowDays || 14,
    maxEntryTags: rules.maxEntryTags || 6,
    minEpisodePeriods: rules.minEpisodePeriods || 3,
    includeMClasses: rules.includeMClasses === true, // Montessori classes are skipped unless a caller (the Teacher index) asks for them
    noCwaGapDays: rules.noCwaGapDays || 21,
    exempt: rules.exemptSubjects || ['general knowledge', 'computer']
  };
}

function ownAcadExempt_(subject, exempt) {
  var sl = String(subject || '').toLowerCase();
  return exempt.some(function (e) { return sl === e || sl.indexOf(e) >= 0 || e.indexOf(sl) >= 0; });
}

// group entries by key, each group sorted by time; entries carry tags and the marker flags
function ownAcadGroup_(records, R, keyOf) {
  var groups = {};
  (records || []).forEach(function (r) {
    var k = keyOf(r);
    if (k === null) return;
    var tags = ownAcadTags_(r.cwTag), many = tags.length > R.maxEntryTags;
    (groups[k] = groups[k] || []).push({
      r: r, t: Number(r.timeMs), tags: tags,
      cwa: !many && tags.indexOf('CWA') >= 0,
      rem: !many && tags.indexOf('Remediation') >= 0
    });
  });
  Object.keys(groups).forEach(function (k) { groups[k].sort(function (a, b) { return a.t - b.t; }); });
  return groups;
}

// first Remediation marker with 0 < dt <= window after the CWA, or null
function ownAcadRemAfter_(entries, cwaT, R) {
  for (var i = 0; i < entries.length; i++) {
    var dt = entries[i].t - cwaT;
    if (entries[i].rem && dt > 0 && dt <= R.remWindowDays * OWN_ACAD_DAY_MS) return entries[i].t;
  }
  return null;
}

function ownAcadCount_(entries) {
  var tags = {};
  entries.forEach(function (e) { e.tags.forEach(function (t) { tags[t] = (tags[t] || 0) + 1; }); });
  return tags;
}

// -> [{key:{g,cls,subj,ch,lms,teacher}, periods, tags:{tag:n}, hw, first, last, cwa, seq, postCwa:{periods,tags},
//      remediationWithin}]. cwa / remediationWithin are timeMs or null. seq = one code string per entry.
// bookGroupOf(record) is optional (Owner only); g defaults to ''.
function ownAcadEpisodes_(records, rules, bookGroupOf) {
  var R = ownAcadRules_(rules), SEP = '\u0001';
  var groups = ownAcadGroup_(records, R, function (r) {
    var ch = ownAcadNormChapter_(r.cwChapter);
    if (!ch) return null;
    var g = bookGroupOf ? String(bookGroupOf(r) || '') : '';
    return [g, r.lmsIdx, r.classMapped, String(r.subject || '').trim().toLowerCase(), String(r.teacher || '').trim().toLowerCase(), ch].join(SEP);
  });
  var out = [];
  Object.keys(groups).forEach(function (k) {
    var all = groups[k], p = k.split(SEP), f = all[0].r;
    if ((!R.includeMClasses && /^m-/i.test(String(f.classMapped || '').trim())) || ownAcadExempt_(f.subject, R.exempt)) return;
    var ci = -1;
    for (var i = 0; i < all.length; i++) if (all[i].cwa) { ci = i; break; }
    var ep = ci < 0 ? all : all.slice(0, ci + 1), post = ci < 0 ? [] : all.slice(ci + 1);
    if (ep.length < R.minEpisodePeriods) return;
    out.push({
      key: { g: p[0], cls: f.classMapped, subj: String(f.subject || '').trim(), ch: p[5], lms: f.lmsIdx, teacher: p[4] },
      periods: ep.length,
      tags: ownAcadCount_(ep),
      hw: ep.filter(function (e) { return String(e.r.hwDesc || '').trim() || String(e.r.hwTag || '').trim(); }).length,
      first: ep[0].t,
      last: ep[ep.length - 1].t,
      cwa: ci < 0 ? null : all[ci].t,
      seq: ep.map(function (e) {
        return e.tags.length ? e.tags.map(function (t) { var i = OWN_ACAD_TAGS.indexOf(t); return i < 0 ? '?' : OWN_ACAD_CODES.charAt(i); }).join('') : '?';
      }),
      postCwa: { periods: post.length, tags: ownAcadCount_(post) },
      remediationWithin: ci < 0 ? null : ownAcadRemAfter_(post, all[ci].t, R)
    });
  });
  return out;
}

// Marks e.noCwa on every no-CWA episode: true once the same teacher-class-subject has entries of other chapters
// at least noCwaGapDays after this episode's last entry (an episode holds every entry of its chapter up to the CWA,
// so none of this chapter can sit in between). episodesByTcs = {tcs: episode[]} or a flat episode[]. Returns the closed ones.
function ownAcadNoCwa_(episodesByTcs, rules) {
  var R = ownAcadRules_(rules), gap = R.noCwaGapDays * OWN_ACAD_DAY_MS, by = episodesByTcs;
  if (Array.isArray(by)) {
    by = {};
    episodesByTcs.forEach(function (e) {
      var k = [e.key.lms, e.key.cls, e.key.subj.toLowerCase(), e.key.teacher].join('|');
      (by[k] = by[k] || []).push(e);
    });
  }
  var closed = [];
  Object.keys(by).forEach(function (k) {
    by[k].forEach(function (e) {
      e.noCwa = e.cwa === null && by[k].some(function (o) { return o !== e && o.key.ch !== e.key.ch && o.last - e.last >= gap; });
      if (e.noCwa) closed.push(e);
    });
  });
  return closed;
}

// The entry-level count behind the baseline: every CWA entry (<= maxEntryTags tags) counts, none is filtered out
// (M classes, exempt subjects, thin episodes all stay). Remediated = a later Remediation entry (<= maxEntryTags tags,
// 0 < dt <= remWindowDays) by the same teacher in the same lmsIdx/class/subject, on the same chapter.
// Chapters compare lowercased and trimmed, exactly as the baseline reference does.
function acadRemediatedCwaEntries_(records, rules) {
  var R = ownAcadRules_(rules), cwas = 0, remediated = 0;
  var groups = ownAcadGroup_(records, R, function (r) {
    return [String(r.teacher || '').trim().toLowerCase(), r.lmsIdx, r.classMapped, r.subject].join('\u0001');
  });
  var ch = function (e) { return String(e.r.cwChapter || '').trim().toLowerCase(); };
  Object.keys(groups).forEach(function (k) {
    var g = groups[k]; // entries over maxEntryTags are never cwa/rem, so they cannot match
    g.forEach(function (c) {
      if (!c.cwa) return;
      cwas++;
      if (g.some(function (y) { return y.rem && y.t > c.t && y.t - c.t <= R.remWindowDays * OWN_ACAD_DAY_MS && ch(y) === ch(c); })) remediated++;
    });
  });
  return { cwas: cwas, remediated: remediated };
}
