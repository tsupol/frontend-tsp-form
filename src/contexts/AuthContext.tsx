import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import type { ReactNode } from 'react';
import { authService } from '../lib/auth';
import { setAuthErrorHandler } from '../lib/api';
import type { UserInfo } from '../lib/auth';

interface LoginResult {
  needsHoldingSelect: boolean;
}

interface AuthContextType {
  user: UserInfo | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  needsHoldingSelect: boolean;
  login: (username: string, password: string) => Promise<LoginResult>;
  logout: () => Promise<void>;
  switchHolding: (holdingId: number) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [needsHoldingSelect, setNeedsHoldingSelect] = useState(false);
  const hasHandledAuthError = useRef(false);
  const isLoginInProgress = useRef(false);
  const suppressAuthRedirect = useRef(false);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Schedule a background token refresh before expiry
  const scheduleRefresh = useCallback(() => {
    // Clear any existing timer
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }

    const delay = authService.getBackgroundRefreshDelay();
    if (delay === null) return;

    console.log(`[Auth] Background refresh scheduled in ${Math.round(delay / 1000)}s`);
    refreshTimerRef.current = setTimeout(async () => {
      try {
        await authService.refresh();
        console.log('[Auth] Background token refresh succeeded');
        scheduleRefresh(); // Schedule next refresh with new expiry
      } catch {
        console.error('[Auth] Background token refresh failed');
        // Don't clear tokens here — let the next API call trigger the auth error flow
      }
    }, delay);
  }, []);

  // Handle auth errors from API - clear session and redirect to login
  const handleAuthError = useCallback((details: { code: string; message: string }) => {
    // Don't redirect during login or init — let the caller's catch block handle it
    if (isLoginInProgress.current || suppressAuthRedirect.current) return;

    // Prevent multiple redirects
    if (hasHandledAuthError.current) return;
    hasHandledAuthError.current = true;

    console.error('[Auth] Session error:', details.code, details.message);
    authService.clearTokens();
    setUser(null);

    // Redirect to login with reason and error details
    const params = new URLSearchParams({
      reason: 'session_expired',
      error_code: details.code,
      error_msg: details.message,
    });
    window.location.href = `/login?${params.toString()}`;
  }, []);

  // Register auth error handler
  useEffect(() => {
    setAuthErrorHandler(handleAuthError);
    return () => setAuthErrorHandler(null);
  }, [handleAuthError]);

  // Cleanup refresh timer on unmount
  useEffect(() => {
    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const initAuth = async () => {
      // Skip /me call if login is in progress (tokens are being set up)
      if (isLoginInProgress.current) {
        setIsLoading(false);
        return;
      }

      const isValid = await authService.validateAndRefresh();
      if (isValid) {
        try {
          suppressAuthRedirect.current = true;
          const res = await authService.meProfile();
          const userInfo = authService.profileToUserInfo(res);
          setUser(userInfo);
          setNeedsHoldingSelect(userInfo.holding_id === null);
          scheduleRefresh();
        } catch (err) {
          console.error('[Auth] Failed to fetch user info after token validation:', err);
          authService.clearTokens();
          setUser(null);
        } finally {
          suppressAuthRedirect.current = false;
        }
      } else {
        console.log('[Auth] Token validation failed, clearing session');
        authService.clearTokens();
        setUser(null);
      }
      setIsLoading(false);
    };
    initAuth();
  }, []);

  const login = useCallback(async (username: string, password: string): Promise<LoginResult> => {
    isLoginInProgress.current = true;
    try {
      const response = await authService.login(username, password);
      const holdingNeeded = response.holding_id === null;

      // me_profile_get works for all roles (including SYSTEM_DEV without holding)
      const res = await authService.meProfile();
      setUser(authService.profileToUserInfo(res));
      setNeedsHoldingSelect(holdingNeeded);

      scheduleRefresh();
      return { needsHoldingSelect: holdingNeeded };
    } finally {
      isLoginInProgress.current = false;
    }
  }, []);

  const logout = useCallback(async () => {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
    await authService.logout();
    setUser(null);
    setNeedsHoldingSelect(false);
  }, []);

  const switchHolding = useCallback(async (holdingId: number) => {
    await authService.switchHolding(holdingId);
    const res = await authService.meProfile();
    setUser(authService.profileToUserInfo(res));
    setNeedsHoldingSelect(false);
    scheduleRefresh();
  }, [scheduleRefresh]);

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        needsHoldingSelect,
        login,
        logout,
        switchHolding,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
