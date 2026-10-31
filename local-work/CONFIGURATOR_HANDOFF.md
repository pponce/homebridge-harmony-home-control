# Optional child-bridge configurator handoff

The feature branch adds a server inside `HarmonyPlatform`, disabled by default and using port 18081. It starts before accessory access and closes during child-bridge shutdown. Homebridge’s existing custom UI enables it and issues a single-use browser access link through the private runtime admin channel. No standalone service or hosted Site is used.

Implemented: root-free reads of DeviceList/ActivityList with optional MapList/FunctionList, allowlisted projections, private persisted answers/drafts, device/activity inspection, setup questions, conditional advice, review/export, explicit draft editing, limited cloud activity writes and cloud compile/sync followed by hub verification. Power/delay device changes and unsupported activity fields use a guided Harmony-app workflow. HDMI topology and automation notes are user supplied. No physical control commands or local resource writes are implemented.

Cloud credentials are accepted only over direct HTTPS or loopback, kept per browser session in memory, and never written to config/logs/export. Cloud account selection matches both locally provisioned IDs. Supported writes are activity Name/ActivityOrder and existing role PowerOnOrder/PowerOffOrder. Fresh cloud scalar comparison blocks conflicting edits; the original XML carries every unmodified field. Submitted saves that fail verification remain unconfirmed and are not retried.

Source checkout is an isolated worktree under the existing project’s `local-work/configurator`, created from local alpha.7 whose tracked tree matched GitHub main `da7aedc0060b98702ffcba1cd800c731277daebf`. The parent checkout’s work was preserved.

Validation: syntax/JSON and whitespace checks passed; 47 of 48 Node tests passed, with the existing installed-dependencies check skipped locally because runtime dependencies are absent. The package dry-run includes the configurator web assets and backend modules. Browser tests are wired into CI for both Homebridge settings and the configurator. The current managed environment has no supported browser QA tool, so no local browser was installed or launched.

GitHub upload and a draft PR were explicitly authorized by the user after review of the local implementation. Destination: `pponce/homebridge-harmony-home-control`, branch `feature/child-bridge-configurator`, draft PR against `main`. npm publication and live installation remain outside this approval. Preserve unrelated changes if main advances.

Still requires real hardware/service validation: port 8088 resource availability and exact schema on the target firmware, physical remote map coverage, supported Logitech sign-in, fresh activity XML and cloud sync behavior. A compiled configuration is not proof of physical device state. Do not publish to npm or install on the live Homebridge host without the user’s direction. No hub writes, live Logitech login, npm publication or live-host changes were performed while implementing this branch.
