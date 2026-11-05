import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  Button,
  EmptyState,
  Icon,
  ListRow,
  Screen,
  Sheet,
  SkeletonRow,
  Switch,
  Text,
  type IconName,
} from '@/components/ui';
import { space } from '@/design/tokens';
import { useAppTheme } from '@/design/theme-provider';
import { signOut } from '@/features/auth/api';
import { useAuth } from '@/features/auth/auth-provider';
import { mapProfileError } from '@/features/profile/errors';
import { useProfile } from '@/features/profile/queries';
import { mapDeleteAccountError, mapNotificationPreferenceError } from '@/features/settings/errors';
import { useDeleteAccountMutation, useUpdateNotificationPreferencesMutation } from '@/features/settings/queries';
import { normalizeNotificationPreferences } from '@/features/settings/settings';
import { supabase } from '@/lib/supabase';

/**
 * Settings — ROADMAP 6.1a (sign-out, the real notification-preference
 * switches, privacy/terms links) plus 6.1b, the higher-risk self-service
 * account deletion built here on top of it.
 *
 * No manual back control — same precedent as my-listings.tsx/saved.tsx
 * (profile/_layout.tsx's Stack sets headerShown: false, but the platform
 * swipe-back/hardware-back gesture still applies). edit.tsx is the one
 * screen in this folder with its own back IconButton, for reasons specific
 * to that screen (see its own header comment); this one doesn't need it.
 */

// Same pair profile/index.tsx already uses for its own navigational rows.
const CHEVRON_ICON: IconName = { ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' };
// Same shape as explore.tsx/inbox/index.tsx's own ERROR_ICON constants.
const ERROR_ICON: IconName = { ios: 'exclamationmark.triangle', android: 'warning', web: 'warning' };

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
        <View style={styles.skeletonRows}>
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </View>
      ) : profileQuery.isError || !profileQuery.data ? (
        <EmptyState
          variant="error"
          icon={ERROR_ICON}
          title="Something went wrong"
          body={profileQuery.error ? mapProfileError(profileQuery.error).message : undefined}
          actionLabel="Try again"
          onAction={() => profileQuery.refetch()}
        />
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

      <View style={styles.rows}>
        <Text variant="label" color="textSecondary">
          Account
        </Text>
        <DeleteAccountSection />
      </View>
    </Screen>
  );
}

/**
 * ROADMAP 6.1b. `Button variant="danger"` is the outlined/tonal treatment
 * DESIGN.md §8 requires for every destructive action (`dangerBg` fill +
 * `danger` border + `danger` label — see button.tsx/button-state.ts,
 * updated alongside this screen to land that compliant treatment for its
 * first real consumer) — never the solid fill §8 forbids reaching a
 * user-facing screen.
 *
 * Tapping the row alone deletes nothing: it only opens the confirmation
 * `Sheet` below, which owns the actual destructive action behind its own
 * explicit second confirm tap.
 */
function DeleteAccountSection() {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const deleteAccount = useDeleteAccountMutation();

  function openSheet() {
    setError(null);
    setSheetOpen(true);
  }

  function closeSheet() {
    // Guard, not just the confirm/Cancel Buttons' own `disabled` props:
    // `Sheet`'s backdrop tap, swipe-to-dismiss gesture, and Android back
    // button (sheet.tsx) all call this SAME `onClose` prop directly and
    // unconditionally — none of them know about `isPending` on their own.
    // Without this check, dismissing the sheet mid-request doesn't stop the
    // deletion (it's already in flight server-side); it only hides whether
    // it succeeded or failed, which matters more here than for any other
    // mutation in this app.
    if (deleteAccount.isPending) return;
    setSheetOpen(false);
  }

  async function handleConfirm() {
    if (deleteAccount.isPending) return;
    setError(null);
    try {
      await deleteAccount.mutateAsync();
      // `local`, not the default `global` scope: the account is already
      // gone server-side at this point, so a server round-trip sign-out
      // could itself error confusingly for a session that no longer
      // resolves to anything. This still fires the existing `SIGNED_OUT`
      // auth-state-change handler (auth-provider.tsx), which clears the
      // query cache, and the app's existing session-based redirect takes it
      // from there — unchanged by this screen.
      await supabase.auth.signOut({ scope: 'local' });
      // No manual navigation here, mirroring the plain "Sign out" Button
      // above exactly: the SIGNED_OUT event this triggers flows into
      // useAuthRouteState, whose existing `unauthenticated` branch in
      // (app)/_layout.tsx and app/index.tsx already redirects to sign-in —
      // unchanged by this screen.
      setSheetOpen(false);
    } catch (err) {
      if (__DEV__) {
        console.error(err);
      }
      setError(mapDeleteAccountError(err).message);
    }
  }

  return (
    <>
      <Button variant="danger" size="sm" onPress={openSheet}>
        Delete account
      </Button>

      <Sheet visible={sheetOpen} onClose={closeSheet} title="Delete account?">
        <View style={styles.deleteSheetContent}>
          <Text variant="body" color="textSecondary">
            This permanently deletes your account. Your listings will be removed from Fynd and this
            can&apos;t be undone.
          </Text>

          {error ? (
            <Text
              variant="caption"
              color="danger"
              accessibilityLiveRegion="polite"
              accessibilityRole="alert">
              {error}
            </Text>
          ) : null}

          <Button variant="secondary" onPress={closeSheet} disabled={deleteAccount.isPending}>
            Cancel
          </Button>
          <Button variant="danger" onPress={handleConfirm} loading={deleteAccount.isPending}>
            Delete my account
          </Button>
        </View>
      </Sheet>
    </>
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
  skeletonRows: {
    gap: space[2],
  },
  rows: {
    gap: space[2],
  },
  rowError: {
    paddingHorizontal: space[4],
    marginTop: -space[1],
  },
  deleteSheetContent: {
    gap: space[4],
    paddingBottom: space[4],
  },
});
