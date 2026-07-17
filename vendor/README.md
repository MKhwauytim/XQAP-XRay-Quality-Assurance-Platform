# vendor/

Third-party packages vendored directly into the repo because they are not published to the
default npm registry.

## xlsx-0.20.3.tgz

- Source: https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz
- SHA-256: `8dc73fc3b00203e72d176e85b50938627c7b086e607c682e8d3c22c02bb99fe8`
- License: Apache-2.0 (SheetJS permits redistribution under this license)
- Why vendored: the `xlsx` npm registry package is stale; the current SheetJS releases are
  distributed via their own CDN, not npm. Vendoring removes the runtime dependency on that CDN
  being reachable during `npm install`/`npm ci` (see CI workflow, D4).
- Do not "upgrade" this to the npm-registry `xlsx` package — it lags far behind SheetJS's own
  releases. To upgrade, download the new version's tarball from `cdn.sheetjs.com`, replace the
  file here, update the checksum in `scripts/check-vendor-integrity.mjs`, and update the
  `package.json` dependency version/path together. Review the new package license before release.
