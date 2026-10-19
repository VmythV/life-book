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
