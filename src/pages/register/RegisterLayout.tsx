import { createContext, useContext, useState, useEffect } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ProgressBar } from 'tsp-form';

export interface RegistrationData {
  deviceType: 'with-sim' | 'without-sim';
  imei: string;
  serial: string;
  registrationId?: string;
}

interface RegisterContextType {
  data: RegistrationData;
  updateData: (updates: Partial<RegistrationData>) => void;
  resetData: () => void;
  status: 'pending' | 'success' | 'failed' | null;
  setStatus: (status: 'pending' | 'success' | 'failed' | null) => void;
}

const defaultData: RegistrationData = {
  deviceType: 'with-sim',
  imei: '',
  serial: '',
};

const RegisterContext = createContext<RegisterContextType | undefined>(undefined);

export function useRegister() {
  const context = useContext(RegisterContext);
  if (!context) {
    throw new Error('useRegister must be used within RegisterLayout');
  }
  return context;
}

const STEPS = [
  { path: '/admin/register', step: 1 },
  { path: '/admin/register/scan', step: 2 },
  { path: '/admin/register/status', step: 3 },
];

export function RegisterLayout() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const [data, setData] = useState<RegistrationData>(defaultData);
  const [status, setStatus] = useState<'pending' | 'success' | 'failed' | null>(null);

  const currentStep = STEPS.find(s => s.path === location.pathname)?.step ?? 1;
  const progress = (currentStep / STEPS.length) * 100;

  const updateData = (updates: Partial<RegistrationData>) => {
    setData(prev => ({ ...prev, ...updates }));
  };

  const resetData = () => {
    setData(defaultData);
    setStatus(null);
  };

  // Redirect to step 1 if accessing later steps without data
  useEffect(() => {
    if (currentStep > 1 && !data.serial) {
      navigate('/admin/register', { replace: true });
    }
  }, [currentStep, data.serial, navigate]);

  return (
    <RegisterContext.Provider value={{ data, updateData, resetData, status, setStatus }}>
      <div className="page-content p-6 h-full overflow-y-auto">
        <div className="max-w-lg mx-auto">
          <h1 className="text-xl font-bold mb-2">{t('register.title')}</h1>
          <div className="text-sm text-control-label mb-4">
            {t('register.step', { current: currentStep, total: STEPS.length })}
          </div>
          <ProgressBar value={progress} className="mb-6" />
          <Outlet />
        </div>
      </div>
    </RegisterContext.Provider>
  );
}
