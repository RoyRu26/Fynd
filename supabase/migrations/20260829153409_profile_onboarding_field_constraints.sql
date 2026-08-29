-- ============================================================
-- USERNAME FORMAT
-- ============================================================
-- The existing username_length constraint only bounds character count.
-- Onboarding will accept raw client input for username, and all client
-- input is untrusted, so the allowed character set must be enforced in
-- the database, not only in client-side validation.
--
-- NULL remains allowed (a fresh profile is incomplete until onboarding
-- sets a username). The existing case-insensitive uniqueness enforced by
-- profiles_username_lower_idx is untouched by this migration.

alter table public.profiles
add constraint profiles_username_format
check (
  username is null
  or username ~ '^[A-Za-z0-9_]{3,30}$'
);

-- ============================================================
-- DISPLAY NAME LENGTH
-- ============================================================
-- display_name currently has no constraints at all. NULL remains allowed
-- (incomplete profile). When present, the trimmed value must be between
-- 1 and 50 characters, so empty and whitespace-only values are rejected
-- without needing a normalizing trigger.

alter table public.profiles
add constraint profiles_display_name_length
check (
  display_name is null
  or char_length(btrim(display_name)) between 1 and 50
);
