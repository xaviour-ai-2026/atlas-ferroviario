# Future design: opt-in passenger reports (NOT implemented)

Status: design only. Nothing in Phase 1 collects, stores or displays passenger input.

## Purpose
Let passengers optionally say "my train is stopped between stations" or "no information on board", to add
context where official data is silent. Reports would never become official information, alerts or safety
signals.

## Principles
1. **Opt-in per report.** No background location, no accounts by default, no tracking between reports.
2. **Data minimisation (GDPR art. 5).** Store only: train number, service date, report type from a fixed
   list, coarse position snapped to the nearest station segment (never raw GPS), and time rounded to the
   minute. No free text in v1 (it invites personal data and abuse). No IP addresses kept beyond rate limiting.
3. **Lawful basis.** Explicit consent at submission with a plain-language notice; a privacy notice naming the
   controller; deletion of individual reports after 24 h, keeping only aggregate counts.
4. **Separation from official data.** Separate visual layer, label "Reportes de pasajeros · no verificados",
   different colour and icon, never merged into train state, delay or freshness. Off by default.
5. **No public incident alerts.** Reports only show as counts on the train detail ("3 pasajeros indican
   parada prolongada") once a threshold is met; never as push notifications or "incident" banners.

## Abuse and false reports
- Rate limit per device/network; require the report to match a train the official timetable says is running.
- Show only when ≥ N independent reports agree within a short window (k-anonymity also protects reporters).
- Automatic expiry; obvious conflicts with official data (e.g. train already arrived) discard the report.
- No reputation, profiles or social features. Moderation is limited to a fixed taxonomy, so there is no
  user-written content to moderate.

## Before building it
- Data protection impact assessment (DPIA) and a named data controller.
- A backend (the first one with state) and its hosting cost; Phase 1 has none.
- Legal review of liability wording, especially given the sensitive context after the January 2026 Adamuz
  accident.
