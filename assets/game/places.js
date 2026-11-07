// The places config (assets/game/places.js): where LMCS HQ and the six schools are, for the Owner Kingdom's real map.
// Uday, 29 Oct: "public code, we will soon go private". So the SCHOOL and HQ positions may live in this repo, in this ONE file.
// That exception covers these seven places ONLY. Bus stops, driver homes, student addresses and routes never go in the repo.
// Keep every position here so they can move to a backend sheet later without a rebuild. Positions come from Uday's own Google Maps pins (29 Oct);
// never guess or geocode a location. A place with null coordinates is simply not drawn.
// art: the place's building on the map, one path per place, the single swap point (a path with "placeholder" in it is drawn with an
// "Art soon" tag). LMS 1-6: Art Studio's real-building cut-outs (7 Nov); a -map-1x.webp path gets its -map-2x.webp for sharp screens. HQ's townhallArt is the Townhall beside it.
// links: the places this one is joined to on the map (a line each way is drawn once). Any place may list several; a link to a place
// that isn't here or has no pin is skipped. A new school adds its own entry and its links here, nothing in the map code changes.
window.LMCSPlaces = {
  CENTER: { lat: 31.8, lng: 77.0, zoom: 9 }, // the Kullu–Mandi area: where the map sits when no pin is set (not a place)
  HES: { name: 'LMCS HQ', lat: 31.9293554, lng: 77.1144888, links: ['LMS1', 'LMS2', 'LMS3', 'LMS4', 'LMS5', 'LMS6'],
    art: 'assets/game/places-art/placeholder-hq.svg', townhallArt: 'assets/game/places-art/placeholder-townhall.svg' },
  LMS1: { name: 'LMS 1 Dhalpur', lat: 31.955228, lng: 77.112609, art: 'assets/game/art/real-lms1-dhalpur-map-1x.webp' },
  LMS2: { name: 'LMS 2 Kelheli', lat: 31.8629549, lng: 77.155524, art: 'assets/game/art/real-lms2-kelheli-map-1x.webp' },
  LMS3: { name: 'LMS 3 Dunkhra', lat: 32.0030304, lng: 77.2537965, art: 'assets/game/art/real-lms3-dunkhra-map-1x.webp' },
  LMS4: { name: 'LMS 4 Ner Chowk', lat: 31.6125237, lng: 76.918752, art: 'assets/game/art/real-lms4-nerchowk-map-1x.webp' },
  LMS5: { name: 'LMS 5 Sayoli', lat: 31.5901043, lng: 76.9020674, art: 'assets/game/art/real-lms5-sayoli-map-1x.webp' },
  LMS6: { name: 'LMS 6 Jogindernagar', lat: 31.9980361, lng: 76.7763561, art: 'assets/game/art/real-lms6-jogindernagar-map-1x.webp' }
};
if (typeof module !== 'undefined') module.exports = window.LMCSPlaces;
