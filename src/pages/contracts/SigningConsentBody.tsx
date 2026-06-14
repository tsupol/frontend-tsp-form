// Pre-sign consent body. Renders a snapshot-specific summary so the customer
// confirms the right facts before signing:
//
//   BIND          → device they're receiving (model, serial, IMEI, condition)
//   ADD_GUARANTOR → contract they're guaranteeing (lessee, terms, schedule)
//   anything else → generic "I have read and confirm" blurb
//
// Source-of-truth for the per-snapshot data is `fn_staff_get_signing_pdf_input`,
// which returns the frozen `snapshot_payload` (parties + asset + agreed + rated).
// For BIND we additionally read live IMEI/serial/condition from v_assets
// because the snapshot only freezes `asset.device_id`.

import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { apiClient } from '../../lib/api';
import { fmtCurrency } from '../../lib/format';
import { DateTime } from '../../components/DateTime';

interface PdfInput {
  signing_id: number;
  contract_id: number;
  version_no: number;
  signing_type: string;
  status: string;
  change_reason: string | null;
  snapshot_payload: SnapshotPayload | null;
  parties: PdfPartyRow[];
}

interface SnapshotPayload {
  schema_version: number;
  parties: Array<{
    role: string;
    index: number;
    customer_id: number;
    prefix: string | null;
    first_name: string | null;
    last_name: string | null;
    id_type: string | null;
    id_number: string | null;
    tel: string | null;
    date_of_birth: string | null;
  }>;
  asset: {
    device_id: number | null;
    model_id: number | null;
    variant_id: number | null;
    asset_code: string | null;
    is_specific_unit: boolean;
  } | null;
  agreed: {
    agreed_price: number | null;
    down_payment: number | null;
    insurance_deposit: number | null;
    installment_amount: number | null;
    value_month: number | null;
  } | null;
}

interface PdfPartyRow {
  role: string;
  index: number;
  customer_id: number | null;
  staff_id: number | null;
  full_name: string | null;
  id_number: string | null;
  phone: string | null;
  address: string | null;
  signature_media_id: number | null;
  signed_at: string | null;
}

interface AssetRow {
  asset_id: number;
  asset_code: string | null;
  variant_name: string | null;
  model_name: string | null;
  brand_name: string | null;
  manufacturer_color: string | null;
  physical_color: string | null;
  imei: string | null;
  serial_no: string | null;
  battery_health: number | null;
  condition_grade: string | null;
}

interface HandoverEmbed {
  has_box: boolean | null;
  has_charger_set: boolean | null;
  has_charger_cable: boolean | null;
}

interface InstallmentRow {
  pay_no: number;
  due_date: string;
}

interface ContractRow {
  id: number;
  code_display: string | null;
  code: string;
  activated_at: string | null;
}

interface Props {
  signingId: number;
  contractId: number;
  changeReason: string | null;
  signingType: string;
  /** Called whenever the dynamic checkbox label should change. */
  onCheckboxLabelChange: (label: string) => void;
}

export function SigningConsentBody({
  signingId, contractId, changeReason, signingType, onCheckboxLabelChange,
}: Props) {
  const { t } = useTranslation();

  // 1. Snapshot payload (covers everything we need for ADD_GUARANTOR;
  //    asset.device_id only for BIND → we look up the live row below).
  const pdfInput = useQuery({
    queryKey: ['signing-pdf-input', signingId],
    queryFn: async () => {
      // PostgREST returns the api.ok envelope as the inner data already.
      return apiClient.rpc<PdfInput>('fn_staff_get_signing_pdf_input', {
        p_signing_id: signingId,
      });
    },
    staleTime: 60_000,
  });

  const payload = pdfInput.data?.snapshot_payload ?? null;
  const deviceId = payload?.asset?.device_id ?? null;

  // 2. Live asset details — only for BIND, only when we have a device_id.
  const assetQuery = useQuery({
    queryKey: ['signing-consent-asset', deviceId],
    queryFn: () => apiClient.get<AssetRow[]>(
      `/v_assets?asset_id=eq.${deviceId}&select=asset_id,asset_code,variant_name,model_name,brand_name,manufacturer_color,physical_color,imei,serial_no,battery_health,condition_grade&limit=1`,
    ),
    enabled: changeReason === 'BIND' && deviceId != null,
    staleTime: 60_000,
  });

  // 2b. Handover row — what's in the box (box / charger set / cable). Lives on
  // the contract detail jsonb. Treat missing as "all included" to match the
  // misc-go PDF fallback semantics (pre-handover contracts assumed everything
  // was included).
  const handoverQuery = useQuery({
    queryKey: ['signing-consent-handover', contractId],
    queryFn: () => apiClient.get<Array<{ handover: HandoverEmbed | null }>>(
      `/v_contract_detail?id=eq.${contractId}&select=handover&limit=1`,
    ),
    enabled: changeReason === 'BIND',
    staleTime: 60_000,
  });

  // 3. Contract row for the contract code shown on the ADD_GUARANTOR body.
  const contractQuery = useQuery({
    queryKey: ['signing-consent-contract', contractId],
    queryFn: () => apiClient.get<ContractRow[]>(
      `/v_contracts?id=eq.${contractId}&select=id,code_display,code,activated_at&limit=1`,
    ),
    enabled: changeReason === 'ADD_GUARANTOR' || changeReason === 'REMOVE_GUARANTOR',
    staleTime: 60_000,
  });

  // 3b. Installment schedule — for ADD_GUARANTOR we surface "ทุกวันที่ X,
  // ตั้งแต่ {first_due} ถึง {last_due}". Pull only first + last by pay_no.
  const installmentsQuery = useQuery({
    queryKey: ['signing-consent-installments', contractId],
    queryFn: () => apiClient.get<InstallmentRow[]>(
      `/v_installments?contract_id=eq.${contractId}&select=pay_no,due_date&order=pay_no`,
    ),
    enabled: changeReason === 'ADD_GUARANTOR',
    staleTime: 60_000,
  });

  const isLoading = pdfInput.isLoading
    || (changeReason === 'BIND' && (assetQuery.isLoading || handoverQuery.isLoading))
    || (changeReason === 'ADD_GUARANTOR' && (contractQuery.isLoading || installmentsQuery.isLoading))
    || (changeReason === 'REMOVE_GUARANTOR' && contractQuery.isLoading);

  // Pick the right body for this change_reason.
  let body: React.ReactNode;
  let checkboxLabel: string;

  if (changeReason === 'BIND') {
    const asset = assetQuery.data?.[0] ?? null;
    const handover = handoverQuery.data?.[0]?.handover ?? null;
    body = <BindBody asset={asset} handover={handover} loading={isLoading} t={t} />;
    checkboxLabel = t('signing.consent_bind_checkbox', {
      defaultValue: 'I confirm this is the device I received.',
    });
  } else if (changeReason === 'ADD_GUARANTOR') {
    body = (
      <AddGuarantorBody
        payload={payload}
        contract={contractQuery.data?.[0] ?? null}
        installments={installmentsQuery.data ?? []}
        loading={isLoading}
        t={t}
      />
    );
    checkboxLabel = t('signing.consent_add_guarantor_checkbox', {
      defaultValue: 'I agree to act as guarantor for this contract.',
    });
  } else if (changeReason === 'REMOVE_GUARANTOR') {
    body = <RemoveGuarantorBody payload={payload} contract={contractQuery.data?.[0] ?? null} loading={isLoading} t={t} />;
    checkboxLabel = t('signing.consent_remove_guarantor_checkbox', {
      defaultValue: 'I confirm my release from this contract.',
    });
  } else {
    // INITIAL / PRIMARY_SWAP / ATTACH_PRIMARY_CUSTOMER / force-only reasons.
    body = <GenericBody t={t} signingType={signingType} />;
    checkboxLabel = t('signing.consentCheckbox');
  }

  // Bubble the right checkbox label back up. Run on render — cheap, parent
  // dedupes via useState setter equality.
  onCheckboxLabelChange(checkboxLabel);

  return <div className="text-sm">{body}</div>;
}

// ─── BIND ──────────────────────────────────────────────────────────────

function BindBody({ asset, handover, loading, t }: {
  asset: AssetRow | null;
  handover: HandoverEmbed | null;
  loading: boolean;
  t: ReturnType<typeof useTranslation>['t'];
}) {
  if (loading) return <LoadingBlock t={t} />;
  if (!asset) return <p className="text-subtle">{t('signing.consent_bind_noAsset', { defaultValue: 'Device details are not available yet.' })}</p>;

  return (
    <>
      <p className="mb-3">{t('signing.consent_bind_prompt', { defaultValue: 'Please confirm the device you are receiving:' })}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm bg-surface border border-line rounded-md px-3 py-2.5">
        <Row label={t('contract.device')} value={[asset.brand_name, asset.model_name, asset.variant_name].filter(Boolean).join(' ')} />
        {asset.asset_code && <Row label={t('contract.assetCode', { defaultValue: 'Asset code' })} value={asset.asset_code} />}
        {asset.imei && <Row label="IMEI" value={<span className="font-mono">{asset.imei}</span>} />}
        {asset.serial_no && <Row label={t('contract.serial', { defaultValue: 'Serial' })} value={<span className="font-mono">{asset.serial_no}</span>} />}
        {(asset.physical_color ?? asset.manufacturer_color) && (
          <Row label={t('contract.color', { defaultValue: 'Color' })} value={asset.physical_color ?? asset.manufacturer_color ?? '—'} />
        )}
        {asset.condition_grade && (
          <Row
            label={t('contract.condition', { defaultValue: 'Condition' })}
            value={t(`asset.condition_${asset.condition_grade}`, { defaultValue: asset.condition_grade })}
          />
        )}
        {asset.battery_health != null && (
          <Row label={t('contract.batteryHealth', { defaultValue: 'Battery health' })} value={`${asset.battery_health}%`} />
        )}
      </dl>

      <p className="mt-3 mb-2 text-sm text-subtle">{t('signing.consent_bind_includedTitle', { defaultValue: 'Included with the device' })}</p>
      {handover ? (
        <ul className="bg-surface border border-line rounded-md px-3 py-2.5 text-sm flex flex-col gap-1">
          <IncludedItem ok={handover.has_box} label={t('workspace.handoverHasBox')} t={t} />
          <IncludedItem ok={handover.has_charger_set} label={t('workspace.handoverHasChargerSet')} t={t} />
          <IncludedItem ok={handover.has_charger_cable} label={t('workspace.handoverHasChargerCable')} t={t} />
        </ul>
      ) : (
        <p className="text-xs text-subtle italic">
          {t('signing.consent_bind_handoverNotRecorded', { defaultValue: 'Handover details have not been recorded yet — please verify in person before signing.' })}
        </p>
      )}
    </>
  );
}

function IncludedItem({ ok, label, t }: {
  ok: boolean | null;
  label: string;
  t: ReturnType<typeof useTranslation>['t'];
}) {
  // null = not recorded; treat as "—". true = included; false = not included.
  return (
    <li className="flex items-center gap-2">
      <span
        className={
          ok === true ? 'inline-flex w-4 h-4 rounded-full bg-success/20 text-success items-center justify-center text-[10px] font-bold'
          : ok === false ? 'inline-flex w-4 h-4 rounded-full bg-danger/15 text-danger items-center justify-center text-[10px] font-bold'
          : 'inline-flex w-4 h-4 rounded-full bg-fg/10 text-subtle items-center justify-center text-[10px] font-bold'
        }
        aria-hidden="true"
      >
        {ok === true ? '✓' : ok === false ? '×' : '—'}
      </span>
      <span className={ok === false ? 'text-subtle line-through' : ok === null ? 'text-subtle' : ''}>
        {label}
      </span>
      {ok === null && (
        <span className="text-[11px] text-subtler">
          {t('signing.consent_bind_includedUnknown', { defaultValue: 'not recorded' })}
        </span>
      )}
    </li>
  );
}

// ─── ADD_GUARANTOR ─────────────────────────────────────────────────────

function AddGuarantorBody({ payload, contract, installments, loading, t }: {
  payload: SnapshotPayload | null;
  contract: ContractRow | null;
  installments: InstallmentRow[];
  loading: boolean;
  t: ReturnType<typeof useTranslation>['t'];
}) {
  if (loading) return <LoadingBlock t={t} />;

  const lessee = payload?.parties.find(p => p.role === 'LESSEE') ?? null;
  const lesseeName = lessee
    ? [lessee.prefix, lessee.first_name, lessee.last_name].filter(Boolean).join(' ')
    : '—';
  const agreed = payload?.agreed ?? null;
  const term = agreed?.value_month ?? installments.length ?? null;
  const installment = agreed?.installment_amount ?? null;
  const totalPayable = installment != null && term != null
    ? (installment * term) + (agreed?.down_payment ?? 0) + (agreed?.insurance_deposit ?? 0)
    : null;

  const firstDue = installments[0]?.due_date ?? null;
  const lastDue = installments[installments.length - 1]?.due_date ?? null;
  // Due-day-of-month — read from first installment. All installments share the
  // same day-of-month by construction (monthly schedule).
  const dueDay = firstDue ? new Date(`${firstDue}T00:00:00+07:00`).getDate() : null;

  return (
    <>
      <p className="mb-3">{t('signing.consent_add_guarantor_prompt', { defaultValue: 'You are about to guarantee the following contract:' })}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm bg-surface border border-line rounded-md px-3 py-2.5">
        <Row label={t('contract.code', { defaultValue: 'Contract code' })} value={<span className="font-mono">{contract?.code_display ?? contract?.code ?? '—'}</span>} />
        <Row label={t('signing.role_LESSEE')} value={lesseeName} />
        {lessee?.id_number && <Row label={t('contract.idNumber', { defaultValue: 'ID number' })} value={<span className="font-mono">{lessee.id_number}</span>} />}
        {installment != null && term != null && (
          <Row
            label={t('contract.installments', { defaultValue: 'Installments' })}
            value={`${fmtCurrency(installment)} × ${term} ${t('contract.months', { defaultValue: 'months' })}`}
          />
        )}
        {dueDay != null && (
          <Row
            label={t('signing.consent_add_guarantor_dueDay', { defaultValue: 'Due day each month' })}
            value={t('signing.consent_add_guarantor_dueDayValue', { defaultValue: 'Day {{day}} of each month', day: dueDay })}
          />
        )}
        {firstDue && lastDue && (
          <Row
            label={t('signing.consent_add_guarantor_period', { defaultValue: 'Payment period' })}
            value={(
              <>
                <DateTime value={firstDue} showTime={false} />
                {' '}—{' '}
                <DateTime value={lastDue} showTime={false} />
              </>
            )}
          />
        )}
        {totalPayable != null && (
          <Row label={t('contract.totalPayable', { defaultValue: 'Total payable' })} value={fmtCurrency(totalPayable)} />
        )}
        {contract?.activated_at && (
          <Row label={t('contract.activatedAt', { defaultValue: 'Active since' })} value={<DateTime value={contract.activated_at} showTime={false} />} />
        )}
      </dl>
      <p className="text-xs text-subtle mt-2">
        {t('signing.consent_add_guarantor_note', {
          defaultValue: 'By signing, you accept joint liability for the obligations above if the lessee defaults.',
        })}
      </p>
    </>
  );
}

// ─── REMOVE_GUARANTOR ──────────────────────────────────────────────────

function RemoveGuarantorBody({ payload, contract, loading, t }: {
  payload: SnapshotPayload | null;
  contract: ContractRow | null;
  loading: boolean;
  t: ReturnType<typeof useTranslation>['t'];
}) {
  if (loading) return <LoadingBlock t={t} />;
  const lessee = payload?.parties.find(p => p.role === 'LESSEE') ?? null;
  const lesseeName = lessee
    ? [lessee.prefix, lessee.first_name, lessee.last_name].filter(Boolean).join(' ')
    : '—';
  return (
    <>
      <p className="mb-3">{t('signing.consent_remove_guarantor_prompt', { defaultValue: 'You are being released as guarantor from the following contract:' })}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm bg-surface border border-line rounded-md px-3 py-2.5">
        <Row label={t('contract.code', { defaultValue: 'Contract code' })} value={<span className="font-mono">{contract?.code_display ?? contract?.code ?? '—'}</span>} />
        <Row label={t('signing.role_LESSEE')} value={lesseeName} />
      </dl>
    </>
  );
}

// ─── GENERIC (INITIAL, PRIMARY_SWAP, ATTACH_PRIMARY_CUSTOMER, force-only) ─

function GenericBody({ t }: { t: ReturnType<typeof useTranslation>['t']; signingType: string }) {
  return <p className="text-sm">{t('signing.consentBody')}</p>;
}

// ─── helpers ───────────────────────────────────────────────────────────

function Row({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
  return (
    <>
      <dt className="text-subtle">{label}</dt>
      <dd className="text-fg">{value}</dd>
    </>
  );
}

function LoadingBlock({ t }: { t: ReturnType<typeof useTranslation>['t'] }) {
  return (
    <div className="flex items-center gap-2 text-xs text-subtle py-2">
      <Loader2 size={14} className="animate-spin" />
      {t('common.loading')}
    </div>
  );
}
