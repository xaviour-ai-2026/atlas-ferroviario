// Atlas Ferroviario — the one detail panel (right-hand on desktop, bottom sheet on phones): a train's route awareness
// as three swipeable panes (Viaje · Corredor · Datos), a station board, or "about this map". Also the Atlas-style
// stop timeline and the two map callouts for a selected train.
// Every value says where it comes from (Renfe live feed, official timetable, Renfe forecast, OSM estimate). No speed,
// no ETAs of our own, no distances between trains, no risk language beyond the informational notice.

import { clock, serviceTime, delayText, age, esc, shortName, nowServiceSeconds, icon, STATUS_TEXT } from './format.js';
import { FEED_STALE_MS } from './observations.js';

const STOP_MISMATCH_KM = 3; // "Detenido en X" with coordinates further than this from X: shown as a disagreement

const RENFE_LINK = `<a class="link" href="https://www.renfe.com/es/es" target="_blank" rel="noopener">Información oficial de Renfe ${icon('external')}</a>`;
const NOTICE = '<p class="notice">Informativo: no es un sistema de seguridad ni de emergencias (112). Posiciones tal como las publica Renfe.</p>';
const GRIP = '<button class="grip" data-action="sheet" aria-label="Ampliar o reducir el panel"><span aria-hidden="true"></span></button>';
const CLOSE = '<button class="close" data-action="close" aria-label="Cerrar">×</button>';

const fact = (label, value, note) => `<div class="fact"><dt>${label}</dt><dd>${value}</dd>${note ? `<dd class="fact-note">${note}</dd>` : ''}</div>`;
const trainName = (t) => `${esc(t.product)} ${esc(t.number)}`;
const trainButton = (t, sub) => `<button class="ctx-row" data-action="train" data-value="${esc(t.number)}" title="${sub}">
  <span class="ctx-main">${trainName(t)}</span><span class="ctx-sub">${sub}</span></button>`;

const LEG_STATUS = { unmatched: 'estación sin vía cartografiada cerca', 'no-path': 'sin conexión en la red de OSM', implausible: 'trazado no coherente con el horario' };

/** Where Renfe says the train is, and which stop is next (Renfe first, timetable as fallback). */
export function progress(t) {
  const now = nowServiceSeconds();
  const reportedIdx = t.reportedStopId ? t.stops.findIndex((s) => s.id === t.reportedStopId) : -1;
  const next = t.reportedStatus && t.reportedStatus !== 'STOPPED_AT' && reportedIdx >= 0 ? { idx: reportedIdx, by: 'según Renfe' }
    : reportedIdx >= 0 ? { idx: reportedIdx + 1, by: 'según horario' }
    : { idx: t.stops.findIndex((s) => s.dep > now), by: 'según horario' };
  const reached = t.position && reportedIdx >= 0 ? (t.reportedStatus === 'STOPPED_AT' ? reportedIdx : reportedIdx - 1) : null;
  return { reportedIdx, reached, next: next.idx >= 0 && next.idx < t.stops.length ? next : null, stoppedAt: t.position && t.reportedStatus === 'STOPPED_AT' };
}

/** "Recorrido en el mapa": how much of the journey is drawn over real OSM track, and what is missing. */
function routeSummary(route) {
  if (!route) return '<p class="route-note">Calculando el recorrido…</p>';
  if (!route.available) return `<p class="route-note">${esc(route.reason)} Se muestran solo las paradas.</p>`;
  const missing = route.legs.filter((l) => l.status !== 'track');
  return `<p class="route-note"><span class="route-swatch" aria-hidden="true"></span>${route.drawn} de ${route.total} tramos sobre vías reales de OpenStreetMap.
      <strong>Estimado</strong>: Renfe no publica el trazado.</p>
    ${missing.length ? `<p class="route-missing">Sin trazado: ${missing.map((l) => `${esc(shortName(l.from))} → ${esc(shortName(l.to))}`).join(' · ')}</p>` : ''}`;
}

/** Horizontal progress strip of official stops: passed dimmed, next highlighted, the train where Renfe places it. */
export function stopStrip(t, p = progress(t)) {
  return `<ol class="strip" aria-label="Paradas · horario oficial">${t.stops.map((s, i) => {
    const cls = [p.reached != null && i <= p.reached ? 'passed' : '', p.next?.idx === i ? 'next' : '', i === 0 ? 'first' : ''].join(' ').trim();
    const here = p.reached == null ? '' : p.stoppedAt && i === p.reached ? '<span class="here at" aria-hidden="true"></span>'
      : !p.stoppedAt && i === p.reached + 1 ? '<span class="here before" aria-hidden="true"></span>' : '';
    return `<li class="${cls}"${p.next?.idx === i ? ' aria-current="step"' : ''}>${here}<span class="n">${i + 1}</span>
      <span class="s-name">${esc(shortName(s.name))}</span><span class="s-time">${serviceTime(i === 0 ? s.dep : s.arr)}</span></li>`;
  }).join('')}</ol>`;
}

/** "Contexto del corredor": published trains near the drawn route + official calls at the next stops. Never risk. */
function corridor(ctx) {
  if (!ctx) return '<p class="subtle">Cargando el contexto del corredor…</p>';
  const near = ctx.near;
  const nearHtml = !near.available
    ? `<p class="ctx-empty">${near.reason === 'route' ? 'Sin recorrido dibujado: no se puede situar a otros trenes en el corredor.'
      : near.reason === 'stale' ? 'El fichero de posiciones de Renfe tiene más de 2 minutos: no se listan trenes cercanos.'
      : 'Renfe no responde: sin posiciones publicadas ahora.'}</p>`
    : near.trains.length
      ? `<div class="ctx-list">${near.trains.slice(0, 4).map((o) => trainButton(o, `→ ${esc(shortName(o.destination))}${o.reportedStatus && o.reportedStop ? ` · ${STATUS_TEXT[o.reportedStatus] ?? 'Cerca de'} ${esc(shortName(o.reportedStop))}` : ''}`)).join('')}</div>
        ${near.trains.length > 4 ? `<p class="ctx-more">y ${near.trains.length - 4} más cerca del recorrido</p>` : ''}`
      : `<p class="ctx-empty">Ningún otro tren de Renfe con posición publicada a menos de ${ctx.nearKm} km del resto del recorrido dibujado. No significa que la vía esté libre.</p>`;
  const sharedHtml = ctx.shared.length
    ? ctx.shared.map((s) => `<div class="node"><p class="node-head"><span class="node-name">${esc(shortName(s.name))}</span><span class="node-time">${serviceTime(s.time)}</span></p>
        ${s.trains.length ? `<div class="chips">${s.trains.slice(0, 4).map((o) => `<button class="chip" data-action="train" data-value="${esc(o.number)}" title="${esc(shortName(o.origin))} → ${esc(shortName(o.destination))} · ${serviceTime(o.time)}">${trainName(o)} <span>${serviceTime(o.time)}</span></button>`).join('')}${s.trains.length > 4 ? `<span class="chip-more">+${s.trains.length - 4}</span>` : ''}</div>`
          : '<p class="ctx-empty">Sin otros trenes de Renfe programados.</p>'}</div>`).join('')
    : '<p class="ctx-empty">Sin próximas paradas en las 3 horas siguientes del horario.</p>';
  return `<div class="ctx-grid">
      <div><h4>Cerca del resto del recorrido <span class="h4-note">posición publicada a ≤ ${ctx.nearKm} km</span></h4>${nearHtml}</div>
      <div><h4>Próximas paradas compartidas <span class="h4-note">horario oficial ±${ctx.windowMin} min</span></h4>${sharedHtml}</div>
      <p class="note">«Cerca» no implica la misma vía ni el mismo sentido. Iryo, Ouigo, mercancías y los trenes sin posición publicada no aparecen.</p>
    </div>`;
}

/** Where Renfe places the train, as short HTML ("Detenido en Córdoba" + source). */
function whereText(t) {
  return t.position && t.reportedStatus && t.reportedStop
    ? `${STATUS_TEXT[t.reportedStatus] ?? 'Cerca de'} ${esc(shortName(t.reportedStop))}<span class="by">según Renfe</span>`
    : t.position ? 'Posición publicada en el mapa<span class="by">Renfe</span>' : 'Renfe no publica su posición ahora';
}

/** Vertical list for the Viaje pane: passed stops folded into one row, the next stop and up to 5 after it. */
function stopList(t, p) {
  const start = p.next?.idx ?? (p.reached != null ? p.reached + 1 : 0);
  const shown = t.stops.slice(start, start + 6);
  const rest = t.stops.length - start - shown.length;
  return `<ol class="stop-list">
    ${start > 0 ? `<li class="sum passed"><span class="n">✓</span><span class="sl-name">${start} ${start === 1 ? 'parada pasada' : 'paradas pasadas'} · desde ${esc(shortName(t.stops[0].name))}</span></li>` : ''}
    ${shown.map((s, k) => { const i = start + k; return `<li class="${p.next?.idx === i ? 'next' : ''}"><span class="n">${i + 1}</span>
      <span class="sl-name">${esc(shortName(s.name))}${p.next?.idx === i ? `<span class="tag">Próxima · ${p.next.by}</span>` : ''}</span>
      <span class="sl-time">${serviceTime(i === 0 ? s.dep : s.arr)}</span></li>`; }).join('')}
    ${rest > 0 ? `<li class="sum"><span class="n">+</span><span class="sl-name">${rest} más hasta ${esc(shortName(t.stops.at(-1).name))}</span></li>` : ''}
  </ol>`;
}

export const TABS = ['Viaje', 'Corredor', 'Datos'];

/**
 * Train panel. `positions` is the live feed metadata (publication time), never a measurement time.
 * The three panes sit side by side in a scroll-snap carousel; app.js scrolls it to `tab`.
 */
export function trainCard(t, positions, route, ctx, tab = 0) {
  const p = progress(t);
  const next = p.next ? t.stops[p.next.idx] : null;
  const lm = positions?.lastModified;
  const fresh = positions?.ok && lm && Date.now() - lm <= FEED_STALE_MS;
  const conflict = t.position && t.reportedStatus === 'STOPPED_AT' && t.reportedStopKm > STOP_MISMATCH_KM;
  const nearCount = ctx?.near?.available ? ctx.near.trains.length : null;
  const tabLabel = (name, i) => (i === 1 && nearCount ? `${name} · ${nearCount}` : name);

  return `<header class="sheet-head">${GRIP}
      <div class="head-main">
        <p class="eyebrow">${trainName(t)} · Renfe</p>
        <h2 class="title" tabindex="-1">${esc(shortName(t.origin))} <span class="arrow" aria-hidden="true">→</span><span class="sr-only">a</span> ${esc(shortName(t.destination))}</h2>
      </div>
      ${CLOSE}
    </header>
    <p class="state ${t.position ? 'published' : 'missing'}"><span class="dot" aria-hidden="true"></span>${whereText(t)}</p>
    ${conflict ? `<p class="conflict">Las coordenadas publicadas están a ${String(t.reportedStopKm).replace('.', ',')} km de ${esc(shortName(t.reportedStop))}. Renfe publica ambos datos; se muestran tal cual.</p>` : ''}
    <div class="sheet-strip">${stopStrip(t, p)}</div>
    <div class="tabs" role="tablist" aria-label="Detalles del tren">${TABS.map((name, i) => `<button role="tab" id="tab-${i}" aria-controls="pane-${i}"
      aria-selected="${i === tab}" tabindex="${i === tab ? 0 : -1}" data-action="tab" data-value="${i}">${tabLabel(name, i)}</button>`).join('')}</div>
    <div class="panes">
      <section class="pane" id="pane-0" role="tabpanel" aria-labelledby="tab-0">
        <dl class="facts">
          ${fact('Próxima parada', next ? esc(shortName(next.name)) : 'Fin del recorrido', next ? `parada ${p.next.by} · horario ${serviceTime(next.arr)}` : 'según horario')}
          ${fact('Retraso', t.cancelled ? 'Cancelado' : t.delaySec != null ? esc(delayText(t.delaySec)) : 'Sin dato', t.cancelled ? 'según Renfe' : t.delaySec != null ? 'previsión de Renfe' : 'Renfe no ha publicado retraso')}
          ${fact('Publicado', positions?.ok && lm ? `hace ${age(Date.now() - lm)}` : 'No disponible', positions?.ok && lm ? `${clock(lm)} · fichero de Renfe` : 'Renfe no responde')}
          ${fact('Fuente', !t.position ? 'Horario oficial' : fresh ? 'Renfe en vivo' : 'Fichero antiguo', fresh || !t.position ? 'datos abiertos de Renfe' : 'posición de hace más de 2 min')}
        </dl>
        <h3>Paradas · horario oficial</h3>
        ${stopList(t, p)}
        <p class="note">${p.reached != null ? 'Avance según la estación que publica Renfe, no según la hora.' : 'Sin avance: Renfe no publica en qué parada está.'}</p>
      </section>
      <section class="pane" id="pane-1" role="tabpanel" aria-labelledby="tab-1">
        <p class="ctx-lead">Solo informativo: no indica riesgo, conflicto ni distancia entre trenes.</p>
        ${corridor(ctx)}
      </section>
      <section class="pane" id="pane-2" role="tabpanel" aria-labelledby="tab-2">
        <h3>Recorrido en el mapa</h3>
        ${routeSummary(route)}
        <h3>Limitaciones de los datos</h3>
        <ul class="limits">
          <li>Solo Renfe alta velocidad, larga y media distancia. Iryo y Ouigo no publican posiciones abiertas; sin Cercanías ni mercancías.</li>
          <li>Renfe no publica la hora de medición: «Publicado» es la hora del fichero.</li>
          <li>Trenes sin posición publicada no aparecen en el mapa ni en «Corredor».</li>
          <li>A veces el estado de Renfe y sus coordenadas no coinciden; se muestran tal cual.</li>
        </ul>
        <details class="tech">
          <summary>Detalles técnicos</summary>
          <ul>
            <li>Posición: GTFS-Realtime de Renfe (AV/LD/MD)${lm ? `, fichero de las ${clock(lm, true)}` : ''}.</li>
            <li>Recorrido: camino más corto por la red ferroviaria de OpenStreetMap entre paradas oficiales consecutivas; se descartan tramos sin vía cercana, sin conexión o incompatibles con el horario.${route?.osmTimestamp ? ` Datos OSM de ${esc(route.osmTimestamp.slice(0, 10))}.` : ''}</li>
            ${route?.available ? `<li>Tramos: ${route.legs.map((l) => `${esc(shortName(l.from))} → ${esc(shortName(l.to))}: ${l.status === 'track' ? `${l.km} km por vía` : esc(LEG_STATUS[l.status])}`).join('; ')}.</li>` : ''}
            <li>No se calcula velocidad ni riesgo. Viaje GTFS: ${esc(t.tripId)}.</li>
          </ul>
        </details>
        ${RENFE_LINK}
        ${NOTICE.replace('class="notice"', 'class="notice in-pane"')}
      </section>
    </div>
    ${NOTICE}`;
}

/** Map callout above the selected train: what Renfe says about it, in two lines. */
export function trainCallout(t) {
  return `<p class="co-eyebrow">${trainName(t)}</p><p class="co-main">${whereText(t)}</p>
    ${t.delaySec != null || t.cancelled ? `<p class="co-sub">${t.cancelled ? 'Cancelado según Renfe' : `${esc(delayText(t.delaySec))} · previsión de Renfe`}</p>` : ''}`;
}

/** Map callout beside the next stop (official timetable time). */
export function nextCallout(t) {
  const p = progress(t);
  if (!p.next) return '';
  const s = t.stops[p.next.idx];
  return `<p class="co-eyebrow">Próxima parada</p><p class="co-main">${esc(shortName(s.name))}</p><p class="co-sub">horario ${serviceTime(s.arr)} · parada ${p.next.by}</p>`;
}

/** Placeholder sheet while a train loads, or when its number is not in today's timetable. */
export function pendingCard(number, missing) {
  return `<header class="sheet-head">${GRIP}<div class="head-main"><p class="eyebrow">Renfe</p><h2 class="title" tabindex="-1">Tren ${esc(number)}</h2></div>${CLOSE}</header>
    <p class="subtle">${missing ? 'No aparece en el horario de hoy de Renfe (alta velocidad, larga y media distancia).' : 'Cargando…'}</p>`;
}

/** Station sheet: official timetable for the next 3 hours, with Renfe's delay forecast where published. */
export function stationCard(station, calls) {
  return `<header class="sheet-head">${GRIP}
      <div class="head-main"><p class="eyebrow">Estación · próximas 3 horas</p><h2 class="title" tabindex="-1">${esc(shortName(station.name))}</h2></div>
      ${CLOSE}
    </header>
    <p class="subtle">${esc(station.name)}</p>
    ${calls == null ? '<p class="subtle">Cargando el horario oficial…</p>' : calls.length ? `<ul class="board">${calls.map((c) => `<li>
        <button class="board-row" data-action="train" data-value="${esc(c.number)}">
          <span class="time">${serviceTime(c.time)}</span>
          <span class="board-main">${c.terminates ? `Llega desde ${esc(shortName(c.origin))}` : esc(shortName(c.destination))}</span>
          <span class="board-sub">${esc(c.product)} ${esc(c.number)}</span>
          ${c.cancelled ? '<span class="pill">Cancelado</span>' : c.delaySec != null ? `<span class="pill${c.delaySec >= 300 ? ' warm' : ''}">${esc(delayText(c.delaySec))}</span>` : ''}
        </button></li>`).join('')}</ul>` : '<p class="subtle">Sin trenes de Renfe de alta velocidad, larga o media distancia en las próximas 3 horas.</p>'}
    <p class="note">Horario oficial de Renfe. El retraso es la previsión que publica Renfe. Iryo y Ouigo no publican datos abiertos.</p>
    ${NOTICE}`;
}

/** "About this map": coverage, sources, licences, privacy and the technical limits. */
export function infoCard(live) {
  const p = live?.positions;
  return `<header class="sheet-head">${GRIP}
      <div class="head-main"><p class="eyebrow">Sobre este mapa</p><h2 class="title" tabindex="-1">Qué muestra y qué no</h2></div>
      ${CLOSE}
    </header>
    <div class="info-cols">
    <section><h3>Cobertura</h3>
    <ul>
      <li>Trenes de <strong>Renfe</strong> de alta velocidad, larga y media distancia, solo cuando Renfe publica su posición${live ? ` (ahora ${live.trains.length}; otros ${live.withoutPosition} circulan según el horario sin posición publicada)` : ''}.</li>
      <li><strong>Iryo y Ouigo</strong> no publican posiciones abiertas: no aparecen. Cercanías, mercancías y vehículos de mantenimiento no están incluidos. Que no aparezca un tren no significa que no haya tráfico.</li>
      <li>Estaciones: todas las del horario oficial de Renfe para estos servicios.</li>
    </ul></section>
    <section><h3>Precisión</h3>
    <ul>
      <li>Cada tren está en las coordenadas que publica Renfe, sin ajustar a la vía ni animar.</li>
      <li>El recorrido de un tren seleccionado es una <strong>estimación</strong> sobre vías reales de OpenStreetMap; los tramos sin vía coherente no se dibujan.</li>
      <li>«Contexto del corredor» solo lista posiciones publicadas cerca del recorrido y paradas del horario oficial; no indica riesgo ni distancia entre trenes.</li>
      <li>Renfe no publica la hora de medición de cada posición; mostramos la hora de publicación del fichero${p?.ok && p.lastModified ? ` (${clock(p.lastModified, true)})` : ''}.</li>
      <li>No calculamos velocidad, riesgos ni incidencias. Un mapa base o capa que no carga no indica nada sobre los trenes.</li>
    </ul></section>
    <section><h3>Fuentes y licencias</h3>
    <ul>
      <li>Trenes y horarios: <a href="https://data.renfe.com/" target="_blank" rel="noopener">Renfe Operadora</a>, CC BY 4.0. Renfe no patrocina este proyecto.</li>
      <li>Mapa base: <a href="https://openfreemap.org/" target="_blank" rel="noopener">OpenFreeMap</a> · © <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> · © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> (ODbL).</li>
      <li>Recorridos: red ferroviaria de <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> (ODbL) vía Overpass API.</li>
      <li>Capa opcional de vías: <a href="https://www.openrailwaymap.org/" target="_blank" rel="noopener">OpenRailwayMap</a>, datos © OpenStreetMap.</li>
      <li>Motor del mapa: MapLibre GL JS 6.16.0 (BSD-3-Clause). Código del proyecto: MIT.</li>
    </ul></section>
    <section><h3>Privacidad</h3>
    <ul><li>Sin cuentas, cookies, anuncios ni analítica. Tu navegador pide las teselas del mapa a OpenFreeMap (vía Cloudflare) y, si activas «Vías», a OpenRailwayMap.</li></ul></section>
    </div>
    ${NOTICE}`;
}
