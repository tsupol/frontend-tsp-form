import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from 'tsp-form';
import { QRCodeSVG } from 'qrcode.react';
import { Clock, RefreshCw } from 'lucide-react';
import { apiClient } from '../lib/api';

const ENROLL_BASE_URL = 'https://frontend-tsp-form.ecap.space/enroll';

interface EnrollmentResult {
  enrollment_id: string;
  expires_at: string;
  provider_profile_id: number;
}

export function EnrollmentPage() {
  const { t } = useTranslation();

  const [enrollment, setEnrollment] = useState<EnrollmentResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timeRemaining, setTimeRemaining] = useState<string>('');

  const fetchEnrollment = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiClient.rpc<EnrollmentResult[]>('mdm_enrollment_issue_v2', {});
      setEnrollment(result[0]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate enrollment');
    } finally {
      setLoading(false);
    }
  };

  // Fetch on mount
  useEffect(() => {
    fetchEnrollment();
  }, []);

  // Countdown timer
  useEffect(() => {
    if (!enrollment) return;

    const updateTimer = () => {
      const expires = new Date(enrollment.expires_at).getTime();
      const now = Date.now();
      const diff = expires - now;

      if (diff <= 0) {
        setTimeRemaining(t('enrollment.expired'));
        return;
      }

      const minutes = Math.floor(diff / 60000);
      const seconds = Math.floor((diff % 60000) / 1000);
      setTimeRemaining(`${minutes}:${seconds.toString().padStart(2, '0')}`);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [enrollment, t]);

  return (
    <div className="page-content p-6">
      <div className="max-w-lg mx-auto">
        <h1 className="text-xl font-bold mb-6">{t('enrollment.title')}</h1>

        <div className="border border-line bg-surface p-6 rounded-lg text-center">
          {loading && (
            <div className="py-12">
              <div className="text-control-label">{t('common.loading')}</div>
            </div>
          )}

          {error && (
            <div className="py-12">
              <div className="text-danger mb-4">{error}</div>
              <Button variant="outline" onClick={fetchEnrollment}>
                {t('common.retry')}
              </Button>
            </div>
          )}

          {enrollment && !loading && (
            <>
              <h2 className="font-semibold mb-4">{t('enrollment.scanTitle')}</h2>

              {/* QR Code */}
              <div className="inline-flex items-center justify-center w-48 h-48 bg-white border-2 border-line rounded-lg mb-4 p-2">
                <QRCodeSVG
                  value={`${ENROLL_BASE_URL}?id=${enrollment.enrollment_id}`}
                  size={176}
                  level="M"
                />
              </div>

              <p className="text-sm text-control-label mb-4">
                {t('enrollment.scanDescription')}
              </p>

              {/* Timer */}
              <div className="flex items-center justify-center gap-2 text-sm mb-4">
                <Clock size={16} className="text-control-label" />
                <span className="text-control-label">{t('enrollment.expiresIn')}:</span>
                <span className="font-mono font-semibold">{timeRemaining}</span>
              </div>

              {/* Refresh */}
              <Button
                variant="outline"
                onClick={fetchEnrollment}
                disabled={loading}
              >
                <RefreshCw size={16} className="mr-2" />
                {t('enrollment.refresh')}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
