// The optional payment slip on a fund pay window (work order fund_day_close §Q
// item 1 · UI_SUMMARY/149 §9c).
//
// Photos are staged locally while the form is open and only uploaded once the
// pay call has succeeded — the slip hangs off the movement the payment wrote,
// so there is nothing to attach it to before then. A slip that fails to attach
// never undoes the payment: the outcome is reported on the done view instead.

import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../lib/api';
import { translateApiError } from '../lib/apiErrors';
import { useAuth } from '../contexts/AuthContext';
import { findSlipPaymentId, uploadFundPaymentEvidenceFile } from '../lib/fundPaymentEvidence';

export type FundPaySlipOutcome =
  | { kind: 'attached'; count: number }
  | { kind: 'failed'; reason: string; attached: number; total: number };

export function useFundPaySlip() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [files, setFiles] = useState<File[]>([]);
  const [outcome, setOutcome] = useState<FundPaySlipOutcome | null>(null);

  const reset = useCallback(() => {
    setFiles([]);
    setOutcome(null);
  }, []);

  /**
   * Attach the staged photos after a successful pay. Never throws.
   * `paymentId` when the pay call returned one; else `billId` of the document
   * the movement was written on, and the movement is looked up.
   */
  const attach = async (target: { paymentId?: number | null; billId?: number | null }) => {
    if (files.length === 0) { setOutcome(null); return; }
    let attached = 0;
    try {
      let paymentId = target.paymentId ?? null;
      if (paymentId == null && target.billId != null) paymentId = await findSlipPaymentId(target.billId);
      if (paymentId == null) throw new Error(t('fundPaySlip.noMovement'));
      if (user?.holding_id == null) throw new Error(t('fundPaySlip.noHolding'));
      for (const file of files) {
        await uploadFundPaymentEvidenceFile(paymentId, file, user.holding_id);
        attached += 1;
      }
      queryClient.invalidateQueries({ queryKey: ['fund-payment-evidence', paymentId] });
      setOutcome({ kind: 'attached', count: attached });
    } catch (err) {
      const reason = err instanceof ApiError
        ? translateApiError(err, t)
        : err instanceof Error ? err.message : String(err);
      setOutcome({ kind: 'failed', reason, attached, total: files.length });
    }
  };

  return { files, setFiles, outcome, reset, attach };
}

export type FundPaySlip = ReturnType<typeof useFundPaySlip>;

/** Done-view rows: how many slips went on. None when no slip was added. */
export function fundPaySlipDoneRows(
  slip: FundPaySlip,
  t: (key: string, opts?: Record<string, unknown>) => string,
): { label: string; value: string }[] {
  if (slip.outcome?.kind !== 'attached') return [];
  return [{ label: t('fundPaySlip.doneLabel'), value: t('fundPaySlip.attached', { count: slip.outcome.count }) }];
}
