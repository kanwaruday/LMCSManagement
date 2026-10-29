// School building models (assets/game/school-models.js): one simplified building per campus, drawn by school-building.js.
// Data, not code: shape and room names only; the plans and photos they come from stay off the repo, and no map location is
// kept here. A campus without a model gets the sample shape, marked "sample". Later these move to Game Config, so a new
// school is set up by data and a Principal can correct their own building as a 🧱 setup quest.
var LMCSBuildingModels = {
  // LMS 2 Kelheli, from the 2026 fire-NOC floor plans and the 2019 photos (Uday, 28 Oct): a curved range about 184 ft round
  // the outside and 30 ft deep (21 ft rooms on a 7 ft corridor), ground plus four floors, a central tower with the lobby,
  // the library on the third floor and a glass room on top, under a red roof; the assembly ground and stage sit in the curve.
  // Which wing holds which rooms, floor by floor, is read off the plans and approximate: the Principal confirms it in setup.
  LMS2: {
    campus: 'LMS2', name: 'LMS 2 Kelheli', floorH: 1.25, hills: true,
    blocks: [
      { id: 'range', name: 'Main range', kind: 'arc', cx: 12, cy: 12, r: 9, depth: 3.05, a0: 180, a1: 270, floors: 5, rooms: [
        { id: 'g-office', name: 'Office', type: 'office', floor: 0, from: 0.0, to: 0.085 },
        { id: 'g-principal', name: "Principal's office", short: 'Principal', type: 'office', host: 'daily', floor: 0, from: 0.085, to: 0.17 },
        { id: 'g-c1', name: 'Classroom G-1', type: 'classroom', floor: 0, from: 0.17, to: 0.255 },
        { id: 'g-c2', name: 'Classroom G-2', type: 'classroom', floor: 0, from: 0.255, to: 0.34 },
        { id: 'g-wash', name: 'Washrooms', type: 'washroom', floor: 0, from: 0.66, to: 0.728 },
        { id: 'g-c3', name: 'Classroom G-3', type: 'classroom', floor: 0, from: 0.728, to: 0.813 },
        { id: 'g-c4', name: 'Classroom G-4', type: 'classroom', floor: 0, from: 0.813, to: 0.898 },
        { id: 'g-physics', name: 'Physics lab', type: 'lab', floor: 0, from: 0.898, to: 1.0 },
        { id: 'f1-c1', name: 'Classroom 1-1', type: 'classroom', floor: 1, from: 0.0, to: 0.085 },
        { id: 'f1-c2', name: 'Classroom 1-2', type: 'classroom', floor: 1, from: 0.085, to: 0.17 },
        { id: 'f1-c3', name: 'Classroom 1-3', type: 'classroom', floor: 1, from: 0.17, to: 0.255 },
        { id: 'f1-c4', name: 'Classroom 1-4', type: 'classroom', floor: 1, from: 0.255, to: 0.34 },
        { id: 'f1-wash', name: 'Washrooms', type: 'washroom', floor: 1, from: 0.66, to: 0.728 },
        { id: 'f1-c5', name: 'Classroom 1-5', type: 'classroom', floor: 1, from: 0.728, to: 0.813 },
        { id: 'f1-c6', name: 'Classroom 1-6', type: 'classroom', floor: 1, from: 0.813, to: 0.898 },
        { id: 'f1-bio', name: 'Biology lab', type: 'lab', floor: 1, from: 0.898, to: 1.0 },
        { id: 'f2-c1', name: 'Classroom 2-1', type: 'classroom', floor: 2, from: 0.0, to: 0.085 },
        { id: 'f2-c2', name: 'Classroom 2-2', type: 'classroom', floor: 2, from: 0.085, to: 0.17 },
        { id: 'f2-c3', name: 'Classroom 2-3', type: 'classroom', floor: 2, from: 0.17, to: 0.255 },
        { id: 'f2-c4', name: 'Classroom 2-4', type: 'classroom', floor: 2, from: 0.255, to: 0.34 },
        { id: 'f2-wash', name: 'Washrooms', type: 'washroom', floor: 2, from: 0.66, to: 0.728 },
        { id: 'f2-c5', name: 'Classroom 2-5', type: 'classroom', floor: 2, from: 0.728, to: 0.813 },
        { id: 'f2-c6', name: 'Classroom 2-6', type: 'classroom', floor: 2, from: 0.813, to: 0.898 },
        { id: 'f2-chem', name: 'Chemistry lab', type: 'lab', floor: 2, from: 0.898, to: 1.0 },
        { id: 'f3-staff', name: 'Staff room', type: 'staff', host: 'hr', floor: 3, from: 0.0, to: 0.145 },
        { id: 'f3-maths', name: 'Maths lab', type: 'lab', floor: 3, from: 0.145, to: 0.289 },
        { id: 'f3-wash', name: 'Washrooms', type: 'washroom', floor: 3, from: 0.66, to: 0.728 },
        { id: 'f3-c1', name: 'Classroom 3-1', type: 'classroom', floor: 3, from: 0.728, to: 0.847 },
        { id: 'f3-comp', name: 'Computer lab', type: 'computer', floor: 3, from: 0.847, to: 1.0 },
        { id: 'f4-hall', name: 'Multipurpose hall', short: 'Sessions', type: 'hall', host: 'ss', floor: 4, from: 0.0, to: 0.323 },
        { id: 'f4-wash', name: 'Washrooms', type: 'washroom', floor: 4, from: 0.66, to: 0.728 },
        { id: 'f4-c1', name: 'Classroom 4-1', type: 'classroom', floor: 4, from: 0.728, to: 0.847 },
        { id: 'f4-comp', name: 'Computer lab 2', type: 'computer', floor: 4, from: 0.847, to: 1.0 }
      ] },
      { id: 'tower', name: 'Central tower', kind: 'arc', cx: 12, cy: 12, r: 8.2, depth: 3.85, a0: 211, a1: 239, floors: 6, rooms: [
        { id: 't-lobby', name: 'Lobby and lift', short: 'Lobby', type: 'lobby', floor: 0, from: 0, to: 1 },
        { id: 't-library', name: 'Library', type: 'library', host: 'rules', floor: 3, from: 0, to: 1 },
        { id: 't-top', name: 'Glass room', type: 'hall', floor: 5, from: 0, to: 1 }
      ] }
    ],
    grounds: [
      { id: 'assembly', name: 'Assembly ground', short: 'Assembly', type: 'ground',
        pts: [[3.6, 11.2], [4.0, 9.0], [5.1, 6.9], [6.9, 5.1], [9.0, 4.0], [11.2, 3.6], [11.0, 8.0], [8.0, 11.0]] },
      { id: 'site', name: 'Building site', short: 'Setup', type: 'site', host: 'setup', x: 12.7, y: 1.2, w: 1.8, d: 1.8 },
      { id: 'busbay', name: 'Bus bay', type: 'busbay', x: 0.4, y: 12.7, w: 2.6, d: 1.8 }
    ]
  }
};

// Bubbles on the Principal home (assets/game/home-hud.js): per campus, which room carries which door. { room: a room/ground id in that
// campus's building, kind: 'quest' (gold, bobs) | 'count' | 'setup', source: what it opens }. A source with no room here (or whose room
// the drawn building lacks) is reached from the 📜 Quest board bubble at `entrance` (a room id), so nothing is unreachable. A bubble
// shows only while its source needs attention. LMS 1 has no plan yet, so it uses the sample building's rooms; when its own model lands,
// map these ids again (the gate and notice board get their own rooms then, and appointments and setup move there).
var LMCSHomeHotspots = {
  LMS1: { entrance: 'play', hotspots: [
    { room: 'office', kind: 'quest', source: 'today' },      // the Principal's room: Today with Buddy
    { room: 'reception', kind: 'count', source: 'daily' },   // the office: reports and issues
    { room: 'staff', kind: 'count', source: 'hr' },          // the staff room: teachers and hiring
    { room: 'busbay', kind: 'count', source: 'routes' },     // the bus bay: the World
    { room: 'site', kind: 'setup', source: 'setup' }         // the building site stands in for the notice board
  ] },
  LMS2: { hotspots: [] }, LMS3: { hotspots: [] }, LMS4: { hotspots: [] }, LMS5: { hotspots: [] }, LMS6: { hotspots: [] }
};
if (typeof module !== 'undefined') { module.exports = LMCSBuildingModels; Object.defineProperty(module.exports, 'hotspots', { value: LMCSHomeHotspots }); } // not enumerable: the models stay campus keys only
