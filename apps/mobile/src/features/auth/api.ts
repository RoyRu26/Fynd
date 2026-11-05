import { supabase } from '@/lib/supabase';

export async function signIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signUp(email: string, password: string) {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

/**
 * Sends a password-reset email.
 *
 * No `redirectTo`, deliberately. The client is configured with
 * `detectSessionInUrl: false` (see `lib/supabase.ts`), so a recovery link
 * opened against the app would NOT establish the session the reset needs —
 * pointing one here would hand the user a dead end. Omitting it lets the link
 * resolve to the project's configured Site URL instead, which is where the
 * reset can actually be completed today.
 *
 * The consequence, stated plainly: a user on their phone follows the link into
 * a browser, not back into Fynd. Closing that loop means a recovery deep link
 * plus an in-app set-new-password screen, which is scoped out of this change.
 *
 * Note GoTrue answers 200 whether or not the address has an account — an
 * anti-enumeration measure. Callers must not infer existence from success, and
 * the UI says "if an account exists" rather than "email sent".
 */
export async function resetPassword(email: string) {
  const { error } = await supabase.auth.resetPasswordForEmail(email);
  if (error) throw error;
}

/**
 * Re-sends the sign-up confirmation email.
 *
 * `type: 'signup'` specifically — not `'email_change'` — so this only ever
 * re-sends a confirmation for an account that has not confirmed yet. Server
 * rate limits apply and surface as `over_email_send_rate_limit`, which
 * `mapAuthError` translates; the client-side cooldown in `resend.ts` is only
 * there so the user normally never reaches that error.
 */
export async function resendSignUpEmail(email: string) {
  const { error } = await supabase.auth.resend({ type: 'signup', email });
  if (error) throw error;
}
