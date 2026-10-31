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
