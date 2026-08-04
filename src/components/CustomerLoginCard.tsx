import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge, Button, Modal, Input, useSnackbarContext,
} from 'tsp-form';
import {
  KeyRound, Unlock, Activity, CheckCircle, XCircle, Lock, Clock, AlertCircle, Loader2,
} from 'lucide-react';
import { apiClient, ApiError } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { formatSmart } from '../lib/format';
import { DateTime } from './DateTime';
import { CustomerActivityModal } from './CustomerActivityModal';
import { ResetCustomerLoginModal } from './ResetCustomerLoginModal';
import { translateApiError } from '../lib/apiErrors';

export interface CustomerLoginInfo {
  id: number;
  full_name: string;
  id_number: string | null;
  tel: string | null;
  username: string | null;
  has_login: boolean;
  last_login_at: string | null;
  failed_login_count: number;
  locked_until: string | null;
  is_currently_locked: boolean;
}

interface Props {
  customer: CustomerLoginInfo;
  onChanged?: () => void;
  /** When true, drop the card chrome (border/bg/padding) and let the parent
   *  separate this section with a `border-t` line instead. */
  noCard?: boolean;
}

export function CustomerLoginCard({ customer, onChanged, noCard = false }: Props) {
  const { t } = useTranslation();
  const { can } = useAuth();
  const allowed = can('CONTRACT.CUSTOMER_RESET_PASSWORD');

  const [resetOpen, setResetOpen] = useState(false);
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);

  return (
    <div className={noCard ? '' : 'rounded-md border border-line bg-surface px-3 py-2.5'}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <KeyRound size={13} className="text-subtle" />
          <span className="text-sm font-medium">{t('customer.login.section')}</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          startIcon={<Activity size={14} />}
          onClick={() => setActivityOpen(true)}
        >
          {t('customer.login.viewActivity')}
        </Button>
      </div>

      {!customer.has_login ? (
        <div className="text-xs text-subtler flex items-start gap-1.5">
          <AlertCircle size={13} className="mt-0.5 shrink-0" />
          <span>{t('customer.login.noLoginHint')}</span>
        </div>
      ) : (
        <>
          <div className="space-y-1 text-sm mb-2.5">
            <Row label={t('customer.login.username')}>
              <span className="tabular-nums">{customer.username ?? '—'}</span>
            </Row>
            <Row label={t('customer.login.lastLoginAt')}>
              {customer.last_login_at
                ? <DateTime value={customer.last_login_at} />
                : <span className="text-subtler">{t('customer.login.lastLoginNever')}</span>}
            </Row>
            <Row label={t('customer.login.section')}>
              <div className="flex items-center gap-1.5 flex-wrap justify-end">
                <Badge size="xs" color="success">{t('customer.login.hasLogin')}</Badge>
                {customer.is_currently_locked && (
                  <Badge size="xs" color="danger">
                    <Lock size={10} className="mr-0.5" />
                    {customer.locked_until
                      ? t('customer.login.lockedUntil', {
                          until: new Date(customer.locked_until).toLocaleString('th-TH-u-ca-gregory', {
                            timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit',
                            day: 'numeric', month: 'short',
                          }),
                        })
                      : t('customer.login.locked')}
                  </Badge>
                )}
                {!customer.is_currently_locked && customer.failed_login_count > 0 && (
                  <Badge size="xs" color="warning">
                    <Clock size={10} className="mr-0.5" />
                    {t('customer.login.failedCount', { count: customer.failed_login_count })}
                  </Badge>
                )}
              </div>
            </Row>
          </div>

          {allowed && (
            <div className="flex flex-wrap gap-1.5 pt-2 border-t border-line">
              <Button
                size="sm"
                variant="outline"
                startIcon={<KeyRound size={13} />}
                onClick={() => setResetOpen(true)}
              >
                {t('customer.login.resetPassword')}
              </Button>
              {customer.is_currently_locked && (
                <Button
                  size="sm"
                  variant="outline"
                  color="warning"
                  startIcon={<Unlock size={13} />}
                  onClick={() => setUnlockOpen(true)}
                >
                  {t('customer.login.unlock')}
                </Button>
              )}
            </div>
          )}
        </>
      )}

      <ResetCustomerLoginModal
        open={resetOpen}
        customerId={customer.id}
        customerName={customer.full_name}
        onClose={() => setResetOpen(false)}
        onDone={() => onChanged?.()}
      />
      <UnlockModal
        open={unlockOpen}
        customer={customer}
        onClose={() => setUnlockOpen(false)}
        onSuccess={() => { setUnlockOpen(false); onChanged?.(); }}
      />
      <CustomerActivityModal
        open={activityOpen}
        onClose={() => setActivityOpen(false)}
        customerId={customer.id}
        customerName={customer.full_name}
      />
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-subtle text-xs shrink-0">{label}</span>
      <span className="text-right text-sm">{children}</span>
    </div>
  );
}

// ── Unlock Modal ────────────────────────────────────────────────────────────

function UnlockModal({ open, customer, onClose, onSuccess }: {
  open: boolean;
  customer: CustomerLoginInfo;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { t } = useTranslation();
  const { addSnackbar } = useSnackbarContext();
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) { setReason(''); setError(''); setSubmitting(false); }
  }, [open]);

  const handleConfirm = async () => {
    setSubmitting(true);
    setError('');
    try {
      const res = await apiClient.rpc<{ was_locked: boolean }>('fn_customer_unlock', {
        p_customer_id: customer.id,
        p_reason: reason.trim() || null,
      });
      addSnackbar({
        message: (
          <div className="alert alert-success">
            <CheckCircle size={16} />
            <span>{res?.was_locked ? t('customer.login.unlockSuccess') : t('customer.login.unlockNoOp')}</span>
          </div>
        ),
      });
      onSuccess();
    } catch (err) {
      if (err instanceof ApiError) {
        const translated = translateApiError(err, t);
        setError(translated || err.message);
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} maxWidth="28rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">{t('customer.login.unlockTitle', { name: customer.full_name })}</h2>
        <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">&times;</button>
      </div>
      <div className="modal-content">
        {error && (
          <div className="alert alert-danger mb-3">
            <XCircle size={16} />
            <span>{error}</span>
          </div>
        )}
        <p className="text-sm text-subtle mb-4">{t('customer.login.unlockNote')}</p>
        <div className="form-grid">
          <div className="flex flex-col">
            <label className="form-label">{t('customer.login.reason')}</label>
            <Input
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder={t('customer.login.reasonPlaceholder')}
              className="w-full"
            />
          </div>
        </div>
      </div>
      <div className="modal-footer">
        <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
        <Button
          color="warning"
          onClick={handleConfirm}
          disabled={submitting}
          startIcon={submitting ? <Loader2 size={14} className="animate-spin" /> : <Unlock size={14} />}
        >
          {t('customer.login.unlockConfirm')}
        </Button>
      </div>
    </Modal>
  );
}

// ── Hook for fetching login state by customer id ───────────────────────────

/**
 * Fetch login state columns from v_customers. Use when a parent already has
 * the customer but not the login columns (e.g. ContractDetailPanel which
 * only reads name/tel/id_number into its CustomerDetail shape).
 */
export function useCustomerLoginInfo(customerId: number | null) {
  return useQuery({
    queryKey: ['customer-login-info', customerId],
    queryFn: async () => {
      const rows = await apiClient.get<CustomerLoginInfo[]>(
        `/v_customers?id=eq.${customerId}&select=id,full_name,id_number,tel,username,has_login,last_login_at,failed_login_count,locked_until,is_currently_locked`,
      );
      return rows[0] ?? null;
    },
    enabled: !!customerId,
  });
}

export function useInvalidateLoginInfo() {
  const queryClient = useQueryClient();
  return (customerId: number) => {
    queryClient.invalidateQueries({ queryKey: ['customer-login-info', customerId] });
    queryClient.invalidateQueries({ queryKey: ['customer-audit-log', customerId] });
    queryClient.invalidateQueries({ queryKey: ['customer-login-history', customerId] });
    queryClient.invalidateQueries({ queryKey: ['customers'] });
    queryClient.invalidateQueries({ queryKey: ['customer', customerId] });
  };
}

// Re-export formatSmart so consumers don't need a separate import for inline
// timestamp rendering inside login-related cards.
export { formatSmart };
