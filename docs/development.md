# Development

[← Back to Harmony Home Control](../README.md)

Contributions are welcome. Run checks from the repository root:

```text
npm install
npm run check
npm test
npx playwright install chromium
npm run test:ui
npm pack
```

Protocol tests use local HTTP and UDP sockets with a simulated HAP accessory and simulated physical Hue bridges. They cover mixed routing, authorization, multiple bridges, group writes, state changes, unavailable devices, and stable identities. Browser tests exercise physical bridge discovery/pairing, source selection, mapping, child-bridge settings, and narrow-screen layout. CI installs the runtime dependencies and exercises their imports and the Homebridge UI IPC protocol. These checks do not substitute for testing real Hue hardware and Harmony pairing.

No build step is required to install from a Git checkout. No publishing workflow is included.

The optional child-bridge configurator is implemented in `lib/configurator/` and `configurator-web/`. Its tests cover root-free resource reads, partial coverage, stale imports, session authentication, origin/CSRF checks, private state, optimistic conflicts, XML preservation, cloud account selection, uncertain saves and sync order. Browser workflows cover import, saved setup answers, suggestions, drafts, cloud save/sync with a simulated service, and mobile/dark layouts. These fixtures do not prove compatibility with a physical Harmony hub or Logitech’s current service. See the [configurator guide](configurator.md) for the supported editing surface.

Protocol research used the projects below. Implementations here are independent; no Melodious, Congruity or Terraform-provider code is vendored. Melodious informed resource/schema inspection, not the rooted local-write path. The read-only hub transport uses the stock port 8088 interface. Cloud saves preserve the complete activity XML and patch only allowlisted scalar fields.

## References

- [Homebridge HAP client](https://github.com/homebridge/hap-client)
- [Hue client and discovery tools](https://github.com/ebaauw/hb-hue-tools)
- [Hue local API getting started](https://developers.meethue.com/develop/get-started-2/)
- [Homebridge custom UI utilities](https://github.com/homebridge/plugin-ui-utils)
- [Roku External Control Protocol](https://developer.roku.com/dev/docs/external-control-api)
- [Emulated Roku compatibility notes](https://www.home-assistant.io/integrations/emulated_roku/)
- [Emulated Hue compatibility notes](https://www.home-assistant.io/integrations/emulated_hue/)
- [Harmony physical button assignments](https://support.myharmony.com/en-us/customizing-physical-buttons-on-your-remote)
- [Harmony home-control buttons](https://support.myharmony.com/en-be/customizing-home-control-buttons-remote)
- [Homebridge Hue bridge selection](https://github.com/ebaauw/homebridge-hue/wiki/Configuration)
- [Melodious / Harmony Hub Control](https://github.com/schlambos/harmony-hub-control)
- [Root-free Harmony resource reads](https://github.com/sapn95/harmony-mcp)
- [Harmony Terraform provider cloud protocol](https://github.com/steverice/terraform-provider-harmony/tree/0a223922510b21e77a797b5204803af4ee6343b6/internal/harmony)
- [Congruity MyHarmony service contracts](https://github.com/congruity/congruity)
- [Native numeric device-control examples](https://github.com/schlambos/harmony-hub-control/blob/main/tools/hub-emu/seed/resources/DeviceList.json)
- [Harmony NG IR output bitmask reference](https://github.com/iranl/harmony-ng/blob/44fcb46a8a38a9b6490a8049ca801649379ce4b0/docs/API.md#51-send-direct-ir-command)
