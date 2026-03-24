import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api';
import { authService } from './auth';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes
      retry: (failureCount, error) => {
        if (error instanceof Error && error.message === 'invalid_login') return false;
        if (error instanceof ApiError) {
          if (error.isAuthError) return false;
          // Don't retry 4xx client errors (permission denied, not found, bad request, etc.)
          if (error.httpStatus && error.httpStatus >= 400 && error.httpStatus < 500) return false;
        }
        return failureCount < 3;
      },
    },
    mutations: {
      retry: false,
    },
  },
});

// Setup token refresh interceptor
let isRefreshing = false;
let refreshPromise: Promise<boolean> | null = null;

export async function ensureValidToken(): Promise<boolean> {
  if (!authService.getAccessToken()) {
    return false;
  }

  if (authService.shouldRefreshToken() || authService.isTokenExpired()) {
    if (isRefreshing && refreshPromise) {
      return refreshPromise;
    }

    isRefreshing = true;
    refreshPromise = authService.validateAndRefresh().finally(() => {
      isRefreshing = false;
      refreshPromise = null;
    });

    return refreshPromise;
  }

  return true;
}
