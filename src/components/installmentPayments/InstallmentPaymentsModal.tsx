// "Payments of this installment": every time money went into one installment,
// the bill it came from, and the slip (or a method icon when there is none).
// Read-only. All facts come from fn_installment_payments; nothing is summed here.

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Button, Modal } from 'tsp-form';
import {
  Banknote, Building2, CircleDollarSign, CreditCard, Info, Landmark, Lock, PiggyBank,
  Receipt, Repeat, ShieldCheck, Store,
} from 'lucide-react';
import { ApiError } from '../../lib/api';
import { fmtCurrency } from '../../lib/format';
import { normalizeKey } from '../../lib/mediaPath';
import { DateTime } from '../DateTime';
import { MediaLightboxKeyGallery, MediaThumbButton } from '../MediaLightbox';
import { useInstallmentPayments, type InstallmentPayment, type PaymentPart } from './installmentPaymentsApi';

const METHOD_ICON: Record<string, typeof Banknote> = {
  CASH: Banknote,
  TRANSFER: Landmark,
  PARTNER_COLLECT: Store,
  SAVING_WALLET: PiggyBank,
  CREDIT_WALLET: CreditCard,
  INSURANCE_WALLET: ShieldCheck,
  HOLDING_BUDGET: Building2,
  INTERNAL: Repeat,
};

/** The parts of a payment; a row without parts falls back to its own summary fields. */
function partsOf(p: InstallmentPayment): PaymentPart[] {
  if (p.payment_parts?.length) return p.payment_parts;
  return [{
    payment_id: -p.txn_id, method: p.method, amount: p.bill.total_amount, submit_channel: p.submit_channel,
    created_at: p.paid_at, is_voided: p.is_reversed, recorded_by: p.recorded_by, has_slip: p.has_slip, slip: p.slip,
  }];
}

export function InstallmentPaymentsModal({ installmentId, onClose }: {
  installmentId: number | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { data, isLoading, error } = useInstallmentPayments(installmentId);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  // Thumbnails and the viewer come from this one list, so a click opens the
  // slip it was made from.
  const slipStrip = useMemo(() => {
    const strip: { paymentId: number; key: string }[] = [];
    for (const p of data?.payments ?? []) {
      for (const part of partsOf(p)) {
        if (part.slip?.storage_path) strip.push({ paymentId: part.payment_id, key: normalizeKey(part.slip.storage_path) });
      }
    }
    return strip;
  }, [data]);

  const errorText = error instanceof ApiError
    ? (error.messageKey ? t(error.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '') || error.message
    : error ? String(error) : null;

  const inst = data?.installment;
  const s = data?.summary;

  return (
    <Modal open={installmentId != null} onClose={onClose} maxWidth="40rem" width="100%" ariaLabel={t('installmentPayments.title', { n: inst?.pay_no ?? '' })}>
      <div className="flex flex-col overflow-hidden" style={{ maxHeight: '90dvh' }}>
        <div className="modal-header items-start">
          <div className="min-w-0 flex flex-col gap-0.5">
            <h2 className="modal-title inline-flex items-center gap-2">
              <Receipt size={16} />{t('installmentPayments.title', { n: inst?.pay_no ?? '' })}
            </h2>
            {inst && (
              <div className="text-xs text-subtle font-normal flex flex-wrap gap-x-3">
                <span>{inst.contract_code_display}</span>
                <span>{t('installmentPayments.due')} <DateTime value={inst.due_date} showTime={false} /></span>
              </div>
            )}
          </div>
          <button type="button" className="modal-close-btn shrink-0" onClick={onClose} aria-label={t('common.close')}>×</button>
        </div>

        <div className="modal-content flex flex-col gap-3 min-w-0">
          {isLoading && <div className="p-6 text-center text-subtle">{t('common.loading')}</div>}
          {errorText && <div className="alert alert-danger">{errorText}</div>}

          {inst && s && (
            <div className="px-3 py-2 rounded-md bg-surface border border-line text-sm flex flex-wrap items-baseline gap-x-4 gap-y-1" data-testid="installment-payments-summary">
              <span>
                {t('installmentPayments.paidOf')}{' '}
                <span className="font-semibold tabular-nums">฿{fmtCurrency(s.paid_total)}</span>
                <span className="text-subtle"> / ฿{fmtCurrency(inst.due_amount)}</span>
              </span>
              <span className="text-subtle text-xs">{t('installmentPayments.count', { n: s.payment_count })}</span>
              {s.slip_count > 0 && <span className="text-subtle text-xs">{t('installmentPayments.slips', { n: s.slip_count })}</span>}
              {s.no_slip_count > 0 && <span className="text-subtle text-xs">{t('installmentPayments.noSlips', { n: s.no_slip_count })}</span>}
              {s.reversed_count > 0 && <span className="text-danger-fg text-xs">{t('installmentPayments.reversedCount', { n: s.reversed_count })}</span>}
            </div>
          )}

          {data && data.payments.length === 0 && (
            <div className="p-6 text-center text-subtle">{t('installmentPayments.empty')}</div>
          )}

          {data?.payments.map((p) => (
            <PaymentCard
              key={p.txn_id}
              payment={p}
              onOpenSlip={(paymentId) => {
                const i = slipStrip.findIndex((x) => x.paymentId === paymentId);
                if (i >= 0) setLightboxIndex(i);
              }}
            />
          ))}
        </div>

        <div className="modal-footer">
          <Button variant="outline" onClick={onClose}>{t('common.close')}</Button>
        </div>
      </div>

      <MediaLightboxKeyGallery
        open={lightboxIndex !== null}
        onClose={() => setLightboxIndex(null)}
        mediaKeys={slipStrip.map((x) => x.key)}
        index={lightboxIndex ?? 0}
        onIndexChange={setLightboxIndex}
        alt="slip"
      />
    </Modal>
  );
}

function PaymentCard({ payment: p, onOpenSlip }: { payment: InstallmentPayment; onOpenSlip: (paymentId: number) => void }) {
  const { t } = useTranslation();
  const parts = partsOf(p);
  return (
    <div
      className={`border rounded-md px-3 py-2.5 flex flex-col gap-2 ${p.is_reversed ? 'border-line bg-surface' : 'border-line'}`}
      data-testid="installment-payment"
      data-reversed={p.is_reversed ? 'true' : undefined}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1 flex flex-col gap-0.5">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <DateTime value={p.paid_at} />
            {p.kind === 'EARLY_PAYOFF' && <Badge size="xs" color="info">{t('installmentPayments.kind.EARLY_PAYOFF')}</Badge>}
            {p.is_reversed && (
              <Badge size="xs" color="danger">{t('installmentPayments.reversed')}</Badge>
            )}
          </div>
          <div className="text-xs text-subtle flex flex-wrap gap-x-2">
            <span>{t('installmentPayments.bill')} {p.bill.code_display}</span>
            {p.bill.total_amount !== p.amount && (
              <span>· {t('installmentPayments.billTotal')} ฿{fmtCurrency(p.bill.total_amount)}</span>
            )}
            {p.is_reversed && p.reversed_at && (
              <span className="text-danger-fg">· {t('installmentPayments.reversedAt')} <DateTime value={p.reversed_at} /></span>
            )}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className={`font-semibold tabular-nums ${p.is_reversed ? 'line-through text-subtle' : ''}`}>฿{fmtCurrency(p.amount)}</div>
          <div className="text-xs text-subtle">{t('installmentPayments.toThis')}</div>
        </div>
      </div>

      {p.also_pays.length > 0 && (
        <div className="text-xs text-info-fg flex items-start gap-1.5" data-testid="installment-payment-also-pays">
          <Info size={13} className="shrink-0 mt-0.5" />
          <span>
            {t('installmentPayments.alsoPays')}{' '}
            {p.also_pays.map((a) => t('installmentPayments.alsoPaysItem', { n: a.pay_no, amount: fmtCurrency(a.amount) })).join(' · ')}
          </span>
        </div>
      )}

      {parts.length > 1 && (
        <div className="text-xs text-subtle">{t('installmentPayments.parts', { n: parts.length })}</div>
      )}
      <div className="flex flex-col gap-2">
        {parts.map((part) => <PartRow key={part.payment_id} part={part} onOpenSlip={() => onOpenSlip(part.payment_id)} />)}
      </div>
    </div>
  );
}

function PartRow({ part, onOpenSlip }: { part: PaymentPart; onOpenSlip: () => void }) {
  const { t } = useTranslation();
  const Icon = METHOD_ICON[part.method] ?? CircleDollarSign;
  const slipHidden = part.has_slip && !part.slip;
  const channel = part.submit_channel === 'CUSTOMER_SUBMIT' || part.submit_channel === 'BRANCH_SUBMIT'
    ? t(`installmentPayments.channel.${part.submit_channel}`)
    : null;
  const box = 'w-14 h-14 rounded-md border border-line bg-surface flex items-center justify-center shrink-0';

  return (
    <div className="flex items-center gap-3" data-testid="installment-payment-part" data-method={part.method} data-has-slip={part.has_slip ? 'true' : 'false'}>
      {part.slip?.storage_path ? (
        <MediaThumbButton
          mediaKey={normalizeKey(part.slip.storage_path)}
          alt="slip"
          className="w-14 h-14 rounded-md border border-line overflow-hidden bg-surface cursor-zoom-in p-0 shrink-0"
          onClick={onOpenSlip}
        />
      ) : slipHidden ? (
        <div className={`${box} text-subtle`}><Lock size={20} /></div>
      ) : part.has_slip ? (
        <div className={`${box} text-subtle`}><Receipt size={20} /></div>
      ) : (
        <div className={`${box} text-subtle`}><Icon size={22} /></div>
      )}

      <div className={`min-w-0 flex-1 flex flex-col gap-0.5 text-sm ${part.is_voided ? 'line-through text-subtle' : ''}`}>
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-medium">{t(`paymentMethod.${part.method}`, { defaultValue: part.method })}</span>
          <span className="tabular-nums">฿{fmtCurrency(part.amount)}</span>
          {channel && <span className="text-xs text-subtle">· {channel}</span>}
        </div>
        {part.slip && (
          <div className="text-xs text-subtle">
            {t('installmentPayments.slip')} {part.slip.code_display}
            {part.slip.transfer_at && <> · {t('installmentPayments.transferAt')} <DateTime value={part.slip.transfer_at} /></>}
            {!part.slip.storage_path && <> · {t('installmentPayments.noImage')}</>}
          </div>
        )}
        {slipHidden && (
          <div className="text-xs text-warning-fg no-underline" data-testid="installment-payment-slip-hidden">{t('installmentPayments.slipHidden')}</div>
        )}
        {part.recorded_by?.username && (
          <div className="text-xs text-subtle">{t('installmentPayments.recordedBy')} {part.recorded_by.username}</div>
        )}
      </div>
    </div>
  );
}
