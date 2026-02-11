import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from 'tsp-form';
import { Smartphone, AlertCircle, CheckCircle, ExternalLink } from 'lucide-react';

type DeviceType = 'ios-safari' | 'ios-other' | 'android' | 'other';

function detectDevice(): DeviceType {
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua);
  const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|OPiOS|EdgiOS/.test(ua);

  if (isIOS && isSafari) return 'ios-safari';
  if (isIOS) return 'ios-other';
  if (/Android/.test(ua)) return 'android';
  return 'other';
}

export function EnrollRedirectPage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const [deviceType, setDeviceType] = useState<DeviceType>('other');
  const [countdown, setCountdown] = useState(5);

  const enrollmentId = searchParams.get('id');
  const profileUrl = enrollmentId
    ? `https://czynet.dyndns.org/enroll/${enrollmentId}.mobileconfig`
    : null;

  useEffect(() => {
    setDeviceType(detectDevice());
  }, []);

  // Auto-redirect countdown for Safari
  useEffect(() => {
    if (deviceType !== 'ios-safari' || !profileUrl) return;

    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    } else {
      window.location.href = profileUrl;
    }
  }, [deviceType, countdown, profileUrl]);

  const handleOpenInSafari = () => {
    // Create Safari-specific URL scheme
    const currentUrl = window.location.href;
    window.location.href = `x-safari-${currentUrl}`;
  };

  const handleDownloadProfile = () => {
    if (profileUrl) {
      window.location.href = profileUrl;
    }
  };

  // No enrollment ID
  if (!enrollmentId) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center p-4">
        <div className="max-w-sm w-full text-center">
          <AlertCircle size={64} className="text-danger mx-auto mb-4" />
          <h1 className="text-xl font-bold mb-2">{t('enrollRedirect.invalidLink')}</h1>
          <p className="text-control-label">{t('enrollRedirect.invalidLinkDesc')}</p>
        </div>
      </div>
    );
  }

  // iOS Safari - ready to install
  if (deviceType === 'ios-safari') {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center p-4">
        <div className="max-w-sm w-full text-center">
          <CheckCircle size={64} className="text-success mx-auto mb-4" />
          <h1 className="text-xl font-bold mb-2">{t('enrollRedirect.readyToInstall')}</h1>
          <p className="text-control-label mb-6">{t('enrollRedirect.readyToInstallDesc')}</p>

          <Button
            variant="outline"
            className="w-full mb-4"
            onClick={handleDownloadProfile}
          >
            <Smartphone size={18} className="mr-2" />
            {t('enrollRedirect.installProfile')}
          </Button>

          <p className="text-sm text-control-label">
            {t('enrollRedirect.autoRedirect', { seconds: countdown })}
          </p>
        </div>
      </div>
    );
  }

  // iOS but not Safari
  if (deviceType === 'ios-other') {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center p-4">
        <div className="max-w-sm w-full text-center">
          <AlertCircle size={64} className="text-warning mx-auto mb-4" />
          <h1 className="text-xl font-bold mb-2">{t('enrollRedirect.safariRequired')}</h1>
          <p className="text-control-label mb-6">{t('enrollRedirect.safariRequiredDesc')}</p>

          <Button
            variant="outline"
            className="w-full mb-4"
            onClick={handleOpenInSafari}
          >
            <ExternalLink size={18} className="mr-2" />
            {t('enrollRedirect.openInSafari')}
          </Button>

          <div className="text-sm text-control-label space-y-2">
            <p className="font-medium">{t('enrollRedirect.manualSteps')}</p>
            <ol className="text-left list-decimal list-inside space-y-1">
              <li>{t('enrollRedirect.step1')}</li>
              <li>{t('enrollRedirect.step2')}</li>
              <li>{t('enrollRedirect.step3')}</li>
            </ol>
          </div>
        </div>
      </div>
    );
  }

  // Android or other
  return (
    <div className="min-h-screen bg-bg flex items-center justify-center p-4">
      <div className="max-w-sm w-full text-center">
        <AlertCircle size={64} className="text-warning mx-auto mb-4" />
        <h1 className="text-xl font-bold mb-2">{t('enrollRedirect.iosOnly')}</h1>
        <p className="text-control-label">{t('enrollRedirect.iosOnlyDesc')}</p>
      </div>
    </div>
  );
}
