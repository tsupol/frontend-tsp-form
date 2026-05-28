import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRightFromLine, Bell, BellOff } from 'lucide-react';
import { MobileHeader, Switch } from 'tsp-form';
import { setupStaffPush } from '../../lib/api/push';

type Status =
  | 'checking'
  | 'unsupported'
  | 'denied'
  | 'off'
  | 'on';

async function probeStatus(): Promise<Status> {
  if (typeof window === 'undefined') return 'unsupported';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return 'unsupported';
  }
  if (Notification.permission === 'denied') return 'denied';
  try {
    const reg = await navigator.serviceWorker.getRegistration('/sw.js');
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    if (Notification.permission === 'granted' && sub) return 'on';
    return 'off';
  } catch {
    return 'off';
  }
}

export function NotificationPrefsPage() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<Status>('checking');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>('');

  const refresh = async () => setStatus(await probeStatus());

  useEffect(() => { refresh(); }, []);

  const handleToggle = async (next: boolean) => {
    setError('');
    setBusy(true);
    try {
      if (next) {
        const result = await setupStaffPush();
        if (!result.ok) {
          if (result.reason === 'permission_denied') setStatus('denied');
          else setError(t('notifPrefs.enableFailed', { reason: result.reason }));
        }
      } else {
        const reg = await navigator.serviceWorker.getRegistration('/sw.js');
        const sub = reg ? await reg.pushManager.getSubscription() : null;
        if (sub) await sub.unsubscribe();
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const isOn = status === 'on';
  const disabled = busy || status === 'checking' || status === 'unsupported' || status === 'denied';

  return (
    <>
      <MobileHeader className="mobile-header-scrolled-shadow md:hidden">
        <div className="mobile-header-start">
          <button
            className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current"
            aria-label="Open menu"
            onClick={() => window.dispatchEvent(new CustomEvent('sidemenu:open'))}
          >
            <ArrowRightFromLine size={18} />
          </button>
        </div>
        <div className="mobile-header-title mobile-header-title-truncate">
          {t('notifPrefs.title')}
        </div>
        <div className="mobile-header-end w-nav" />
      </MobileHeader>

      <div className="page-content max-w-2xl">
        <div className="flex items-center gap-2 mb-4 max-md:hidden">
          <Bell size={20} />
          <h1 className="heading-2">{t('notifPrefs.title')}</h1>
        </div>

        <div className="border border-line bg-surface p-5 rounded-lg flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="font-medium">{t('notifPrefs.pushLabel')}</div>
              <div className="text-sm text-subtle">{t('notifPrefs.pushHelp')}</div>
            </div>
            <Switch
              checked={isOn}
              disabled={disabled}
              onChange={(e) => handleToggle(e.target.checked)}
            />
          </div>

          {status === 'denied' && (
            <div className="alert alert-warning">
              <BellOff size={16} />
              <div>
                <div className="alert-title">{t('notifPrefs.deniedTitle')}</div>
                <div className="alert-description text-xs">{t('notifPrefs.deniedBody')}</div>
              </div>
            </div>
          )}
          {status === 'unsupported' && (
            <div className="alert alert-info">
              <BellOff size={16} />
              <div>
                <div className="alert-description text-sm">{t('notifPrefs.unsupported')}</div>
              </div>
            </div>
          )}
          {error && (
            <div className="alert alert-danger">
              <BellOff size={16} />
              <div><div className="alert-description text-xs">{error}</div></div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
