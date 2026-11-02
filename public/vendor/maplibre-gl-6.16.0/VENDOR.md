# Vendored: MapLibre GL JS 6.16.0

- Source: https://registry.npmjs.org/maplibre-gl/-/maplibre-gl-6.16.0.tgz (published 2026-10-25 by GitHub Actions,
  npm trusted publisher / OIDC). Approved by the maintainer on 2026-11-01.
- Licence: BSD-3-Clause, see `LICENSE.txt` (copied unchanged from the package, includes third-party notices).
- Tarball integrity (verified against the npm registry `dist.integrity`, match):
  `sha512-gApO66EMtoDZuio680RUBvskR7ahFd/NNhLN4tBAs+Y7FeT4gQV8zVFgYVMRmFxQznOEzecW19w6xOd9XjZjiA==`
- Files copied from `package/dist/`: `maplibre-gl.mjs`, `maplibre-gl-worker.mjs` (loaded from the same folder by
  default), `maplibre-gl.css`. Only change: the trailing `//# sourceMappingURL=` comment was removed from the two
  `.mjs` files (source maps are not shipped).
- SHA-256 after copy:
  - `maplibre-gl.mjs` 253426af6c21e5f0bc242fbe0706538b66ae5e2f94341ce31b7048a833a326bb
  - `maplibre-gl-worker.mjs` f4650f17aa791e15a800278c1e8499d913ff802907a5ad2eb4b8c3cefe68b7ed
  - `maplibre-gl.css` a90798a1953017790e590f7e1bd35ff103a8a4263972cb47290b78adf86f8c20
- Checks: no install scripts; GuardDog 3.2.0 "Low risk" (two flags in `src/util/dom.test.ts`, an HTML-sanitiser
  test, i.e. false positives); release older than the 5-day PMG cooldown.
- Update: only with a new approval; repeat the integrity and scan steps.
