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
  const handleAuthError = useCallback(() => {
    // Prevent multiple redirects
    if (hasHandledAuthError.current) return;
    hasHandledAuthError.current = true;

    authService.clearTokens();
    setUser(null);

    // Redirect to login with reason
    window.location.href = '/login?reason=session_expired';
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
          setUser(userInfo);
          setNeedsHoldingSelect(userInfo.holding_id === null);
        } catch {
          authService.clearTokens();
          setUser(null);
        }
      } else {
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
