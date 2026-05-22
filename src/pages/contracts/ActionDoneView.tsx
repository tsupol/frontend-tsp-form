import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Button, Modal } from 'tsp-form';
import { AlertTriangle, ArrowRight, CheckCircle, Info, XOctagon } from 'lucide-react';
import { BillReceipt } from './workspace/BillReceipt';

export type ActionDoneTone = 'success' | 'warning' | 'danger' | 'neutral';

export type BadgeColor = 'default' | 'info' | 'success' | 'warning' | 'danger';

export interface ActionDoneDetailRow {
  label: string;
  value: ReactNode;
  emphasis?: boolean;
}

export interface ActionDoneStateTransition {
  from: string;
  to: string;
  /** Badge color for the "to" state. Defaults match the action tone. */
  toColor?: BadgeColor;
  /** Badge color for the "from" state. Defaults to "info". */
  fromColor?: BadgeColor;
}

export interface ActionDoneSecondaryAction {
  label: string;
  /** Called BEFORE onClose so the parent can navigate/select. The done view itself does not call onClose after — the secondary's onClick should call onClose if it wants to dismiss. */
  onClick: () => void;
  startIcon?: ReactNode;
  endIcon?: ReactNode;
}

export interface ActionDoneViewProps {
  /** Big bold headline (e.g. "Payment recorded", "Contract terminated"). */
  headline: string;
  /** Subtitle shown under the headline — typically a contract code, PO code, or asset code. */
  contractCode: string;
  /** Action tone — drives icon + accent color. Default: success. */
  tone?: ActionDoneTone;
  /** Optional state badge: from → to. */
  stateTransition?: ActionDoneStateTransition;
  /** Receipt-style key/value rows. */
  detailRows?: ActionDoneDetailRow[];
  /** Free-form slot below the rows (banners, device movements, lists). */
  extras?: ReactNode;
  /** If set, a secondary "View bill" button opens a nested receipt modal for this bill id. */
  billId?: number | null;
  /** Optional explicit secondary button (e.g. "Open PO", "View asset"). Rendered to the left of Done. Ignored if billId is also set — billId takes precedence. */
  secondaryAction?: ActionDoneSecondaryAction;
  /** Done button label override. Default: t('common.done'). */
  doneLabel?: string;
  /** Done button color override. Default: 'primary'. */
  doneColor?: 'primary' | 'danger';
  /** Required — closes the parent modal. */
  onClose: () => void;
}

const TONE_ICON = {
  success: CheckCircle,
  warning: AlertTriangle,
  danger: XOctagon,
  neutral: Info,
} as const;

const TONE_COLOR_CLASS: Record<ActionDoneTone, string> = {
  success: 'text-success',
  warning: 'text-warning-fg',
  danger: 'text-danger',
  neutral: 'text-info-fg',
};

/**
 * Stay-open success view for contract action modals.
 *
 * Replaces the pattern of auto-close + snackbar with an in-modal confirmation
 * showing what actually happened — bill code, state transition, asset movements,
 * etc. — so the user can verify the result before dismissing.
 *
 * The host modal renders this inside its `modal-content` area. This component
 * provides the modal-content body and the modal-footer.
 */
export function ActionDoneView({
  headline,
  contractCode,
  tone = 'success',
  stateTransition,
  detailRows,
  extras,
  billId,
  secondaryAction,
  doneLabel,
  doneColor = 'primary',
  onClose,
}: ActionDoneViewProps) {
  const { t } = useTranslation();
  const [showBill, setShowBill] = useState(false);

  const Icon = TONE_ICON[tone];
  const iconClass = TONE_COLOR_CLASS[tone];

  // Default "to" badge color from tone
  const toColor: BadgeColor = stateTransition?.toColor
    ?? (tone === 'success' ? 'success'
      : tone === 'warning' ? 'warning'
      : tone === 'danger' ? 'danger'
      : 'info');
  const fromColor: BadgeColor = stateTransition?.fromColor ?? 'info';

  return (
    <>
      <div className="modal-content">
        <div className="flex flex-col items-center gap-2 pt-2 pb-2 text-center">
          <Icon size={48} className={iconClass} />
          <div className="text-lg font-semibold">{headline}</div>
          <div className="text-sm text-subtle">{contractCode}</div>
        </div>

        {stateTransition && (
          <div className="mt-3 flex items-center justify-center gap-2 flex-wrap">
            <Badge color={fromColor} size="sm">{stateTransition.from}</Badge>
            <ArrowRight size={14} className="text-subtle" />
            <Badge color={toColor} size="sm">{stateTransition.to}</Badge>
          </div>
        )}

        {detailRows && detailRows.length > 0 && (
          <div className="mt-4 rounded-md border border-line overflow-hidden">
            {detailRows.map((row, i) => (
              <div key={i} className="flex items-center justify-between px-3 py-2 border-b border-line last:border-b-0">
                <span className="text-sm text-subtle">{row.label}</span>
                <span className={`text-sm tabular-nums ${row.emphasis ? 'font-semibold' : ''}`}>
                  {row.value}
                </span>
              </div>
            ))}
          </div>
        )}

        {extras && <div className="mt-3">{extras}</div>}
      </div>

      <div className="modal-footer">
        {billId != null ? (
          <Button variant="outline" onClick={() => setShowBill(true)}>
            {t('contract.action_viewBill', { defaultValue: 'View bill' })}
          </Button>
        ) : secondaryAction && (
          <Button
            variant="outline"
            onClick={secondaryAction.onClick}
            startIcon={secondaryAction.startIcon}
            endIcon={secondaryAction.endIcon}
          >
            {secondaryAction.label}
          </Button>
        )}
        <Button color={doneColor} onClick={onClose}>
          {doneLabel ?? t('common.done', { defaultValue: 'Done' })}
        </Button>
      </div>

      {/* Nested receipt modal */}
      {billId != null && (
        <Modal
          open={showBill}
          onClose={() => setShowBill(false)}
          maxWidth="26rem"
          width="100%"
          ariaLabel={t('wizard.receipt_title')}
        >
          <div className="modal-content py-6 px-4" style={{ background: 'color-mix(in srgb, var(--color-fg) 6%, transparent)' }}>
            <BillReceipt billId={billId} />
          </div>
        </Modal>
      )}
    </>
  );
}
