import type { PluginServerContext } from '@getpaseo/plugin/server';
import {
  profilesList,
  profilesRemove,
  profilesSaveCurrent,
  profilesSwitch,
  profilesSwitchBest,
} from './shared/rpc.ts';
import { createPluginHandlers } from './server/handlers.ts';

/**
 * Paseo Desktop server entry for `agy-switcher`.
 * Exposes profile listing, quota fetching, 1-click switching, save, and remove RPCs.
 */
export default function contribute(server: PluginServerContext) {
  const handlers = createPluginHandlers();

  server.handle(profilesList, (input) => handlers.list(input));
  server.handle(profilesSwitch, (input) => handlers.switchProfile(input));
  server.handle(profilesSwitchBest, () => handlers.switchBest());
  server.handle(profilesSaveCurrent, (input) => handlers.saveCurrent(input));
  server.handle(profilesRemove, (input) => handlers.remove(input));

  return () => {};
}
