import {
  type AuthResponse,
  authResponseSchema,
  type ChangePasswordRequest,
  CLIENT_MODE_HEADER,
  type ErrorCode,
  errorResponseSchema,
  type LoginRequest,
  type MeResponse,
  meResponseSchema,
  type RegisterRequest,
  TOKEN_CLIENT_MODE,
  type UpdateSettingsRequest,
  type UserSettings,
  userSettingsSchema,
} from '@life-book/core';
import { type z } from 'zod';

export type ClientErrorCode = ErrorCode | 'NETWORK_ERROR' | 'INVALID_RESPONSE';

export class ApiError extends Error {
  public constructor(
    public readonly status: number,
    public readonly code: ClientErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export type ApiAuth =
  /** Web：会话保存在 httpOnly Cookie 中。 */
  | { mode: 'cookie' }
  /** 手机：登录后拿到令牌，由调用方保存并在每次请求时提供。 */
  | { mode: 'token'; getToken: () => string | null | Promise<string | null> };

export interface ApiClientOptions {
  /** 服务端地址；Web 通过开发代理同源访问时为空字符串。 */
  baseUrl: string;
  auth: ApiAuth;
  fetch?: typeof fetch;
  /** 会话失效（401 UNAUTHENTICATED）时调用，用于跳转到登录页。 */
  onUnauthenticated?: () => void;
}

interface CallOptions<TSchema extends z.ZodType | undefined> {
  body?: unknown;
  schema: TSchema;
}

export function createApiClient(options: ApiClientOptions) {
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);

  async function call<TSchema extends z.ZodType | undefined>(
    method: string,
    path: string,
    { body, schema }: CallOptions<TSchema>,
  ): Promise<TSchema extends z.ZodType ? z.output<TSchema> : void> {
    const headers = new Headers({ accept: 'application/json' });
    if (body !== undefined) {
      headers.set('content-type', 'application/json');
    }
    if (options.auth.mode === 'token') {
      headers.set(CLIENT_MODE_HEADER, TOKEN_CLIENT_MODE);
      const token = await options.auth.getToken();
      if (token !== null) {
        headers.set('authorization', `Bearer ${token}`);
      }
    }

    let response: Response;
    try {
      response = await fetchImpl(`${options.baseUrl}${path}`, {
        method,
        headers,
        credentials: options.auth.mode === 'cookie' ? 'include' : 'omit',
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (error) {
      throw new ApiError(0, 'NETWORK_ERROR', '无法连接服务器，请检查网络', error);
    }

    if (!response.ok) {
      throw await toApiError(response, options.onUnauthenticated);
    }
    if (schema === undefined) {
      return undefined as TSchema extends z.ZodType ? z.output<TSchema> : void;
    }
    const parsed = schema.safeParse(await response.json().catch(() => undefined));
    if (!parsed.success) {
      throw new ApiError(
        response.status,
        'INVALID_RESPONSE',
        '服务器返回了无法识别的数据',
      );
    }
    return parsed.data as TSchema extends z.ZodType ? z.output<TSchema> : void;
  }

  return {
    auth: {
      register: (input: RegisterRequest): Promise<AuthResponse> =>
        call('POST', '/api/v1/auth/register', {
          body: input,
          schema: authResponseSchema,
        }),
      login: (input: LoginRequest): Promise<AuthResponse> =>
        call('POST', '/api/v1/auth/login', { body: input, schema: authResponseSchema }),
      logout: (): Promise<void> =>
        call('POST', '/api/v1/auth/logout', { schema: undefined }),
      changePassword: (input: ChangePasswordRequest): Promise<void> =>
        call('POST', '/api/v1/auth/change-password', { body: input, schema: undefined }),
    },
    me: {
      get: (): Promise<MeResponse> =>
        call('GET', '/api/v1/me', { schema: meResponseSchema }),
      updateSettings: (input: UpdateSettingsRequest): Promise<UserSettings> =>
        call('PATCH', '/api/v1/me/settings', { body: input, schema: userSettingsSchema }),
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

async function toApiError(
  response: Response,
  onUnauthenticated: (() => void) | undefined,
): Promise<ApiError> {
  const parsed = errorResponseSchema.safeParse(
    await response.json().catch(() => undefined),
  );
  if (!parsed.success) {
    return new ApiError(
      response.status,
      'INVALID_RESPONSE',
      `请求失败（${response.status}）`,
    );
  }
  const { code, message, details } = parsed.data.error;
  if (code === 'UNAUTHENTICATED') {
    onUnauthenticated?.();
  }
  return new ApiError(response.status, code, message, details);
}

export function isApiError(error: unknown, code?: ClientErrorCode): error is ApiError {
  return error instanceof ApiError && (code === undefined || error.code === code);
}

/** 给用户看的错误文案；服务端的 message 已经是可直接展示的中文。 */
export function describeError(error: unknown): string {
  return isApiError(error) ? error.message : '出了点问题，请稍后再试';
}

/** TanStack Query 的查询键，Web 和手机共用，保证缓存失效一致。 */
export const queryKeys = {
  me: ['me'] as const,
};
