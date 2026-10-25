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
// - A fix with no accuracy, or worse than maxAccuracyM, is not a good fix and is ignored (a bad fix looks like movement).
// - The bus must have moved at least max(spacingM, fix.accuracy): a parked bus whose fixes wander within their own error
//   radius must not produce frames. The first good fix always captures.
export function shouldCapture(last, fix, spacingM = FRAME_SPACING_M, maxAccuracyM = 50) {
  if (!fix || !Number.isFinite(fix.lat) || !Number.isFinite(fix.lng)) return false;
  if (!Number.isFinite(fix.accuracy) || fix.accuracy > maxAccuracyM) return false;
  return !last || distanceM(last, fix) >= Math.max(spacingM, fix.accuracy);
}
