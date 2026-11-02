// Tests for average-speed estimation: it must compute only from trustworthy inputs and suppress otherwise.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { haversineKm, projectOnPolyline, averageSpeed, MAX_INTERVAL_S } from '../public/js/physics.js';

// A straight north–south test line along longitude -4 (1° latitude ≈ 111.2 km).
const LINE = [{ lat: 39, lon: -4 }, { lat: 38, lon: -4 }];
const T0 = Date.UTC(2026, 10, 1, 12, 0, 0);
const at = (lat, seconds, lon = -4) => ({ lat, lon, observedAt: T0 + seconds * 1000 });
const OK = { lineReliable: true };

test('haversine: Madrid-Atocha to Sevilla-Santa Justa is about 390 km in a straight line', () => {
  const d = haversineKm({ lat: 40.406442, lon: -3.690886 }, { lat: 37.3924955, lon: -5.9749269 });
  assert.ok(d > 385 && d < 395, `got ${d}`);
});

test('projection: distance along and off the line', () => {
  const p = projectOnPolyline({ lat: 38.5, lon: -4 }, LINE);
  assert.ok(Math.abs(p.alongKm - 55.3) < 0.5, `along ${p.alongKm}`);
  assert.ok(p.offKm < 0.01);
  assert.ok(projectOnPolyline({ lat: 38.5, lon: -3.9 }, LINE).offKm > 8);
});

test('valid inputs: 0.1° of latitude (≈11.06 km) in 240 s ≈ 166 km/h', () => {
  const r = averageSpeed(at(38.9, 0), at(38.8, 240), LINE, OK);
  assert.ok(Math.abs(r.kmh - 165.9) < 1, `got ${r.kmh}`);
  assert.equal(r.seconds, 240);
});

test('suppressed: missing observation timestamps (polling time is never used)', () => {
  const r = averageSpeed({ lat: 38.9, lon: -4, observedAt: null }, { lat: 38.8, lon: -4, publishedAt: T0 }, LINE, OK);
  assert.equal(r.kmh, null);
  assert.match(r.reason, /hora de medición/);
});

test('suppressed: non-finite or zero timestamps', () => {
  for (const bad of [NaN, Infinity, 0, -5, '1793551851']) {
    assert.equal(averageSpeed({ lat: 38.9, lon: -4, observedAt: bad }, at(38.8, 120), LINE, OK).kmh, null);
  }
});

test('suppressed: unreliable track geometry, even with perfect timestamps', () => {
  const r = averageSpeed(at(38.9, 0), at(38.8, 120), LINE, { lineReliable: false });
  assert.equal(r.kmh, null);
  assert.match(r.reason, /geometría/);
  assert.equal(averageSpeed(at(38.9, 0), at(38.8, 120), LINE).kmh, null, 'default must be unreliable');
});

test('suppressed: timestamps not increasing, too close or too far apart', () => {
  assert.match(averageSpeed(at(38.9, 120), at(38.8, 0), LINE, OK).reason, /crecientes/);
  assert.match(averageSpeed(at(38.9, 0), at(38.9, 0), LINE, OK).reason, /crecientes/);
  assert.match(averageSpeed(at(38.9, 0), at(38.89, 10), LINE, OK).reason, /corto/);
  assert.match(averageSpeed(at(38.9, 0), at(38.5, MAX_INTERVAL_S + 1), LINE, OK).reason, /largo/);
});

test('suppressed: positions not matched to the line', () => {
  assert.match(averageSpeed(at(38.9, 0, -3.9), at(38.8, 120), LINE, OK).reason, /vía/);
});

test('suppressed: implausible results (> 350 km/h)', () => {
  assert.match(averageSpeed(at(38.9, 0), at(38.4, 60), LINE, OK).reason, /plausible/);
});
