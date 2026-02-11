import { config } from '../config/config';

const API_BASE_URL = config.apiUrl;

export interface PostgRESTError {
  code: string;
  message: string;
  details: string | null;
  hint: string | null;
}

export class ApiError extends Error {
  public code: string;
  public details: string | null;
  public hint: string | null;
  public isAuthError: boolean;

  constructor(error: PostgRESTError) {
    super(error.message);
    this.name = 'ApiError';
    this.code = error.code;
    this.details = error.details;
    this.hint = error.hint;
    this.isAuthError = isAuthError(error);
  }
}

// Auth error codes from PostgREST and backend
const AUTH_ERROR_CODES = [
  'PGRST301', // JWT expired
  'PGRST302', // JWT invalid
  'PGRST303', // JWT expired
  'P0001',    // Raised exception (check message for auth errors)
];

const AUTH_ERROR_MESSAGES = [
  'AUTH_SESSION_REVOKED',
  'AUTH_SESSION_EXPIRED',
  'JWT expired',
];

function isAuthError(error: PostgRESTError): boolean {
  if (AUTH_ERROR_CODES.includes(error.code)) {
    // For P0001, check if it's actually an auth error in the message
    if (error.code === 'P0001') {
      return AUTH_ERROR_MESSAGES.some(msg => error.message.includes(msg));
    }
    return true;
  }
  return false;
}

function isPostgRESTError(data: unknown): data is PostgRESTError {
  return (
    typeof data === 'object' &&
    data !== null &&
    'code' in data &&
    'message' in data
  );
}

// Event for auth errors - components can subscribe to this
type AuthErrorCallback = () => void;
let onAuthError: AuthErrorCallback | null = null;

export function setAuthErrorHandler(callback: AuthErrorCallback | null) {
  onAuthError = callback;
}

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

    if (!response.ok) {
      let error: ApiError;
      if (isPostgRESTError(data)) {
        error = new ApiError(data);
      } else {
        error = new ApiError({
          code: response.status === 401 ? 'UNAUTHORIZED' : 'UNKNOWN_ERROR',
          message: `Request failed with status ${response.status}`,
          details: null,
          hint: null,
        });
        error.isAuthError = response.status === 401;
      }

      // Trigger auth error handler if it's an auth error
      if (error.isAuthError && onAuthError) {
        onAuthError();
      }

      throw error;
    }

    return data as T;
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
