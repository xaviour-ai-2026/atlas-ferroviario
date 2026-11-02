// Rail Safety Spain — the one bottom sheet: a train's route awareness, a station board, or "about this map".
// Every value says where it comes from (Renfe live feed, official timetable, Renfe forecast, OSM estimate). No speed,
// no ETAs of our own, no distances between trains, no risk language beyond the informational notice.

import { clock, serviceTime, delayText, age, esc, shortName, nowServiceSeconds, icon, STATUS_TEXT } from './format.js';

const RENFE_LINK = `<a class="link" href="https://www.renfe.com/es/es" target="_blank" rel="noopener">Información oficial de Renfe ${icon('external')}</a>`;
const NOTICE = '<p class="notice">Informativo: no es un sistema de seguridad ni de emergencias (112). Posiciones tal como las publica Renfe.</p>';
const GRIP = '<button class="grip" data-action="sheet" aria-label="Ampliar o reducir el panel"><span aria-hidden="true"></span></button>';
const CLOSE = '<button class="close" data-action="close" aria-label="Cerrar">×</button>';

const fact = (label, value, note) => `<div class="fact"><dt>${label}</dt><dd>${value}</dd>${note ? `<dd class="fact-note">${note}</dd>` : ''}</div>`;
const trainName = (t) => `${esc(t.product)} ${esc(t.number)}`;
const trainButton = (t, sub) => `<button class="ctx-row" data-action="train" data-value="${esc(t.number)}">
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
function strip(t, p) {
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
    ? `<p class="ctx-empty">${near.reason === 'route' ? 'Sin recorrido dibujado: no se puede situar a otros trenes en el corredor.' : 'Renfe no responde: sin posiciones publicadas ahora.'}</p>`
    : near.trains.length
      ? `<div class="ctx-list">${near.trains.slice(0, 6).map((o) => trainButton(o, `→ ${esc(shortName(o.destination))}${o.reportedStatus && o.reportedStop ? ` · ${STATUS_TEXT[o.reportedStatus] ?? 'Cerca de'} ${esc(shortName(o.reportedStop))}` : ''}`)).join('')}</div>
        ${near.trains.length > 6 ? `<p class="ctx-empty">y ${near.trains.length - 6} más</p>` : ''}`
      : `<p class="ctx-empty">Ningún otro tren publicado a menos de ${ctx.nearKm} km del resto del recorrido dibujado.</p>`;
  const sharedHtml = ctx.shared.length
    ? ctx.shared.map((s) => `<div class="node"><p class="node-head"><span class="node-name">${esc(shortName(s.name))}</span><span class="node-time">${serviceTime(s.time)}</span></p>
        ${s.trains.length ? `<div class="chips">${s.trains.slice(0, 8).map((o) => `<button class="chip" data-action="train" data-value="${esc(o.number)}" title="${esc(shortName(o.origin))} → ${esc(shortName(o.destination))} · ${serviceTime(o.time)}">${trainName(o)} <span>${serviceTime(o.time)}</span></button>`).join('')}${s.trains.length > 8 ? `<span class="chip-more">+${s.trains.length - 8}</span>` : ''}</div>`
          : '<p class="ctx-empty">Sin otros trenes de Renfe programados.</p>'}</div>`).join('')
    : '<p class="ctx-empty">Sin próximas paradas en las 3 horas siguientes del horario.</p>';
  return `<div class="ctx-grid">
      <div><h4>Cerca del resto del recorrido</h4>${nearHtml}
        <p class="note">Posición publicada a ≤ ${ctx.nearKm} km de la línea dibujada. No implica la misma vía ni el mismo sentido.</p></div>
      <div><h4>Próximas paradas compartidas</h4>${sharedHtml}
        <p class="note">Otros trenes del horario oficial en la misma estación, ±${ctx.windowMin} min. Iryo y Ouigo no publican datos: pueden faltar.</p></div>
    </div>`;
}

/** Train sheet. `positions` is the live feed metadata (publication time), never a measurement time. */
export function trainCard(t, positions, route, ctx) {
  const p = progress(t);
  const next = p.next ? t.stops[p.next.idx] : null;
  const lm = positions?.lastModified;
  const where = t.position && t.reportedStatus && t.reportedStop
    ? `${STATUS_TEXT[t.reportedStatus] ?? 'Cerca de'} ${esc(shortName(t.reportedStop))}<span class="by">según Renfe</span>`
    : t.position ? 'Posición publicada en el mapa<span class="by">Renfe</span>' : 'Renfe no publica su posición ahora';

  return `<header class="sheet-head">${GRIP}
      <div class="head-main">
        <p class="eyebrow">${trainName(t)} · Renfe</p>
        <h2 class="title" tabindex="-1">${esc(shortName(t.origin))} <span class="arrow" aria-hidden="true">→</span><span class="sr-only">a</span> ${esc(shortName(t.destination))}</h2>
      </div>
      <p class="state ${t.position ? 'published' : 'missing'}"><span class="dot" aria-hidden="true"></span>${where}</p>
      ${CLOSE}
    </header>
    ${strip(t, p)}
    <p class="strip-note">${p.reached != null ? 'Avance según la estación que publica Renfe, no según la hora.' : 'Sin avance: Renfe no publica en qué parada está.'}</p>
    <div class="sheet-grid">
      <dl class="facts">
        ${fact('Próxima parada', next ? esc(shortName(next.name)) : 'Fin del recorrido', next ? `${p.next.by} · ${serviceTime(next.arr)}` : 'según horario')}
        ${fact('Retraso', t.cancelled ? 'Cancelado' : t.delaySec != null ? esc(delayText(t.delaySec)) : 'Sin dato', t.cancelled ? 'según Renfe' : t.delaySec != null ? 'previsión de Renfe' : 'Renfe no ha publicado retraso')}
        ${fact('Publicado', positions?.ok && lm ? `hace ${age(Date.now() - lm)}` : 'No disponible', positions?.ok && lm ? `${clock(lm)} · fichero de Renfe` : 'Renfe no responde')}
        ${fact('Fuente', t.position ? 'Renfe en vivo' : 'Horario oficial', 'datos abiertos de Renfe')}
      </dl>
      <section class="ctx" aria-labelledby="ctx-h">
        <h3 id="ctx-h">Contexto del corredor <span class="ctx-lead">· solo informativo: no indica riesgo, conflicto ni distancia entre trenes</span></h3>
        ${corridor(ctx)}
      </section>
    </div>
    <section class="route-sec" aria-labelledby="route-h">
      <h3 id="route-h">Recorrido en el mapa</h3>
      ${routeSummary(route)}
      ${RENFE_LINK}
    </section>
    <details class="limits">
      <summary>Limitaciones de los datos</summary>
      <ul>
        <li>Solo trenes de Renfe de alta velocidad, larga y media distancia. Iryo y Ouigo no publican posiciones abiertas; Cercanías no está incluido.</li>
        <li>Renfe no publica la hora de medición de cada posición: «Publicado» es la hora del fichero.</li>
        <li>Los trenes sin posición publicada no aparecen en el mapa ni en «Cerca del resto del recorrido».</li>
        <li>El recorrido es una estimación; los tramos sin vía coherente no se dibujan.</li>
        <li>A veces el estado que publica Renfe y sus coordenadas no coinciden; se muestran ambos tal cual.</li>
      </ul>
    </details>
    <details class="tech">
      <summary>Detalles técnicos</summary>
      <ul>
        <li>Posición: GTFS-Realtime de Renfe (AV/LD/MD)${lm ? `, fichero de las ${clock(lm, true)}` : ''}.</li>
        <li>Recorrido: camino más corto por la red ferroviaria de OpenStreetMap entre paradas oficiales consecutivas; se descartan tramos sin vía cercana, sin conexión o incompatibles con el horario.${route?.osmTimestamp ? ` Datos OSM de ${esc(route.osmTimestamp.slice(0, 10))}.` : ''}</li>
        ${route?.available ? `<li>Tramos: ${route.legs.map((l) => `${esc(shortName(l.from))} → ${esc(shortName(l.to))}: ${l.status === 'track' ? `${l.km} km por vía` : esc(LEG_STATUS[l.status])}`).join('; ')}.</li>` : ''}
        <li>No se calcula velocidad ni riesgo. Viaje GTFS: ${esc(t.tripId)}.</li>
      </ul>
    </details>
    ${NOTICE}`;
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
      <li><strong>Iryo y Ouigo</strong> no publican posiciones abiertas: no aparecen. Cercanías no está incluido en este prototipo.</li>
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
