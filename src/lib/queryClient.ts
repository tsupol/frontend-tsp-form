import { QueryClient } from '@tanstack/react-query';
import { authService } from './auth';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes
      retry: (failureCount, error) => {
        // Don't retry on auth errors
        if (error instanceof Error && error.message === 'invalid_login') {
          return false;
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
