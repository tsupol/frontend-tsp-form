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
// Auth Error Handler
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

// ============================================================================
// Response Handling
// ============================================================================

function handleV2Error(err: V2Error['error'], httpStatus?: number): never {
  const status = httpStatus ?? err.http_status;
  const auth = isAuthError(err.code, err.message) || status === 401;
  if (auth) triggerAuthError(err.code, err.message);

  throw new ApiError({
    code: err.code,
    message: err.message,
    messageKey: err.message_key,
    messageParams: err.params,
    isAuthError: auth,
    httpStatus: status,
  });
}

function parseResponse<T>(data: unknown, endpoint: string): T {
  if (isV2Error(data)) {
    handleV2Error(data.error);
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

  private handleNonV2Error(data: unknown, endpoint: string, status: number): never {
    console.error(`[API] Non-v2 error from ${endpoint} (HTTP ${status}). Expected {ok, error}. Got:`, data);

    // PostgREST returns 401 + code "42501" for permission denied — treat as 403, not auth error
    const pgCode = typeof data === 'object' && data !== null && 'code' in data ? (data as { code: string }).code : '';
    const isPermissionDenied = pgCode === '42501';

    const auth = status === 401 && !isPermissionDenied;
    if (auth) triggerAuthError('HTTP_401', `HTTP ${status} from ${endpoint}`);

    const errorCode = isPermissionDenied ? 'PERMISSION_DENIED' : `HTTP_${status}`;
    const errorMessage = isPermissionDenied
      ? `Permission denied: ${endpoint}`
      : `Request failed: ${endpoint} (HTTP ${status})`;

    throw new ApiError({
      code: errorCode,
      message: errorMessage,
      isAuthError: auth,
      httpStatus: isPermissionDenied ? 403 : status,
    });
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

    if (!response.ok) {
      if (isV2Error(data)) {
        handleV2Error(data.error, response.status);
      }
      this.handleNonV2Error(data, endpoint, response.status);
    }

    return parseResponse<T>(data, endpoint);
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

    const url = `${API_BASE_URL}${endpoint}`;
    const headers = {
      ...this.getHeaders(includeAuth),
      'Range-Unit': 'items',
      'Range': `${offset}-${rangeEnd}`,
      'Prefer': 'count=exact',
    };

    const response = await fetch(url, { method: 'GET', headers });

    const text = await response.text();
    const data = text ? JSON.parse(text) : null;

    if (!response.ok) {
      if (isV2Error(data)) {
        handleV2Error(data.error, response.status);
      }
      this.handleNonV2Error(data, endpoint, response.status);
    }

    // Parse Content-Range: 0-14/100
    const contentRange = response.headers.get('Content-Range') ?? '';
    const match = contentRange.match(/\/(\d+)/);
    const totalCount = match ? parseInt(match[1], 10) : (Array.isArray(data) ? data.length : 0);

    return { data: parseResponse<T[]>(data, endpoint), totalCount };
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
