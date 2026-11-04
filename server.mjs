// Atlas Ferroviario — local server. Serves the static app from public/ and a read-only, cached proxy of
// Renfe's official open data (CC BY 4.0). The proxy exists only because Renfe's feeds send no CORS headers,
// so a browser page cannot read them directly. No database, accounts, analytics or third-party services.
// Requirements: Node ≥ 20 (built-in fetch). Runs as a local server (`npm start`) or, through lambda.mjs, on AWS Lambda.

import http from 'node:http';
import { gzipSync, inflateRawSync } from 'node:zlib';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseGtfs, buildIndex, buildSnapshot, stationBoard, findTrip, trainDetail, delaysFromFeed } from './lib/corridor.mjs';
import { buildRailGraph, routeStops } from './lib/rail-graph.mjs';
import { corridorContext } from './lib/context.mjs';
import { haversineKm } from './public/js/physics.js';
import { FEED_STALE_MS } from './public/js/observations.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
// Writable cache (timetable zip, OSM network). On Lambda: CACHE_DIR=/tmp, and RAIL_FILE points at the OSM network
// bundled with the deployment, which is then read-only (Lambda never calls Overpass; deployments refresh it).
const CACHE = process.env.CACHE_DIR || path.join(ROOT, 'data', 'cache');
const RAIL_FILE = process.env.RAIL_FILE || path.join(CACHE, 'osm-rail-es.json');
const RAIL_READONLY = !!process.env.RAIL_FILE;
const PORT = Number(process.env.PORT) || 4380;

// Official Renfe open-data URLs (data.renfe.com, CC BY 4.0).
const SOURCES = {
  gtfs: 'https://ssl.renfe.com/gtransit/Fichero_AV_LD/google_transit.zip',
  positions: 'https://gtfsrt.renfe.com/vehicle_positions_LD.json',
  delays: 'https://gtfsrt.renfe.com/trip_updates_LD.json',
};
const FEED_CACHE_MS = 15_000;          // Renfe states 15 s for positions; never poll faster than that
const LIVE_MAX_AGE = 15;               // s: live answers may be reused this long by browsers and CloudFront
const GTFS_REFRESH_MS = 6 * 3600_000;  // the timetable zip is regenerated daily
const USER_AGENT = 'atlas-ferroviario/0.1 (non-commercial open-source prototype)';

// OpenStreetMap rail network for Spain (ODbL), used to estimate routes over real track. One Overpass request per
// refresh (~30 MB), well inside the public instance's guidelines; cached in data/cache/.
const OVERPASS = 'https://overpass-api.de/api/interpreter';
const RAIL_QUERY = '[out:json][timeout:300];area["ISO3166-1"="ES"][admin_level=2]->.es;'
  + 'way["railway"="rail"]["service"!~"yard|siding"]["usage"!~"industrial|military|tourism"]["gauge"!="1000"](area.es);out body geom qt;';
const RAIL_REFRESH_MS = 30 * 24 * 3600_000;

let index = null; // nationwide index of Renfe AV/LD/MD trips (corridor = null)
let stationTrips = new Map(); // stop id → trips per timetable (to show busy stations first)
let rail = null; // { graph, osmTimestamp, networkGz } — null until the OSM network is available
const routeCache = new Map(); // tripId → routeStops result
let gtfsLastModified = null;
const feeds = { positions: null, delays: null };

/** Download (or reuse the cached) timetable zip and rebuild the nationwide index. */
async function loadGtfs() {
  await mkdir(CACHE, { recursive: true });
  const zip = path.join(CACHE, 'renfe_av_ld_gtfs.zip');
  try {
    const res = await fetch(SOURCES.gtfs, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await writeFile(zip, Buffer.from(await res.arrayBuffer()));
    gtfsLastModified = res.headers.get('last-modified');
  } catch (err) {
    console.warn(`[gtfs] download failed (${err.message}); trying cached copy`);
  }
  try {
    const archive = await readFile(zip);
    const names = ['stops', 'routes', 'trips', 'stop_times', 'calendar', 'calendar_dates'];
    const files = Object.fromEntries(names.map((n) => [n, unzipEntry(archive, `${n}.txt`)]));
    index = buildIndex(files, null, parseGtfs(files));
    stationTrips = new Map();
    for (const t of index.trips.values()) for (const s of t.stops) stationTrips.set(s.id, (stationTrips.get(s.id) ?? 0) + 1);
    routeCache.clear();
    console.log(`[gtfs] nationwide index ready: ${index.trips.size} trips, ${index.stations.length} stations`);
  } catch (err) {
    console.error(`[gtfs] no usable timetable (${err.message}); live trains cannot be identified`);
  }
}

/** Load the cached OSM rail network (refreshing it from Overpass when missing or older than 30 days). */
/** Read one file from a zip archive (stored or deflated) with Node's zlib only: no system `unzip` needed. */
function unzipEntry(zip, name) {
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])); // end of central directory
  let p = zip.readUInt32LE(eocd + 16);
  for (let i = zip.readUInt16LE(eocd + 10); i > 0; i--) {
    const nameLen = zip.readUInt16LE(p + 28), extraLen = zip.readUInt16LE(p + 30), commentLen = zip.readUInt16LE(p + 32);
    if (zip.toString('utf8', p + 46, p + 46 + nameLen) === name) {
      const local = zip.readUInt32LE(p + 42);
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const data = zip.subarray(start, start + zip.readUInt32LE(p + 20));
      return (zip.readUInt16LE(p + 10) === 0 ? data : inflateRawSync(data)).toString('utf8');
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`${name} not found in the timetable zip`);
}

async function loadRail() {
  const file = RAIL_FILE;
  let cached = null;
  try { cached = JSON.parse(await readFile(file, 'utf8')); } catch { /* first run */ }
  if (!RAIL_READONLY && (!cached || Date.now() - cached.fetchedAt > RAIL_REFRESH_MS)) {
    try {
      const res = await fetch(OVERPASS, {
        method: 'POST', body: new URLSearchParams({ data: RAIL_QUERY }), signal: AbortSignal.timeout(420_000),
        headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/x-www-form-urlencoded' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      cached = {
        fetchedAt: Date.now(), osmTimestamp: json.osm3s?.timestamp_osm_base ?? null,
        ways: json.elements.filter((e) => e.type === 'way').map((w) => ({ n: w.nodes, g: w.geometry.map((p) => (p ? [p.lat, p.lon] : null)), hs: w.tags?.highspeed === 'yes' })),
      };
      await mkdir(CACHE, { recursive: true });
      await writeFile(file, JSON.stringify(cached));
    } catch (err) {
      console.warn(`[rail] OSM download failed (${err.message})${cached ? '; using older cache' : '; routes unavailable'}`);
    }
  }
  if (!cached) return;
  const ways = cached.ways.map((w) => ({ nodes: w.n, geometry: w.g.map((p) => (p ? { lat: p[0], lon: p[1] } : null)), hs: w.hs }));
  rail = { graph: buildRailGraph(ways), osmTimestamp: cached.osmTimestamp, networkGz: gzipSync(JSON.stringify(simplifyNetwork(ways))) };
  routeCache.clear();
  console.log(`[rail] OSM network ready: ${rail.graph.coord.size} track nodes (OSM data ${cached.osmTimestamp})`);
}

/** National map layer: the same OSM ways thinned to a point every ~1 km (real geometry, lighter to send). */
function simplifyNetwork(ways) {
  const features = [];
  for (const w of ways) {
    const pts = w.geometry.filter(Boolean);
    const kept = [];
    pts.forEach((p, i) => {
      const last = kept.at(-1);
      if (!last || i === pts.length - 1 || haversineKm(last, p) >= 1) kept.push(p);
    });
    if (kept.length >= 2) features.push({ type: 'Feature', properties: { hs: w.hs }, geometry: { type: 'LineString', coordinates: kept.map((p) => [+p.lon.toFixed(3), +p.lat.toFixed(3)]) } }); // ~100 m: plenty at overview zoom
  }
  return { type: 'FeatureCollection', features };
}

/** Fetch one realtime feed at most every FEED_CACHE_MS; on failure keep the error visible, never fake data. */
async function getFeed(key) {
  const cached = feeds[key];
  if (cached && Date.now() - cached.fetchedAt < FEED_CACHE_MS) return cached;
  const fetchedAt = Date.now();
  try {
    const res = await fetch(SOURCES[key], { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    feeds[key] = { json: await res.json(), lastModified: res.headers.get('last-modified'), fetchedAt, error: null };
  } catch (err) {
    feeds[key] = { json: null, lastModified: null, fetchedAt, error: `No se pudo leer la fuente (${err.message})` };
  }
  return feeds[key];
}

/**
 * Trip ids Renfe is publishing positions for, in feed order, with entities that name a stop moved last. Renfe can
 * publish one physical train under two GTFS variants (e.g. a split train, same coordinates); the variant that
 * reports a stop is the one whose route matches. "Last wins" here and in /api/live, so marker and detail agree.
 */
const byReportedStopLast = (items, hasStop) => [...items.filter((x) => !hasStop(x)), ...items.filter(hasStop)];
const liveTripIds = (positions) => byReportedStopLast(positions?.json?.entity || [], (e) => !!e.vehicle?.stopId)
  .map((e) => e.vehicle?.trip?.tripId).filter(Boolean);

async function liveFeeds() {
  const [positions, delays] = await Promise.all([getFeed('positions'), getFeed('delays')]);
  return { positions, delays };
}

/** Estimated route for a trip over the OSM network, computed once per trip (requires `rail`). */
function routeFor(trip) {
  if (!routeCache.has(trip.tripId)) routeCache.set(trip.tripId, routeStops(rail.graph, trip.stops, { product: trip.product }));
  return routeCache.get(trip.tripId);
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' };

/** JSON response. maxAge (s) lets browsers and CloudFront reuse a successful answer briefly; errors are never cached. */
function sendJson(res, status, body, maxAge = 0) {
  const cache = status === 200 && maxAge ? `public, max-age=${maxAge}` : 'no-store';
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': cache, 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(body));
}

// Basic protection for a public deployment: a per-client request budget on /api/*, strict parameter formats, and a
// short cache for the costliest endpoint. In memory, one process: enough for one small server. Behind a reverse
// proxy every client shares the proxy's address, so the proxy must apply its own per-client limit.
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 120; // API requests per client per minute; the app uses about 12 while a train is open
const hits = new Map(); // client address → { start, count }
function rateLimited(req) {
  const ip = req.socket.remoteAddress ?? '';
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || now - h.start > RATE_WINDOW_MS) { hits.set(ip, { start: now, count: 1 }); return false; }
  return ++h.count > RATE_MAX;
}
setInterval(() => { const now = Date.now(); for (const [ip, h] of hits) if (now - h.start > RATE_WINDOW_MS) hits.delete(ip); }, RATE_WINDOW_MS).unref();
const PARAM_FORMAT = { number: /^\d{1,6}$/, id: /^\d{1,7}$/ }; // Renfe train numbers and GTFS stop ids
const contextCache = new Map(); // tripId → { at, body }: corridor context is recomputed at most once per feed refresh

/** The request handler, shared by the local server and the Lambda entry point (lambda.mjs). */
export async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Solo lectura' });
  if (url.pathname.startsWith('/api/')) {
    if (rateLimited(req)) { res.setHeader('Retry-After', '60'); return sendJson(res, 429, { error: 'Demasiadas peticiones; inténtalo en un minuto' }); }
    for (const [key, re] of Object.entries(PARAM_FORMAT)) {
      if (url.searchParams.has(key) && !re.test(url.searchParams.get(key))) return sendJson(res, 400, { error: `Parámetro ${key} no válido` });
    }
  }

  if (url.pathname.startsWith('/api/') && url.pathname !== '/api/live' && !index) {
    return sendJson(res, 503, { error: 'Horario oficial no disponible todavía' });
  }
  // Every station served by Renfe's AV/LD/MD timetable, with official GTFS id, name and coordinates.
  if (url.pathname === '/api/stations') {
    return sendJson(res, 200, { gtfsLastModified, stations: index.stations.map((s) => ({ ...s, trips: stationTrips.get(s.id) ?? 0 })) }, 600);
  }
  // Published positions only (slim: no stop lists), plus how many timetabled trains have none.
  if (url.pathname === '/api/live') {
    const snap = buildSnapshot(index, await liveFeeds(), Date.now());
    // One marker per train number: Renfe publishes split trains (e.g. A Coruña + Ourense) as two trips.
    const byNumber = new Map(byReportedStopLast(snap.trains.filter((t) => t.position), (t) => !!t.reportedStop).map(({ stops, ...t }) => [t.number, t]));
    const positioned = [...byNumber.values()];
    return sendJson(res, 200, { ...snap, trains: positioned, withoutPosition: snap.trains.filter((t) => !t.position).length }, LIVE_MAX_AGE);
  }
  // Station board from the official timetable, with Renfe's reported delay where present.
  if (url.pathname === '/api/station') {
    const id = url.searchParams.get('id');
    const delays = delaysFromFeed((await getFeed('delays')).json);
    const calls = stationBoard(index, id, Date.now(), delays);
    const unique = [...new Map(calls.map((c) => [`${c.number}|${c.time}`, c])).values()];
    return sendJson(res, 200, { stationId: id, now: Date.now(), calls: unique }, LIVE_MAX_AGE);
  }
  // Simplified national OSM rail network for the overview layer (or empty while unavailable).
  if (url.pathname === '/api/network') {
    if (!rail) return sendJson(res, 200, { type: 'FeatureCollection', features: [] });
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Encoding': 'gzip', 'Cache-Control': 'max-age=3600' });
    return res.end(rail.networkGz); // every browser accepts gzip
  }
  // Estimated route over real OSM track: only legs matched to track are returned as geometry; the rest are listed.
  if (url.pathname === '/api/route') {
    const trip = findTrip(index, url.searchParams.get('number'), Date.now(), liveTripIds(await getFeed('positions')));
    if (!trip) return sendJson(res, 404, { error: 'Tren no encontrado en el horario de hoy' });
    if (!rail) return sendJson(res, 200, { available: false, reason: 'La red ferroviaria de OpenStreetMap no está disponible ahora.' });
    const r = routeFor(trip);
    return sendJson(res, 200, {
      available: true, osmTimestamp: rail.osmTimestamp, drawn: r.drawn, total: r.total,
      legs: r.legs.map(({ coords, ...leg }) => leg),
      // leg = index of the leg's first stop, so the browser can show passed legs dimmer than upcoming ones.
      geojson: { type: 'FeatureCollection', features: r.legs.map((l, leg) => ({ l, leg })).filter(({ l }) => l.coords).map(({ l, leg }) => ({
        type: 'Feature', geometry: { type: 'LineString', coordinates: l.coords }, properties: { from: l.from, to: l.to, leg } })) },
    }, 60); // the variant Renfe publishes can change (split trains): keep it short
  }
  // Corridor context (informational only): published trains near the drawn route + timetable calls at next stops.
  if (url.pathname === '/api/context') {
    const now = Date.now();
    const live = await liveFeeds();
    const trip = findTrip(index, url.searchParams.get('number'), now, liveTripIds(live.positions));
    if (!trip) return sendJson(res, 404, { error: 'Tren no encontrado en el horario de hoy' });
    const cached = contextCache.get(trip.tripId);
    if (cached && now - cached.at < FEED_CACHE_MS) return sendJson(res, 200, cached.body, LIVE_MAX_AGE);
    const snap = buildSnapshot(index, live, now);
    const positioned = [...new Map(byReportedStopLast(snap.trains.filter((t) => t.position), (t) => !!t.reportedStop).map((t) => [t.number, t])).values()];
    // An old positions file must not look like a quiet corridor: treat it as unavailable.
    const stale = !snap.positions.lastModified || now - snap.positions.lastModified > FEED_STALE_MS;
    const body = corridorContext({ index, train: trainDetail(index, trip, live), route: rail ? routeFor(trip) : null,
      positioned, positionsOk: snap.positions.ok, positionsStale: stale, nowMs: now, delays: delaysFromFeed(live.delays?.json) });
    contextCache.set(trip.tripId, { at: now, body });
    return sendJson(res, 200, body, LIVE_MAX_AGE);
  }
  // One train by number (today), merged with live data when Renfe publishes it.
  if (url.pathname === '/api/train') {
    const live = await liveFeeds();
    const trip = findTrip(index, url.searchParams.get('number'), Date.now(), liveTripIds(live.positions));
    if (trip) return sendJson(res, 200, { train: trainDetail(index, trip, live), positions: buildSnapshot(null, live, Date.now()).positions }, LIVE_MAX_AGE);
    return sendJson(res, 404, { error: 'Tren no encontrado en el horario de hoy' });
  }

  // Static files, confined to public/.
  const file = path.normalize(path.join(PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname));
  if (!file.startsWith(PUBLIC)) return sendJson(res, 403, { error: 'Prohibido' });
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' });
    res.end(body);
  } catch {
    sendJson(res, 404, { error: 'No encontrado' });
  }
}

/** Resolves once the timetable and the OSM network have been loaded (or failed and logged). */
export const ready = Promise.all([loadGtfs(), loadRail()]);
setInterval(loadGtfs, GTFS_REFRESH_MS).unref();

// Run as a local server only when started directly (`npm start`), not when imported by lambda.mjs or a script.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  http.createServer(handle).listen(PORT, () => console.log(`Atlas Ferroviario → http://localhost:${PORT}`));
}
