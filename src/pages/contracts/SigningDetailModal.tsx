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

import { useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Badge, Button, Modal, Tooltip } from 'tsp-form';
import { Bot, CheckCircle2, Circle, Loader2, Printer, XCircle } from 'lucide-react';
import { apiClient } from '../../lib/api';
import { DateTime } from '../../components/DateTime';
import { useMediaUrl } from '../../hooks/useMediaUrl';
import { formatCid, formatTel } from '../../lib/format';
import { SnapshotOverviewDiff } from './SnapshotOverviewDiff';
import { SigningDetailPrint, type SigningDetailPrintData, type PrintParty } from './SigningDetailPrint';

// ─── Types ─────────────────────────────────────────────────────────────

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

interface SiblingRow {
  signing_id: number;
  version: number;
  status: string;
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
  void signingType; // currently unused — kept on the prop for caller stability

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

  const isLoading = pdfInputQuery.isLoading;
  const error = pdfInputQuery.error;

  const isSystemVoided = data?.status === 'VOIDED' && (data as unknown as { voided_by?: number }).voided_by === 0;

  // ─── Set-diff fallback ────────────────────────────────────────────────
  // Legacy FULL payloads carry cumulative state, not a delta. To identify
  // "which guarantor was added" on a FULL row, we set-diff against the
  // previous non-VOIDED snapshot. For DELTA payloads (mig 227+) the change
  // is read directly off the payload and this query is unused.
  // VOIDED rows are skipped entirely upstream — they never committed.
  const siblingsQuery = useQuery({
    queryKey: ['contract-signing-siblings', contractId],
    queryFn: () => apiClient.get<SiblingRow[]>(
      `/v_contract_signing_history?contract_id=eq.${contractId}&order=version.desc&select=signing_id,version,status`,
    ),
    enabled: open && data?.status !== 'VOIDED' && data != null,
    staleTime: 30_000,
  });

  const prevSiblingId: number | null = (() => {
    if (!data || !siblingsQuery.data) return null;
    const siblings = siblingsQuery.data;
    const self = siblings.find(s => s.signing_id === data.signing_id);
    if (!self) return null;
    const prev = siblings
      .filter(s => s.version < self.version && s.status !== 'VOIDED')
      .sort((a, b) => b.version - a.version)[0];
    return prev?.signing_id ?? null;
  })();

  const prevSnapshotQuery = useQuery({
    queryKey: ['signing-pdf-input', prevSiblingId],
    queryFn: () => apiClient.rpc<PdfInput>('fn_staff_get_signing_pdf_input', {
      p_signing_id: prevSiblingId,
    }),
    enabled: open && prevSiblingId != null,
    staleTime: 60_000,
  });

  // ─── Print (browser-print pattern; see .claude/print-pattern.md) ─────────
  // Customer-facing copy: identity + the change only. No signatures, no
  // signed-at dates — the customer is reading what they agreed to, not auditing
  // the ceremony.
  const [printReady, setPrintReady] = useState(false);
  const [printData, setPrintData] = useState<SigningDetailPrintData | null>(null);

  const handlePrint = useCallback(() => {
    if (!data) return;

    setPrintData({
      contract_code: null,
      signing_id: data.signing_id,
      version_no: data.version_no,
      status: data.status,
      signing_type: data.signing_type,
      change_reason: data.change_reason,
      change_note: data.change_note,
      sealed_at: (data as unknown as { sealed_at?: string | null }).sealed_at ?? null,
      anchor_hash: data.anchor_hash,
      agreed: payload?.agreed ?? null,
      asset_code: payload?.asset?.asset_code ?? null,
      parties: data.parties.map((p): PrintParty => ({
        role: p.role,
        full_name: p.full_name,
        id_number: p.id_number,
        phone: p.phone,
      })),
    });
    setPrintReady(true);

    // Two RAFs: React commits, browser paints, then open the dialog. Prints on
    // 80mm thermal — reuses the bill receipt's default @page, no injection.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      window.print();
      setPrintReady(false);
    }));
  }, [data, payload]);

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

            {/* Differences from the previous non-VOIDED snapshot. This
                tells the truth about state movement — a row here may not
                trace 1:1 to this signing's change_reason (contract fields
                can drift between SEALs), but that's correct. The reason
                label at the top frames what THIS signing was about.
                Skipped for VOIDED (never committed) and when no prior
                non-VOIDED snapshot exists (CONTRACT_OPEN baseline). */}
            {data.status !== 'VOIDED' && prevSnapshotQuery.data?.snapshot_payload && payload && (
              <SnapshotOverviewDiff
                changeReason={changeReason}
                stateBefore={prevSnapshotQuery.data.snapshot_payload}
                stateAfter={payload}
              />
            )}
            {data.status !== 'VOIDED' && !prevSiblingId && payload && (
              <SnapshotOverviewDiff
                changeReason={changeReason}
                stateBefore={null}
                stateAfter={payload}
              />
            )}

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
        {data && (
          <Button
            variant="outline"
            startIcon={<Printer size={16} />}
            onClick={handlePrint}
          >
            {t('signing.printDetail', { defaultValue: 'Print' })}
          </Button>
        )}
        <Button onClick={onClose}>{t('common.close')}</Button>
      </div>

      {/* Off-screen print mount — body portal + .signing-detail-print isolation
          (see .claude/print-pattern.md). NOT inside this Modal: the Modal's
          fixed/overflow-hidden container clips the @page box. */}
      {printReady && printData && createPortal(
        <div className="print-only-signing-detail" aria-hidden>
          <SigningDetailPrint data={printData} />
        </div>,
        document.body,
      )}
    </Modal>
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
          {party.id_number && <span>{formatCid(party.id_number)}</span>}
          {party.phone && <span>{formatTel(party.phone)}</span>}
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
