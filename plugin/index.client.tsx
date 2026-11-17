import type { PluginClientContext, PluginScreenProps, PluginSurfaceProps, PluginWorkspacePanelProps } from '@getpaseo/plugin/client';
import { AgySwitcherView } from './client/AgySwitcherView.tsx';
import { profilesSwitchBest } from './shared/rpc.ts';

const SCREEN_ID = 'agy-switcher';
const PANEL_ID = 'agy-switcher-panel';

function SettingsEntry({ theme }: PluginSurfaceProps) {
  return <AgySwitcherView theme={theme} />;
}

function ScreenEntry({ theme }: PluginScreenProps) {
  return <AgySwitcherView theme={theme} />;
}

function WorkspacePanelEntry({ theme }: PluginWorkspacePanelProps) {
  return <AgySwitcherView theme={theme} />;
}

/**
 * Paseo Desktop client contribution for `agy-switcher`.
 * Registers settings screen, global screen, workspace panel, and Command Center actions.
 */
export default function contribute(client: PluginClientContext) {
  const cleanups = [
    client.addSettingsScreen({
      id: SCREEN_ID,
      title: 'Antigravity Accounts',
      icon: 'Users',
      Component: SettingsEntry,
    }),
    client.addScreen({
      id: SCREEN_ID,
      title: 'Antigravity Accounts',
      Component: ScreenEntry,
    }),
    client.addWorkspacePanel({
      id: PANEL_ID,
      title: 'Antigravity',
      icon: 'Users',
      locations: ['workspace', 'explorer'],
      Component: WorkspacePanelEntry,
    }),
    client.addCommandCenterItem({
      id: 'agy-switcher-open',
      title: 'Antigravity: Open Account Switcher',
      icon: 'Users',
      keywords: ['antigravity', 'agy', 'account', 'switch', 'quota', 'profile'],
      context: 'global',
      onSelect({ openScreen }) {
        openScreen({ screenId: SCREEN_ID });
      },
    }),
    client.addCommandCenterItem({
      id: 'agy-switcher-switch-best',
      title: 'Antigravity: Switch to Best Quota Account',
      icon: 'Sparkles',
      keywords: ['antigravity', 'agy', 'best', 'quota', 'switch', 'failover'],
      context: 'global',
      async onSelect({ rpc, openScreen }) {
        await rpc(profilesSwitchBest, {});
        openScreen({ screenId: SCREEN_ID });
      },
    }),
  ];

  return () => {
    for (const off of cleanups) off();
  };
}
