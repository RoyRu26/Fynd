import { describe, expect, it } from 'vitest';

import { signInSchema, signUpSchema, MIN_PASSWORD_LENGTH } from '@/features/auth/schemas';

describe('signInSchema', () => {
  it('accepts a valid email and password', () => {
    const result = signInSchema.safeParse({ email: 'a@b.com', password: 'x' });
    expect(result.success).toBe(true);
  });

  it('trims the email', () => {
    const result = signInSchema.safeParse({ email: '  a@b.com  ', password: 'x' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe('a@b.com');
    }
  });

  it('rejects a missing email', () => {
    const result = signInSchema.safeParse({ email: '', password: 'x' });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid email format', () => {
    const result = signInSchema.safeParse({ email: 'not-an-email', password: 'x' });
    expect(result.success).toBe(false);
  });

  it('rejects a missing password', () => {
    const result = signInSchema.safeParse({ email: 'a@b.com', password: '' });
    expect(result.success).toBe(false);
  });

  it('does not trim the password', () => {
    const result = signInSchema.safeParse({ email: 'a@b.com', password: '  x  ' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.password).toBe('  x  ');
    }
  });
});

describe('signUpSchema', () => {
  const base = {
    email: 'a@b.com',
    password: 'x'.repeat(MIN_PASSWORD_LENGTH),
    confirmPassword: 'x'.repeat(MIN_PASSWORD_LENGTH),
  };

  it('accepts matching passwords at the minimum length', () => {
    expect(signUpSchema.safeParse(base).success).toBe(true);
  });

  it('rejects a password shorter than MIN_PASSWORD_LENGTH', () => {
    const result = signUpSchema.safeParse({
      ...base,
      password: 'x'.repeat(MIN_PASSWORD_LENGTH - 1),
      confirmPassword: 'x'.repeat(MIN_PASSWORD_LENGTH - 1),
    });
    expect(result.success).toBe(false);
  });

  it('rejects mismatched passwords at the confirmPassword path', () => {
    const result = signUpSchema.safeParse({ ...base, confirmPassword: `${base.password}y` });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.join('.') === 'confirmPassword')).toBe(
        true,
      );
    }
  });
});
