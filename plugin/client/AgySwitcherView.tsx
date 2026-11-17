import type { PluginTheme } from '@getpaseo/plugin';
import { useRpc } from '@getpaseo/plugin/client';
import { Icon, ScrollView, TextInput, useToast } from '@getpaseo/plugin/client/ui';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import {
  profilesList,
  profilesRemove,
  profilesSaveCurrent,
  profilesSwitch,
  profilesSwitchBest,
  type ProfileItemView,
  type QuotaBucketView,
} from '../shared/rpc.ts';
import {
  RADIUS,
  SPACING,
  formatLocalReset,
  hoveredOf,
  labelStyle,
  tint,
  titleStyle,
  toneForPercentage,
} from './theme.ts';

function ActionButton({
  theme,
  label,
  onPress,
  variant = 'secondary',
  disabled = false,
  icon,
}: {
  theme: PluginTheme;
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  icon?: string;
}) {
  const accent =
    variant === 'primary'
      ? theme.colors.accent
      : variant === 'danger'
        ? theme.colors.statusDanger
        : theme.colors.foreground;

  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={(state) => {
        const hovered = hoveredOf(state);
        return {
          flexDirection: 'row',
          alignItems: 'center',
          gap: SPACING[1],
          paddingHorizontal: SPACING[2],
          paddingVertical: SPACING[1.5],
          borderRadius: RADIUS.md,
          borderWidth: 1,
          borderColor:
            variant === 'primary'
              ? theme.colors.accent
              : variant === 'danger'
                ? tint(theme.colors.statusDanger, '55')
                : theme.colors.border,
          backgroundColor:
            variant === 'primary'
              ? hovered
                ? tint(theme.colors.accent, 'dd')
                : theme.colors.accent
              : hovered
                ? theme.colors.surface2
                : theme.colors.surface1,
          opacity: disabled ? 0.5 : 1,
        };
      }}
    >
      {icon ? (
        <Icon
          name={icon}
          size={13}
          color={variant === 'primary' ? theme.colors.surface0 : accent}
        />
      ) : null}
      <Text
        style={{
          fontSize: 12,
          lineHeight: 16,
          fontWeight: '600',
          color: variant === 'primary' ? theme.colors.surface0 : accent,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function QuotaMeter({
  theme,
  label,
  bucket,
  includeStamp = false,
}: {
  theme: PluginTheme;
  label: string;
  bucket?: QuotaBucketView;
  includeStamp?: boolean;
}) {
  if (!bucket) {
    return (
      <View style={{ gap: 4 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={labelStyle(theme)}>{label}</Text>
          <Text style={labelStyle(theme)}>N/A</Text>
        </View>
      </View>
    );
  }

  const tone = toneForPercentage(bucket.percentage);
  const fillColor = theme.colors[tone];
  const countdown = bucket.humanCountdown ?? 'ready';
  const stamp = includeStamp ? formatLocalReset(bucket.resetTime) : undefined;
  const resetText =
    countdown === 'ready'
      ? 'ready'
      : stamp
        ? `${countdown} · ${stamp}`
        : countdown;

  return (
    <View style={{ gap: 4 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={labelStyle(theme)}>{label}</Text>
        <Text style={{ fontSize: 12, lineHeight: 16, fontWeight: '600', color: fillColor }}>
          {bucket.percentage}% · {resetText}
        </Text>
      </View>
      <View
        style={{
          height: 6,
          borderRadius: RADIUS.sm,
          backgroundColor: theme.colors.surface2,
          overflow: 'hidden',
        }}
      >
        <View
          style={{
            height: 6,
            width: `${Math.max(0, Math.min(100, bucket.percentage))}%`,
            backgroundColor: fillColor,
            borderRadius: RADIUS.sm,
          }}
        />
      </View>
    </View>
  );
}

function ProfileCard({
  theme,
  profile,
  busy,
  onSwitch,
  onRemove,
}: {
  theme: PluginTheme;
  profile: ProfileItemView;
  busy: boolean;
  onSwitch: (alias: string) => void;
  onRemove: (alias: string) => void;
}) {
  return (
    <View
      style={{
        padding: SPACING[3],
        borderRadius: RADIUS.lg,
        borderWidth: 1,
        borderColor: profile.isActive ? theme.colors.accent : theme.colors.border,
        backgroundColor: profile.isActive ? tint(theme.colors.accent, '10') : theme.colors.surface1,
        gap: SPACING[2],
      }}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: SPACING[2] }}>
        <View style={{ flex: 1, gap: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING[1.5] }}>
            <Text style={titleStyle(theme)}>{profile.alias}</Text>
            {profile.isActive ? (
              <View
                style={{
                  paddingHorizontal: 6,
                  paddingVertical: 2,
                  borderRadius: RADIUS.sm,
                  backgroundColor: tint(theme.colors.statusSuccess, '22'),
                }}
              >
                <Text style={{ fontSize: 11, fontWeight: '600', color: theme.colors.statusSuccess }}>
                  ACTIVE
                </Text>
              </View>
            ) : null}
            <View
              style={{
                paddingHorizontal: 6,
                paddingVertical: 2,
                borderRadius: RADIUS.sm,
                backgroundColor: theme.colors.surface2,
              }}
            >
              <Text style={{ fontSize: 11, fontWeight: '500', color: theme.colors.foregroundMuted }}>
                {profile.tier}
              </Text>
            </View>
          </View>
          <Text style={labelStyle(theme)}>{profile.email ?? 'unknown email'}</Text>
        </View>

        <View style={{ flexDirection: 'row', gap: SPACING[1.5] }}>
          {!profile.isActive ? (
            <ActionButton
              theme={theme}
              label="Switch"
              variant="primary"
              icon="ArrowLeftRight"
              disabled={busy}
              onPress={() => onSwitch(profile.alias)}
            />
          ) : null}
          <ActionButton
            theme={theme}
            label="Remove"
            variant="danger"
            icon="Trash2"
            disabled={busy}
            onPress={() => onRemove(profile.alias)}
          />
        </View>
      </View>

      {profile.quotaError ? (
        <Text style={labelStyle(theme, 'statusWarning')}>
          Quota unavailable: {profile.quotaError}
        </Text>
      ) : (
        <View style={{ gap: SPACING[1.5] }}>
          <QuotaMeter theme={theme} label="Gemini (5h)" bucket={profile.gemini} />
          <QuotaMeter theme={theme} label="Claude / GPT (5h)" bucket={profile.claude5h} />
          <QuotaMeter theme={theme} label="Claude / GPT (Weekly)" bucket={profile.claudeWeekly} includeStamp />
        </View>
      )}
    </View>
  );
}

export function AgySwitcherView({ theme }: { theme: PluginTheme }) {
  const toast = useToast();
  const listCall = useRpc(profilesList);
  const switchCall = useRpc(profilesSwitch);
  const switchBestCall = useRpc(profilesSwitchBest);
  const saveCurrentCall = useRpc(profilesSaveCurrent);
  const removeCall = useRpc(profilesRemove);

  const [profiles, setProfiles] = useState<ProfileItemView[]>([]);
  const [activeEmail, setActiveEmail] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveAlias, setSaveAlias] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listCall({ fetchQuota: true });
      if (!res.ok) {
        setError(res.error);
      } else {
        setProfiles(res.profiles);
        setActiveEmail(res.activeEmail);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [listCall]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleSwitch = async (alias: string) => {
    setBusy(true);
    try {
      const res = await switchCall({ alias });
      if (!res.ok) {
        toast.error(res.error);
      } else {
        toast.show(`Switched Antigravity account to '${res.activeProfile}'`, { variant: 'success' });
        await refresh();
      }
    } finally {
      setBusy(false);
    }
  };

  const handleSwitchBest = async () => {
    setBusy(true);
    try {
      const res = await switchBestCall({});
      if (!res.ok) {
        toast.error(res.error);
      } else {
        toast.show(`Switched to best account '${res.activeProfile}' (score ${res.score.toFixed(1)})`, {
          variant: 'success',
        });
        await refresh();
      }
    } finally {
      setBusy(false);
    }
  };

  const handleSaveCurrent = async () => {
    const clean = saveAlias.trim();
    if (!clean) {
      toast.error('Enter a profile alias (e.g. pro1)');
      return;
    }
    setBusy(true);
    try {
      const res = await saveCurrentCall({ alias: clean });
      if (!res.ok) {
        toast.error(res.error);
      } else {
        setSaveAlias('');
        toast.show(`Saved active session as '${res.alias}'`, { variant: 'success' });
        await refresh();
      }
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (alias: string) => {
    setBusy(true);
    try {
      const res = await removeCall({ alias });
      if (!res.ok) {
        toast.error(res.error);
      } else {
        toast.show(`Removed profile '${res.alias}'`, { variant: 'info' });
        await refresh();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: theme.colors.surface0 }}>
      <View style={{ padding: SPACING[4], gap: SPACING[3] }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: SPACING[2] }}>
          <View style={{ gap: 2 }}>
            <Text style={{ fontSize: 16, lineHeight: 22, fontWeight: '700', color: theme.colors.foreground }}>
              Antigravity Accounts
            </Text>
            <Text style={labelStyle(theme)}>
              Active Keychain: {activeEmail ?? 'not logged in'}
            </Text>
          </View>

          <View style={{ flexDirection: 'row', gap: SPACING[2] }}>
            <ActionButton
              theme={theme}
              label="Refresh"
              icon="RefreshCw"
              disabled={loading || busy}
              onPress={() => void refresh()}
            />
            <ActionButton
              theme={theme}
              label="Switch Best"
              variant="primary"
              icon="Sparkles"
              disabled={loading || busy || profiles.length === 0}
              onPress={() => void handleSwitchBest()}
            />
          </View>
        </View>

        <View
          style={{
            padding: SPACING[2],
            borderRadius: RADIUS.md,
            backgroundColor: theme.colors.surface1,
            borderWidth: 1,
            borderColor: theme.colors.border,
          }}
        >
          <Text style={labelStyle(theme)}>
            Applies to new `agy` sessions and newly spawned Antigravity agents in Paseo.
          </Text>
        </View>

        <View style={{ flexDirection: 'row', gap: SPACING[2], alignItems: 'center' }}>
          <TextInput
            value={saveAlias}
            onChangeText={setSaveAlias}
            placeholder="Save current session as alias (e.g. pro1)"
            placeholderTextColor={theme.colors.foregroundMuted}
            style={{
              flex: 1,
              height: 34,
              paddingHorizontal: SPACING[2],
              borderRadius: RADIUS.md,
              borderWidth: 1,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.surface1,
              color: theme.colors.foreground,
              fontSize: 13,
            }}
          />
          <ActionButton
            theme={theme}
            label="Save Current"
            icon="BookmarkPlus"
            disabled={busy}
            onPress={() => void handleSaveCurrent()}
          />
        </View>

        {error ? (
          <View style={{ padding: SPACING[3], borderRadius: RADIUS.md, backgroundColor: tint(theme.colors.statusDanger, '18') }}>
            <Text style={labelStyle(theme, 'statusDanger')}>{error}</Text>
          </View>
        ) : null}

        {loading && profiles.length === 0 ? (
          <View style={{ padding: SPACING[4], alignItems: 'center' }}>
            <ActivityIndicator color={theme.colors.accent} />
          </View>
        ) : profiles.length === 0 ? (
          <View
            style={{
              padding: SPACING[4],
              borderRadius: RADIUS.lg,
              borderWidth: 1,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.surface1,
            }}
          >
            <Text style={labelStyle(theme)}>
              No saved profiles yet. Log into `agy` and save your first profile above or via `agy-switcher save pro1`.
            </Text>
          </View>
        ) : (
          <View style={{ gap: SPACING[2] }}>
            {profiles.map((profile) => (
              <ProfileCard
                key={profile.alias}
                theme={theme}
                profile={profile}
                busy={busy}
                onSwitch={(alias) => void handleSwitch(alias)}
                onRemove={(alias) => void handleRemove(alias)}
              />
            ))}
          </View>
        )}
      </View>
    </ScrollView>
  );
}
