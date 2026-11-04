// Atlas Ferroviario — "contexto del corredor": informational awareness around one selected train.
// Only two facts, both taken directly from published data:
//   1. other trains whose PUBLISHED position lies near the selected train's drawn route (real OSM track), and
//   2. other trains the OFFICIAL TIMETABLE calls at the selected train's next stops around the same time.
// Nothing here measures distance between trains, closing speed, separation, conflict or risk — on purpose.

import { projectOnPolyline } from '../public/js/physics.js';
import { stationBoard } from './corridor.mjs';

export const NEAR_ROUTE_KM = 2;           // published position this close to the drawn line = "near the route"
export const SHARED_WINDOW_S = 30 * 60;   // timetable calls within ±30 min of ours at the same station
export const SHARED_STOPS = 3;            // look at the selected train's next three stops only

/** Index of the last stop the train has reached according to Renfe's reported stop/status, or null. */
export function reachedStop(train) {
  const i = train.reportedStopId ? train.stops.findIndex((s) => s.id === train.reportedStopId) : -1;
  if (!train.position || i < 0) return null;
  return train.reportedStatus === 'STOPPED_AT' ? i : i - 1;
}

/**
 * Other published trains near the drawn route legs still ahead (from the leg Renfe places the train on; the whole
 * route when that is unknown), listed in the order they appear along the route.
 */
function nearRoute(train, route, positioned) {
  const from = reachedStop(train) ?? 0;
  const lines = (route?.legs ?? []).filter((l, i) => l.coords && i >= from).map((l) => l.coords.map(([lon, lat]) => ({ lat, lon })));
  if (!lines.length) return [];
  const pts = lines.flat();
  const pad = 0.05; // ≈ 4–5 km: cheap bounding-box pre-filter before the exact projection
  const box = { minLat: Math.min(...pts.map((p) => p.lat)) - pad, maxLat: Math.max(...pts.map((p) => p.lat)) + pad,
    minLon: Math.min(...pts.map((p) => p.lon)) - pad, maxLon: Math.max(...pts.map((p) => p.lon)) + pad };
  const out = [];
  for (const t of positioned) {
    const p = t.position;
    if (t.number === train.number || !p || p.lat < box.minLat || p.lat > box.maxLat || p.lon < box.minLon || p.lon > box.maxLon) continue;
    let best = { offKm: Infinity, order: 0 };
    lines.forEach((line, legIdx) => {
      const r = projectOnPolyline(p, line);
      if (r.offKm < best.offKm) best = { offKm: r.offKm, order: legIdx * 1e4 + r.alongKm };
    });
    if (best.offKm <= NEAR_ROUTE_KM) out.push({ order: best.order, train: t });
  }
  return out.sort((a, b) => a.order - b.order).map(({ train: t }) => ({
    number: t.number, product: t.product, origin: t.origin, destination: t.destination,
    reportedStatus: t.reportedStatus, reportedStop: t.reportedStop, position: t.position,
  }));
}

/** Timetable calls by other trains at the selected train's next stops, within ±SHARED_WINDOW_S of its own call. */
function sharedStops(index, train, nowMs, delays) {
  const reached = reachedStop(train);
  const out = [];
  for (let i = reached == null ? 0 : reached + 1; i < train.stops.length && out.length < SHARED_STOPS; i++) {
    const stop = train.stops[i];
    const board = stationBoard(index, stop.id, nowMs, delays);
    const ours = board.find((c) => c.number === train.number);
    if (!ours || (reached == null && ours.inSeconds < 0)) continue; // already passed by the timetable, or not today
    const others = new Map();
    for (const c of board) {
      if (c.number !== train.number && Math.abs(c.inSeconds - ours.inSeconds) <= SHARED_WINDOW_S) others.set(c.number, c);
    }
    out.push({ stopId: stop.id, name: stop.name, time: ours.time, trains: [...others.values()].map((c) => ({
      number: c.number, product: c.product, origin: c.origin, destination: c.destination, time: c.time, terminates: c.terminates })) });
  }
  return out;
}

/**
 * Corridor context for a selected train.
 * train: a trainDetail() record; route: a routeStops() result (or null); positioned: published trains (deduped).
 */
export function corridorContext({ index, train, route, positioned, positionsOk, positionsStale = false, nowMs, delays = new Map() }) {
  const drawn = (route?.legs ?? []).some((l) => l.coords);
  const near = !drawn ? { available: false, reason: 'route' }
    : !positionsOk ? { available: false, reason: 'positions' }
    : positionsStale ? { available: false, reason: 'stale' }
    : { available: true, trains: nearRoute(train, route, positioned) };
  return { nearKm: NEAR_ROUTE_KM, windowMin: SHARED_WINDOW_S / 60, near, shared: sharedStops(index, train, nowMs, delays) };
}
