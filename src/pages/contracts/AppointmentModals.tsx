import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Button, Modal, TextArea, InputDatePicker } from 'tsp-form';
import { XCircle, Keyboard } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { makeDatePickerFormat } from '../../lib/format';
import { DateTime } from '../../components/DateTime';
import { BranchPinInput } from '../../components/BranchPinInput';
import { ActionDoneView } from './ActionDoneView';
import { useContractInvalidate } from './useContractInvalidate';

// Backend RPCs (mig 173 — PIN required on both):
//   fn_contract_appointment_create(p_contract_id, p_promise_date, p_installment_id?, p_note?, p_pin)
//   fn_contract_appointment_cancel(p_appointment_id, p_note?, p_pin)

interface ContractAppointment {
  id: number;
  contract_id: number;
  installment_id: number | null;
  promise_date: string;
  status: string;
  note: string | null;
  created_at: string;
}

function toLocalDateStr(d: Date | null): string {
  if (!d) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function setApiError(err: unknown, t: ReturnType<typeof useTranslation>['t'], setError: (v: string) => void) {
  if (err instanceof ApiError) {
    const translated = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
      || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
    setError(translated || err.message);
  } else {
    setError(err instanceof Error ? err.message : String(err));
  }
}

export function AppointmentCreateModal({
  open, onClose, onSuccess, contractId,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: (msgKey: string) => void;
  contractId: number;
}) {
  const { t, i18n } = useTranslation();
  const [promiseDate, setPromiseDate] = useState<Date | null>(null);
  const [note, setNote] = useState('');
  const [pin, setPin] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [error, setError] = useState('');

  // Client-side gate per 50_CONTRACT_APPOINTMENT_FLOW §8.4: promise_date
  // must be strictly future. The backend enforces this too, but giving the
  // calendar a `minDate=tomorrow` prevents the trip + better-error UX.
  const tomorrow = (() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 1);
    return d;
  })();

  useEffect(() => {
    if (open) {
      setPromiseDate(null);
      setNote('');
      setPin('');
      setIsTyping(false);
      setError('');
    }
  }, [open]);

  // Appointment is contract-level — installment FK was dropped in the
  // 2026-06-11 spec (mig 173). Keep params lean.
  const mutation = useMutation({
    mutationFn: () => {
      const params: Record<string, unknown> = {
        p_contract_id: contractId,
        p_promise_date: toLocalDateStr(promiseDate),
        p_pin: pin,
      };
      if (note.trim()) params.p_note = note.trim();
      return apiClient.rpc('fn_contract_appointment_create', params);
    },
    onSuccess: () => onSuccess('contract.action_appointment_create_success'),
    onError: (err) => setApiError(err, t, setError),
  });

  const canSubmit = !!promiseDate && promiseDate >= tomorrow && pin.length === 6 && !mutation.isPending;

  return (
    <Modal open={open} onClose={onClose} maxWidth="28rem" width="100%">
      <div className="flex flex-col overflow-hidden">
        <div className="modal-header">
          <h2 className="modal-title">{t('contract.action_appointment_create')}</h2>
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
            <div className="flex flex-col">
              <label className="form-label">{t('contract.appointment_promiseDate')} *</label>
              <InputDatePicker
                value={promiseDate}
                onChange={setPromiseDate}
                placeholder="DD/MM/YYYY"
                endIcon={<Keyboard size={16} />}
                onEndIconClick={() => setIsTyping(v => !v)}
                locale={i18n.language}
                calendar="gregorian"
                dateFormat={makeDatePickerFormat(i18n.language)}
                datePickerProps={{ minDate: tomorrow }}
                typingMode={isTyping}
                onTypingModeChange={setIsTyping}
                typingMask="##/##/####"
                typingPlaceholder="DD/MM/YYYY"
                parseTypedDate={(raw) => {
                  if (raw.length !== 8) return null;
                  const day = parseInt(raw.slice(0, 2), 10);
                  const month = parseInt(raw.slice(2, 4), 10);
                  let year = parseInt(raw.slice(4, 8), 10);
                  if (year > 2400) year -= 543;
                  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
                  const d = new Date(year, month - 1, day);
                  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
                  // Mirror minDate — typed past/today dates are rejected too.
                  if (d < tomorrow) return null;
                  return d;
                }}
              />
            </div>

            <div className="flex flex-col">
              <label className="form-label">{t('contract.note')}</label>
              <TextArea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t('contract.notePlaceholder')}
                rows={3}
              />
            </div>

            <BranchPinInput value={pin} onChange={setPin} required />
          </div>

          <div className="text-xs text-subtle mt-3">
            {t('contract.appointment_createHint')}
          </div>
        </div>
        <div className="modal-footer">
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            color="primary"
            onClick={() => mutation.mutate()}
            disabled={!canSubmit}
          >
            {mutation.isPending ? t('common.loading') : t('contract.action_appointment_create')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

interface AppointmentCancelResult {
  id: number;
  status: 'CANCELLED';
}

export function AppointmentCancelModal({
  open, onClose, onSuccess: _onSuccess, contractId,
}: {
  open: boolean;
  onClose: () => void;
  /** Unused — done view replaces snackbar. Kept for prop-shape parity. */
  onSuccess: (msgKey: string) => void;
  contractId: number;
}) {
  const { t } = useTranslation();
  const invalidate = useContractInvalidate(contractId);
  const [view, setView] = useState<'form' | 'done'>('form');
  const [note, setNote] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<AppointmentCancelResult | null>(null);
  // Snapshot the appointment that was cancelled (RPC only returns id + status)
  const [cancelledSnapshot, setCancelledSnapshot] = useState<ContractAppointment | null>(null);

  // Find the active appointment for this contract (RPC takes appointment_id, not contract_id)
  const { data: activeAppt, isLoading } = useQuery({
    queryKey: ['contract-appointment-active', contractId],
    queryFn: async () => {
      const rows = await apiClient.get<ContractAppointment[]>(
        `/v_contract_appointments?contract_id=eq.${contractId}&status=eq.ACTIVE&order=created_at.desc&limit=1`,
      );
      return rows[0] ?? null;
    },
    enabled: open,
    staleTime: 30 * 1000,
  });

  useEffect(() => {
    if (open) {
      setView('form');
      setNote('');
      setPin('');
      setError('');
      setResult(null);
      setCancelledSnapshot(null);
    }
  }, [open]);

  const mutation = useMutation({
    mutationFn: () => {
      if (!activeAppt) return Promise.reject(new Error('No active appointment'));
      const params: Record<string, unknown> = {
        p_appointment_id: activeAppt.id,
        p_pin: pin,
      };
      if (note.trim()) params.p_note = note.trim();
      return apiClient.rpc<AppointmentCancelResult>('fn_contract_appointment_cancel', params);
    },
    onSuccess: (res) => {
      setCancelledSnapshot(activeAppt ?? null);
      setResult(res);
      setView('done');
      invalidate();
    },
    onError: (err) => setApiError(err, t, setError),
  });

  const canSubmit = !!activeAppt && pin.length === 6 && !mutation.isPending;

  return (
    <Modal open={open} onClose={onClose} maxWidth="28rem" width="100%">
      <div className="flex flex-col overflow-hidden">
        <div className="modal-header">
          <h2 className="modal-title">
            {view === 'done'
              ? t('contract.action_appointment_cancel_done_title', { defaultValue: 'Appointment cancelled' })
              : t('contract.action_appointment_cancel')}
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

              {isLoading ? (
                <div className="text-sm text-subtle">{t('common.loading')}</div>
              ) : activeAppt ? (
                <div className="mb-4 px-3 py-2.5 rounded-md bg-surface border border-line">
                  <div className="text-sm">
                    {t('contract.appointment_promiseDate')}: <DateTime value={activeAppt.promise_date} showTime={false} />
                  </div>
                  {activeAppt.note && <div className="text-xs text-subtle mt-1">{activeAppt.note}</div>}
                </div>
              ) : (
                <div className="alert alert-warning mb-4">
                  <span>{t('contract.appointment_noneActive')}</span>
                </div>
              )}

              {activeAppt && (
                <div className="form-grid">
                  <div className="flex flex-col">
                    <label className="form-label">{t('contract.note')}</label>
                    <TextArea
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder={t('contract.notePlaceholder')}
                      rows={3}
                    />
                  </div>
                  <BranchPinInput value={pin} onChange={setPin} required />
                </div>
              )}
            </div>
            <div className="modal-footer">
              <Button onClick={onClose}>{t('common.cancel')}</Button>
              <Button
                color="danger"
                onClick={() => mutation.mutate()}
                disabled={!canSubmit}
              >
                {mutation.isPending ? t('common.loading') : t('contract.action_appointment_cancel')}
              </Button>
            </div>
          </>
        )}

        {view === 'done' && result && (
          <ActionDoneView
            headline={t('contract.action_appointment_cancel_done_headline', { defaultValue: 'Appointment cancelled' })}
            contractCode={`#${result.id}`}
            tone="neutral"
            detailRows={cancelledSnapshot ? [
              {
                label: t('contract.appointment_promiseDate'),
                value: <DateTime value={cancelledSnapshot.promise_date} showTime={false} />,
              },
              ...(cancelledSnapshot.note ? [{
                label: t('contract.note'),
                value: cancelledSnapshot.note,
              }] : []),
            ] : undefined}
            onClose={onClose}
          />
        )}
      </div>
    </Modal>
  );
}
