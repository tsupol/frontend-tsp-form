import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Button, Modal, Select, TextArea } from 'tsp-form';
import { XCircle } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { ActionDoneView } from './ActionDoneView';
import { useContractInvalidate } from './useContractInvalidate';

interface LoanerAssetOption {
  asset_id: number;
  asset_code: string;
  model_name: string;
  variant_name: string;
}

function setApiError(
  err: unknown,
  t: ReturnType<typeof useTranslation>['t'],
  setError: (s: string) => void,
) {
  if (err instanceof ApiError) {
    const translated = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
      || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
    setError(translated || err.message);
  } else {
    setError(err instanceof Error ? err.message : String(err));
  }
}

// ── Bind Loaner ──────────────────────────────────────────────────────────────
//
// Backend: fn_contract_bind_loaner(p_contract_id, p_loaner_asset_id, p_note?)
// Guard: loaner asset must be current_bucket=LOANED_OUT and same branch.
//        (Asset is moved to LOANED_OUT via fn_inv_repair_request first.)

export function BindLoanerModal({
  open, onClose, onSuccess,
  contractId, branchId,
  presetLoanerAssetId,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: (msgKey: string) => void;
  contractId: number;
  branchId: number;
  /** If set, lock the loaner to this asset (entry from AssetsPage) */
  presetLoanerAssetId?: number;
}) {
  const { t } = useTranslation();
  const [loanerAssetId, setLoanerAssetId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setLoanerAssetId(presetLoanerAssetId ? String(presetLoanerAssetId) : null);
      setNote('');
      setError('');
    }
  }, [open, presetLoanerAssetId]);

  const { data: assets = [] } = useQuery({
    queryKey: ['loaner-assets-available', branchId],
    queryFn: () => {
      const params = new URLSearchParams({
        current_bucket: 'eq.LOANED_OUT',
        branch_id: `eq.${branchId}`,
        order: 'asset_code',
        limit: '100',
      });
      return apiClient.get<LoanerAssetOption[]>(`/v_assets?${params.toString()}`);
    },
    staleTime: 60 * 1000,
    enabled: open && !presetLoanerAssetId,
  });

  const options = useMemo(
    () => assets.map(a => ({
      value: String(a.asset_id),
      label: `${a.asset_code} — ${a.model_name} ${a.variant_name}`,
    })),
    [assets],
  );

  const mutation = useMutation({
    mutationFn: () => apiClient.rpc('fn_contract_bind_loaner', {
      p_contract_id: contractId,
      p_loaner_asset_id: Number(loanerAssetId),
      p_note: note.trim() || undefined,
    }),
    onSuccess: () => onSuccess('contract.action_bind_loaner_success'),
    onError: (err) => setApiError(err, t, setError),
  });

  const canSubmit = !!loanerAssetId && !mutation.isPending;

  return (
    <Modal open={open} onClose={onClose} maxWidth="28rem" width="100%">
      <div className="flex flex-col overflow-hidden">
        <div className="modal-header">
          <h2 className="modal-title">{t('contract.action_bind_loaner')}</h2>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">&times;</button>
        </div>
        <div className="modal-content">
          {error && (
            <div className="alert alert-danger mb-4 animate-pop-in">
              <XCircle size={16} />
              <span>{error}</span>
            </div>
          )}

          <div className="form-grid">
            {!presetLoanerAssetId && (
              <div className="flex flex-col min-w-0">
                <label className="form-label">{t('contract.bindLoaner_selectLoaner')} *</label>
                <Select
                  options={options}
                  value={loanerAssetId}
                  onChange={(v) => setLoanerAssetId((v as string) || null)}
                  placeholder={t('contract.bindLoaner_selectLoaner')}
                  showChevron
                  searchable
                />
                <div className="text-xs text-subtle mt-1">{t('contract.bindLoaner_hint')}</div>
              </div>
            )}

            <div className="flex flex-col">
              <label className="form-label">{t('contract.note')}</label>
              <TextArea value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            color="primary"
            onClick={() => mutation.mutate()}
            disabled={!canSubmit}
          >
            {mutation.isPending ? t('common.loading') : t('contract.action_bind_loaner')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Unbind Loaner ────────────────────────────────────────────────────────────
//
// Backend: fn_contract_unbind_loaner(p_contract_id, p_note?)
// Note: loaner asset stays in LOANED_OUT bucket until fn_inv_repair_route
//       returns it to ON_HAND_AVAILABLE (RETURN) or WITH_CUSTOMER_ACTIVE (SWAP).

interface UnbindLoanerResult {
  contract_id: number;
  loaner_device_id: number;
  unbound: boolean;
}

export function UnbindLoanerModal({
  open, onClose, onSuccess: _onSuccess,
  contractId,
  loanerAssetCode,
}: {
  open: boolean;
  onClose: () => void;
  /** Parent's onSuccess (snackbar+close) — unused now; done view replaces it. Kept for prop-shape parity. */
  onSuccess: (msgKey: string) => void;
  contractId: number;
  loanerAssetCode?: string | null;
}) {
  const { t } = useTranslation();
  const invalidate = useContractInvalidate(contractId);
  const [view, setView] = useState<'form' | 'done'>('form');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<UnbindLoanerResult | null>(null);

  useEffect(() => {
    if (open) {
      setView('form');
      setNote('');
      setError('');
      setResult(null);
    }
  }, [open]);

  const mutation = useMutation({
    mutationFn: () => apiClient.rpc<UnbindLoanerResult>('fn_contract_unbind_loaner', {
      p_contract_id: contractId,
      p_note: note.trim() || undefined,
    }),
    onSuccess: (res) => {
      setResult(res);
      setView('done');
      invalidate();
    },
    onError: (err) => setApiError(err, t, setError),
  });

  return (
    <Modal open={open} onClose={onClose} maxWidth="28rem" width="100%">
      <div className="flex flex-col overflow-hidden">
        <div className="modal-header">
          <h2 className="modal-title">
            {view === 'done'
              ? t('contract.action_unbind_loaner_done_title', { defaultValue: 'Loaner returned' })
              : t('contract.action_unbind_loaner')}
          </h2>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">&times;</button>
        </div>

        {view === 'form' && (
          <>
            <div className="modal-content">
              {error && (
                <div className="alert alert-danger mb-4 animate-pop-in">
                  <XCircle size={16} />
                  <span>{error}</span>
                </div>
              )}

              {loanerAssetCode && (
                <div className="mb-4 px-3 py-2.5 rounded-md bg-surface border border-line">
                  <div className="text-xs text-subtle">{t('contract.bindLoaner_currentLoaner')}</div>
                  <div className="font-medium text-sm">{loanerAssetCode}</div>
                </div>
              )}

              <div className="form-grid">
                <div className="flex flex-col">
                  <label className="form-label">{t('contract.note')}</label>
                  <TextArea value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <Button onClick={onClose}>{t('common.cancel')}</Button>
              <Button
                color="danger"
                onClick={() => mutation.mutate()}
                disabled={mutation.isPending}
              >
                {mutation.isPending ? t('common.loading') : t('contract.action_unbind_loaner')}
              </Button>
            </div>
          </>
        )}

        {view === 'done' && result && (
          <ActionDoneView
            headline={t('contract.action_unbind_loaner_done_headline', { defaultValue: 'Loaner returned' })}
            contractCode={loanerAssetCode ?? `loaner #${result.loaner_device_id}`}
            tone="neutral"
            detailRows={[
              {
                label: t('contract.action_unbind_loaner_done_returned', { defaultValue: 'Returned to inventory' }),
                value: loanerAssetCode ?? `#${result.loaner_device_id}`,
              },
            ]}
            onClose={onClose}
          />
        )}
      </div>
    </Modal>
  );
}
