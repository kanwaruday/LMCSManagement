// The places config (assets/game/places.js): where LMCS HQ and the six schools are, for the Owner Kingdom's real map.
// Uday, 29 Oct: "public code, we will soon go private". So the SCHOOL and HQ positions may live in this repo, in this ONE file.
// That exception covers these seven places ONLY. Bus stops, driver homes, student addresses and routes never go in the repo.
// Keep every position here so they can move to a backend sheet later without a rebuild. lat/lng stay null until Uday sends pins:
// never guess or geocode a location. A place with null coordinates is simply not drawn.
window.LMCSPlaces = {
  HES: { name: 'LMCS HQ', lat: null, lng: null },
  LMS1: { name: 'LMS 1 Dhalpur', lat: null, lng: null },
  LMS2: { name: 'LMS 2 Kelheli', lat: null, lng: null },
  LMS3: { name: 'LMS 3 Dunkhra', lat: null, lng: null },
  LMS4: { name: 'LMS 4 Ner Chowk', lat: null, lng: null },
  LMS5: { name: 'LMS 5 Sayoli', lat: null, lng: null },
  LMS6: { name: 'LMS 6 Jogindernagar', lat: null, lng: null }
};
if (typeof module !== 'undefined') module.exports = window.LMCSPlaces;
