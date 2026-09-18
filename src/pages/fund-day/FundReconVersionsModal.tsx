// The edit trail for one day + one account (UI_SUMMARY/148 §5).
//
// A reconciliation is never overwritten: each save writes a new version with the
// reason it was re-done, so this reads top-down as "what we believed, and when we
// changed our mind". Read-only, so no dirty-form guard is needed.

import { useTranslation } from 'react-i18next';
import { Button, Modal } from 'tsp-form';
import { Loader2 } from 'lucide-react';
import { DateTime } from '../../components/DateTime';
import { fmtCurrency } from '../../lib/format';
import { useFundReconVersions } from './useFundDay';

interface FundReconVersionsModalProps {
  open: boolean;
  companyId: number | null;
  /** Null while nothing is selected — reads inside are guarded. */
  date: string | null;
  accountKey: string | null;
  accountLabel: string | null;
  onClose: () => void;
}

export function FundReconVersionsModal({
  open, companyId, date, accountKey, accountLabel, onClose,
}: FundReconVersionsModalProps) {
  const { t } = useTranslation();
  const { data: versions, isLoading } = useFundReconVersions(companyId, date, accountKey);

  return (
    <Modal open={open} onClose={onClose} maxWidth="38rem" width="100%" ariaLabel={t('fundDay.versionsTitle')}>
      <div className="modal-header">
        <h2 className="modal-title">{t('fundDay.versionsTitle')}</h2>
        <button type="button" className="modal-close-btn" onClick={onClose}>{'×'}</button>
      </div>
      <div className="modal-content min-w-0">
        <div className="px-3 py-2.5 rounded-md bg-surface border border-line mb-4">
          <div className="font-medium text-sm">{accountLabel ?? accountKey ?? '—'}</div>
          <div className="text-xs text-subtle">{date ?? '—'}</div>
        </div>

        {isLoading && (
          <div className="flex items-center gap-2 text-sm text-subtle">
            <Loader2 size={14} className="animate-spin" />
            <span>{t('common.loading')}</span>
          </div>
        )}

        {!isLoading && (!versions || versions.length === 0) && (
          <div className="text-sm text-subtler">{t('fundDay.versionsEmpty')}</div>
        )}

        <div className="flex flex-col gap-2">
          {(versions ?? []).map(v => (
            <div key={v.version} className="border border-line rounded-md px-3 py-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="font-medium text-sm">
                  {t('fundDay.reconVersion', { version: v.version })}
                </span>
                <span className="text-xs text-subtle">
                  <DateTime value={v.saved_at} showTime />
                  {v.saved_by_name ? ` · ${v.saved_by_name}` : ''}
                </span>
              </div>
              <div className="mt-1 text-sm tabular-nums flex flex-wrap gap-x-4 gap-y-0.5">
                <span>{t('fundDay.countedIn')}: {fmtCurrency(v.counted_in)}</span>
                <span>{t('fundDay.countedOut')}: {fmtCurrency(v.counted_out)}</span>
                <span>{t('fundDay.systemAtSave')}: {fmtCurrency(v.system_in)} / {fmtCurrency(v.system_out)}</span>
              </div>
              <div className="mt-1 text-sm tabular-nums flex flex-wrap gap-x-4">
                <span>{t('fundDay.diffIn')}: {fmtCurrency(v.diff_in)}</span>
                <span>{t('fundDay.diffOut')}: {fmtCurrency(v.diff_out)}</span>
              </div>
              {v.note && <div className="mt-1 text-xs text-subtle">{t('fundDay.note')}: {v.note}</div>}
              {v.edit_reason && (
                <div className="mt-1 text-xs text-info-fg">
                  {t('fundDay.editReason')}: {v.edit_reason}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="modal-footer">
        <Button variant="primary" onClick={onClose}>{t('common.close')}</Button>
      </div>
    </Modal>
  );
}
