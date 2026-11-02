// Tests for session history and freshness labels: stale and ambiguous data must never look "live".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordSnapshot, trainState, UNCHANGED_MS, FEED_STALE_MS, MAX_HISTORY } from '../public/js/observations.js';

const T0 = Date.UTC(2026, 10, 1, 12, 0, 0);
const snap = (lm, trains, ok = true) => ({ generatedAt: lm, positions: { ok, lastModified: lm, fetchedAt: lm }, trains });
const train = (lat, extra = {}) => ({ tripId: 'A', position: { lat, lon: -4 }, observedAt: null, ...extra });

test('history stores distinct positions only, with publication time and null observation time', () => {
  const h = new Map();
  recordSnapshot(h, snap(T0, [train(38.9)]));
  recordSnapshot(h, snap(T0 + 15_000, [train(38.9)]));
  recordSnapshot(h, snap(T0 + 30_000, [train(38.8)]));
  const pts = h.get('A').points;
  assert.equal(pts.length, 2);
  assert.equal(pts[1].publishedAt, T0 + 30_000);
  assert.equal(pts[1].observedAt, null);
});

test('GPS jitter under 50 m is not movement, so a stopped train can still become "unchanged"', () => {
  const h = new Map();
  recordSnapshot(h, snap(T0, [train(38.9)]));
  recordSnapshot(h, snap(T0 + UNCHANGED_MS, [train(38.9002)])); // ≈ 22 m
  assert.equal(h.get('A').points.length, 1);
  assert.equal(trainState(train(38.9002), h.get('A'), snap(T0 + UNCHANGED_MS, []), T0 + UNCHANGED_MS), 'unchanged');
});

test('history is capped', () => {
  const h = new Map();
  for (let i = 0; i < MAX_HISTORY + 5; i++) recordSnapshot(h, snap(T0 + i * 15_000, [train(38 + i / 100)]));
  assert.equal(h.get('A').points.length, MAX_HISTORY);
});

test('states: live → unchanged after 5 min without movement', () => {
  const h = new Map();
  recordSnapshot(h, snap(T0, [train(38.9)]));
  assert.equal(trainState(train(38.9), h.get('A'), snap(T0, []), T0 + 10_000), 'live');
  const later = snap(T0 + UNCHANGED_MS, [train(38.9)]);
  recordSnapshot(h, later);
  assert.equal(trainState(train(38.9), h.get('A'), later, T0 + UNCHANGED_MS + 5_000), 'unchanged');
});

test('states: old or failed positions file marks every train as stale', () => {
  assert.equal(trainState(train(38.9), null, snap(T0, []), T0 + FEED_STALE_MS + 1), 'feed-stale');
  assert.equal(trainState(train(38.9), null, snap(T0, [], false), T0), 'feed-stale');
  assert.equal(trainState(train(38.9), null, snap(null, []), T0), 'feed-stale');
});

test('states: scheduled train without a published position', () => {
  assert.equal(trainState({ tripId: 'B', position: null }, null, snap(T0, []), T0), 'no-position');
});
