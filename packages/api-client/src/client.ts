import {
  type AddToShoppingListRequest,
  type BatchRequest,
  type BatchResponse,
  batchResponseSchema,
  type CalendarResponse,
  calendarResponseSchema,
  type AddToShoppingListResponse,
  addToShoppingListResponseSchema,
  type AuthResponse,
  authResponseSchema,
  type ChangePasswordRequest,
  type ChecklistItem,
  type ChecklistTemplate,
  checklistItemSchema,
  CLIENT_MODE_HEADER,
  type CompleteAllRequest,
  type CreateChecklistItemRequest,
  type CreateRecordRequest,
  type CreateStockTransactionRequest,
  type CreateTemplateRequest,
  type DeleteAccountRequest,
  type CreateTaxonomyRequest,
  type ErrorCode,
  errorResponseSchema,
  type LifeRecord,
  type LocalDate,
  type LoginRequest,
  type InstantiateTemplateRequest,
  type MeResponse,
  meResponseSchema,
  type Occurrence,
  type OccurrenceListResponse,
  occurrenceListResponseSchema,
  occurrenceSchema,
  type RecordListQuery,
  type RecordListResponse,
  recordListResponseSchema,
  recordSchema,
  type ReorderRequest,
  type RescheduleRequest,
  type SaveAsTemplateRequest,
  type SetOccurrenceRequest,
  type StockTransactionListResponse,
  stockTransactionListResponseSchema,
  type StockTransactionResult,
  stockTransactionResultSchema,
  type Taxonomy,
  type TaxonomyListResponse,
  taxonomyListResponseSchema,
  taxonomySchema,
  type TemplateListResponse,
  templateListResponseSchema,
  templateSchema,
  type TodayResponse,
  todayResponseSchema,
  TOKEN_CLIENT_MODE,
  type UpcomingRemindersResponse,
  upcomingRemindersResponseSchema,
  type UpdateChecklistItemRequest,
  type UpdateRecordRequest,
  type UpdateSettingsRequest,
  type UpdateTaxonomyRequest,
  type UpdateTemplateRequest,
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
  /**
   * 服务端地址；Web 同源访问时为空字符串。
   * 传函数时每次请求都重新读取，手机上修改服务器地址后不用重建客户端。
   */
  baseUrl: string | (() => string);
  auth: ApiAuth;
  fetch?: typeof fetch;
  /** 会话失效（401 UNAUTHENTICATED）时调用，用于跳转到登录页。 */
  onUnauthenticated?: () => void;
}

interface CallOptions<TSchema extends z.ZodType | undefined> {
  body?: unknown;
  schema: TSchema;
}

/** 把查询参数拼成 `?a=1&b=2`，忽略未设置的值。 */
function queryString(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      search.set(key, String(value));
    }
  }
  const text = search.toString();
  return text === '' ? '' : `?${text}`;
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
      const baseUrl =
        typeof options.baseUrl === 'function' ? options.baseUrl() : options.baseUrl;
      response = await fetchImpl(`${baseUrl}${path}`, {
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
      /** 删除账号及全部数据，需要再输入一次密码。 */
      deleteAccount: (input: DeleteAccountRequest): Promise<void> =>
        call('DELETE', '/api/v1/me', { body: input, schema: undefined }),
    },
    records: {
      list: (query: RecordListQuery = {}): Promise<RecordListResponse> =>
        call('GET', `/api/v1/records${queryString({ ...query })}`, {
          schema: recordListResponseSchema,
        }),
      get: (id: string): Promise<LifeRecord> =>
        call('GET', `/api/v1/records/${id}`, { schema: recordSchema }),
      create: (input: CreateRecordRequest): Promise<LifeRecord> =>
        call('POST', '/api/v1/records', { body: input, schema: recordSchema }),
      update: (id: string, input: UpdateRecordRequest): Promise<LifeRecord> =>
        call('PATCH', `/api/v1/records/${id}`, { body: input, schema: recordSchema }),
      archive: (id: string): Promise<LifeRecord> =>
        call('POST', `/api/v1/records/${id}/archive`, { schema: recordSchema }),
      unarchive: (id: string): Promise<LifeRecord> =>
        call('POST', `/api/v1/records/${id}/unarchive`, { schema: recordSchema }),
      remove: (id: string): Promise<LifeRecord> =>
        call('DELETE', `/api/v1/records/${id}`, { schema: recordSchema }),
      restore: (id: string): Promise<LifeRecord> =>
        call('POST', `/api/v1/records/${id}/restore`, { schema: recordSchema }),
      batch: (input: BatchRequest): Promise<BatchResponse> =>
        call('POST', '/api/v1/records/batch', {
          body: input,
          schema: batchResponseSchema,
        }),
      removePermanently: (id: string): Promise<void> =>
        call('DELETE', `/api/v1/records/${id}/permanent`, { schema: undefined }),
    },
    checklistItems: {
      create: (
        recordId: string,
        input: CreateChecklistItemRequest,
      ): Promise<ChecklistItem> =>
        call('POST', `/api/v1/records/${recordId}/items`, {
          body: input,
          schema: checklistItemSchema,
        }),
      update: (
        recordId: string,
        itemId: string,
        input: UpdateChecklistItemRequest,
      ): Promise<ChecklistItem> =>
        call('PATCH', `/api/v1/records/${recordId}/items/${itemId}`, {
          body: input,
          schema: checklistItemSchema,
        }),
      remove: (recordId: string, itemId: string): Promise<void> =>
        call('DELETE', `/api/v1/records/${recordId}/items/${itemId}`, {
          schema: undefined,
        }),
      completeAll: (recordId: string, input: CompleteAllRequest): Promise<LifeRecord> =>
        call('POST', `/api/v1/records/${recordId}/items/complete-all`, {
          body: input,
          schema: recordSchema,
        }),
      saveAsTemplate: (
        recordId: string,
        input: SaveAsTemplateRequest = {},
      ): Promise<ChecklistTemplate> =>
        call('POST', `/api/v1/records/${recordId}/save-as-template`, {
          body: input,
          schema: templateSchema,
        }),
    },
    household: {
      transactions: (recordId: string): Promise<StockTransactionListResponse> =>
        call('GET', `/api/v1/records/${recordId}/stock-transactions`, {
          schema: stockTransactionListResponseSchema,
        }),
      addTransaction: (
        recordId: string,
        input: CreateStockTransactionRequest,
      ): Promise<StockTransactionResult> =>
        call('POST', `/api/v1/records/${recordId}/stock-transactions`, {
          body: input,
          schema: stockTransactionResultSchema,
        }),
      addToShoppingList: (
        recordId: string,
        input: AddToShoppingListRequest = {},
      ): Promise<AddToShoppingListResponse> =>
        call('POST', `/api/v1/records/${recordId}/add-to-shopping-list`, {
          body: input,
          schema: addToShoppingListResponseSchema,
        }),
      /** 手机排好低库存通知后告诉服务端，这次低库存不再重复提醒。 */
      lowStockNotified: (recordId: string, since: string): Promise<void> =>
        call('POST', `/api/v1/records/${recordId}/low-stock-notified`, {
          body: { since },
          schema: undefined,
        }),
    },
    templates: {
      list: (): Promise<TemplateListResponse> =>
        call('GET', '/api/v1/templates', { schema: templateListResponseSchema }),
      get: (id: string): Promise<ChecklistTemplate> =>
        call('GET', `/api/v1/templates/${id}`, { schema: templateSchema }),
      create: (input: CreateTemplateRequest): Promise<ChecklistTemplate> =>
        call('POST', '/api/v1/templates', { body: input, schema: templateSchema }),
      update: (id: string, input: UpdateTemplateRequest): Promise<ChecklistTemplate> =>
        call('PATCH', `/api/v1/templates/${id}`, { body: input, schema: templateSchema }),
      remove: (id: string): Promise<void> =>
        call('DELETE', `/api/v1/templates/${id}`, { schema: undefined }),
      instantiate: (
        id: string,
        input: InstantiateTemplateRequest = {},
      ): Promise<LifeRecord> =>
        call('POST', `/api/v1/templates/${id}/instantiate`, {
          body: input,
          schema: recordSchema,
        }),
    },
    occurrences: {
      list: (
        id: string,
        from: LocalDate,
        to: LocalDate,
      ): Promise<OccurrenceListResponse> =>
        call('GET', `/api/v1/records/${id}/occurrences${queryString({ from, to })}`, {
          schema: occurrenceListResponseSchema,
        }),
      set: (
        id: string,
        date: LocalDate,
        input: SetOccurrenceRequest,
      ): Promise<Occurrence> =>
        call('PUT', `/api/v1/records/${id}/occurrences/${date}`, {
          body: input,
          schema: occurrenceSchema,
        }),
      undo: (id: string, date: LocalDate): Promise<void> =>
        call('DELETE', `/api/v1/records/${id}/occurrences/${date}`, {
          schema: undefined,
        }),
      /** “仅本次改期”：`date` 是原定日期。 */
      reschedule: (
        id: string,
        date: LocalDate,
        input: RescheduleRequest,
      ): Promise<Occurrence> =>
        call('PUT', `/api/v1/records/${id}/occurrences/${date}/reschedule`, {
          body: input,
          schema: occurrenceSchema,
        }),
      cancelReschedule: (id: string, date: LocalDate): Promise<void> =>
        call('DELETE', `/api/v1/records/${id}/occurrences/${date}/reschedule`, {
          schema: undefined,
        }),
    },
    categories: {
      list: (): Promise<TaxonomyListResponse> =>
        call('GET', '/api/v1/categories', { schema: taxonomyListResponseSchema }),
      create: (input: CreateTaxonomyRequest): Promise<Taxonomy> =>
        call('POST', '/api/v1/categories', { body: input, schema: taxonomySchema }),
      update: (id: string, input: UpdateTaxonomyRequest): Promise<Taxonomy> =>
        call('PATCH', `/api/v1/categories/${id}`, {
          body: input,
          schema: taxonomySchema,
        }),
      remove: (id: string): Promise<void> =>
        call('DELETE', `/api/v1/categories/${id}`, { schema: undefined }),
      reorder: (input: ReorderRequest): Promise<TaxonomyListResponse> =>
        call('POST', '/api/v1/categories/reorder', {
          body: input,
          schema: taxonomyListResponseSchema,
        }),
    },
    tags: {
      list: (): Promise<TaxonomyListResponse> =>
        call('GET', '/api/v1/tags', { schema: taxonomyListResponseSchema }),
      create: (input: CreateTaxonomyRequest): Promise<Taxonomy> =>
        call('POST', '/api/v1/tags', { body: input, schema: taxonomySchema }),
      update: (id: string, input: UpdateTaxonomyRequest): Promise<Taxonomy> =>
        call('PATCH', `/api/v1/tags/${id}`, { body: input, schema: taxonomySchema }),
      remove: (id: string): Promise<void> =>
        call('DELETE', `/api/v1/tags/${id}`, { schema: undefined }),
    },
    today: {
      get: (date?: LocalDate): Promise<TodayResponse> =>
        call('GET', `/api/v1/today${queryString({ date })}`, {
          schema: todayResponseSchema,
        }),
    },
    calendar: {
      get: (from: LocalDate, to: LocalDate): Promise<CalendarResponse> =>
        call('GET', `/api/v1/calendar${queryString({ from, to })}`, {
          schema: calendarResponseSchema,
        }),
    },
    reminders: {
      upcoming: (days?: number): Promise<UpcomingRemindersResponse> =>
        call('GET', `/api/v1/reminders/upcoming${queryString({ days })}`, {
          schema: upcomingRemindersResponseSchema,
        }),
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

/**
 * 整理用户输入的服务端地址：补上 `http://`，去掉路径和末尾的斜杠。
 * 不是 http 或 https 地址时返回 `null`。
 */
export function normalizeServerUrl(input: string): string | null {
  const text = input.trim();
  if (text === '') {
    return null;
  }
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`);
  } catch {
    return null;
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.hostname === '') {
    return null;
  }
  return url.origin;
}

/** 导出全部数据的地址；Web 直接用它下载文件。 */
export const EXPORT_PATH = '/api/v1/me/export';

/** TanStack Query 的查询键，Web 和手机共用，保证缓存失效一致。 */
export const queryKeys = {
  me: ['me'] as const,
  /** 所有“今天”查询的前缀；完成、跳过或修改记录后整体失效。 */
  today: ['today'] as const,
  todayOn: (date: LocalDate | undefined) => ['today', date ?? 'current'] as const,
  /** 日历也挂在“今天”下面，和它一起失效。 */
  calendar: (from: LocalDate, to: LocalDate) => ['today', 'calendar', from, to] as const,
  /** 所有记录查询（列表、详情、实例）的前缀。 */
  records: ['records'] as const,
  recordList: (query: RecordListQuery) => ['records', 'list', query] as const,
  record: (id: string) => ['records', 'detail', id] as const,
  stockTransactions: (id: string) => ['records', 'detail', id, 'stock'] as const,
  occurrences: (id: string, from: LocalDate, to: LocalDate) =>
    ['records', 'detail', id, 'occurrences', from, to] as const,
  templates: ['templates'] as const,
  categories: ['categories'] as const,
  tags: ['tags'] as const,
  upcomingReminders: ['reminders', 'upcoming'] as const,
};
