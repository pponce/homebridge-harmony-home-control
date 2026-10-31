# Project handoff

## Objective

Present selected real Hue devices and existing Homebridge accessories as one emulated Hue bridge for Harmony home-control buttons, plus Roku commands for activity buttons. Publish no HomeKit accessories.

## Repository and branches

- Repository: https://github.com/pponce/homebridge-harmony-home-control
- Feature branch: combined-hue-bridge.
- Draft PR: https://github.com/pponce/homebridge-harmony-home-control/pull/1.
- Published implementation commit: 2363e14f2e9a5cc2da2e516bd1a26bc772773fa0. A later handoff-only commit may be the branch head.
- Base main commit: 7d145fc7f52b928589c16f5a11d7bfcff813a59f.
- Package version: 0.1.0-alpha.5.
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
- Modern configuration UI follows the patterns reviewed in pponce/homebridge-roborock-matter-plus: separate settings panels, teal primary actions, semantic status pills, advanced disclosures, system fonts, and host-driven light/dark color tokens. Implemented independently; no reference assets or source files were copied into the package.
- Header/navigation, connection panels, bridge cards, structured mapping details, editors, pairing status, and mobile layout were updated. Mapping names and labels remain as requested.
- Persistent save bar tracks actual dirty state, saving, errors, and restart requirements. Host ready events initialize the UI once; tab navigation supports arrow/Home/End keys. Actions show busy state and keep drafts on discovery failures.
- Other / custom is unchecked by default alongside Setup & maintenance, per the latest request.
- Feedback is part of the save dock and occupies its own space, so status/error messages cannot overlap the Save button. Errors remain dismissible and retries remain available.

## Validation

- JavaScript syntax and JSON validation pass.
- npm pack succeeds; local-work/artifacts/homebridge-harmony-home-control-0.1.0-alpha.5.tgz includes the theme script and excludes tests, notes, and temporary artifacts.
- 32 local tests pass; one installed dependency/IPC check is skipped locally and passes in CI. Coverage includes mixed HAP/Hue routing, two bridges, plugs/groups, authorization, failure isolation, ID preservation, redaction, picker classification, metadata exclusion, Harmony detection, live host/OS theme precedence, and readable text contrast in both palettes.
- GitHub Actions passed on Node 22, 24, and 26, including the installed dependency/UI IPC test and packaging. Local dependency/browser downloads are restricted, but CI completed those checks successfully.
- The browser workflow passed Homebridge ready events, keyboard navigation, live themes, unsaved/saving/error states and retry, first-click slow/empty discovery, repeated clicks, combined filters, default Harmony/custom/maintenance exclusions, preserved mappings, pairing retry, labels, escaping, and mobile layout with visible save controls. The user's physical Homebridge UI still needs confirmation after installing.
- Successful alpha.5 implementation checks: https://github.com/pponce/homebridge-harmony-home-control/actions/runs/41222999806 and https://github.com/pponce/homebridge-harmony-home-control/actions/runs/41223004397.
- Publication to the existing private repository was explicitly authorized and completed. Ownership was verified against the authenticated pponce account after an automatic-review block. npm publication remains outside this approval. Main is unchanged; installation uses combined-hue-bridge.
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

1. Fetch combined-hue-bridge into the existing host checkout, verify the published commit, and fast-forward the local feature branch. Preserve any local changes; do not reset or stash them automatically.
2. Package into local-work/artifacts and install with sudo hb-service stop, sudo hb-service add <tarball>, sudo hb-service start. Restart Homebridge even if installation reports failure.
3. Close and reopen the plugin settings after installation. Check light/dark themes, the save bar, one-click editor opening, search/source/type intersections, default custom exclusion, optional Harmony inclusion, exclusion of Configured Name from new actions, and the saved-card labels.
4. Add each physical bridge under Connection > Real Hue bridges and authorize with its physical button. Multiple physical Hue bridges are supported simultaneously; select devices from any of them for the single combined Harmony bridge.
5. Test each mapping, save and restart, then test Harmony pairing and physical buttons separately. Confirm the reported host click behavior and direct Hue control on physical hardware before merging PR #1.
6. Inspect /var/lib/homebridge/homebridge.log if needed. Preserve state.json and hue-bridges.json when updating.
