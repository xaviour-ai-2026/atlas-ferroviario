# Atlas Ferroviario — release readiness (non-commercial open-source release)

Date: 2026-11-04. Base: the approved v7 cockpit plus the v7 audit fixes ([`AUDIT-v7.md`](AUDIT-v7.md)).
No deployment, public repository, operator contact or announcement has been made.

## Release conditions from the audit

| Condition | Status | Evidence |
|---|---|---|
| Name that does not imply a safety system | **Done.** "Rail Safety Spain" → **Atlas Ferroviario** in the UI, code, package, LICENSE and docs. The README says the project is "no certificado para ningún uso ferroviario". | `public/index.html` title and brand; smoke screenshot; `package.json` |
| Daytime reconciliation, ≥100 trains | **PENDING:** runs automatically at 11:00 Madrid on 2026-11-04 (`node scripts/validate.mjs 100`) | Result to be added below from `docs/validation/<time>/result.json` |
| Basic protection for public endpoints | **Done.** 120 API requests/min per client (429 + Retry-After), strict `number`/`id` formats (400), GET only (405), a 15 s cache on `/api/context`, `nosniff` header. Behind a proxy, the proxy must limit per client (documented). | Manual test: 400/400/405, 115×200 then 10×429; all GTFS ids fit the formats |
| ODbL obligations | **Done.** The README and SOURCES state that `/api/network` and `/api/route` are ODbL derivative data, offered at those URLs; map attribution shows © OpenStreetMap (ODbL). | `README.md` "Fuentes y licencias"; `docs/SOURCES.md` |
| Contribution guidelines and conduct rules | **Done.** [`CONTRIBUTING.md`](../CONTRIBUTING.md) (Spanish): data and licence rules, no safety logic, respectful handling of the accidents, conduct rules, MIT. | File |
| Accident claims checked against originals | **Partly done.** Adamuz verified against the Ministry communiqué of 19/01/2026 (original PDF). Urda casualty figures verified against the 112 Castilla-La Mancha page. CIAF's April report and AITAT's first note could not be retrieved (403 / not found), so they stay labelled **[press]**. Public texts only mention the accidents as motivation, with condolences, and restate no findings. | `AUDIT-v7.md` §4 |

## Attribution and limitations (verified)

- **On-screen attribution:** Renfe Operadora (CC BY 4.0), © OpenStreetMap (ODbL) for the routes,
  OpenFreeMap / © OpenMapTiles / © OpenStreetMap for the basemap, and OpenRailwayMap only when "Vías" is on.
- **In the info panel and the Datos tab:** coverage (no Iryo, Ouigo, Cercanías, freight or maintenance traffic), no
  measurement time, estimated routes, "no significa que la vía esté libre", and a link to Renfe's official
  information. The README also links Adif and 112.
- **What a public visitor's browser sends:** requests to OpenFreeMap (via Cloudflare). Disclosed in the info panel.

## Remaining blockers / risks

1. **Daytime validation result**: pending (see above). If defects appear, they are release blockers.
2. **Hosting**: put a per-client limit on any reverse proxy and keep the 30-day OSM cache on persistent storage, so
   Overpass is not hit on every restart.
3. **Official sources**: before any public statement quotes accident details, replace the **[press]** items with the
   CIAF/AITAT originals.
4. **Known data limits** (not defects):
   - Renfe publishes no per-train measurement time.
   - The second half of a split train is not drawn separately.
   - Some OSM connectivity gaps leave legs undrawn; these are listed in the panel.

## Recommendation

**Pending the daytime validation.** If it reaches ≥100 trains with no data-integrity defects: **GO** for a
non-commercial experimental public release. Otherwise: **NO-GO** until the defects are fixed, or until the shortfall
is resolved by re-running in a busier period.
