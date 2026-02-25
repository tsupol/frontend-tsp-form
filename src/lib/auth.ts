import { apiClient } from './api';

export interface Capability {
  code: string;
  description: string;
}

export interface UserInfo {
  user_id: number;
  sid: string;
  role_code: string;
  holding_id: number | null;
  company_id: number | null;
  branch_id: number | null;
  capabilities: Capability[];
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

export interface SwitchHoldingResponse {
  user_id: number;
  access_token: string;
  token_type: string;
  expires_at: string;
}

export interface RefreshRequest {
  p_refresh_token: string;
  p_ip?: string;
  p_user_agent?: string;
}

export interface RefreshResponse {
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

const TOKEN_REFRESH_THRESHOLD_MS = 60 * 1000; // Refresh 1 minute before expiry

export const authService = {
  async login(username: string, password: string): Promise<LoginResponse> {
    const result = await apiClient.rpc<LoginResponse>('login', {
      p_username: username,
      p_password: password,
      p_user_agent: navigator.userAgent,
    }, false);

    console.log('[Auth] Login response:', JSON.stringify(result, null, 2));
    this.storeTokens(result);
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

  async me(): Promise<UserInfo> {
    return apiClient.rpc<UserInfo>('me', {});
  },

  storeTokens(response: LoginResponse | RefreshResponse): void {
    localStorage.setItem('access_token', response.access_token);
    localStorage.setItem('refresh_token', response.refresh_token);
    localStorage.setItem('expires_at', response.expires_at);
    localStorage.setItem('refresh_expires_at', response.refresh_expires_at);
    localStorage.setItem('user_id', String(response.user_id));
  },

  clearTokens(): void {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('expires_at');
    localStorage.removeItem('refresh_expires_at');
    localStorage.removeItem('user_id');
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
    return timeUntilExpiry <= TOKEN_REFRESH_THRESHOLD_MS;
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

    // Update access_token and expires_at, keep existing refresh_token
    localStorage.setItem('access_token', result.access_token);
    localStorage.setItem('expires_at', result.expires_at);

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
