import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Switch } from 'tsp-form';
import { XCircle } from 'lucide-react';
import { authService } from '../../lib/auth';
import { useAuth } from '../../contexts/AuthContext';
import { DateTime } from '../../components/DateTime';

const EXPIRED_GRACE_PERIOD_MS = 5000;

interface TokenInfo {
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: Date | null;
  expiresAtRaw: string | null;
  timeRemaining: string;
  isExpired: boolean;
}

function truncate(str: string | null, len: number) {
  if (!str) return '-';
  if (str.length <= len) return str;
  return str.slice(0, len / 2) + '...' + str.slice(-len / 2);
}

export function DevTokensPage() {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [lastRefreshTime, setLastRefreshTime] = useState<Date | null>(null);
  const refreshingRef = useRef(false);
  const expiredSinceRef = useRef<number | null>(null);

  const [tokenInfo, setTokenInfo] = useState<TokenInfo>({
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

      if (isExpired && !refreshingRef.current) {
        if (autoRefresh) {
          refreshingRef.current = true;
          setRefreshError(null);
          try {
            await authService.refresh();
            setLastRefreshTime(new Date());
            setRefreshError(null);
            expiredSinceRef.current = null;
          } catch (err) {
            setRefreshError(err instanceof Error ? err.message : 'Refresh failed');
            if (expiredSinceRef.current === null) expiredSinceRef.current = Date.now();
            const expiredDuration = Date.now() - expiredSinceRef.current;
            if (expiredDuration >= EXPIRED_GRACE_PERIOD_MS) {
              await logout();
              navigate('/login');
            }
          } finally {
            refreshingRef.current = false;
          }
        } else {
          if (expiredSinceRef.current === null) expiredSinceRef.current = Date.now();
          const expiredDuration = Date.now() - expiredSinceRef.current;
          if (expiredDuration >= EXPIRED_GRACE_PERIOD_MS) {
            await logout();
            navigate('/login');
          }
        }
      } else if (!isExpired) {
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

  const isNearExpiry = tokenInfo.expiresAt
    && (tokenInfo.expiresAt.getTime() - Date.now()) <= 60000
    && !tokenInfo.isExpired;

  return (
    <div className="page-content max-w-3xl mx-auto p-6 flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold mb-1">Token Debug</h1>
        <p className="text-sm text-subtle">
          Live view of the access/refresh tokens stored in localStorage and the
          background refresh cycle. Useful for debugging session-expiry / login
          edge cases.
        </p>
      </div>

      <div className="border border-line rounded-lg p-5 flex flex-col gap-4">
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-semibold">Status</h2>
          <div className="flex items-center gap-2">
            <span className="text-sm text-subtle">Auto refresh</span>
            <Switch checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
          </div>
        </div>

        {refreshError && (
          <div className="alert alert-danger">
            <XCircle size={18} />
            <div><div className="alert-description">Refresh error: {refreshError}</div></div>
          </div>
        )}

        <div className="space-y-4 font-mono text-sm">
          <div>
            <div className="text-subtle">Access token</div>
            <div className="mt-1 break-all bg-surface-shallow p-2 rounded">
              {truncate(tokenInfo.accessToken, 60)}
            </div>
          </div>

          <div>
            <div className="text-subtle">Refresh token</div>
            <div className="mt-1 break-all bg-surface-shallow p-2 rounded">
              {truncate(tokenInfo.refreshToken, 60)}
            </div>
          </div>

          <div>
            <div className="text-subtle">Expires at (raw)</div>
            <div className="mt-1 text-xs bg-surface-shallow p-2 rounded">
              {tokenInfo.expiresAtRaw ?? '-'}
            </div>
          </div>

          <div>
            <div className="text-subtle">Expires at (parsed)</div>
            <div className="mt-1">
              {tokenInfo.expiresAt && !isNaN(tokenInfo.expiresAt.getTime())
                ? <DateTime value={tokenInfo.expiresAt.toISOString()} />
                : 'Invalid'}
            </div>
          </div>

          <div>
            <div className="text-subtle">Time remaining</div>
            <div className={`mt-1 text-lg font-bold ${
              tokenInfo.isExpired ? 'text-danger'
                : isNearExpiry ? 'text-warning-fg'
                  : 'text-success'
            }`}>
              {tokenInfo.timeRemaining}
            </div>
          </div>

          {lastRefreshTime && (
            <div>
              <div className="text-subtle">Last refresh</div>
              <div className="mt-1 text-success">
                {lastRefreshTime.toLocaleTimeString()}
              </div>
            </div>
          )}

          <div className="flex gap-2 items-center pt-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={handleManualRefresh}>
              Manual refresh
            </Button>
            {refreshStatus && (
              <span className={refreshStatus.includes('Failed') ? 'text-danger' : 'text-success'}>
                {refreshStatus}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
