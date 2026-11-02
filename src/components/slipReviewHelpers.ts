import type { SubmissionRow } from './SubmissionReviewPanel';

/** Who reviewed the slip. reviewed_by 0 is the system (mig 1597: a duplicate
 *  image is rejected on arrival), which has no name. */
export function slipReviewerName(row: SubmissionRow, t: (key: string) => string): string {
  if (row.reviewed_by === 0) return t('paymentSubmissions.reviewedBySystem');
  return row.reviewer_name ?? '—';
}

/** Another slip with the same image was already rejected: nothing is wrong with
 *  this one, so the signal stays quiet. A different customer is never quiet. */
export function isQuietDuplicate(row: SubmissionRow): boolean {
  return row.is_duplicate_slip && row.dup_cross_customer !== true && row.dup_first_status === 'REJECTED';
}
