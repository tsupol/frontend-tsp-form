import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from 'tsp-form';
import { Bell, BellOff, CheckCircle } from 'lucide-react';
import { setupStaffPush } from '../lib/api/push';

type Status =
  | 'checking'
  | 'unsupported'
  | 'needs_enable'   // permission default OR granted-but-no-subscription
  | 'blocked'        // permission denied
  | 'ok'             // permission granted + active subscription
  | 'just_enabled'   // user clicked Enable and it worked
  | 'enabling';

async function probeStatus(): Promise<Status> {
  if (typeof window === 'undefined') return 'ok';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return 'unsupported';
  }
  if (Notification.permission === 'denied') return 'blocked';
  try {
    const reg = await navigator.serviceWorker.getRegistration('/sw.js');
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    if (Notification.permission === 'granted' && sub) return 'ok';
    return 'needs_enable';
  } catch {
    return 'needs_enable';
  }
}

export function PushSubscribeBanner() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<Status>('checking');

  useEffect(() => {
    let cancelled = false;
    probeStatus().then(s => { if (!cancelled) setStatus(s); });
    return () => { cancelled = true; };
  }, []);

  const handleEnable = async () => {
    setStatus('enabling');
    const result = await setupStaffPush();
    if (result.ok) {
      setStatus('just_enabled');
      return;
    }
    if (result.reason === 'permission_denied') setStatus('blocked');
    else setStatus(await probeStatus());
  };

  if (status === 'checking' || status === 'ok') return null;

  if (status === 'just_enabled') {
    return (
      <div className="alert alert-success mb-4">
        <CheckCircle size={16} />
        <div>
          <div className="alert-description text-sm">{t('dashboard.pushBannerEnabled')}</div>
        </div>
      </div>
    );
  }

  if (status === 'unsupported') {
    return (
      <div className="alert alert-info mb-4">
        <BellOff size={16} />
        <div>
          <div className="alert-description text-sm">{t('dashboard.pushBannerUnsupported')}</div>
        </div>
      </div>
    );
  }

  const blocked = status === 'blocked';
  return (
    <div className="alert alert-warning mb-4">
      {blocked ? <BellOff size={16} /> : <Bell size={16} />}
      <div className="flex-1 min-w-0">
        <div className="alert-title">{t('dashboard.pushBannerTitle')}</div>
        <div className="alert-description text-sm">
          {blocked ? t('dashboard.pushBannerBlocked') : t('dashboard.pushBannerBody')}
        </div>
      </div>
      <Button
        variant="primary"
        size="sm"
        onClick={handleEnable}
        disabled={status === 'enabling'}
        startIcon={<Bell size={14} />}
      >
        {status === 'enabling' ? t('dashboard.pushBannerEnabling') : t('dashboard.pushBannerEnable')}
      </Button>
    </div>
  );
}
