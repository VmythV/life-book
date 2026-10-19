import { type Context } from 'hono';
import { z } from 'zod';

import { ApiError } from './errors';

export async function readJson<TSchema extends z.ZodType>(
  c: Context,
  schema: TSchema,
): Promise<z.output<TSchema>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new ApiError(400, 'VALIDATION_FAILED', '请求体不是有效的 JSON');
  }
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new ApiError(
      400,
      'VALIDATION_FAILED',
      '请求参数不正确',
      z.flattenError(result.error),
    );
  }
  return result.data;
}
