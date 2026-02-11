import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from 'tsp-form';
import { Smartphone, AlertCircle, CheckCircle, ExternalLink, Loader2 } from 'lucide-react';
import { config } from '../config/config';

type DeviceType = 'ios-safari' | 'ios-other' | 'android' | 'other';

function detectDevice(): DeviceType {
  const ua = navigator.userAgent;

  // iPadOS 13+ reports as Macintosh, need to check touch support
  const isIPhone = /iPhone|iPod/.test(ua);
  const isIPad = /iPad/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ||
    (/Macintosh/.test(ua) && 'ontouchend' in document);
  const isIOS = isIPhone || isIPad;

  // Safari check - exclude Chrome, Firefox, Opera, Edge on iOS
  const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|OPiOS|EdgiOS|Chrome/.test(ua);

  if (isIOS && isSafari) return 'ios-safari';
  if (isIOS) return 'ios-other';
  if (/Android/.test(ua)) return 'android';
  return 'other';
}

async function fetchMobileconfig(enrollmentId: string): Promise<string> {
  const response = await fetch(`${config.apiUrl}/rpc/mdm_enrollment_mobileconfig`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_enrollment_id: enrollmentId }),
  });

  if (!response.ok) {
    throw new Error('Failed to fetch mobileconfig');
  }

  const data = await response.json();
  // API returns array with single object containing mobileconfig
  const mobileconfig = Array.isArray(data) ? data[0]?.mobileconfig : data?.mobileconfig;
  if (!mobileconfig) {
    throw new Error('No mobileconfig in response');
  }
  return mobileconfig;
}

function downloadMobileconfig(xmlContent: string, filename: string) {
  const blob = new Blob([xmlContent], { type: 'application/x-apple-aspen-config' });
  const url = URL.createObjectURL(blob);

  // Create a link and trigger download
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function EnrollRedirectPage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const [deviceType, setDeviceType] = useState<DeviceType>('other');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloaded, setDownloaded] = useState(false);

  const enrollmentId = searchParams.get('id');

  useEffect(() => {
    setDeviceType(detectDevice());
  }, []);

  const handleOpenInSafari = () => {
    const currentUrl = window.location.href;
    window.location.href = `x-safari-${currentUrl}`;
  };

  const handleDownloadProfile = async () => {
    if (!enrollmentId) return;

    setLoading(true);
    setError(null);

    try {
      const mobileconfig = await fetchMobileconfig(enrollmentId);
      downloadMobileconfig(mobileconfig, `enroll-${enrollmentId.slice(0, 8)}.mobileconfig`);
      setDownloaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
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
          {downloaded ? (
            <CheckCircle size={64} className="text-success mx-auto mb-4" />
          ) : (
            <Smartphone size={64} className="text-primary mx-auto mb-4" />
          )}
          <h1 className="text-xl font-bold mb-2">
            {downloaded ? t('enrollRedirect.profileDownloaded') : t('enrollRedirect.readyToInstall')}
          </h1>
          <p className="text-control-label mb-6">
            {downloaded ? t('enrollRedirect.profileDownloadedDesc') : t('enrollRedirect.readyToInstallDesc')}
          </p>

          {!downloaded && (
            <Button
              variant="outline"
              className="w-full mb-4"
              onClick={handleDownloadProfile}
              disabled={loading}
            >
              {loading ? (
                <Loader2 size={18} className="mr-2 animate-spin" />
              ) : (
                <Smartphone size={18} className="mr-2" />
              )}
              {loading ? t('common.loading') : t('enrollRedirect.installProfile')}
            </Button>
          )}

          {error && (
            <p className="text-sm text-danger mb-4">{error}</p>
          )}

          {downloaded && (
            <p className="text-sm text-control-label">
              {t('enrollRedirect.goToSettings')}
            </p>
          )}
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
