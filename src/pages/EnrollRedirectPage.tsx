import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from 'tsp-form';
import { Smartphone, AlertCircle, CheckCircle, ExternalLink, Loader2 } from 'lucide-react';
import { apiClient } from '../lib/api';

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
  const result = await apiClient.rpc<string>('mdm_enrollment_mobileconfig', {
    p_enrollment_id: enrollmentId,
  }, false);

  if (!result) {
    throw new Error('No mobileconfig in response');
  }
  return result;
}

function downloadMobileconfig(xmlContent: string) {
  // iOS Safari requires data URL for mobileconfig installation
  // Blob URLs don't work properly for profile installation
  const base64 = btoa(unescape(encodeURIComponent(xmlContent)));
  const dataUrl = `data:application/x-apple-aspen-config;base64,${base64}`;

  // Navigate to data URL - iOS will prompt to install profile
  window.location.href = dataUrl;
}

// Hardcoded test mobileconfig for debugging
const TEST_MOBILECONFIG_2 = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
<key>PayloadContent</key>
<array>
<dict>
<key>PayloadContent</key>
<dict>
<key>Key Type</key>
<string>RSA</string>
<key>Challenge</key>
<string>b259c0b225b6</string>
<key>Key Usage</key>
<integer>5</integer>
<key>Keysize</key>
<integer>2048</integer>
<key>URL</key>
<string>https://codezaptech.co.th/mdm/scep</string>
</dict>
<key>PayloadIdentifier</key>
<string>com.github.micromdm.scep</string>
<key>PayloadType</key>
<string>com.apple.security.scep</string>
<key>PayloadUUID</key>
<string>CB90E976-AD44-4B69-8108-8095E6260978</string>
<key>PayloadVersion</key>
<integer>1</integer>
</dict>
<dict>
<key>AccessRights</key>
<integer>8191</integer>
<key>CheckOutWhenRemoved</key>
<true/>
<key>IdentityCertificateUUID</key>
<string>CB90E976-AD44-4B69-8108-8095E6260978</string>
<key>PayloadIdentifier</key>
<string>com.github.micromdm.nanomdm.mdm</string>
<key>PayloadType</key>
<string>com.apple.mdm</string>
<key>PayloadUUID</key>
<string>96B11019-B54C-49DC-9480-43525834DE7B</string>
<key>PayloadVersion</key>
<integer>1</integer>
<key>ServerCapabilities</key>
<array>
<string>com.apple.mdm.per-user-connections</string>
<string>com.apple.mdm.bootstraptoken</string>
<string>com.apple.mdm.token</string>
</array>
<key>ServerURL</key>
<string>https://codezaptech.co.th/mdm</string>
<key>CheckInURL</key>
<string>https://codezaptech.co.th/mdm/checkin</string>
<key>SignMessage</key>
<true/>
<key>Topic</key>
<string>com.apple.mgmt.External.cbac6415-cf4c-4df6-b21c-8a3426624c8b</string>
</dict>
</array>
<key>PayloadDisplayName</key>
<string>Enrollment Profile</string>
<key>PayloadIdentifier</key>
<string>com.github.micromdm.nanomdm</string>
<key>PayloadType</key>
<string>Configuration</string>
<key>PayloadUUID</key>
<string>F9760DD4-F2D1-4F29-8D2C-48D52DD0A9B3</string>
<key>PayloadVersion</key>
<integer>1</integer>
</dict>
</plist>`;

const TEST_MOBILECONFIG = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadDisplayName</key><string>CodeZapTech MDM Enrollment</string>
  <key>PayloadIdentifier</key><string>co.th.codezaptech.mdm.enroll</string>
  <key>PayloadType</key><string>Configuration</string>
  <key>PayloadUUID</key><string>68b76a13-dca8-4207-817d-3d5192769fbf</string>
  <key>PayloadVersion</key><integer>1</integer>
  <key>PayloadContent</key>
  <array>
    <!-- SCEP: issue device identity cert -->
    <dict>
      <key>PayloadType</key><string>com.apple.security.scep</string>
      <key>PayloadVersion</key><integer>1</integer>
      <key>PayloadIdentifier</key><string>co.th.codezaptech.scep.identity</string>
      <key>PayloadUUID</key><string>0c123f82-381e-41e1-8213-606a8b5aafa9</string>
      <key>PayloadDisplayName</key><string>Device Identity (SCEP)</string>
      <key>PayloadContent</key>
      <dict>
        <key>URL</key><string>https://codezaptech.co.th/mdm/scep</string>
        <key>Name</key><string>Device Identity (SCEP)</string>
        <key>Challenge</key><string>b259c0b225b6</string>
        <key>Key Type</key><string>RSA</string>
        <key>Keysize</key><integer>2048</integer>
        <key>Retries</key><integer>3</integer>
        <key>Subject</key>
        <array>
          <array><string>CN</string><string>$DeviceName</string></array>
        </array>
      </dict>
    </dict>
    <!-- MDM -->
    <dict>
      <key>PayloadType</key><string>com.apple.mdm</string>
      <key>PayloadVersion</key><integer>1</integer>
      <key>PayloadIdentifier</key><string>co.th.codezaptech.mdm</string>
      <key>PayloadUUID</key><string>6040250f-60dd-4058-a98d-8ed43115036a</string>
      <key>PayloadDisplayName</key><string>CodeZapTech MDM</string>
      <key>Topic</key><string>com.apple.mgmt.External.cbac6415-cf4c-4df6-b21c-8a3426624c8b</string>
      <key>ServerURL</key><string>https://codezaptech.co.th/mdm/connect</string>
      <key>CheckInURL</key><string>https://codezaptech.co.th/mdm/checkin</string>
      <key>AccessRights</key><integer>8191</integer>
      <key>SignMessage</key><true/>
      <key>CheckOutWhenRemoved</key><true/>
      <key>IdentityCertificateUUID</key><string>0c123f82-381e-41e1-8213-606a8b5aafa9</string>
    </dict>
  </array>
</dict>
</plist>`;

export function EnrollRedirectPage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();

  const enrollmentId = searchParams.get('id');

  const [deviceType, setDeviceType] = useState<DeviceType>(detectDevice);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloaded, setDownloaded] = useState(false);
  const [debugContent, setDebugContent] = useState<string | null>(null);

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
      downloadMobileconfig(mobileconfig);
      setDownloaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const handleViewContent = async () => {
    if (!enrollmentId) return;

    setLoading(true);
    setError(null);

    try {
      const mobileconfig = await fetchMobileconfig(enrollmentId);
      setDebugContent(mobileconfig);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const handleTestDownload = () => {
    downloadMobileconfig(TEST_MOBILECONFIG);
  };

  const handleTestDownload2 = () => {
    downloadMobileconfig(TEST_MOBILECONFIG_2);
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
            <div className="space-y-2 mb-4">
              <Button
                variant="outline"
                className="w-full"
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
              <Button
                variant="outline"
                className="w-full text-xs"
                onClick={handleViewContent}
                disabled={loading}
              >
                View Content
              </Button>
              <Button
                variant="outline"
                className="w-full text-xs"
                onClick={handleTestDownload}
              >
                Test 1 (my format)
              </Button>
              <Button
                variant="outline"
                className="w-full text-xs"
                onClick={handleTestDownload2}
              >
                Test 2 (micromdm format)
              </Button>
            </div>
          )}

          {error && (
            <p className="text-sm text-danger mb-4">{error}</p>
          )}

          {downloaded && (
            <p className="text-sm text-control-label">
              {t('enrollRedirect.goToSettings')}
            </p>
          )}

          {/* Debug section */}
          {debugContent && (
            <div className="mt-6 text-left">
              <p className="text-xs font-semibold mb-2">Debug: mobileconfig content</p>
              <pre className="text-xs bg-surface border border-line rounded p-2 overflow-auto max-h-64 whitespace-pre-wrap break-all">
                {debugContent}
              </pre>
            </div>
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
