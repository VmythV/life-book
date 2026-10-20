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

/** 校验查询参数，规则与请求体相同。 */
export function readQuery<TSchema extends z.ZodType>(
  c: Context,
  schema: TSchema,
): z.output<TSchema> {
  const result = schema.safeParse(c.req.query());
  if (!result.success) {
    throw new ApiError(
      400,
      'VALIDATION_FAILED',
      '查询参数不正确',
      z.flattenError(result.error),
    );
  }
  return result.data;
}
