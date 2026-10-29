// The game's emoji (assets/game/emoji.js): one emoji per concept, the same on every page, so a Fee Clerk, a Principal and a driver
// read the same picture for the same thing. Uday (28 Oct): "Can you add relevant emojis? To improve the perceived sense of UI?"
// Rules: one emoji per item, always next to a text label (the emoji is aria-hidden; screen readers read the label), none in data
// cells or numbers, and money screens stay plain. A new concept gets a new key here, never a different emoji for an old one.
//   LMCSEmoji.get('quests')  -> '📜'
//   LMCSEmoji.tag('quests')  -> <span class="gb-emoji" aria-hidden="true">📜</span>  (null for an unknown key)
//   <summary data-emoji="tools">All tools</summary>  -> the emoji goes in front, once, when the page loads; pages that draw
//   markup later call LMCSEmoji.decorate(el) on it (or use tag()).
var LMCSEmoji = (function () {
  var MAP = Object.freeze({
    // the game bar
    missions: '🎯', quests: '📜', rallies: '🚩', events: '🎉', buddy: '🦉',
    // states
    done: '✅', due: '⏰', overdue: '🔴', locked: '🔒', waiting: '⏳', soon: '✨', onTrack: '🔥',
    // rewards and progress
    points: '⭐', levelUp: '🏆', level: '🛡️', reward: '🎁', coins: '🪙',
    // places and people
    hq: '🏛️', base: '🏰', school: '🏫', heads: '👑', account: '👤', applicants: '🧑‍💼', hiring: '👥', staffPresent: '🧑‍🤝‍🧑',
    // work
    day: '🗓️', dailyReport: '📊', issues: '🛠️', curriculum: '📚', homework: '📝', documents: '📋', salary: '💼', payroll: '🧮',
    rules: '📖', byeLaws: '⚖️', supportSession: '🤝', evaluate: '✍️', startingData: '🧾', fees: '💰', dayBook: '📒', closeDay: '🌙', deposits: '🏦', requests: '📥',
    tools: '🧰', appointments: '📅', bus: '🚌', fuel: '⛽', routeVideo: '🎥', rollCall: '🙋', busCheck: '🔧', call: '📞', help: '❓',
    // the driver portal and the Home Base / World switch (28 Oct): a bill is 📃 (🧾 is starting data); the pump video is 📹, apart from the route video 🎥
    phone: '📱', signal: '📶', bill: '📃', photo: '📷', send: '📤', refused: '⚠️', pumpVideo: '📹', homeBase: '🏠', world: '🗺️',
    // the Owner's HQ Home (29 Oct): Game settings is the "Set up the game" quest
    settings: '⚙️', realMap: '📍',
    // the Principal home's setup bubble (assets/game/home-hud.js)
    setupUp: '⬆️', tasks: '🗒️',
    // the map homes (29 Oct): the Ranking window, Owner and Coordinators only
    ranking: '🥇',
    // rooms in the school building (assets/game/school-building.js)
    classroom: '✏️', lab: '🔬', computerLab: '💻', library: '📕', office: '🗄️', staffRoom: '☕', store: '📦', washroom: '🚻',
    hall: '🎭', lobby: '🛗', ground: '⚽', busBay: '🚏', site: '🧱'
  });
  function get(k) { return Object.prototype.hasOwnProperty.call(MAP, k) ? MAP[k] : ''; }
  function tag(k) {
    if (typeof document === 'undefined' || !get(k)) return null;
    var s = document.createElement('span');
    s.className = 'gb-emoji'; s.setAttribute('aria-hidden', 'true'); s.textContent = MAP[k];
    return s;
  }
  function decorate(root) {
    if (typeof document === 'undefined') return;
    [].forEach.call((root || document).querySelectorAll('[data-emoji]'), function (el) {
      if (el.firstElementChild && el.firstElementChild.classList.contains('gb-emoji')) return; // already done
      var t = tag(el.getAttribute('data-emoji'));
      if (t) el.insertBefore(t, el.firstChild);
    });
  }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { decorate(); });
    else decorate();
  }
  return { map: MAP, get: get, tag: tag, decorate: decorate };
})();
if (typeof module !== 'undefined') module.exports = LMCSEmoji;
