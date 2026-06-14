// Read-only post-fact inspection of a single signing snapshot.
// Surfaces the same per-change_reason facts the consent step shows, plus the
// full party list (with signatures + timestamps) and audit metadata.
//
// Data sources:
//   - api.fn_staff_get_signing_pdf_input  → snapshot row + frozen payload + parties
//   - api.v_assets                        → live device fields for BIND
//   - api.v_contract_detail               → handover row for BIND accessories
//   - api.v_contracts                     → contract code for ADD/REMOVE_GUARANTOR
//   - api.v_installments                  → first/last due date + due day
//
// Read-only — no mutations. Closes via header X or backdrop. Modal always
// mounted; visibility controlled by `open` prop only.

import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Badge, Button, Modal, Tooltip } from 'tsp-form';
import { Bot, CheckCircle2, Circle, Loader2, XCircle } from 'lucide-react';
import { apiClient } from '../../lib/api';
import { fmtCurrency } from '../../lib/format';
import { DateTime } from '../../components/DateTime';
import { useMediaUrl } from '../../hooks/useMediaUrl';

// ─── Types (mirror SigningConsentBody) ─────────────────────────────────

interface PdfInput {
  signing_id: number;
  contract_id: number;
  version_no: number;
  signing_type: string;
  status: string;
  change_reason: string | null;
  change_reason_fk: string | null;
  change_note: string | null;
  is_forced: boolean;
  is_backfill: boolean;
  reconciliation_status: string | null;
  snapshot_payload: SnapshotPayload | null;
  parties: PdfPartyRow[];
  anchor_hash: string | null;
  anchor_version: number | null;
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

// ─── Props ─────────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  onClose: () => void;
  signingId: number | null;
  contractId: number;
  signingType: string;
  changeReason: string | null;
}

// ─── Modal ─────────────────────────────────────────────────────────────

export function SigningDetailModal({ open, onClose, signingId, contractId, signingType, changeReason }: Props) {
  const { t } = useTranslation();

  const pdfInputQuery = useQuery({
    queryKey: ['signing-pdf-input', signingId],
    queryFn: () => apiClient.rpc<PdfInput>('fn_staff_get_signing_pdf_input', {
      p_signing_id: signingId,
    }),
    enabled: open && signingId != null,
    staleTime: 60_000,
  });

  const data = pdfInputQuery.data ?? null;
  const payload = data?.snapshot_payload ?? null;
  const deviceId = payload?.asset?.device_id ?? null;

  const assetQuery = useQuery({
    queryKey: ['signing-consent-asset', deviceId],
    queryFn: () => apiClient.get<AssetRow[]>(
      `/v_assets?asset_id=eq.${deviceId}&select=asset_id,asset_code,variant_name,model_name,brand_name,manufacturer_color,physical_color,imei,serial_no,battery_health,condition_grade&limit=1`,
    ),
    enabled: open && changeReason === 'BIND' && deviceId != null,
    staleTime: 60_000,
  });

  const handoverQuery = useQuery({
    queryKey: ['signing-consent-handover', contractId],
    queryFn: () => apiClient.get<Array<{ handover: HandoverEmbed | null }>>(
      `/v_contract_detail?id=eq.${contractId}&select=handover&limit=1`,
    ),
    enabled: open && changeReason === 'BIND',
    staleTime: 60_000,
  });

  const contractQuery = useQuery({
    queryKey: ['signing-consent-contract', contractId],
    queryFn: () => apiClient.get<ContractRow[]>(
      `/v_contracts?id=eq.${contractId}&select=id,code_display,code,activated_at&limit=1`,
    ),
    enabled: open && (changeReason === 'ADD_GUARANTOR' || changeReason === 'REMOVE_GUARANTOR'),
    staleTime: 60_000,
  });

  const installmentsQuery = useQuery({
    queryKey: ['signing-consent-installments', contractId],
    queryFn: () => apiClient.get<InstallmentRow[]>(
      `/v_installments?contract_id=eq.${contractId}&select=pay_no,due_date&order=pay_no`,
    ),
    enabled: open && changeReason === 'ADD_GUARANTOR',
    staleTime: 60_000,
  });

  const isLoading = pdfInputQuery.isLoading
    || (changeReason === 'BIND' && (assetQuery.isLoading || handoverQuery.isLoading))
    || (changeReason === 'ADD_GUARANTOR' && (contractQuery.isLoading || installmentsQuery.isLoading))
    || (changeReason === 'REMOVE_GUARANTOR' && contractQuery.isLoading);
  const error = pdfInputQuery.error;

  const isSystemVoided = data?.status === 'VOIDED' && (data as unknown as { voided_by?: number }).voided_by === 0;

  return (
    <Modal open={open} onClose={onClose} maxWidth="42rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">{t('signing.detailTitle', { defaultValue: 'Signing detail' })}</h2>
        <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">&times;</button>
      </div>

      <div className="modal-content flex flex-col gap-4">
        {error && (
          <div className="alert alert-danger">
            <XCircle size={16} />
            <span>{error instanceof Error ? error.message : String(error)}</span>
          </div>
        )}

        {isLoading && !data ? (
          <LoadingBlock t={t} />
        ) : data ? (
          <>
            {/* Header card */}
            <section className="border border-line rounded-md px-3 py-2.5 flex flex-col gap-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge size="sm" color={statusBadgeColor(data.status)}>
                  {t(`signing.status_${data.status}`, { defaultValue: data.status })}
                </Badge>
                <span className="text-sm font-medium">
                  {data.change_reason
                    ? t(`signing.reason_${data.change_reason}`, { defaultValue: data.change_reason })
                    : t(`signing.type_${data.signing_type}`, { defaultValue: data.signing_type })}
                </span>
                <span className="text-xs text-subtle tabular-nums">v{data.version_no}</span>
                {data.is_forced && <Badge size="xs" color="warning">{t('signing.forced')}</Badge>}
                {data.is_backfill && (
                  <Badge size="xs" color="default">
                    {t('signing.backfill', { defaultValue: 'Backfilled' })}
                  </Badge>
                )}
                {isSystemVoided && (
                  <Tooltip content={t('signing.systemEventHint')}>
                    <Bot size={13} className="text-subtle" />
                  </Tooltip>
                )}
              </div>
              <div className="text-xs text-subtle">
                {data.signing_type} · {t('signing.detail_signingId', { defaultValue: 'Signing ID' })} #{data.signing_id}
              </div>
              {data.change_note && (
                <div className="text-xs text-subtle italic">"{data.change_note}"</div>
              )}
            </section>

            {/* Per-change_reason summary */}
            <SnapshotSummary
              changeReason={changeReason}
              signingType={signingType}
              payload={payload}
              asset={assetQuery.data?.[0] ?? null}
              handover={handoverQuery.data?.[0]?.handover ?? null}
              contract={contractQuery.data?.[0] ?? null}
              installments={installmentsQuery.data ?? []}
              t={t}
            />

            {/* Parties + signatures */}
            <section>
              <h3 className="text-xs font-semibold text-subtle uppercase tracking-wider mb-2">
                {t('signing.detail_partiesTitle', { defaultValue: 'Parties' })}
              </h3>
              {data.parties.length === 0 ? (
                <p className="text-xs text-subtler">{t('signing.noParties')}</p>
              ) : (
                <ul className="divide-y divide-line/60 border border-line rounded-md">
                  {data.parties.map(p => (
                    <PartyRow key={`${p.role}-${p.index}`} party={p} t={t} />
                  ))}
                </ul>
              )}
            </section>

            {/* Integrity / audit */}
            <section className="border border-line rounded-md px-3 py-2.5">
              <h3 className="text-xs font-semibold text-subtle uppercase tracking-wider mb-2">
                {t('signing.detail_integrityTitle', { defaultValue: 'Integrity' })}
              </h3>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                {data.anchor_hash && (
                  <Row
                    label={t('signing.detail_anchorHash', { defaultValue: 'Anchor hash' })}
                    value={<span className="font-mono break-all">{data.anchor_hash}</span>}
                  />
                )}
                {data.anchor_version != null && (
                  <Row
                    label={t('signing.detail_anchorVersion', { defaultValue: 'Anchor version' })}
                    value={data.anchor_version}
                  />
                )}
                {data.reconciliation_status && (
                  <Row
                    label={t('signing.detail_reconciliation', { defaultValue: 'Reconciliation' })}
                    value={data.reconciliation_status}
                  />
                )}
              </dl>
            </section>
          </>
        ) : null}
      </div>

      <div className="modal-footer">
        <Button onClick={onClose}>{t('common.close')}</Button>
      </div>
    </Modal>
  );
}

// ─── Snapshot summary dispatcher ───────────────────────────────────────

function SnapshotSummary({
  changeReason, signingType, payload, asset, handover, contract, installments, t,
}: {
  changeReason: string | null;
  signingType: string;
  payload: SnapshotPayload | null;
  asset: AssetRow | null;
  handover: HandoverEmbed | null;
  contract: ContractRow | null;
  installments: InstallmentRow[];
  t: ReturnType<typeof useTranslation>['t'];
}) {
  if (changeReason === 'BIND') {
    return <BindSummary asset={asset} handover={handover} t={t} />;
  }
  if (changeReason === 'ADD_GUARANTOR') {
    return <AddGuarantorSummary payload={payload} contract={contract} installments={installments} t={t} />;
  }
  if (changeReason === 'REMOVE_GUARANTOR') {
    return <RemoveGuarantorSummary payload={payload} contract={contract} t={t} />;
  }
  // INITIAL / PRIMARY_SWAP / ATTACH_PRIMARY_CUSTOMER / force-only.
  return <FullContractSummary payload={payload} signingType={signingType} t={t} />;
}

// ─── BIND ──────────────────────────────────────────────────────────────

function BindSummary({ asset, handover, t }: {
  asset: AssetRow | null;
  handover: HandoverEmbed | null;
  t: ReturnType<typeof useTranslation>['t'];
}) {
  return (
    <section>
      <h3 className="text-xs font-semibold text-subtle uppercase tracking-wider mb-2">
        {t('signing.detail_bindTitle', { defaultValue: 'Device handover' })}
      </h3>
      {asset ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm border border-line rounded-md px-3 py-2.5">
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
      ) : (
        <p className="text-xs text-subtle">{t('signing.consent_bind_noAsset')}</p>
      )}

      <p className="mt-3 mb-2 text-xs text-subtle">{t('signing.consent_bind_includedTitle')}</p>
      {handover ? (
        <ul className="border border-line rounded-md px-3 py-2.5 text-sm flex flex-col gap-1">
          <IncludedItem ok={handover.has_box} label={t('workspace.handoverHasBox')} t={t} />
          <IncludedItem ok={handover.has_charger_set} label={t('workspace.handoverHasChargerSet')} t={t} />
          <IncludedItem ok={handover.has_charger_cable} label={t('workspace.handoverHasChargerCable')} t={t} />
        </ul>
      ) : (
        <p className="text-xs text-subtle italic">{t('signing.consent_bind_handoverNotRecorded')}</p>
      )}
    </section>
  );
}

function IncludedItem({ ok, label, t }: {
  ok: boolean | null;
  label: string;
  t: ReturnType<typeof useTranslation>['t'];
}) {
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
      <span className={ok === false ? 'text-subtle line-through' : ok === null ? 'text-subtle' : ''}>{label}</span>
      {ok === null && (
        <span className="text-[11px] text-subtler">{t('signing.consent_bind_includedUnknown')}</span>
      )}
    </li>
  );
}

// ─── ADD_GUARANTOR ─────────────────────────────────────────────────────

function AddGuarantorSummary({ payload, contract, installments, t }: {
  payload: SnapshotPayload | null;
  contract: ContractRow | null;
  installments: InstallmentRow[];
  t: ReturnType<typeof useTranslation>['t'];
}) {
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
  const dueDay = firstDue ? new Date(`${firstDue}T00:00:00+07:00`).getDate() : null;

  return (
    <section>
      <h3 className="text-xs font-semibold text-subtle uppercase tracking-wider mb-2">
        {t('signing.detail_guarantorTitle', { defaultValue: 'Contract being guaranteed' })}
      </h3>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm border border-line rounded-md px-3 py-2.5">
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
            label={t('signing.consent_add_guarantor_dueDay')}
            value={t('signing.consent_add_guarantor_dueDayValue', { day: dueDay })}
          />
        )}
        {firstDue && lastDue && (
          <Row
            label={t('signing.consent_add_guarantor_period')}
            value={(<><DateTime value={firstDue} showTime={false} /> — <DateTime value={lastDue} showTime={false} /></>)}
          />
        )}
        {totalPayable != null && (
          <Row label={t('contract.totalPayable', { defaultValue: 'Total payable' })} value={fmtCurrency(totalPayable)} />
        )}
        {contract?.activated_at && (
          <Row label={t('contract.activatedAt', { defaultValue: 'Active since' })} value={<DateTime value={contract.activated_at} showTime={false} />} />
        )}
      </dl>
    </section>
  );
}

// ─── REMOVE_GUARANTOR ──────────────────────────────────────────────────

function RemoveGuarantorSummary({ payload, contract, t }: {
  payload: SnapshotPayload | null;
  contract: ContractRow | null;
  t: ReturnType<typeof useTranslation>['t'];
}) {
  const lessee = payload?.parties.find(p => p.role === 'LESSEE') ?? null;
  const lesseeName = lessee
    ? [lessee.prefix, lessee.first_name, lessee.last_name].filter(Boolean).join(' ')
    : '—';
  return (
    <section>
      <h3 className="text-xs font-semibold text-subtle uppercase tracking-wider mb-2">
        {t('signing.detail_removeGuarantorTitle', { defaultValue: 'Contract being released from' })}
      </h3>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm border border-line rounded-md px-3 py-2.5">
        <Row label={t('contract.code', { defaultValue: 'Contract code' })} value={<span className="font-mono">{contract?.code_display ?? contract?.code ?? '—'}</span>} />
        <Row label={t('signing.role_LESSEE')} value={lesseeName} />
      </dl>
    </section>
  );
}

// ─── FULL_CONTRACT (INITIAL, PRIMARY_SWAP, ATTACH_PRIMARY_CUSTOMER, force) ─

function FullContractSummary({ payload, t }: {
  payload: SnapshotPayload | null;
  signingType: string;
  t: ReturnType<typeof useTranslation>['t'];
}) {
  if (!payload) return null;
  const agreed = payload.agreed;
  return (
    <section>
      <h3 className="text-xs font-semibold text-subtle uppercase tracking-wider mb-2">
        {t('signing.detail_contractTitle', { defaultValue: 'Contract terms' })}
      </h3>
      {agreed ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm border border-line rounded-md px-3 py-2.5">
          {agreed.agreed_price != null && (
            <Row label={t('contract.agreedPrice', { defaultValue: 'Agreed price' })} value={fmtCurrency(agreed.agreed_price)} />
          )}
          {agreed.down_payment != null && (
            <Row label={t('contract.downPayment', { defaultValue: 'Down payment' })} value={fmtCurrency(agreed.down_payment)} />
          )}
          {agreed.insurance_deposit != null && agreed.insurance_deposit > 0 && (
            <Row label={t('contract.insuranceDeposit', { defaultValue: 'Insurance deposit' })} value={fmtCurrency(agreed.insurance_deposit)} />
          )}
          {agreed.installment_amount != null && agreed.value_month != null && (
            <Row
              label={t('contract.installments', { defaultValue: 'Installments' })}
              value={`${fmtCurrency(agreed.installment_amount)} × ${agreed.value_month} ${t('contract.months', { defaultValue: 'months' })}`}
            />
          )}
        </dl>
      ) : (
        <p className="text-xs text-subtler">{t('signing.detail_noPayloadAgreed', { defaultValue: 'No terms recorded on this snapshot.' })}</p>
      )}
    </section>
  );
}

// ─── Party row ─────────────────────────────────────────────────────────

function PartyRow({ party, t }: {
  party: PdfPartyRow;
  t: ReturnType<typeof useTranslation>['t'];
}) {
  return (
    <li className="px-3 py-2 flex items-start gap-3">
      <span className="shrink-0 mt-0.5">
        {party.signed_at
          ? <CheckCircle2 size={16} className="text-success" />
          : <Circle size={16} className="text-subtle" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge size="xs" color={partyRoleColor(party.role)}>
            {t(`signing.role_${party.role}`, { defaultValue: party.role })}
          </Badge>
          <span className="text-sm font-medium">{party.full_name ?? '—'}</span>
        </div>
        <div className="text-[11px] text-subtle mt-0.5 flex flex-wrap gap-x-3">
          {party.id_number && <span>{party.id_number}</span>}
          {party.phone && <span>{party.phone}</span>}
        </div>
        {party.address && <div className="text-[11px] text-subtle mt-0.5 break-words">{party.address}</div>}
        {party.signed_at && (
          <div className="text-[11px] text-subtle mt-1">
            {t('signing.detail_signedAt', { defaultValue: 'Signed' })}{' '}
            <DateTime value={party.signed_at} />
          </div>
        )}
      </div>
      {party.signature_media_id != null && (
        <SignaturePreview mediaId={party.signature_media_id} />
      )}
    </li>
  );
}

function SignaturePreview({ mediaId }: { mediaId: number }) {
  // Look up the media row by id to get its storage_path, then resolve a URL.
  const mediaQuery = useQuery({
    queryKey: ['signing-detail-media', mediaId],
    queryFn: () => apiClient.get<Array<{ storage_path: string }>>(
      `/v_entity_media?media_id=eq.${mediaId}&select=storage_path&limit=1`,
    ),
    staleTime: 60_000,
  });
  const storagePath = mediaQuery.data?.[0]?.storage_path ?? null;
  const { url } = useMediaUrl(storagePath);

  if (!url) {
    return <div className="shrink-0 w-16 h-10 rounded bg-fg/5 border border-line" />;
  }
  return (
    <img
      src={url}
      alt=""
      className="shrink-0 w-16 h-10 object-contain rounded bg-fg/5 border border-line"
    />
  );
}

// ─── helpers ───────────────────────────────────────────────────────────

function statusBadgeColor(s: string): 'success' | 'warning' | 'default' | 'danger' {
  switch (s) {
    case 'COLLECTING': return 'warning';
    case 'SEALED':     return 'success';
    case 'SUPERSEDED': return 'default';
    case 'VOIDED':     return 'danger';
    default:           return 'default';
  }
}

function partyRoleColor(r: string): 'primary' | 'info' | 'default' {
  switch (r) {
    case 'LESSOR':
    case 'LESSEE':    return 'primary';
    case 'GUARANTOR': return 'info';
    default:          return 'default';
  }
}

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
