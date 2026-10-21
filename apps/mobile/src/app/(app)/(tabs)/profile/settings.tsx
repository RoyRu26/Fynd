import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Button, Icon, ListRow, Screen, Switch, Text, type IconName } from '@/components/ui';
import { space } from '@/design/tokens';
import { useAppTheme } from '@/design/theme-provider';
import { signOut } from '@/features/auth/api';
import { useAuth } from '@/features/auth/auth-provider';
import { useProfile } from '@/features/profile/queries';
import { mapNotificationPreferenceError } from '@/features/settings/errors';
import { useUpdateNotificationPreferencesMutation } from '@/features/settings/queries';
import { normalizeNotificationPreferences } from '@/features/settings/settings';

/**
 * Settings — ROADMAP 6.1a. Sign-out lives here (moved off the Profile tab
 * root, where it sat incorrectly) along with the real, persisted
 * notification-preference switches and the privacy/terms links.
 *
 * Account deletion is ROADMAP 6.1b, a separate later pass — deliberately
 * not built here.
 *
 * No manual back control — same precedent as my-listings.tsx/saved.tsx
 * (profile/_layout.tsx's Stack sets headerShown: false, but the platform
 * swipe-back/hardware-back gesture still applies). edit.tsx is the one
 * screen in this folder with its own back IconButton, for reasons specific
 * to that screen (see its own header comment); this one doesn't need it.
 */

// Same pair profile/index.tsx already uses for its own navigational rows.
const CHEVRON_ICON: IconName = { ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' };

type PreferenceField = 'notifyNewMessage' | 'notifyNewReview' | 'notifyNewFollower';

export default function Settings() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const { session } = useAuth();
  const userId = session?.user.id;

  const profileQuery = useProfile(userId);

  return (
    <Screen scroll contentContainerStyle={styles.content}>
      <Text variant="title">Settings</Text>

      {profileQuery.isPending ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.textTertiary} />
        </View>
      ) : profileQuery.isError || !profileQuery.data ? (
        <View style={styles.centered}>
          <Text variant="body" color="danger">
            Something went wrong loading your settings.
          </Text>
          <Button variant="secondary" size="sm" onPress={() => profileQuery.refetch()}>
            Try again
          </Button>
        </View>
      ) : (
        <NotificationPreferencesSection userId={userId as string} profile={profileQuery.data} />
      )}

      <View style={styles.rows}>
        <Text variant="label" color="textSecondary">
          About
        </Text>
        <ListRow
          title="Privacy policy"
          onPress={() => router.push('/(app)/(tabs)/profile/legal/privacy')}
          trailing={<Icon name={CHEVRON_ICON} size="sm" color={colors.textTertiary} />}
        />
        <ListRow
          title="Terms of service"
          onPress={() => router.push('/(app)/(tabs)/profile/legal/terms')}
          trailing={<Icon name={CHEVRON_ICON} size="sm" color={colors.textTertiary} />}
        />
      </View>

      <Button variant="secondary" size="sm" onPress={() => signOut()}>
        Sign out
      </Button>
    </Screen>
  );
}

function NotificationPreferencesSection({
  userId,
  profile,
}: {
  userId: string;
  profile: {
    notify_new_message: boolean | null;
    notify_new_review: boolean | null;
    notify_new_follower: boolean | null;
  };
}) {
  const updatePreferences = useUpdateNotificationPreferencesMutation(userId);
  // Keyed per field, not a single shared slot: toggling one row must never
  // silently clear another row's still-relevant error.
  const [errors, setErrors] = useState<Partial<Record<PreferenceField, string>>>({});

  const preferences = normalizeNotificationPreferences(profile);

  // `variables` holds the in-flight patch while `isPending` is true (each
  // patch is always exactly one field — see handleToggle below), so this
  // disables only the specific row with a request in flight, not all three.
  const pendingField =
    updatePreferences.isPending && updatePreferences.variables
      ? (Object.keys(updatePreferences.variables)[0] as PreferenceField)
      : null;

  async function handleToggle(field: PreferenceField, nextValue: boolean) {
    setErrors((prev) => ({ ...prev, [field]: undefined }));
    try {
      await updatePreferences.mutateAsync({ [field]: nextValue });
    } catch (err) {
      if (__DEV__) {
        console.error(err);
      }
      setErrors((prev) => ({ ...prev, [field]: mapNotificationPreferenceError(err).message }));
    }
  }

  return (
    <View style={styles.rows}>
      <Text variant="label" color="textSecondary">
        Notifications
      </Text>
      <PreferenceRow
        title="New message notifications"
        value={preferences.notifyNewMessage}
        onValueChange={(next) => handleToggle('notifyNewMessage', next)}
        disabled={pendingField === 'notifyNewMessage'}
        error={errors.notifyNewMessage ?? null}
      />
      <PreferenceRow
        title="New review notifications"
        value={preferences.notifyNewReview}
        onValueChange={(next) => handleToggle('notifyNewReview', next)}
        disabled={pendingField === 'notifyNewReview'}
        error={errors.notifyNewReview ?? null}
      />
      <PreferenceRow
        title="New follower notifications"
        value={preferences.notifyNewFollower}
        onValueChange={(next) => handleToggle('notifyNewFollower', next)}
        disabled={pendingField === 'notifyNewFollower'}
        error={errors.notifyNewFollower ?? null}
      />
    </View>
  );
}

function PreferenceRow({
  title,
  value,
  onValueChange,
  disabled,
  error,
}: {
  title: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled: boolean;
  error: string | null;
}) {
  return (
    <View>
      <ListRow
        title={title}
        trailing={
          <Switch value={value} onValueChange={onValueChange} disabled={disabled} accessibilityLabel={title} />
        }
      />
      {error ? (
        <Text
          variant="caption"
          color="danger"
          style={styles.rowError}
          accessibilityLiveRegion="polite"
          accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    gap: space[6],
    paddingTop: space[6],
    paddingBottom: space[8],
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[3],
    paddingVertical: space[6],
  },
  rows: {
    gap: space[2],
  },
  rowError: {
    paddingHorizontal: space[4],
    marginTop: -space[1],
  },
});
