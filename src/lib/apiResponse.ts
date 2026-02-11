import i18n from '../i18n/config';

/**
 * RFC 9457 Problem Details Error
 * @see https://www.rfc-editor.org/rfc/rfc9457.html
 */
export interface ProblemDetails {
  type: string;
  status: number;
  title: string;
  detail: string;
  code?: string;
  message_key?: string;
  message_params?: Record<string, unknown>;
  errors?: FieldError[];
  trace_id?: string;
}

export interface FieldError {
  pointer: string;
  detail: string;
  message_key?: string;
  message_params?: Record<string, unknown>;
}

/**
 * Old v2 envelope format (for backward compatibility)
 */
interface V2SuccessResponse<T> {
  ok: true;
  data: T;
  meta?: {
    trace_id?: string;
    server_time?: string;
  };
}

interface V2ErrorResponse {
  ok?: false;
  code: string;
  message: string;
  message_key?: string;
  params?: Record<string, unknown>;
  trace_id?: string;
  retryable?: boolean;
  http_status?: number;
  field_errors?: Record<string, string[]> | null;
}

/**
 * PostgREST native error format
 */
interface PostgRESTNativeError {
  code: string;
  message: string;
  details: string | null;
  hint: string | null;
}

/**
 * API Error class following RFC 9457 structure
 */
export class ApiError extends Error {
  public type: string;
  public status: number;
  public title: string;
  public detail: string;
  public code?: string;
  public messageKey?: string;
  public messageParams?: Record<string, unknown>;
  public errors?: FieldError[];
  public traceId?: string;

  constructor(problem: ProblemDetails) {
    super(problem.detail);
    this.name = 'ApiError';
    this.type = problem.type;
    this.status = problem.status;
    this.title = problem.title;
    this.detail = problem.detail;
    this.code = problem.code;
    this.messageKey = problem.message_key;
    this.messageParams = problem.message_params;
    this.errors = problem.errors;
    this.traceId = problem.trace_id;
  }

  /**
   * Get localized error message using i18n
   * Falls back to detail if no translation found
   */
  getLocalizedMessage(): string {
    if (this.messageKey) {
      const translated = i18n.t(this.messageKey, this.messageParams as Record<string, string>);
      if (translated !== this.messageKey) {
        return translated;
      }
    }
    return this.detail;
  }

  /**
   * Get localized field errors for form validation
   */
  getFieldErrors(): Record<string, string> {
    const result: Record<string, string> = {};
    if (this.errors) {
      for (const error of this.errors) {
        const field = error.pointer.replace(/^\//, '');
        if (error.message_key) {
          const translated = i18n.t(error.message_key, error.message_params as Record<string, string>);
          result[field] = translated !== error.message_key ? translated : error.detail;
        } else {
          result[field] = error.detail;
        }
      }
    }
    return result;
  }
}

// Type guards
function isV2SuccessResponse<T>(data: unknown): data is V2SuccessResponse<T> {
  return (
    typeof data === 'object' &&
    data !== null &&
    'ok' in data &&
    (data as V2SuccessResponse<T>).ok === true &&
    'data' in data
  );
}

function isV2ErrorResponse(data: unknown): data is V2ErrorResponse {
  return (
    typeof data === 'object' &&
    data !== null &&
    'code' in data &&
    typeof (data as V2ErrorResponse).code === 'string' &&
    (data as V2ErrorResponse).code.includes('.')
  );
}

function isPostgRESTError(data: unknown): data is PostgRESTNativeError {
  return (
    typeof data === 'object' &&
    data !== null &&
    'code' in data &&
    'message' in data &&
    !((data as PostgRESTNativeError).code.includes('.'))
  );
}

// Converters
function v2ErrorToProblem(error: V2ErrorResponse, httpStatus: number): ProblemDetails {
  const errors: FieldError[] | undefined = error.field_errors
    ? Object.entries(error.field_errors).flatMap(([field, messages]) =>
        messages.map((msg) => ({ pointer: `/${field}`, detail: msg }))
      )
    : undefined;

  return {
    type: 'about:blank',
    status: error.http_status || httpStatus,
    title: error.code.split('.').pop()?.replace(/_/g, ' ') || 'Error',
    detail: error.message,
    code: error.code,
    message_key: error.message_key,
    message_params: error.params,
    errors,
    trace_id: error.trace_id,
  };
}

function postgrestErrorToProblem(error: PostgRESTNativeError, httpStatus: number): ProblemDetails {
  const titles: Record<string, string> = {
    '23505': 'Duplicate Entry',
    '23503': 'Foreign Key Violation',
    '23502': 'Not Null Violation',
    '42501': 'Permission Denied',
    '42P01': 'Table Not Found',
    'PGRST301': 'JWT Expired',
    'PGRST302': 'JWT Invalid',
    'PGRST303': 'JWT Expired',
  };

  return {
    type: 'about:blank',
    status: httpStatus,
    title: titles[error.code] || 'Database Error',
    detail: error.hint || error.details || error.message,
    code: error.code,
  };
}

export interface ResponseMeta {
  traceId?: string;
  date?: string;
}

/**
 * Parse API response - normalizes all formats
 */
export async function parseResponse<T>(response: Response): Promise<{ data: T; meta: ResponseMeta }> {
  const meta: ResponseMeta = {
    traceId: response.headers.get('X-Trace-Id') || undefined,
    date: response.headers.get('Date') || undefined,
  };

  const text = await response.text();
  const body = text ? JSON.parse(text) : null;

  // Handle HTTP errors
  if (!response.ok) {
    if (isV2ErrorResponse(body)) {
      throw new ApiError(v2ErrorToProblem(body, response.status));
    }
    if (isPostgRESTError(body)) {
      throw new ApiError(postgrestErrorToProblem(body, response.status));
    }
    throw new ApiError({
      type: 'about:blank',
      status: response.status,
      title: response.statusText || 'Request Failed',
      detail: `Request failed with status ${response.status}`,
    });
  }

  // V2 success envelope - unwrap
  if (isV2SuccessResponse<T>(body)) {
    if (body.meta?.trace_id) meta.traceId = body.meta.trace_id;
    return { data: body.data, meta };
  }

  // V2 error in 200 response
  if (isV2ErrorResponse(body)) {
    throw new ApiError(v2ErrorToProblem(body, body.http_status || 500));
  }

  // PostgREST array - unwrap single item
  if (Array.isArray(body) && body.length === 1) {
    return { data: body[0] as T, meta };
  }

  return { data: body as T, meta };
}

/**
 * Simple helper - returns data only
 */
export async function parseData<T>(response: Response): Promise<T> {
  const { data } = await parseResponse<T>(response);
  return data;
}
