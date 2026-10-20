import { describe, expect, it } from 'vitest';

import { loginRequestSchema, createUserInputSchema, usernameSchema } from './auth';

describe('usernameSchema', () => {
  it('normalizes case and surrounding spaces', () => {
    expect(usernameSchema.parse('  Alice_01 ')).toBe('alice_01');
  });

  it.each(['ab', 'a'.repeat(33), 'has space', '中文名', 'dash-name'])(
    'rejects %j',
    (value) => {
      expect(usernameSchema.safeParse(value).success).toBe(false);
    },
  );
});

describe('createUserInputSchema', () => {
  it('requires a password of at least 8 characters', () => {
    const result = createUserInputSchema.safeParse({
      username: 'alice',
      password: 'short',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown time zone', () => {
    const result = createUserInputSchema.safeParse({
      username: 'alice',
      password: 'long-enough',
      timezone: 'Mars/Olympus',
    });
    expect(result.success).toBe(false);
  });

  it('accepts a valid request', () => {
    expect(
      createUserInputSchema.parse({
        username: 'Alice',
        password: 'long-enough',
        timezone: 'Asia/Shanghai',
      }),
    ).toEqual({ username: 'alice', password: 'long-enough', timezone: 'Asia/Shanghai' });
  });
});

describe('loginRequestSchema', () => {
  it('normalizes the username without enforcing registration rules', () => {
    expect(loginRequestSchema.parse({ username: ' AB ', password: 'x' })).toEqual({
      username: 'ab',
      password: 'x',
    });
  });
});
