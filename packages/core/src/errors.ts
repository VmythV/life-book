import { z } from 'zod';

export const errorCodes = [
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'INVALID_CREDENTIALS',
  'WRONG_PASSWORD',
  'USERNAME_TAKEN',
  'TOO_MANY_REQUESTS',
  'NOT_FOUND',
  'VERSION_CONFLICT',
  'ID_CONFLICT',
  'NAME_TAKEN',
  'INTERNAL_ERROR',
] as const;

export const errorCodeSchema = z.enum(errorCodes);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const errorResponseSchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ErrorResponse = z.infer<typeof errorResponseSchema>;
