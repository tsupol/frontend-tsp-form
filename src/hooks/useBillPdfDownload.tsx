// ============================================================================
// useBillPdfDownload — one-call "Download PDF" for a bill id, reusable on any
// page that shows a bill (BillsPage, contract detail, etc.).
//
// Fetches v_bill_detail + the branch, builds the shared BillDoc (same block tree
// the receipt renders), and downloads it via pdfmake (src/lib/billDocPdf.ts).
// This exists because browser-print (window.print()) can't isolate the receipt
// on iPad Safari — a real PDF is device-independent.
//
// Pass the bill id to `download(billId)` at call time, so one hook instance
// serves a list of bills (e.g. ContractDetailPanel's bills tab). `downloadingId`
// is the id currently being fetched (or null) — use it to spin only that row's
// button; `downloading` is the boolean convenience for single-bill pages.
// Errors surface as a danger snackbar.
// ============================================================================

import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { useSnackbarContext } from 'tsp-form';
import { apiClient, ApiError } from '../lib/api';
import { buildBillDocFromDetail, type BillDetailBranch, type BillDetailLike } from '../lib/billDetailToDoc';
import { downloadBillDocPdf } from '../lib/billDocPdf';

// The v_bill_detail row carries everything BillDetailLike needs plus branch_id.
type BillDetailRow = BillDetailLike & { branch_id: number };

export function useBillPdfDownload() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();
  const [downloadingId, setDownloadingId] = useState<number | null>(null);

  const download = useCallback(async (billId: number | null | undefined) => {
    if (billId == null) return;
    setDownloadingId(billId);
    try {
      const bill = await queryClient.fetchQuery({
        queryKey: ['bill-detail', billId],
        queryFn: () =>
          apiClient.get<BillDetailRow[]>(`/v_bill_detail?bill_id=eq.${billId}`).then(rows => rows[0] ?? null),
      });
      if (!bill) return;
      const branch = bill.branch_id == null
        ? null
        : await queryClient.fetchQuery({
            queryKey: ['branch-info', bill.branch_id],
            queryFn: () =>
              apiClient
                .get<BillDetailBranch[]>(`/v_branches?id=eq.${bill.branch_id}&select=name,address`)
                .then(b => b[0] ?? null),
            staleTime: 5 * 60 * 1000,
          });
      const doc = buildBillDocFromDetail(bill, branch ?? null, t, i18n.language);
      await downloadBillDocPdf(doc, t, bill.bill_code_display || `bill-${billId}`);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t('common.error', { defaultValue: 'Error' });
      addSnackbar({ message: <div className="alert alert-danger">{message}</div> });
    } finally {
      setDownloadingId(null);
    }
  }, [queryClient, t, i18n.language, addSnackbar]);

  return { downloadingId, downloading: downloadingId != null, download };
}
