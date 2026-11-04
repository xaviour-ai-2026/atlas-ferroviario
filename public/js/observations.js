// Atlas Ferroviario — per-session observation history and honest freshness labels.
// Renfe's AV/LD feed publishes positions without a per-train measurement time, so we can only say WHEN A
// POSITION APPEARED in a published file, never when it was measured. A position that stops changing could be
// a stopped train OR stale telemetry; the feed cannot tell them apart, and neither do we.

import { haversineKm } from './physics.js';

export const FEED_STALE_MS = 2 * 60_000;   // published file older than this = whole feed is stale
export const UNCHANGED_MS = 5 * 60_000;    // same position for this long = "sin cambios" (ambiguous)
export const MAX_HISTORY = 20;             // distinct positions kept per train, this browser session only
export const MIN_MOVE_KM = 0.05;           // smaller shifts are GPS jitter (seen at stations), not movement

/**
 * Record a snapshot into history (Map tripId → { points: [{lat, lon, publishedAt, observedAt}], lastChangeAt }).
 * publishedAt = the feed file's Last-Modified time (when Renfe published it), falling back to our fetch time.
 */
export function recordSnapshot(history, snapshot) {
  const publishedAt = snapshot.positions?.lastModified ?? snapshot.positions?.fetchedAt ?? snapshot.generatedAt;
  for (const t of snapshot.trains) {
    if (!t.position) continue;
    const h = history.get(t.tripId) ?? { points: [], lastChangeAt: publishedAt, firstSeenAt: publishedAt };
    const last = h.points.at(-1);
    if (!last || haversineKm(last, t.position) >= MIN_MOVE_KM) {
      // observedAt stays null unless the source publishes a real measurement time for this train.
      h.points.push({ lat: t.position.lat, lon: t.position.lon, publishedAt, observedAt: t.observedAt ?? null });
      if (h.points.length > MAX_HISTORY) h.points.shift();
      h.lastChangeAt = publishedAt;
    }
    history.set(t.tripId, h);
  }
  return history;
}

/**
 * Classify a train for display. Returns one of:
 *  'live'        position received in a recent file (measurement time unknown)
 *  'unchanged'   same position for ≥ UNCHANGED_MS while the feed kept updating (stopped OR stale: unknown)
 *  'feed-stale'  the whole positions file is old or failed
 *  'no-position' timetable says it should be running, but no position is published
 */
export function trainState(train, hist, snapshot, nowMs) {
  if (!train.position) return 'no-position';
  const lm = snapshot.positions?.lastModified;
  if (!snapshot.positions?.ok || !lm || nowMs - lm > FEED_STALE_MS) return 'feed-stale';
  if (hist && hist.points.length && lm - hist.lastChangeAt >= UNCHANGED_MS) return 'unchanged';
  return 'live';
}

export const STATE_LABELS = {
  live: 'Posición recibida',
  unchanged: 'Posición sin cambios',
  'feed-stale': 'Datos antiguos',
  'no-position': 'Sin posición publicada',
};

/** Index of the last stop Renfe reports as reached (STOPPED_AT includes that stop), else null. Never inferred. */
export function reachedIndex(train) {
  if (!train?.reportedStopId || !train.reportedStatus) return null;
  const i = train.stops.findIndex((s) => s.id === train.reportedStopId);
  if (i < 0) return null;
  return train.reportedStatus === 'STOPPED_AT' ? i : i - 1;
}
