import { zodResolver } from '@hookform/resolvers/zod';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { Platform, StyleSheet, View } from 'react-native';

import { PasswordField } from '@/components/auth/password-field';
import { Button, Icon, Logo, Screen, Text, TextField, type IconName } from '@/components/ui';
import { useAppTheme } from '@/design/theme-provider';
import { radius, space } from '@/design/tokens';
import { resendSignUpEmail, signUp } from '@/features/auth/api';
import { mapAuthError } from '@/features/auth/errors';
import {
  PASSWORD_HELPER_TEXT,
  PASSWORD_METER_SEGMENTS,
  getPasswordLengthScore,
} from '@/features/auth/password-strength';
import {
  RESEND_COOLDOWN_SECONDS,
  canResend,
  cooldownSecondsLeft,
  formatCooldown,
} from '@/features/auth/resend';
import { signUpSchema, type SignUpInput } from '@/features/auth/schemas';
import { useCountdown } from '@/hooks/use-countdown';

// Android has no 'envelope' symbol — verified against expo-symbols'
// android/symbols.json, same discipline as every other IconName here.
const MAIL_ICON: IconName = { ios: 'envelope.fill', android: 'mail', web: 'mail' };

const MAIL_BADGE_SIZE = 72;

/**
 * Opens the device's mail app.
 *
 * iOS `message://` lands in Mail's inbox, which is exactly right. Android has
 * no equivalent inbox URL, and `mailto:` — the usual workaround — opens an app
 * chooser or a compose window rather than the inbox. It is a rough edge, kept
 * because landing in the right app beats offering nothing, not because it is
 * clean.
 */
const MAIL_APP_URL = Platform.select({ ios: 'message://', default: 'mailto:' });

export default function SignUp() {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  // Set when signUp() succeeds but returns no session — the email
  // confirmation is enabled branch. Local dev has confirmations off, so this
  // won't normally trigger, but the branch exists so enabling confirmations
  // later is a config change, not a rewrite.
  const [checkEmail, setCheckEmail] = useState<string | null>(null);

  const {
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<SignUpInput>({
    resolver: zodResolver(signUpSchema),
    defaultValues: { email: '', password: '', confirmPassword: '' },
  });

  async function onSubmit(input: SignUpInput) {
    setFormError(null);
    try {
      const data = await signUp(input.email, input.password);
      if (!data.session) {
        setCheckEmail(input.email);
      }
      // Otherwise onAuthStateChange picks up the new session; root resolver redirects.
    } catch (err) {
      if (__DEV__) {
        console.error(err);
      }
      const mapped = mapAuthError(err);
      if (mapped.field === 'email' || mapped.field === 'password') {
        setError(mapped.field, { message: mapped.message });
      } else {
        setFormError(mapped.message);
      }
    }
  }

  if (checkEmail) {
    return (
      <CheckEmail
        email={checkEmail}
        // Returns to the form rather than routing anywhere. `useForm` lives in
        // this component, which stays mounted, so the values survive and the
        // user lands on a prefilled form — no params to thread, no state to
        // rehydrate. The inputs do remount and nothing autofocuses, so they
        // still have to tap the field to edit it.
        onChangeEmail={() => setCheckEmail(null)}
      />
    );
  }

  return (
    <View style={styles.root}>
      <Screen scroll keyboardAvoiding contentContainerStyle={styles.contentContainer}>
        <View style={styles.content}>
          <View style={styles.identity}>
            <Logo height={34} />
            <Text variant="title">Create your account</Text>
            <Text variant="body" color="textSecondary">
              Join Fynd to discover, buy, and sell second-hand.
            </Text>
          </View>

          <View style={styles.fields}>
            <Controller
              control={control}
              name="email"
              render={({ field }) => (
                <TextField
                  label="Email"
                  autoCapitalize="none"
                  autoComplete="email"
                  keyboardType="email-address"
                  value={field.value}
                  onChangeText={field.onChange}
                  onBlur={field.onBlur}
                  error={errors.email?.message}
                />
              )}
            />

            {/* Meter sits tight under its own field, inside the looser gap
                that separates the fields from each other. */}
            <View style={styles.passwordGroup}>
              <Controller
                control={control}
                name="password"
                render={({ field }) => (
                  <PasswordField
                    label="Password"
                    autoCapitalize="none"
                    autoComplete="new-password"
                    value={field.value}
                    onChangeText={field.onChange}
                    onBlur={field.onBlur}
                    error={errors.password?.message}
                    helperText={PASSWORD_HELPER_TEXT}
                  />
                )}
              />
              <PasswordMeter control={control} />
            </View>

            <Controller
              control={control}
              name="confirmPassword"
              render={({ field }) => (
                <PasswordField
                  label="Confirm password"
                  placeholder="Re-enter password"
                  autoCapitalize="none"
                  autoComplete="new-password"
                  value={field.value}
                  onChangeText={field.onChange}
                  onBlur={field.onBlur}
                  error={errors.confirmPassword?.message}
                />
              )}
            />
          </View>

          {formError ? (
            <Text
              variant="caption"
              color="danger"
              accessibilityLiveRegion="polite"
              accessibilityRole="alert">
              {formError}
            </Text>
          ) : null}

          <View style={styles.actions}>
            <Button onPress={handleSubmit(onSubmit)} loading={isSubmitting}>
              Create account
            </Button>
            <Text variant="caption" color="textTertiary" style={styles.terms}>
              By creating an account you agree to our Terms and Privacy Policy.
            </Text>
            <Button variant="ghost" onPress={() => router.push('/(auth)/sign-in')}>
              Already have an account? Sign in
            </Button>
          </View>
        </View>
      </Screen>
    </View>
  );
}

/**
 * Four-segment length meter under the password field.
 *
 * Local to this screen — one consumer, so DESIGN.md §15 rule 2's second-caller
 * rule says it stays here rather than becoming a `ui/` primitive.
 *
 * `useWatch` rather than lifting the password into component state: it
 * subscribes this subtree alone to that one field, so typing a password
 * re-renders the meter without re-rendering the whole form.
 */
function PasswordMeter({ control }: { control: ReturnType<typeof useForm<SignUpInput>>['control'] }) {
  const { colors } = useAppTheme();
  const password = useWatch({ control, name: 'password' }) ?? '';
  const score = getPasswordLengthScore(password);

  return (
    <View
      style={styles.meter}
      // Decorative duplicate: the field's own `helperText` already states the
      // requirement, and that is what a screen reader announces with the
      // input. A second, wordless "2 of 4" announcement adds noise without
      // adding information.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants">
      {Array.from({ length: PASSWORD_METER_SEGMENTS }, (_, index) => (
        <View
          key={index}
          style={[
            styles.meterSegment,
            { backgroundColor: index < score ? colors.success : colors.border },
          ]}
        />
      ))}
    </View>
  );
}

/** 3d — the post-signup confirmation screen, with resend. */
function CheckEmail({ email, onChangeEmail }: { email: string; onChangeEmail: () => void }) {
  const { colors } = useAppTheme();
  const [resendDeadline, setResendDeadline] = useState<number | null>(
    () => Date.now() + RESEND_COOLDOWN_SECONDS * 1000,
  );
  const [resendError, setResendError] = useState<string | null>(null);
  const [isResending, setIsResending] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);

  // A clock, not a counter — see use-countdown.ts. The remainder is derived
  // from a fixed deadline, so it stays correct across the app being
  // backgrounded in the user's mail app, which is precisely what happens here.
  const now = useCountdown(resendDeadline);
  const secondsLeft = cooldownSecondsLeft(resendDeadline, now);
  const resendReady = canResend(secondsLeft);

  async function handleResend() {
    if (!resendReady || isResending) return;
    setResendError(null);
    setIsResending(true);
    try {
      await resendSignUpEmail(email);
      setResendDeadline(Date.now() + RESEND_COOLDOWN_SECONDS * 1000);
    } catch (err) {
      if (__DEV__) {
        console.error(err);
      }
      // Cooldown is NOT restarted on failure: a network blip should not cost
      // the user another minute. The real limit is GoTrue's, which answers
      // `over_email_send_rate_limit` and is mapped to copy telling them to
      // wait — so a user retrying into a rate limit gets told why rather than
      // being silently blocked by this client-side timer.
      setResendError(mapAuthError(err).message);
    } finally {
      setIsResending(false);
    }
  }

  async function handleOpenMail() {
    setOpenError(null);
    try {
      await Linking.openURL(MAIL_APP_URL);
    } catch (err) {
      if (__DEV__) {
        console.error(err);
      }
      setOpenError('Couldn’t open a mail app. Open your inbox manually to continue.');
    }
  }

  return (
    <View style={styles.root}>
      <Screen scroll contentContainerStyle={styles.contentContainer}>
        <View style={styles.content}>
          <View style={styles.identity}>
            <View
              style={[styles.mailBadge, { backgroundColor: colors.accent }]}
              // Decorative: the heading beside it already says "Check your
              // email", so announcing an envelope adds nothing.
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants">
              <Icon name={MAIL_ICON} size="xl" color={colors.onAccent} />
            </View>
            <Text variant="title">Check your email</Text>
            <Text variant="body" color="textSecondary">
              We sent a confirmation link to{' '}
              <Text variant="bodyStrong">{email}</Text>. Tap it to finish setting up your account.
            </Text>
          </View>

          <View style={styles.actions}>
            <Button variant="inverse" onPress={handleOpenMail}>
              Open email app
            </Button>

            <Button
              variant="ghost"
              onPress={handleResend}
              disabled={!resendReady}
              loading={isResending}>
              {resendReady ? 'Resend email' : `Resend in ${formatCooldown(secondsLeft)}`}
            </Button>
          </View>

          {openError ? (
            <Text
              variant="caption"
              color="danger"
              accessibilityLiveRegion="polite"
              accessibilityRole="alert">
              {openError}
            </Text>
          ) : null}

          {resendError ? (
            <Text
              variant="caption"
              color="danger"
              accessibilityLiveRegion="polite"
              accessibilityRole="alert">
              {resendError}
            </Text>
          ) : null}

          <View style={styles.wrongAddress}>
            <Text variant="caption" color="textTertiary">
              Wrong address?
            </Text>
            <Button variant="ghost" size="sm" onPress={onChangeEmail}>
              Change email
            </Button>
          </View>
        </View>
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  contentContainer: {
    flexGrow: 1,
    justifyContent: 'flex-start',
    paddingTop: space[10],
  },
  content: {
    gap: space[8],
  },
  identity: {
    gap: space[2],
  },
  fields: {
    gap: space[3],
  },
  passwordGroup: {
    gap: space[2],
  },
  meter: {
    flexDirection: 'row',
    gap: space[1],
  },
  meterSegment: {
    flex: 1,
    height: space[1],
    borderRadius: radius.xs,
  },
  actions: {
    gap: space[3],
  },
  terms: {
    textAlign: 'center',
  },
  mailBadge: {
    width: MAIL_BADGE_SIZE,
    height: MAIL_BADGE_SIZE,
    borderRadius: MAIL_BADGE_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space[2],
  },
  wrongAddress: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[1],
  },
});
