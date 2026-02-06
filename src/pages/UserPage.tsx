import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Button, Switch } from 'tsp-form';
import { useAuth } from '../contexts/AuthContext';
import { authService } from '../lib/auth';

const EXPIRED_GRACE_PERIOD_MS = 5000; // 5 seconds grace period before redirect

function TokenDebugPanel() {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [lastRefreshTime, setLastRefreshTime] = useState<Date | null>(null);
  const refreshingRef = useRef(false);
  const expiredSinceRef = useRef<number | null>(null);

  const [tokenInfo, setTokenInfo] = useState<{
    accessToken: string | null;
    refreshToken: string | null;
    expiresAt: Date | null;
    expiresAtRaw: string | null;
    timeRemaining: string;
    isExpired: boolean;
  }>({
    accessToken: null,
    refreshToken: null,
    expiresAt: null,
    expiresAtRaw: null,
    timeRemaining: '-',
    isExpired: false,
  });

  const [refreshStatus, setRefreshStatus] = useState<string>('');

  useEffect(() => {
    const update = async () => {
      const accessToken = authService.getAccessToken();
      const refreshToken = authService.getRefreshToken();
      const expiresAt = authService.getExpiresAt();
      const expiresAtRaw = localStorage.getItem('expires_at');

      let timeRemaining = '-';
      let isExpired = false;

      if (expiresAt && !isNaN(expiresAt.getTime())) {
        const diff = expiresAt.getTime() - Date.now();
        if (diff <= 0) {
          timeRemaining = 'EXPIRED';
          isExpired = true;
        } else {
          const seconds = Math.floor(diff / 1000);
          const minutes = Math.floor(seconds / 60);
          const secs = seconds % 60;
          timeRemaining = `${minutes}m ${secs}s`;
        }
      }

      setTokenInfo({ accessToken, refreshToken, expiresAt, expiresAtRaw, timeRemaining, isExpired });

      // Handle expiration
      if (isExpired && !refreshingRef.current) {
        if (autoRefresh) {
          // Try to refresh
          refreshingRef.current = true;
          setRefreshError(null);
          try {
            await authService.refresh();
            setLastRefreshTime(new Date());
            setRefreshError(null);
            expiredSinceRef.current = null; // Reset on successful refresh
          } catch (err) {
            setRefreshError(err instanceof Error ? err.message : 'Refresh failed');

            // Track when refresh started failing
            if (expiredSinceRef.current === null) {
              expiredSinceRef.current = Date.now();
            }

            // Redirect after grace period
            const expiredDuration = Date.now() - expiredSinceRef.current;
            if (expiredDuration >= EXPIRED_GRACE_PERIOD_MS) {
              await logout();
              navigate('/login');
            }
          } finally {
            refreshingRef.current = false;
          }
        } else {
          // No auto-refresh, track expiration time
          if (expiredSinceRef.current === null) {
            expiredSinceRef.current = Date.now();
          }

          // Redirect after grace period
          const expiredDuration = Date.now() - expiredSinceRef.current;
          if (expiredDuration >= EXPIRED_GRACE_PERIOD_MS) {
            await logout();
            navigate('/login');
          }
        }
      } else if (!isExpired) {
        // Reset expired tracker when token is valid
        expiredSinceRef.current = null;
      }
    };

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [autoRefresh, logout, navigate]);

  const handleManualRefresh = async () => {
    setRefreshStatus('Refreshing...');
    setRefreshError(null);
    try {
      await authService.refresh();
      setRefreshStatus('Refreshed!');
      setLastRefreshTime(new Date());
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setRefreshStatus(`Failed: ${msg}`);
      setRefreshError(msg);
    }
    setTimeout(() => setRefreshStatus(''), 3000);
  };

  const truncate = (str: string | null, len: number) => {
    if (!str) return '-';
    if (str.length <= len) return str;
    return str.slice(0, len / 2) + '...' + str.slice(-len / 2);
  };

  const isNearExpiry = tokenInfo.expiresAt &&
    (tokenInfo.expiresAt.getTime() - Date.now()) <= 60000 &&
    !tokenInfo.isExpired;

  return (
    <div className="border border-line bg-surface p-6 rounded-lg max-w-2xl">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold">Token Debug</h2>
        <div className="flex items-center gap-2">
          <span className="text-sm text-control-label">Auto Refresh</span>
          <Switch checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
        </div>
      </div>

      {refreshError && (
        <div className="mb-4 p-3 bg-danger/10 border border-danger rounded text-danger text-sm">
          Refresh Error: {refreshError}
        </div>
      )}

      <div className="space-y-4 font-mono text-sm">
        <div>
          <div className="text-control-label">Access Token</div>
          <div className="mt-1 break-all bg-surface-shallow p-2 rounded">
            {truncate(tokenInfo.accessToken, 60)}
          </div>
        </div>

        <div>
          <div className="text-control-label">Refresh Token</div>
          <div className="mt-1 break-all bg-surface-shallow p-2 rounded">
            {truncate(tokenInfo.refreshToken, 60)}
          </div>
        </div>

        <div>
          <div className="text-control-label">Expires At (raw)</div>
          <div className="mt-1 text-xs bg-surface-shallow p-2 rounded">
            {tokenInfo.expiresAtRaw ?? '-'}
          </div>
        </div>

        <div>
          <div className="text-control-label">Expires At (parsed)</div>
          <div className="mt-1">
            {tokenInfo.expiresAt && !isNaN(tokenInfo.expiresAt.getTime())
              ? tokenInfo.expiresAt.toLocaleString()
              : 'Invalid'}
          </div>
        </div>

        <div>
          <div className="text-control-label">Time Remaining</div>
          <div className={`mt-1 text-lg font-bold ${
            tokenInfo.isExpired ? 'text-danger' :
            isNearExpiry ? 'text-warning' :
            'text-success'
          }`}>
            {tokenInfo.timeRemaining}
          </div>
        </div>

        {lastRefreshTime && (
          <div>
            <div className="text-control-label">Last Refresh</div>
            <div className="mt-1 text-success">
              {lastRefreshTime.toLocaleTimeString()}
            </div>
          </div>
        )}

        <div className="flex gap-2 items-center pt-2 flex-wrap">
          <Button variant="outline" size="compact" onClick={handleManualRefresh}>
            Manual Refresh
          </Button>
          {refreshStatus && (
            <span className={refreshStatus.includes('Failed') ? 'text-danger' : 'text-success'}>
              {refreshStatus}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export function UserPage() {
  const { t } = useTranslation();
  const { user } = useAuth();

  return (
    <div className="page-content p-6">
      <h1 className="text-xl font-bold mb-6">{t('nav.userDetails')}</h1>

      <div className="space-y-6">
        <div className="border border-line bg-surface p-6 rounded-lg max-w-md">
          <div className="space-y-4">
            <div>
              <div className="text-sm text-control-label">{t('user.id')}</div>
              <div className="mt-1">{user?.id ?? '-'}</div>
            </div>

            <div>
              <div className="text-sm text-control-label">{t('user.username')}</div>
              <div className="mt-1">{user?.username ?? '-'}</div>
            </div>

            <div>
              <div className="text-sm text-control-label">{t('user.role')}</div>
              <div className="mt-1">{user?.role ?? '-'}</div>
            </div>
          </div>
        </div>

        <TokenDebugPanel />
      </div>
    </div>
  );
}
