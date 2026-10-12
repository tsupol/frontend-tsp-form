// The credit reviewer's view of one request.
//
// Everything needed to decide sits on this one screen, in the order a reviewer
// reads it: who asked and when, the money, the device with its photos, then the
// customer with documents and past contracts. The money and the device come
// from the *submitted* payload (what was actually asked for), while the photos
// and the customer records are read live — a reviewer looking at documents
// wants today's documents, and the photos are not locked until approval.
//
// The two buttons come from the request's capability RPC; a reviewer outside
// this branch's pool sees them disabled with the reason.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button, Tooltip } from 'tsp-form';
import {
  ArrowLeft, Clock, FileText, Smartphone, User, Wallet,
  AlertTriangle, ImageOff, ExternalLink,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../../lib/api';
import { DateTime } from '../../components/DateTime';
import { fmtCurrency, formatTel, formatCid } from '../../lib/format';
import { MediaLightboxKeyGallery, MediaThumbButton } from '../../components/MediaLightbox';
import { normalizeKey } from '../../lib/mediaPath';
import { usePartnerCaseActions, usePartnerCaseReturnReasons } from './usePartnerCases';
import { outcomeBadgeColor, type PartnerCaseDetail } from './partnerCaseTypes';
import { PartnerCaseApproveModal } from './PartnerCaseApproveModal';
import { PartnerCaseReturnModal } from './PartnerCaseReturnModal';

interface PartnerCaseDetailPanelProps {
  detail: PartnerCaseDetail | null;
  loading: boolean;
  isMobile: boolean;
  onBack?: () => void;
  /** Called after an approve/return so the queue can drop the row. */
  onDecided?: () => void;
}

/** How many of the customer's other contracts show before the "see all" toggle. */
const PAST_CONTRACT_PREVIEW = 5;

/** One slot of the device's photo album, as `v_asset_evidence` returns it. */
interface EvidenceSlot {
  asset_id: number;
  slot: string;
  label_th: string;
  is_required: boolean;
  min_shots: number;
  max_shots: number;
  photo_count: number;
  ok: boolean;
  photos: Array<{
    entity_media_id: number;
    storage_path: string;
    variants_json: Record<string, string> | null;
  }> | null;
}

/** `v_customer_documents` — the image lives in `file_url`, a storage key. */
interface CustomerDocument {
  id: number;
  customer_id: number;
  doc_type: string;
  file_url: string | null;
  note: string | null;
  is_active: boolean;
  uploaded_at: string;
}

/** `v_customer_contracts` — this customer's other contracts in the holding. */
interface CustomerContractRow {
  contract_id: number;
  contract_code: string;
  role: string;
  state: string;
  state_name_th: string | null;
  branch_name: string | null;
  product_display_name: string | null;
  outstanding_amount: number | null;
  overdue_count: number | null;
  activated_at: string | null;
}

export function PartnerCaseDetailPanel({
  detail, loading, isMobile, onBack, onDecided,
}: PartnerCaseDetailPanelProps) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();

  const [approveOpen, setApproveOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [lightbox, setLightbox] = useState<{ keys: string[]; index: number } | null>(null);
  const [showAllContracts, setShowAllContracts] = useState(false);

  const { actions } = usePartnerCaseActions(detail?.case_id ?? null);
  const returnReasons = usePartnerCaseReturnReasons();

  const assetId = detail?.target_asset_id ?? null;
  const customerId = detail?.customer_id ?? null;

  // Photos are read live: they are not frozen until the request is approved,
  // and an empty slot is exactly what a reviewer needs to see.
  const { data: evidence = [] } = useQuery({
    queryKey: ['asset-evidence', assetId],
    queryFn: () => apiClient.get<EvidenceSlot[]>(`/v_asset_evidence?asset_id=eq.${assetId}&order=slot_order`),
    enabled: assetId != null,
    staleTime: 30 * 1000,
  });

  const { data: documents = [] } = useQuery({
    queryKey: ['customer-documents', customerId],
    queryFn: () => apiClient.get<CustomerDocument[]>(
      `/v_customer_documents?customer_id=eq.${customerId}&is_active=eq.true&order=uploaded_at.desc`,
    ),
    enabled: customerId != null,
    staleTime: 30 * 1000,
  });

  const { data: pastContracts = [] } = useQuery({
    queryKey: ['customer-contracts', customerId],
    queryFn: () => apiClient.get<CustomerContractRow[]>(
      `/v_customer_contracts?customer_id=eq.${customerId}&order=activated_at.desc.nullslast&limit=20`,
    ),
    enabled: customerId != null,
    staleTime: 30 * 1000,
  });

  if (!detail) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-subtler gap-2">
        <FileText size={32} />
        <span className="text-sm">{loading ? t('common.loading') : t('partnerCase.selectToReview')}</span>
      </div>
    );
  }

  const snapshot = detail.snapshot_payload;
  const agreed = snapshot?.agreed;
  const asset = snapshot?.asset;
  const parties = snapshot?.parties ?? [];

  const approveAction = actions?.actions.find(a => a.action_code === 'APPROVE');
  const returnAction = actions?.actions.find(a => a.action_code === 'RETURN');
  const snapshotStale = actions?.snapshot_matches_now === false;

  const reasonLabel = (code: string | null | undefined) => {
    if (!code) return '';
    const row = returnReasons.find(r => r.code === code);
    if (!row) return code;
    return i18n.language === 'th' ? row.name_th : row.name_en;
  };

  const emptySlots = evidence.filter(s => s.photo_count === 0);

  // A long-standing customer can have twenty contracts; showing them all buries
  // the decision buttons. Lead with the most recent, expand on demand.
  const shownContracts = showAllContracts ? pastContracts : pastContracts.slice(0, PAST_CONTRACT_PREVIEW);

  const openSlotLightbox = (slot: EvidenceSlot, index: number) => {
    const keys = (slot.photos ?? []).map(p => p.storage_path);
    if (keys.length) setLightbox({ keys, index });
  };

  const renderActionButton = (
    action: typeof approveAction,
    label: string,
    onClick: () => void,
    color: 'primary' | 'danger',
  ) => {
    if (!action) return null;
    const blocked = !action.is_available;
    const tooltip = blocked && action.blocking_reason
      ? t(`blockingReason.${action.blocking_reason}`, { ns: 'apiErrors', defaultValue: action.blocking_reason })
      : label;
    return (
      <Tooltip content={tooltip} placement="top">
        <Button
          size="sm"
          color={color}
          variant={color === 'danger' ? 'outline' : undefined}
          disabled={blocked}
          onClick={onClick}
        >
          {label}
        </Button>
      </Tooltip>
    );
  };

  return (
    <div className="relative flex flex-col h-full min-w-0">
      {/* ── Header ── */}
      <div className="flex-none flex items-center h-panel-header-h px-4 border-b border-line gap-2">
        {isMobile && onBack && (
          <button
            type="button"
            onClick={onBack}
            className="flex items-center justify-center w-8 h-8 cursor-pointer bg-transparent border-none text-current"
            aria-label={t('common.back')}
          >
            <ArrowLeft size={18} />
          </button>
        )}
        <span className="font-semibold truncate">{detail.contract_code}</span>
        <Badge color={outcomeBadgeColor(detail.outcome)} size="sm">
          {t(`partnerCase.status_${detail.status}`)}
        </Badge>
        <span className="text-xs text-subtle">#{detail.seq_no}</span>
      </div>

      {/* ── Body ── */}
      <div className="flex-1 overflow-auto better-scroll px-4 py-3 flex flex-col gap-4">
        {snapshotStale && (
          <div className="alert alert-warning">
            <AlertTriangle size={16} className="shrink-0" />
            <span>{t('partnerCase.snapshotStaleWarning')}</span>
          </div>
        )}

        {/* Who asked, when, and what they said */}
        <section className="border border-line rounded-md px-4 py-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('partnerCase.branch')} value={detail.branch_name ?? '—'} />
            <Field label={t('partnerCase.submittedBy')} value={detail.submitted_by_name ?? '—'} />
            <Field
              label={t('partnerCase.submittedAt')}
              value={<DateTime value={detail.submitted_at} showTime />}
            />
            <Field label={t('partnerCase.pool')} value={detail.pool_name ?? '—'} />
          </div>
          {/* The tint's own padding would push this text past the left edge of
              the fields above, which reads as a stray indent. Pull the box out
              by that padding so the label lines up with "สาขา". */}
          {detail.submit_note && (
            <div className="mt-3 -mx-3 rounded-md bg-surface-soft px-3 py-2">
              <div className="text-xs text-subtle">{t('partnerCase.submitNoteLabel')}</div>
              <div className="text-sm mt-0.5">{detail.submit_note}</div>
            </div>
          )}
          {detail.status === 'RETURNED' && detail.return_reason_code && (
            <div className="mt-3 -mx-3 rounded-md border border-danger-border bg-danger-soft px-3 py-2">
              <div className="text-sm font-medium text-danger-fg">
                {reasonLabel(detail.return_reason_code)}
              </div>
              {detail.return_reason && (
                <div className="text-sm text-danger-fg mt-0.5">{detail.return_reason}</div>
              )}
            </div>
          )}
          {detail.status === 'APPROVED' && detail.approved_expires_at && (
            <div className="mt-3 -mx-3 rounded-md border border-success-border bg-success-soft px-3 py-2 text-sm text-success-fg">
              {t('partnerCase.usableUntil')} <DateTime value={detail.approved_expires_at} showTime />
            </div>
          )}
        </section>

        {/* The money, exactly as submitted */}
        <Section icon={<Wallet size={14} />} title={t('partnerCase.moneyTitle')}>
          {/* No agreed price here. It is a derived figure — the down payment
           *  plus every instalment — and on a shop contract there is no price
           *  negotiated with the fund for it to represent: the shop prices the
           *  phone through the plan below, and the fund pays device cost plus
           *  commission regardless. Showing it (and the discount derived from
           *  it) implied a negotiation that does not happen. */}
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('partnerCase.uplift')} value={fmtCurrency(agreed?.uplift_amount ?? detail.uplift_amount)} />
            <Field label={t('partnerCase.downPayment')} value={fmtCurrency(agreed?.down_payment ?? detail.down_payment)} />
            <Field
              label={t('partnerCase.financedAmount')}
              value={fmtCurrency(agreed?.financed_amount ?? detail.financed_amount)}
              emphasis
            />
            <Field
              label={t('partnerCase.installments')}
              value={`${agreed?.value_month ?? detail.term_months ?? '—'} × ${fmtCurrency(agreed?.installment_amount ?? detail.installment_amount)}`}
            />
            <Field
              label={t('partnerCase.lastInstallment')}
              value={fmtCurrency(agreed?.last_installment_amount ?? detail.last_installment_amount)}
            />
            <Field label={t('partnerCase.docFee')} value={fmtCurrency(agreed?.doc_fee_amount ?? detail.doc_fee_amount)} />
            {agreed?.installment_total != null && (
              <Field label={t('partnerCase.installmentTotal')} value={fmtCurrency(agreed.installment_total)} />
            )}
          </div>
        </Section>

        {/* The device, plus its photo album */}
        <Section icon={<Smartphone size={14} />} title={t('partnerCase.deviceTitle')}>
          <div className="grid grid-cols-2 gap-3">
            {/* The view's standard name (brand + model + storage + colour, mig
             *  1422) — not the snapshot's bare variant, which hid the model. */}
            <Field label={t('partnerCase.product')} value={detail.product_display_name ?? '—'} />
            <Field label={t('partnerCase.assetCode')} value={asset?.asset_code ?? detail.asset_code ?? '—'} />
            <Field
              label={t('partnerCase.condition')}
              value={detail.is_used_asset ? t('partnerCase.used') : t('partnerCase.new')}
            />
            {(asset?.imei || asset?.serial_no) && (
              <Field label={asset?.imei ? 'IMEI' : t('partnerCase.serialNo')} value={asset?.imei ?? asset?.serial_no ?? '—'} />
            )}
          </div>

          <div className="mt-3 flex flex-col gap-3">
            {evidence.length === 0 ? (
              <div className="text-sm text-subtler flex items-center gap-2">
                <ImageOff size={14} /> {t('partnerCase.noPhotos')}
              </div>
            ) : (
              <>
                {/* Filled slots first, each with its strip of thumbnails. */}
                {evidence.filter(s => s.photo_count > 0).map(slot => (
                  <div key={slot.slot}>
                    <div className="text-xs font-medium text-subtle mb-1.5">{slot.label_th}</div>
                    <div className="flex flex-wrap gap-2">
                      {(slot.photos ?? []).map((p, i) => (
                        <MediaThumbButton
                          key={p.entity_media_id}
                          mediaKey={p.variants_json?.sm ?? p.storage_path}
                          alt={slot.label_th}
                          onClick={() => openSlotLightbox(slot, i)}
                        />
                      ))}
                    </div>
                  </div>
                ))}
                {/* Empty ones are a single wrapped line of labels — a reviewer
                    needs to know which shots are missing, not six empty rows. */}
                {emptySlots.length > 0 && (
                  <div>
                    <div className="text-xs font-medium text-subtle mb-1.5">
                      {t('partnerCase.slotsEmpty', { count: emptySlots.length })}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {emptySlots.map(slot => (
                        <Badge key={slot.slot} color="warning" size="sm">{slot.label_th}</Badge>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </Section>

        {/* Who is on the contract */}
        <Section icon={<User size={14} />} title={t('partnerCase.customerTitle')}>
          <div className="flex flex-col gap-3">
            {parties.length === 0 ? (
              <Field label={t('partnerCase.lessee')} value={detail.customer_name ?? '—'} />
            ) : parties.map((p, i) => (
              <div key={i} className="rounded-md border border-line px-3 py-2">
                <div className="flex items-center gap-2">
                  <Badge color={p.role === 'LESSEE' ? 'primary' : 'default'} size="sm">
                    {t(`partnerCase.role_${p.role ?? 'LESSEE'}`, { defaultValue: p.role ?? '' })}
                  </Badge>
                  <span className="text-sm font-medium">
                    {[p.prefix, p.first_name, p.last_name].filter(Boolean).join(' ')}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3 mt-2">
                  {p.id_number && <Field label={t('partnerCase.idNumber')} value={formatCid(p.id_number)} />}
                  {p.tel && <Field label={t('partnerCase.tel')} value={formatTel(p.tel)} />}
                </div>
              </div>
            ))}
          </div>

          {/* Documents — live, so the reviewer sees what the shop uploaded today */}
          <div className="mt-3">
            <div className="text-xs font-medium text-subtle mb-1.5">{t('partnerCase.documents')}</div>
            {documents.length === 0 ? (
              <div className="text-xs text-subtler">{t('partnerCase.noDocuments')}</div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {documents.map((d, i) => (
                  <MediaThumbButton
                    key={d.id}
                    mediaKey={d.file_url ? normalizeKey(d.file_url) : null}
                    alt={t(`documentType.${d.doc_type}`, { defaultValue: d.doc_type })}
                    onClick={() => {
                      const keys = documents
                        .map(x => (x.file_url ? normalizeKey(x.file_url) : null))
                        .filter((k): k is string => !!k);
                      if (keys.length) setLightbox({ keys, index: i });
                    }}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Past contracts in this holding */}
          <div className="mt-3">
            <div className="text-xs font-medium text-subtle mb-1.5">{t('partnerCase.pastContracts')}</div>
            {pastContracts.length === 0 ? (
              <div className="text-xs text-subtler">{t('partnerCase.noPastContracts')}</div>
            ) : (
              <div className="rounded-md border border-line overflow-hidden">
                {shownContracts.map(c => (
                  <div key={c.contract_id} className="flex items-center gap-2 px-3 py-2 border-b border-line last:border-b-0">
                    <button
                      type="button"
                      onClick={() => navigate(`/admin/contracts/search/${c.contract_id}`)}
                      className="text-sm font-medium text-primary-fg hover:underline inline-flex items-center gap-1 bg-transparent border-none p-0 cursor-pointer shrink-0"
                    >
                      {c.contract_code}
                      <ExternalLink size={12} />
                    </button>
                    <Badge size="sm">{t(`contract.state_${c.state}`, { defaultValue: c.state })}</Badge>
                    {/* Overdue is the fact a credit reviewer is looking for. */}
                    {(c.overdue_count ?? 0) > 0 && (
                      <Badge color="danger" size="sm">
                        {t('partnerCase.overdueCount', { count: c.overdue_count ?? 0 })}
                      </Badge>
                    )}
                    <span className="flex-1 min-w-0 truncate text-xs text-subtle">
                      {c.product_display_name ?? ''}
                    </span>
                    {c.outstanding_amount != null && c.outstanding_amount > 0 && (
                      <span className="text-xs text-subtle shrink-0 tabular-nums">
                        {fmtCurrency(c.outstanding_amount)}
                      </span>
                    )}
                  </div>
                ))}
                {pastContracts.length > PAST_CONTRACT_PREVIEW && (
                  <button
                    type="button"
                    onClick={() => setShowAllContracts(v => !v)}
                    className="w-full px-3 py-2 text-sm text-primary-fg hover:underline bg-transparent border-none cursor-pointer text-left"
                  >
                    {showAllContracts
                      ? t('partnerCase.showFewer')
                      : t('partnerCase.showAllContracts', { count: pastContracts.length - PAST_CONTRACT_PREVIEW })}
                  </button>
                )}
              </div>
            )}
          </div>
        </Section>
      </div>

      {/* ── Actions ── */}
      {(approveAction || returnAction) && (
        <div className="flex-none border-t border-line px-4 py-3 flex items-center gap-2">
          <span className="text-xs text-subtle flex items-center gap-1">
            <Clock size={12} />
            <DateTime value={detail.submitted_at} showTime />
          </span>
          <div className="flex-1" />
          {renderActionButton(
            returnAction,
            detail.status === 'APPROVED' ? t('partnerCase.unapprove') : t('partnerCase.return'),
            () => setReturnOpen(true),
            'danger',
          )}
          {renderActionButton(approveAction, t('partnerCase.approve'), () => setApproveOpen(true), 'primary')}
        </div>
      )}

      <PartnerCaseApproveModal
        open={approveOpen}
        detail={detail}
        onClose={() => setApproveOpen(false)}
        onApproved={onDecided}
      />
      <PartnerCaseReturnModal
        open={returnOpen}
        detail={detail}
        onClose={() => setReturnOpen(false)}
        onReturned={onDecided}
      />
      <MediaLightboxKeyGallery
        open={lightbox !== null}
        onClose={() => setLightbox(null)}
        mediaKeys={lightbox?.keys ?? []}
        index={lightbox?.index ?? 0}
        onIndexChange={i => setLightbox(lb => (lb ? { ...lb, index: i } : lb))}
        alt={detail.contract_code}
      />
    </div>
  );
}

function Section({ icon, title, children }: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border border-line rounded-md px-4 py-3">
      <h3 className="text-xs font-semibold text-subtle uppercase tracking-wider mb-3 flex items-center gap-1.5">
        {icon}{title}
      </h3>
      {children}
    </section>
  );
}

function Field({ label, value, emphasis }: {
  label: string;
  value: React.ReactNode;
  emphasis?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-subtle">{label}</div>
      <div className={`text-sm truncate ${emphasis ? 'font-semibold' : ''}`}>{value}</div>
    </div>
  );
}
