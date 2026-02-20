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

  // Handle auth errors from API - clear session and redirect to login
  const handleAuthError = useCallback((details: { code: string; message: string }) => {
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
      const isValid = await authService.validateAndRefresh();
      if (isValid) {
        try {
          const userInfo = await authService.me();
          console.log('[Auth] User info:', userInfo.role_code, 'holding:', userInfo.holding_id);
          setUser(userInfo);
          setNeedsHoldingSelect(userInfo.holding_id === null);
        } catch (err) {
          console.error('[Auth] Failed to fetch user info after token validation:', err);
          authService.clearTokens();
          setUser(null);
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
    const response = await authService.login(username, password);
    const userInfo = await authService.me();
    setUser(userInfo);

    const holdingNeeded = response.holding_id === null;
    setNeedsHoldingSelect(holdingNeeded);
    return { needsHoldingSelect: holdingNeeded };
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
