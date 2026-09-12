import { apiClient } from './api';

// mig 1193: login/refresh/switch_holding/my_capabilities return the branch's
// type so the UI can pick the menu set (DEAL_PARTNER → shop menu). Null when
// the user has no branch (holding/company admins, SYSTEM_DEV before switch).
export type BranchType = 'INTERNAL' | 'EXTERNAL' | 'DEAL_PARTNER';

// Subset of the mig-1193 block shared by login / refresh / switch_holding /
// my_capabilities responses. Persisted so a page reload keeps the menu set
// without re-reading v_branches (which the shop DB role won't be able to see).
export interface BranchContext {
  branch_type?: BranchType | null;
  db_role?: string | null;
  branch_name?: string | null;
  company_name?: string | null;
}

export interface UserProfile {
  user_id: number;
  username: string;
  role_code: string;
  holding_id: number | null;
  company_id: number | null;
  branch_id: number | null;
  firstname: string | null;
  lastname: string | null;
  nickname: string | null;
  tel: string | null;
  address: string | null;
  date_of_birth: string | null;
  profile_image: Record<string, string> | null;
  images: Record<string, string>[] | null;
  has_national_id: boolean;
  national_id_last4: string | null;
  created_at: string;
  updated_at: string;
}

export interface MeProfileResponse {
  profile: UserProfile;
  idcard: Record<string, unknown>;
}

export interface UserInfo {
  user_id: number;
  username: string;
  role_code: string;
  holding_id: number | null;
  company_id: number | null;
  branch_id: number | null;
  branch_name: string | null;
  company_name: string | null;
  branch_type: BranchType | null;
  db_role: string | null;
  firstname: string | null;
  lastname: string | null;
  nickname: string | null;
  profile_image: Record<string, string> | null;
}

export interface LoginRequest {
  p_username: string;
  p_password: string;
  p_ip?: string;
  p_user_agent?: string;
}

export interface LoginResponse {
  user_id: number;
  holding_id: number | null;
  role_code: string;
  branch_name: string | null;
  company_name: string | null;
  branch_type: BranchType | null;
  db_role: string | null;
  access_token: string;
  token_type: string;
  expires_at: string;
  refresh_token: string;
  refresh_expires_at: string;
}

export interface HoldingOption {
  holding_id: number;
  code: string;
  name: string;
}

export interface SwitchHoldingResponse extends BranchContext {
  user_id: number;
  holding_id: number;
  role_code: string;
  company_id: number | null;
  branch_id: number | null;
  access_token: string;
  token_type: string;
  expires_at: string;
}

export interface RefreshRequest {
  p_refresh_token: string;
  p_ip?: string;
  p_user_agent?: string;
}

// mig 1193: refresh returns the same org block as login (branch_type,
// db_role, branch_name, company_name) — no extra view call needed after it.
export interface RefreshResponse extends BranchContext {
  user_id: number;
  access_token: string;
  token_type: string;
  expires_at: string;
  refresh_token: string;
  refresh_expires_at: string;
}

export interface LogoutRequest {
  p_refresh_token: string;
}

const STARTUP_REFRESH_THRESHOLD_MS = 5 * 60 * 1000; // On startup, refresh if < 5 min left
const BACKGROUND_REFRESH_THRESHOLD_MS = 60 * 1000;  // Background timer fires 1 min before expiry

export const authService = {
  async login(username: string, password: string): Promise<LoginResponse> {
    const result = await apiClient.rpc<LoginResponse>('login', {
      p_username: username,
      p_password: password,
      p_user_agent: navigator.userAgent,
    }, false);

    this.storeTokens(result);
    this.storeBranchContext(result);
    return result;
  },

  async refresh(): Promise<RefreshResponse> {
    const refreshToken = this.getRefreshToken();
    if (!refreshToken) {
      throw new Error('No refresh token available');
    }

    const result = await apiClient.rpc<RefreshResponse>('refresh', {
      p_refresh_token: refreshToken,
      p_user_agent: navigator.userAgent,
    }, false);

    this.storeTokens(result);
    this.storeBranchContext(result);
    return result;
  },

  async logout(): Promise<void> {
    const refreshToken = this.getRefreshToken();
    if (refreshToken) {
      try {
        await apiClient.rpc('logout', {
          p_refresh_token: refreshToken,
        });
      } catch {
        // Ignore logout errors
      }
    }
    this.clearTokens();
  },

  async meProfile(): Promise<MeProfileResponse> {
    return apiClient.rpc<MeProfileResponse>('me_profile_get');
  },

  /** Convert me_profile_get response to UserInfo for auth context */
  profileToUserInfo(res: MeProfileResponse): UserInfo {
    const p = res.profile;
    // Org block comes from the last login/refresh/switch_holding response
    // (persisted below), NOT from views — the shop DB role can't read them.
    return {
      user_id: p.user_id,
      username: p.username,
      role_code: p.role_code,
      holding_id: p.holding_id,
      company_id: p.company_id,
      branch_id: p.branch_id,
      branch_name: this.getStoredBranchName(),
      company_name: this.getStoredCompanyName(),
      branch_type: this.getBranchType(),
      db_role: this.getDbRole(),
      firstname: p.firstname,
      lastname: p.lastname,
      nickname: p.nickname,
      profile_image: p.profile_image,
    };
  },

  storeTokens(response: LoginResponse | RefreshResponse): void {
    localStorage.setItem('access_token', response.access_token);
    localStorage.setItem('refresh_token', response.refresh_token);
    localStorage.setItem('expires_at', response.expires_at);
    localStorage.setItem('refresh_expires_at', response.refresh_expires_at);
  },

  /**
   * Persist the mig-1193 org block. Fields set to undefined are left as-is
   * (caller didn't receive them); null clears the stored value.
   */
  storeBranchContext(ctx: BranchContext): void {
    const put = (key: string, value: string | null | undefined) => {
      if (value === undefined) return;
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    };
    put('branch_type', ctx.branch_type);
    put('db_role', ctx.db_role);
    put('branch_name', ctx.branch_name);
    put('company_name', ctx.company_name);
  },

  getBranchType(): BranchType | null {
    const v = localStorage.getItem('branch_type');
    return v === 'INTERNAL' || v === 'EXTERNAL' || v === 'DEAL_PARTNER' ? v : null;
  },

  getDbRole(): string | null {
    return localStorage.getItem('db_role');
  },

  getStoredBranchName(): string | null {
    return localStorage.getItem('branch_name');
  },

  getStoredCompanyName(): string | null {
    return localStorage.getItem('company_name');
  },

  clearTokens(): void {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('expires_at');
    localStorage.removeItem('refresh_expires_at');
    localStorage.removeItem('selected_holding_id');
    localStorage.removeItem('branch_type');
    localStorage.removeItem('db_role');
    localStorage.removeItem('branch_name');
    localStorage.removeItem('company_name');
    this.clearUserScopedState();
  },

  /**
   * Drop per-user app state that would otherwise survive into the next
   * session. Tokens live in memory and die with the reload that follows a
   * logout, but localStorage/sessionStorage do not — without this, one user's
   * print queue, branch scope or open chat carries over to whoever logs in
   * next. Anything keyed to a specific user's data belongs in these lists.
   */
  clearUserScopedState(): void {
    const localKeys = [
      'asset-print-queue-v1',   // AssetsPage print queue
      'chatDock',               // ChatDockContext: open contract + position
      'priceCheck_recent',      // PriceCheckPage recents
    ];
    const sessionKeys = [
      'accounting.reconcile.branchScope',
      'accounting.reconcile.dateRange',
      'accounting.reconcile.branchStripCollapsed',
    ];
    for (const k of localKeys) {
      try { localStorage.removeItem(k); } catch { /* ignore */ }
    }
    for (const k of sessionKeys) {
      try { sessionStorage.removeItem(k); } catch { /* ignore */ }
    }
  },

  getAccessToken(): string | null {
    const token = localStorage.getItem('access_token');
    // Guard against invalid stored values
    if (!token || token === 'undefined' || token === 'null') {
      return null;
    }
    return token;
  },

  getRefreshToken(): string | null {
    const token = localStorage.getItem('refresh_token');
    // Guard against invalid stored values
    if (!token || token === 'undefined' || token === 'null') {
      return null;
    }
    return token;
  },

  getExpiresAt(): Date | null {
    const expiresAt = localStorage.getItem('expires_at');
    if (!expiresAt) return null;
    try {
      return new Date(expiresAt);
    } catch {
      return null;
    }
  },

  isTokenExpired(): boolean {
    const expiresAt = this.getExpiresAt();
    if (!expiresAt) return true;
    return new Date() >= expiresAt;
  },

  shouldRefreshToken(): boolean {
    const expiresAt = this.getExpiresAt();
    if (!expiresAt) return false;
    const now = new Date();
    const timeUntilExpiry = expiresAt.getTime() - now.getTime();
    return timeUntilExpiry <= STARTUP_REFRESH_THRESHOLD_MS;
  },

  /** Returns ms until the background timer should fire, or null if not schedulable. */
  getBackgroundRefreshDelay(): number | null {
    const expiresAt = this.getExpiresAt();
    if (!expiresAt) return null;
    const delay = expiresAt.getTime() - Date.now() - BACKGROUND_REFRESH_THRESHOLD_MS;
    return delay > 0 ? delay : 0;
  },

  isAuthenticated(): boolean {
    const token = this.getAccessToken();
    if (!token) return false;
    return !this.isTokenExpired();
  },

  getRefreshExpiresAt(): Date | null {
    const expiresAt = localStorage.getItem('refresh_expires_at');
    if (!expiresAt) return null;
    try {
      return new Date(expiresAt);
    } catch {
      return null;
    }
  },

  isRefreshTokenExpired(): boolean {
    const expiresAt = this.getRefreshExpiresAt();
    if (!expiresAt) return true;
    return new Date() >= expiresAt;
  },

  async listHoldingsForContext(): Promise<{ holdings: HoldingOption[] }> {
    return apiClient.rpc<{ holdings: HoldingOption[] }>('list_holdings_for_context');
  },

  async switchHolding(holdingId: number): Promise<SwitchHoldingResponse> {
    const result = await apiClient.rpc<SwitchHoldingResponse>('switch_holding', {
      p_holding_id: holdingId,
    });

    // Update access_token with new holding context
    localStorage.setItem('access_token', result.access_token);
    localStorage.setItem('expires_at', result.expires_at);
    localStorage.setItem('selected_holding_id', String(result.holding_id));
    this.storeBranchContext(result);

    return result;
  },

  async validateAndRefresh(): Promise<boolean> {
    const accessToken = this.getAccessToken();
    const refreshToken = this.getRefreshToken();

    if (!accessToken || !refreshToken) {
      this.clearTokens();
      return false;
    }

    // If refresh token is expired, must re-login
    if (this.isRefreshTokenExpired()) {
      this.clearTokens();
      return false;
    }

    // If access token is expired or about to expire, try to refresh
    if (this.isTokenExpired() || this.shouldRefreshToken()) {
      try {
        await this.refresh();
        return true;
      } catch {
        this.clearTokens();
        return false;
      }
    }

    return true;
  },
};
