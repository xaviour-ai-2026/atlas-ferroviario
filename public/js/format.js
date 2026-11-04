// Atlas Ferroviario — shared display helpers (Madrid time, delays, escaping, search normalisation).

const madridClockFmt = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit' });
const madridClockSecFmt = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** Epoch ms → "18:19" (or "18:19:12" with seconds), Madrid time. */
export const clock = (ms, seconds = false) => (ms == null ? '—' : (seconds ? madridClockSecFmt : madridClockFmt).format(ms));

/** GTFS service-day seconds → "19:14" (wraps past midnight). */
export const serviceTime = (s) => {
  const m = Math.round(s / 60) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

/** Age in plain Spanish: "12 s", "3 min". */
export const age = (ms) => (ms < 90_000 ? `${Math.max(0, Math.round(ms / 1000))} s` : `${Math.round(ms / 60_000)} min`);

/** Renfe-reported delay in calm wording. */
export const delayText = (sec) => {
  if (sec == null) return null;
  const min = Math.round(sec / 60);
  if (min === 0) return 'En hora';
  return min > 0 ? `${min} min de retraso` : `${-min} min adelantado`;
};

/** Escape text for HTML templates. */
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Lower-case, accent-free text for forgiving search ("cordoba" finds "Córdoba"). */
export const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Cities with several stations keep the station part ("Madrid-Puerta de Atocha-…" → "Madrid Puerta de Atocha").
const MULTI_STATION_CITIES = new Set(['Madrid', 'Barcelona', 'Sevilla', 'Zaragoza', 'Guadalajara', 'Málaga', 'València', 'Valencia']);

/** Shorter display name: drops dedication suffixes ("Córdoba-Julio Anguita" → "Córdoba"). Official name stays in data. */
export const shortName = (name) => {
  const parts = String(name ?? '').split('-');
  if (parts.length < 2) return parts[0];
  return MULTI_STATION_CITIES.has(parts[0]) ? `${parts[0]} ${parts[1]}` : parts[0];
};

/** Madrid service-day seconds for "now" (for timetable comparisons in the browser). */
export const nowServiceSeconds = (ms = Date.now()) => {
  const [h, m, s] = madridClockSecFmt.format(ms).split(':').map(Number);
  return h * 3600 + m * 60 + s;
};

// Small stroke icon(s) for the card (inline SVG, inherits currentColor; decorative).
const ICONS = {
  external: '<path d="M14 5h5v5"/><path d="M19 5 11 13"/><path d="M18 14v5H5V6h5"/>',
};
export const icon = (name) => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONS[name] ?? ''}</svg>`;

export const STATUS_TEXT ={ STOPPED_AT: 'Detenido en', INCOMING_AT: 'Llegando a', IN_TRANSIT_TO: 'En camino a' };
