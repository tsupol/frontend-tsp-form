import { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { MaskedInput } from 'tsp-form';
import { Shield, Loader2, Check, XCircle, Info } from 'lucide-react';
import { apiClient, ApiError } from '../../../lib/api';
import { useWorkspace } from './WorkspaceContext';

interface Props { onClose: () => void }

export function PanelInsurance({ onClose: _onClose }: Props) {
  const { t } = useTranslation();
  const { data, contract, invalidateContract, isReadOnly, isFinancialLocked } = useWorkspace();

  const isFin2 = contract?.commercial_model === 'FIN2';
  const current = contract?.insurance_deposit ?? 0;

  const [value, setValue] = useState(String(current || ''));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const lastSavedRef = useRef(current);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const savedTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    // Sync local input when server value changes externally
    if (current !== lastSavedRef.current) {
      lastSavedRef.current = current;
      setValue(String(current || ''));
    }
  }, [current]);

  const save = useCallback(async (amount: number) => {
    if (!data.contractId || amount === lastSavedRef.current) return;
    setSaving(true);
    setError('');
    try {
      await apiClient.rpc('fn_contract_set_insurance_deposit', {
        p_contract_id: data.contractId,
        p_amount: amount,
      });
      lastSavedRef.current = amount;
      invalidateContract();
      setSaved(true);
      clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      if (err instanceof ApiError) {
        const tr = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
          || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
        setError(tr || err.message);
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setSaving(false);
    }
  }, [data.contractId, invalidateContract, t]);

  const handleChange = (raw: string) => {
    setValue(raw);
    const amount = parseFloat(raw) || 0;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => save(amount), 1000);
  };

  useEffect(() => {
    return () => { clearTimeout(saveTimer.current); clearTimeout(savedTimer.current); };
  }, []);

  const disabled = isReadOnly || isFinancialLocked || !data.contractId;
  const downPayment = contract?.down_payment ?? 0;
  const showZeroDownNote = isFin2 && downPayment === 0;

  return (
    <div className="p-4 flex flex-col gap-3">
      <div className={`rounded-lg px-4 py-3 border ${current > 0 ? 'border-info/30 bg-info/5' : 'border-line bg-surface'}`}>
        <div className="text-xs text-subtle mb-1">{t('workspace.insuranceAmount')}</div>
        <div className="flex items-center gap-2">
          <Shield size={18} className={current > 0 ? 'text-info' : 'text-fg/30'} />
          <span className="text-xl font-semibold tabular-nums">
            {current > 0 ? current.toLocaleString() : '0'}
          </span>
        </div>
      </div>

      <div className="alert alert-info">
        <Info size={16} />
        <div>
          <div className="alert-description">{t('workspace.insuranceHint')}</div>
        </div>
      </div>

      {!isFin2 ? (
        <div className="alert alert-info">
          <Info size={16} />
          <div>
            <div className="alert-description">{t('workspace.insuranceFin1Only')}</div>
          </div>
        </div>
      ) : (
        <>
          {showZeroDownNote && (
            <div className="alert alert-info">
              <Info size={16} />
              <div>
                <div className="alert-description">{t('workspace.insuranceZeroDownNote')}</div>
              </div>
            </div>
          )}

          {error && (
            <div className="alert alert-danger">
              <XCircle size={16} />
              <span>{error}</span>
            </div>
          )}

          <div className="flex flex-col">
            <label className="form-label">{t('workspace.insuranceAmount')}</label>
            <MaskedInput
              mask="number"
              decimalScale={2}
              value={value}
              onChange={handleChange}
              size="sm"
              className="w-full"
              placeholder="0"
              disabled={disabled}
              endIcon={saving ? <Loader2 size={14} className="animate-spin text-subtle" /> : saved ? <Check size={14} className="text-success" /> : undefined}
            />
          </div>

          {!data.contractId && (
            <div className="text-sm text-subtle">{t('workspace.insuranceNeedDraft')}</div>
          )}
        </>
      )}
    </div>
  );
}
