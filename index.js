import { HarmonyPlatform } from './lib/platform.js';
import { PLUGIN, PLATFORM } from './lib/config.js';

export default function register(api) {
  api.registerPlatform(PLUGIN, PLATFORM, HarmonyPlatform);
}
