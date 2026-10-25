// Game layer front end (Buddy). Pure helpers first; mount() and the UI are added below in a later task.
// Everything date-based is read in IST (UTC+5:30), never the browser's own time zone.
var LMCSGame = window.LMCSGame = (function () {
  var IST_MS = 330 * 60000;
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  // A Date shifted so its getUTC* fields read as the IST wall clock.
  function ist_(date) { return new Date(date.getTime() + IST_MS); }
  function iso_(d) { return d.toISOString().slice(0, 10); }

  // The look Buddy wears today: festival > track suit (Mon-Sat) > season formal. Season = the latest of
  // summerFrom / winterFrom that is on or before today; neither passed yet means winter.
  function outfit(date, campusId, cfg) {
    cfg = cfg || {};
    var u = cfg.uniform || {}, d = ist_(date), today = iso_(d), day = DAYS[d.getUTCDay()];
    if ((u.festivals || []).indexOf(today) !== -1) return 'festival';
    var wFrom = u.winterFrom && u.winterFrom <= today ? u.winterFrom : '';
    var summer = !!u.summerFrom && u.summerFrom <= today && u.summerFrom > wFrom;
    var suit = day !== 'Sun' && ((cfg.trackSuitDays || {})[campusId] || []).indexOf(day) !== -1;
    return (suit ? 'tracksuit-' : '') + (summer ? 'summer' : 'winter') + (suit ? '' : '-formal');
  }

  // "Good morning, Meena. 2 things are waiting today. The first is X." now is optional (tests); defaults to the clock.
  function greetingLine(today, session, now) {
    var h = ist_(now || new Date()).getUTCHours();
    var hello = h >= 17 ? 'Good evening' : h >= 12 ? 'Good afternoon' : 'Good morning';
    var first = String((session && session.name) || '').trim().split(/\s+/)[0];
    var ms = (today && today.missions) || [];
    var line = hello + (first ? ', ' + first : '') + '. ';
    return line + (ms.length
      ? ms.length + (ms.length === 1 ? ' thing is' : ' things are') + ' waiting today. The first is ' + ms[0].title + '.'
      : 'Nothing is waiting today. Enjoy the calm.');
  }

  // "18 of 21 days on track this month. Last month: 20 of 22." Empty when nothing was counted this month.
  function daysLine(d) {
    if (!d || !d.counted) return '';
    var denom = d.showDenominator !== false;
    var s = d.onTrack + (denom ? ' of ' + d.counted : '') + ' days on track this month';
    if (d.lastMonthCounted) s += '. Last month: ' + d.lastMonthOnTrack + (denom ? ' of ' + d.lastMonthCounted : '') + '.';
    return s;
  }

  return { outfit: outfit, greetingLine: greetingLine, daysLine: daysLine };
})();
