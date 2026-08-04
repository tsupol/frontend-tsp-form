import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Modal, Button, Select, TextArea, useSnackbarContext } from 'tsp-form';
import { CheckCircle, XCircle, PenLine } from 'lucide-react';
import { apiClient, ApiError } from '../../../lib/api';
import { ActionDoneView } from '../../contracts/ActionDoneView';
import { RepairSignQrModal } from './RepairSignQrModal';
import type { RepairOrder, RepairResult, RepairRoute, RefRepairRoute } from '../repairTypes';
import { RESULT_COLOR } from '../repairTypes';
import { translateApiError } from '../../../lib/apiErrors';

const RESULT_VALUES: RepairResult[] = ['FIXED', 'UNFIXABLE', 'NOT_REPAIRED'];

// Customer device (needs an intake/return signature) = walk-in or contract device.
// Shop-stock is an internal move with no paperwork.
function isCustomerDevice(o: RepairOrder): boolean {
  return o.repair_type === 'WALK_IN' || o.repair_type === 'CUSTOMER_CONTRACT';
}

function translateErr(err: unknown, t: ReturnType<typeof useTranslation>['t']): string {
  if (err instanceof ApiError) {
    const translated = translateApiError(err, t);
    return translated || err.message;
  }
  return t('common.error');
}

// Target box shown at the top of every repair action modal (entity identity).
function RepairTargetBox({ order, subtitle }: { order: RepairOrder; subtitle?: string }) {
  return (
    <div className="mb-4 px-3 py-2.5 rounded-md bg-surface border border-line">
      <div className="font-medium text-sm">{order.code_display}</div>
      <div className="text-xs text-subtle">
        {[order.product_display_name, order.serial_no].filter(Boolean).join(' · ') || order.customer_name || '—'}
      </div>
      {subtitle && <div className="text-xs text-subtle mt-0.5">{subtitle}</div>}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Intake — DRAFT → IN_REPAIR. Customer device: capture a signature (QR) first,
 * then call intake with p_signature_media_id. Shop-stock: intake directly.
 * ──────────────────────────────────────────────────────────────────────────── */

export function RepairIntakeModal({
  open, onClose, order, onDone,
}: {
  open: boolean;
  onClose: () => void;
  order: RepairOrder;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const { addSnackbar } = useSnackbarContext();
  const [signMediaId, setSignMediaId] = useState<number | null>(null);
  const [qrOpen, setQrOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const needsSig = isCustomerDevice(order);

  useEffect(() => {
    if (open) { setSignMediaId(null); setQrOpen(false); setBusy(false); setErrorMessage(''); }
  }, [open]);

  // Intake has no separate success screen — the customer already signed the intake
  // receipt, so confirming IS the finish. Close on success + snackbar, no extra Done.
  const submit = async () => {
    if (needsSig && signMediaId == null) return;
    setBusy(true);
    setErrorMessage('');
    try {
      await apiClient.rpc('fn_inv_repair_intake', {
        p_repair_order_id: order.repair_order_id,
        p_signature_media_id: signMediaId,
      });
      onDone();
      onClose();
      addSnackbar({ message: <div className="alert alert-success"><CheckCircle size={16} /><span>{t('repair.intakeDone')}</span></div> });
    } catch (err) {
      setErrorMessage(translateErr(err, t));
    } finally {
      setBusy(false);
    }
  };

  const canSubmit = !busy && (!needsSig || signMediaId != null);

  return (
    <>
      <Modal open={open} onClose={busy ? () => {} : onClose} maxWidth="30rem" width="100%">
        <div className="modal-header">
          <h2 className="modal-title">{t('repair.intakeTitle')}</h2>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label={t('common.close')}>&times;</button>
        </div>
        <div className="modal-content">
          <RepairTargetBox order={order} subtitle={t(`repair.type_${order.repair_type}`)} />

          {order.repair_note && (
            <div className="mb-3">
              <div className="text-xs text-subtle mb-0.5">{t('repair.symptom')}</div>
              <div className="text-sm whitespace-pre-wrap">{order.repair_note}</div>
            </div>
          )}

          {needsSig ? (
            signMediaId != null ? (
              <div className="alert alert-success">
                <CheckCircle size={16} />
                <span>{t('repair.signCaptured')}</span>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <div className="text-sm text-subtle">{t('repair.intakeSignHint')}</div>
                <Button color="primary" startIcon={<PenLine size={16} />} onClick={() => setQrOpen(true)}>
                  {t('repair.captureSignature')}
                </Button>
              </div>
            )
          ) : (
            <div className="text-sm text-subtle">{t('repair.intakeNoSignHint')}</div>
          )}

          {errorMessage && (
            <div className="alert alert-danger mt-4 animate-pop-in">
              <XCircle size={16} />
              <span>{errorMessage}</span>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <Button variant="ghost" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
          <Button color="primary" onClick={submit} disabled={!canSubmit}>
            {busy ? t('common.loading') : t('repair.confirmIntake')}
          </Button>
        </div>
      </Modal>

      <RepairSignQrModal
        open={qrOpen}
        onClose={() => setQrOpen(false)}
        repairOrderId={order.repair_order_id}
        repairCode={order.code_display}
        docType="INTAKE"
        onSigned={(id) => { setSignMediaId(id); }}
      />
    </>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Close — IN_REPAIR → CLOSED. Requires balance = 0 (BE-gated; button hidden by
 * the action engine otherwise). Pick result + route (routes filtered by the
 * order's type via allowed_types). RETURN_TO_CUSTOMER needs a signature.
 * ──────────────────────────────────────────────────────────────────────────── */

export function RepairCloseModal({
  open, onClose, order, onDone,
}: {
  open: boolean;
  onClose: () => void;
  order: RepairOrder;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const { addSnackbar } = useSnackbarContext();
  const [view, setView] = useState<'form' | 'done'>('form');
  const [result, setResult] = useState<RepairResult | null>(null);
  const [route, setRoute] = useState<RepairRoute | null>(null);
  const [note, setNote] = useState('');
  const [signMediaId, setSignMediaId] = useState<number | null>(null);
  const [qrOpen, setQrOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const { data: routes } = useQuery({
    queryKey: ['ref-repair-routes'],
    queryFn: () => apiClient.get<RefRepairRoute[]>('/v_ref_repair_routes?order=sort_order'),
    staleTime: 60 * 60 * 1000,
  });

  // If the technician already marked the repair completed, the result is locked
  // to their verdict (BE rejects a mismatching close with REPAIR_RESULT_CONFLICT).
  // Seed the result from the order and disable the field. To change it, staff must
  // undo completion first.
  const resultLocked = order.completed_at != null;

  useEffect(() => {
    if (open) {
      setView('form'); setResult(resultLocked ? order.result : null); setRoute(null); setNote('');
      setSignMediaId(null); setQrOpen(false); setBusy(false); setErrorMessage('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Routes allowed for this repair_type (shop-stock cannot RETURN_TO_CUSTOMER).
  const routeOptions = (routes ?? [])
    .filter(r => r.allowed_types.includes(order.repair_type))
    .map(r => ({ value: r.route, label: t(`repair.route_${r.route}`) }));

  const selectedRoute = (routes ?? []).find(r => r.route === route);
  const needsSig = selectedRoute?.requires_customer_sign ?? false;

  const submit = async () => {
    if (!result || !route) return;
    if (needsSig && signMediaId == null) return;
    setBusy(true);
    setErrorMessage('');
    try {
      await apiClient.rpc('fn_inv_repair_close', {
        p_repair_order_id: order.repair_order_id,
        p_result: result,
        p_route_decision: route,
        p_signature_media_id: needsSig ? signMediaId : null,
        p_route_note: note.trim() || null,
      });
      setView('done');
    } catch (err) {
      setErrorMessage(translateErr(err, t));
    } finally {
      setBusy(false);
    }
  };

  const canSubmit = !busy && !!result && !!route && (!needsSig || signMediaId != null);

  return (
    <>
      <Modal open={open} onClose={busy ? () => {} : onClose} maxWidth="30rem" width="100%">
        {view === 'form' ? (
          <>
            <div className="modal-header">
              <h2 className="modal-title">{t('repair.closeTitle')}</h2>
              <button type="button" className="modal-close-btn" onClick={onClose} aria-label={t('common.close')}>&times;</button>
            </div>
            <div className="modal-content">
              <RepairTargetBox order={order} subtitle={t('repair.balanceSettled')} />

              <div className="form-grid">
                <div className="flex flex-col">
                  <label className="form-label">{t('repair.result')}</label>
                  <Select
                    options={RESULT_VALUES.map(v => ({ value: v, label: t(`repair.result_${v}`) }))}
                    value={result}
                    onChange={(val) => setResult((val as RepairResult) || null)}
                    placeholder={t('repair.selectResult')}
                    showChevron
                    searchable={false}
                    disabled={resultLocked}
                  />
                  {resultLocked && <span className="text-xs text-subtle mt-1">{t('repair.resultLocked')}</span>}
                </div>
                <div className="flex flex-col">
                  <label className="form-label">{t('repair.routeDecision')}</label>
                  <Select
                    options={routeOptions}
                    value={route}
                    onChange={(val) => { setRoute((val as RepairRoute) || null); setSignMediaId(null); }}
                    placeholder={t('repair.selectRoute')}
                    showChevron
                    searchable={false}
                  />
                </div>
                <div className="flex flex-col">
                  <label className="form-label">{t('repair.routeNote')}</label>
                  <TextArea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder={t('repair.notePlaceholder')} />
                </div>
              </div>

              {needsSig && (
                <div className="mt-4">
                  {signMediaId != null ? (
                    <div className="alert alert-success">
                      <CheckCircle size={16} />
                      <span>{t('repair.signCaptured')}</span>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      <div className="text-sm text-subtle">{t('repair.closeSignHint')}</div>
                      <Button color="primary" variant="outline" startIcon={<PenLine size={16} />} onClick={() => setQrOpen(true)}>
                        {t('repair.captureSignature')}
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {errorMessage && (
                <div className="alert alert-danger mt-4 animate-pop-in">
                  <XCircle size={16} />
                  <span>{errorMessage}</span>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <Button variant="ghost" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
              <Button color="primary" onClick={submit} disabled={!canSubmit}>
                {busy ? t('common.loading') : t('repair.confirmClose')}
              </Button>
            </div>
          </>
        ) : (
          <ActionDoneView
            headline={t('repair.closeDone')}
            contractCode={order.code_display}
            stateTransition={{ from: t('repair.status_IN_REPAIR'), to: t('repair.status_CLOSED'), toColor: 'success' }}
            detailRows={[
              { label: t('repair.result'), value: result ? t(`repair.result_${result}`) : '—' },
              { label: t('repair.routeDecision'), value: route ? t(`repair.route_${route}`) : '—' },
            ]}
            onClose={() => { onDone(); onClose(); addSnackbar({ message: <div className="alert alert-success"><CheckCircle size={16} /><span>{t('repair.closeSuccess')}</span></div> }); }}
          />
        )}
      </Modal>

      <RepairSignQrModal
        open={qrOpen}
        onClose={() => setQrOpen(false)}
        repairOrderId={order.repair_order_id}
        repairCode={order.code_display}
        docType="RETURN"
        onSigned={(id) => { setSignMediaId(id); }}
      />
    </>
  );
}

export { RESULT_COLOR };
