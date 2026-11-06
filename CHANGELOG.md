# Changelog

## 0.1.1 — 2026-11-06

### Added

- `supports-hap` metadata for the Homebridge/HAP integration.
- GitHub Sponsors and PayPal links in the README, GitHub funding configuration, and npm package metadata.

See [release notes](docs/releases/0.1.1.md) for upgrade information and requirements.

## 0.1.0 — 2026-11-06

First non-prerelease version.

### Added

- Hue and Roku emulation for mapping Harmony remote commands to existing accessories.
- Direct connections to multiple physical Hue bridges, including light, plug, and group selection.
- Homebridge settings UI with source/type filters, action tests, and pairing diagnostics.
- Optional web configurator for Harmony inspection, supported cloud edits, sync, and IR command inspection.

### Fixed

- Mixed Hue requests apply supported on/off and brightness fields independently of unsupported color fields.
- Command diagnostics distinguish accepted writes, readback differences, and no-op actions.
- Separately published accessory sources display their reported names.
- HTTP, background-refresh, and shutdown errors are contained and logged; cleanup continues after individual component failures.

### Changed

- Removed the outdated README hardware-testing warning.

See [release notes](docs/releases/0.1.0.md) for requirements, limitations, and upgrade information.
