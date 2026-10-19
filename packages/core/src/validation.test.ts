import { describe, expect, it } from 'vitest';

import { registerRequestSchema } from './auth';
import { validateFields } from './validation';

describe('validateFields', () => {
  it('returns parsed data when valid', () => {
    expect(
      validateFields(registerRequestSchema, {
        username: 'Alice',
        password: 'long-enough',
      }),
    ).toEqual({ data: { username: 'alice', password: 'long-enough' }, errors: null });
  });

  it('returns the first message per field', () => {
    const result = validateFields(registerRequestSchema, { username: 'a', password: '' });
    expect(result.data).toBeNull();
    expect(result.errors).toEqual({
      username: '用户名为 3～32 位字母、数字或下划线',
      password: '密码至少 8 位',
    });
  });
});
