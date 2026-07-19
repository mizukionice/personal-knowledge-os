import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

export type ErrorCode =
  'unauthorized' | 'forbidden' | 'not_found' | 'validation_error' | 'rate_limited' | 'internal';

const STATUS_BY_CODE: Record<ErrorCode, ContentfulStatusCode> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  validation_error: 422,
  rate_limited: 429,
  internal: 500,
};

export class ApiError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
  }

  get status(): ContentfulStatusCode {
    return STATUS_BY_CODE[this.code];
  }
}

export function errorBody(code: ErrorCode, message: string) {
  return { error: { code, message } };
}

export function handleError(err: Error, c: Context): Response {
  if (err instanceof ApiError) {
    return c.json(errorBody(err.code, err.message), err.status);
  }
  console.error('unhandled error:', err);
  return c.json(errorBody('internal', 'internal server error'), 500);
}
