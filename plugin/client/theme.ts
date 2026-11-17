import type { PluginTheme } from '@getpaseo/plugin';
import type { PressableStateCallbackType, TextStyle } from 'react-native';

export const SPACING = {
  1: 4,
  1.5: 6,
  2: 8,
  3: 12,
  4: 16,
} as const;

export const RADIUS = {
  sm: 4,
  md: 6,
  lg: 8,
} as const;

export type Colour = keyof PluginTheme['colors'];

export function tint(colour: string, alpha = '22'): string {
  if (!/^#[0-9a-f]{6}$/i.test(colour)) return colour;
  return `${colour}${alpha}`;
}

export function hoveredOf(state: PressableStateCallbackType): boolean {
  return 'hovered' in state && (state as { hovered?: boolean }).hovered === true;
}

export function toneForPercentage(pct: number): Colour {
  if (pct <= 10) return 'statusDanger';
  if (pct <= 35) return 'statusWarning';
  return 'statusSuccess';
}

export function labelStyle(theme: PluginTheme, colour: Colour = 'foregroundMuted'): TextStyle {
  return {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
    color: theme.colors[colour],
  };
}

export function titleStyle(theme: PluginTheme): TextStyle {
  return {
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '600',
    color: theme.colors.foreground,
  };
}

export function formatLocalReset(iso?: string): string | undefined {
  if (!iso) return undefined;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return undefined;
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
