import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from 'tsp-form';
import { useRegister } from './RegisterLayout';

export function Step2Scan() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data, setStatus } = useRegister();

  const handleConfirmScan = () => {
    setStatus('pending');
    navigate('/admin/register/status');
  };

  return (
    <div className="space-y-6">
      <div className="border border-line bg-surface p-6 rounded-lg text-center">
        <h2 className="font-semibold mb-4">{t('register.scanTitle')}</h2>

        {/* QR Code Placeholder */}
        <div className="inline-flex items-center justify-center w-48 h-48 bg-white border-2 border-line rounded-lg mb-4">
          <div className="text-center p-4">
            <div className="grid grid-cols-5 gap-1">
              {Array.from({ length: 25 }).map((_, i) => (
                <div
                  key={i}
                  className={`w-6 h-6 ${Math.random() > 0.5 ? 'bg-black' : 'bg-white'}`}
                />
              ))}
            </div>
          </div>
        </div>

        <p className="text-sm text-control-label">
          {t('register.scanDescription')}
        </p>
      </div>

      {/* Device Summary */}
      <div className="border border-line bg-surface-shallow p-4 rounded-lg text-sm">
        <div className="space-y-2">
          <div className="flex justify-between">
            <span className="text-control-label">{t('device.serial')}:</span>
            <span className="font-mono">{data.serial}</span>
          </div>
          {data.imei && (
            <div className="flex justify-between">
              <span className="text-control-label">{t('device.imei')}:</span>
              <span className="font-mono">{data.imei}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-control-label">{t('register.deviceType')}:</span>
            <span>{t(data.deviceType === 'with-sim' ? 'register.withSim' : 'register.withoutSim')}</span>
          </div>
        </div>
      </div>

      <div className="flex gap-3">
        <Button
          type="button"
          variant="outline"
          className="flex-1"
          onClick={() => navigate('/admin/register')}
        >
          {t('register.back')}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="flex-1"
          onClick={handleConfirmScan}
        >
          {t('register.confirmScan')}
        </Button>
      </div>
    </div>
  );
}
