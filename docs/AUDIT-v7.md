# Atlas Ferroviario v7 (then named "Rail Safety Spain") — final accuracy, safety and research audit

Date: 2026-11-03 (night, Madrid). Scope: the approved v7 Atlas cockpit; no redesign, no new features.
Method: code review, automated tests, record-by-record comparison against Renfe's original feed files and GTFS
timetable, route-length checks, headless Chrome smoke tests (desktop 1440×900, phone 500×900, reduced motion), and
independent desk research. Written with respect for the people who died or were injured at Adamuz and Urda, their
families, and the railway staff involved. It assigns no blame.

## 1. Accuracy findings and evidence

**Verified correct, on the same feed file the app read** (a 23:09:02 UTC capture replayed deterministically; 11 raw
entities, 9 distinct trains):
- Coordinates match the raw `vehicle_positions_LD.json`, digit for digit. Nothing is snapped, smoothed or animated.
- `currentStatus` and `stopId` match the raw feed.
- Delay equals `trip_updates_LD.json` `delay`. A missing delay shows "Sin dato", never "En hora".
- Each train's stop list equals the GTFS `stop_times.txt` sequence for the trip variant the app uses.
- Publication time is the HTTP `Last-Modified` header. The feed header clock is still exactly 3,600 s behind and is
  exposed, not trusted. Renfe publishes no per-train measurement time, so `observedAt` stays null and the UI says
  "Publicado", never "medido".

**Route geometry** (OSM via Overpass, ODbL), compared with published line lengths:
- Madrid Atocha–Sevilla: 471 km, the same as the official 471 km.
- Barcelona Sants–Madrid: 661 km against ≈621 km (+6 %). The path is plausible but longer.
- Madrid–Gijón (04121): 7 of 8 legs drawn. Madrid Chamartín–Segovia is "no-path", a known OSM connectivity gap,
  listed rather than drawn.
- Routes stay labelled "estimado".

**Defects found and fixed** (each covered by a regression test; 42/42 pass):

| # | Defect (evidence) | Fix |
|---|---|---|
| D1 | One train number can have several GTFS trip variants, and `/api/train`, `/api/route` and `/api/context` chose by calendar alone. In the live feed at 23:04 UTC, 4 of 11 trains (17113, 13946, 04193, 04405) showed a map marker while the panel said "Renfe no publica su posición ahora", with no reported stop and possibly the wrong route. | `findTrip` prefers the variant Renfe is publishing. |
| D2 | Split trains are published twice at identical coordinates: one variant has the full route and a stop, the other is truncated with no stop. "Last wins" picked the truncated one. For 04193 that meant a Madrid-only route for a train near Santander. | Map marker, detail and corridor all prefer the variant that reports a stop. |
| D3 | Contradictory Renfe data was shown without saying so. 3 of 9 trains were `STOPPED_AT` a station 9.4–23.7 km from their own coordinates (04193 "Detenido en Santander" while near Torrelavega). | The panel states the distance and that both values are shown as published. Nothing is reconciled. |
| D4 | A stale positions file could look "live". The status chip always glowed, "Fuente" said "Renfe en vivo", and Corredor could list old positions or an empty corridor. | After 2 minutes: the chip says "datos antiguos", "Fuente" says "Fichero antiguo", and Corredor lists nothing and says why. |
| D5 | "Próxima parada … según Renfe · 19:31" read as if Renfe forecast 19:31. | It now reads "parada según Renfe · horario 19:31". |
| D6 | The empty corridor message could read as clear track. | It now says this "no significa que la vía esté libre", and the coverage notes add freight and maintenance traffic. |

**Unresolved accuracy limits** (documented, not fixable with public data):
- **Single frozen train:** one train frozen inside an otherwise fresh file can't be detected.
- **Split trains:** the second half of a split train isn't drawn.
- **Night-only check:** the record-by-record check ran on a small night sample. An earlier 138-train daytime capture
  could no longer be replayed because the scratch copy was cleared. Repeat the reconciliation in daytime before
  release.

## 2. Safety-related limitations

| Kind | What the app shows |
|---|---|
| Published observations | Position, Renfe status and stop, Renfe delay forecast, file publication time |
| Derived estimates | Route geometry over OSM track; which stops are passed (from the stop Renfe reports, never the clock); "near the rest of the route" (published position ≤ 2 km from the drawn line) |
| Timetable assumptions | Stop times, next stop when Renfe names none, "próximas paradas compartidas" (±30 min, timetable only) |
| Unavailable, safety-critical | Signal aspects, movement authorities, track occupancy, LZB/ETCS/ASFA state, degraded-mode orders, speed, braking, Iryo, Ouigo, freight and maintenance positions |

- **No physics:** the speed code (`physics.js`) is unused by the UI and stays suppressed. The data can't support it:
  there's no measurement time, and publication runs every 15 s or more.
- **No collision or occupancy claims:** the app has no collision prediction, braking advice, occupancy assertion,
  passenger emergency function or "all clear" state.
- **Corredor wording:** it says "solo informativo", "no implica la misma vía ni el mismo sentido" and "no significa
  que la vía esté libre".
- **Language scan:** a search of all UI strings for safety terms found only disclaimers.

## 3. Verified data sources and legal constraints

- **Renfe GTFS-RT and GTFS:** CC BY 4.0. Credited in the map and info panel, with no endorsement implied. The
  positions dataset dates from 18/02/2026 and has no archive ([data.renfe.com](https://data.renfe.com/dataset/posicion-vehiculos-av-ld-md)).
- **OpenStreetMap via Overpass:** ODbL 1.0, one request per 30 days. `/api/network` and `/api/route` serve a
  **Derivative Database**. A public release must state it is ODbL and offer it, which it already does through those
  URLs.
- **OpenFreeMap:** free terms, requests go via Cloudflare.
- **OpenRailwayMap tiles:** off by default, backs off on HTTP 429.
- **Privacy:** no cookies or analytics. Third-party tile requests are disclosed.
- **Not used:** Renfe's undocumented viewer and other projects' code.

## 4. What existing railway technology already does

The authoritative safety layer is on the train, on the track and in Adif's control centres, not in public data:
- **LZB:** continuous supervision on Madrid–Andalucía.
- **ERTMS/ETCS:** movement authorities sent through balises (Level 1) or radio (Level 2).
- **ASFA:** point-based protection at signals, and the fallback in degraded mode (lateral signal blocking, BSL).
- **Occupancy detection:** track circuits and axle counters.
- **Control centres (CRC/CTC):** they authorise movements, including manual degraded-mode procedures under the
  Reglamento de Circulación Ferroviaria (RD 664/2015, amended by RD 606/2023).
- **EU framework:** Directive (EU) 2016/798.

Sources: [RTVC/EFE](https://rtvc.es/sistemas-proteccion-senalizacion-ferroviaria-espana-asfa-lzb-ertms-28-octubre-2026/),
[Ara](https://en.ara.cat/media/what-failed-technically-in-the-train-crash-of-toledo_1_5894966.html),
[BOE RCF](https://www.boe.es/eli/es/rd/2015/07/17/664),
[BOE RD 606/2023](https://www.boe.es/boe/dias/2023/07/12/pdfs/BOE-A-2023-16156.pdf),
[EUR-Lex 2016/798](https://eur-lex.europa.eu/eli/dir/2016/798/).

Not yet checked against primary texts: TSI CCS (Regulation (EU) 2023/1695), the risk-assessment method
(Regulation 402/2013), and the specific RCF articles on degraded running.

A public map with positions published every 15 s, no signal or occupancy data and missing operators **cannot
substitute for, or add to, train protection**. It must not suggest that it can.

### Accident research (verification status updated 2026-11-04)

Checked against originals where they could be retrieved. Labels: **[original]** official document read directly;
**[official page]** official emergency service page read directly; **[press]** reported by press, original not
retrieved. The CIAF and AITAT websites could not be read (HTTP 403 / not found), so CIAF's April preliminary report
and AITAT's first information note remain **[press]**.

**Adamuz (Córdoba), 18 Jan 2026.**
- *Confirmed* **[original]** (Ministerio de Transportes communiqué of 19/01/2026 relaying the CIAF; copy hosted by the
  Fundación de los Ferrocarriles Españoles, [PDF](https://vialibre-ffe.com/pdf/-accidente-adamuz-ComunicadoMinisterioTransportes.pdf)):
  - At 19:45, the last three cars of Iryo 6189 (Málaga–Madrid, track 1) derailed entering Adamuz station
    (kilometre point 318.693, line 010 Madrid–Sevilla). They fouled track 2, where Renfe Alvia 2384
    (Madrid–Huelva) was arriving, near kilometre point 318.200.
  - Both trains were at about 200 km/h, figure pending confirmation.
  - Provisional casualties on 19/01: 40 dead, 29 seriously and 123 slightly injured.
  - On that date all hypotheses on the cause were open, and the CIAF had about one year to publish its final report.
- *Later casualty figure* **[press]**: 46 dead ([RTVC/EFE, 30/01/2026](https://rtvc.es/46-fallecidos-accidente-adamuz-30-enero-2026/)).
- *Signalling* **[official press note]**: LZB in service; ERTMS not yet operational
  ([La Moncloa, 23/01/2026](https://www.lamoncloa.gob.es/serviciosdeprensa/notasprensa/transportes-movilidad-sostenible/Paginas/2026/230126-obras-inspecciones-adamuz-accidente.aspx)).
- *Preliminary* **[press]** (CIAF report to the court; CIAF calls it provisional,
  [Infobae, 28/04/2026](https://www.infobae.com/espana/2026/04/28/conclusion-del-accidente-de-adamuz-la-ciaf-dice-que-se-rompio-el-carril-y-descarta-anomalias-previas-en-los-trenes/)):
  - A rail break at kilometre point 318.681.
  - No anomalies in either train.
  - LZB braking on the Alvia, with too little distance.
- *Discrepancies:*
  - Cause wording: a broken weld (January) versus a broken rail (April).
  - Whether the rail broke the evening before: a Guardia Civil report says yes, Adif disputes it
    ([The Objective](https://theobjective.com/espana/2026-04-08/guardia-civil-via-adamuz-dia-antes/);
    [Vozpópuli](https://www.vozpopuli.com/economia/transporte/adif-rebate-a-la-guardia-civil-y-cuestiona-la-rotura-de-la-via-como-causa-del-accidente-de-adamuz.html)).
  - Time: 19:45 in the communiqué versus 19:43 in the reported CIAF timeline.
  - Casualties: 40, then 45, then 46 dead.
- *Open:* the root cause of the rail failure, and the final report.

**Urda (Toledo), 28 Oct 2026.** Investigated by AITAT, the independent authority created by Law 2/2024
([BOE](https://boe.es/boe/dias/2024/08/02/pdfs/BOE-A-2024-15937.pdf)).
- *Confirmed* **[official page]**
  ([112 Castilla-La Mancha](https://112.castillalamancha.es/112/incidentes/urda-accidente-ferroviario)):
  - Rear-end collision of two high-speed trains at Urda station.
  - 68 dead, updated to 69 on 29/10 at 11:00.
  - 77 injured.
  - 29 still in hospital on 02/11.
- *Preliminary* **[press]** (AITAT first information note as reported by
  [Vozpópuli](https://www.vozpopuli.com/espana/primer-informe-del-accidente-ferroviario-de-urda-la-colision-se-produjo-a-una-velocidad-de-entre-160-y-200-kmh.html),
  which does not link the original):
  - Renfe AVE 2080 struck Iryo 6076, which was stopped at signal E242 (line 010, track 2, kilometre point 118+800,
    08:53).
  - LZB failed at 08:31; trains then ran under lateral signal blocking (BSL), coordinated by telephone with the
    control centre.
  - Impact speed estimated at 160–200 km/h, pending the train recorders.
- *Discrepancies* **[press]**:
  - Deaths: 64, 68, 69 and briefly 74 in different outlets.
  - Collision time: 08:53 versus 08:54.
  - LZB failure time: 08:30 versus 08:31.
  - AVE passengers: 379 versus 397.
  - Reported instruction: "marcha normal" versus the required 40 km/h. This is unverified
    ([Euronews](https://es.euronews.com/2026/10/29/accidente-tren-urda-toledo-17-minutos-clave-que-fallo-investigacion)).
  - Sabotage claims are false ([Maldita](https://maldita.es/desinfo/20261029/bulos-desinformaciones-accidente-tren-urda-yebenes-toledo/)).
- *Open:* why the AVE's authorisation was not changed, whether procedures were followed, and the cause of the LZB
  failure.

**Public use rule:** the project's public texts mention the accidents only as its motivation and with condolences.
They never restate investigation findings, train numbers or causes. Readers are pointed to the official
investigation bodies.

Nothing here suggests this application could have prevented either accident, and this audit does not claim it. In
both cases Iryo, one of the trains involved, is absent from Renfe's open feed.

## 5. Genuine observability gaps worth investigating

1. **Per-train measurement timestamps** are absent from Renfe's AV/LD feed, so data age can't be judged per train.
2. **Status/coordinate disagreements** are frequent in tonight's sample (3 of 9 trains), possibly stabling yards
   near terminals. This is worth measuring publicly as a data-quality topic.
3. **Coverage:** no open real-time positions for Iryo, Ouigo or freight (not found in this project's searches).
4. **Degraded-mode transparency:** no open, machine-readable notice exists when a line runs without its main
   protection (such as an LZB outage). Whether publishing one is useful or appropriate is a question for Adif and
   AESF, not for this app.

## 6. Research that would need operator data (formal channels only)

- **Who holds it:** juridical recorder (JRU) data, interlocking and RBC/LZB logs, CTC event logs and
  occupancy-detection records. These belong to Renfe, Iryo, Adif, AITAT/CIAF and the courts.
- **What it could support:** validated latency and accuracy figures for the public feed, and studies of how
  degraded-mode periods appear in public data.
- **What it must not become:** a re-investigation of accidents, which is AITAT's legal role.

**Retrospective exercise: not feasible with traceable public evidence.**
- Adamuz is before the positions dataset existed (18/02/2026).
- No archive of the feed for 28/10/2026 was found
  ([Mobility Database](https://mobilitydatabase.org/feeds/gtfs_rt/mdb-2833)).
- Iryo is absent from the feed in both cases.

No historical positions were or should be reconstructed. A sound alternative is a **forward-looking data-quality
study**: archive the public feed (CC BY allows this) for several weeks, then publish publication latency, staleness,
disagreement rates and coverage, with method and raw data. It would state explicitly that it is not about any
accident.

## 7. Public release risks and necessary corrections

| Risk | Status / required before publishing |
|---|---|
| Wrong-variant and split-train data (D1/D2) | **Fixed.** Repeat the reconciliation on a daytime sample (more than 100 trains) |
| Contradictions and stale data shown as normal (D3/D4) | **Fixed** |
| Project name "Rail **Safety** Spain" implies a safety function | **Your decision:** rename (e.g. "Observatorio Ferroviario Abierto") or keep it with a strong subtitle |
| ODbL derivative-database statement | Add to the public README (documented in SOURCES.md) |
| Public server load: `/api/context` scans the timetable 3 times per request; no rate limit | Add response caching and rate limiting before public hosting |
| No CONTRIBUTING.md or code of conduct | Add before inviting contributors |
| Accident sources are press relays, not CIAF/AITAT originals | Replace with the original documents before quoting them publicly |
| Uncommitted v7 changes and this audit | Commit (needs your YES) |

Separation from Renfe and Adif: the UI already states that Renfe does not sponsor the project and that this is not an
official or emergency service.

## 8. Recommendation: **CONDITIONAL GO** (experimental public research tool)

Data handling is now faithful to the source and labels what is observed, estimated or unknown. The UI makes no
unsupported safety claims. Before publishing, close the four conditions in section 7: the name decision, the daytime
re-reconciliation, server rate limiting, and the README/CONTRIBUTING texts.

### Proposed public wording (Spanish)

> **Por qué existe este proyecto.** Tras los accidentes ferroviarios de Adamuz y Urda en 2026, queremos ayudar a
> entender cómo funciona el ferrocarril en España con datos públicos. Nuestro más sincero pésame a las familias de
> las víctimas, a los heridos y a los profesionales ferroviarios afectados.
>
> **Qué es.** Un proyecto gratuito, sin ánimo de lucro y de código abierto que muestra en un mapa los datos abiertos
> que publica Renfe (CC BY 4.0) y una estimación del recorrido sobre la red de OpenStreetMap. No está vinculado a
> Renfe, Adif ni a ningún partido o empresa.
>
> **Qué puede y qué no puede decir.** Muestra posiciones tal como Renfe las publica, sin hora de medición, y solo de
> Renfe: no incluye Iryo, Ouigo, mercancías ni mantenimiento. No conoce señales, autorizaciones de movimiento ni
> ocupación de vía. No predice riesgos ni colisiones, y que no aparezca un tren no significa que la vía esté libre. No
> sustituye la información oficial ni las investigaciones de la AITAT. En una emergencia, llama al 112.
>
> **Revísalo con nosotros.** Invitamos a ingenieros ferroviarios, investigadores y a la comunidad de código abierto a
> revisar el código, los datos y esta auditoría, y a señalar cualquier error.
