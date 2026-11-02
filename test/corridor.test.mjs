// Tests for the corridor index and snapshot merge, using small fixtures shaped like Renfe's real files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, buildIndex, buildSnapshot, runsOn, madridClock, scheduledNow, stationBoard, findTrip, trainDetail, delaysFromFeed, parseGtfs, CORRIDORS } from '../lib/corridor.mjs';

const files = {
  stops: [
    'stop_id,stop_code,stop_name,stop_desc,stop_lat,stop_lon',
    '60000,,Madrid-Puerta de Atocha-Almudena Grandes,,40.4064420,-3.6908860',
    '37200,,Ciudad Real,,38.9853000,-3.9136330',
    '50500,,Córdoba-Julio Anguita,,37.8882910,-4.7894530',
    '51003,,Sevilla-Santa Justa,,37.3924955,-5.9749269',
    '17000,,Madrid-Chamartín-Clara Campoamor,,40.4711789,-3.6829524',
    '37300,,Puertollano,,38.6912800,-4.1116550',
    '37704,,Villanueva de Córdoba,,38.2554049,-4.5709520',
    '10000,,Valladolid,,41.64,-4.73',
  ].join('\n'),
  routes: 'route_id,agency_id,route_short_name,route_long_name\nR1,1071,AVE,\nR2,1071,ALVIA,',
  trips: [
    'route_id,service_id,trip_id,trip_headsign,trip_short_name',
    'R1,S1,0210012026-11-01,,02100',
    'R2,S1,0400012026-11-01,,04000', // Madrid–Valladolid: not on the corridor
  ].join('\n'),
  stop_times: [
    'trip_id,arrival_time,departure_time,stop_id,stop_sequence',
    '0210012026-11-01,10:00:00,10:00:00,60000,01',
    '0210012026-11-01,10:50:00,10:52:00,37200,02',
    '0210012026-11-01,11:45:00,11:47:00,50500,03',
    '0210012026-11-01,12:30:00,12:30:00,51003,04',
    '0400012026-11-01,09:00:00,09:00:00,17000,01',
    '0400012026-11-01,10:00:00,10:00:00,10000,02',
  ].join('\n'),
  calendar: 'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nS1,1,1,1,1,1,0,1,20261101,20261130',
  calendar_dates: 'service_id,date,exception_type\nS1,20261102,2',
};

// 2026-11-01 11:00 in Madrid (CET, UTC+1) = 10:00 UTC.
const NOW = Date.UTC(2026, 10, 1, 10, 0, 0);

test('parseCsv handles BOM, quotes and padded cells', () => {
  const rows = parseCsv('﻿a,b\n"x, y" ,  z  \n');
  assert.deepEqual(rows, [{ a: 'x, y', b: 'z' }]);
});

test('index keeps only Madrid–Sevilla corridor trips', () => {
  const idx = buildIndex(files);
  assert.deepEqual([...idx.trips.keys()], ['0210012026-11-01']);
  assert.equal(idx.trips.get('0210012026-11-01').product, 'AVE');
  assert.equal(idx.line.length, 7);
});

test('calendar: weekday flags, date range and exceptions', () => {
  const idx = buildIndex(files);
  assert.equal(runsOn(idx, 'S1', '20261101'), true);   // Sunday, flag 1
  assert.equal(runsOn(idx, 'S1', '20261102'), false);  // removed by calendar_dates
  assert.equal(runsOn(idx, 'S1', '20261107'), false);  // Saturday, flag 0
  assert.equal(runsOn(idx, 'S1', '20261201'), false);  // outside range
});

test('madridClock uses Europe/Madrid local time', () => {
  assert.deepEqual(madridClock(NOW), { date: '20261101', seconds: 11 * 3600 });
});

test('scheduledNow finds trips running per the timetable', () => {
  assert.equal(scheduledNow(buildIndex(files), NOW).length, 1);
  assert.equal(scheduledNow(buildIndex(files), NOW + 6 * 3600_000).length, 0);
});

const positions = (entities) => ({ json: { header: { timestamp: String((NOW - 3600_000) / 1000) }, entity: entities }, lastModified: new Date(NOW).toUTCString(), fetchedAt: NOW });
const vp = (tripId, lat, lon, extra = {}) => ({ id: `VP_${tripId}`, vehicle: { trip: { tripId }, position: { latitude: lat, longitude: lon }, currentStatus: 'IN_TRANSIT_TO', stopId: '50500', ...extra } });
const delays = { json: { entity: [{ tripUpdate: { trip: { tripId: '0210012026-11-01' }, delay: 300 } }] }, lastModified: new Date(NOW).toUTCString() };

test('snapshot: live train merged with timetable and Renfe-reported delay', () => {
  const s = buildSnapshot(buildIndex(files), { positions: positions([vp('0210012026-11-01', 38.5, -4.3)]), delays }, NOW);
  assert.equal(s.trains.length, 1);
  const t = s.trains[0];
  assert.equal(t.number, '02100');
  assert.equal(t.reportedStop, 'Córdoba-Julio Anguita');
  assert.equal(t.delaySec, 300);
  assert.equal(t.estimatedArrival, t.scheduledArrival + 300);
  assert.equal(t.observedAt, null, 'Renfe AV/LD publishes no per-train time; it must stay null');
  assert.equal(s.positions.headerOffsetSec, 3600, 'header clock bug is exposed, not trusted');
});

test('snapshot: per-train timestamp is used only when the feed provides one', () => {
  const s = buildSnapshot(buildIndex(files), { positions: positions([vp('0210012026-11-01', 38.5, -4.3, { timestamp: '1793551851' })]), delays }, NOW);
  assert.equal(s.trains[0].observedAt, 1793551851000);
});

test('snapshot: unknown trips, missing coordinates and off-corridor positions are dropped', () => {
  const s = buildSnapshot(buildIndex(files), { positions: positions([
    vp('9999912026-11-01', 38.5, -4.3),
    { id: 'x', vehicle: { trip: { tripId: '0210012026-11-01' } } },
  ]), delays }, NOW);
  // The corridor trip has no usable position, so it appears only as "scheduled, no position".
  assert.equal(s.trains.length, 1);
  assert.equal(s.trains[0].position, null);
  const off = buildSnapshot(buildIndex(files), { positions: positions([vp('0210012026-11-01', 36.7, -4.4)]), delays }, NOW);
  assert.equal(off.trains.length, 0, 'Málaga is > 25 km away: not shown, and not mislabelled as "no position"');
});

test('snapshot: several timetable variants of one train number are listed once', () => {
  const twin = { ...files,
    trips: `${files.trips}\nR1,S1,0210012026-10-25,,02100`,
    stop_times: `${files.stop_times}\n${files.stop_times.split('\n').slice(1, 5).join('\n').replaceAll('2026-11-01', '2026-10-25')}` };
  const s = buildSnapshot(buildIndex(twin), { positions: positions([]), delays }, NOW);
  assert.equal(s.trains.length, 1);
});

test('snapshot: feed failure yields no invented positions', () => {
  const s = buildSnapshot(buildIndex(files), { positions: { json: null, error: 'HTTP 503', fetchedAt: NOW }, delays: { json: null, error: 'HTTP 503' } }, NOW);
  assert.equal(s.positions.ok, false);
  assert.equal(s.trains.filter((t) => t.position).length, 0);
  assert.ok(s.trains.every((t) => t.delaySec === null));
});

test('snapshot without a timetable: nothing can be identified, nothing is shown', () => {
  const s = buildSnapshot(null, { positions: positions([vp('0210012026-11-01', 38.5, -4.3)]), delays }, NOW);
  assert.equal(s.gtfsReady, false);
  assert.equal(s.trains.length, 0);
});

// ---------- multi-corridor model, station board, train lookup ----------

const twoCorridors = { ...files,
  stops: `${files.stops}\n04040,,Zaragoza Delicias,,41.6586576,-0.9112693\n71801,,Barcelona-Sants,,41.3798632,2.14101688`,
  trips: `${files.trips}\nR1,S1,0310012026-11-01,,03100`,
  stop_times: `${files.stop_times}\n0310012026-11-01,09:00:00,09:00:00,60000,01\n0310012026-11-01,10:20:00,10:22:00,04040,02\n0310012026-11-01,11:45:00,11:45:00,71801,03` };

test('every corridor uses the same model; names and coordinates come from GTFS', () => {
  const tables = parseGtfs(twoCorridors);
  const bcn = buildIndex(twoCorridors, 'madrid-barcelona', tables);
  const sev = buildIndex(twoCorridors, 'madrid-sevilla', tables);
  assert.deepEqual([...bcn.trips.keys()], ['0310012026-11-01']);
  assert.deepEqual([...sev.trips.keys()], ['0210012026-11-01']);
  const zgz = bcn.line.find((s) => s.id === '04040');
  assert.equal(zgz.name, 'Zaragoza Delicias');
  assert.equal(zgz.lat, 41.6586576);
  assert.ok(bcn.stations.some((s) => s.id === '71801'), 'served stations listed for search');
  assert.equal(Object.keys(CORRIDORS).length, 2);
});

test('station board: timetable calls in the window, with Renfe delay when reported', () => {
  const idx = buildIndex(files);
  const board = stationBoard(idx, '50500', NOW, delaysFromFeed(delays.json)); // Córdoba, 11:00 local
  assert.equal(board.length, 1);
  assert.equal(board[0].number, '02100');
  assert.equal(board[0].time, 11 * 3600 + 47 * 60);
  assert.equal(board[0].delaySec, 300);
  assert.equal(stationBoard(idx, '50500', NOW + 4 * 3600_000).length, 0, 'outside the window');
});

test('train lookup by number and detail without a position stays explicit', () => {
  const idx = buildIndex(files);
  const trip = findTrip(idx, '02100', NOW);
  assert.equal(trip.tripId, '0210012026-11-01');
  assert.equal(findTrip(idx, '99999', NOW), null);
  const d = trainDetail(idx, trip, { positions: positions([]), delays });
  assert.equal(d.position, null);
  assert.equal(d.observedAt, null);
  assert.equal(d.delaySec, 300);
  assert.equal(d.stops[1].lat, 38.9853);
});

test('nationwide index (corridor null) keeps every trip and never drops positions by distance', () => {
  const idx = buildIndex(files, null);
  assert.equal(idx.id, 'espana');
  assert.deepEqual([...idx.trips.keys()].sort(), ['0210012026-11-01', '0400012026-11-01']);
  assert.equal(idx.line.length, 0);
  const s = buildSnapshot(idx, { positions: positions([vp('0400012026-11-01', 41.0, -4.2)]), delays }, NOW);
  const t = s.trains.find((x) => x.number === '04000');
  assert.deepEqual(t.position, { lat: 41.0, lon: -4.2 }, 'reported coordinates are passed through unchanged');
});
