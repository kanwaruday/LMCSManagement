/* Transport: what each vehicle needs done, and in what order. Pure functions (no DOM, no network) so the rules are unit-tested
   (tests/transport/test-rank.js) and the page only renders what this returns.

   Per paper (one cell):
     expired / soon (<=30 days) / later (<=90 days) / ok   by the date on file
     check     a scan is on file but its date could not be read
     wrong     the only upload is the wrong paper (a refusal letter, an initial compliance certificate...)
     missing   nothing on file
     noexp     the right paper, but it prints no expiry
     onfile    speed governor only: a one-time fitment certificate, it never expires, so any proof on file is enough
     na        marked not needed in the overrides note
     pending   a new paper was uploaded from a portal and the AI Coordinator has not read it yet (not open work)
   `bad` is separate: the proof behind a typed date is itself the wrong paper (e.g. a blank fitness form attached to a form entry).

   Per vehicle, one tier, most urgent first:
     none      no valid proof of any paper at all: the biggest red flag
     expired   a paper has expired
     wrong     an upload is the wrong paper
     missing   a paper is not on file
     check     a scan is on file but unreadable
     soon      something is due within 30 days
     later     something is due within 90 days
     pending   nothing to do but papers uploaded and waiting to be read
     ok        nothing to do
     eol       past its service life as a bus: always last, never counted as work */
(function (root) {
  const ORDER = ['insurance', 'fitness', 'route_permit', 'mv_tax', 'pollution', 'speed_governor']; // the papers that make a bus illegal to run first
  const LEGAL = ['insurance', 'fitness', 'route_permit', 'mv_tax'];
  const ONE_TIME = ['speed_governor'];
  const TIERS = ['none', 'expired', 'wrong', 'missing', 'check', 'soon', 'later', 'pending', 'ok', 'eol'];
  const KINDS = ['expired', 'wrong', 'missing', 'check', 'soon', 'later'];
  const VERB = { expired: 'Renew', wrong: 'Replace the wrong paper', missing: 'Upload', check: 'Read the date off the scan', soon: 'Renew soon', later: 'Plan the renewal' };

  const fid = (u) => (String(u || '').match(/[-\w]{25,}/) || [''])[0]; // Drive file id from either link style
  const dayNo = (iso) => Math.round(Date.parse(iso + 'T00:00:00Z') / 86400000);

  function cellState(e, key, today) {
    const nx = e.noexp || [], ot = e.other || [], un = e.unread || [];
    const bad = ot.length > 0 && (!e.date ? !nx.length && !un.length : ot.some((o) => fid(o.link) === fid(e.link)));
    let t, n = null;
    if (e.na) t = 'na';
    else if (e.pending) t = 'pending';
    else if (ONE_TIME.indexOf(key) >= 0) t = e.date || nx.length || un.length ? 'onfile' : bad ? 'wrong' : 'missing';
    else if (e.date) { n = dayNo(e.date) - dayNo(today); t = n < 0 ? 'expired' : n <= 30 ? 'soon' : n <= 90 ? 'later' : 'ok'; }
    else t = nx.length ? 'noexp' : un.length ? 'check' : bad ? 'wrong' : 'missing';
    return { t: t, bad: bad, n: n };
  }

  function analyse(fleet, docs, today) {
    const have = docs.map((x) => x.key);
    const keys = ORDER.filter((k) => have.indexOf(k) >= 0).concat(have.filter((k) => ORDER.indexOf(k) < 0));
    const label = (k) => docs.find((x) => x.key === k).label;
    const items = [];
    const vehicles = fleet.map((b) => {
      const cells = {}, act = {};
      KINDS.forEach((k) => { act[k] = []; });
      const waiting = [];
      let score = 0, oldest = null, blank = true;
      keys.forEach((k) => {
        const c = cells[k] = cellState(b.docs[k], k, today);
        if (c.t !== 'missing' && c.t !== 'wrong') blank = false;
        if (c.t === 'pending') waiting.push(k);
        const kind = c.t === 'expired' ? 'expired' : c.t === 'wrong' || c.bad ? 'wrong' : c.t;
        if (!act[kind]) return;
        act[kind].push(k);
        score += { expired: LEGAL.indexOf(k) >= 0 ? 3 : 2, wrong: 2, missing: 2, check: 1, soon: 1, later: 0 }[kind];
        if (kind === 'expired' && (oldest === null || b.docs[k].date < oldest)) oldest = b.docs[k].date;
        items.push({ v: null, b: b, key: k, label: label(k), kind: kind, c: c, e: b.docs[k], date: b.docs[k].date, n: c.n === null ? 0 : c.n });
      });
      const tier = !b.operational ? 'eol' : blank && keys.length ? 'none' : KINDS.find((k) => act[k].length) || (waiting.length ? 'pending' : 'ok');
      let lines = tier === 'none' ? [{ kind: 'none', text: 'Upload all ' + keys.length + ' papers' }]
        : tier === 'eol' ? [{ kind: 'eol', text: 'No action: past its service life' }]
        : KINDS.filter((k) => act[k].length).map((k) => ({ kind: k, text: VERB[k] + ': ' + act[k].map(label).join(', ') }));
      if (waiting.length && tier !== 'eol') lines = lines.concat([{ kind: 'pending', text: 'Uploaded, waiting to be read: ' + waiting.map(label).join(', ') }]);
      return { b: b, cells: cells, act: act, tier: tier, score: score, oldest: oldest, lines: lines };
    });
    vehicles.sort((x, y) => TIERS.indexOf(x.tier) - TIERS.indexOf(y.tier) || y.score - x.score ||
      (x.oldest || '9999') .localeCompare(y.oldest || '9999') || x.b.campus.localeCompare(y.b.campus) || x.b.reg.localeCompare(y.b.reg));
    const rank = {};
    vehicles.forEach((v, i) => { rank[v.b.reg] = i; });
    const live = items.filter((i) => rank[i.b.reg] !== undefined && vehicles[rank[i.b.reg]].tier !== 'eol');
    live.forEach((i) => { i.v = vehicles[rank[i.b.reg]]; });
    // the action list follows the vehicle order, then the most urgent paper of each vehicle first (soonest date first for the renewals)
    live.sort((x, y) => rank[x.b.reg] - rank[y.b.reg] || KINDS.indexOf(x.kind) - KINDS.indexOf(y.kind) || x.n - y.n || ORDER.indexOf(x.key) - ORDER.indexOf(y.key));
    return { keys: keys, vehicles: vehicles, items: live };
  }

  const api = { analyse: analyse, cellState: cellState, TIERS: TIERS, KINDS: KINDS, ORDER: ORDER, LEGAL: LEGAL, fid: fid };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.TransportRank = api;
})(typeof window !== 'undefined' ? window : this);
