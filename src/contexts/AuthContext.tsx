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
          const userInfo = await authService.me();
          console.log('[Auth] User info:', userInfo.role_code, 'holding:', userInfo.holding_id);
          setUser(userInfo);
          setNeedsHoldingSelect(userInfo.holding_id === null);
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

      // Use holding_id from login response to determine redirect
      // Don't call /me here — system admins without holding context would get 401
      const holdingNeeded = response.holding_id === null;
      setUser({
        user_id: response.user_id,
        sid: '',
        role_code: response.role_code,
        holding_id: response.holding_id,
        company_id: null,
        branch_id: null,
        capabilities: [],
      });
      setNeedsHoldingSelect(holdingNeeded);

      // For users with holding context, fetch full /me in background for capabilities
      if (!holdingNeeded) {
        authService.me().then(setUser).catch(() => {/* keep minimal user info */});
      }

      return { needsHoldingSelect: holdingNeeded };
    } finally {
      isLoginInProgress.current = false;
    }
  }, []);

  const logout = useCallback(async () => {
    await authService.logout();
    setUser(null);
    setNeedsHoldingSelect(false);
  }, []);

  const switchHolding = useCallback(async (holdingId: number) => {
    await authService.switchHolding(holdingId);
    const userInfo = await authService.me();
    setUser(userInfo);
    setNeedsHoldingSelect(false);
  }, []);

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
