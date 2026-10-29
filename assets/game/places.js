// The places config (assets/game/places.js): where LMCS HQ and the six schools are, for the Owner Kingdom's real map.
// Uday, 29 Oct: "public code, we will soon go private". So the SCHOOL and HQ positions may live in this repo, in this ONE file.
// That exception covers these seven places ONLY. Bus stops, driver homes, student addresses and routes never go in the repo.
// Keep every position here so they can move to a backend sheet later without a rebuild. Positions come from Uday's own Google Maps pins (29 Oct);
// never guess or geocode a location. A place with null coordinates is simply not drawn.
window.LMCSPlaces = {
  CENTER: { lat: 31.8, lng: 77.0, zoom: 9 }, // the Kullu–Mandi area: where the map sits when no pin is set (not a place)
  HES: { name: 'LMCS HQ', lat: 31.9293554, lng: 77.1144888 },
  LMS1: { name: 'LMS 1 Dhalpur', lat: 31.955228, lng: 77.112609 },
  LMS2: { name: 'LMS 2 Kelheli', lat: 31.8629549, lng: 77.155524 },
  LMS3: { name: 'LMS 3 Dunkhra', lat: 32.0030304, lng: 77.2537965 },
  LMS4: { name: 'LMS 4 Ner Chowk', lat: 31.6125237, lng: 76.918752 },
  LMS5: { name: 'LMS 5 Sayoli', lat: 31.5901043, lng: 76.9020674 },
  LMS6: { name: 'LMS 6 Jogindernagar', lat: 31.9980361, lng: 76.7763561 }
};
if (typeof module !== 'undefined') module.exports = window.LMCSPlaces;
