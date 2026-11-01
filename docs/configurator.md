# Harmony configurator

[← Back to Harmony Home Control](../README.md)

The optional configurator runs in the plugin’s Homebridge process. With this plugin assigned to a child bridge, it starts and stops with that child bridge. It uses its own HTTP or HTTPS port and requires no separate service. It is disabled by default.

## Open it

1. In Homebridge, assign Harmony Home Control to a child bridge if it is not already using one.
2. Open the plugin settings and enter the Homebridge LAN address and Harmony hub address.
3. Under **Harmony configurator**, enable **Run in this plugin’s child bridge**. Keep port **18081**, or choose a free port different from Hue, Roku, Homebridge UI and other services.
4. Save settings and restart the child bridge. Return to the plugin settings and choose **Open configurator**.
5. Choose **Read hub**. Rooting and Logitech login are not required for local inspection.

The access link is single-use and expires after two minutes. The browser session lasts up to 12 hours and ends when the child bridge restarts. Reopen it from Homebridge settings when needed. For direct URL access, set a separate password as described below. Keep the listener on your trusted home network; it is not designed for public port forwarding.

If the hub cannot be read, check its saved IPv4 address and TCP port 8088. Firmware may restrict the local interface or omit resources. An unsuccessful refresh keeps the previous import and visibly marks the failed read; it never replaces your data with an empty setup.

## What you can inspect and edit

Select the small **?** beside a section, field, table column or expandable group for an explanation. Help opens with a click, tap, or keyboard activation; **Close help** or **Escape** returns without changing the field or expanding the group. Informational sections also explain where to configure the setting in Harmony.

Device control settings preserve both numeric and text values from the hub. Known transport codes display names such as **Infrared (IR)** and **Bluetooth**. Infrared output assignments identify the hub and mini blasters while retaining the original code. Bluetooth control does not use an IR emitter assignment. Unfamiliar codes remain visible without assuming a meaning; **Not reported by hub** means no usable value was supplied. Choose **Read hub** after updating the plugin to refresh the imported settings.

| Configuration | Inspect | Apply changes |
| --- | --- | --- |
| Devices, available command names, power actions and input actions | Imported when supplied by the hub | Inspect here; configure commands using Harmony |
| Device power policy, power command type, repeats and power-on/input/inter-device/inter-key delays | Imported, with separately reported defaults when available | Draft here, including missing values; change in Harmony, sync, then read the hub to verify |
| Infrared output assignment | Imported control port | Choose hub / mini blaster outputs in a draft when infrared transport is confirmed; apply in Harmony IR Assignments |
| Input order | Inputs sorted by their stored order | Move inputs up/down in a draft; apply the order using Harmony Input Settings |
| Input method | Reported method, separate from input names and commands | Choose a recognized method in a draft; apply using Harmony Input Settings and complete its command-selection questions |
| Activity name and display order | Imported | Draft, review and save to Logitech; compile and sync separately |
| Existing activity role power-on/off order | Imported | Draft, review and save to Logitech; compile and sync separately |
| Delay before the next device | Imported when present | Draft here; apply using Harmony |
| Activity roles, selected inputs and explicit start/end actions | Imported | Change using Harmony |
| Button maps and sequences | Available hub maps only | Inspect only; remote-specific maps may be absent |
| HDMI wiring, CEC, desired power behavior and automation notes | Your answers | Saved locally in the configurator |

**Not supplied** means the imported value is unknown. It does not mean zero, disabled, a known default, or that the device cannot support the setting. **Reported default** is shown only when the hub supplies a separate profile default; it is never substituted for a missing active value. **Unknown** in that column means no default was reported. Choose Read hub after an update to refresh these values.

Use **Set draft** for a supported setting with no imported value. The editor starts blank and offers valid choices or an explicit numeric range; it does not assume zero or Yes. Device profiles may offer a narrower range or omit a setting in Harmony. Drafts are proposals, not proof of device capabilities. Activity fields without an original value also use manual Harmony guidance rather than a cloud save. If the hub continues to omit a setting after you apply it, the draft remains unconfirmed.

**Input method** is separate from the input list and its commands. The list can be present without a method value. **Input sequence actions** shows shared Start, Next, Previous and Finish steps: opening an input menu, navigating it and confirming a selection. A direct command such as Input1 may need none of these steps. Use Harmony **Input Settings** to select a method and its commands; **Fix an input** changes a selection command. Raw action sequences remain informational here. Reordering inputs changes their list order, not HDMI socket names or assigned commands.

This is a preview, not a complete replacement for the Harmony application. Unknown vendor fields, raw IR codes, account details and credentials are not exposed in the inspector. FunctionList is requested to report resource availability; function-map interpretation is not implemented. Unsupported fields are informational and cannot be saved through an arbitrary JSON editor.

Cloud writes use an unofficial protocol and have automated fixture coverage. Validate the preview against your own hub before relying on it. There is no local resource-write endpoint and no cloud blocking.

## Setup Assistant and suggestions

Describe each device’s HDMI cables, CEC state, wake and sleep methods, desired behavior when switching away, and behavior on All Off. **I’m not sure** is a valid answer. Device-specific hints explain where to look for settings. Answers survive child-bridge restarts, and older single-connection answers appear as the first cable row.

Use the **Methods that can wake this device** and **Methods that can put it to sleep** checkboxes to select every available method. Capability is separate from preference: **Preferred wake method for activities** and **Preferred sleep method for All Off** describe the main method you want activities to use. These answers do not enable, disable or execute any controller. Older answers populate the corresponding checkboxes without changing the preferred method.

Under **Wake and sleep paths**, choose **Add wake or sleep path** for each method, sending device or external controller, and trigger. For example, record CEC sleep from the TV, CEC sleep from another device and a HomeKit/Homebridge Sleep button as three separate paths. Leave the preferred method unknown if several paths are equally important. Suggestions check recorded capabilities, preferred methods and active paths. A capability checkbox alone does not mean commands will run together; trigger text remains a note for manual review.

Under **HDMI connections**, add one row per cable, with the output port on this device, destination device, destination input and ARC/eARC mode. A receiver can have several output rows, including an HDMI OUT 1 (eARC) cable to a TV and another output to a projector. Sources each connect to a receiver input. ARC/eARC returns TV audio over the same receiver-to-TV cable and is separate from CEC power control; do not add a reverse video connection for audio return. Remove a row to remove the local wiring record, then Save answers.

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

## HTTPS reverse proxy

Set **Configurator public URL (HTTPS reverse proxy)** to the HTTPS origin, for example `https://harmony.example.com`. Leave it empty for direct access. Save and restart the child bridge; **Open configurator** then issues its access link for that origin.

This mode supports a proxy on the same machine. Nginx must connect to `http://127.0.0.1:18081`, preserve `Host` and `Origin`, and overwrite `X-Forwarded-Proto` with `$scheme`. Use your actual configurator port if different. Public-host requests from non-loopback peers or without `X-Forwarded-Proto: https` are rejected. Arbitrary forwarded host headers are not trusted. Public URLs cannot contain paths, credentials, queries or fragments.

Nginx handles the browser certificate; leave the plugin's certificate paths empty. Sessions through the public URL use Secure cookies and retain the same origin/CSRF protections. Configure IPv4 and IPv6 listeners when DNS publishes both address families. Direct LAN access remains available, but its browser session is separate from the public hostname session.

## Direct website sign-in

After enabling the configurator and restarting the child bridge, open **Direct website sign-in** in the Homebridge plugin settings. Enter a username, enter and confirm a separate password of 8–256 characters, and choose **Set username and password**. Usernames are case-insensitive and use 1–64 letters, numbers, dots, underscores, @ signs or hyphens. This takes effect immediately; no bridge restart is needed. Use your HTTPS configurator URL directly and sign in.

Select **Remember this browser for 30 days** to keep access across browser and child-bridge restarts. Without it, access lasts up to 12 hours and ends when the child bridge restarts; the cookie also expires with the browser session. Remembered sessions expire 30 days after sign-in, without extending on use. Logitech sign-in remains separate and is never remembered across bridge restarts.

Use **Sign out** for this browser or **Sign out all browsers** to revoke every configurator session. Homebridge settings also provide session revocation and password replacement if you forget the password. Replacing the password revokes existing sessions and access links.

The username, a salted password hash and hashes of remembered session tokens are stored in the private `configurator-auth.json` file alongside plugin state. They are excluded from configuration exports and Homebridge settings. Password entry requires HTTPS or a localhost connection, including an SSH tunnel. Repeated sign-in attempts are limited to ten per minute across the configurator.

Existing password-only setups remain usable after updating. Save a username and password in Homebridge to require both on future sign-ins. This replaces the single configurator login and revokes existing sessions; it does not create multiple user accounts.

## Phone home-screen shortcut

The configurator includes a browser tab icon and phone home-screen icon. In Safari on iPhone, open the direct configurator URL, choose **Share → Add to Home Screen**, and name it Harmony. On Android, use your browser’s **Add to Home screen** option. The shortcut opens the configurator in a standalone window where supported; it still requires a connection to the Homebridge server. Choose Remember this browser when signing in from the shortcut to retain access.

## Optional HTTPS certificate for the web configurator

The certificate and private-key fields enable HTTPS directly on the plugin’s webserver. Leave both fields empty to use local HTTP through the **Open configurator** button in Homebridge settings. Hub inspection, answers and drafts do not require a certificate. Leave them empty also when an HTTPS reverse proxy such as Nginx handles the browser connection. Entering a configurator password or Logitech credentials requires HTTPS or a localhost SSH tunnel.
