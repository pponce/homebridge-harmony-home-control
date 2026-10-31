# Harmony configurator

[← Back to Harmony Home Control](../README.md)

The optional configurator runs in the plugin’s Homebridge process. With this plugin assigned to a child bridge, it starts and stops with that child bridge. It uses its own HTTP or HTTPS port and requires no separate service. It is disabled by default.

## Open it

1. In Homebridge, assign Harmony Home Control to a child bridge if it is not already using one.
2. Open the plugin settings and enter the Homebridge LAN address and Harmony hub address.
3. Under **Harmony configurator**, enable **Run in this plugin’s child bridge**. Keep port **18081**, or choose a free port different from Hue, Roku, Homebridge UI and other services.
4. Save settings and restart the child bridge. Return to the plugin settings and choose **Open configurator**.
5. Choose **Read hub**. Rooting and Logitech login are not required for local inspection.

The access link is single-use and expires after two minutes. The browser session lasts up to 12 hours and ends when the child bridge restarts. Reopen it from Homebridge settings when needed. Keep the listener on your trusted home network; it is not designed for public port forwarding.

If the hub cannot be read, check its saved IPv4 address and TCP port 8088. Firmware may restrict the local interface or omit resources. An unsuccessful refresh keeps the previous import and visibly marks the failed read; it never replaces your data with an empty setup.

## What you can inspect and edit

| Configuration | Inspect | Apply changes |
| --- | --- | --- |
| Devices, available command names, power actions and input actions | Imported when supplied by the hub | Inspect only |
| Device power policy and power-on/input/inter-device/inter-key delays | Imported | Draft here, change in Harmony, sync, then read the hub to verify |
| Activity name and display order | Imported | Draft, review and save to Logitech; compile and sync separately |
| Existing activity role power-on/off order | Imported | Draft, review and save to Logitech; compile and sync separately |
| Delay before the next device | Imported when present | Draft here; apply using Harmony |
| Activity roles, selected inputs and explicit start/end actions | Imported | Change using Harmony |
| Button maps and sequences | Available hub maps only | Inspect only; remote-specific maps may be absent |
| HDMI wiring, CEC, desired power behavior and automation notes | Your answers | Saved locally in the configurator |

This is a preview, not a complete replacement for the Harmony application. Unknown vendor fields, raw IR codes, account details and credentials are not exposed in the inspector. FunctionList is requested to report resource availability; function-map interpretation is not implemented. Unsupported or missing fields cannot be saved through an arbitrary JSON editor.

Cloud writes use an unofficial protocol and have automated fixture coverage. Validate the preview against your own hub before relying on it. There is no local resource-write endpoint and no cloud blocking.

## Setup Assistant and suggestions

Describe each device’s HDMI destination and input, CEC state, wake and sleep owner, desired behavior when switching away, and behavior on All Off. **I’m not sure** is a valid answer. Device-specific hints explain where to look for settings. Answers survive child-bridge restarts.

Use the notes for individual CEC switches and HomeKit automations, including trigger, delay, conditions and action. Notes are preserved for manual review; the configurator does not execute automations or claim to understand free text automatically.

Suggestions are transparent rules based on imported values, your answers, and reported test outcomes. They include the current evidence, a proposed next step, the reason, a test and manufacturer guidance where available. They do not automatically change your setup. In particular:

- Wake and sleep can have different owners. Retain the CEC behavior you want and test each direction.
- Harmony’s “always on” power policy means Harmony skips power commands. Keeping a device on between activities is a separate setting.
- Do not assume a TV waking a source is equivalent to a source waking the TV.
- Test cold startup, transitions between source activities, and All Off. Delayed automations need a separate test when another activity starts during their wait.
- The displayed activity order is configuration, not a timed execution trace. Already-on devices, CEC and external automations change what actually happens.

## Logitech login and sync

Local HTTP supports inspection, answers, suggestions, drafts and manual guidance. To enter Logitech credentials, use either:

- **HTTPS:** provide absolute paths to a certificate and private key in the plugin settings, then restart the child bridge. Use a certificate trusted by your browser, valid for the Homebridge IP address used in the link. The Homebridge process must be able to read both files.
- **A localhost SSH tunnel:** forward local port 18081 to port 18081 on the Homebridge machine. Keep the local and remote port numbers equal. Open a fresh configurator access link, changing only its host to `127.0.0.1` while preserving the fragment. The listener accepts the configured LAN IPv4 address, `127.0.0.1`, or `localhost`; arbitrary hostnames and forwarded-origin headers are not trusted.

Sign in under **Review changes** using a Logitech email/password account. Social and legacy sign-in methods are not supported. Credentials and session cookies stay in process memory and are discarded at logout or child-bridge restart. They are not saved in Homebridge configuration or exports. The selected hub’s account and remote IDs must match the login; another account or hub is never selected automatically.

For a supported draft, choose **Review cloud save**. The dialog shows the exact old and proposed values. **Save to Logitech** reads the latest full activity, rejects a changed original value, updates only the selected scalar field, preserves the remaining XML, and reads the activity back. Multiple drafts are separate saves, not an atomic transaction.

**Compile & sync this hub** compiles the cloud configuration and requests a hub sync. This sync applies the current cloud configuration for the hub, including changes made elsewhere. After the cloud indicates completion, the configurator reads the hub again. A draft is **Confirmed on hub** only when its imported value matches the proposal. This does not establish the physical device’s state.

If a save is interrupted after submission, it is marked **Cloud save unconfirmed** and cannot be replayed automatically. Check the activity in Harmony, sync if appropriate, and read the hub. Discarding a record never undoes an applied change. There is no automatic rollback.

## Local data and export

The current projected hub import, setup answers and draft records are stored in `harmony-home-control/configurator.json` under Homebridge’s storage directory, with private file permissions. This current working state is separate from the emulator’s identity and real Hue credentials. It is not a full hub backup.

**Export review** downloads the projected configuration, answers and changes for discussion or troubleshooting. It excludes Logitech credentials, account/remote IDs and raw IR data. Device names, the hub’s IP address and your free-text automation notes are included; review those before sharing.

Disabling the option and restarting closes the listener without deleting your saved answers. If the configurator cannot start, the plugin reports its status while continuing to start the configured Hue and Roku interfaces.
