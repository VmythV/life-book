import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

export interface ScryptParams {
  N: number;
  r: number;
  p: number;
}

/** OWASP 推荐的 scrypt 参数（约 128 MiB 内存）。 */
export const DEFAULT_SCRYPT_PARAMS: ScryptParams = { N: 2 ** 17, r: 8, p: 1 };

const KEY_LENGTH = 32;
const SALT_LENGTH = 16;

function deriveKey(
  password: string,
  salt: Buffer,
  params: ScryptParams,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password.normalize('NFKC'),
      salt,
      KEY_LENGTH,
      { ...params, maxmem: 256 * params.N * params.r },
      (error, key) => (error ? reject(error) : resolve(key)),
    );
  });
}

/** 返回 `scrypt$N$r$p$salt$hash`，参数随哈希保存，以后调整参数不影响旧密码。 */
export async function hashPassword(
  password: string,
  params: ScryptParams = DEFAULT_SCRYPT_PARAMS,
): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await deriveKey(password, salt, params);
  return [
    'scrypt',
    params.N,
    params.r,
    params.p,
    salt.toString('base64'),
    key.toString('base64'),
  ].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, n, r, p, salt, hash] = stored.split('$');
  if (
    algorithm !== 'scrypt' ||
    n === undefined ||
    r === undefined ||
    p === undefined ||
    salt === undefined ||
    hash === undefined
  ) {
    return false;
  }
  const params = { N: Number(n), r: Number(r), p: Number(p) };
  if (![params.N, params.r, params.p].every(Number.isSafeInteger)) {
    return false;
  }
  const expected = Buffer.from(hash, 'base64');
  const actual = await deriveKey(password, Buffer.from(salt, 'base64'), params);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
