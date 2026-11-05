// "เมนู iCloud" on the contract's device tab (UI_SUMMARY 160, nnf-mdm mig 425, nnf
// mig 1622). Says whether the customer's Apple ID menu is greyed out now, why, and
// from how many paid installments it opens; the branch manager can set a
// per-contract "grey until N installments" flag.
//
// Drawn from the eight icloud_lock_* columns the contract row already carries —
// every number and the verdict come from the backend, nothing is worked out here.
// The history and the facts about the phone are read only when someone opens them.

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Input, MaskedInput, Modal } from 'tsp-form';
import { Cloud, Flag, FlagOff, History, Loader2, Pencil, XCircle } from 'lucide-react';
import { apiClient } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import { useAuth } from '../../contexts/AuthContext';
import { DateTime } from '../../components/DateTime';
import { ModalErrorBand } from '../../components/ModalErrorBand';
import { ActionDoneView } from './ActionDoneView';

export interface ContractIcloudLockFields {
  // Absent on the shop's contract view, by design.
  icloud_lock_until_paid?: number | null;
  icloud_lock_source?: 'OFF' | 'COMPANY' | 'CONTRACT' | 'DEVICE_ALLOWANCE' | string;
  icloud_locked_now?: boolean | null;
  icloud_lock_override_until_paid?: number | null;
  icloud_lock_override_reason?: string | null;
  icloud_lock_set_by_username?: string | null;
  icloud_lock_set_at?: string | null;
  icloud_lock_may_set?: boolean;
  paid_installment_count?: number | null;
  total_installments?: number | null;
  code?: string;
  code_display?: string | null;
  device_id?: number | null;
}

interface LockState {
  contract: { id: number; code: string; state: string; paid_count: number; total_installments: number };
  company_until_paid: number | null;
  effective_until_paid: number | null;
  effective_source: string;
  new_phone_cutoff_applies: boolean;
  override: { until_paid_count: number; reason: string; set_by_username: string; set_at: string } | null;
  device: {
    asset_id: number;
    logged_in: boolean;
    nnf_app_present: boolean;
    preset_expected: string | null;
    preset_observed: string | null;
    device_exempt_flags: string[];
    locked_now: boolean;
  } | null;
  may_set: boolean;
  history: {
    id: number;
    until_paid_count: number;
    reason: string;
    set_by_username: string | null;
    set_at: string;
    cleared_at: string | null;
    cleared_by_username: string | null;
    clear_reason: string | null;
    is_active: boolean;
  }[];
  changed?: boolean;
}

export function IcloudLockBox({ contract }: { contract: ContractIcloudLockFields & { id: number } }) {
  const { t } = useTranslation();
  const { isReadOnlyViewer } = useAuth();
  const [dialog, setDialog] = useState<'set' | 'clear' | null>(null);
  const lastDialog = useRef<'set' | 'clear'>('set');
  if (dialog) lastDialog.current = dialog;
  const [historyOpen, setHistoryOpen] = useState(false);

  const source = contract.icloud_lock_source;
  const until = contract.icloud_lock_until_paid ?? null;
  const overrideN = contract.icloud_lock_override_until_paid ?? null;
  const lockedNow = contract.icloud_locked_now;
  const maySet = contract.icloud_lock_may_set === true && !isReadOnlyViewer;
  const paid = contract.paid_installment_count ?? 0;
  // No verdict has two causes: no phone on the contract, or a phone MDM does not
  // manage yet (doc 160 only names the first). The contract row tells them apart.
  const noVerdictLabel = contract.device_id != null ? t('icloudLock.notInMdm') : t('icloudLock.noDevice');
  const noVerdictHint = contract.device_id != null ? t('icloudLock.notInMdmHint') : t('icloudLock.noDeviceHint');

  const rule =
    source === 'OFF' ? (overrideN != null ? t('icloudLock.ruleOffWithFlag') : t('icloudLock.ruleOff'))
    : source === 'DEVICE_ALLOWANCE' ? t('icloudLock.ruleDeviceAllowance')
    : source === 'CONTRACT'
      ? (until === 0 ? t('icloudLock.ruleContractOff') : t('icloudLock.ruleContract', { n: until, paid }))
    : until === 0 ? t('icloudLock.ruleCompanyZero')
    : t('icloudLock.ruleCompany', { n: until, paid });

  return (
    <section className="border border-line rounded-md" data-testid="icloud-lock-box">
      <header className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-line">
        <div className="flex items-center gap-2">
          <Cloud size={16} className="text-subtle" />
          <h3 className="text-sm font-semibold">{t('icloudLock.title')}</h3>
        </div>
        {lockedNow == null ? (
          <Badge size="xs" color="default">{noVerdictLabel}</Badge>
        ) : (
          <Badge size="xs" color={lockedNow ? 'warning' : 'success'}>
            {lockedNow ? t('icloudLock.stateGrey') : t('icloudLock.stateOpen')}
          </Badge>
        )}
      </header>

      <div className="px-4 py-3 flex flex-col gap-2">
        <div className="text-sm">{rule}</div>

        {overrideN != null && (
          <div className="text-xs text-subtle">
            {t('icloudLock.flagSetBy', { n: overrideN, user: contract.icloud_lock_set_by_username ?? '—' })}{' '}
            <DateTime value={contract.icloud_lock_set_at ?? null} />
            {contract.icloud_lock_override_reason && (
              <> · {t('icloudLock.reason')}: {contract.icloud_lock_override_reason}</>
            )}
          </div>
        )}

        {lockedNow == null && <div className="text-xs text-subtle">{noVerdictHint}</div>}

        <div className="flex flex-wrap gap-2 pt-1">
          {maySet && (overrideN == null ? (
            <Button size="sm" variant="outline" startIcon={<Flag size={14} />} onClick={() => setDialog('set')} data-action="ICLOUD_LOCK_SET">
              {t('icloudLock.setFlag')}
            </Button>
          ) : (
            <>
              <Button size="sm" variant="outline" startIcon={<Pencil size={14} />} onClick={() => setDialog('set')} data-action="ICLOUD_LOCK_EDIT">
                {t('icloudLock.editFlag')}
              </Button>
              <Button size="sm" variant="outline" color="danger" startIcon={<FlagOff size={14} />} onClick={() => setDialog('clear')} data-action="ICLOUD_LOCK_CLEAR">
                {t('icloudLock.clearFlag')}
              </Button>
            </>
          ))}
          <Button size="sm" variant="ghost" startIcon={<History size={14} />} onClick={() => setHistoryOpen(true)}>
            {t('icloudLock.details')}
          </Button>
        </div>
      </div>

      <IcloudLockDialog
        open={dialog !== null}
        mode={dialog ?? lastDialog.current}
        contract={contract}
        onClose={() => setDialog(null)}
      />
      <IcloudLockDetailsModal open={historyOpen} contractId={contract.id} onClose={() => setHistoryOpen(false)} />
    </section>
  );
}

function IcloudLockDialog({ open, mode, contract, onClose }: {
  open: boolean;
  mode: 'set' | 'clear';
  contract: ContractIcloudLockFields & { id: number };
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const isSet = mode === 'set';
  const code = contract.code_display ?? contract.code ?? '';
  const total = contract.total_installments ?? 0;

  const [view, setView] = useState<'form' | 'done'>('form');
  const [count, setCount] = useState('');
  const [startCount, setStartCount] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<LockState | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  // Reset on open only: the save refetches the contract, and that must not wipe
  // the done view.
  useEffect(() => {
    if (!open) return;
    // The box suggests the value in force now.
    const start = contract.icloud_lock_override_until_paid ?? contract.icloud_lock_until_paid ?? null;
    const startText = start != null ? String(start) : '';
    setView('form'); setCount(startText); setStartCount(startText); setReason(''); setError(null);
    setSaving(false); setResult(null); setConfirmClose(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const n = count === '' ? null : Number(count);
  const inRange = n != null && n >= 0 && n <= total;
  const canSubmit = !saving && reason.trim().length > 0 && (!isSet || inRange);
  const isDirty = reason.trim().length > 0 || (isSet && count !== startCount);

  const forceClose = () => { setConfirmClose(false); onClose(); };
  const handleClose = () => {
    if (view === 'done' || !isDirty) { forceClose(); return; }
    setConfirmClose(true);
  };

  const submit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    try {
      const res = isSet
        ? await apiClient.rpc<LockState>('fn_contract_account_lock_set', {
          p_contract_id: contract.id, p_until_paid_count: n, p_reason: reason.trim(),
        })
        : await apiClient.rpc<LockState>('fn_contract_account_lock_clear', {
          p_contract_id: contract.id, p_reason: reason.trim(),
        });
      setResult(res);
      setView('done');
      queryClient.invalidateQueries({ queryKey: ['contract-detail', contract.id] });
    } catch (err) {
      setError(translateApiError(err, t));
    } finally {
      setSaving(false);
    }
  };

  const title = isSet
    ? (contract.icloud_lock_override_until_paid != null ? t('icloudLock.editFlag') : t('icloudLock.setFlag'))
    : t('icloudLock.clearFlag');

  return (
    <>
      <Modal open={open} onClose={handleClose} maxWidth="30rem" width="100%" ariaLabel={title}>
        <div className="flex flex-col overflow-hidden" style={{ maxHeight: '90dvh' }}>
          <div className="modal-header">
            <h2 className="modal-title">{title}</h2>
            <button type="button" className="modal-close-btn" onClick={handleClose}>×</button>
          </div>

          {view === 'done' && result ? (
            <ActionDoneView
              headline={result.changed === false
                ? t('icloudLock.doneUnchanged')
                : isSet ? t('icloudLock.doneSet') : t('icloudLock.doneClear')}
              tone={result.changed === false ? 'neutral' : 'success'}
              contractCode={code}
              detailRows={[
                ...(result.override
                  ? [{ label: t('icloudLock.flagRow'), value: t('icloudLock.untilCount', { n: result.override.until_paid_count }), emphasis: true }]
                  : []),
                {
                  label: t('icloudLock.inForceRow'),
                  // OFF: the flag is recorded but does nothing until the company has the rule.
                  value: result.effective_source !== 'OFF' && result.effective_until_paid != null
                    ? t('icloudLock.untilCount', { n: result.effective_until_paid })
                    : t('icloudLock.noRule'),
                },
                { label: t('icloudLock.paidRow'), value: `${result.contract.paid_count} / ${result.contract.total_installments}` },
                ...(result.device ? [{ label: t('icloudLock.stateRow'), value: result.device.locked_now ? t('icloudLock.stateGrey') : t('icloudLock.stateOpen') }] : []),
              ]}
              extras={result.changed !== false && result.device
                ? <div className="text-xs text-subtle">{t('icloudLock.doneHint')}</div>
                : undefined}
              onClose={forceClose}
            />
          ) : (
            <>
              <div className="modal-content min-w-0">
                <div className="flex flex-col gap-3">
                  <div className="px-3 py-2.5 rounded-md bg-surface border border-line">
                    <div className="font-medium text-sm">{code}</div>
                    <div className="text-xs text-subtle">{t('icloudLock.paidOf', { paid: contract.paid_installment_count ?? 0, total })}</div>
                  </div>
                  <div className="form-grid pb-0">
                    {isSet && (
                      <div className="flex flex-col">
                        <label className="form-label">{t('icloudLock.countLabel', { max: total })} <span className="text-danger">*</span></label>
                        <MaskedInput
                          mask="number"
                          decimalScale={0}
                          value={count}
                          onChange={(raw: string) => setCount(raw)}
                          size="sm"
                          className="w-full"
                          error={count !== '' && !inRange}
                        />
                        {count !== '' && !inRange && (
                          <div className="text-xs text-danger-fg mt-1">{t('icloudLock.countRange', { max: total })}</div>
                        )}
                        {n === 0 && <div className="text-xs text-subtle mt-1">{t('icloudLock.zeroHint')}</div>}
                      </div>
                    )}
                    <div className="flex flex-col">
                      <label className="form-label">{t('icloudLock.reason')} <span className="text-danger">*</span></label>
                      <Input size="sm" className="w-full" value={reason} onChange={(e) => setReason(e.target.value)} />
                    </div>
                  </div>
                  {isSet ? (
                    <ul className="text-xs text-subtle list-disc pl-4 flex flex-col gap-0.5">
                      <li>{t('icloudLock.explainGrey')}</li>
                      <li>{t('icloudLock.explainPaid')}</li>
                      <li>{t('icloudLock.explainSwap')}</li>
                    </ul>
                  ) : (
                    <div className="text-xs text-subtle">{t('icloudLock.explainClear')}</div>
                  )}
                </div>
              </div>
              <ModalErrorBand message={error} onDismiss={() => setError(null)} />
              <div className="modal-footer">
                <Button variant="ghost" onClick={handleClose} disabled={saving}>{t('common.cancel')}</Button>
                <Button
                  color={isSet ? 'primary' : 'danger'}
                  disabled={!canSubmit}
                  startIcon={saving ? <Loader2 size={16} className="animate-spin" /> : isSet ? <Flag size={16} /> : <FlagOff size={16} />}
                  onClick={submit}
                >
                  {isSet ? t('common.save') : t('icloudLock.clearFlag')}
                </Button>
              </div>
            </>
          )}
        </div>
      </Modal>

      <Modal open={confirmClose} onClose={() => setConfirmClose(false)} maxWidth="24rem" width="100%">
        <div className="modal-header"><h2 className="modal-title">{t('common.unsavedChanges')}</h2></div>
        <div className="modal-content"><p>{t('common.unsavedChangesMessage')}</p></div>
        <div className="modal-footer">
          <Button variant="ghost" onClick={() => setConfirmClose(false)}>{t('common.cancel')}</Button>
          <Button color="danger" onClick={forceClose}>{t('common.discard')}</Button>
        </div>
      </Modal>
    </>
  );
}

function IcloudLockDetailsModal({ open, contractId, onClose }: { open: boolean; contractId: number; onClose: () => void }) {
  const { t } = useTranslation();
  const { data, error, isLoading } = useQuery({
    queryKey: ['contract-icloud-lock', contractId],
    queryFn: () => apiClient.rpc<LockState>('fn_contract_account_lock_get', { p_contract_id: contractId }),
    enabled: open,
    staleTime: 0,
    retry: false,
  });
  const device = data?.device ?? null;
  const switching = device && device.preset_expected !== device.preset_observed;
  const waitingLogin = device && (!device.logged_in || !device.nnf_app_present);
  const exempt = device?.device_exempt_flags ?? [];

  return (
    <Modal open={open} onClose={onClose} maxWidth="34rem" width="100%" ariaLabel={t('icloudLock.details')}>
      <div className="flex flex-col overflow-hidden" style={{ maxHeight: '90dvh' }}>
        <div className="modal-header">
          <h2 className="modal-title">{t('icloudLock.detailsTitle')}</h2>
          <button type="button" className="modal-close-btn" onClick={onClose}>×</button>
        </div>
        <div className="modal-content min-w-0 flex flex-col gap-3">
          {error ? (
            <div className="alert alert-danger"><XCircle size={16} /><span>{translateApiError(error, t)}</span></div>
          ) : isLoading || !data ? (
            <div className="py-8 flex justify-center text-subtler"><Loader2 size={20} className="animate-spin" /></div>
          ) : (
            <>
              {(waitingLogin || switching || exempt.length > 0 || data.new_phone_cutoff_applies) && (
                <ul className="text-sm list-disc pl-4 flex flex-col gap-1">
                  {waitingLogin && <li>{t('icloudLock.noteWaitingLogin')}</li>}
                  {switching && !waitingLogin && <li>{t('icloudLock.noteSwitching')}</li>}
                  {exempt.length > 0 && <li>{t('icloudLock.noteExempt', { flags: exempt.join(', ') })}</li>}
                  {data.new_phone_cutoff_applies && <li>{t('icloudLock.noteCutoff')}</li>}
                </ul>
              )}
              <div>
                <div className="text-xs font-semibold text-subtle mb-1">{t('icloudLock.historyTitle')}</div>
                {data.history.length === 0 ? (
                  <div className="text-sm text-subtle">{t('icloudLock.historyEmpty')}</div>
                ) : (
                  <div className="border border-line rounded-md divide-y divide-line">
                    {data.history.map((h) => (
                      <div key={h.id} className="px-3 py-2 flex flex-col gap-0.5 text-sm">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium">{t('icloudLock.untilCount', { n: h.until_paid_count })}</span>
                          {h.is_active && <Badge size="xs" color="success">{t('icloudLock.historyActive')}</Badge>}
                        </div>
                        <div className="text-xs text-subtle">
                          {h.set_by_username ?? '—'} · <DateTime value={h.set_at} /> · {h.reason}
                        </div>
                        {h.cleared_at && (
                          <div className="text-xs text-subtle">
                            {t('icloudLock.historyCleared')} {h.cleared_by_username ?? '—'} · <DateTime value={h.cleared_at} />
                            {h.clear_reason && <> · {h.clear_reason}</>}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
        <div className="modal-footer">
          <Button onClick={onClose}>{t('common.close')}</Button>
        </div>
      </div>
    </Modal>
  );
}
