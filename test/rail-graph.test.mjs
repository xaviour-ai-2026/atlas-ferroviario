// Tests for route estimation over OSM-style rail ways: real track only, honest gaps, no straight-line shortcuts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRailGraph, nearestNode, shortestPath, routeStops } from '../lib/rail-graph.mjs';

// A small network: a conventional line A–B–C along latitude 40 (lon -4 → -3.8), a high-speed bypass A–C via
// lat 40.02, and an isolated line far away (no connection).
const pt = (lat, lon) => ({ lat, lon });
const ways = [
  { nodes: [1, 2, 3, 4, 5], geometry: [pt(40, -4), pt(40, -3.95), pt(40, -3.9), pt(40, -3.85), pt(40, -3.8)] },
  { nodes: [1, 10, 11, 5], geometry: [pt(40, -4), pt(40.02, -3.95), pt(40.02, -3.85), pt(40, -3.8)], tags: { highspeed: 'yes' } },
  { nodes: [20, 21], geometry: [pt(41, -1), pt(41, -0.95)] },
];
const graph = buildRailGraph(ways);
const stop = (id, lat, lon, dep, arr = dep) => ({ id, name: id, lat, lon, dep, arr });

test('stations snap to track within 1.5 km, never further', () => {
  assert.equal(nearestNode(graph, pt(40.005, -3.9)), 3);
  assert.equal(nearestNode(graph, pt(40.5, -3.9)), null);
});

test('shortest path follows track geometry, not a straight line', () => {
  const p = shortestPath(graph, 1, 5);
  assert.deepEqual(p.coords[0], [-4, 40]);
  assert.deepEqual(p.coords.at(-1), [-3.8, 40]);
  assert.ok(p.coords.length >= 2 && p.km > 16 && p.km < 20, `km ${p.km}`);
});

test('high-speed services prefer high-speed track; others avoid it', () => {
  const hs = shortestPath(graph, 1, 5, { preferHighSpeed: true });
  const conv = shortestPath(graph, 1, 5, { preferHighSpeed: false });
  assert.ok(hs.coords.some(([, lat]) => lat === 40.02), 'AVE uses the bypass');
  assert.ok(conv.coords.every(([, lat]) => lat === 40), 'MD stays on the conventional line');
});

test('legs: drawn on track, unmatched off track, no-path when disconnected', () => {
  const r = routeStops(graph, [stop('A', 40, -4, 0), stop('C', 40, -3.8, 3600), stop('X', 40.5, -3.5, 7200), stop('Y', 41, -1, 9000)], { product: 'MD' });
  assert.deepEqual(r.legs.map((l) => l.status), ['track', 'unmatched', 'unmatched']);
  const r2 = routeStops(graph, [stop('A', 40, -4, 0), stop('Z', 41, -0.95, 36000)], { product: 'MD' });
  assert.equal(r2.legs[0].status, 'no-path');
  assert.equal(r.drawn, 1);
  assert.equal(r.legs[1].coords, undefined, 'nothing is drawn for missing legs');
});

test('legs the train could not cover in its scheduled time are rejected, not drawn', () => {
  // ~17 km in 60 s would need ~1000 km/h.
  const r = routeStops(graph, [stop('A', 40, -4, 0), stop('C', 40, -3.8, 60)], { product: 'AVE' });
  assert.equal(r.legs[0].status, 'implausible');
  assert.equal(r.legs[0].coords, undefined);
});
