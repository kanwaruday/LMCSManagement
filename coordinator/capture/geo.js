// Distance spacing for timelapse capture: a frame every FRAME_SPACING_M metres of GPS travel, not every N seconds.
export const FRAME_SPACING_M = 15;

// Haversine distance in metres between two {lat, lng} points.
export function distanceM(a, b) {
  const rad = Math.PI / 180, R = 6371000;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// last = position of the last captured frame (null before the first), fix = {lat, lng, accuracy} from the GPS.
// A fix worse than maxAccuracyM is ignored (a bad fix would look like movement); the first good fix always captures.
export function shouldCapture(last, fix, spacingM = FRAME_SPACING_M, maxAccuracyM = 50) {
  if (!fix || !Number.isFinite(fix.lat) || !Number.isFinite(fix.lng)) return false;
  if (fix.accuracy > maxAccuracyM) return false;
  return !last || distanceM(last, fix) >= spacingM;
}
