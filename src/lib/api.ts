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

  constructor(error: PostgRESTError) {
    super(error.message);
    this.name = 'ApiError';
    this.code = error.code;
    this.details = error.details;
    this.hint = error.hint;
  }
}

function isPostgRESTError(data: unknown): data is PostgRESTError {
  return (
    typeof data === 'object' &&
    data !== null &&
    'code' in data &&
    'message' in data
  );
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
      if (isPostgRESTError(data)) {
        throw new ApiError(data);
      }
      throw new ApiError({
        code: 'UNKNOWN_ERROR',
        message: `Request failed with status ${response.status}`,
        details: null,
        hint: null,
      });
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
