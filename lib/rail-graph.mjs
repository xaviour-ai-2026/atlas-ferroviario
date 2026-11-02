// Rail Safety Spain — route finding over real OpenStreetMap railway track (ODbL), because Renfe's GTFS publishes no
// route shapes. Each leg between two consecutive official stops is the shortest path over OSM rail ways. The track
// geometry is real; which track the train actually uses is an ESTIMATE, and legs that cannot be matched or come out
// implausibly long are returned as unavailable instead of being drawn. Pure functions; no network or files.

import { haversineKm } from '../public/js/physics.js';

export const SNAP_KM = 1.5;            // a station must lie within this distance of a track node
const CELL = 0.05;                     // spatial-index cell size in degrees (~5 km)
const PLAUSIBLE_FACTOR = 1.8;          // path may be at most 1.8× the straight distance (+ slack) …
const PLAUSIBLE_SLACK_KM = 20;         // … otherwise the leg is "implausible" and not drawn
// A path the train could not cover in its scheduled time is a wrong path (average km/h, generous).
const MAX_AVG_KMH = { highSpeed: 280, other: 170 };
// Services that normally run on high-speed lines (prefer them); everything else avoids them.
const HIGH_SPEED_PRODUCTS = new Set(['AVE', 'AVLO', 'AVANT', 'AVANT EXP', 'AVE INT', 'ALVIA', 'EUROMED']);

const cellKey = (lat, lon) => `${Math.floor(lat / CELL)}:${Math.floor(lon / CELL)}`;

/**
 * Build the graph from OSM ways: [{ nodes: [id…], geometry: [{lat, lon}…], tags: { highspeed } }]
 * (the shape returned by Overpass `out body geom`, or the slim cache written by the server).
 */
export function buildRailGraph(ways) {
  const coord = new Map();   // node id → { lat, lon }
  const adj = new Map();     // node id → [{ to, km, hs }]
  const grid = new Map();    // cell → [node id]
  const link = (a, b, km, hs) => {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a).push({ to: b, km, hs });
  };
  for (const w of ways) {
    const hs = w.tags?.highspeed === 'yes' || w.hs === true;
    for (let i = 0; i < w.nodes.length; i++) {
      const id = w.nodes[i];
      const p = w.geometry[i];
      if (!p) continue;
      if (!coord.has(id)) {
        coord.set(id, { lat: p.lat, lon: p.lon });
        const k = cellKey(p.lat, p.lon);
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(id);
      }
      if (i > 0 && w.geometry[i - 1]) {
        const km = haversineKm(w.geometry[i - 1], p);
        link(w.nodes[i - 1], id, km, hs);
        link(id, w.nodes[i - 1], km, hs);
      }
    }
  }
  return { coord, adj, grid };
}

/** Nearest track node to a point, within maxKm; null when the station is not on mapped track. */
export function nearestNode(graph, point, maxKm = SNAP_KM) {
  const r = Math.ceil(maxKm / 4) + 1; // cells to scan in each direction (cells are ≥ ~4 km wide here)
  const ci = Math.floor(point.lat / CELL), cj = Math.floor(point.lon / CELL);
  let best = null, bestKm = maxKm;
  for (let i = ci - r; i <= ci + r; i++) {
    for (let j = cj - r; j <= cj + r; j++) {
      for (const id of graph.grid.get(`${i}:${j}`) ?? []) {
        const km = haversineKm(point, graph.coord.get(id));
        if (km <= bestKm) { bestKm = km; best = id; }
      }
    }
  }
  return best;
}

/** Minimal binary heap of [cost, node] pairs for Dijkstra. */
class Heap {
  constructor() { this.a = []; }
  push(x) { const a = this.a; a.push(x); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
  pop() {
    const a = this.a; const top = a[0]; const last = a.pop();
    if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } }
    return top;
  }
  get size() { return this.a.length; }
}

/**
 * Shortest path between two nodes. Cost = km × factor (high-speed edges cheaper for high-speed services, dearer
 * for others). Search stops beyond `maxCost`. Returns { coords: [[lon, lat]…], km } or null.
 */
export function shortestPath(graph, from, to, { preferHighSpeed = false, maxCost = Infinity } = {}) {
  if (from === to) { const p = graph.coord.get(from); return { coords: [[p.lon, p.lat]], km: 0 }; }
  const dist = new Map([[from, 0]]);
  const prev = new Map();
  const heap = new Heap();
  heap.push([0, from]);
  while (heap.size) {
    const [d, u] = heap.pop();
    if (d > (dist.get(u) ?? Infinity)) continue;
    if (d > maxCost) return null;
    if (u === to) break;
    for (const e of graph.adj.get(u) ?? []) {
      const w = e.km * (e.hs ? (preferHighSpeed ? 0.8 : 1.6) : 1);
      const nd = d + w;
      if (nd < (dist.get(e.to) ?? Infinity)) { dist.set(e.to, nd); prev.set(e.to, u); heap.push([nd, e.to]); }
    }
  }
  if (!prev.has(to)) return null;
  const ids = [to];
  while (ids[ids.length - 1] !== from) ids.push(prev.get(ids[ids.length - 1]));
  ids.reverse();
  let km = 0;
  const coords = ids.map((id, i) => {
    const p = graph.coord.get(id);
    if (i > 0) km += haversineKm(graph.coord.get(ids[i - 1]), p);
    return [p.lon, p.lat];
  });
  return { coords, km };
}

/** True when covering `km` between the scheduled departure and arrival would need an impossible average speed. */
function tooFastForTimetable(km, from, to, highSpeed) {
  const seconds = (to.arr ?? NaN) - (from.dep ?? NaN);
  if (!(seconds > 0)) return false; // no usable timetable: rely on the distance check alone
  return km / (seconds / 3600) > (highSpeed ? MAX_AVG_KMH.highSpeed : MAX_AVG_KMH.other);
}

/**
 * Estimate a train's route leg by leg. stops: [{ id, name, lat, lon, arr, dep }] in official order.
 * Returns { legs: [{ from, to, status, coords?, km? }], drawn, total } where status is
 *   'track'       real OSM track found (estimated assignment)
 *   'unmatched'   a station has no mapped track within SNAP_KM
 *   'no-path'     no connected track within the search limit
 *   'implausible' the path is far longer than the straight distance, or too long for the scheduled time
 */
export function routeStops(graph, stops, { product = '' } = {}) {
  const preferHighSpeed = HIGH_SPEED_PRODUCTS.has(String(product).toUpperCase());
  const snapped = stops.map((s) => (Number.isFinite(s.lat) && Number.isFinite(s.lon) ? nearestNode(graph, s) : null));
  const legs = [];
  for (let i = 0; i < stops.length - 1; i++) {
    const from = stops[i], to = stops[i + 1];
    const leg = { from: from.name, to: to.name };
    if (snapped[i] == null || snapped[i + 1] == null) { legs.push({ ...leg, status: 'unmatched' }); continue; }
    const straight = haversineKm(from, to);
    const limit = PLAUSIBLE_FACTOR * straight + PLAUSIBLE_SLACK_KM;
    const path = shortestPath(graph, snapped[i], snapped[i + 1], { preferHighSpeed, maxCost: limit * 1.7 });
    if (!path) legs.push({ ...leg, status: 'no-path' });
    else if (path.km > limit || tooFastForTimetable(path.km, from, to, preferHighSpeed)) legs.push({ ...leg, status: 'implausible' });
    else legs.push({ ...leg, status: 'track', coords: path.coords, km: Math.round(path.km) });
  }
  return { legs, drawn: legs.filter((l) => l.status === 'track').length, total: legs.length };
}
