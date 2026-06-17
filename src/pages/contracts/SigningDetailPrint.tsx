// Printable signing-detail document — prints on the same 80mm thermal paper as
// the bill receipt (Xprinter XP-80C). Single-column, text + dividers; NO boxes,
// NO multi-column tables. Content only: which signing, the change, who signed.
//
// Pure presentation — receives fully-resolved data (including presigned
// signature image URLs) so the markup paints synchronously and the print dialog
// (opened two RAFs later by the host) captures a complete page. Mounted
// off-screen via a body portal under `.print-only-signing-detail`; isolation +
// @page come from the `.signing-detail-print` rules in app.css.
//
// See `.claude/print-pattern.md` for the shared browser-print pattern.

import { useTranslation } from 'react-i18next';
import { formatAssetCode, formatCid, formatDateTime, formatTel } from '../../lib/format';

export interface PrintParty {
  role: string;
  full_name: string | null;
  id_number: string | null;
  phone: string | null;
}

export interface SigningDetailPrintData {
  contract_code: string | null;
  signing_id: number;
  version_no: number | null;
  status: string;
  signing_type: string;
  change_reason: string | null;
  change_note: string | null;
  sealed_at: string | null;
  anchor_hash: string | null;
  /** Frozen agreed terms for this version (from legal_core.agreed). */
  agreed: {
    agreed_price: number | null;
    down_payment: number | null;
    insurance_deposit: number | null;
    installment_amount: number | null;
    value_month: number | null;
  } | null;
  /** Frozen device for this version (from legal_core.asset). */
  asset_code: string | null;
  parties: PrintParty[];
}

function fmtMoney(v: number | null, lang: string): string {
  if (v == null) return '—';
  return new Intl.NumberFormat(lang === 'th' ? 'th-TH' : 'en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(v);
}

export function SigningDetailPrint({ data }: { data: SigningDetailPrintData }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;

  const reasonLabel = data.change_reason
    ? t(`signing.reason_${data.change_reason}`, { defaultValue: data.change_reason })
    : t(`signing.type_${data.signing_type}`, { defaultValue: data.signing_type });

  return (
    <div className="signing-detail-print">
      {/* Header — centered title, then the identity line */}
      <div className="sdp-title">{t('signing.detailTitle', { defaultValue: 'Signing detail' })}</div>
      <div className="sdp-sub">
        {data.contract_code ?? `#${data.signing_id}`}
        {data.version_no != null && ` · v${data.version_no}`}
      </div>
      <div className="sdp-sub">{reasonLabel}</div>
      <div className="sdp-sub">
        {t(`signing.status_${data.status}`, { defaultValue: data.status })}
        {data.sealed_at && ` · ${formatDateTime(data.sealed_at, lang, false)}`}
      </div>
      {data.change_note && <div className="sdp-note">“{data.change_note}”</div>}

      {/* Device */}
      {data.asset_code && (
        <>
          <hr className="sdp-rule" />
          <Line label={t('signing.previewAssetTitle')} value={formatAssetCode(data.asset_code)} mono />
        </>
      )}

      {/* Agreed terms */}
      {data.agreed && (
        <>
          <hr className="sdp-rule" />
          <Line label={t('contract.agreedPrice')} value={fmtMoney(data.agreed.agreed_price, lang)} />
          <Line label={t('contract.downPayment')} value={fmtMoney(data.agreed.down_payment, lang)} />
          <Line label={t('contract.insuranceDeposit')} value={fmtMoney(data.agreed.insurance_deposit, lang)} />
          <Line label={t('contract.installmentAmount')} value={fmtMoney(data.agreed.installment_amount, lang)} />
          <Line
            label={t('contract.installments')}
            value={data.agreed.value_month != null ? String(data.agreed.value_month) : '—'}
          />
        </>
      )}

      {/* Parties + signatures — single column, one block per party */}
      <hr className="sdp-rule" />
      <div className="sdp-heading">{t('signing.detail_partiesTitle', { defaultValue: 'Parties' })}</div>
      {data.parties.length === 0 ? (
        <div className="sdp-sub">{t('signing.noParties')}</div>
      ) : (
        data.parties.map((p, i) => (
          <div className="sdp-party" key={i}>
            <div className="sdp-party-role">{t(`signing.role_${p.role}`, { defaultValue: p.role })}</div>
            <div className="sdp-party-name">{p.full_name ?? '—'}</div>
            {p.id_number && <div className="sdp-party-detail">{formatCid(p.id_number)}</div>}
            {p.phone && <div className="sdp-party-detail">{formatTel(p.phone)}</div>}
          </div>
        ))
      )}
    </div>
  );
}

function Line({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="sdp-line">
      <span className="sdp-line-label">{label}</span>
      <span className={mono ? 'sdp-line-value sdp-mono' : 'sdp-line-value'}>{value}</span>
    </div>
  );
}
