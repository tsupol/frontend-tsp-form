// A deal-partner shop collecting the down payment on an approved contract,
// without leaving the contract.
//
// Staff open a contract's bill as the last step of building it, on the
// contract-opening screen (workspace/PanelReviewPay). A shop reaches the same
// moment from somewhere else: the contract was built days ago, credit has
// approved it, and the shop is looking at it under "Pending Pay & Sign".
// Sending it to the opening screen dropped it on a page titled "New contract";
// this dialog does the same job in place.
//
// The steps on Confirm are the opening screen's own, in the same order — open
// the bill, add any extra lines, bind the staff signatures, record the payment,
// confirm it. Keep the two in step when that sequence changes. A shop's opening
// bill takes one payment method only (NOTICE 1196), so there is nothing to
// choose: the dialog shows what to collect and asks for one confirmation.
//
// Nothing here runs before Confirm is pressed. Opening the dialog reads; only
// the button writes.

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Modal } from 'tsp-form';
import { CheckCircle, Loader2, Pencil } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import { fmtCurrency } from '../../lib/format';
import { contractMenuFrom } from '../../lib/contractMenuPath';
import { ModalErrorBand } from '../../components/ModalErrorBand';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ActionDoneView } from './ActionDoneView';
import { BillCart, type DraftCartLine } from './workspace/BillCart';
import { ReadinessChecklist, type ReadinessItem } from './workspace/ReadinessChecklist';
import { readinessErrorsFromApiError } from './workspace/readinessFromError';
import { signContractOpenParties } from './workspace/signContractOpenParties';
import type { BillOpenResult } from './workspace/WorkspaceTypes';

interface ReadinessResult {
  ready: boolean;
  errors: ReadinessItem[];
  warnings?: ReadinessItem[];
}

interface ContractFigures {
  branch_id: number | null;
  down_payment: number | null;
  doc_fee_amount: number | null;
  insurance_deposit: number | null;
}

type View = 'form' | 'done' | 'billOpen';

export function ShopCollectDownModal({ open, contractId, contractCode, onClose, onChanged }: {
  open: boolean;
  contractId: number;
  contractCode: string;
  onClose: () => void;
  /** The contract changed on the server — refresh whatever shows it. */
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();

  const [view, setView] = useState<View>('form');
  const [cartLines, setCartLines] = useState<DraftCartLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openBlockers, setOpenBlockers] = useState<ReadinessItem[] | null>(null);
  const [bill, setBill] = useState<BillOpenResult | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  // A fresh dialog every time it opens.
  useEffect(() => {
    if (!open) return;
    setView('form');
    setCartLines([]);
    setLoading(false);
    setError(null);
    setOpenBlockers(null);
    setBill(null);
    setConfirmDiscard(false);
  }, [open, contractId]);

  // Same row the contract panel behind the dialog reads — already in the cache.
  const { data: figures } = useQuery({
    queryKey: ['contract-detail', contractId],
    queryFn: async () => {
      const rows = await apiClient.get<ContractFigures[]>(`/v_contract_detail?id=eq.${contractId}`);
      return rows[0] ?? null;
    },
    enabled: open,
  });

  // Read-only: says whether the bill can be opened, and changes nothing.
  const { data: readiness, isFetching: readinessFetching } = useQuery({
    queryKey: ['contract-readiness', contractId],
    queryFn: () => apiClient.rpc<ReadinessResult>('fn_contract_validate_ready', { p_contract_id: contractId }),
    enabled: open && view === 'form',
    staleTime: 0,
  });
  const readinessKnown = !!readiness && !readinessFetching;
  const readinessErrors = readinessKnown && !readiness.ready ? readiness.errors : [];
  const readinessWarnings = readinessKnown ? (readiness.warnings ?? []) : [];
  const blockers = openBlockers ?? readinessErrors;

  // What the opening bill will carry. A preview: the figure collected is the
  // bill's own total, read back once the bill exists.
  const down = figures?.down_payment ?? 0;
  const docFee = figures?.doc_fee_amount ?? 0;
  const insurance = figures?.insurance_deposit ?? 0;
  const systemLines = useMemo(() => {
    const items: Array<{ key: string; description: string; amount: number }> = [];
    if (down > 0) items.push({ key: 'down', description: t('contract.downPayment'), amount: down });
    if (docFee > 0) items.push({ key: 'docFee', description: t('fin1Plan.rowDocFee'), amount: docFee });
    if (insurance > 0) items.push({ key: 'insurance', description: t('contract.insuranceDeposit'), amount: insurance });
    return items;
  }, [down, docFee, insurance, t]);
  const previewTotal = down + docFee + insurance
    + cartLines.reduce((sum, l) => sum + (l.as_gift ? 0 : l.amount), 0);
  const nothingToCollect = !!figures && previewTotal <= 0;

  const canConfirm = !!figures && readinessKnown && readiness.ready && !loading;

  const forceClose = () => { setConfirmDiscard(false); onClose(); };
  const handleClose = () => {
    if (loading) return;
    if (view === 'form' && cartLines.length > 0) { setConfirmDiscard(true); return; }
    forceClose();
  };

  const confirm = async () => {
    if (!canConfirm) return;
    setLoading(true);
    setError(null);
    setOpenBlockers(null);
    let opened: BillOpenResult | null = null;
    try {
      // 1. Open the bill.
      opened = await apiClient.rpc<BillOpenResult>('fn_bill_contract_open', { p_contract_id: contractId });
      setBill(opened);

      // The bill was already open from an earlier try — don't add to it again.
      // The contract's own "Continue payment" button collects what is left.
      if (opened.already_open) {
        onChanged();
        setView('billOpen');
        return;
      }

      // 2. Extra lines (a gift is added as a sale, then converted).
      for (const line of cartLines) {
        const added = await apiClient.rpc<{ line_item_id: number }>('fn_bill_line_item_add', {
          p_bill_id: opened.bill_id,
          p_line_type: line.line_type,
          p_charge_type: line.charge_type,
          p_description: line.description,
          p_amount: line.amount,
          p_quantity: line.quantity,
          p_variant_id: line.variant_id,
        });
        if (line.as_gift) {
          await apiClient.rpc('fn_bill_line_convert_to_gift', { p_line_id: added.line_item_id });
        }
      }

      // 3. Bind the staff signatures on the contract document the bill created.
      const signed = await signContractOpenParties(contractId);
      if (signed.unsigned.length > 0) {
        const who = signed.unsigned
          .map(u => u.name || t(`signing.role_${u.role}`, { defaultValue: u.role }))
          .join(', ');
        throw new Error(t('wizard.signMissingStaffSignatures', { who }));
      }

      // 4 + 5. Collect what the bill says — a bill with nothing on it is born paid.
      if (opened.total_amount != null ? opened.total_amount > 0 : previewTotal > 0) {
        await apiClient.rpc('fn_bill_payment_add', {
          p_bill_id: opened.bill_id,
          p_method: 'PARTNER_COLLECT',
          p_amount: opened.total_amount ?? previewTotal,
          p_bank_account_id: null,
        });
        await apiClient.rpc('fn_bill_payment_confirm', {
          p_bill_id: opened.bill_id,
          p_contract_id: contractId,
        });
      }

      onChanged();
      setView('done');
    } catch (err) {
      const refused = readinessErrorsFromApiError(err);
      if (refused && refused.length > 0) {
        setOpenBlockers(refused);
        queryClient.invalidateQueries({ queryKey: ['contract-readiness', contractId] });
      } else if (err instanceof ApiError) {
        setError(translateApiError(err, t) || err.message);
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
      // The bill exists but a later step failed: pressing Confirm again would
      // be refused. Say so, and point at the button that finishes the job.
      if (opened) {
        onChanged();
        setView('billOpen');
      }
    } finally {
      setLoading(false);
    }
  };

  const collected = bill?.total_amount ?? previewTotal;

  return (
    <>
      <Modal open={open} onClose={handleClose} maxWidth="36rem" width="100%">
        <div className="flex flex-col overflow-hidden">
          <div className="modal-header">
            <h2 className="modal-title">{t('contract.collectDownPayment')}</h2>
            <button type="button" className="modal-close-btn" onClick={handleClose} aria-label={t('common.close')}>×</button>
          </div>

          {view === 'done' && (
            <ActionDoneView
              headline={collected > 0 ? t('wizard.bill_confirmed_title') : t('wizard.bill_opened_no_charge_title')}
              contractCode={contractCode}
              billId={bill?.bill_id ?? null}
              detailRows={collected > 0 ? [
                { label: t('wizard.paymentMethods'), value: t('paymentMethod.PARTNER_COLLECT') },
                { label: t('wizard.totalPayment'), value: fmtCurrency(collected), emphasis: true },
              ] : []}
              extras={
                <div className="text-sm text-subtle text-center">
                  {collected > 0 ? t('wizard.bill_confirmed_body_signing') : t('wizard.bill_opened_no_charge_body')}
                </div>
              }
              onClose={forceClose}
            />
          )}

          {view === 'billOpen' && (
            <ActionDoneView
              tone="warning"
              headline={t('contract.collectDownBillOpenTitle')}
              contractCode={contractCode}
              detailRows={bill ? [{ label: t('contract.collectDownBillNo'), value: bill.bill_code_display ?? bill.bill_code }] : []}
              extras={
                <div className="flex flex-col gap-2">
                  {error && <div className="alert alert-danger"><span>{error}</span></div>}
                  <div className="text-sm text-subtle text-center">{t('contract.collectDownBillOpenHint')}</div>
                </div>
              }
              onClose={forceClose}
            />
          )}

          {view === 'form' && (
            <>
              <div className="modal-content min-w-0">
                <div className="flex flex-col gap-4">
                  <div className="px-3 py-2.5 rounded-md bg-surface border border-line">
                    <div className="font-medium text-sm">{contractCode}</div>
                  </div>

                  <div>
                    <label className="form-label">{t('workspace.billPreview')}</label>
                    <BillCart
                      branchId={figures?.branch_id ?? null}
                      systemLines={systemLines}
                      lines={cartLines}
                      onChange={setCartLines}
                      flushAmounts
                    />
                  </div>

                  {/* The figures run flush to the right edge. Once an added line
                      brings a remove button, the summary gains that column and
                      the amount box takes the same inset so the totals still line up. */}
                  {nothingToCollect ? (
                    <div className="alert alert-info">
                      <CheckCircle size={16} />
                      <div>
                        <div className="alert-title">{t('wizard.noChargeTitle')}</div>
                        <div className="alert-description">{t('wizard.noChargeBody')}</div>
                      </div>
                    </div>
                  ) : (
                    <div className={`border border-line rounded-md py-2.5 flex items-center justify-between gap-3 ${cartLines.length > 0 ? 'pl-3 pr-[3.25rem]' : 'px-3'}`}>
                      <div className="min-w-0">
                        <div className="text-xs text-subtle">{t('wizard.paymentMethods')}</div>
                        <div className="text-sm font-medium">{t('paymentMethod.PARTNER_COLLECT')}</div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-xs text-subtle">{t('contract.collectDownToCollect')}</div>
                        <div className="text-lg font-semibold tabular-nums" data-testid="collect-down-total">
                          {figures ? fmtCurrency(previewTotal) : '—'}
                        </div>
                      </div>
                    </div>
                  )}

                  {(blockers.length > 0 || readinessWarnings.length > 0) && (
                    <div className="flex flex-col gap-2">
                      <ReadinessChecklist
                        errors={blockers}
                        warnings={readinessWarnings}
                        contractId={contractId}
                        onRecheck={() => {
                          setOpenBlockers(null);
                          queryClient.invalidateQueries({ queryKey: ['contract-readiness', contractId] });
                        }}
                        showHeadline={!!openBlockers?.length}
                      />
                      {blockers.length > 0 && (
                        <div>
                          <Button
                            size="sm"
                            variant="outline"
                            startIcon={<Pencil size={14} />}
                            onClick={() => navigate(`/admin/contracts/new/${contractId}${contractMenuFrom(location.pathname)}`)}
                          >
                            {t('contract.collectDownFixOnEditor')}
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
              <ModalErrorBand message={error} onDismiss={() => setError(null)} />
              <div className="modal-footer">
                <Button variant="ghost" onClick={handleClose} disabled={loading}>{t('common.cancel')}</Button>
                <Button
                  color="primary"
                  onClick={() => void confirm()}
                  disabled={!canConfirm}
                  data-action="COLLECT_DOWN_CONFIRM"
                  startIcon={loading ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle size={16} />}
                >
                  {loading
                    ? t('common.loading')
                    : nothingToCollect ? t('wizard.confirmOpenNoCharge') : t('contract.collectDownConfirm')}
                </Button>
              </div>
            </>
          )}
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmDiscard}
        onClose={() => setConfirmDiscard(false)}
        onConfirm={forceClose}
        title={t('common.unsavedChanges')}
        message={t('common.unsavedChangesMessage')}
        confirmLabel={t('common.discard')}
      />
    </>
  );
}
