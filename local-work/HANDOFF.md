# Project handoff

## Objective

Present selected real Hue devices and existing Homebridge accessories as one emulated Hue bridge for Harmony home-control buttons, plus Roku commands for activity buttons. Publish no HomeKit accessories.

## Repository and branches

- Repository: https://github.com/pponce/homebridge-harmony-home-control
- Feature branch: combined-hue-bridge.
- Base main commit: 7d145fc7f52b928589c16f5a11d7bfcff813a59f.
- Package version: 0.1.0-alpha.4.
- Working folder: /workspace/scratch/71d3a82dec8a/homebridge-harmony-home-control.
- Local Git baseline imports the exact remote base tree a8ec23885dfbf248793572cbc2ce877dec5b5dcd; remote commits use the actual main commit as parent through the connected GitHub tools.

## Completed changes

- Direct connections to multiple physical square Hue bridges and Hue Bridge Pro devices, with local discovery or manual IPv4 address entry and physical-button authorization.
- Reuse hb-hue-tools for Hue API requests and authenticated TLS certificate/identity validation; no HTTP credentials or automatic command retries.
- Private authorization in the Homebridge storage directory, separate from browser-visible configuration and the emulator identity file.
- A shared access layer combines real Hue lights, plugs, and groups with existing HAP services for both Hue and Roku mappings.
- Device-source filtering, physical bridge connection/reconnection UI, mapped-bridge removal guard, and connection status.
- Preserve original HAP target IDs and all emulated Hue identities, pairings, and virtual light IDs.
- Verify original Hue light identity before writes to prevent numeric resource ID reuse from redirecting commands.
- Per-bridge failure handling; fresh reads for toggles and relative adjustments; public setup/usage documentation.
- Checkbox accessory-type filters in both editors, combined with source and search, counts, all/clear/default controls, and preserved selected targets outside the filters.
- Hide homebridge-harmony controls by default using Manufacturer=Harmony or the HarmonyHubWebSocket child-bridge alias, with an explicit inclusion checkbox. Other accessories on a mixed main bridge remain visible; names and Logitech alone are never used to exclude a device.
- Setup/maintenance services are unchecked by default. Read-only services remain excluded. Configured Name, Identify, and other metadata are excluded from new actions; existing mappings and runtime access are preserved.
- Hue editor label: Device name in Harmony. Roku editor label: Name Mapped Action. Saved cards show the requested Harmony Device Name / Harmony Selector / Mapped Action labels with the target characteristic and action.
- Fix likely missed-click paths: startup buttons stay disabled until handlers are ready; editors open before discovery, remain open on empty/error responses, and update in place. Repeated Add clicks retain the draft and share discovery; synchronous handler errors are displayed. Existing saved mapping labels are resolved automatically on opening settings.
- Existing mappings with dimming disabled stay disabled when edited.

## Validation

- JavaScript syntax and JSON validation pass.
- npm pack succeeds; local-work/artifacts/homebridge-harmony-home-control-0.1.0-alpha.4.tgz contains the new picker module and excludes tests, notes, and temporary artifacts.
- 30 local tests pass, including mixed HAP/Hue protocol routing, two bridges, plugs/groups, authorization, failure isolation, ID preservation, redaction, type classification, metadata exclusion, and Harmony detection on main/child bridges. Existing hidden targets still accept mapped commands.
- One installed dependency/UI IPC check is deferred to CI because runtime packages are unavailable locally.
- Local browser tests cannot launch because the Chromium binary is absent. CI installs dependencies and Chromium and runs the browser workflow.
- Browser tests now cover first-click slow/empty discovery, duplicate clicks, combined filters, default exclusions, existing hidden selection preservation, updated labels/cards, and mobile filter layout. They are written but have not run in a browser locally; the reported physical UI missed-click issue is not yet confirmed resolved on the user's host.
- The user explicitly authorized publication to the existing private GitHub repository. Upload the combined-hue-bridge branch and complete GitHub Actions checks on Node 22, 24, and 26, including the browser workflow. npm publication remains outside this approval.
- Direct npm dependency and Playwright Chromium downloads both returned network-policy HTTP 403. Local dependency/IPC and browser validation remain blocked; no global installation or dependency patches were attempted.
- Physical Hue/Harmony hardware has not been tested.

## Decisions and limits

- Harmony sees only one combined bridge. Its native one-Hue-bridge-per-hub limit still applies.
- Users replacing a physical bridge connection in Harmony must recreate affected Harmony lighting assignments. Apple Home and Hue app connections can remain.
- New direct Hue scope is on/off and brightness, including groups; scenes and color remain unsupported.
- Direct Hue does not depend on Homebridge accessory control or homebridge-hue. HAP targets still use the existing local accessory-control interface.
- Keep homebridge-hue configured with explicit physical bridge hosts so it does not discover the emulator.
- No physical host changes, backups, npm publication, or Harmony configuration changes performed.
- Tests and temporary artifacts stay under this repository's local-work/artifacts folder.
- Classification reference: HAP-NodeJS ServiceDefinitions.ts and CharacteristicDefinitions.ts from the homebridge/HAP-NodeJS latest branch. Harmony identity reference: nicoduj/homebridge-harmony master, harmonyAsSwitches.js / harmonyAsTVPlatform.js / harmonyBase.js set manufacturer to Harmony; index.js registers HarmonyHubWebSocket. No external source code was vendored.

## Exact next steps

1. Publication is authorized. Re-read main before publishing; it was verified at 7d145fc7f52b928589c16f5a11d7bfcff813a59f immediately after approval.
2. Create a tree using base_tree_sha a8ec23885dfbf248793572cbc2ce877dec5b5dcd and changed file contents, create a commit with parent 7d145fc7f52b928589c16f5a11d7bfcff813a59f, and create combined-hue-bridge at that commit. Open a draft PR and finish GitHub runtime/browser checks, fixing any failures on the branch.
3. Update the existing host checkout to the feature branch and package into local-work/artifacts.
4. Install the package with sudo hb-service stop, sudo hb-service add <tarball>, sudo hb-service start.
5. Check that one Add a button action click opens its editor before discovery completes. Test search/source/type intersections and optional Harmony inclusion, confirm Configured Name is absent for new actions, and check the requested saved-card labels.
6. Open Connection > Real Hue bridges > Add Hue bridge, authorize with its physical button, and choose one Hue device plus one existing Homebridge device. Test each mapping, save and restart, then test Harmony pairing and physical buttons separately.
7. Inspect /var/lib/homebridge/homebridge.log if needed. Preserve state.json and hue-bridges.json when updating.
