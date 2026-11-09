import { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { authService } from '../lib/auth';
import { apiClient, setAuthErrorHandler, setTokenRefresher, setReadOnlyViewer } from '../lib/api';
import { queryClient } from '../lib/queryClient';
import type { BranchType, UserInfo } from '../lib/auth';

interface LoginResult {
  needsHoldingSelect: boolean;
}

/** Read-only viewer role → the admin role whose screens it gets. */
const READ_ONLY_VIEWER_OF: Record<string, string> = {
  COMPANY_VIEWER: 'COMPANY_ADMIN',
  HOLDING_VIEWER: 'HOLDING_ADMIN',
};

interface Capability {
  code: string;
  scope: string;
  description: string;
}

interface CapabilitiesResponse {
  role_code: string;
  capabilities: Capability[];
  // mig 1193
  branch_id?: number | null;
  branch_type?: BranchType | null;
  db_role?: string | null;
}

interface AuthContextType {
  user: UserInfo | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  needsHoldingSelect: boolean;
  capabilities: Set<string>;
  /** Branch is a deal-partner shop → render the shop menu set (NOTICE 1193). */
  isDealPartner: boolean;
  /**
   * The branch belongs to a fund company. Those branches cannot take cash and
   * have no day-close step (mig 1300), so cash options and day-close
   * affordances are left out for them.
   */
  isFundBranch: boolean;
  /** The backend says this branch does not close its day. */
  skipsDayClose: boolean;
  /**
   * The user belongs to a fund company — the whole shop-money flow exists only
   * for these, and is absent for everyone else rather than shown and blocked.
   * True for a company-level user too, who has no branch at all.
   */
  isFundCompany: boolean;
  /**
   * This branch is the fund's own warehouse. It carries the same branch kind as
   * an ordinary sales branch, so nothing else tells them apart.
   */
  isFundWarehouse: boolean;
  /**
   * COMPANY_VIEWER (mig 1551) / HOLDING_VIEWER: a read-only twin of the admin
   * role. The session sees everything the admin sees — the DB makes every
   * request a read-only transaction, so any write dies there with 25006 / a
   * 500. `user.role_code` is already the admin's for them (one gate for both),
   * so this flag is the only thing that says "hide the write buttons".
   */
  isReadOnlyViewer: boolean;
  can: (code: string) => boolean;
  login: (username: string, password: string) => Promise<LoginResult>;
  logout: () => Promise<void>;
  switchHolding: (holdingId: number) => Promise<void>;
  refreshUser: () => Promise<void>;
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
      // Sessions from before mig 1193 have no stored branch_type until their
      // next refresh — my_capabilities returns it too, so backfill from here.
      if (res.branch_type !== undefined || res.db_role !== undefined) {
        authService.storeBranchContext({ branch_type: res.branch_type, db_role: res.db_role });
        setUser(prev => prev
          ? { ...prev, branch_type: res.branch_type ?? null, db_role: res.db_role ?? null }
          : prev
        );
      }
    } catch (err) {
      console.error('[Auth] Failed to fetch capabilities:', err);
      setCapabilities(new Set());
    }
  }, []);

  // my_capabilities is the ROLE's permissions only. A permission granted to the person
  // (v_my_permissions, source = 'GRANT') must count too, or a granted menu stays hidden —
  // mnt_god had CONTRACT.CHAT granted and no chat menu (BUG 2026-11-09). Same query and key
  // as useMyPermissions, so it is one request. Not hasPermission: that hides non-read codes
  // from a read-only viewer, who sees the chat menu today through the role.
  const { data: myPermissions } = useQuery({
    queryKey: ['my-permissions'],
    queryFn: () => apiClient.get<{ permission_code: string; source: 'ROLE' | 'GRANT' }[]>('/v_my_permissions'),
    staleTime: 5 * 60_000,
    enabled: !!user,
  });
  const granted = useMemo(
    () => new Set((myPermissions ?? []).filter(p => p.source === 'GRANT').map(p => p.permission_code)),
    [myPermissions],
  );
  const can = useCallback((code: string) => capabilities.has(code) || granted.has(code), [capabilities, granted]);
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

          // Resolve org names from v_branches — fallback only; login/refresh
          // persist them since mig 1193, and shop users can't read v_branches
          // once the nnf_partner role lands.
          if (userInfo.branch_id && !userInfo.branch_name) {
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

  const refreshUser = useCallback(async () => {
    try {
      const res = await authService.meProfile();
      const next = authService.profileToUserInfo(res);
      setUser(prev => prev
        ? {
            ...prev,
            firstname: next.firstname,
            lastname: next.lastname,
            nickname: next.nickname,
            profile_image: next.profile_image,
            role_code: next.role_code,
          }
        : next
      );
    } catch (err) {
      console.warn('[Auth] refreshUser failed', err);
    }
  }, []);

  const switchHolding = useCallback(async (holdingId: number) => {
    const result = await authService.switchHolding(holdingId);
    // Switching holding changes the whole data scope, so every cached query is
    // now wrong. Unlike login/logout this stays in-app (no reload to wipe the
    // heap), so drop the cache by hand; mounted pages refetch.
    queryClient.clear();
    // Use holding_id from server response as single source of truth; the org
    // block (branch_type/db_role/names) was persisted by authService.
    setUser(prev => prev
      ? {
          ...prev,
          holding_id: result.holding_id,
          branch_type: authService.getBranchType(),
          db_role: authService.getDbRole(),
          company_type: authService.getCompanyType(),
          skips_day_close: authService.getSkipsDayClose(),
          is_company_warehouse: authService.getIsCompanyWarehouse(),
          branch_name: authService.getStoredBranchName() ?? prev.branch_name,
          company_name: authService.getStoredCompanyName() ?? prev.company_name,
        }
      : prev);
    setNeedsHoldingSelect(false);
    scheduleRefresh();
    await fetchCapabilities();
  }, [scheduleRefresh, fetchCapabilities]);

  // A viewer role is the admin role for every visibility check in the app
  // (UI_FEEDBACK/2026-11-01_IMPLEMENT_company_viewer_role_1551.md asks for
  // exactly that: "menus and pages = COMPANY_ADMIN in every respect"), so the
  // mapping is done once here instead of at the ~50 role checks. The real role
  // stays on `actual_role_code` for the user menu / profile.
  const viewUser = useMemo(() => {
    if (!user) return null;
    const mirrored = READ_ONLY_VIEWER_OF[user.role_code];
    return mirrored ? { ...user, role_code: mirrored, actual_role_code: user.role_code } : user;
  }, [user]);
  const isReadOnlyViewer = !!user && user.role_code in READ_ONLY_VIEWER_OF;
  useEffect(() => { setReadOnlyViewer(isReadOnlyViewer); }, [isReadOnlyViewer]);

  return (
    <AuthContext.Provider
      value={{
        user: viewUser,
        isReadOnlyViewer,
        isAuthenticated: !!user && !authService.isTokenExpired(),
        isLoading,
        needsHoldingSelect,
        capabilities,
        isDealPartner: user?.branch_type === 'DEAL_PARTNER',
        // A branch-scoped session only: a company-level user has no branch to
        // take cash at, so the flag would say nothing about them.
        isFundBranch: user?.company_type === 'FINANCIER' && user?.branch_id != null,
        skipsDayClose: user?.skips_day_close === true,
        isFundCompany: user?.company_type === 'FINANCIER',
        isFundWarehouse: user?.is_company_warehouse === true,
        can,
        login,
        logout,
        switchHolding,
        refreshUser,
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
