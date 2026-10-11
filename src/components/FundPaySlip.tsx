// Screen pieces for the optional payment slip on the five fund pay windows.
// State + upload live in src/hooks/useFundPaySlip.ts.

import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';
import { FUND_PAYMENT_EVIDENCE_MAX } from '../lib/beMedia';
import type { FundPaySlip } from '../hooks/useFundPaySlip';
import { MultiImageUploader } from './MultiImageUploader';

/** The form field: a strip of staged photos, uploaded after the pay succeeds. */
export function FundPaySlipField({ slip, disabled, onError }: {
  slip: FundPaySlip;
  disabled?: boolean;
  onError: (message: string) => void;
}) {
  const { t } = useTranslation();
  const { files, setFiles } = slip;
  return (
    <div className="flex flex-col">
      <label className="form-label">{t('fundPaySlip.label')}</label>
      <MultiImageUploader
        items={files.map((file, i) => ({ kind: 'staged' as const, id: String(i), file }))}
        onAdd={added => setFiles(prev => [...prev, ...added].slice(0, FUND_PAYMENT_EVIDENCE_MAX))}
        onRemove={item => setFiles(prev => prev.filter((_, i) => String(i) !== item.id))}
        max={FUND_PAYMENT_EVIDENCE_MAX}
        disabled={disabled}
        busyLabel={disabled && files.length > 0 ? t('fundPaySlip.uploading') : undefined}
        onError={onError}
      />
      <span className="text-xs text-subtle mt-1">{t('fundPaySlip.hint')}</span>
    </div>
  );
}

/** Done-view notice when the payment went through but the slip did not. */
export function FundPaySlipFailedNotice({ slip }: { slip: FundPaySlip }) {
  const { t } = useTranslation();
  const o = slip.outcome;
  if (o?.kind !== 'failed') return null;
  return (
    <div className="alert alert-warning">
      <AlertTriangle size={16} className="shrink-0" />
      <div className="flex flex-col gap-1">
        <span>{t('fundPaySlip.failed', { reason: o.reason })}</span>
        {o.attached > 0 && (
          <span className="text-xs">{t('fundPaySlip.partlyAttached', { attached: o.attached, total: o.total })}</span>
        )}
        <span className="text-xs">{t('fundPaySlip.addLater')}</span>
      </div>
    </div>
  );
}
