# Atlas Ferroviario

**Observatorio abierto del ferrocarril español.** Proyecto ciudadano, **independiente, gratuito, sin ánimo de lucro y
de código abierto** que promueve la transparencia ferroviaria, la concienciación pública y la investigación
colaborativa con datos públicos: un único mapa geográfico de España (azul marino, inspirado en Atlas) con la red ferroviaria, las estaciones y los trenes de **Renfe** (alta velocidad, larga y media
distancia) que Renfe publica en abierto. Al elegir un tren, su recorrido estimado sobre vías reales es el
protagonista. Un mapa, una búsqueda, un panel inferior de viaje: vista general → foco en el recorrido →
contexto del corredor.

> **Solo informativo.** No es un sistema de seguridad ferroviaria, de emergencias ni de prevención de
> colisiones, ni está certificado para ningún uso ferroviario. No controla trenes, no declara que una vía sea
> segura y no predice riesgos. No sustituye la información oficial de [Renfe](https://www.renfe.com/es/es) ni de
> [Adif](https://www.adif.es/). Ante una emergencia, llama al 112.

## Por qué existe

Tras los accidentes ferroviarios de Adamuz y Urda en 2026, queremos ayudar a entender cómo funciona el ferrocarril
en España con datos públicos. Nuestro más sincero pésame a las familias de las víctimas, a los heridos y a los
profesionales ferroviarios afectados.

Es un proyecto de **investigación sobre la calidad y la utilidad de los datos públicos** (qué publican, con qué
retraso, qué falta), no de protección ferroviaria: la seguridad de la circulación depende de sistemas certificados
(LZB, ERTMS/ETCS, ASFA, enclavamientos, detección de ocupación y los centros de control de Adif) a los que este
proyecto no tiene acceso. No pretende haber podido evitar ni reconstruir ningún accidente; las causas las investiga
la autoridad oficial (AITAT, antes CIAF). No está vinculado a Renfe, Adif ni a ningún partido o empresa.

Invitamos a ingenieros ferroviarios, investigadores y a la comunidad de código abierto a revisar el código, los
datos y la auditoría ([`docs/AUDIT-v7.md`](docs/AUDIT-v7.md)), y a señalar cualquier error: ver
[`CONTRIBUTING.md`](CONTRIBUTING.md).

## Puesta en marcha

Requisitos: Node.js ≥ 20. Sin dependencias npm; MapLibre GL JS está incluido en `public/vendor/` (ver abajo).
El mismo servidor puede ejecutarse en AWS Lambda mediante `lambda.mjs` (variables `CACHE_DIR` y `RAIL_FILE`); la
configuración del despliegue de producción se mantiene en un repositorio privado aparte.
Seguridad: [`SECURITY.md`](SECURITY.md).

```bash
npm start
```

Abre http://localhost:4380 (otro puerto: `PORT=5000 npm start`). Al arrancar, el servidor descarga el
horario oficial de Renfe (~1 MB) en `data/cache/` y luego consulta las posiciones como máximo cada 15 s.

```bash
npm test
```

Validación reproducible con datos reales (captura un fichero de Renfe, lo reproduce en el servidor y compara tren a
tren con el original y el horario; guarda la evidencia en `docs/validation/`):

```bash
node scripts/validate.mjs 100
```

**Publicación en un servidor:** la API limita cada cliente a 120 peticiones por minuto y valida los parámetros. Detrás
de un proxy inverso todos los clientes comparten su dirección, así que el proxy debe aplicar su propio límite por
cliente.

## Cómo se usa

- **Mapa** a pantalla completa (OpenFreeMap Fiord, recoloreado en azul marino) con la red ferroviaria de
  OpenStreetMap (alta velocidad un poco más clara), las 35 estaciones con más trenes a escala nacional (el resto
  al acercarse) y los trenes como cápsulas iluminadas. Un indicador de estado abajo a la izquierda (trenes, hora
  del fichero, sin Iryo ni Ouigo). Capa detallada opcional de OpenRailwayMap (botón **Vías**, apagada por
  defecto); si falla o devuelve 429, se desactiva sola. **España** vuelve a la vista general.
- **Foco en el recorrido**: al elegir un tren, la cámara vuela e inclina la vista (inclinación baja, con
  horizonte y niebla de MapLibre) hacia su corredor; el recorrido
  se dibuja en cian luminoso sobre vías reales de OpenStreetMap, con las paradas oficiales numeradas (pasadas
  atenuadas, la próxima resaltada). La red, las estaciones y los demás trenes se apagan; el tren seleccionado
  brilla en las coordenadas publicadas (solo su aspecto se anima, nunca su posición; sin animación con
  «reducir movimiento»).
- **Búsqueda** (`/`): estaciones de toda España del horario oficial, trenes con posición publicada y
  cualquier número de tren del horario de hoy. `↓`/`↑` recorren resultados, `Intro` abre, `Esc` cierra.
- **Panel de detalle** (al estilo «investigar» de Atlas): en escritorio, un panel a la derecha, una línea de
  paradas a lo largo de la parte inferior del mapa y etiquetas sobre el mapa (el tren y su próxima parada); en
  pantallas estrechas, una hoja inferior que asoma y se amplía con el tirador. El tren se reparte en tres paneles
  deslizables, sin desplazarse hacia abajo: **Viaje** (próxima parada, retraso, hora de publicación, fuente y
  paradas), **Corredor** (contexto del corredor) y **Datos** (recorrido, limitaciones y detalles técnicos).
  También estación (próximas 3 horas) o información.
- **Contexto del corredor** (solo informativo): otros trenes con posición publicada a ≤ 2 km del resto del
  recorrido dibujado, y otros trenes del horario oficial en las próximas 3 paradas (±30 min). No indica riesgo,
  conflicto, distancia entre trenes ni sentido; no incluye Iryo, Ouigo ni trenes sin posición publicada.
- **Enlaces compartibles**: `#tren=04395`, `#estacion=51003`.
- **i**: cobertura, precisión, fuentes, licencias y privacidad.
- Capturas: `docs/screenshots/v7-*` (versión actual, datos reales de Renfe del 2026-11-03 por la tarde;
  `v6-*`, `v5-*`, `v4-*`, `v3-*` y `atlas-*` son versiones anteriores).

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
- `scripts/validate.mjs`: validación reproducible contra los ficheros originales de Renfe y el horario GTFS.

Sin base de datos, cuentas, cookies, analítica, IA ni servicios de pago.

## Fuentes y licencias

Resumen en [`docs/SOURCES.md`](docs/SOURCES.md). Código: MIT. La red ferroviaria simplificada (`/api/network`) y
los recorridos (`/api/route`) derivan de OpenStreetMap y se ofrecen bajo la licencia **ODbL 1.0** (© colaboradores
de OpenStreetMap). Datos de trenes: Renfe Operadora, CC BY 4.0
("Origen de los datos: Renfe Operadora", fecha de actualización visible, sin respaldo de Renfe).

## Limitaciones conocidas

- Solo Renfe AV/LD/MD; sin Iryo, Ouigo ni Cercanías.
- Renfe no publica la hora de medición por tren ni el trazado; el recorrido es una estimación. Algunos tramos
  quedan sin dibujar por huecos de conexión en OSM (p. ej. Madrid Chamartín ↔ Segovia el 2026-11-01).
- A veces el estado de Renfe y sus coordenadas no coinciden (p. ej. "Detenido en Santander" con coordenadas a
  23,7 km): se muestran ambos y, si la estación está a más de 3 km, se avisa en el panel.
- Un mismo número de tren puede tener varias variantes en el horario (y Renfe publica algunos trenes divididos
  dos veces): se usa la variante que Renfe está publicando. Sin mercancías ni vehículos de mantenimiento.
- Auditoría de precisión y seguridad: [`docs/AUDIT-v7.md`](docs/AUDIT-v7.md).
- La cabecera `header.timestamp` del feed AV/LD va 1 h por detrás de `Last-Modified`; se usa `Last-Modified`.

## Reportes de pasajeros (futuro)

No implementado. Diseño propuesto en [`docs/passenger-reporting.md`](docs/passenger-reporting.md).
