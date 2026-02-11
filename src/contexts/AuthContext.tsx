import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import type { ReactNode } from 'react';
import { authService } from '../lib/auth';
import { setAuthErrorHandler } from '../lib/api';
import type { UserInfo } from '../lib/auth';

interface AuthContextType {
  user: UserInfo | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
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
        const storedUser = authService.getStoredUser();
        if (storedUser) {
          setUser(storedUser);
        } else {
          // Try to get user from JWT token
          const tokenUser = authService.getUserFromToken();
          if (tokenUser) {
            setUser(tokenUser);
            localStorage.setItem('user', JSON.stringify(tokenUser));
          } else {
            // No valid user info
            authService.clearTokens();
            setUser(null);
          }
        }
      } else {
        authService.clearTokens();
        setUser(null);
      }
      setIsLoading(false);
    };
    initAuth();
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const response = await authService.login(username, password);

    // Get user info from JWT token, use login username
    const tokenUser = authService.getUserFromToken();
    const userInfo: UserInfo = {
      id: response.user_id,
      username: username, // Use the username they logged in with
      role: tokenUser?.role || 'user',
    };

    localStorage.setItem('user', JSON.stringify(userInfo));
    setUser(userInfo);
  }, []);

  const logout = useCallback(async () => {
    await authService.logout();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        login,
        logout,
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
