import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';
import { Badge, Button, Input, Modal } from 'tsp-form';
import { XCircle, User, Phone, Smartphone, CalendarClock, AlertTriangle, Loader2, FileSignature } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { DateTime } from '../../components/DateTime';
import { formatTel, fmtCurrency } from '../../lib/format';
import { ActionDoneView } from './ActionDoneView';
import { useContractInvalidate } from './useContractInvalidate';

// ── Shared shapes (from fn_contract_check_deposit / check_return_deposit) ─────

interface CheckAsset {
  asset_id: number;
  asset_code: string;
  serial_no: string | null;
  imei: string | null;
  current_bucket: string;
  product_display_name: string | null;
}
interface CheckContract { contract_id: number; code_display: string; state: string }
interface CheckCustomer { customer_id: number; full_name: string; tel: string | null }

interface DepositCheckResult {
  allowed: boolean;
  contract: CheckContract;
  customer: CheckCustomer;
  asset: CheckAsset;
  deposit_terms: {
    max_days: number;
    min_days: number;
    max_days_allowed: number;
    deadline_date: string;
    is_override: boolean;
  };
}

interface ReturnCheckResult {
  allowed: boolean;
  reason?: string;                 // RETURN_BLOCKED_OVERDUE when !allowed
  overdue_amount?: number;
  overdue_count?: number;
  contract: CheckContract;
  customer: CheckCustomer;
  asset: CheckAsset;
  deposit: {
    episode_id: number;
    deposited_at: string;
    deposit_deadline: string;
    days_left: number;
    is_overdue: boolean;
  };
}

// deposit_device / return_deposit both return this — the signing sheet, NOT a
// completed deposit (deposited stays false until the signing is SEALED).
interface IssueSigningResult {
  contract_id: number;
  asset_id: number;
  signing_id: number;
  signing_status: string;
  deposited: boolean;
  next_action: string;
  deposit_terms?: { max_days: number; deadline_date: string };
}

function apiErr(err: unknown, t: ReturnType<typeof useTranslation>['t']): string {
  if (err instanceof ApiError) {
    return (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
      || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '')
      || err.message;
  }
  return err instanceof Error ? err.message : String(err);
}

// Read-only confirm block: customer / device / (deadline). Shared by both flows.
function ConfirmParty({ customer, asset }: { customer: CheckCustomer; asset: CheckAsset }) {
  const { t } = useTranslation();
  const identifier = asset.serial_no ?? asset.imei;
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2 text-sm">
        <User size={14} className="text-subtle shrink-0" />
        <span className="font-medium truncate">{customer.full_name}</span>
        {customer.tel && (
          <span className="inline-flex items-center gap-1 text-xs text-subtle shrink-0 tabular-nums">
            <Phone size={11} />{formatTel(customer.tel)}
          </span>
        )}
      </div>
      <div className="flex items-start gap-2 text-sm">
        <Smartphone size={14} className="text-subtle shrink-0 mt-0.5" />
        <div className="min-w-0">
          <div className="truncate">{asset.product_display_name ?? asset.asset_code}</div>
          <div className="text-xs text-subtle font-mono">
            {asset.asset_code}{identifier ? ` · ${identifier}` : ''}
          </div>
        </div>
      </div>
      <p className="text-xs text-subtler">{t('deposit.confirmScanHint')}</p>
    </div>
  );
}

// ── Deposit device ───────────────────────────────────────────────────────────
//
// check → confirm (editable days, re-check on change) → fn_contract_deposit_device
// (issues signing) → done view that sends the user to the Signing tab. The device
// does NOT move buckets here — that happens when the signing is SEALED (§5.1).

export function DepositDeviceModal({
  open, onClose, onSuccess, contract, onNavigateSigning,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  contract: { id: number; device_id: number | null };
  /** Jump to the Signing tab so staff can collect signatures on the new sheet. */
  onNavigateSigning?: () => void;
}) {
  const { t } = useTranslation();
  const invalidate = useContractInvalidate(contract.id);
  const assetId = contract.device_id;

  const [view, setView] = useState<'form' | 'done'>('form');
  const [days, setDays] = useState<string>('');       // empty until first check
  const [check, setCheck] = useState<DepositCheckResult | null>(null);
  const [issued, setIssued] = useState<IssueSigningResult | null>(null);
  const [error, setError] = useState('');

  // (Re)run the check with an optional day override. Server owns the deadline.
  const runCheck = useCallback(async (maxDays: number | null) => {
    if (assetId == null) return;
    setError('');
    try {
      const res = await apiClient.rpc<DepositCheckResult>('fn_contract_check_deposit', {
        p_contract_id: contract.id,
        p_asset_id: assetId,
        p_max_days: maxDays,
      });
      setCheck(res);
      if (maxDays == null) setDays(String(res.deposit_terms.max_days));
    } catch (err) {
      setError(apiErr(err, t));
    }
  }, [assetId, contract.id, t]);

  useEffect(() => {
    if (open) {
      setView('form');
      setDays('');
      setCheck(null);
      setIssued(null);
      setError('');
      runCheck(null);
    }
  }, [open, runCheck]);

  const terms = check?.deposit_terms;
  const daysNum = Number(days);
  const daysValid = terms != null && Number.isInteger(daysNum)
    && daysNum >= terms.min_days && daysNum <= terms.max_days_allowed;

  // Re-check (to refresh the deadline) when the day count changes to a valid,
  // different value. Server recomputes deadline_date — UI never calculates it.
  const applyDays = () => {
    if (daysValid && terms && daysNum !== terms.max_days) runCheck(daysNum);
    else if (daysValid && terms && daysNum === terms.max_days && terms.is_override) runCheck(daysNum);
  };

  const mutation = useMutation({
    mutationFn: () => apiClient.rpc<IssueSigningResult>('fn_contract_deposit_device', {
      p_contract_id: contract.id,
      p_asset_id: assetId,
      p_max_days: daysValid ? daysNum : null,
    }),
    onSuccess: (res) => {
      setIssued(res);
      setView('done');
      // Refresh panel/lists/actions in place. We deliberately do NOT call the
      // parent's onSuccess here — that closes the modal, and we want the done
      // view (which sends staff to the Signing tab) to stay up until dismissed.
      invalidate();
    },
    onError: (err) => setError(apiErr(err, t)),
  });

  const canSubmit = check?.allowed === true && daysValid && !mutation.isPending;

  return (
    <Modal open={open} onClose={onClose} maxWidth="30rem" width="100%">
      <div className="flex flex-col overflow-hidden">
        <div className="modal-header">
          <h2 className="modal-title">
            {view === 'done' ? t('deposit.deposit_done_title') : t('deposit.deposit_title')}
          </h2>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label={t('common.close')}>&times;</button>
        </div>

        {view === 'form' ? (
          <>
            <div className="modal-content">
              {error && (
                <div className="alert alert-danger mb-4 animate-pop-in">
                  <XCircle size={16} />
                  <span>{error}</span>
                </div>
              )}

              {check == null && !error ? (
                <div className="py-8 text-center text-subtler text-sm">
                  <Loader2 size={16} className="animate-spin inline mr-2" />{t('common.loading')}
                </div>
              ) : check ? (
                <div className="flex flex-col gap-4">
                  <div className="rounded-md border border-line px-3 py-3 bg-surface">
                    <ConfirmParty customer={check.customer} asset={check.asset} />
                  </div>

                  {/* Days + deadline. Days editable in [min, max_allowed]; deadline
                      is server-computed (re-checked on blur). */}
                  <div className="flex flex-col gap-2">
                    <label className="form-label">{t('deposit.daysField')}</label>
                    <div className="flex items-center gap-2">
                      <div style={{ width: '7rem' }}>
                        <Input
                          type="number"
                          value={days}
                          onChange={(e) => setDays(e.target.value)}
                          onBlur={applyDays}
                          onKeyDown={(e) => { if (e.key === 'Enter') applyDays(); }}
                          className="w-full"
                          error={!!days && !daysValid}
                          min={terms?.min_days}
                          max={terms?.max_days_allowed}
                        />
                      </div>
                      <span className="text-sm text-subtle">{t('deposit.daysUnit')}</span>
                      {terms?.is_override && (
                        <Badge size="xs" color="info">{t('deposit.overrideBadge')}</Badge>
                      )}
                    </div>
                    {terms && (
                      <p className="text-xs text-subtler">
                        {t('deposit.daysRange', { min: terms.min_days, max: terms.max_days_allowed })}
                      </p>
                    )}
                  </div>

                  {terms && (
                    <div className="flex items-center gap-2 rounded-md border border-line px-3 py-2.5">
                      <CalendarClock size={15} className="text-subtle shrink-0" />
                      <span className="text-sm text-subtle">{t('deposit.deadline')}</span>
                      <span className="ml-auto font-semibold text-sm">
                        <DateTime value={terms.deadline_date} showTime={false} />
                      </span>
                    </div>
                  )}
                </div>
              ) : null}
            </div>
            <div className="modal-footer">
              <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
              <Button
                color="primary"
                startIcon={mutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <FileSignature size={14} />}
                onClick={() => mutation.mutate()}
                disabled={!canSubmit}
              >
                {t('deposit.issueForSigning')}
              </Button>
            </div>
          </>
        ) : (
          <ActionDoneView
            headline={t('deposit.deposit_done_headline')}
            contractCode={check?.contract.code_display ?? `#${contract.id}`}
            tone="neutral"
            extras={
              <div className="alert alert-info">
                <FileSignature size={16} />
                <span>{t('deposit.deposit_done_awaitSign')}</span>
              </div>
            }
            detailRows={[
              {
                label: t('deposit.deadline'),
                value: issued?.deposit_terms?.deadline_date
                  ? <DateTime value={issued.deposit_terms.deadline_date} showTime={false} />
                  : '—',
                emphasis: true,
              },
            ]}
            secondaryAction={onNavigateSigning ? {
              label: t('deposit.goToSigning'),
              startIcon: <FileSignature size={14} />,
              onClick: () => { onNavigateSigning(); onClose(); },
            } : undefined}
            onClose={onClose}
          />
        )}
      </div>
    </Modal>
  );
}

// ── Return deposit ───────────────────────────────────────────────────────────
//
// check_return_deposit → if overdue-blocked, show amount + "collect payment"
// (jump to Money tab); else confirm → fn_contract_return_deposit (issues the
// return signing) → done view → Signing tab. Bucket moves on SEAL.

export function ReturnDepositModal({
  open, onClose, onSuccess, contract, onNavigateSigning, onNavigateMoney,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  contract: { id: number; device_id: number | null };
  onNavigateSigning?: () => void;
  onNavigateMoney?: () => void;
}) {
  const { t } = useTranslation();
  const invalidate = useContractInvalidate(contract.id);
  const assetId = contract.device_id;

  const [view, setView] = useState<'form' | 'done'>('form');
  const [check, setCheck] = useState<ReturnCheckResult | null>(null);
  const [issued, setIssued] = useState<IssueSigningResult | null>(null);
  const [error, setError] = useState('');

  const runCheck = useCallback(async () => {
    if (assetId == null) return;
    setError('');
    try {
      const res = await apiClient.rpc<ReturnCheckResult>('fn_contract_check_return_deposit', {
        p_contract_id: contract.id,
        p_asset_id: assetId,
      });
      setCheck(res);
    } catch (err) {
      setError(apiErr(err, t));
    }
  }, [assetId, contract.id, t]);

  useEffect(() => {
    if (open) {
      setView('form');
      setCheck(null);
      setIssued(null);
      setError('');
      runCheck();
    }
  }, [open, runCheck]);

  const blockedOverdue = check?.allowed === false && check?.reason === 'RETURN_BLOCKED_OVERDUE';

  const mutation = useMutation({
    mutationFn: () => apiClient.rpc<IssueSigningResult>('fn_contract_return_deposit', {
      p_contract_id: contract.id,
      p_asset_id: assetId,
    }),
    onSuccess: (res) => {
      setIssued(res);
      setView('done');
      // See DepositDeviceModal — keep the done view up (don't call parent onSuccess).
      invalidate();
    },
    onError: (err) => setError(apiErr(err, t)),
  });

  const canSubmit = check?.allowed === true && !mutation.isPending;

  return (
    <Modal open={open} onClose={onClose} maxWidth="30rem" width="100%">
      <div className="flex flex-col overflow-hidden">
        <div className="modal-header">
          <h2 className="modal-title">
            {view === 'done' ? t('deposit.return_done_title') : t('deposit.return_title')}
          </h2>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label={t('common.close')}>&times;</button>
        </div>

        {view === 'form' ? (
          <>
            <div className="modal-content">
              {error && (
                <div className="alert alert-danger mb-4 animate-pop-in">
                  <XCircle size={16} />
                  <span>{error}</span>
                </div>
              )}

              {check == null && !error ? (
                <div className="py-8 text-center text-subtler text-sm">
                  <Loader2 size={16} className="animate-spin inline mr-2" />{t('common.loading')}
                </div>
              ) : check ? (
                <div className="flex flex-col gap-4">
                  <div className="rounded-md border border-line px-3 py-3 bg-surface">
                    <ConfirmParty customer={check.customer} asset={check.asset} />
                  </div>

                  {/* Overdue block — can't return until installments are collected.
                      Show the amount and a shortcut to the payment flow (§4.4). */}
                  {blockedOverdue ? (
                    <div className="alert alert-warning flex-col items-start gap-2">
                      <div className="flex items-center gap-2">
                        <AlertTriangle size={16} />
                        <span className="font-medium">{t('deposit.return_blockedOverdue')}</span>
                      </div>
                      <div className="text-sm">
                        {t('deposit.return_overdueAmount', {
                          amount: fmtCurrency(check.overdue_amount ?? 0),
                          count: check.overdue_count ?? 0,
                        })}
                      </div>
                      {onNavigateMoney && (
                        <Button
                          size="sm"
                          color="primary"
                          onClick={() => { onNavigateMoney(); onClose(); }}
                        >
                          {t('deposit.return_collectPayment')}
                        </Button>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 rounded-md border border-line px-3 py-2.5">
                      <CalendarClock size={15} className="text-subtle shrink-0" />
                      <span className="text-sm text-subtle">{t('deposit.depositedSince')}</span>
                      <span className="ml-auto text-sm">
                        <DateTime value={check.deposit.deposited_at} showTime={false} />
                      </span>
                    </div>
                  )}
                </div>
              ) : null}
            </div>
            <div className="modal-footer">
              <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
              {blockedOverdue ? (
                <Button variant="outline" onClick={() => runCheck()}>{t('deposit.recheck')}</Button>
              ) : (
                <Button
                  color="primary"
                  startIcon={mutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <FileSignature size={14} />}
                  onClick={() => mutation.mutate()}
                  disabled={!canSubmit}
                >
                  {t('deposit.issueForSigning')}
                </Button>
              )}
            </div>
          </>
        ) : (
          <ActionDoneView
            headline={t('deposit.return_done_headline')}
            contractCode={check?.contract.code_display ?? `#${contract.id}`}
            tone="neutral"
            extras={
              <div className="alert alert-info">
                <FileSignature size={16} />
                <span>{t('deposit.return_done_awaitSign')}</span>
              </div>
            }
            secondaryAction={onNavigateSigning ? {
              label: t('deposit.goToSigning'),
              startIcon: <FileSignature size={14} />,
              onClick: () => { onNavigateSigning(); onClose(); },
            } : undefined}
            onClose={onClose}
          />
        )}
      </div>
    </Modal>
  );
}
