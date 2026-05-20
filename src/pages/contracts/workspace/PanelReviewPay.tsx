import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Button } from 'tsp-form';
import { Star, XCircle, Loader2, CheckCircle, AlertTriangle, Info, CreditCard } from 'lucide-react';
import { apiClient, ApiError } from '../../../lib/api';
import { fmtCurrency } from '../../../lib/format';
import { useWorkspace } from './WorkspaceContext';
import type { BillOpenResult } from './WorkspaceTypes';
import { ERROR_TO_MODAL } from './WorkspaceTypes';

const SCORE_TOOLTIPS: Record<number, string> = {
  1: 'workspace.score1',
  2: 'workspace.score2',
  3: 'workspace.score3',
  4: 'workspace.score4',
  5: 'workspace.score5',
};

interface ReadinessResult {
  ready: boolean;
  errors: Array<{ code: string; detail?: Record<string, unknown> }>;
}

export function PanelReviewPay({ onClose: _onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data, updateData, contract, invalidateContract, setOpenModal } = useWorkspace();

  // ── Confidence score ────────────────────────────────────────────────
  const [pendingScore, setPendingScore] = useState<number | null>(null);
  const serverScore = contract?.staff_confidence_score ?? null;
  const score = pendingScore ?? serverScore;
  useEffect(() => {
    if (serverScore != null && serverScore === pendingScore) setPendingScore(null);
  }, [serverScore, pendingScore]);

  const [scoreSaving, setScoreSaving] = useState(false);
  const [scoreError, setScoreError] = useState('');
  const [hoverStar, setHoverStar] = useState(0);

  const handleSetScore = async (n: number) => {
    if (!data.contractId) return;
    setScoreSaving(true);
    setScoreError('');
    setPendingScore(n);
    try {
      await apiClient.rpc('fn_contract_set_staff_confidence_score', {
        p_contract_id: data.contractId,
        p_score: n,
      });
      invalidateContract();
    } catch (err) {
      setPendingScore(null);
      if (err instanceof ApiError) {
        const tr = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
          || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
        setScoreError(tr || err.message);
      } else {
        setScoreError(String(err));
      }
    } finally {
      setScoreSaving(false);
    }
  };

  // ── Bill preview (pre-activate) ──────────────────────────────────────
  const downPayment = contract?.down_payment ?? 0;
  const insuranceDeposit = contract?.insurance_deposit ?? 0;
  const previewTotal = downPayment + insuranceDeposit;

  // ── Readiness ────────────────────────────────────────────────────────
  const [readinessErrors, setReadinessErrors] = useState<Array<{ code: string }>>([]);
  const { data: readiness } = useQuery({
    queryKey: ['contract-readiness', data.contractId],
    queryFn: () => apiClient.rpc<ReadinessResult>('fn_contract_validate_ready', {
      p_contract_id: data.contractId,
    }),
    enabled: !!data.contractId && !data.billId,
    staleTime: 0,
  });
  useEffect(() => {
    if (readiness && !readiness.ready) setReadinessErrors(readiness.errors);
    else if (readiness?.ready) setReadinessErrors([]);
  }, [readiness]);

  // ── Activate ─────────────────────────────────────────────────────────
  const [activating, setActivating] = useState(false);
  const [activateError, setActivateError] = useState('');

  const activate = async () => {
    if (!data.contractId) return;
    setActivating(true);
    setActivateError('');
    setReadinessErrors([]);
    try {
      const bill = await apiClient.rpc<BillOpenResult>('fn_bill_contract_open', {
        p_contract_id: data.contractId,
      });
      updateData({ billId: bill.bill_id, billCode: bill.bill_code, billData: bill });
      invalidateContract();
    } catch (err) {
      if (err instanceof ApiError) {
        const tr = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
          || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
        setActivateError(tr || err.message);
        if (err.code && ERROR_TO_MODAL[err.code]) {
          setReadinessErrors([{ code: err.code }]);
        }
      } else {
        setActivateError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setActivating(false);
    }
  };

  // ── Post-activate success state ──────────────────────────────────────
  // After activate, the contract is in PENDING_PAYMENT with an open bill.
  // The pending-payment page surfaces the existing payment modal for this
  // contract via ContractActions.continue_pay.
  if (data.billId && data.contractId) {
    return (
      <div className="flex flex-col h-full max-w-2xl">
        <div className="flex-1 overflow-y-auto better-scroll p-4 flex flex-col gap-4">
          <div className="alert alert-success">
            <CheckCircle size={16} />
            <div>
              <div className="alert-title">{t('wizard.activatedTitle')}</div>
              <div className="alert-description">
                {t('wizard.activatedBody', { billCode: data.billCode || `#${data.billId}` })}
              </div>
            </div>
          </div>
        </div>
        <div className="shrink-0 border-t border-line bg-bg px-4 py-3 flex justify-end gap-2">
          <Button
            color="primary"
            startIcon={<CreditCard size={16} />}
            onClick={() => navigate(`/admin/contracts/pending-payment/${data.contractId}`)}
          >
            {t('wizard.goToPendingPayment')}
          </Button>
        </div>
      </div>
    );
  }

  // ── Pre-activate ─────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full max-w-2xl">
      <div className="flex-1 overflow-y-auto better-scroll p-4 flex flex-col gap-5">

        {/* ── Section 1: Staff Confidence Score ─────────────────── */}
        <div>
          <div className="text-sm font-medium mb-3">{t('workspace.confidenceLabel')}</div>

          <div className="flex items-center gap-1" onMouseLeave={() => setHoverStar(0)}>
            {[1, 2, 3, 4, 5].map(n => {
              const filled = n <= (hoverStar || score || 0);
              return (
                <button
                  key={n}
                  className="p-1 cursor-pointer bg-transparent border-none transition-transform hover:scale-110"
                  onClick={() => handleSetScore(n)}
                  onMouseEnter={() => setHoverStar(n)}
                  disabled={scoreSaving}
                  title={t(SCORE_TOOLTIPS[n])}
                >
                  <Star size={28} className={filled ? 'text-warning-fg fill-warning' : 'text-fg/20'} />
                </button>
              );
            })}
            {scoreSaving && <Loader2 size={16} className="animate-spin text-subtle ml-2" />}
          </div>

          {(hoverStar > 0 || score) && (
            <div className="text-xs text-subtle mt-1.5">
              {t(SCORE_TOOLTIPS[hoverStar || score || 3])}
            </div>
          )}

          {scoreError && (
            <div className="alert alert-danger mt-2">
              <XCircle size={14} />
              <span>{scoreError}</span>
            </div>
          )}

          {!score && (
            <div className="alert alert-warning mt-2">
              <AlertTriangle size={16} />
              <span>{t('workspace.confidenceRequired')}</span>
            </div>
          )}
        </div>

        {/* ── Section 2: Bill preview ─────────────────────────── */}
        <div>
          <label className="form-label">{t('workspace.billPreview')}</label>
          <div className="border border-line rounded-md overflow-hidden">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-line">
                {downPayment > 0 && (
                  <tr>
                    <td className="px-3 py-2">{t('contract.downPayment')}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtCurrency(downPayment)}</td>
                  </tr>
                )}
                {insuranceDeposit > 0 && (
                  <tr>
                    <td className="px-3 py-2">{t('contract.insuranceDeposit')}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtCurrency(insuranceDeposit)}</td>
                  </tr>
                )}
                <tr className="bg-surface font-medium">
                  <td className="px-3 py-2">{t('workspace.total')}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtCurrency(previewTotal)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Activate consequence callout ─────────────────────── */}
        <div className="alert alert-info">
          <Info size={16} />
          <span className="text-xs">{t('wizard.activateConsequence')}</span>
        </div>

        {/* ── Readiness errors ─────────────────────────────────── */}
        {readinessErrors.length > 0 && (
          <div className="flex flex-col gap-1.5">
            {readinessErrors.map((err, i) => {
              const targetModal = ERROR_TO_MODAL[err.code];
              return (
                <button
                  key={i}
                  className={`flex items-center gap-2 text-sm text-left w-full ${
                    targetModal ? 'text-danger hover:underline cursor-pointer' : 'text-danger cursor-default'
                  }`}
                  onClick={targetModal ? () => { setOpenModal(targetModal); } : undefined}
                  disabled={!targetModal}
                >
                  <XCircle size={14} className="shrink-0" />
                  <span>{t(err.code, { ns: 'apiErrors', defaultValue: err.code })}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* ── Activate error (non-readiness backend error) ─────── */}
        {activateError && !readinessErrors.length && (
          <div className="alert alert-danger">
            <XCircle size={16} />
            <div><div className="alert-description">{activateError}</div></div>
          </div>
        )}
      </div>

      {/* ── Footer ───────────────────────────────────────────── */}
      <div className="shrink-0 border-t border-line bg-bg px-4 py-3 flex justify-end gap-2">
        <Button
          color="primary"
          onClick={activate}
          disabled={!score || activating}
          startIcon={activating ? <Loader2 size={16} className="animate-spin" /> : <CreditCard size={16} />}
        >
          {activating ? t('wizard.activating') : t('wizard.activateAndPay')}
        </Button>
      </div>
    </div>
  );
}
