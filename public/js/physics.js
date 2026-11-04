// Atlas Ferroviario — distance and average-speed helpers shared by the browser and the server.
// Average speed is only ever computed between two observations whose own measurement times are
// known and whose positions match a reliable track line. Anything less is suppressed with a reason.
// Instantaneous speed, braking distance and collision risk are deliberately out of scope.

const EARTH_RADIUS_KM = 6371.0088;

// Suppression thresholds (documented in README → "Física").
export const MIN_INTERVAL_S = 30;      // shorter gaps amplify GPS jitter into nonsense speeds
export const MAX_INTERVAL_S = 900;     // longer gaps hide stops, so an "average" means little
export const MAX_OFF_TRACK_KM = 0.5;   // further than this from the line = not map-matched
export const MAX_PLAUSIBLE_KMH = 350;  // above the corridor's design speed = bad input

const toRad = (deg) => (deg * Math.PI) / 180;

/** Great-circle distance between two {lat, lon} points, in km. */
export function haversineKm(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/**
 * Project a point onto a polyline ([{lat, lon}, ...]).
 * Returns { alongKm, offKm }: distance along the line to the closest point, and how far off the line the
 * point lies. Uses a local flat projection per segment, which is accurate enough at segment scale (<200 km).
 */
export function projectOnPolyline(point, line) {
  let best = { alongKm: 0, offKm: Infinity };
  let travelled = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i];
    const b = line[i + 1];
    const kx = 111.32 * Math.cos(toRad((a.lat + b.lat) / 2)); // km per degree of longitude here
    const ky = 110.574;                                        // km per degree of latitude
    const bx = (b.lon - a.lon) * kx, by = (b.lat - a.lat) * ky;
    const px = (point.lon - a.lon) * kx, py = (point.lat - a.lat) * ky;
    const segLen = Math.hypot(bx, by);
    const t = segLen === 0 ? 0 : Math.max(0, Math.min(1, (px * bx + py * by) / (segLen * segLen)));
    const off = Math.hypot(px - t * bx, py - t * by);
    if (off < best.offKm) best = { alongKm: travelled + t * segLen, offKm: off };
    travelled += segLen;
  }
  return best;
}

const suppressed = (reason) => ({ kmh: null, reason });

const isValidTime = (t) => typeof t === 'number' && Number.isFinite(t) && t > 0;

/**
 * Average speed along the track between observations a and b ({lat, lon, observedAt}, observedAt in ms
 * since epoch = when the position was MEASURED, never when we polled it).
 * Returns { kmh, distanceKm, seconds } or { kmh: null, reason } when inputs are not trustworthy.
 */
export function averageSpeed(a, b, line, { lineReliable = false } = {}) {
  if (!lineReliable) return suppressed('La geometría de la vía no es fiable para medir distancias.');
  if (!a || !b || !isValidTime(a.observedAt) || !isValidTime(b.observedAt)) {
    return suppressed('La fuente no publica la hora de medición de cada posición.');
  }
  const seconds = (b.observedAt - a.observedAt) / 1000;
  if (seconds <= 0) return suppressed('Las horas de medición no son crecientes.');
  if (seconds < MIN_INTERVAL_S) return suppressed('Intervalo entre observaciones demasiado corto.');
  if (seconds > MAX_INTERVAL_S) return suppressed('Intervalo entre observaciones demasiado largo.');
  const pa = projectOnPolyline(a, line);
  const pb = projectOnPolyline(b, line);
  if (pa.offKm > MAX_OFF_TRACK_KM || pb.offKm > MAX_OFF_TRACK_KM) {
    return suppressed('La posición no coincide con la vía.');
  }
  const distanceKm = Math.abs(pb.alongKm - pa.alongKm);
  const kmh = (distanceKm / seconds) * 3600;
  if (kmh > MAX_PLAUSIBLE_KMH) return suppressed('Resultado no plausible; se descarta.');
  return { kmh, distanceKm, seconds };
}
