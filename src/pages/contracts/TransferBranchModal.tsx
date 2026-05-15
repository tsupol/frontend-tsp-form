import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Input, Modal, Select, TextArea } from 'tsp-form';
import { ArrowRight, CheckCircle, Info, XCircle } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { BranchPinInput } from '../../components/BranchPinInput';

interface ContractForTransfer {
  id: number;
  code: string;
  code_display: string | null;
  state: string;
  branch_id: number;
  device_id: number | null;
}

interface Branch {
  id: number;
  name: string;
}

interface TransferBranchResult {
  id: number;
  status: 'PENDING';
  to_branch_id: number;
  has_device: boolean;
  device_id: number | null;
  device_identifier: string | null;
  notice: string | null;
}

interface Props {
  open: boolean;
  contract: ContractForTransfer;
  onClose: () => void;
}

export function TransferBranchModal({ open, contract, onClose }: Props) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [view, setView] = useState<'form' | 'done'>('form');
  const [toBranchId, setToBranchId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [errorKey, setErrorKey] = useState(0);
  const [result, setResult] = useState<TransferBranchResult | null>(null);
  const [fromBranchName, setFromBranchName] = useState<string>('');

  useEffect(() => {
    if (open) {
      setView('form');
      setToBranchId(null);
      setReason('');
      setPin('');
      setError('');
      setResult(null);
    }
  }, [open]);

  const { data: branches } = useQuery({
    queryKey: ['branches-active'],
    queryFn: () => apiClient.get<Branch[]>('/v_branches?is_active=is.true&order=name'),
    staleTime: 5 * 60 * 1000,
    enabled: open,
  });

  // Branch options exclude the current contract branch
  const branchOptions = useMemo(() => {
    if (!branches) return [];
    return branches
      .filter(b => b.id !== contract.branch_id)
      .map(b => ({ value: String(b.id), label: b.name }));
  }, [branches, contract.branch_id]);

  // Resolve names for the done view
  const toBranchName = useMemo(() => {
    if (!result || !branches) return '';
    return branches.find(b => b.id === result.to_branch_id)?.name ?? `#${result.to_branch_id}`;
  }, [result, branches]);

  useEffect(() => {
    if (branches) {
      const fromBranch = branches.find(b => b.id === contract.branch_id);
      if (fromBranch) setFromBranchName(fromBranch.name);
    }
  }, [branches, contract.branch_id]);

  const setApiError = (err: unknown) => {
    if (err instanceof ApiError) {
      const translated =
        (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '') ||
        (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
      setError(translated || err.message);
    } else {
      setError(err instanceof Error ? err.message : String(err));
    }
    setErrorKey(k => k + 1);
  };

  const mutation = useMutation({
    mutationFn: () => apiClient.rpc<TransferBranchResult>('fn_contract_transfer_branch', {
      p_contract_id: contract.id,
      p_to_branch_id: Number(toBranchId),
      p_reason: reason.trim() || null,
      p_pin: pin,
    }),
    onSuccess: (res) => {
      setResult(res);
      setView('done');
      queryClient.invalidateQueries({ queryKey: ['contract-detail', contract.id] });
      queryClient.invalidateQueries({ queryKey: ['contract-search'] });
      queryClient.invalidateQueries({ queryKey: ['contract-actions', contract.id] });
    },
    onError: setApiError,
  });

  const canSubmit = !!toBranchId && pin.length === 6 && !mutation.isPending;

  return (
    <Modal open={open} onClose={onClose} maxWidth="28rem" width="100%">
      <div className="flex flex-col overflow-hidden">
        <div className="modal-header">
          <h2 className="modal-title">
            {view === 'done'
              ? t('contract.transferBranch_doneTitle', { defaultValue: 'Transfer initiated' })
              : t('contract.action_transfer_branch')}
          </h2>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">&times;</button>
        </div>

        {view === 'form' && (
          <>
            <div className="modal-content">
              {error && (
                <div key={errorKey} className="alert alert-danger mb-4 animate-pop-in">
                  <XCircle size={16} />
                  <span>{error}</span>
                </div>
              )}

              {/* Contract info summary */}
              <div className="mb-4 px-3 py-2.5 rounded-md bg-surface border border-line">
                <div className="font-medium text-sm">{contract.code_display ?? contract.code}</div>
                <div className="text-xs text-subtle">{contract.state} · {fromBranchName}</div>
              </div>

              <div className="form-grid">
                <div className="flex flex-col">
                  <label className="form-label">{t('contract.toBranch')} *</label>
                  <Select
                    options={branchOptions}
                    value={toBranchId}
                    onChange={(val) => setToBranchId((val as string) || null)}
                    placeholder={t('contract.selectBranch')}
                    showChevron
                    searchable
                  />
                </div>

                <div className="flex flex-col">
                  <label className="form-label">{t('contract.reason')}</label>
                  <Input
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder={t('contract.reasonPlaceholder')}
                    className="w-full"
                  />
                </div>

                <BranchPinInput value={pin} onChange={setPin} required />
              </div>

              <div className="alert alert-info mt-4">
                <Info size={16} />
                <span className="text-xs">
                  {contract.device_id != null
                    ? t('contract.transferBranch_hintWithDevice', {
                        defaultValue: 'The destination branch must accept the transfer. The bound device will follow once accepted.',
                      })
                    : t('contract.transferBranch_hintNoDevice', {
                        defaultValue: 'The destination branch must accept the transfer before it takes effect.',
                      })}
                </span>
              </div>
            </div>

            <div className="modal-footer">
              <Button onClick={onClose}>{t('common.cancel')}</Button>
              <Button
                color="primary"
                onClick={() => { setError(''); mutation.mutate(); }}
                disabled={!canSubmit}
              >
                {mutation.isPending ? t('common.loading') : t('contract.action_transfer_branch')}
              </Button>
            </div>
          </>
        )}

        {view === 'done' && result && (
          <>
            <div className="modal-content">
              <div className="flex flex-col items-center gap-2 pt-2 pb-2 text-center">
                <CheckCircle size={48} className="text-success" />
                <div className="text-lg font-semibold">
                  {t('contract.transferBranch_doneHeadline', { defaultValue: 'Transfer initiated' })}
                </div>
                <div className="text-sm text-subtle">{contract.code_display ?? contract.code}</div>
              </div>

              {/* Branch transition: from → to (PENDING) */}
              <div className="mt-3 flex items-center justify-center gap-2 flex-wrap">
                <Badge color="info" size="sm">{fromBranchName || `#${contract.branch_id}`}</Badge>
                <ArrowRight size={14} className="text-subtle" />
                <Badge color="warning" size="sm">
                  {toBranchName} · {t('contract.transferBranch_donePending', { defaultValue: 'Pending' })}
                </Badge>
              </div>

              {/* Device follow notice — server-supplied (Thai) */}
              {result.notice && (
                <div className="mt-4 px-3 py-2.5 rounded-md bg-info/5 border border-info/20 text-sm">
                  {result.notice}
                </div>
              )}
              {!result.notice && result.has_device && result.device_identifier && (
                <div className="mt-4 px-3 py-2.5 rounded-md bg-info/5 border border-info/20 text-sm">
                  {t('contract.transferBranch_doneDeviceWillFollow', {
                    device: result.device_identifier,
                    branch: toBranchName,
                    defaultValue: 'Device {{device}} will move to {{branch}} on acceptance.',
                  })}
                </div>
              )}

              {/* Next-step hint */}
              <div className="mt-3 alert alert-warning">
                <Info size={16} />
                <span className="text-xs">
                  {t('contract.transferBranch_doneNextStep', {
                    branch: toBranchName,
                    defaultValue: 'Staff at {{branch}} must accept this transfer. Until then, the contract stays editable here.',
                  })}
                </span>
              </div>
            </div>

            <div className="modal-footer">
              <Button color="primary" onClick={onClose}>
                {t('common.done', { defaultValue: 'Done' })}
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
