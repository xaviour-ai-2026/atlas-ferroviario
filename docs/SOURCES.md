# Sources and licences (verified 2026-11-01)

| Component | What we use | Licence / terms | Obligations we meet |
|---|---|---|---|
| Renfe GTFS-Realtime AV/LD/MD (`gtfsrt.renfe.com/vehicle_positions_LD.json`, `trip_updates_LD.json`) | Train positions, reported stop/status, delay | [CC BY 4.0, data.renfe.com/legal](https://data.renfe.com/legal); commercial and non-commercial reuse | Credit "Renfe Operadora" in map attribution and info card; show update time; no endorsement implied; data not altered |
| Renfe GTFS AV/LD (`ssl.renfe.com/gtransit/Fichero_AV_LD/google_transit.zip`) | Stations, timetables | CC BY 4.0 (same portal) | Same |
| OpenFreeMap Fiord (`tiles.openfreemap.org`), restyled navy in the browser | Basemap (vector tiles, fonts, sprites) | [Free, no key](https://openfreemap.org/), [ToS](https://openfreemap.org/tos/): as-is, requests via Cloudflare | Attribution OpenFreeMap / © OpenMapTiles / © OpenStreetMap (from its TileJSON, shown by MapLibre) |
| OpenStreetMap data (inside the basemap and overlay) | Map data | ODbL 1.0 | © OpenStreetMap contributors credited |
| OpenStreetMap railway ways via [Overpass API](https://overpass-api.de/) (`railway=rail`, no yards/sidings, no metre gauge, Spain) | Network layer and estimated train routes | ODbL 1.0; Overpass public-instance guideline < 10,000 requests and < 1 GB per day | One ~30 MB request per 30 days with a unique User-Agent; cache kept local (`data/cache/`, not committed); "Recorridos: © OpenStreetMap (ODbL)" in map attribution; routes labelled as estimates |
| OpenRailwayMap standard tiles (`tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png`) | Optional detailed overlay (off by default) | [Tile policy](https://wiki.openstreetmap.org/wiki/OpenRailwayMap/API): free for public free apps, real Referer, stop on 429 | Credit "OpenRailwayMap"; browser sends its own Referer (never spoofed); overlay disabled after HTTP 429 or 6 failures; tiles only on demand |
| MapLibre GL JS 6.16.0 | Map engine, vendored in `public/vendor/` | BSD-3-Clause, `LICENSE.txt` kept | Licence notice kept; integrity and provenance in `VENDOR.md` |
| Project code | — | MIT (`LICENSE`) | — |

## Rejected options

- **Renfe live map** (`tiempo-real.largorecorrido.renfe.com`): no embed or reuse documentation; it sends
  `X-Frame-Options: SAMEORIGIN` and `frame-ancestors 'self'`. Its internal JSON endpoints have no licence and
  are not used.
- **TrainsRadar embed**: its embed URL sends `X-Frame-Options: SAMEORIGIN` (blank iframe in testing); its
  terms forbid reproduction without express authorisation; some regions' positions are estimated.
- **IGN basemaps**: IGN products are CC BY 4.0, but the exact "IGN Base" tile service terms were not confirmed;
  kept as a fallback option.

## Privacy

No cookies, accounts, analytics or tracking. The visitor's browser requests map tiles from OpenFreeMap
(via Cloudflare) and OpenRailwayMap, which therefore see the visitor's IP address; this is disclosed in the
info card.

## Route estimation (what is and is not claimed)

Renfe's GTFS has no `shapes.txt`. For a selected train, each leg between consecutive official stops is the
shortest path over real OSM track (high-speed lines preferred for AVE/Avlo/Avant/Alvia/Euromed, avoided for
others). A leg is **not drawn** when a station has no track within 1.5 km, the network has no connection, the
path is more than 1.8× the straight distance + 20 km, or it would need an average speed above the timetable's
limit (280 km/h high-speed, 170 km/h other). The track geometry is real; the assignment is an estimate and is
labelled as such. Renfe's undocumented viewer geometry is not used.

## Corridor context (what is and is not claimed)

For a selected train, the sheet lists (a) other trains whose **published** Renfe position lies within 2 km of the
part of its drawn route still ahead, in route order, and (b) other trains the **official timetable** calls at its
next three stops within ±30 min. It does not compute distances between trains, closing speeds, separation, track
occupancy, direction or risk, and says so. Trains without a published position, Iryo, Ouigo and Cercanías cannot
appear; legs that are not drawn are not searched.

