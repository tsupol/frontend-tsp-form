import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button, Skeleton } from 'tsp-form';
import { CheckCircle, XCircle, Clock } from 'lucide-react';
import { useRegister } from './RegisterLayout';

export function Step3Status() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { status, setStatus, resetData } = useRegister();

  // Mock: Wait 15 seconds then set success
  useEffect(() => {
    if (status === 'pending') {
      const timer = setTimeout(() => {
        setStatus('success');
      }, 8000);
      return () => clearTimeout(timer);
    }
  }, [status, setStatus]);

  const handleBackToHome = () => {
    resetData();
    navigate('/admin');
  };

  const handleNewRegistration = () => {
    resetData();
    navigate('/admin/register');
  };

  // Loading state
  if (status === 'pending' || status === null) {
    return (
      <div className="space-y-6">
        <div className="border border-line bg-surface p-8 rounded-lg text-center">
          <div className="flex justify-center mb-6">
            <Skeleton variant="circular" width={80} height={80} />
          </div>
          <Skeleton variant="text" width="60%" height={24} className="mx-auto mb-2" />
          <Skeleton variant="text" width="80%" height={16} className="mx-auto" />
        </div>

        <div className="text-center text-sm text-control-label">
          <Clock size={16} className="inline mr-2" />
          {t('register.processing')}
        </div>
      </div>
    );
  }

  // Status display
  const statusConfig = {
    success: {
      icon: <CheckCircle size={80} className="text-success" />,
      title: t('register.successTitle'),
      description: t('register.successDescription'),
    },
    failed: {
      icon: <XCircle size={80} className="text-danger" />,
      title: t('register.failedTitle'),
      description: t('register.failedDescription'),
    },
  };

  const config = statusConfig[status];

  return (
    <div className="space-y-6">
      <div className="border border-line bg-surface p-8 rounded-lg text-center">
        <div className="flex justify-center mb-6">
          {config.icon}
        </div>
        <h2 className="text-xl font-semibold mb-2">{config.title}</h2>
        <p className="text-control-label">{config.description}</p>
      </div>

      <div className="flex gap-3">
        <Button
          type="button"
          variant="outline"
          className="flex-1"
          onClick={handleBackToHome}
        >
          {t('register.backToHome')}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="flex-1"
          onClick={handleNewRegistration}
        >
          {t('register.newRegistration')}
        </Button>
      </div>
    </div>
  );
}
