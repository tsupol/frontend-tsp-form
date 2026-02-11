import { apiClient } from './api';

// Types - will be updated when server provides proper response types
export interface UserInfo {
  id: number;
  username: string;
  role: string;
}

interface JwtPayload {
  exp: number;
  sid: string;
  role: string;
  ui_role: string;
  user_id: number;
  branch_id: number;
  tenant_id: number;
}

function decodeJwt(token: string): JwtPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = parts[1];
    const decoded = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

export interface LoginRequest {
  p_username: string;
  p_password: string;
  p_ip?: string;
  p_user_agent?: string;
}

export interface LoginResponse {
  user_id: number;
  access_token: string;
  token_type: string;
  expires_at: string;
  refresh_token: string;
  refresh_expires_at: string;
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

  getUserFromToken(): UserInfo | null {
    const token = this.getAccessToken();
    if (!token) return null;

    const payload = decodeJwt(token);
    if (!payload) return null;

    return {
      id: payload.user_id,
      username: `User ${payload.user_id}`, // Server doesn't provide username in JWT
      role: payload.ui_role || payload.role,
    };
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
    localStorage.removeItem('user');
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

  getStoredUser(): UserInfo | null {
    const userStr = localStorage.getItem('user');
    if (!userStr) return null;
    try {
      return JSON.parse(userStr);
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
