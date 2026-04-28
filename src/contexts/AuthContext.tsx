import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import type { ReactNode } from 'react';
import { authService } from '../lib/auth';
import { apiClient, setAuthErrorHandler, setTokenRefresher } from '../lib/api';
import type { UserInfo } from '../lib/auth';

interface LoginResult {
  needsHoldingSelect: boolean;
}

interface Capability {
  code: string;
  scope: string;
  description: string;
}

interface CapabilitiesResponse {
  role_code: string;
  capabilities: Capability[];
}

interface AuthContextType {
  user: UserInfo | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  needsHoldingSelect: boolean;
  capabilities: Set<string>;
  can: (code: string) => boolean;
  login: (username: string, password: string) => Promise<LoginResult>;
  logout: () => Promise<void>;
  switchHolding: (holdingId: number) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [needsHoldingSelect, setNeedsHoldingSelect] = useState(false);
  const [capabilities, setCapabilities] = useState<Set<string>>(new Set());

  const fetchCapabilities = useCallback(async () => {
    try {
      const res = await apiClient.rpc<CapabilitiesResponse>('my_capabilities');
      setCapabilities(new Set(res.capabilities.map(c => c.code)));
    } catch (err) {
      console.error('[Auth] Failed to fetch capabilities:', err);
      setCapabilities(new Set());
    }
  }, []);

  const can = useCallback((code: string) => capabilities.has(code), [capabilities]);
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
        // Session is no longer valid — clear and redirect
        authService.clearTokens();
        setUser(null);
        window.location.href = '/login?reason=session_expired';
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

  // Register auth error handler and token refresher
  useEffect(() => {
    setAuthErrorHandler(handleAuthError);
    setTokenRefresher(async () => {
      try {
        await authService.refresh();
        scheduleRefresh(); // Reschedule background timer with new expiry
        return true;
      } catch {
        return false;
      }
    });
    return () => {
      setAuthErrorHandler(null);
      setTokenRefresher(null);
    };
  }, [handleAuthError, scheduleRefresh]);

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
          let res = await authService.meProfile();
          let userInfo = authService.profileToUserInfo(res);

          // If profile has no holding (e.g. SYSTEM_DEV), restore from localStorage
          if (userInfo.holding_id === null) {
            const savedHoldingId = localStorage.getItem('selected_holding_id');
            if (savedHoldingId) {
              userInfo = { ...userInfo, holding_id: Number(savedHoldingId) };
            }
          }

          // Resolve org names from v_branches
          if (userInfo.branch_id) {
            try {
              const branches = await apiClient.get<{ name: string; company_name: string }[]>(
                `/v_branches?id=eq.${userInfo.branch_id}&limit=1`
              );
              if (branches[0]) {
                userInfo.branch_name = branches[0].name;
                userInfo.company_name = branches[0].company_name;
              }
            } catch { /* non-critical */ }
          }

          setUser(userInfo);
          setNeedsHoldingSelect(userInfo.holding_id === null);
          scheduleRefresh();
          if (userInfo.holding_id !== null) {
            await fetchCapabilities();
          }
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

      const res = await authService.meProfile();
      const userInfo = authService.profileToUserInfo(res);

      if (response.holding_id !== null) {
        // Role has a fixed holding — use it
        userInfo.holding_id = response.holding_id;
      } else {
        // Role needs to select — clear any stale holding from previous login
        localStorage.removeItem('selected_holding_id');
      }

      // Carry org names from login response
      userInfo.branch_name = response.branch_name;
      userInfo.company_name = response.company_name;

      setUser(userInfo);
      setNeedsHoldingSelect(holdingNeeded);

      scheduleRefresh();
      if (!holdingNeeded) {
        await fetchCapabilities();
      }
      return { needsHoldingSelect: holdingNeeded };
    } finally {
      isLoginInProgress.current = false;
    }
  }, [fetchCapabilities]);

  const logout = useCallback(async () => {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
    await authService.logout();
    localStorage.removeItem('selected_holding_id');
    setUser(null);
    setNeedsHoldingSelect(false);
    setCapabilities(new Set());
  }, []);

  const switchHolding = useCallback(async (holdingId: number) => {
    const result = await authService.switchHolding(holdingId);
    // Use holding_id from server response as single source of truth
    setUser(prev => prev ? { ...prev, holding_id: result.holding_id } : prev);
    setNeedsHoldingSelect(false);
    scheduleRefresh();
    await fetchCapabilities();
  }, [scheduleRefresh, fetchCapabilities]);

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user && !authService.isTokenExpired(),
        isLoading,
        needsHoldingSelect,
        capabilities,
        can,
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
