import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/AuthContext';
import { authService } from '../lib/auth';
import type { HoldingOption } from '../lib/auth';
import { LanguageSwitcher } from '../components/LanguageSwitcher';

export function HoldingSelectPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { switchHolding } = useAuth();
  const [holdings, setHoldings] = useState<HoldingOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [switching, setSwitching] = useState<number | null>(null);

  useEffect(() => {
    const fetchHoldings = async () => {
      try {
        const result = await authService.listHoldingsForContext();
        setHoldings(result.holdings);
      } catch {
        setError(t('common.error'));
      } finally {
        setIsLoading(false);
      }
    };
    fetchHoldings();
  }, [t]);

  const handleSelect = async (holdingId: number) => {
    setSwitching(holdingId);
    setError('');
    try {
      await switchHolding(holdingId);
      navigate('/admin');
    } catch {
      setError(t('common.error'));
      setSwitching(null);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg">
      <div className="w-full max-w-md p-card">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="heading-1">{t('holding.selectTitle')}</h1>
            <p className="text-sm text-fg/60 mt-1">{t('holding.selectDescription')}</p>
          </div>
          <LanguageSwitcher />
        </div>

        {error && (
          <div className="mb-4 p-3 bg-danger/10 border border-danger/30 rounded text-sm text-danger">
            {error}
          </div>
        )}

        {isLoading ? (
          <div className="text-center text-fg/50 py-8">{t('holding.loading')}</div>
        ) : (
          <div className="grid gap-3">
            {holdings.map((holding) => (
              <button
                key={holding.holding_id}
                onClick={() => handleSelect(holding.holding_id)}
                disabled={switching !== null}
                className="w-full text-left p-4 rounded border border-border hover:border-primary hover:bg-primary/5 transition-colors disabled:opacity-50 cursor-pointer"
              >
                <div className="font-medium">{holding.name}</div>
                <div className="text-sm text-fg/60">{holding.code}</div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
