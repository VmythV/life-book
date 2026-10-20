import { z } from 'zod';

// 共享 schema 没有自定义文案的地方，用 zod 自带的简体中文提示。
z.config(z.locales.zhCN());

export type FieldErrors = Partial<Record<string, string>>;

/** 用共享 schema 在提交前校验表单，返回每个字段的第一条错误，供界面直接展示。 */
export function validateFields<TSchema extends z.ZodType>(
  schema: TSchema,
  values: unknown,
): { data: z.output<TSchema>; errors: null } | { data: null; errors: FieldErrors } {
  const result = schema.safeParse(values);
  if (result.success) {
    return { data: result.data, errors: null };
  }
  const errors: FieldErrors = {};
  for (const issue of result.error.issues) {
    const field = String(issue.path[0] ?? '');
    errors[field] ??= issue.message;
  }
  return { data: null, errors };
}
