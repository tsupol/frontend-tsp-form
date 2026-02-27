import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Modal } from 'tsp-form';
import { useAuth } from '../contexts/AuthContext';
import { authService } from '../lib/auth';
import type { HoldingOption } from '../lib/auth';

interface HoldingSelectModalProps {
  open: boolean;
}

export function HoldingSelectModal({ open }: HoldingSelectModalProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { switchHolding } = useAuth();
  const [holdings, setHoldings] = useState<HoldingOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setIsLoading(true);
    setError('');
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
  }, [open, t]);

  const handleSelect = async (holdingId: number) => {
    try {
      await switchHolding(holdingId);
      navigate('/admin');
    } catch {
      setError(t('common.error'));
    }
  };

  return (
    <Modal open={open} maxWidth="400px" ariaLabel={t('holding.selectTitle')}>
      <div className="modal-header">
        <h2 className="modal-title">{t('holding.selectTitle')}</h2>
      </div>
      <div className="modal-content">
        <p className="text-sm text-fg/60 mb-4">{t('holding.selectDescription')}</p>

        {error && (
          <div className="alert alert-danger mb-4">{error}</div>
        )}

        {isLoading ? (
          <div className="text-center text-fg/50 py-8">{t('holding.loading')}</div>
        ) : (
          <div className="grid gap-3">
            {holdings.map((holding) => (
              <button
                key={holding.holding_id}
                onClick={() => handleSelect(holding.holding_id)}
                className="w-full text-left p-4 rounded border border-border hover:border-primary hover:bg-primary/5 transition-colors cursor-pointer"
              >
                <div className="font-medium">{holding.name}</div>
                <div className="text-sm text-fg/60">{holding.code}</div>
              </button>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
