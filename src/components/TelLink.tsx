// A phone number that dials on a phone (tel: link) and says when it does not
// look like a Thai number; and the tick / warning mark used beside any number
// that was checked (phone format, ID-card check digit). Shared by the credit
// reviewer's case view and the customer page.

import { useTranslation } from 'react-i18next';
import { Tooltip } from 'tsp-form';
import { Phone, CheckCircle2, AlertTriangle } from 'lucide-react';
import { formatTel } from '../lib/format';
import { thaiPhoneReason } from '../lib/validators';

export function TelLink({ tel }: { tel: string }) {
  const { t } = useTranslation();
  const reason = thaiPhoneReason(tel);
  const d = tel.replace(/\D/g, '');
  return (
    <span className="inline-flex items-center gap-1.5 shrink-0">
      <a
        href={`tel:${d}`}
        className="text-sm text-primary-fg hover:underline inline-flex items-center gap-1 tabular-nums"
      >
        <Phone size={12} />{formatTel(d)}
      </a>
      {reason && <ValidMark ok={false} tip={t(`partnerCase.phoneInvalid_${reason}`)} />}
    </span>
  );
}

/** Tick or warning beside a number that was checked, with why on hover. */
export function ValidMark({ ok, tip }: { ok: boolean; tip: string }) {
  return (
    <Tooltip content={tip} placement="top">
      <span className="inline-flex" aria-label={tip}>
        {ok
          ? <CheckCircle2 size={13} className="text-success-fg" />
          : <AlertTriangle size={13} className="text-danger-fg" />}
      </span>
    </Tooltip>
  );
}
