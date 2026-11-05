// Atlas Ferroviario — one full-screen geographic map of Spain (MapLibre GL JS + OpenFreeMap, restyled deep navy), an
// optional OpenRailwayMap overlay, Renfe stations and the train positions Renfe publishes. One search, one bottom sheet.
// Three states: overview (whole network, calm) → route focus (a selected train's estimated route over real OSM
// track becomes the hero, everything else recedes, the camera tilts into the corridor under a horizon glow) → route
// awareness (desktop: Atlas-style right panel + stop timeline + map callouts; phones: bottom sheet; both with
// swipeable Viaje · Corredor · Datos panes). Data comes only from the local read-only proxy (server.mjs).
// Positions are drawn exactly where Renfe reports them; nothing is interpolated or animated along the track.

import * as maplibregl from './vendor/maplibre-gl-6.16.0/maplibre-gl.mjs';
import { trainState, FEED_STALE_MS } from './js/observations.js';
import { trainCard, pendingCard, stationCard, infoCard, progress, stopStrip, trainCallout, nextCallout } from './js/card.js';
import { age, esc, norm, shortName, delayText } from './js/format.js';

const POLL_MS = 15_000;
const BASEMAP = 'https://tiles.openfreemap.org/styles/fiord';
const ORM_TILES = 'https://tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png';
const ORM_MAX_ERRORS = 6; // then stop asking (tile policy: back off on repeated failures, stop on 429)
const SPAIN = [[-10.2, 35.6], [4.6, 44.0]];
const MAJOR_STATIONS = 35; // busiest stations shown at national zoom; the rest appear when zoomed in
const FOCUS_PITCH = 50;    // Atlas "low tilt": depth and horizon glow without crushing the far end of the route
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = (id) => document.getElementById(id);

const state = { stations: [], major: new Set(), live: null, card: null, query: '', overlay: 'off', ormErrors: 0, basemapFailed: false };
// card: { kind: 'train', number, train, route, ctx } | { kind: 'station', id, calls } | { kind: 'info' } | null
const phone = () => matchMedia('(max-width: 700px)').matches;
// Wide screens show details in a right-hand panel; narrower ones in a bottom sheet (must match styles.css).
const sideMode = () => matchMedia('(min-width: 901px)').matches;

// ---------- map ----------
const map = new maplibregl.Map({
  container: 'map',
  style: BASEMAP,
  bounds: SPAIN,
  fitBoundsOptions: { padding: 24 },
  maxBounds: [[-22, 25], [14, 51]], // generous: tall phone screens must still be able to show all of Spain
  minZoom: 4,
  maxZoom: 15,
  maxPitch: 60,
  // Basemap credits come from OpenFreeMap's TileJSON; the overlay's from its source; Renfe's is added here.
  attributionControl: { compact: true, customAttribution: 'Trenes: <a href="https://data.renfe.com/" target="_blank" rel="noopener">Renfe Operadora</a> (CC BY 4.0) · Recorridos: © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> (ODbL)' },
});
// Fit mainland Spain into the area left free by the floating search and status (phones especially).
const spainPadding = () => (phone()
  ? { top: 70, bottom: 90, left: 8, right: 8 } : { top: 90, bottom: 90, left: 40, right: 40 });
map.fitBounds(SPAIN, { animate: false, padding: spainPadding() });

const emptyFC = { type: 'FeatureCollection', features: [] };

/** Deep-navy restyle of the OpenFreeMap Fiord style: calm land/water, faint roads, quiet teal OSM railways. */
function navyBasemap() {
  const set = (id, prop, value) => { try { map.setPaintProperty(id, prop, value); } catch { /* property not on this layer */ } };
  for (const l of map.getStyle().layers) {
    const id = l.id;
    if (l.type === 'background') set(id, 'background-color', '#0b1524');
    else if (l.type === 'fill') {
      if (/water/.test(id)) set(id, 'fill-color', '#060d18');
      else { set(id, 'fill-color', '#0f1b2c'); set(id, 'fill-opacity', /building/.test(id) ? 0.25 : 0.55); }
    } else if (l.type === 'line') {
      if (/rail/.test(id)) {
        if (/dash/.test(id)) map.setLayoutProperty(id, 'visibility', 'none');
        else { set(id, 'line-color', '#245c66'); set(id, 'line-opacity', 0.85); }
      } else if (/water/.test(id)) set(id, 'line-color', '#0a1626');
      else if (/boundary|admin/.test(id)) { set(id, 'line-color', '#3a4d69'); set(id, 'line-opacity', 0.7); }
      else { set(id, 'line-color', '#17263a'); set(id, 'line-opacity', 0.8); }
    } else if (l.type === 'symbol') {
      if (/road|highway|shield|transportation|poi/.test(id)) map.setLayoutProperty(id, 'visibility', 'none');
      else { set(id, 'text-color', '#8399b4'); set(id, 'text-halo-color', '#0b1524'); set(id, 'text-halo-width', 1.2); }
    }
  }
}

/** Train markers drawn once on a canvas: a lit capsule with a soft glow (published) and a grey one (old file). */
function addTrainIcons() {
  const marker = (body, edge, glow) => {
    const r = 2, w = 40 * r, h = 26 * r, c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    if (glow) { // soft halo under the capsule: depth, not alarm
      const halo = g.createRadialGradient(w / 2, h / 2, 2 * r, w / 2, h / 2, h / 2);
      halo.addColorStop(0, glow); halo.addColorStop(1, 'rgba(127,240,245,0)');
      g.fillStyle = halo; g.fillRect(0, 0, w, h);
    }
    const cw = 24 * r, ch = 11 * r, x = (w - cw) / 2, y = (h - ch) / 2;
    const fill = g.createLinearGradient(0, y, 0, y + ch);
    fill.addColorStop(0, '#ffffff'); fill.addColorStop(1, body);
    g.beginPath(); g.roundRect(x, y, cw, ch, ch / 2);
    g.fillStyle = fill; g.fill(); g.lineWidth = 1.5 * r; g.strokeStyle = edge; g.stroke();
    g.fillStyle = edge; g.fillRect(x + cw * 0.3, y + ch * 0.4, cw * 0.4, ch * 0.2); // window band: reads as a train
    return { width: w, height: h, data: g.getImageData(0, 0, w, h).data };
  };
  if (!map.hasImage('train')) map.addImage('train', marker('#bdf3f8', '#0b1524', 'rgba(127,240,245,0.38)'), { pixelRatio: 2 });
  if (!map.hasImage('train-stale')) map.addImage('train-stale', marker('#6c7b8e', '#0b1524', null), { pixelRatio: 2 });
}

// The selected train: a DOM marker (CSS glow + slow breathing ring, still under reduced motion) placed exactly at
// Renfe's published coordinates. Only its appearance animates; its position never does.
const selEl = document.createElement('div');
selEl.className = 'sel-marker';
selEl.setAttribute('aria-hidden', 'true');
selEl.innerHTML = '<span class="ring"></span><span class="ring r2"></span><span class="core"></span>';
const selMarker = new maplibregl.Marker({ element: selEl });
// Atlas-style callouts: what Renfe says about the selected train, and its next stop. Text only, anchored to
// published coordinates and official stop locations.
const callout = (cls) => { const el = document.createElement('div'); el.className = `callout ${cls}`; el.setAttribute('aria-hidden', 'true'); return el; };
const trainCo = new maplibregl.Marker({ element: callout('co-train'), anchor: 'bottom', offset: [0, -30] });
const nextCo = new maplibregl.Marker({ element: callout('co-next'), anchor: 'left', offset: [20, 0] });

/** Our sources and layers; re-added whenever a style (basemap or fallback) finishes loading. */
function addLayers() {
  if (!state.basemapFailed) navyBasemap();
  // Night-sky horizon and distance fog: only visible when the camera tilts into a corridor.
  map.setSky({ 'sky-color': '#081120', 'horizon-color': '#15485a', 'fog-color': '#0b1524', 'sky-horizon-blend': 0.6,
    'horizon-fog-blend': 0.7, 'fog-ground-blend': 0.35, 'atmosphere-blend': 0 });
  addTrainIcons();
  const hasGlyphs = !!map.getStyle().glyphs;
  const firstSymbol = map.getStyle().layers.find((l) => l.type === 'symbol')?.id;
  // Spanish-first place names where OpenStreetMap has them.
  for (const l of map.getStyle().layers) {
    if (l.type === 'symbol' && JSON.stringify(l.layout?.['text-field'] ?? '').includes('name')) {
      map.setLayoutProperty(l.id, 'text-field', ['coalesce', ['get', 'name:es'], ['get', 'name:latin'], ['get', 'name']]);
    }
  }
  map.addSource('orm', { type: 'raster', tiles: [ORM_TILES], tileSize: 256, maxzoom: 18,
    attribution: 'Vías: <a href="https://www.openrailwaymap.org/" target="_blank" rel="noopener">OpenRailwayMap</a>' });
  map.addLayer({ id: 'orm', type: 'raster', source: 'orm', paint: { 'raster-opacity': 0.5, 'raster-saturation': -0.55 },
    layout: { visibility: state.overlay === 'on' ? 'visible' : 'none' } }, firstSymbol);
  const text = { 'text-font': ['Noto Sans Regular'], 'text-size': 11.5, 'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-optional': true };
  // The national rail network (real OSM geometry, thinned): quiet teal, high-speed lines a little brighter.
  map.addSource('network', { type: 'geojson', data: '/api/network' });
  map.addLayer({ id: 'network', type: 'line', source: 'network', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: {
    'line-color': ['case', ['get', 'hs'], '#2f8591', '#1e4a57'],
    'line-width': ['interpolate', ['linear'], ['zoom'], 5, ['case', ['get', 'hs'], 1.3, 0.8], 10, ['case', ['get', 'hs'], 2.2, 1.4]] } }, firstSymbol);
  // Stations: busiest ones at national zoom, the rest only when zoomed in; route stops always when selected.
  map.addSource('stations', { type: 'geojson', data: stationsFC() });
  const stationPaint = { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 2.2, 9, 3.5, 13, 5],
    'circle-color': '#0b1524', 'circle-stroke-color': '#93a8c2', 'circle-stroke-width': 1.2 };
  map.addLayer({ id: 'stations', type: 'circle', source: 'stations', filter: ['get', 'major'], paint: stationPaint });
  map.addLayer({ id: 'stations-minor', type: 'circle', source: 'stations', minzoom: 9, filter: ['!', ['get', 'major']], paint: stationPaint });
  // Estimated route over real OSM track (only legs matched to track exist in this source). The hero: a wide soft
  // glow, a luminous line and a bright core; legs already passed (per Renfe's reported stop) recede.
  map.addSource('route-line', { type: 'geojson', data: emptyFC });
  const lineLayout = { 'line-cap': 'round', 'line-join': 'round' };
  map.addLayer({ id: 'route-glow', type: 'line', source: 'route-line', layout: lineLayout, paint: {
    'line-color': '#3fd0e0', 'line-blur': 10, 'line-opacity': ['case', ['get', 'passed'], 0.08, 0.38],
    'line-width': ['interpolate', ['linear'], ['zoom'], 5, 14, 10, 24] } });
  map.addLayer({ id: 'route-line', type: 'line', source: 'route-line', layout: lineLayout, paint: {
    'line-color': ['case', ['get', 'passed'], '#3d7686', '#7ff0f5'], 'line-opacity': ['case', ['get', 'passed'], 0.75, 1],
    'line-width': ['interpolate', ['linear'], ['zoom'], 5, 3, 10, 5.5] } });
  map.addLayer({ id: 'route-core', type: 'line', source: 'route-line', filter: ['!', ['get', 'passed']], layout: lineLayout, paint: {
    'line-color': '#f2feff', 'line-opacity': 0.85, 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.8, 10, 1.6] } });
  // Official stops of the selected train: numbered; passed dimmed, the next one ringed.
  map.addSource('route', { type: 'geojson', data: emptyFC });
  map.addLayer({ id: 'route-next', type: 'circle', source: 'route', filter: ['==', ['get', 'phase'], 'next'], paint: {
    'circle-radius': 17, 'circle-color': 'rgba(127,240,245,0.14)', 'circle-stroke-color': 'rgba(127,240,245,0.55)', 'circle-stroke-width': 1 } });
  map.addLayer({ id: 'route-stops', type: 'circle', source: 'route', paint: {
    'circle-radius': hasGlyphs ? 9 : 5, 'circle-color': ['match', ['get', 'phase'], 'passed', '#16293b', '#0b1524'],
    'circle-stroke-color': ['match', ['get', 'phase'], 'passed', '#4d6f80', 'next', '#7ff0f5', '#e8fbff'],
    'circle-stroke-width': ['match', ['get', 'phase'], 'next', 2.5, 1.6] } });
  // Trains: lit capsules; with a train selected the rest recede, except trains near its route (corridor context).
  map.addSource('trains', { type: 'geojson', data: emptyFC });
  map.addLayer({ id: 'trains', type: 'symbol', source: 'trains', filter: ['!', ['get', 'selected']], layout: {
    'icon-image': ['match', ['get', 'state'], 'feed-stale', 'train-stale', 'train'], 'icon-allow-overlap': true,
    'icon-size': ['interpolate', ['linear'], ['zoom'], 4, 0.72, 8, 0.95, 12, 1.2] },
    paint: { 'icon-opacity': ['case', ['get', 'ctx'], 0.85, ['get', 'dim'], 0.16, 1] } });
  if (hasGlyphs) {
    const labelPaint = { 'text-color': '#a9bbd1', 'text-halo-color': '#0b1524', 'text-halo-width': 1.4 };
    map.addLayer({ id: 'station-labels', type: 'symbol', source: 'stations', minzoom: 5.6, filter: ['get', 'major'], layout: { ...text, 'text-field': ['get', 'short'] }, paint: labelPaint });
    map.addLayer({ id: 'station-labels-minor', type: 'symbol', source: 'stations', minzoom: 10, filter: ['!', ['get', 'major']], layout: { ...text, 'text-field': ['get', 'short'] }, paint: labelPaint });
    map.addLayer({ id: 'route-stop-num', type: 'symbol', source: 'route', layout: { 'text-field': ['get', 'n'], 'text-font': ['Noto Sans Regular'],
      'text-size': 10, 'text-allow-overlap': true, 'text-ignore-placement': true },
      paint: { 'text-color': ['match', ['get', 'phase'], 'passed', '#7d94a8', '#eafcff'] } });
    // Names for the key stops (ends, the next one, where Renfe places the train); the rest once zoomed in.
    const routeLabel = { ...text, 'text-field': ['get', 'name'], 'text-size': ['case', ['get', 'key'], 12.5, 11.5], 'text-offset': [0, 1.35] };
    const routeLabelPaint = { 'text-color': ['match', ['get', 'phase'], 'passed', '#7d94a8', '#eafcff'], 'text-halo-color': '#0b1524', 'text-halo-width': 1.8 };
    map.addLayer({ id: 'route-labels', type: 'symbol', source: 'route', filter: ['get', 'key'], layout: routeLabel, paint: routeLabelPaint });
    map.addLayer({ id: 'route-labels-minor', type: 'symbol', source: 'route', minzoom: 7.5, filter: ['!', ['get', 'key']], layout: routeLabel, paint: routeLabelPaint });
    map.addLayer({ id: 'train-labels', type: 'symbol', source: 'trains', minzoom: 7, layout: { ...text, 'text-field': ['get', 'label'], 'text-size': 11, 'text-offset': [0, 1.2] },
      paint: { 'text-color': '#cfe3f2', 'text-halo-color': '#0b1524', 'text-halo-width': 1.6, 'text-opacity': ['case', ['get', 'ctx'], 0.85, ['get', 'dim'], 0, 1] } });
  }
  paintData();
}
map.on('style.load', addLayers);
map.on('moveend', () => calloutsApart());
// The Fiord style asks for icons its sprite lacks (e.g. "circle-11" for place dots): supply a small muted dot.
map.setMissingStyleImageResolver(async (id) => {
  if (map.hasImage(id)) return;
  const size = 8, data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if ((x - 3.5) ** 2 + (y - 3.5) ** 2 <= 9) data.set([131, 153, 180, 255], (y * size + x) * 4);
  }
  map.addImage(id, { width: size, height: size, data }, { pixelRatio: 2 });
});

// Basemap failure → a plain background so stations and trains still work. Overlay failure → hide only the overlay.
const FALLBACK_STYLE = { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#0b1524' } }] };
map.on('error', (e) => {
  if (e.sourceId === 'orm') {
    state.ormErrors += 1;
    if (e.error?.status === 429 || state.ormErrors >= ORM_MAX_ERRORS) setOverlay('unavailable');
    return;
  }
  if (!map.isStyleLoaded() && !state.basemapFailed && !e.sourceId) {
    state.basemapFailed = true;
    map.setStyle(FALLBACK_STYLE);
    renderStatus();
  }
});

for (const id of ['trains', 'stations', 'stations-minor']) {
  map.on('mouseenter', id, () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', id, () => { map.getCanvas().style.cursor = ''; });
}
map.on('click', (e) => {
  const f = map.queryRenderedFeatures(e.point, { layers: ['trains', 'stations', 'stations-minor'].filter((l) => map.getLayer(l)) })[0];
  if (!f) return;
  if (f.layer.id.startsWith('train')) openTrain(f.properties.number);
  else openStation(f.properties.id);
});

// ---------- data → map ----------
function stationsFC() {
  return { type: 'FeatureCollection', features: state.stations.map((s) => ({
    type: 'Feature', geometry: { type: 'Point', coordinates: [s.lon, s.lat] }, properties: { id: s.id, short: shortName(s.name), major: state.major.has(s.id) } })) };
}

function paintData() {
  if (!map.getSource('trains')) return;
  const c = state.card?.kind === 'train' ? state.card : null;
  const trains = state.live?.trains ?? [];
  const near = new Set(c?.ctx?.near?.trains?.map((t) => t.number) ?? []);
  map.getSource('trains').setData({ type: 'FeatureCollection', features: trains.map((t) => ({
    type: 'Feature', geometry: { type: 'Point', coordinates: [t.position.lon, t.position.lat] },
    properties: { number: t.number, label: `${t.product} ${t.number}`, selected: t.number === c?.number, dim: !!c && t.number !== c.number,
      ctx: near.has(t.number), state: trainState(t, null, state.live, Date.now()) } })) });
  // The selected train's official stops, with their place in the journey as Renfe reports it.
  const p = c?.train ? progress(c.train) : null;
  const stops = c?.train ? c.train.stops.map((s, i) => ({ ...s, i })).filter((s) => Number.isFinite(s.lat)) : [];
  const last = c?.train ? c.train.stops.length - 1 : -1;
  const phase = (i) => (p?.next?.idx === i ? 'next' : p?.reached != null && i <= p.reached ? 'passed' : 'upcoming');
  map.getSource('route').setData({ type: 'FeatureCollection', features: stops.map((s) => ({
    type: 'Feature', geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
    properties: { name: shortName(s.name), n: String(s.i + 1), phase: phase(s.i),
      key: s.i === 0 || s.i === last || s.i === p?.next?.idx || s.i === p?.reportedIdx } })) });
  const reached = p?.reached;
  map.getSource('route-line').setData(c?.route?.geojson ? { type: 'FeatureCollection', features: c.route.geojson.features.map((f) => ({
    ...f, properties: { ...f.properties, passed: reached != null && f.properties.leg + 1 <= reached } })) } : emptyFC);
  // With a train selected, its route is the focus: the network fades, stations step aside.
  map.setPaintProperty('network', 'line-opacity', c ? 0.22 : 1);
  for (const id of ['stations', 'stations-minor', 'station-labels', 'station-labels-minor']) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', c ? 'none' : 'visible');
  }
  const pos = c?.train?.position;
  if (pos) {
    selMarker.setLngLat([pos.lon, pos.lat]).addTo(map);
    trainCo.getElement().innerHTML = trainCallout(c.train);
    trainCo.setLngLat([pos.lon, pos.lat]).addTo(map);
  } else { selMarker.remove(); trainCo.remove(); }
  // The next-stop callout only when the train callout does not already name that stop ("En camino a X").
  const nextStop = p?.next ? c.train.stops[p.next.idx] : null;
  const named = pos && c.train.reportedStatus !== 'STOPPED_AT' && c.train.reportedStopId === nextStop?.id;
  if (nextStop && Number.isFinite(nextStop.lat) && !named) {
    nextCo.getElement().innerHTML = nextCallout(c.train);
    nextCo.setLngLat([nextStop.lon, nextStop.lat]).addTo(map);
  } else nextCo.remove();
  calloutsApart();
}

/** Hide the next-stop callout while it would sit on top of the train's (checked after every camera move). */
function calloutsApart() {
  const a = trainCo.getLngLat?.(), b = nextCo.getLngLat?.();
  if (!a || !b || !trainCo.getElement().isConnected || !nextCo.getElement().isConnected) return;
  const pa = map.project(a), pb = map.project(b);
  nextCo.getElement().style.visibility = Math.hypot(pa.x - pb.x, pa.y - pb.y) < 190 ? 'hidden' : 'visible';
}

/** One calm status chip: how many trains Renfe publishes, how fresh the file is, and who is missing. */
function renderStatus() {
  const p = state.live?.positions;
  const el = $('status');
  const base = state.basemapFailed ? ' · mapa base no disponible' : '';
  const info = '<button class="info-link" data-action="info" aria-label="Más información sobre la cobertura">ⓘ</button>';
  if (!state.live) el.innerHTML = `Cargando datos oficiales de Renfe…${base}`;
  else if (!p?.ok) el.innerHTML = `<strong>Renfe no responde ahora.</strong> Sin posiciones; el horario sigue disponible.${base} ${info}`;
  else {
    // An old positions file must not read as "live": no glowing dot, and say so.
    const stale = Date.now() - p.lastModified > FEED_STALE_MS;
    el.innerHTML = `<span class="live-dot${stale ? ' stale' : ''}" aria-hidden="true"></span><strong>${state.live.trains.length} trenes Renfe</strong><span class="sep">·</span>${stale ? 'datos antiguos · ' : ''}hace ${age(Date.now() - p.lastModified)}<span class="sep">·</span><span class="muted">sin Iryo ni Ouigo</span>${base} ${info}`;
  }
}

// ---------- card ----------
/** Shareable deep link for the open card: #tren=02161 or #estacion=60000 (no personal data). */
function syncHash() {
  const c = state.card;
  const hash = c?.kind === 'train' ? `#tren=${c.number}` : c?.kind === 'station' ? `#estacion=${c.id}` : '';
  if (location.hash !== hash) history.replaceState(null, '', hash || location.pathname);
}

function renderCard({ focus = false } = {}) {
  const el = $('card');
  const c = state.card;
  syncHash();
  el.hidden = !c;
  document.body.classList.toggle('card-open', !!c);
  document.body.classList.toggle('focus', c?.kind === 'train');
  renderTimeline();
  if (!c) { document.body.classList.remove('sheet-expanded'); return; }
  // Phones: fold the (still one-tap) attribution while the sheet is open, so it does not sit over the train.
  if (phone()) document.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');
  // The sheet refreshes every 15 s: keep scroll, keyboard focus and open/closed sections as the user left them.
  const scroll = el.scrollTop;
  const stripScroll = el.querySelector('.strip')?.scrollLeft;
  const active = el.contains(document.activeElement) ? document.activeElement : null;
  const key = active?.dataset.action ? `[data-action="${active.dataset.action}"][data-value="${CSS.escape(active.dataset.value ?? '')}"]`
    : active?.matches('h2, summary, a') ? active.tagName.toLowerCase() : null;
  const open = Object.fromEntries([...el.querySelectorAll('details')].map((d) => [d.className, d.open]));
  const paneScroll = [...el.querySelectorAll('.pane')].map((x) => x.scrollTop);
  el.innerHTML = c.kind === 'train' ? (c.train ? trainCard(c.train, state.live?.positions, c.route, c.ctx, c.tab ?? 0) : pendingCard(c.number, c.missing))
    : c.kind === 'station' ? stationCard(state.stations.find((s) => s.id === c.id) ?? { name: '' }, c.calls)
    : infoCard(state.live);
  if (!focus) for (const d of el.querySelectorAll('details')) if (open[d.className]) d.open = true;
  el.scrollTop = focus ? 0 : scroll;
  if (!focus) el.querySelectorAll('.pane').forEach((x, i) => { x.scrollTop = paneScroll[i] ?? 0; });
  showTab(c.tab ?? 0, false);
  const strip = el.querySelector('.strip');
  if (strip && !focus && stripScroll != null) strip.scrollLeft = stripScroll;
  else if (strip) { // first view: bring the next stop into view
    const next = strip.querySelector('.next');
    if (next) strip.scrollLeft = next.offsetLeft - strip.clientWidth / 2 + next.offsetWidth / 2;
  }
  if (focus) requestAnimationFrame(() => el.querySelector('h2')?.focus({ preventScroll: true }));
  else if (key) el.querySelector(key)?.focus({ preventScroll: true });
}

/** Desktop: the Atlas-style stop timeline along the bottom of the map (the same strip the phone sheet shows). */
function renderTimeline() {
  const el = $('timeline');
  const t = state.card?.kind === 'train' ? state.card.train : null;
  el.hidden = !t;
  if (!t) return;
  const left = el.querySelector('.strip')?.scrollLeft;
  el.innerHTML = stopStrip(t);
  const strip = el.querySelector('.strip');
  const next = strip.querySelector('.next');
  strip.scrollLeft = left ?? (next ? next.offsetLeft - strip.clientWidth / 2 + next.offsetWidth / 2 : 0);
}

/** Show one of the Viaje · Corredor · Datos panes (a scroll-snap carousel: tabs, swipe or arrow keys). */
function showTab(i, animate = true) {
  const panes = $('card').querySelector('.panes');
  if (!panes) return;
  if (state.card) state.card.tab = i;
  $('card').querySelectorAll('[role="tab"]').forEach((b, k) => { b.setAttribute('aria-selected', String(k === i)); b.tabIndex = k === i ? 0 : -1; });
  const left = i * panes.clientWidth;
  panes.scrollTo({ left, behavior: animate && !reducedMotion() ? 'smooth' : 'instant' });
  // Some environments never run the smooth scroll (e.g. a page that is not painting): land on the pane anyway.
  if (animate) setTimeout(() => { if (state.card?.tab === i && Math.abs(panes.scrollLeft - left) > 2) panes.scrollTo({ left, behavior: 'instant' }); }, 450);
}
// A swipe on the carousel selects the pane it settles on (debounced scroll: Safari lacks "scrollend").
let settle;
$('card').addEventListener('scroll', (e) => {
  const panes = e.target;
  if (!panes.classList?.contains('panes') || !state.card) return;
  clearTimeout(settle);
  settle = setTimeout(() => {
    const i = Math.round(panes.scrollLeft / panes.clientWidth);
    if (i !== state.card?.tab) showTab(i, false);
  }, 140);
}, true);
$('card').addEventListener('keydown', (e) => {
  const tab = e.target.closest('[role="tab"]');
  if (!tab || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
  const n = $('card').querySelectorAll('[role="tab"]').length;
  const i = (Number(tab.dataset.value) + (e.key === 'ArrowRight' ? 1 : n - 1)) % n;
  showTab(i); $('card').querySelector(`#tab-${i}`)?.focus();
});

/** Height of the map covered at the bottom (phone sheet, or the desktop timeline), for camera padding and controls. */
const sheetHeight = () => (sideMode() ? ($('timeline').hidden ? 0 : $('timeline').offsetHeight)
  : $('card').hidden ? 0 : $('card').offsetHeight);
/** Width covered on the right by the desktop panel. */
const panelWidth = () => (sideMode() && !$('card').hidden ? $('card').offsetWidth + 16 : 0);
const coverage = new ResizeObserver(() => {
  document.documentElement.style.setProperty('--sheet-h', `${sheetHeight()}px`);
  document.documentElement.style.setProperty('--panel-w', `${panelWidth()}px`);
});
coverage.observe($('card')); coverage.observe($('timeline'));

/** Move the camera, keeping the target in the part of the map the sheet does not cover. Map padding is never left
 * set (it would skew every later camera fit); the sheet is accounted for with an offset instead. */
function ease(opts) {
  const offset = [-panelWidth() / 2, -sheetHeight() / 2];
  return map.easeTo({ ...opts, offset, duration: reducedMotion() ? 0 : 700 });
}

const getJson = (url) => fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null);

async function openTrain(number) {
  state.card = { kind: 'train', number, train: null, route: null, ctx: null };
  const c = state.card;
  renderCard({ focus: true }); paintData();
  const [, route] = await Promise.all([refreshTrain(), getJson(`/api/route?number=${encodeURIComponent(number)}`)]);
  if (state.card !== c) return;
  c.route = route;
  renderCard(); paintData();
  focusJourney();
  await refreshContext();
}
/** Fly into the corridor: fit the drawn route, stops and train above the sheet, with a gentle tilt. */
function focusJourney() {
  const c = state.card;
  if (c?.kind !== 'train' || !c.train) return;
  const pts = [...(c.route?.geojson?.features ?? []).flatMap((f) => f.geometry.coordinates),
    ...c.train.stops.filter((s) => Number.isFinite(s.lat)).map((s) => [s.lon, s.lat])];
  if (c.train.position) pts.push([c.train.position.lon, c.train.position.lat]);
  if (!pts.length) return;
  const lons = pts.map((p) => p[0]), lats = pts.map((p) => p[1]);
  const padding = sideMode() ? { top: 110, bottom: sheetHeight() + 50, left: 70, right: panelWidth() + 70 }
    : { top: 84, bottom: sheetHeight() + 28, left: 34, right: 34 };
  const cam = map.cameraForBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { padding, maxZoom: 10 });
  if (!cam) return;
  // Tilting pushes the far side of the route away: step back a little so the whole journey stays in view.
  // Phones have little map above the sheet: a softer tilt and a slightly wider view keep both ends in sight.
  const target = sideMode() ? { center: cam.center, zoom: cam.zoom - 0.2, pitch: FOCUS_PITCH, bearing: 0 }
    : { center: cam.center, zoom: cam.zoom - 0.7, pitch: 25, bearing: 0 };
  if (reducedMotion()) map.jumpTo(target); else map.flyTo({ ...target, duration: 1600, curve: 1.3, essential: true });
}
/** Back to the whole country, flat (closes any sheet). */
function showSpain() {
  closeCard();
  const cam = map.cameraForBounds(SPAIN, { padding: spainPadding() });
  const target = { center: cam.center, zoom: cam.zoom, pitch: 0, bearing: 0 };
  if (reducedMotion()) map.jumpTo(target); else map.flyTo({ ...target, duration: 1200, essential: true });
}
async function refreshTrain() {
  const c = state.card;
  if (c?.kind !== 'train') return;
  try {
    const res = await fetch(`/api/train?number=${encodeURIComponent(c.number)}`);
    const body = await res.json();
    if (state.card !== c) return;
    c.train = res.ok ? body.train : null;
    c.missing = !res.ok;
  } catch { /* keep the last good sheet */ }
  renderCard(); paintData();
}
/** Corridor context (published trains near the route + timetable calls at the next stops); informational only. */
async function refreshContext() {
  const c = state.card;
  if (c?.kind !== 'train' || c.missing) return;
  const ctx = await getJson(`/api/context?number=${encodeURIComponent(c.number)}`);
  if (state.card !== c) return;
  if (ctx) c.ctx = ctx;
  else c.ctx ??= { nearKm: 2, windowMin: 30, near: { available: false, reason: 'positions' }, shared: [] };
  renderCard(); paintData();
}
async function openStation(id) {
  const s = state.stations.find((x) => x.id === id);
  state.card = { kind: 'station', id, calls: null };
  renderCard({ focus: true }); paintData();
  if (s) ease({ center: [s.lon, s.lat], zoom: Math.max(map.getZoom(), 9) });
  await refreshStation();
}
async function refreshStation() {
  const c = state.card;
  if (c?.kind !== 'station') return;
  try { c.calls = (await (await fetch(`/api/station?id=${encodeURIComponent(c.id)}`)).json()).calls; } catch { c.calls ??= []; }
  if (state.card === c) renderCard();
}
function closeCard() { state.card = null; renderCard(); paintData(); if (map.getPitch()) map.easeTo({ pitch: 0, duration: reducedMotion() ? 0 : 600 }); }
function openInfo() { state.card = state.card?.kind === 'info' ? null : { kind: 'info' }; renderCard({ focus: true }); paintData(); }

// ---------- overlay toggle ----------
function setOverlay(next) {
  state.overlay = next;
  if (map.getLayer('orm')) map.setLayoutProperty('orm', 'visibility', next === 'on' ? 'visible' : 'none');
  const b = $('overlay-toggle');
  b.setAttribute('aria-pressed', String(next === 'on'));
  b.disabled = next === 'unavailable';
  b.textContent = next === 'unavailable' ? 'Vías no disponibles' : 'Vías';
}

// ---------- search: published trains, today's timetable by number, and every Renfe station ----------
function searchResults() {
  const q = norm(state.query.trim());
  if (!q) return [];
  const digits = q.replace(/^0+/, '');
  const trains = (state.live?.trains ?? []).filter((t) => (digits && t.number.includes(digits)) || norm(`${t.product} ${t.origin} ${t.destination}`).includes(q)).slice(0, 5)
    .map((t) => ({ kind: 'train', value: t.number, main: `${t.product} ${t.number}`, sub: `${shortName(t.origin)} → ${shortName(t.destination)}${t.delaySec != null ? ` · ${delayText(t.delaySec)}` : ''}` }));
  const stations = state.stations.filter((s) => norm(s.name).includes(q)).sort((a, b) => norm(a.name).indexOf(q) - norm(b.name).indexOf(q)).slice(0, 6)
    .map((s) => ({ kind: 'station', value: s.id, main: shortName(s.name), sub: 'Estación' }));
  const lookup = /^\d{3,5}$/.test(q) && !trains.some((t) => t.value === q.padStart(5, '0'))
    ? [{ kind: 'train', value: q.padStart(5, '0'), main: `Tren ${q.padStart(5, '0')}`, sub: 'Buscar en el horario de hoy' }] : [];
  // Numbers look for trains first; words look for stations first.
  return /^\d/.test(q) ? [...trains, ...lookup, ...stations] : [...stations, ...trains];
}
function renderResults() {
  const list = $('results');
  const items = searchResults();
  list.hidden = !state.query.trim();
  $('q').setAttribute('aria-expanded', String(!list.hidden));
  list.innerHTML = items.length
    ? items.map((r) => `<li role="option"><button class="result" data-action="${r.kind}" data-value="${esc(r.value)}"><span class="result-main">${esc(r.main)}</span><span class="result-sub">${esc(r.sub)}</span></button></li>`).join('')
    : '<li class="result-empty">Sin resultados. Prueba con una estación o un número de tren.</li>';
}
function clearSearch() { state.query = ''; $('q').value = ''; renderResults(); }

// ---------- events ----------
$('q').addEventListener('input', (e) => { state.query = e.target.value; renderResults(); });
$('q').addEventListener('keydown', (e) => {
  const first = $('results').querySelector('.result');
  if (e.key === 'ArrowDown' && first) { e.preventDefault(); first.focus(); }
  if (e.key === 'Enter' && first) { e.preventDefault(); first.click(); }
});
$('results').addEventListener('keydown', (e) => {
  const items = [...$('results').querySelectorAll('.result')];
  const i = items.indexOf(document.activeElement);
  if (e.key === 'ArrowDown' && i < items.length - 1) { e.preventDefault(); items[i + 1].focus(); }
  if (e.key === 'ArrowUp') { e.preventDefault(); (i > 0 ? items[i - 1] : $('q')).focus(); }
});
$('overlay-toggle').addEventListener('click', () => setOverlay(state.overlay === 'on' ? 'off' : 'on'));
$('info-toggle').addEventListener('click', openInfo);
$('home').addEventListener('click', showSpain);
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const { action, value } = el.dataset;
  if (action === 'train') { clearSearch(); openTrain(value); }
  if (action === 'station') { clearSearch(); openStation(value); }
  if (action === 'close') closeCard();
  if (action === 'info') openInfo();
  if (action === 'sheet') document.body.classList.toggle('sheet-expanded');
  if (action === 'tab') showTab(Number(value));
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { if (state.query) clearSearch(); else closeCard(); }
  if (e.key === '/' && !e.target.matches('input')) { e.preventDefault(); $('q').focus(); }
});

// ---------- data loading ----------
async function loadStations() {
  try {
    const res = await fetch('/api/stations');
    if (!res.ok) return false;
    state.stations = (await res.json()).stations.filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lon));
    state.major = new Set([...state.stations].sort((a, b) => (b.trips ?? 0) - (a.trips ?? 0)).slice(0, MAJOR_STATIONS).map((s) => s.id));
    map.getSource('stations')?.setData(stationsFC());
    return true;
  } catch { return false; }
}
async function poll() {
  // Stations and live trains are independent requests: fetch them together; paint once both have settled.
  const live = fetch('/api/live').then((r) => r.json()).catch(() => null);
  if (!state.stations.length) await loadStations();
  state.live = await live;
  renderStatus(); paintData();
  if (state.card?.kind === 'train') { await refreshTrain(); await refreshContext(); }
  if (state.card?.kind === 'station') await refreshStation();
  if (state.card?.kind === 'info') renderCard();
  if (state.query) renderResults();
}
async function start() {
  await poll();
  const [, kind, value] = location.hash.match(/^#(tren|estacion)=([\w-]+)$/) ?? [];
  if (kind === 'tren') openTrain(value);
  if (kind === 'estacion') openStation(value);
  setInterval(poll, POLL_MS);
}
start();
