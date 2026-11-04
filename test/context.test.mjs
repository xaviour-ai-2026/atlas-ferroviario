// Tests for the corridor context: only published positions near the drawn route and official timetable calls;
// nothing about spacing, speed or risk.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex, findTrip, trainDetail } from '../lib/corridor.mjs';
import { corridorContext, reachedStop } from '../lib/context.mjs';

const files = {
  stops: [
    'stop_id,stop_code,stop_name,stop_desc,stop_lat,stop_lon',
    '60000,,Madrid-Puerta de Atocha-Almudena Grandes,,40.4064420,-3.6908860',
    '37200,,Ciudad Real,,38.9853000,-3.9136330',
    '50500,,Córdoba-Julio Anguita,,37.8882910,-4.7894530',
    '51003,,Sevilla-Santa Justa,,37.3924955,-5.9749269',
  ].join('\n'),
  routes: 'route_id,agency_id,route_short_name,route_long_name\nR1,1071,AVE,\nR2,1071,AVLO,',
  trips: [
    'route_id,service_id,trip_id,trip_headsign,trip_short_name',
    'R1,S1,0210012026-11-01,,02100',
    'R2,S1,0630012026-11-01,,06300', // calls at Córdoba 3 min after 02100: shared stop
    'R1,S1,0250012026-11-01,,02500', // calls at Córdoba 2 h later: outside the window
  ].join('\n'),
  stop_times: [
    'trip_id,arrival_time,departure_time,stop_id,stop_sequence',
    '0210012026-11-01,10:00:00,10:00:00,60000,01',
    '0210012026-11-01,10:50:00,10:52:00,37200,02',
    '0210012026-11-01,11:45:00,11:47:00,50500,03',
    '0210012026-11-01,12:30:00,12:30:00,51003,04',
    '0630012026-11-01,10:20:00,10:20:00,60000,01',
    '0630012026-11-01,11:48:00,11:50:00,50500,02',
    '0630012026-11-01,12:35:00,12:35:00,51003,03',
    '0250012026-11-01,13:45:00,13:47:00,50500,01',
    '0250012026-11-01,14:30:00,14:30:00,51003,02',
  ].join('\n'),
  calendar: 'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nS1,1,1,1,1,1,1,1,20261101,20261130',
  calendar_dates: 'service_id,date,exception_type',
};
const NOW = Date.UTC(2026, 10, 1, 10, 0, 0); // 11:00 Madrid
const index = buildIndex(files, null);
const train = trainDetail(index, findTrip(index, '02100', NOW), { positions: null, delays: null });

// A drawn route: one leg Madrid → Ciudad Real along a straight-ish line (as OSM coords [lon, lat]).
const route = { legs: [
  { from: 'Madrid', to: 'Ciudad Real', status: 'track', coords: [[-3.69, 40.41], [-3.8, 39.7], [-3.91, 38.99]] },
  { from: 'Ciudad Real', to: 'Córdoba', status: 'no-path' },
  { from: 'Córdoba', to: 'Sevilla', status: 'track', coords: [[-4.79, 37.89], [-5.97, 37.39]] },
] };
const at = (number, lat, lon, extra = {}) => ({ number, product: 'AVE', origin: 'A', destination: 'B', position: { lat, lon }, ...extra });

test('near-route trains: published positions within 2 km of the drawn line, in route order, never the selected train', () => {
  const positioned = [
    at('02100', 39.7, -3.8),           // the selected train itself
    at('09000', 37.63, -5.4),          // on the Córdoba–Sevilla leg (later along the route)
    at('08000', 39.705, -3.8),         // ~0.5 km off the first leg
    at('07000', 39.7, -3.6),           // ~17 km away from the line: not near
    at('06000', 38.5, -4.3),           // on the undrawn leg: we cannot say, so not listed
  ];
  const ctx = corridorContext({ index, train, route, positioned, positionsOk: true, nowMs: NOW });
  assert.equal(ctx.near.available, true);
  assert.deepEqual(ctx.near.trains.map((t) => t.number), ['08000', '09000']);
  for (const t of ctx.near.trains) assert.deepEqual(Object.keys(t).filter((k) => /km|speed|risk|gap|eta/i.test(k)), []);
});

test('near-route only looks at the rest of the route once Renfe places the train', () => {
  const moving = { ...train, position: { lat: 37.7, lon: -5.1 }, reportedStopId: '51003', reportedStatus: 'IN_TRANSIT_TO' };
  const positioned = [at('08000', 39.705, -3.8), at('09000', 37.63, -5.4)];
  const ctx = corridorContext({ index, train: moving, route, positioned, positionsOk: true, nowMs: NOW });
  assert.deepEqual(ctx.near.trains.map((t) => t.number), ['09000'], 'the Madrid–Ciudad Real leg is already behind it');
});

test('near-route is unavailable (with a reason) when no route is drawn or positions are down', () => {
  const none = corridorContext({ index, train, route: { legs: [{ status: 'no-path' }] }, positioned: [], positionsOk: true, nowMs: NOW });
  assert.deepEqual(none.near, { available: false, reason: 'route' });
  const down = corridorContext({ index, train, route, positioned: [], positionsOk: false, nowMs: NOW });
  assert.deepEqual(down.near, { available: false, reason: 'positions' });
  const stale = corridorContext({ index, train, route, positioned: [at('08000', 39.705, -3.8)], positionsOk: true, positionsStale: true, nowMs: NOW });
  assert.deepEqual(stale.near, { available: false, reason: 'stale' }, 'an old file must not look like an empty corridor');
});

test('shared stops: other timetable calls within ±30 min at the next stops only', () => {
  const ctx = corridorContext({ index, train, route, positioned: [], positionsOk: true, nowMs: NOW });
  // At 11:00 the timetable has already passed Madrid (10:00) and Ciudad Real (10:52): next is Córdoba.
  assert.equal(ctx.shared[0].stopId, '50500');
  assert.deepEqual(ctx.shared[0].trains.map((t) => t.number), ['06300']);
  assert.equal(ctx.shared[0].time, 11 * 3600 + 47 * 60);
  assert.ok(!ctx.shared.some((s) => s.trains.some((t) => t.number === '02500')));
});

test('reached stop follows what Renfe reports, never the clock', () => {
  const base = { ...train, position: { lat: 39, lon: -3.9 }, reportedStopId: '37200' };
  assert.equal(reachedStop({ ...base, reportedStatus: 'STOPPED_AT' }), 1);
  assert.equal(reachedStop({ ...base, reportedStatus: 'IN_TRANSIT_TO' }), 0);
  assert.equal(reachedStop({ ...base, position: null }), null);
});
