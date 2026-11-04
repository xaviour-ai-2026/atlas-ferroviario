// Atlas Ferroviario — reproducible data validation. Captures one Renfe GTFS-RT file pair, replays it through the real
// server (same code, clock set to the file's publication time) and compares, train by train, what the app serves
// with the raw records and the official GTFS timetable. Writes the raw files (CC BY 4.0, Renfe Operadora) and the
// results to docs/validation/<UTC time>/. Usage: node scripts/validate.mjs [minTrains]
// Replay keeps app and evidence on exactly the same file; a live comparison would race Renfe's 15 s refresh.

import { syncBuiltinESMExports } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GTFS_ZIP = path.join(ROOT, 'data', 'cache', 'renfe_av_ld_gtfs.zip');
const PORT = 4399;
const MIN_TRAINS = Number(process.argv[2] ?? 100);
const STOP_MISMATCH_KM = 3; // same threshold as the panel
const FEEDS = { vp: 'https://gtfsrt.renfe.com/vehicle_positions_LD.json', tu: 'https://gtfsrt.renfe.com/trip_updates_LD.json' };

// 1. Capture the raw files (one request each, like the app).
const realFetch = globalThis.fetch;
const raw = {};
for (const [k, url] of Object.entries(FEEDS)) {
  const res = await realFetch(url, { headers: { 'User-Agent': 'atlas-ferroviario/0.1 (validation)' } });
  raw[k] = { text: await res.text(), lastModified: res.headers.get('last-modified') };
}
const published = Date.parse(raw.vp.lastModified);
const outDir = path.join(ROOT, 'docs', 'validation', new Date(published).toISOString().replace(/[:.]/g, '-').slice(0, 19) + 'Z');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'vehicle_positions_LD.json'), raw.vp.text);
fs.writeFileSync(path.join(outDir, 'trip_updates_LD.json'), raw.tu.text);

// 2. Run the real server on that file pair, with the clock at the publication time (+ 20 s).
let clock = published + 20_000;
const realNow = Date.now;
const offset = clock - realNow();
Date.now = () => realNow() + offset + (clock - published - 20_000);
globalThis.fetch = async (url, opts) => {
  const k = String(url).includes('vehicle_positions_LD') ? 'vp' : String(url).includes('trip_updates_LD') ? 'tu' : null;
  if (!k) return realFetch(url, opts);
  return new Response(raw[k].text, { headers: { 'content-type': 'application/json', 'last-modified': raw[k].lastModified } });
};
syncBuiltinESMExports();
process.env.PORT = String(PORT);
process.chdir(ROOT);
const log = console.log; console.log = () => {};
const { handle } = await import(path.join(ROOT, 'server.mjs'));
http.createServer(handle).listen(PORT);
const base = `http://127.0.0.1:${PORT}`;
// Respects the server's own rate limit (it applies to this script too): on 429, wait and retry.
const get = async (p) => {
  for (;;) {
    const r = await realFetch(base + p);
    if (r.status !== 429) return r.ok ? r.json() : { status: r.status };
    await new Promise((res) => setTimeout(res, 61_000));
  }
};
for (let i = 0; i < 100 && (await realFetch(base + '/api/stations')).status !== 200; i++) await new Promise((r) => setTimeout(r, 1000));
for (let i = 0; i < 100 && !(await get('/api/network')).features?.length; i++) await new Promise((r) => setTimeout(r, 1000));
console.log = log;

// 3. Independent reading of the official timetable (not the app's parser).
const csv = (name) => {
  const [head, ...rows] = execFileSync('unzip', ['-p', GTFS_ZIP, name], { maxBuffer: 1 << 28 }).toString('utf8').replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);
  const cols = head.split(',').map((c) => c.trim());
  return rows.map((r) => Object.fromEntries(r.split(',').map((v, i) => [cols[i], v.trim()])));
};
const stops = new Map(csv('stops.txt').map((s) => [s.stop_id, s]));
const trips = new Map(csv('trips.txt').map((t) => [t.trip_id, t]));
const stopTimes = new Map();
for (const r of csv('stop_times.txt')) (stopTimes.get(r.trip_id) ?? stopTimes.set(r.trip_id, []).get(r.trip_id)).push(r);
for (const list of stopTimes.values()) list.sort((a, b) => Number(a.stop_sequence) - Number(b.stop_sequence));
const toRad = (d) => (d * Math.PI) / 180;
const km = (a, b) => 2 * 6371 * Math.asin(Math.sqrt(Math.sin(toRad(b.lat - a.lat) / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(toRad(b.lon - a.lon) / 2) ** 2));

// 4. Compare.
const vp = JSON.parse(raw.vp.text), tu = JSON.parse(raw.tu.text);
const delays = new Map(tu.entity.filter((e) => e.tripUpdate).map((e) => [e.tripUpdate.trip.tripId, e.tripUpdate.delay ?? null]));
const live = await get('/api/live');
const byNumber = new Map();
const coverage = { rawEntities: vp.entity.length, notInTimetable: [], noCoordinates: [], splitDuplicates: {}, timetableOnlyNoPosition: live.withoutPosition };
for (const e of vp.entity) {
  const v = e.vehicle ?? {}, tid = v.trip?.tripId, t = trips.get(tid);
  if (!t) { coverage.notInTimetable.push(tid); continue; }
  if (!Number.isFinite(v.position?.latitude)) { coverage.noCoordinates.push(tid); continue; }
  (byNumber.get(t.trip_short_name) ?? byNumber.set(t.trip_short_name, []).get(t.trip_short_name)).push(v);
}
const defects = [], contradictions = [], routes = { checked: 0, legsDrawn: 0, legsTotal: 0, legMismatches: 0 };
for (const [number, variants] of byNumber) {
  if (variants.length > 1) coverage.splitDuplicates[number] = variants.map((v) => v.trip.tripId);
  // The variant the app must show: the one reporting a stop (Renfe's split-train duplicates), else the last.
  const v = [...variants.filter((x) => !x.stopId), ...variants.filter((x) => x.stopId)].at(-1);
  const tid = v.trip.tripId, marker = live.trains.find((t) => t.number === number);
  const d = (await get(`/api/train?number=${number}`)).train;
  const fail = (what) => defects.push({ number, tripId: tid, what });
  if (!marker) { fail('no map marker'); continue; }
  if (marker.tripId !== tid) fail(`marker uses ${marker.tripId}`);
  if (!d) { fail('detail missing'); continue; }
  if (d.tripId !== tid) fail(`detail uses ${d.tripId}`);
  if (d.position?.lat !== v.position.latitude || d.position?.lon !== v.position.longitude) fail('detail coordinates differ');
  if (marker.position.lat !== v.position.latitude || marker.position.lon !== v.position.longitude) fail('marker coordinates differ');
  if ((d.reportedStatus ?? null) !== (v.currentStatus ?? null)) fail(`status ${d.reportedStatus} vs ${v.currentStatus}`);
  const official = (stopTimes.get(tid) ?? []).map((r) => r.stop_id);
  if (v.stopId && official.includes(v.stopId) && d.reportedStopId !== v.stopId) fail(`stop ${d.reportedStopId} vs ${v.stopId}`);
  if (JSON.stringify(d.stops.map((s) => s.id)) !== JSON.stringify(official)) fail('stop list differs from GTFS');
  if ((d.delaySec ?? null) !== (delays.has(tid) ? delays.get(tid) : null)) fail(`delay ${d.delaySec} vs ${delays.get(tid)}`);
  if (d.observedAt !== null) fail('observedAt invented');
  const s = stops.get(v.stopId);
  if (v.currentStatus === 'STOPPED_AT' && s) {
    const dist = km({ lat: v.position.latitude, lon: v.position.longitude }, { lat: Number(s.stop_lat), lon: Number(s.stop_lon) });
    if (dist > STOP_MISMATCH_KM) {
      contradictions.push({ number, stop: s.stop_name, km: Math.round(dist * 10) / 10 });
      if (!(d.reportedStopKm > STOP_MISMATCH_KM)) fail('contradiction not flagged');
    }
  }
  const r = await get(`/api/route?number=${number}`);
  if (r.available) {
    routes.checked++; routes.legsDrawn += r.drawn; routes.legsTotal += r.total;
    const pairs = official.slice(1).map((id, i) => [stops.get(official[i])?.stop_name, stops.get(id)?.stop_name]);
    if (r.legs.length !== pairs.length || r.legs.some((l, i) => l.from !== pairs[i][0] || l.to !== pairs[i][1])) { routes.legMismatches++; fail('route legs differ from official stops'); }
  }
}
// Stale data: three minutes later, the same file must be reported as unavailable for the corridor view.
const sample = [...byNumber.keys()][0];
clock = published + 20_000 + 3 * 60_000;
const staleAfter = sample ? await get(`/api/context?number=${sample}`) : null; // context cache (15 s) has expired
const staleOk = !sample || staleAfter?.near?.reason === 'stale' || staleAfter?.near?.reason === 'route';
if (!staleOk) defects.push({ number: sample, what: `stale file not flagged in corridor (${JSON.stringify(staleAfter?.near)})` });

const gtfsHash = createHash('sha256').update(fs.readFileSync(GTFS_ZIP)).digest('hex');
const result = {
  publishedAt: new Date(published).toISOString(), madridTime: new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', dateStyle: 'short', timeStyle: 'medium' }).format(published),
  gtfsZipSha256: gtfsHash, trainsCompared: byNumber.size, minTrains: MIN_TRAINS, sampleTargetMet: byNumber.size >= MIN_TRAINS,
  defects, contradictions, routes, staleCheck: { train: sample, near: staleAfter?.near ?? null, ok: staleOk }, coverage,
};
fs.writeFileSync(path.join(outDir, 'result.json'), JSON.stringify(result, null, 1));
fs.writeFileSync(path.join(outDir, 'NOTICE.md'), `Raw files: Renfe Operadora, CC BY 4.0 (https://data.renfe.com/), unmodified, published ${raw.vp.lastModified}.
Timetable: Renfe GTFS AV/LD (not stored here), sha256 ${gtfsHash}. Results: produced by scripts/validate.mjs.\n`);
log(JSON.stringify({ outDir: path.relative(ROOT, outDir), trains: byNumber.size, targetMet: result.sampleTargetMet, defects: defects.length, contradictions: contradictions.length, splitDuplicates: Object.keys(coverage.splitDuplicates).length, routes, stale: result.staleCheck.ok }));
process.exit(defects.length ? 1 : 0);
