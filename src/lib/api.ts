import { config } from '../config/config';

const API_BASE_URL = config.apiUrl;

// ============================================================================
// Error Types
// ============================================================================

export class ApiError extends Error {
  public code: string;
  public messageKey?: string;
  public messageParams?: Record<string, unknown>;
  public isAuthError: boolean;
  public httpStatus?: number;

  constructor(opts: {
    code: string;
    message: string;
    messageKey?: string;
    messageParams?: Record<string, unknown>;
    isAuthError: boolean;
    httpStatus?: number;
  }) {
    super(opts.message);
    this.name = 'ApiError';
    this.code = opts.code;
    this.messageKey = opts.messageKey;
    this.messageParams = opts.messageParams;
    this.isAuthError = opts.isAuthError;
    this.httpStatus = opts.httpStatus;
  }
}

// ============================================================================
// V2 Envelope Format
// ============================================================================

// Success: {ok: true, data: T, meta?: {...}}
interface V2Success<T> {
  ok: true;
  data: T;
  meta?: {
    trace_id?: string;
    server_time?: string;
  };
}

// Error: {ok: false, error: {code, message, ...}}
interface V2Error {
  ok: false;
  error: {
    code: string;
    message: string;
    message_key?: string;
    params?: Record<string, unknown>;
    trace_id?: string;
    http_status?: number;
  };
}

function isV2Success<T>(data: unknown): data is V2Success<T> {
  return (
    typeof data === 'object' &&
    data !== null &&
    'ok' in data &&
    (data as V2Success<T>).ok === true &&
    'data' in data
  );
}

function isV2Error(data: unknown): data is V2Error {
  return (
    typeof data === 'object' &&
    data !== null &&
    'ok' in data &&
    (data as V2Error).ok === false &&
    'error' in data &&
    typeof (data as V2Error).error === 'object'
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

function isAuthError(code: string, message: string): boolean {
  if (AUTH_ERROR_CODES.includes(code)) return true;
  if (AUTH_ERROR_MESSAGES.some(msg => message.includes(msg))) return true;
  return false;
}

// ============================================================================
// Auth Error Handler & Token Refresh
// ============================================================================

type AuthErrorCallback = (details: { code: string; message: string }) => void;
let onAuthError: AuthErrorCallback | null = null;

export function setAuthErrorHandler(callback: AuthErrorCallback | null) {
  onAuthError = callback;
}

function triggerAuthError(code: string, message: string) {
  console.error('[API] Auth error:', code, message);
  if (onAuthError) {
    onAuthError({ code, message });
  }
}

// Token refresher — set by AuthContext to avoid circular imports
type TokenRefresher = () => Promise<boolean>;
let tokenRefresher: TokenRefresher | null = null;
let refreshInFlight: Promise<boolean> | null = null;

export function setTokenRefresher(fn: TokenRefresher | null) {
  tokenRefresher = fn;
}

/** Attempt a token refresh, deduplicating concurrent calls. */
async function tryRefreshToken(): Promise<boolean> {
  if (!tokenRefresher) return false;
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = tokenRefresher().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

// ============================================================================
// Response Handling
// ============================================================================

function makeV2ApiError(err: V2Error['error'], httpStatus?: number): ApiError {
  const status = httpStatus ?? err.http_status;
  const auth = isAuthError(err.code, err.message) || status === 401;

  return new ApiError({
    code: err.code,
    message: err.message,
    messageKey: err.message_key,
    messageParams: err.params,
    isAuthError: auth,
    httpStatus: status,
  });
}

function parseResponseData<T>(data: unknown, endpoint: string): T {
  if (isV2Error(data)) {
    throw makeV2ApiError(data.error);
  }

  if (isV2Success<T>(data)) {
    return data.data;
  }

  // View/table queries return plain arrays — that's fine
  if (Array.isArray(data)) {
    return data as T;
  }

  // Anything else is non-v2 — log it
  console.error(`[API] Non-v2 envelope from ${endpoint}. Expected {ok, data} or {ok, error}. Got:`, data);
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

  private makeNonV2Error(data: unknown, endpoint: string, status: number): ApiError {
    console.error(`[API] Non-v2 error from ${endpoint} (HTTP ${status}). Expected {ok, error}. Got:`, data);

    // PostgREST returns 401 + code "42501" for permission denied — treat as 403, not auth error
    const pgCode = typeof data === 'object' && data !== null && 'code' in data ? (data as { code: string }).code : '';
    const isPermissionDenied = pgCode === '42501';

    const auth = status === 401 && !isPermissionDenied;

    const errorCode = isPermissionDenied ? 'PERMISSION_DENIED' : `HTTP_${status}`;
    const errorMessage = isPermissionDenied
      ? `Permission denied: ${endpoint}`
      : `Request failed: ${endpoint} (HTTP ${status})`;

    return new ApiError({
      code: errorCode,
      message: errorMessage,
      isAuthError: auth,
      httpStatus: isPermissionDenied ? 403 : status,
    });
  }

  /**
   * Core fetch method. All requests go through here.
   * Returns { response, data } so callers can read headers if needed.
   * Handles auth retry: on auth error, refreshes token and retries once.
   */
  private async _fetch(
    endpoint: string,
    options: RequestInit = {},
    includeAuth: boolean = true,
  ): Promise<{ response: Response; data: unknown }> {
    const doFetch = async () => {
      const url = `${API_BASE_URL}${endpoint}`;
      const headers = { ...this.getHeaders(includeAuth), ...options.headers as Record<string, string> };
      const response = await fetch(url, { ...options, headers });
      const text = await response.text();
      const data = text ? JSON.parse(text) : null;
      return { response, data };
    };

    const buildError = (response: Response, data: unknown): ApiError => {
      if (isV2Error(data)) return makeV2ApiError(data.error, response.status);
      return this.makeNonV2Error(data, endpoint, response.status);
    };

    let result = await doFetch();

    if (!result.response.ok) {
      const error = buildError(result.response, result.data);

      // If it's an auth error and we have a refresher, try to refresh and retry once
      if (error.isAuthError && includeAuth) {
        const refreshed = await tryRefreshToken();
        if (refreshed) {
          // Retry with the new token
          result = await doFetch();
          if (!result.response.ok) {
            const retryError = buildError(result.response, result.data);
            if (retryError.isAuthError) triggerAuthError(retryError.code, retryError.message);
            throw retryError;
          }
          return result;
        }

        // Refresh failed — session is truly dead
        triggerAuthError(error.code, error.message);
      }

      if (!error.isAuthError) throw error;
      // Auth error with no successful refresh — already triggered above
      throw error;
    }

    return result;
  }

  async request<T>(
    endpoint: string,
    options: RequestInit = {},
    includeAuth: boolean = true
  ): Promise<T> {
    const { data } = await this._fetch(endpoint, options, includeAuth);
    return parseResponseData<T>(data, endpoint);
  }

  async get<T>(endpoint: string, includeAuth: boolean = true): Promise<T> {
    return this.request<T>(endpoint, { method: 'GET' }, includeAuth);
  }

  async getPaginated<T>(
    endpoint: string,
    { page = 1, pageSize = 15, includeAuth = true }: { page?: number; pageSize?: number; includeAuth?: boolean } = {}
  ): Promise<{ data: T[]; totalCount: number }> {
    const offset = (page - 1) * pageSize;
    const rangeEnd = offset + pageSize - 1;

    const { response, data } = await this._fetch(
      endpoint,
      {
        method: 'GET',
        headers: {
          'Range-Unit': 'items',
          'Range': `${offset}-${rangeEnd}`,
          'Prefer': 'count=exact',
        },
      },
      includeAuth,
    );

    // Parse Content-Range: 0-14/100
    const contentRange = response.headers.get('Content-Range') ?? '';
    const match = contentRange.match(/\/(\d+)/);
    const totalCount = match ? parseInt(match[1], 10) : (Array.isArray(data) ? data.length : 0);

    return { data: parseResponseData<T[]>(data, endpoint), totalCount };
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

  async rpc<T>(functionName: string, params?: unknown, includeAuth: boolean = true): Promise<T> {
    return this.post<T>(`/rpc/${functionName}`, params, includeAuth);
  }
}

export const apiClient = new ApiClient();
