// Fund day close §D1 hooks — see src/lib/billDay.ts for the contract.

import { useCallback, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Modal, Button } from 'tsp-form';
import { apiClient } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { billDayReasonText, type BillDay } from '../lib/billDay';

export function useBillDatePreview(
  branchId: number | null | undefined,
  billPurpose: string,
  enabled: boolean,
  billType: string = 'INVOICE',
) {
  return useQuery({
    queryKey: ['bill-date-preview', branchId, billPurpose, billType],
    queryFn: () => apiClient.rpc<BillDay>('fn_bill_date_preview', {
      p_branch_id: branchId,
      p_bill_purpose: billPurpose,
      p_bill_type: billType,
    }),
    enabled: enabled && branchId != null,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
}

/**
 * The SHIFTED confirm step. `guard(run)` re-reads the preview right before the
 * press (the fund may have closed while the box was open), then either runs
 * straight away or asks first. Render `dialog` once, next to the host modal.
 */
export function useBillDayConfirm(preview: { refetch: () => Promise<{ data?: BillDay }> ; data?: BillDay }) {
  const { t, i18n } = useTranslation();
  const [pending, setPending] = useState<BillDay | null>(null);
  const runRef = useRef<(() => void) | null>(null);
  // Keep the last dialog content through the close transition.
  const lastRef = useRef<BillDay | null>(null);
  if (pending) lastRef.current = pending;
  const shown = pending ?? lastRef.current;

  const guard = useCallback(async (run: () => void) => {
    let day = preview.data;
    try {
      const fresh = await preview.refetch();
      if (fresh.data) day = fresh.data;
    } catch { /* a failed preview never blocks */ }
    if (day?.state === 'SHIFTED') {
      runRef.current = run;
      setPending(day);
      return;
    }
    run();
  }, [preview]);

  const cancel = () => { runRef.current = null; setPending(null); };
  const confirm = () => {
    const run = runRef.current;
    runRef.current = null;
    setPending(null);
    run?.();
  };

  const dialog: ReactNode = (
    <Modal open={!!pending} onClose={cancel} maxWidth="26rem" width="100%" ariaLabel={t('billDay.confirmTitle')}>
      <div className="modal-header">
        <h2 className="modal-title">{t('billDay.confirmTitle')}</h2>
        <button type="button" className="modal-close-btn" onClick={cancel}>&times;</button>
      </div>
      <div className="modal-content">
        <p>
          {t('billDay.confirmBody', {
            billDate: formatDateTime(shown?.bill_date ?? null, i18n.language, false),
            reason: billDayReasonText(shown?.reason_code, t),
            closedDate: formatDateTime(shown?.closed_date ?? null, i18n.language, false),
            closedAt: formatDateTime(shown?.closed_at ?? null, i18n.language, true),
          })}
        </p>
        <p className="text-sm text-subtle mt-2">{t('billDay.confirmCustomerNote')}</p>
      </div>
      <div className="modal-footer">
        <Button variant="ghost" onClick={cancel}>{t('common.cancel')}</Button>
        <Button color="primary" onClick={confirm}>{t('billDay.confirmGo')}</Button>
      </div>
    </Modal>
  );

  return { guard, dialog };
}

