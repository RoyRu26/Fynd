import { z } from 'zod';

// Mirrors the profiles_username_format CHECK constraint exactly.
export const USERNAME_REGEX = /^[A-Za-z0-9_]{3,30}$/;

export const onboardingSchema = z.object({
  username: z.string().trim().regex(USERNAME_REGEX, 'Use 3-30 letters, numbers, or underscores'),
  displayName: z
    .string()
    .trim()
    .min(1, 'Display name is required')
    .max(50, 'Keep it under 50 characters'),
});

export type OnboardingInput = z.infer<typeof onboardingSchema>;
