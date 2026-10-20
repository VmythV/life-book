import { type ErrorCode, type ErrorResponse } from '@life-book/core';
import { type ContentfulStatusCode } from 'hono/utils/http-status';

export class ApiError extends Error {
  public constructor(
    public readonly status: ContentfulStatusCode,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function errorBody(
  code: ErrorCode,
  message: string,
  details?: unknown,
): ErrorResponse {
  return {
    error: { code, message, ...(details === undefined ? {} : { details }) },
  };
}

export const unauthenticated = () => new ApiError(401, 'UNAUTHENTICATED', '请先登录');

export const notFound = (message = '记录不存在') =>
  new ApiError(404, 'NOT_FOUND', message);

/** 与 `readJson` 的校验错误格式一致：`{ formErrors, fieldErrors }`。 */
export function validationFailed(fieldErrors: Record<string, string>): ApiError {
  const [first] = Object.values(fieldErrors);
  return new ApiError(400, 'VALIDATION_FAILED', first ?? '请求参数不正确', {
    formErrors: [],
    fieldErrors: Object.fromEntries(
      Object.entries(fieldErrors).map(([field, message]) => [field, [message]]),
    ),
  });
}
