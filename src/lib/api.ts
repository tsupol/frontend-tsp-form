import { config } from '../config/config';

const API_BASE_URL = config.apiUrl;

// ============================================================================
// Error Types
// ============================================================================

export interface ApiErrorDetails {
  code: string;
  message: string;
  details?: string | null;
  hint?: string | null;
  messageKey?: string;
  messageParams?: Record<string, unknown>;
  isAuthError: boolean;
}

export class ApiError extends Error {
  public code: string;
  public details: string | null;
  public hint: string | null;
  public messageKey?: string;
  public messageParams?: Record<string, unknown>;
  public isAuthError: boolean;

  constructor(error: ApiErrorDetails) {
    super(error.message);
    this.name = 'ApiError';
    this.code = error.code;
    this.details = error.details ?? null;
    this.hint = error.hint ?? null;
    this.messageKey = error.messageKey;
    this.messageParams = error.messageParams;
    this.isAuthError = error.isAuthError;
  }
}

// ============================================================================
// Response Type Detection
// ============================================================================

// PostgREST error: {code, message, details, hint}
interface PostgRESTError {
  code: string;
  message: string;
  details: string | null;
  hint: string | null;
}

// V2 envelope success: {ok: true, data, meta}
interface V2SuccessResponse<T> {
  ok: true;
  data: T;
  meta?: {
    trace_id?: string;
    server_time?: string;
  };
}

// V2 envelope error: {ok: false, code, message, ...}
interface V2ErrorResponse {
  ok: false;
  code: string;
  message: string;
  message_key?: string;
  params?: Record<string, unknown>;
  trace_id?: string;
  http_status?: number;
}

function isPostgRESTError(data: unknown): data is PostgRESTError {
  return (
    typeof data === 'object' &&
    data !== null &&
    'code' in data &&
    'message' in data &&
    !('ok' in data) // not v2 format
  );
}

function isV2Success<T>(data: unknown): data is V2SuccessResponse<T> {
  return (
    typeof data === 'object' &&
    data !== null &&
    'ok' in data &&
    (data as V2SuccessResponse<T>).ok === true &&
    'data' in data
  );
}

function isV2Error(data: unknown): data is V2ErrorResponse {
  return (
    typeof data === 'object' &&
    data !== null &&
    'ok' in data &&
    (data as V2ErrorResponse).ok === false &&
    'code' in data
  );
}

// ============================================================================
// Auth Error Detection
// ============================================================================

const AUTH_ERROR_CODES = [
  'PGRST301', // JWT expired
  'PGRST302', // JWT invalid
  'PGRST303', // JWT expired
  'PGRST116', // JWT required
];

const AUTH_ERROR_MESSAGES = [
  'AUTH_SESSION_REVOKED',
  'AUTH_SESSION_EXPIRED',
  'AUTH_INVALID_REFRESH',
  'JWT expired',
];

function checkAuthError(code: string, message: string): boolean {
  if (AUTH_ERROR_CODES.includes(code)) return true;
  // P0001 is generic - check message content
  if (code === 'P0001') {
    return AUTH_ERROR_MESSAGES.some(msg => message.includes(msg));
  }
  return false;
}

// ============================================================================
// Auth Error Handler
// ============================================================================

type AuthErrorCallback = () => void;
let onAuthError: AuthErrorCallback | null = null;

export function setAuthErrorHandler(callback: AuthErrorCallback | null) {
  onAuthError = callback;
}

function triggerAuthError() {
  if (onAuthError) {
    onAuthError();
  }
}

// ============================================================================
// Response Parser - unwraps all formats to clean data
// ============================================================================

function parseResponseData<T>(data: unknown): T {
  // V2 error in 200 response
  if (isV2Error(data)) {
    const isAuth = checkAuthError(data.code, data.message);
    if (isAuth) triggerAuthError();

    throw new ApiError({
      code: data.code,
      message: data.message,
      messageKey: data.message_key,
      messageParams: data.params,
      isAuthError: isAuth,
    });
  }

  // V2 success - unwrap data
  if (isV2Success<T>(data)) {
    return data.data;
  }

  // Array with single item (v1 RPC response) - unwrap
  if (Array.isArray(data) && data.length === 1) {
    return data[0] as T;
  }

  // Array with multiple items or empty (table query) - return as-is
  if (Array.isArray(data)) {
    return data as T;
  }

  // Plain object - return as-is
  return data as T;
}

// ============================================================================
// API Client
// ============================================================================

export class ApiClient {
  private getHeaders(includeAuth: boolean = true): HeadersInit {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };

    if (includeAuth) {
      const token = localStorage.getItem('access_token');
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
    }

    return headers;
  }

  async request<T>(
    endpoint: string,
    options: RequestInit = {},
    includeAuth: boolean = true
  ): Promise<T> {
    const url = `${API_BASE_URL}${endpoint}`;
    const headers = this.getHeaders(includeAuth);

    const response = await fetch(url, {
      ...options,
      headers: { ...headers, ...options.headers },
    });

    const text = await response.text();
    const data = text ? JSON.parse(text) : null;

    // HTTP error
    if (!response.ok) {
      let error: ApiError;

      if (isPostgRESTError(data)) {
        const isAuth = checkAuthError(data.code, data.message) || response.status === 401;
        if (isAuth) triggerAuthError();

        error = new ApiError({
          code: data.code,
          message: data.message,
          details: data.details,
          hint: data.hint,
          isAuthError: isAuth,
        });
      } else {
        const isAuth = response.status === 401;
        if (isAuth) triggerAuthError();

        error = new ApiError({
          code: 'HTTP_ERROR',
          message: `Request failed with status ${response.status}`,
          isAuthError: isAuth,
        });
      }

      throw error;
    }

    // Success - parse and unwrap
    return parseResponseData<T>(data);
  }

  async get<T>(endpoint: string, includeAuth: boolean = true): Promise<T> {
    return this.request<T>(endpoint, { method: 'GET' }, includeAuth);
  }

  async post<T>(endpoint: string, body?: unknown, includeAuth: boolean = true): Promise<T> {
    return this.request<T>(
      endpoint,
      {
        method: 'POST',
        body: body ? JSON.stringify(body) : undefined,
      },
      includeAuth
    );
  }

  async patch<T>(endpoint: string, body?: unknown, includeAuth: boolean = true): Promise<T> {
    return this.request<T>(
      endpoint,
      {
        method: 'PATCH',
        body: body ? JSON.stringify(body) : undefined,
      },
      includeAuth
    );
  }

  async delete<T>(endpoint: string, includeAuth: boolean = true): Promise<T> {
    return this.request<T>(endpoint, { method: 'DELETE' }, includeAuth);
  }

  // RPC call helper for PostgREST functions
  async rpc<T>(functionName: string, params?: unknown, includeAuth: boolean = true): Promise<T> {
    return this.post<T>(`/rpc/${functionName}`, params, includeAuth);
  }
}

export const apiClient = new ApiClient();
