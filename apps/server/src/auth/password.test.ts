import { describe, expect, it } from 'vitest';

import { FAST_SCRYPT_PARAMS } from '../test/harness';
import { hashPassword, verifyPassword } from './password';

describe('password hashing', () => {
  it('verifies the original password and rejects others', async () => {
    const hash = await hashPassword('correct horse', FAST_SCRYPT_PARAMS);
    expect(hash).toMatch(/^scrypt\$1024\$8\$1\$/);
    await expect(verifyPassword('correct horse', hash)).resolves.toBe(true);
    await expect(verifyPassword('wrong horse', hash)).resolves.toBe(false);
  });

  it('uses a random salt for each hash', async () => {
    const first = await hashPassword('same password', FAST_SCRYPT_PARAMS);
    const second = await hashPassword('same password', FAST_SCRYPT_PARAMS);
    expect(first).not.toBe(second);
  });

  it.each(['', 'bcrypt$x', 'scrypt$abc$8$1$c2FsdA==$aGFzaA=='])(
    'rejects malformed hash %j',
    async (stored) => {
      await expect(verifyPassword('anything', stored)).resolves.toBe(false);
    },
  );
});
