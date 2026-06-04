import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Badge, Select, Button, Drawer, TextArea,
} from 'tsp-form';
import { XCircle, AlertTriangle, ImageOff, ExternalLink } from 'lucide-react';
import { apiClient, ApiError } from '../lib/api';
import { DateTime } from './DateTime';
import { fmtCurrency } from '../lib/format';
import { useAuth } from '../contexts/AuthContext';
import { MediaLightbox, MediaThumbButton } from './MediaLightbox';
import { normalizeKey } from '../lib/mediaPath';

export type SubmissionStatus = 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED';

export interface SubmissionRow {
  id: number;
  contract_id: number;
  contract_code: string;
  contract_code_display: string;
  branch_id: number;
  branch_name: string | null;
  customer_id: number;
  customer_name: string | null;
  customer_tel: string | null;
  amount: number;
  note: string | null;
  status: SubmissionStatus;
  reviewed_by: number | null;
  reviewer_name: string | null;
  reviewed_at: string | null;
  reject_reason: string | null;
  payment_id: number | null;
  submitted_at: string;
  submit_channel: string | null;
  transfer_at: string | null;
  sender_account_name: string | null;
  sender_bank: string | null;
  sender_account_no: string | null;
  receiver_account_name: string | null;
  receiver_bank: string | null;
  receiver_account_no: string | null;
  transaction_ref: string | null;
  ocr_source: string | null;
  allowed_actions: string[];
  submitted_by: number | null;
  submitter_username: string | null;
  is_staff_submitted: boolean;
}

interface EntityMedia {
  entity_media_id: number;
  entity_type: string;
  entity_id: number;
  usage_type: string;
  storage_path: string;
  variants_json: Record<string, string> | null;
  created_at: string;
}

interface BankAccount {
  id: number;
  branch_id: number;
  bank_name: string;
  account_number: string;
  account_name: string;
  is_active: boolean;
  is_default: boolean;
  is_promptpay: boolean;
}

export const submissionStatusColor = (s: SubmissionStatus): 'warning' | 'success' | 'danger' => {
  switch (s) {
    case 'PENDING_REVIEW': return 'warning';
    case 'APPROVED': return 'success';
    case 'REJECTED': return 'danger';
  }
};

export function SubmissionReviewDrawer({
  row, open, onClose, onSuccess,
}: {
  row: SubmissionRow | null;
  open: boolean;
  onClose: () => void;
  onSuccess: (action: 'approve' | 'reject' | 'reopen') => void;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [reason, setReason] = useState('');
  const [bankAccountId, setBankAccountId] = useState<string>('');
  const [busy, setBusy] = useState<'approve' | 'reject' | 'reopen' | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [zoomedKey, setZoomedKey] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setReason('');
      setBankAccountId('');
      setErrorMessage('');
    }
  }, [open, row?.id]);

  const { data: slipMedia = [], isFetching: slipsFetching } = useQuery({
    queryKey: ['payment-submission-slips', row?.id],
    queryFn: () => apiClient.get<EntityMedia[]>(
      `/v_entity_media?entity_type=eq.PAYMENT_SUBMISSION&entity_id=eq.${row!.id}&order=sort_order`,
    ),
    enabled: !!row,
  });

  const { data: bankAccounts = [] } = useQuery({
    queryKey: ['bank-accounts', row?.branch_id],
    queryFn: () => apiClient.get<BankAccount[]>(
      `/v_bank_accounts?is_active=is.true&branch_id=eq.${row!.branch_id}&order=is_default.desc,bank_name`,
    ),
    enabled: !!row && row.status === 'PENDING_REVIEW',
  });

  useEffect(() => {
    if (!row || row.status !== 'PENDING_REVIEW' || bankAccounts.length === 0) return;
    if (bankAccountId) return;
    const matched = row.receiver_account_no
      ? bankAccounts.find(b => b.account_number === row.receiver_account_no)
      : null;
    const defaulted = matched ?? bankAccounts.find(b => b.is_default) ?? bankAccounts[0];
    if (defaulted) setBankAccountId(String(defaulted.id));
  }, [row, bankAccounts, bankAccountId]);

  if (!row) {
    return (
      <Drawer open={open} onClose={onClose} side="right" ariaLabel={t('paymentSubmissions.review')}>
        <div className="drawer-header">
          <h2 className="drawer-title">{t('paymentSubmissions.review')}</h2>
          <button className="drawer-close-btn" onClick={onClose}>&times;</button>
        </div>
      </Drawer>
    );
  }

  const isPending = row.status === 'PENDING_REVIEW';
  const isRejected = row.status === 'REJECTED';
  const allowed = row.allowed_actions ?? [];
  const canApprove = allowed.includes('APPROVE');
  const canReject = allowed.includes('REJECT');
  const canReopen = allowed.includes('REOPEN');

  const selectedBank = bankAccounts.find(b => String(b.id) === bankAccountId) ?? null;
  const receiverMismatch = !!(
    isPending &&
    row.receiver_account_no &&
    selectedBank &&
    selectedBank.account_number !== row.receiver_account_no
  );

  const handleAction = async (action: 'approve' | 'reject' | 'reopen') => {
    if (action === 'reject' && !reason.trim()) return;
    if (action === 'approve' && !bankAccountId) return;
    setBusy(action);
    setErrorMessage('');
    const start = Date.now();
    try {
      if (action === 'reopen') {
        await apiClient.rpc('fn_payment_submission_reopen', {
          p_submission_id: row.id,
          p_note: reason.trim() || null,
        });
      } else {
        await apiClient.rpc('fn_payment_submission_review', {
          p_submission_id: row.id,
          p_action: action === 'approve' ? 'APPROVE' : 'REJECT',
          p_channel: action === 'approve' ? 'TRANSFER' : null,
          p_branch_id: row.branch_id,
          p_bank_account_id: action === 'approve' ? Number(bankAccountId) : null,
          p_reject_reason: action === 'reject' ? (reason.trim() || null) : null,
          p_reviewed_by: user?.user_id ?? null,
        });
      }
      onSuccess(action);
    } catch (err) {
      if (err instanceof ApiError) {
        const translated = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
          || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
        setErrorMessage(translated || err.message);
      } else {
        setErrorMessage(t('common.error'));
      }
    } finally {
      const elapsed = Date.now() - start;
      if (elapsed < 300) await new Promise(r => setTimeout(r, 300 - elapsed));
      setBusy(null);
    }
  };

  return (
    <>
      <Drawer open={open} onClose={onClose} side="right" ariaLabel={t('paymentSubmissions.review')}>
        <div className="drawer-header">
          <h2 className="drawer-title">{t('paymentSubmissions.review')}</h2>
          <button className="drawer-close-btn" onClick={onClose}>&times;</button>
        </div>
        <div className="drawer-content">
          <div className="space-y-4">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge size="sm" color={submissionStatusColor(row.status)}>
                {t(`paymentSubmissions.status_${row.status}`)}
              </Badge>
              {row.submit_channel && (
                <Badge size="sm" color="default">{row.submit_channel}</Badge>
              )}
              {row.ocr_source && (
                <Badge size="sm" color="info">{row.ocr_source}</Badge>
              )}
            </div>

            <div>
              <div className="form-label mb-1">{t('paymentSubmissions.slipImage')}</div>
              {slipsFetching ? (
                <div className="border border-line rounded-lg h-48 flex items-center justify-center text-subtle text-sm">
                  {t('common.loading')}
                </div>
              ) : slipMedia.length === 0 ? (
                <div className="border border-line rounded-lg h-48 flex flex-col items-center justify-center gap-2 text-subtle text-sm">
                  <ImageOff size={24} />
                  <span>{t('paymentSubmissions.noSlip')}</span>
                </div>
              ) : (
                <div className="flex gap-2 flex-wrap">
                  {slipMedia.map((m) => {
                    const v = m.variants_json ?? {};
                    const thumbKey = v.sm || v.thumb || v.md || v.medium || v.original || m.storage_path;
                    const fullKey = v.original || v.lg || v.md || v.medium || m.storage_path;
                    return (
                      <MediaThumbButton
                        key={m.entity_media_id}
                        mediaKey={normalizeKey(thumbKey)}
                        alt="slip"
                        className="w-32 h-32 border border-line rounded-md overflow-hidden bg-surface cursor-zoom-in p-0"
                        onClick={() => setZoomedKey(normalizeKey(fullKey))}
                      />
                    );
                  })}
                </div>
              )}
            </div>

            <div className="space-y-2 text-sm">
              <DetailRow label={t('paymentSubmissions.contract')}>
                <Link
                  to={`/admin/contracts/search/${row.contract_id}`}
                  className="text-primary-fg inline-flex items-center gap-1 no-underline hover:underline"
                  onClick={onClose}
                >
                  {row.contract_code_display}
                  <ExternalLink size={12} />
                </Link>
              </DetailRow>
              <DetailRow label={t('paymentSubmissions.customer')} value={row.customer_name ?? '—'} />
              <DetailRow label={t('paymentSubmissions.customerTel')} value={row.customer_tel ?? '—'} />
              <DetailRow label={t('paymentSubmissions.branch')} value={row.branch_name ?? '—'} />
              <hr className="border-line my-2" />
              <DetailRow label={t('paymentSubmissions.amount')} value={fmtCurrency(row.amount)} mono />
              <DetailRow label={t('paymentSubmissions.transferAt')}>
                {row.transfer_at ? <DateTime value={row.transfer_at} /> : <span>—</span>}
              </DetailRow>
              <DetailRow label={t('paymentSubmissions.transactionRef')} value={row.transaction_ref ?? '—'} />
              <hr className="border-line my-2" />
              <div className="text-xs uppercase text-subtle tracking-wide mt-2">
                {t('paymentSubmissions.sender')}
              </div>
              <DetailRow label={t('paymentSubmissions.accountName')} value={row.sender_account_name ?? '—'} />
              <DetailRow label={t('paymentSubmissions.bank')} value={row.sender_bank ?? '—'} />
              <DetailRow label={t('paymentSubmissions.accountNumber')} value={row.sender_account_no ?? '—'} />
              <div className="text-xs uppercase text-subtle tracking-wide mt-2">
                {t('paymentSubmissions.receiver')}
              </div>
              <DetailRow label={t('paymentSubmissions.accountName')} value={row.receiver_account_name ?? '—'} />
              <DetailRow label={t('paymentSubmissions.bank')} value={row.receiver_bank ?? '—'} />
              <DetailRow label={t('paymentSubmissions.accountNumber')} value={row.receiver_account_no ?? '—'} />

              {row.note && (
                <>
                  <hr className="border-line my-2" />
                  <DetailRow label={t('paymentSubmissions.customerNote')} value={row.note} />
                </>
              )}

              {(row.reviewer_name || row.reviewed_at) && (
                <>
                  <hr className="border-line my-2" />
                  <DetailRow label={t('paymentSubmissions.reviewedBy')} value={row.reviewer_name ?? '—'} />
                  <DetailRow label={t('paymentSubmissions.reviewedAt')}>
                    {row.reviewed_at ? <DateTime value={row.reviewed_at} /> : <span>—</span>}
                  </DetailRow>
                  {row.reject_reason && (
                    <DetailRow label={t('paymentSubmissions.rejectReason')} value={row.reject_reason} />
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {(isPending || isRejected) && (
          <div className="drawer-footer border-t border-line sticky bottom-0 bg-bg">
            <div className="space-y-2 w-full">
              {errorMessage && (
                <div className="alert alert-danger animate-pop-in">
                  <XCircle size={16} />
                  <div><div className="alert-description text-xs">{errorMessage}</div></div>
                </div>
              )}

              {isPending && canApprove && (
                <div>
                  <div className="form-label mb-1">{t('paymentSubmissions.bankAccount')}</div>
                  <Select
                    options={bankAccounts.map(b => ({
                      value: String(b.id),
                      label: `${b.bank_name} · ${b.account_number}${b.is_default ? ' ★' : ''}`,
                    }))}
                    value={bankAccountId || null}
                    onChange={v => setBankAccountId((v as string) || '')}
                    size="sm"
                    placeholder={t('paymentSubmissions.selectBankAccount')}
                    searchable={false}
                  />
                  {receiverMismatch && (
                    <div className="alert alert-warning mt-2">
                      <AlertTriangle size={14} />
                      <div className="alert-description text-xs">
                        {t('paymentSubmissions.receiverMismatch')}
                      </div>
                    </div>
                  )}
                </div>
              )}

              <TextArea
                size="md"
                className="mb-1 w-full"
                rows={2}
                value={reason}
                onChange={e => setReason(e.target.value)}
                placeholder={
                  isPending
                    ? t('paymentSubmissions.rejectReasonPlaceholder')
                    : t('paymentSubmissions.reopenNotePlaceholder')
                }
                disabled={!!busy}
              />

              {isPending && (
                <div className="flex gap-2 w-full">
                  {canApprove && (
                    <Button
                      color="success" size="sm" className="flex-1"
                      disabled={!!busy || !bankAccountId}
                      onClick={() => handleAction('approve')}
                    >
                      {busy === 'approve' ? t('common.loading') : t('paymentSubmissions.approve')}
                    </Button>
                  )}
                  {canReject && (
                    <Button
                      color="danger" size="sm" className="flex-1"
                      disabled={!!busy || !reason.trim()}
                      onClick={() => handleAction('reject')}
                    >
                      {busy === 'reject' ? t('common.loading') : t('paymentSubmissions.reject')}
                    </Button>
                  )}
                </div>
              )}

              {isRejected && canReopen && (
                <Button
                  color="primary" size="sm" className="w-full"
                  disabled={!!busy}
                  onClick={() => handleAction('reopen')}
                >
                  {busy === 'reopen' ? t('common.loading') : t('paymentSubmissions.reopen')}
                </Button>
              )}
            </div>
          </div>
        )}
      </Drawer>

      <MediaLightbox
        open={!!zoomedKey}
        onClose={() => setZoomedKey(null)}
        mediaKey={zoomedKey}
        alt="slip"
      />
    </>
  );
}

function DetailRow({ label, value, mono, children }: {
  label: string;
  value?: string;
  mono?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-subtle shrink-0">{label}</span>
      {children ?? <span className={`text-right ${mono ? 'tabular-nums' : ''}`}>{value}</span>}
    </div>
  );
}
