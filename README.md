# Rail Safety Spain (nombre provisional)

Prototipo **gratuito, sin ánimo de lucro y de código abierto**: un único mapa geográfico de España (azul marino,
inspirado en Atlas) con la red ferroviaria, las estaciones y los trenes de **Renfe** (alta velocidad, larga y media
distancia) que Renfe publica en abierto. Al elegir un tren, su recorrido estimado sobre vías reales es el
protagonista. Un mapa, una búsqueda, un panel inferior de viaje: vista general → foco en el recorrido →
contexto del corredor.

> **Solo informativo.** No es un sistema de seguridad ferroviaria, de emergencias ni de prevención de
> colisiones. No controla trenes, no declara que una vía sea segura y no predice riesgos. No sustituye la
> información oficial de Renfe ni de Adif. Ante una emergencia, llama al 112.

## Puesta en marcha

Requisitos: Node.js ≥ 20 y el comando `unzip` (incluido en macOS y en la mayoría de Linux). Sin dependencias
npm; MapLibre GL JS está incluido en `public/vendor/` (ver abajo).

```bash
npm start
```

Abre http://localhost:4380 (otro puerto: `PORT=5000 npm start`). Al arrancar, el servidor descarga el
horario oficial de Renfe (~1 MB) en `data/cache/` y luego consulta las posiciones como máximo cada 15 s.

```bash
npm test
```

## Cómo se usa

- **Mapa** a pantalla completa (OpenFreeMap Fiord, recoloreado en azul marino) con la red ferroviaria de
  OpenStreetMap (alta velocidad un poco más clara), las 35 estaciones con más trenes a escala nacional (el resto
  al acercarse) y los trenes como cápsulas iluminadas. Un indicador de estado abajo a la izquierda (trenes, hora
  del fichero, sin Iryo ni Ouigo). Capa detallada opcional de OpenRailwayMap (botón **Vías**, apagada por
  defecto); si falla o devuelve 429, se desactiva sola. **España** vuelve a la vista general.
- **Foco en el recorrido**: al elegir un tren, la cámara vuela e inclina la vista hacia su corredor; el recorrido
  se dibuja en cian luminoso sobre vías reales de OpenStreetMap, con las paradas oficiales numeradas (pasadas
  atenuadas, la próxima resaltada). La red, las estaciones y los demás trenes se apagan; el tren seleccionado
  brilla en las coordenadas publicadas (solo su aspecto se anima, nunca su posición; sin animación con
  «reducir movimiento»).
- **Búsqueda** (`/`): estaciones de toda España del horario oficial, trenes con posición publicada y
  cualquier número de tren del horario de hoy. `↓`/`↑` recorren resultados, `Intro` abre, `Esc` cierra.
- **Panel inferior** (centrado en escritorio; en móvil asoma y se amplía con el tirador): tren (origen → destino,
  estado según Renfe, franja de avance por paradas, próxima parada, retraso, hora de publicación, fuente,
  **contexto del corredor**, recorrido, limitaciones y detalles técnicos plegados), estación (próximas 3 horas)
  o información.
- **Contexto del corredor** (solo informativo): otros trenes con posición publicada a ≤ 2 km del resto del
  recorrido dibujado, y otros trenes del horario oficial en las próximas 3 paradas (±30 min). No indica riesgo,
  conflicto, distancia entre trenes ni sentido; no incluye Iryo, Ouigo ni trenes sin posición publicada.
- **Enlaces compartibles**: `#tren=04395`, `#estacion=51003`.
- **i**: cobertura, precisión, fuentes, licencias y privacidad.
- Capturas: `docs/screenshots/v6-*` (versión actual, con una reproducción local de datos reales de Renfe del
  2026-11-01 a las 18:10; `v5-*`, `v4-*`, `v3-*` y `atlas-*` son versiones anteriores).

## Precisión de los datos

| Dato | Cómo se presenta | Fuente |
|---|---|---|
| Posición | En las coordenadas publicadas, sin ajustar a la vía ni animar | GTFS-Realtime de Renfe (AV/LD/MD) |
| Estado y parada ("Detenido en…") | "según Renfe" | GTFS-Realtime |
| Próxima parada, horas, paradas | "según horario" cuando no lo publica Renfe | GTFS estático de Renfe |
| Retraso | "previsión de Renfe"; si falta, "Sin dato" (nunca "en hora") | GTFS-Realtime trip updates |
| Hora | "hace X s · fichero de Renfe" = publicación del fichero, **no** medición | Cabecera `Last-Modified` |
| Recorrido del tren | **Estimado**: camino más corto por vías reales de OSM entre paradas oficiales; tramos sin vía cercana, sin conexión o incompatibles con el horario **no se dibujan** y se listan | OpenStreetMap (ODbL) vía Overpass |
| Contexto del corredor | Posiciones publicadas cerca del recorrido dibujado + llamadas del horario oficial; **sin** distancias entre trenes ni riesgo | GTFS-RT + GTFS de Renfe, recorrido OSM |
| Velocidad, riesgos, incidencias | **No se calculan** | — |
| Iryo, Ouigo, Cercanías | **No aparecen** (sin posiciones abiertas / fuera de alcance) | — |

Si Renfe no responde, no se muestran posiciones y se dice. Un mapa base o capa que no carga no indica nada
sobre los trenes. Trenes que Renfe publica dos veces (trenes que se dividen) se muestran una sola vez.

## Arquitectura

- `public/app.js`: mapa MapLibre, capas, búsqueda y tarjeta. `public/js/card.js`: plantillas de tarjeta.
  `public/js/format.js`, `observations.js`, `physics.js`: utilidades (la velocidad sigue suprimida).
- `public/vendor/maplibre-gl-6.16.0/`: MapLibre GL JS incluido localmente (ver `VENDOR.md`).
- `server.mjs`: servidor local mínimo y **proxy de solo lectura con caché de 15 s** de los feeds de Renfe
  (no envían CORS). Endpoints: `/api/stations`, `/api/live`, `/api/station?id=`, `/api/train?number=`.
- `lib/corridor.mjs`: índice nacional (`buildIndex(files, null)`), tablero de estación y fusión de feeds.
- `lib/rail-graph.mjs`: grafo de la red ferroviaria de OSM y estimación de recorridos por tramos (con pruebas).
  El servidor descarga la red de España una vez (≈30 MB, una petición a Overpass) y la guarda 30 días en
  `data/cache/osm-rail-es.json`. Endpoints extra: `/api/route?number=`, `/api/network` (red simplificada, gzip).
- `lib/context.mjs`: contexto del corredor (`/api/context?number=`), con pruebas.

Sin base de datos, cuentas, cookies, analítica, IA ni servicios de pago.

## Fuentes y licencias

Resumen en [`docs/SOURCES.md`](docs/SOURCES.md). Código: MIT. Datos de trenes: Renfe Operadora, CC BY 4.0
("Origen de los datos: Renfe Operadora", fecha de actualización visible, sin respaldo de Renfe).

## Limitaciones conocidas

- Solo Renfe AV/LD/MD; sin Iryo, Ouigo ni Cercanías.
- Renfe no publica la hora de medición por tren ni el trazado; el recorrido es una estimación. Algunos tramos
  quedan sin dibujar por huecos de conexión en OSM (p. ej. Madrid Chamartín ↔ Segovia el 2026-11-01).
- A veces el estado de Renfe y sus coordenadas no coinciden (p. ej. "Detenido en Zamora" con coordenadas
  cerca de Madrid); se muestran ambos tal como se publican.
- La cabecera `header.timestamp` del feed AV/LD va 1 h por detrás de `Last-Modified`; se usa `Last-Modified`.

## Reportes de pasajeros (futuro)

No implementado. Diseño propuesto en [`docs/passenger-reporting.md`](docs/passenger-reporting.md).
