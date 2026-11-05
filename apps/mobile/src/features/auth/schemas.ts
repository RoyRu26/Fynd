import { z } from 'zod';

// Mirrors local Supabase config's auth.minimum_password_length. Not fetched
// dynamically; imported by errors.ts so the number is never duplicated.
export const MIN_PASSWORD_LENGTH = 6;

// One definition for the email rule, shared by all three auth forms. Extracted
// when the password-reset form became the third caller — three copies of the
// same trim/required/format chain is three places for the messages to drift.
const emailField = z.string().trim().min(1, 'Email is required').email('Enter a valid email address');

export const signInSchema = z.object({
  email: emailField,
  password: z.string().min(1, 'Password is required'),
});

export type SignInInput = z.infer<typeof signInSchema>;

export const signUpSchema = z
  .object({
    email: emailField,
    password: z
      .string()
      .min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`),
    confirmPassword: z.string().min(1, 'Please confirm your password'),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ['confirmPassword'],
  });

export type SignUpInput = z.infer<typeof signUpSchema>;

// Email only: this requests the reset link. Choosing the new password happens
// in the emailed flow, not here — see `resetPassword` in api.ts for why that
// half is deliberately not in the app yet.
export const resetPasswordSchema = z.object({
  email: emailField,
});

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
