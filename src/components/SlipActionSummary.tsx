// The target box at the top of a slip action window (reject / reopen): which
// slip, how much, whose contract — and, when reopening, who rejected it and why,
// since that is what the person is deciding to undo.
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import { DateTime } from './DateTime';
import { fmtCurrency } from '../lib/format';
import type { SubmissionRow } from './SubmissionReviewPanel';

export function SlipActionSummary({ row, showRejection = false }: {
  row: SubmissionRow;
  showRejection?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="px-3 py-2.5 rounded-md bg-surface border border-line text-sm">
      <div className="flex items-baseline gap-2 min-w-0">
        <span className="font-medium truncate">{row.code_display ?? `#${row.id}`}</span>
        <span className="flex-1" />
        <span className="font-medium tabular-nums shrink-0">{fmtCurrency(row.amount)}</span>
      </div>
      <div className="text-xs text-subtle mt-0.5 flex items-center gap-1.5 min-w-0">
        {/* New tab: checking the contract mid-form must not lose what was typed. */}
        <Link
          to={`/admin/contracts/search/${row.contract_id}`}
          target="_blank"
          className="text-primary-fg no-underline hover:underline inline-flex items-center gap-1 shrink-0"
        >
          {row.contract_code_display}
          <ExternalLink size={12} />
        </Link>
        {row.customer_name && <><span>·</span><span className="truncate">{row.customer_name}</span></>}
      </div>
      {showRejection && (row.reject_reason || row.reviewer_name) && (
        <div className="mt-2 pt-2 border-t border-line text-xs">
          <div className="text-subtle">
            {t('paymentSubmissions.reviewedBy')} {row.reviewer_name ?? '—'}
            {row.reviewed_at && <> · <DateTime value={row.reviewed_at} showTime /></>}
          </div>
          {row.reject_reason && (
            <div className="mt-0.5">
              <span className="text-subtle">{t('paymentSubmissions.rejectReason')}: </span>
              {row.reject_reason}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** The contract code in a done view — a real link (ctrl/middle-click opens a new tab). */
export function ContractLink({ row, onNavigate }: { row: SubmissionRow; onNavigate: () => void }) {
  return (
    <Link
      to={`/admin/contracts/search/${row.contract_id}`}
      className="text-primary-fg no-underline hover:underline inline-flex items-center gap-1"
      onClick={(e) => { if (e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey) onNavigate(); }}
    >
      {row.contract_code_display}
      <ExternalLink size={12} />
    </Link>
  );
}
