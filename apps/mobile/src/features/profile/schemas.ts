import { z } from 'zod';

// Mirrors the profiles_username_format CHECK constraint exactly.
export const USERNAME_REGEX = /^[A-Za-z0-9_]{3,30}$/;

// Extracted as named exports so onboarding and the edit-profile screen share
// the exact same rules and can never drift — onboardingSchema below is
// unchanged in behavior, just composed from these instead of inlining them.
export const usernameSchema = z
  .string()
  .trim()
  .regex(USERNAME_REGEX, 'Use 3-30 letters, numbers, or underscores');

export const displayNameSchema = z
  .string()
  .trim()
  .min(1, 'Display name is required')
  .max(50, 'Keep it under 50 characters');

// Mirrors the profiles_bio_length CHECK constraint's upper bound. No
// minimum — an empty/whitespace-only bio is normalized to null client-side
// (see profile.ts's normalizeBio), not rejected.
export const bioSchema = z.string().trim().max(160, 'Keep it under 160 characters');

export const onboardingSchema = z.object({
  username: usernameSchema,
  displayName: displayNameSchema,
});

export type OnboardingInput = z.infer<typeof onboardingSchema>;

export const editProfileSchema = z.object({
  username: usernameSchema,
  displayName: displayNameSchema,
  bio: bioSchema,
});

export type EditProfileInput = z.infer<typeof editProfileSchema>;
