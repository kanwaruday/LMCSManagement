// The staff homes (staff-home/index.html): one page, one config per role. The three Support Session roles that had no portal
// (Uday, 29 Oct 2026: "at least the 6 SS session employees must have functioning portals, even if it is just their home and world"):
// IT Teacher, PTI and Non-Teaching. Each gets its own building (drawn by assets/game/school-building.js), its spots (rooms that open a
// sheet through assets/game/home-hud.js), and the same Town / World switch as the Principal home. A new staff role is a new entry here.
//
// Who sees which home: the Employee Master department (EmpSalary.Department, sent by the PDR backend's staffsignin and kept on the
// session by assets/auth.js as session.department). adminit -> IT Teacher, adminpti -> PTI, non-teaching -> Non-Teaching. Everyone else is
// pointed to their own portal. The Owner may preview any of the three (?role=itTeacher|pti|nonTeaching, &campus=LMS1..LMS6), read only.
//
// Spot sheets say what each spot is for and what will arrive there; nothing here is personal data. Labels are Hindi first, then English.
var LMCSStaffHome = (function () {
  // quests are owner-assigned only (the game backend's quest gate): with none assigned, the drawer and the Quests sheet say so in full,
  // the one-line strip in short
  var NO_QUESTS = 'अभी कोई क्वेस्ट नहीं। आपकी क्वेस्ट यहाँ दिखेंगी · No quests yet. Your quests will appear here.';
  var NO_QUESTS_LINE = 'अभी कोई क्वेस्ट नहीं · No quests yet'; // the one-line quest strip (the full sentence doesn't fit at 375px)
  var SOON = 'जल्द: आपकी चेकलिस्ट यहाँ आएगी · Coming soon: your checklist for this spot will appear here.';
  // the HUD's words (assets/game/home-hud.js LABELS), Hindi first
  var LABELS = { town: 'स्कूल · Town', wild: 'बाहर · Wilderness', daily: 'रोज़ · Daily', tasks: 'काम · Tasks', closeTasks: 'काम बंद करें · Close tasks',
    closeTab: '\u25c2 बंद · Close', open: 'खुले · open', close: 'बंद करें · Close', board: 'क्वेस्ट बोर्ड · Quest board', quests: 'क्वेस्ट · Quests', growth: 'बढ़त · Growth',
    profile: 'आपकी प्रोफ़ाइल · Your profile', name: 'नाम · Name', role: 'पद · Role', campus: 'स्कूल · Campus', level: 'लेवल · Level', points: 'अंक · Points',
    account: 'खाता · Account', appointments: 'मुलाक़ात · Appointments', dataSources: 'डेटा स्रोत · Data sources', go: 'जाएँ →', goAria: 'जाएँ · Go: ',
    waiting: 'बाकी · waiting', opened: 'खुला · opened', done: 'हो गया · Done', todo: 'करना है · To do', questsLine: 'क्वेस्ट · Quests',
    dayClosed: 'दिन बंद · Day closed', closes: 'बंद होगा · Closes',
    copy: { none: NO_QUESTS, noneLine: NO_QUESTS_LINE, done: 'अभी सब हो गया · All done for now.', daily: 'आज कोई रोज़ का काम नहीं · No daily missions today.',
      today: 'आज कुछ बाकी नहीं · Nothing is waiting today.', routes: 'रूट · Routes' } };
  // spots every staff home has (each role adds its own in front)
  var COMMON = {
    today: { label: 'आज Buddy के साथ · Today with Buddy', e: 'buddy' },
    requests: { label: 'छुट्टी और अर्ज़ी · Leave and requests', e: 'requests', lead: 'छुट्टी या कोई और अर्ज़ी भेजें, और उसका जवाब देखें · Send a leave or other request and see its answer.',
      links: [{ e: 'requests', label: 'अर्ज़ी खोलें · Open requests', url: '../teacher/index.html', note: 'Teacher portal: Requests and Evaluations' }] },
    rules: { label: 'नियम · Rules', e: 'rules', lead: 'स्कूल के नियम: आचरण, छुट्टी और पद · The school rules: conduct, leave and job roles.',
      links: [{ e: 'byeLaws', label: 'Bye Laws', url: 'https://kanwaruday.github.io/LMCSByeLaws/', note: 'नियमों की किताब · The rulebook of record' }] },
    routes: { label: 'रूट · Routes', e: 'bus' }
  };
  function spot(label, e, lead, later) { return { label: label, e: e, lead: lead, later: later }; }

  var ROLES = {
    itTeacher: {
      title: 'IT शिक्षक · IT Teacher', ss: 'IT Teacher SS', dept: 'adminit', place: 'कंप्यूटर लैब · Computer lab',
      spots: {
        lab: spot('कंप्यूटर लैब · Computer lab', 'computerLab', 'लैब के कंप्यूटर और उनकी देखभाल · The lab computers and their upkeep.',
          ['रोज़ लैब की जाँच · Daily lab check', 'ख़राब कंप्यूटर की सूची · List of computers that need repair']),
        cctv: spot('CCTV', 'cctv', 'स्कूल के कैमरे · The school cameras.', ['कैमरे चल रहे हैं, यह जाँच · Check the cameras are running', 'रिकॉर्डिंग का बैकअप · Recording backup']),
        epabx: spot('EPABX', 'epabx', 'स्कूल की फ़ोन लाइनें · The school phone lines.', ['लाइन ख़राब हो तो सूचना · Report a line that is down']),
        digital: spot('डिजिटल कक्षा · Digital classes', 'digitalClass', 'स्मार्ट क्लास और प्रोजेक्टर · Smart classes and projectors.', ['आज की डिजिटल कक्षाएँ · Today\'s digital classes']),
        print: spot('परीक्षा प्रिंटिंग · Exam printing', 'examPrint', 'परीक्षा के पेपर छापना · Printing the exam papers.', ['कौन सा पेपर कब छपना है · Which paper prints when'])
      },
      building: { name: 'Computer lab', blocks: [
        { id: 'labblock', name: 'Computer lab block', x: 0, y: 0, w: 4, d: 2, floors: 2, rooms: [
          { id: 'lab', name: 'कंप्यूटर लैब · Computer lab', short: 'लैब · Lab', type: 'computer', host: 'lab', face: 'front', floor: 0, at: 0, span: 2.4 },
          { id: 'print', name: 'परीक्षा प्रिंटिंग · Exam printing', short: 'प्रिंट · Print', type: 'office', e: 'examPrint', host: 'print', face: 'front', floor: 0, at: 2.4, span: 1.6 },
          { id: 'digital', name: 'डिजिटल कक्षा · Digital classes', short: 'डिजिटल', type: 'classroom', e: 'digitalClass', host: 'digital', face: 'front', floor: 1, at: 0, span: 2.4 },
          { id: 'epabx', name: 'EPABX', short: 'EPABX', type: 'office', e: 'epabx', host: 'epabx', face: 'front', floor: 1, at: 2.4, span: 1.6 },
          { id: 'cctv', name: 'CCTV', short: 'CCTV', type: 'office', e: 'cctv', host: 'cctv', face: 'side', floor: 1, at: 0, span: 2 },
          { id: 'staff', name: 'स्टाफ़ रूम · Staff room', short: 'स्टाफ़', type: 'staff', host: 'requests', face: 'side', floor: 0, at: 0, span: 2 }
        ] }
      ], grounds: [
        { id: 'busbay', name: 'बस स्टॉप · Bus bay', short: 'बस · Bus', type: 'busbay', host: 'routes', x: 1, y: 2.6, w: 2.4, d: 1.6 }
      ] },
      hotspots: { entrance: 'busbay', hotspots: [{ room: 'digital', kind: 'quest', source: 'today' }] }
    },
    pti: {
      title: 'PTI', ss: 'PTI SS', dept: 'adminpti', place: 'खेल का मैदान · Sports ground',
      spots: {
        ground: spot('खेल का मैदान · Sports ground', 'ground', 'PT पीरियड और खेल · PT periods and games.', ['आज के PT पीरियड · Today\'s PT periods', 'मैदान की जाँच · Ground check']),
        kit: spot('PT रूम · PT room', 'sportsKit', 'खेल का सामान · The sports kit.', ['सामान की गिनती · Kit count', 'टूटा सामान · Broken kit to replace']),
        assembly: spot('प्रार्थना सभा · Assembly', 'assembly', 'सुबह की सभा और ड्रिल · Morning assembly and drill.', ['आज की सभा · Today\'s assembly']),
        sportsday: spot('खेल दिवस · Sports day', 'sportsDay', 'खेल दिवस और प्रतियोगिताएँ · Sports day and competitions.', ['अगली प्रतियोगिता · The next competition'])
      },
      building: { name: 'Sports ground and PT room', blocks: [
        { id: 'ptblock', name: 'PT room', x: 0, y: 0, w: 4.4, d: 2.2, floors: 1, rooms: [
          { id: 'kit', name: 'PT रूम · PT room', short: 'PT रूम', type: 'store', e: 'sportsKit', host: 'kit', face: 'front', floor: 0, at: 0, span: 2.6 },
          { id: 'staff', name: 'स्टाफ़ रूम · Staff room', short: 'स्टाफ़', type: 'staff', host: 'requests', face: 'front', floor: 0, at: 2.6, span: 1.8 }
        ] }
      ], grounds: [
        { id: 'field', name: 'खेल का मैदान · Sports ground', short: 'मैदान · Ground', type: 'ground', host: 'ground', x: 0, y: 2.8, w: 4.6, d: 2.6 },
        { id: 'assembly', name: 'प्रार्थना सभा · Assembly', short: 'सभा', type: 'ground', e: 'assembly', host: 'assembly', x: 4.8, y: -0.2, w: 1.8, d: 2.2 },
        { id: 'track', name: 'खेल दिवस · Sports day', short: 'खेल दिवस', type: 'ground', e: 'sportsDay', host: 'sportsday', x: 4.8, y: 2.8, w: 1.8, d: 2.6 }
      ] },
      hotspots: { entrance: 'track', hotspots: [{ room: 'kit', kind: 'quest', source: 'today' }] }
    },
    nonTeaching: {
      title: 'नॉन-टीचिंग स्टाफ़ · Non-Teaching', ss: 'Non-Teaching SS', dept: 'non-teaching', place: 'स्कूल दफ़्तर · School office',
      spots: {
        desk: spot('दफ़्तर · Front office', 'office', 'आने वाले लोग और चिट्ठियाँ · Visitors and letters.', ['आज के आगंतुक · Today\'s visitors', 'डाक · Post in and out']),
        store: spot('स्टोर · Store', 'store', 'स्कूल का सामान · The school stock.', ['सामान की गिनती · Stock count']),
        upkeep: spot('सफ़ाई और देखभाल · Upkeep', 'upkeep', 'कक्षाएँ, शौचालय और परिसर साफ़ · Classrooms, washrooms and campus kept clean.', ['रोज़ की सफ़ाई जाँच · Daily cleaning check']),
        gate: spot('मुख्य द्वार · Main gate', 'gate', 'गेट खुलना और बंद होना · The gate opening and closing.', ['गेट का समय · Gate times'])
      },
      building: { name: 'School office', blocks: [
        { id: 'officeblock', name: 'School office', x: 0, y: 0, w: 4, d: 2, floors: 1, rooms: [
          { id: 'desk', name: 'दफ़्तर · Front office', short: 'दफ़्तर', type: 'office', host: 'desk', face: 'front', floor: 0, at: 0, span: 2 },
          { id: 'store', name: 'स्टोर · Store', short: 'स्टोर', type: 'store', host: 'store', face: 'front', floor: 0, at: 2, span: 2 },
          { id: 'staff', name: 'स्टाफ़ रूम · Staff room', short: 'स्टाफ़', type: 'staff', host: 'requests', face: 'side', floor: 0, at: 0, span: 2 }
        ] }
      ], grounds: [
        { id: 'campus', name: 'सफ़ाई और देखभाल · Upkeep', short: 'परिसर', type: 'ground', e: 'upkeep', host: 'upkeep', x: 0, y: 2.6, w: 4, d: 2.4 },
        { id: 'gate', name: 'मुख्य द्वार · Main gate', short: 'गेट · Gate', type: 'ground', e: 'gate', host: 'gate', x: 4.6, y: 2.6, w: 1.6, d: 1.4 },
        { id: 'busbay', name: 'बस स्टॉप · Bus bay', short: 'बस · Bus', type: 'busbay', host: 'routes', x: 4.6, y: -0.8, w: 1.6, d: 2.2 }
      ] },
      hotspots: { entrance: 'gate', hotspots: [{ room: 'desk', kind: 'quest', source: 'today' }] }
    }
  };
  var DEPT_ROLE = {}; Object.keys(ROLES).forEach(function (k) { DEPT_ROLE[ROLES[k].dept] = k; });

  // the HUD's sources for a role: Today, its own spots, then requests, rules and routes. Every key opens exactly one sheet (or the World).
  function sources(key) {
    var r = ROLES[key], out = { today: COMMON.today };
    Object.keys(r.spots).forEach(function (k) { out[k] = { label: r.spots[k].label, e: r.spots[k].e }; });
    ['requests', 'rules', 'routes'].forEach(function (k) { out[k] = { label: COMMON[k].label, e: COMMON[k].e }; });
    return out;
  }
  // what a spot's sheet shows: { lead, later: [lines], soon, links: [{ e, label, url, note }] }
  function sheet(key, source) {
    var s = ROLES[key] && ROLES[key].spots[source];
    if (s) return { lead: s.lead, later: s.later || [], soon: SOON, links: [] };
    var c = COMMON[source];
    return c && c.lead ? { lead: c.lead, later: [], soon: '', links: c.links || [] } : null;
  }

  // Who may open which home. -> { role, preview } or { refuse: reason } or { need: 'department' } (an Employee Master session from
  // before the department was kept: the page asks staffsignin once). ask = { role, campus } from the URL (the Owner's preview only).
  var REFUSE = {
    signin: { text: 'आगे बढ़ने के लिए साइन इन करें · Please sign in to continue.' },
    teacher: { text: 'यह होम IT शिक्षक, PTI और नॉन-टीचिंग स्टाफ़ के लिए है। आपका पोर्टल Teacher portal है · This home is for IT Teachers, PTIs and Non-Teaching staff. Your portal is the Teacher portal.', url: '../teacher/index.html', go: 'Teacher portal' },
    clerk: { text: 'यह होम IT शिक्षक, PTI और नॉन-टीचिंग स्टाफ़ के लिए है। आपका पोर्टल Fee Clerk portal है · This home is for IT Teachers, PTIs and Non-Teaching staff. Your portal is the Fee Clerk portal.', url: '../office/index.html', go: 'Fee Clerk + PRO' },
    driver: { text: 'यह होम IT शिक्षक, PTI और नॉन-टीचिंग स्टाफ़ के लिए है। आपका पोर्टल Driver portal है · This home is for IT Teachers, PTIs and Non-Teaching staff. Your portal is the Driver portal.', url: '../driver/index.html', go: 'Driver portal' },
    manager: { text: 'यह होम IT शिक्षक, PTI और नॉन-टीचिंग स्टाफ़ के लिए है। अपना पोर्टल चुनें · This home is for IT Teachers, PTIs and Non-Teaching staff. Please choose your own portal.', url: '../index.html', go: 'Portal home' },
    unknown: { text: 'हम आपका पद नहीं पढ़ पाए। दोबारा साइन इन करें, या दफ़्तर से पूछें · We couldn\'t read your designation yet. Sign in again, or ask the office.', again: true, url: '../index.html', go: 'Portal home' }
  };
  function has(session, role) { return String((session && session.role) || '').split(',').map(function (r) { return r.trim(); }).indexOf(role) !== -1; }
  function gate(session, ask) {
    if (!session) return { refuse: 'signin' };
    if (has(session, 'Owner')) { // the Owner previews: read only, any of the three, one school at a time
      var want = ask && ROLES[ask.role] ? ask.role : 'itTeacher', campus = ask && /^LMS[1-6]$/.test(ask.campus || '') ? ask.campus : 'LMS1';
      return { role: want, preview: true, campus: campus };
    }
    if (['Principal', 'Coordinator'].some(function (r) { return has(session, r); })) return { refuse: 'manager' };
    if (has(session, 'FeeClerk')) return { refuse: 'clerk' };
    var dept = String(session.department || '').toLowerCase();
    if (DEPT_ROLE[dept]) return { role: DEPT_ROLE[dept], preview: false, campus: String(session.campusId || '').toUpperCase() };
    if (dept === 'teaching') return { refuse: 'teacher' };
    if (dept === 'adminclerk') return { refuse: 'clerk' };
    if (dept === 'transport') return { refuse: 'driver' };
    if (session.autoSignIn && !dept) return { need: 'department' };
    if (has(session, 'Teacher') && !session.autoSignIn) return { refuse: 'teacher' }; // an allowlisted Teacher row carries no department
    return { refuse: 'unknown' };
  }

  return { ROLES: ROLES, COMMON: COMMON, LABELS: LABELS, NO_QUESTS: NO_QUESTS, NO_QUESTS_LINE: NO_QUESTS_LINE, SOON: SOON, REFUSE: REFUSE, DEPT_ROLE: DEPT_ROLE, sources: sources, sheet: sheet, gate: gate };
})();
if (typeof module !== 'undefined') module.exports = LMCSStaffHome;
