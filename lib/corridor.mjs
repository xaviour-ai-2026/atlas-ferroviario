// Atlas Ferroviario — corridor indexes built from Renfe's static GTFS, and the merge of Renfe's official
// GTFS-Realtime feeds into one honest snapshot for the browser. Corridors share one data model: only the
// ordered spine station IDs are defined here; names and coordinates always come from the official GTFS.
// Pure functions only (no network, no files) so they can be tested with fixtures.

import { projectOnPolyline, haversineKm } from '../public/js/physics.js';

// Spine stations per corridor (Renfe GTFS stop_ids, verified in stops.txt 2026-11-01). `label` is a short
// display name for the map only; the official stop_name is kept alongside it.
export const CORRIDORS = {
  'madrid-sevilla': {
    name: 'Madrid – Sevilla',
    stations: [
      { id: '17000', label: 'Madrid Chamartín', hub: true },
      { id: '60000', label: 'Madrid Atocha', hub: true },
      { id: '37200', label: 'Ciudad Real' },
      { id: '37300', label: 'Puertollano' },
      { id: '37704', label: 'Villanueva de Córdoba' },
      { id: '50500', label: 'Córdoba' },
      { id: '51003', label: 'Sevilla Santa Justa' },
    ],
  },
  'madrid-barcelona': {
    name: 'Madrid – Barcelona',
    stations: [
      { id: '17000', label: 'Madrid Chamartín', hub: true },
      { id: '60000', label: 'Madrid Atocha', hub: true },
      { id: '04007', label: 'Guadalajara-Yebes' },
      { id: '70600', label: 'Calatayud' },
      { id: '04040', label: 'Zaragoza Delicias' },
      { id: '78400', label: 'Lleida' },
      { id: '04104', label: 'Camp de Tarragona' },
      { id: '71801', label: 'Barcelona Sants' },
    ],
  },
};
export const DEFAULT_CORRIDOR = 'madrid-sevilla';

// Trains further than this from the schematic corridor line are off the corridor, e.g. a Madrid–Málaga
// train after it leaves the Sevilla line south of Córdoba.
export const MAX_CORRIDOR_DISTANCE_KM = 25;
// Station board window: recent departures and the next few hours, from the official timetable.
export const BOARD_PAST_S = 15 * 60;
export const BOARD_AHEAD_S = 3 * 3600;

/** Minimal CSV parser for Renfe GTFS (quoted fields supported, trailing spaces trimmed). */
export function parseCsv(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
  const split = (line) => {
    const out = [];
    let cur = '', quoted = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (quoted) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') quoted = false;
        else cur += c;
      } else if (c === '"') quoted = true;
      else if (c === ',') { out.push(cur.trim()); cur = ''; }
      else cur += c;
    }
    out.push(cur.trim());
    return out;
  };
  const header = split(lines[0]);
  return lines.slice(1).map((l) => {
    const cells = split(l);
    return Object.fromEntries(header.map((h, i) => [h, cells[i] ?? '']));
  });
}

/** "25:10:00" → seconds after the service day's midnight (GTFS allows > 24h). */
export function gtfsTimeToSeconds(t) {
  const [h, m, s] = String(t).split(':').map(Number);
  return h * 3600 + m * 60 + (s || 0);
}

/** Parse the GTFS text files once; every corridor index is built from these shared tables. */
export function parseGtfs(files) {
  const stops = new Map(parseCsv(files.stops).map((s) => [s.stop_id, { id: s.stop_id, name: s.stop_name, lat: +s.stop_lat, lon: +s.stop_lon }]));
  const routes = new Map(parseCsv(files.routes).map((r) => [r.route_id, r.route_short_name || r.route_long_name]));
  const byTrip = new Map();
  for (const st of parseCsv(files.stop_times)) {
    if (!byTrip.has(st.trip_id)) byTrip.set(st.trip_id, []);
    byTrip.get(st.trip_id).push(st);
  }
  return {
    stops, routes, byTrip,
    trips: parseCsv(files.trips),
    calendar: parseCsv(files.calendar),
    calendarDates: parseCsv(files.calendar_dates || 'service_id,date,exception_type'),
  };
}

/**
 * Build one corridor index. Keeps only trips that call at ≥2 of the corridor's spine stations, at least
 * one of them outside Madrid. `corridorId = null` builds the nationwide index (every trip, no spine line).
 * `files` are GTFS texts; pass pre-parsed `tables` to avoid re-parsing.
 */
export function buildIndex(files, corridorId = DEFAULT_CORRIDOR, tables = parseGtfs(files)) {
  const def = corridorId ? CORRIDORS[corridorId] : { name: 'España', stations: [] };
  const spineIds = new Set(def.stations.map((s) => s.id));
  const outsideMadrid = new Set(def.stations.filter((s) => !s.hub).map((s) => s.id));
  const { stops, routes, byTrip } = tables;

  const trips = new Map();
  const served = new Map();
  for (const t of tables.trips) {
    const calls = (byTrip.get(t.trip_id) || []).slice().sort((a, b) => +a.stop_sequence - +b.stop_sequence);
    const spineCalls = calls.filter((c) => spineIds.has(c.stop_id));
    if (corridorId && (spineCalls.length < 2 || !spineCalls.some((c) => outsideMadrid.has(c.stop_id)))) continue;
    const stopsList = calls.map((c) => {
      const s = stops.get(c.stop_id);
      if (s) served.set(s.id, s);
      return { id: c.stop_id, name: s?.name ?? c.stop_id, lat: s?.lat ?? null, lon: s?.lon ?? null, arr: gtfsTimeToSeconds(c.arrival_time), dep: gtfsTimeToSeconds(c.departure_time) };
    });
    trips.set(t.trip_id, { tripId: t.trip_id, number: t.trip_short_name, product: routes.get(t.route_id) || 'Renfe', serviceId: t.service_id, stops: stopsList });
  }

  const serviceIds = new Set([...trips.values()].map((t) => t.serviceId));
  const calendar = new Map(tables.calendar.filter((c) => serviceIds.has(c.service_id)).map((c) => [c.service_id, c]));
  const exceptions = new Map();
  for (const d of tables.calendarDates) {
    if (serviceIds.has(d.service_id)) exceptions.set(`${d.service_id}|${d.date}`, d.exception_type);
  }

  const line = def.stations.map((s) => ({ id: s.id, label: s.label, name: stops.get(s.id)?.name ?? s.label, lat: stops.get(s.id)?.lat, lon: stops.get(s.id)?.lon }));
  return { id: corridorId ?? 'espana', name: def.name, trips, calendar, exceptions, line, stations: [...served.values()] };
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/** Does the trip's service run on the given Madrid service date ("YYYYMMDD")? */
export function runsOn(index, serviceId, yyyymmdd) {
  const ex = index.exceptions.get(`${serviceId}|${yyyymmdd}`);
  if (ex === '1') return true;
  if (ex === '2') return false;
  const c = index.calendar.get(serviceId);
  if (!c || yyyymmdd < c.start_date || yyyymmdd > c.end_date) return false;
  const d = new Date(Date.UTC(+yyyymmdd.slice(0, 4), +yyyymmdd.slice(4, 6) - 1, +yyyymmdd.slice(6, 8)));
  return c[WEEKDAYS[d.getUTCDay()]] === '1';
}

// Created once: building an Intl formatter is costly, and madridClock runs for every timetable trip on each request.
const MADRID_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

/** Madrid-local calendar date ("YYYYMMDD") and seconds since local midnight for an instant. */
export function madridClock(ms) {
  const parts = Object.fromEntries(MADRID_FMT.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return { date: `${parts.year}${parts.month}${parts.day}`, seconds: +parts.hour * 3600 + +parts.minute * 60 + +parts.second };
}

/** Service days to consider now: today, and yesterday's trips still running past midnight. */
const serviceDays = (nowMs) => {
  const today = madridClock(nowMs);
  return [[today.date, today.seconds], [madridClock(nowMs - 86400000).date, today.seconds + 86400]];
};

/** Trips the timetable says should be running now. */
export function scheduledNow(index, nowMs) {
  const out = [];
  for (const trip of index.trips.values()) {
    const first = trip.stops[0]?.dep, last = trip.stops.at(-1)?.arr;
    if (first == null) continue;
    if (serviceDays(nowMs).some(([date, s]) => s >= first && s <= last && runsOn(index, trip.serviceId, date))) out.push(trip);
  }
  return out;
}

/** Trip-level delays reported by Renfe's trip updates feed: Map tripId → { delaySec, relationship }. */
export function delaysFromFeed(json) {
  const delays = new Map();
  for (const e of json?.entity || []) {
    const tu = e.tripUpdate;
    if (tu?.trip?.tripId) delays.set(tu.trip.tripId, { delaySec: typeof tu.delay === 'number' ? tu.delay : null, relationship: tu.trip.scheduleRelationship || null });
  }
  return delays;
}

/**
 * Official timetable calls at one station: recent and upcoming, today (Madrid time), with Renfe's reported
 * delay when one exists. Times are the timetable's, never a computed ETA.
 */
export function stationBoard(index, stopId, nowMs, delays = new Map()) {
  const out = [];
  for (const trip of index.trips.values()) {
    const i = trip.stops.findIndex((s) => s.id === stopId);
    if (i < 0) continue;
    const call = trip.stops[i];
    const t = i === trip.stops.length - 1 ? call.arr : call.dep;
    for (const [date, s] of serviceDays(nowMs)) {
      if (t < s - BOARD_PAST_S || t > s + BOARD_AHEAD_S || !runsOn(index, trip.serviceId, date)) continue;
      const d = delays.get(trip.tripId);
      out.push({
        tripId: trip.tripId, number: trip.number, product: trip.product,
        origin: trip.stops[0].name, destination: trip.stops.at(-1).name,
        time: t, inSeconds: t - s, terminates: i === trip.stops.length - 1,
        delaySec: d?.delaySec ?? null, cancelled: d?.relationship === 'CANCELED',
      });
    }
  }
  return out.sort((a, b) => a.inSeconds - b.inSeconds);
}

/** Find today's (or last night's) trip for a train number, preferring one the timetable says runs today. */
export function findTrip(index, number, nowMs, liveTripIds = []) {
  // One number can have several GTFS variants (split trains, calendar variants). The variant Renfe is publishing a
  // position for wins — the last one in the feed, matching the single marker /api/live shows — then the timetable.
  const live = liveTripIds.filter((id) => index.trips.get(id)?.number === number).at(-1);
  if (live) return index.trips.get(live);
  const candidates = [...index.trips.values()].filter((t) => t.number === number);
  return candidates.find((t) => serviceDays(nowMs).some(([date]) => runsOn(index, t.serviceId, date))) ?? null;
}

/** Validate an HTTP Last-Modified header into ms since epoch, or null. */
const parseHttpDate = (h) => (h && Number.isFinite(Date.parse(h)) ? Date.parse(h) : null);

/** Feed metadata the browser needs to judge freshness. Never presents feed time as measurement time. */
export function feedMeta(f) {
  const lastModified = parseHttpDate(f?.lastModified);
  const headerTs = f?.json?.header?.timestamp ? Number(f.json.header.timestamp) * 1000 : null;
  return {
    ok: !f?.error && !!f?.json,
    error: f?.error || null,
    lastModified,
    // Renfe's AV/LD header clock has been observed exactly 1 h behind Last-Modified; expose the gap, don't trust it.
    headerOffsetSec: lastModified && headerTs ? Math.round((lastModified - headerTs) / 1000) : null,
    fetchedAt: f?.fetchedAt ?? null,
  };
}

/**
 * Merge one corridor index + GTFS-RT vehicle positions + trip updates into the browser snapshot.
 * feeds: { positions: {json, lastModified, error}, delays: {json, lastModified, error} }.
 * Nothing here is invented: missing inputs become explicit nulls with a reason.
 */
export function buildSnapshot(index, feeds, nowMs) {
  const delays = delaysFromFeed(feeds.delays?.json);
  const trains = [];
  const seen = new Set();
  for (const e of feeds.positions?.json?.entity || []) {
    const v = e.vehicle;
    const trip = index?.trips.get(v?.trip?.tripId);
    const lat = v?.position?.latitude, lon = v?.position?.longitude;
    if (!trip || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    // Positioned but away from the corridor: not shown, and NOT listed as "no position" either.
    seen.add(trip.number);
    if (index.line.length && projectOnPolyline({ lat, lon }, index.line).offKm > MAX_CORRIDOR_DISTANCE_KM) continue;
    trains.push(describe(index, trip, delays.get(trip.tripId), positionOf(v)));
  }
  // Timetable says running, no position published. One entry per train number: Renfe's GTFS has several
  // trip variants per number (split trains, overlapping calendars), which are one physical service.
  for (const trip of index ? scheduledNow(index, nowMs) : []) {
    if (seen.has(trip.number)) continue;
    seen.add(trip.number);
    trains.push(describe(index, trip, delays.get(trip.tripId), null));
  }
  return { generatedAt: nowMs, gtfsReady: !!index, positions: feedMeta(feeds.positions), delays: feedMeta(feeds.delays), trains };
}

/** One train in full (any time today), merged with its live position and delay when Renfe publishes them. */
export function trainDetail(index, trip, feeds) {
  const entity = (feeds.positions?.json?.entity || []).find((e) => e.vehicle?.trip?.tripId === trip.tripId);
  const pos = entity && Number.isFinite(entity.vehicle?.position?.latitude) ? positionOf(entity.vehicle) : null;
  return describe(index, trip, delaysFromFeed(feeds.delays?.json).get(trip.tripId), pos);
}

function positionOf(v) {
  return {
    lat: v.position.latitude, lon: v.position.longitude,
    // GTFS-RT allows a per-vehicle measurement timestamp; Renfe's AV/LD feed omits it. Keep null if absent.
    observedAt: v.timestamp ? Number(v.timestamp) * 1000 : null,
    status: v.currentStatus || null,
    stopId: v.stopId || null,
  };
}

/** One train record: official identity + reported fields, with estimates marked as such. */
function describe(index, trip, delay, pos) {
  const stopIndex = pos?.stopId ? trip.stops.findIndex((s) => s.id === pos.stopId) : -1;
  const stop = stopIndex >= 0 ? trip.stops[stopIndex] : null;
  const delaySec = delay?.delaySec ?? null;
  return {
    tripId: trip.tripId,
    corridor: index.id,
    number: trip.number,
    product: trip.product,
    operator: 'Renfe',
    origin: trip.stops[0]?.name ?? null,
    destination: trip.stops.at(-1)?.name ?? null,
    position: pos ? { lat: pos.lat, lon: pos.lon } : null,
    observedAt: pos?.observedAt ?? null,
    reportedStatus: pos?.status ?? null,
    reportedStopId: stop?.id ?? null,
    reportedStop: stop?.name ?? (pos?.stopId || null),
    // Distance between the published coordinates and the stop Renfe names (to flag disagreements, never to fix them).
    reportedStopKm: pos && Number.isFinite(stop?.lat) ? Math.round(haversineKm(pos, stop) * 10) / 10 : null,
    scheduledArrival: stop ? stop.arr : null,
    // Estimated = timetable + delay reported by Renfe. Only when both exist.
    estimatedArrival: stop && delaySec != null ? stop.arr + delaySec : null,
    delaySec,
    cancelled: delay?.relationship === 'CANCELED',
    stops: trip.stops.map((s) => ({ id: s.id, name: s.name, lat: s.lat, lon: s.lon, arr: s.arr, dep: s.dep })),
  };
}
