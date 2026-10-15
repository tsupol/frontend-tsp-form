// The credit reviewer's view of one request.
//
// Built for this one job, on purpose not from the contract page's parts, so it
// can be shaped around the decision. It reads top to bottom in the order a
// reviewer decides:
//   1. the red flags at a glance (blacklist, the shop's rating, payment record)
//   2. who asked, when, and what they said
//   3. who the customer is — identity plus every photo of them (ID card and
//      the photos the shop took with the contract)
//   4. how to reach them — addresses, phone numbers, reference people
//   5. how they paid before — each earlier contract with paid / late / owing
//   6. the deal itself — the money and the device
//
// The money, the device and the contract's address/references come from the
// *submitted* payload (what was actually asked for). Photos, contacts, the
// rating and the payment record are read live — a reviewer wants today's facts.
//
// The two buttons come from the request's capability RPC; a reviewer outside
// this branch's pool sees them disabled with the reason.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button, Tooltip } from 'tsp-form';
import {
  ArrowLeft, Clock, FileText, Smartphone, User, Wallet, MapPin, Phone, Users,
  History, AlertTriangle, ImageOff, Star, ShieldAlert, ShieldCheck,
} from 'lucide-react';
import { apiClient } from '../../lib/api';
import { DateTime } from '../../components/DateTime';
import { EntityCodeLink } from '../../components/EntityCodeLink';
import { fmtCurrency, formatTel, formatCid } from '../../lib/format';
import { MediaLightboxKeyGallery, MediaThumbButton } from '../../components/MediaLightbox';
import { normalizeKey } from '../../lib/mediaPath';
import { useContractAlbumPhotos } from '../contracts/contractPhotoStatus';
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

/** One slot of the device's photo album, as `v_asset_evidence` returns it. */
interface EvidenceSlot {
  asset_id: number;
  slot: string;
  label_th: string;
  photo_count: number;
  photos: Array<{
    entity_media_id: number;
    storage_path: string;
    variants_json: Record<string, string> | null;
  }> | null;
}

/** `v_customer_documents` — the image lives in `file_url`, a storage key. */
interface CustomerDocument {
  id: number;
  doc_type: string;
  file_url: string | null;
}

/** `v_customers` — only what the reviewer needs beyond the submitted payload. */
interface CustomerRecord {
  id: number;
  tel2: string | null;
  line_id: string | null;
  facebook: string | null;
  is_blacklisted: boolean;
}

/** `v_blacklist` — the active entry, for its reason. */
interface BlacklistEntry {
  id: number;
  reason: string | null;
  created_at: string;
}

/** `v_customer_addresses`. */
interface CustomerAddress {
  id: number;
  address_type: string;
  address_line1: string;
  address_line2: string | null;
  soi: string | null;
  road: string | null;
  sub_district: string;
  district: string;
  province: string;
  postal_code: string;
  is_default: boolean;
}

/** `v_customer_contacts`. */
interface CustomerContact {
  id: number;
  contact_type: string;
  value: string;
  label: string | null;
}

/** A reference person — from the submitted payload, or `v_customer_references`. */
interface ReferencePerson {
  id?: number;
  name: string | null;
  last_name: string | null;
  tel: string | null;
  relation: string | null;
}

/** `v_customer_contracts` — this customer's contracts in the holding. */
interface CustomerContractRow {
  contract_id: number;
  contract_code: string;
  state: string;
  product_display_name: string | null;
  paid_installment_count: number | null;
  total_installments: number | null;
  overdue_count: number | null;
  overdue_amount: number | null;
  activated_at: string | null;
}

/** `v_installments` — one mark per instalment in the payment record. */
interface InstallmentRow {
  contract_id: number;
  pay_no: number;
  due_date: string;
  paid_at: string | null;
  /** PAID · PARTIAL · OVERDUE · DUE_TODAY · UPCOMING · FUTURE · TERMINATED */
  payment_state: string;
  days_past_due: number | null;
}

/** How one instalment reads in the record. */
type MarkKind = 'onTime' | 'late' | 'overdue' | 'partial' | 'due' | 'future' | 'ended';

const MARK_CLASS: Record<MarkKind, string> = {
  onTime: 'bg-success border-success',
  late: 'bg-warning border-warning',
  overdue: 'bg-danger border-danger',
  partial: 'bg-warning-soft border-warning',
  due: 'bg-transparent border-subtle',
  future: 'bg-transparent border-line',
  ended: 'bg-transparent border-line border-dashed',
};

/** Row of `v_contract_photo_slots` — the group names for the contract's photos. */
interface PhotoSlotRef {
  usage_type: string;
  label_th: string;
  label_en: string;
  sort_order: number;
}

/** Late record of one earlier contract. */
interface LateRecord {
  lateCount: number;
  worstDays: number;
}

/** Bangkok calendar day of a timestamp, as YYYY-MM-DD. */
const bangkokDay = (iso: string) =>
  new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });

const dayDiff = (from: string, to: string) =>
  Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

function ageFrom(dob: string | null | undefined): number | null {
  if (!dob) return null;
  const today = bangkokDay(new Date().toISOString());
  const [y, m, d] = dob.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  return ty - y - (tm < m || (tm === m && td < d) ? 1 : 0);
}

function formatAddress(a: Pick<CustomerAddress, 'address_line1' | 'address_line2' | 'soi' | 'road' | 'sub_district' | 'district' | 'province' | 'postal_code'>): string {
  const parts = [a.address_line1];
  if (a.address_line2) parts.push(a.address_line2);
  if (a.soi) parts.push(`ซ.${a.soi}`);
  if (a.road) parts.push(`ถ.${a.road}`);
  parts.push(`${a.sub_district}, ${a.district}, ${a.province} ${a.postal_code}`);
  return parts.join(', ');
}

export function PartnerCaseDetailPanel({
  detail, loading, isMobile, onBack, onDecided,
}: PartnerCaseDetailPanelProps) {
  const { t, i18n } = useTranslation();

  const [approveOpen, setApproveOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [lightbox, setLightbox] = useState<{ keys: string[]; index: number } | null>(null);
  const [showUnopened, setShowUnopened] = useState(false);

  const { actions } = usePartnerCaseActions(detail?.case_id ?? null);
  const returnReasons = usePartnerCaseReturnReasons();

  const assetId = detail?.target_asset_id ?? null;
  const customerId = detail?.customer_id ?? null;
  const contractId = detail?.contract_id ?? null;

  // ── Live reads ────────────────────────────────────────────────────────────

  const { data: customer } = useQuery({
    queryKey: ['partner-case-customer', customerId],
    queryFn: async () => (await apiClient.get<CustomerRecord[]>(
      `/v_customers?id=eq.${customerId}&select=id,tel2,line_id,facebook,is_blacklisted`,
    ))[0] ?? null,
    enabled: customerId != null,
    staleTime: 30 * 1000,
  });

  const { data: blacklist = [] } = useQuery({
    queryKey: ['partner-case-blacklist', customerId],
    queryFn: () => apiClient.get<BlacklistEntry[]>(
      `/v_blacklist?customer_id=eq.${customerId}&is_active=eq.true&select=id,reason,created_at&order=created_at.desc`,
    ),
    enabled: customerId != null && customer?.is_blacklisted === true,
    staleTime: 30 * 1000,
  });

  // The shop's own read of the customer (1–5 stars), set before submitting.
  const { data: rating } = useQuery({
    queryKey: ['partner-case-rating', contractId],
    queryFn: async () => (await apiClient.get<Array<{ staff_confidence_score: number | null }>>(
      `/v_contracts?id=eq.${contractId}&select=staff_confidence_score`,
    ))[0]?.staff_confidence_score ?? null,
    enabled: contractId != null,
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

  const { data: slotRefs = [] } = useQuery({
    queryKey: ['contract-photo-slots', 'v_contract_photo_slots'],
    queryFn: () => apiClient.get<PhotoSlotRef[]>('/v_contract_photo_slots?is_active=eq.true&order=sort_order'),
    staleTime: 60 * 60 * 1000,
  });
  const { data: contractPhotos = [] } = useContractAlbumPhotos(contractId ?? 0, contractId ? slotRefs.map(s => s.usage_type) : []);

  const { data: addresses = [] } = useQuery({
    queryKey: ['partner-case-addresses', customerId],
    queryFn: () => apiClient.get<CustomerAddress[]>(
      `/v_customer_addresses?customer_id=eq.${customerId}&order=is_default.desc`,
    ),
    enabled: customerId != null,
    staleTime: 30 * 1000,
  });

  const { data: contacts = [] } = useQuery({
    queryKey: ['partner-case-contacts', customerId],
    queryFn: () => apiClient.get<CustomerContact[]>(
      `/v_customer_contacts?customer_id=eq.${customerId}&order=is_primary.desc,contact_type`,
    ),
    enabled: customerId != null,
    staleTime: 30 * 1000,
  });

  const { data: liveReferences = [] } = useQuery({
    queryKey: ['partner-case-references', customerId],
    queryFn: () => apiClient.get<ReferencePerson[]>(
      `/v_customer_references?customer_id=eq.${customerId}&is_active=eq.true&select=id,name,last_name,tel,relation`,
    ),
    enabled: customerId != null,
    staleTime: 30 * 1000,
  });

  const { data: customerContracts = [] } = useQuery({
    queryKey: ['customer-contracts-record', customerId],
    queryFn: () => apiClient.get<CustomerContractRow[]>(
      `/v_customer_contracts?customer_id=eq.${customerId}`
      + '&select=contract_id,contract_code,state,product_display_name,paid_installment_count,total_installments,overdue_count,overdue_amount,activated_at'
      + '&order=activated_at.desc.nullslast',
    ),
    enabled: customerId != null,
    staleTime: 30 * 1000,
  });

  // Earlier contracts that actually ran — not this one, and not drafts that
  // expired or were cancelled before anything was paid.
  const ranContracts = customerContracts.filter(c => c.contract_id !== contractId && c.activated_at);
  const unopenedContracts = customerContracts.filter(c => c.contract_id !== contractId && !c.activated_at);
  const ranIds = ranContracts.map(c => c.contract_id);

  // Paid-late history. The backend's contract list only says what is owed
  // *now*; nothing returns "was this customer ever late", so it is counted
  // here from each paid instalment's date against its due date.
  const { data: installments = [] } = useQuery({
    queryKey: ['partner-case-installments', ranIds.join(',')],
    queryFn: () => apiClient.get<InstallmentRow[]>(
      `/v_installments?contract_id=in.(${ranIds.join(',')})`
      + '&select=contract_id,pay_no,due_date,paid_at,payment_state,days_past_due&order=contract_id,pay_no',
    ),
    enabled: ranIds.length > 0,
    staleTime: 30 * 1000,
  });

  const { data: evidence = [] } = useQuery({
    queryKey: ['asset-evidence', assetId],
    queryFn: () => apiClient.get<EvidenceSlot[]>(`/v_asset_evidence?asset_id=eq.${assetId}&order=slot_order`),
    enabled: assetId != null,
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

  // ── Derived for display ───────────────────────────────────────────────────

  const snapshot = detail.snapshot_payload;
  const agreed = snapshot?.agreed;
  const asset = snapshot?.asset;
  const parties = snapshot?.parties ?? [];
  const lessee = parties.find(p => p.role === 'LESSEE') ?? parties[0];
  const otherParties = parties.filter(p => p !== lessee);
  const age = ageFrom(lessee?.date_of_birth);

  const approveAction = actions?.actions.find(a => a.action_code === 'APPROVE');
  const returnAction = actions?.actions.find(a => a.action_code === 'RETURN');
  const snapshotStale = actions?.snapshot_matches_now === false;

  const reasonLabel = (code: string | null | undefined) => {
    if (!code) return '';
    const row = returnReasons.find(r => r.code === code);
    if (!row) return code;
    return i18n.language === 'th' ? row.name_th : row.name_en;
  };

  const lateBy = new Map<number, LateRecord>();
  for (const ins of installments) {
    if (!ins.paid_at) continue;
    const days = dayDiff(ins.due_date, bangkokDay(ins.paid_at));
    if (days <= 0) continue;
    const rec = lateBy.get(ins.contract_id) ?? { lateCount: 0, worstDays: 0 };
    rec.lateCount += 1;
    rec.worstDays = Math.max(rec.worstDays, days);
    lateBy.set(ins.contract_id, rec);
  }
  // Contracts with something to look at first (owing now, then paid late),
  // newest first within each; a long record shows its first few until asked.
  const problemRank = (c: CustomerContractRow) =>
    (c.overdue_count ?? 0) > 0 ? 0 : lateBy.has(c.contract_id) ? 1 : 2;
  // A customer rarely has more than one or two earlier contracts (real data:
  // 99% have one), so every one is shown in full.
  const sortedRan = [...ranContracts].sort((a, b) => problemRank(a) - problemRank(b));
  const marksOf = (contractId: number) => installments.filter(i => i.contract_id === contractId);
  const lateDays = (i: InstallmentRow) => (i.paid_at ? dayDiff(i.due_date, bangkokDay(i.paid_at)) : 0);
  const markKind = (i: InstallmentRow): MarkKind => {
    if (i.payment_state === 'TERMINATED') return 'ended';
    if (i.paid_at && i.payment_state === 'PAID') return lateDays(i) > 0 ? 'late' : 'onTime';
    if (i.payment_state === 'OVERDUE') return 'overdue';
    if (i.payment_state === 'PARTIAL') return 'partial';
    if (i.payment_state === 'DUE_TODAY' || i.payment_state === 'UPCOMING') return 'due';
    return 'future';
  };
  const markLabel = (i: InstallmentRow, kind: MarkKind) =>
    `${t('partnerCase.markPayNo', { n: i.pay_no })} · ${t(`partnerCase.mark_${kind}`, {
      days: kind === 'late' ? lateDays(i) : (i.days_past_due ?? 0),
    })}`;
  const markTip = (i: InstallmentRow, kind: MarkKind) => (
    <div className="flex flex-col gap-0.5">
      <div className="font-medium">{markLabel(i, kind)}</div>
      <div className="text-xs opacity-90">{t('partnerCase.markDueOn')} <DateTime value={i.due_date} showTime={false} /></div>
      {i.paid_at && (
        <div className="text-xs opacity-90">{t('partnerCase.markPaidOn')} <DateTime value={i.paid_at} showTime={false} /></div>
      )}
    </div>
  );
  const totalLate = [...lateBy.values()].reduce((n, r) => n + r.lateCount, 0);
  const worstLate = Math.max(0, ...[...lateBy.values()].map(r => r.worstDays));
  const totalOverdue = ranContracts.reduce((n, c) => n + (c.overdue_count ?? 0), 0);
  const totalPaid = ranContracts.reduce((n, c) => n + (c.paid_installment_count ?? 0), 0);

  // The contract's address and reference people are the ones submitted; the
  // work address and phone numbers are the customer record's.
  const contractAddress = lessee?.address ?? null;
  const workAddress = addresses.find(a => a.address_type === 'WORK') ?? null;
  const references: ReferencePerson[] = (lessee?.references?.length ? lessee.references : liveReferences);
  const extraPhones = [
    ...(customer?.tel2 ? [{ key: 'tel2', label: t('partnerCase.contactType_MOBILE'), value: formatTel(customer.tel2) }] : []),
    ...contacts
      .filter(c => formatTel(c.value) !== formatTel(lessee?.tel))
      .map(c => ({
        key: `c${c.id}`,
        label: t(`partnerCase.contactType_${c.contact_type}`, { defaultValue: c.contact_type }),
        value: ['MOBILE', 'HOME', 'WORK'].includes(c.contact_type) ? formatTel(c.value) : c.value,
      })),
    ...(customer?.line_id ? [{ key: 'line', label: 'LINE', value: customer.line_id }] : []),
    ...(customer?.facebook ? [{ key: 'fb', label: 'Facebook', value: customer.facebook }] : []),
  ];

  // Every photo of the customer in one strip: the ID card, then the groups the
  // shop photographed with the contract. One gallery walks through all of them.
  const slotLabel = (usage: string) => {
    const s = slotRefs.find(r => r.usage_type === usage);
    return s ? (i18n.language === 'th' ? s.label_th : s.label_en) : usage;
  };
  const slotOrder = (usage: string) => slotRefs.find(r => r.usage_type === usage)?.sort_order ?? 999;
  const photoGroups: Array<{ key: string; label: string; items: Array<{ id: string; key: string; thumb: string }> }> = [];
  const idDocs = documents.filter(d => d.file_url);
  if (idDocs.length) {
    photoGroups.push({
      key: 'id-card',
      label: t('partnerCase.idCardPhoto'),
      items: idDocs.map(d => ({ id: `d${d.id}`, key: normalizeKey(d.file_url!), thumb: normalizeKey(d.file_url!) })),
    });
  }
  const usages = [...new Set(contractPhotos.map(p => p.usage_type))].sort((a, b) => slotOrder(a) - slotOrder(b));
  for (const u of usages) {
    photoGroups.push({
      key: u,
      label: slotLabel(u),
      items: contractPhotos.filter(p => p.usage_type === u).map(p => ({
        id: `m${p.entity_media_id}`, key: p.storage_path, thumb: p.variants_json?.sm ?? p.storage_path,
      })),
    });
  }
  const allPhotoKeys = photoGroups.flatMap(g => g.items.map(i => i.key));
  const openPhoto = (key: string, keys = allPhotoKeys) => {
    const index = keys.indexOf(key);
    if (index >= 0) setLightbox({ keys, index });
  };

  const devicePhotos = evidence.filter(s => s.photo_count > 0);
  const devicePhotoKeys = devicePhotos.flatMap(s => (s.photos ?? []).map(p => p.storage_path));

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
        {/* The full contract (payment plan, signing tab, history) is one click
            away — without the link the reviewer had to go and search for it. */}
        <EntityCodeLink
          to={`/admin/contracts/search/${detail.contract_id}`}
          code={detail.contract_code}
          className="font-semibold min-w-0 truncate"
        />
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

        {/* 1. The flags a reviewer looks for first */}
        <div className="flex flex-wrap gap-1.5">
          {customer?.is_blacklisted ? (
            <Signal tone="danger" icon={<ShieldAlert size={13} />}>{t('partnerCase.sigBlacklisted')}</Signal>
          ) : customer ? (
            <Signal tone="success" icon={<ShieldCheck size={13} />}>{t('partnerCase.sigNotBlacklisted')}</Signal>
          ) : null}
          {rating != null && (
            <Signal tone={rating <= 2 ? 'warning' : 'neutral'} icon={<Star size={13} />}>
              {t('partnerCase.sigRating', { score: rating })}
            </Signal>
          )}
          {ranContracts.length === 0 ? (
            <Signal tone="neutral" icon={<History size={13} />}>{t('partnerCase.sigNewCustomer')}</Signal>
          ) : (
            <>
              <Signal tone="neutral" icon={<History size={13} />}>
                {t('partnerCase.sigPastContracts', { count: ranContracts.length })}
              </Signal>
              {totalOverdue > 0 && (
                <Signal tone="danger">{t('partnerCase.sigOverdueNow', { count: totalOverdue })}</Signal>
              )}
              {totalLate > 0 ? (
                <Signal tone="warning">{t('partnerCase.sigPaidLate', { count: totalLate, days: worstLate })}</Signal>
              ) : totalPaid > 0 && totalOverdue === 0 ? (
                <Signal tone="success">{t('partnerCase.sigAlwaysOnTime')}</Signal>
              ) : null}
            </>
          )}
          {age != null && <Signal tone="neutral">{t('partnerCase.sigAge', { age })}</Signal>}
        </div>

        {customer?.is_blacklisted && blacklist[0] && (
          <div className="alert alert-danger">
            <ShieldAlert size={16} className="shrink-0" />
            <div>
              <div className="font-medium">{t('partnerCase.blacklistTitle')}</div>
              {blacklist[0].reason && <div className="text-sm">{blacklist[0].reason}</div>}
              <div className="text-xs opacity-80 mt-0.5"><DateTime value={blacklist[0].created_at} showTime={false} /></div>
            </div>
          </div>
        )}

        {/* 2. Who asked, when, and what they said */}
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

        {/* 3. Who the customer is, with every photo of them */}
        <Section icon={<User size={14} />} title={t('partnerCase.customerTitle')}>
          <div className="flex items-center gap-2 min-w-0">
            <Badge color="primary" size="sm">{t('partnerCase.role_LESSEE')}</Badge>
            {/* The customer page has the rest (all addresses, edit history,
                every contract) — a link, so ctrl-click opens it beside. */}
            <EntityCodeLink
              to={customerId ? `/admin/customers/${customerId}` : null}
              code={lessee
                ? [lessee.prefix, lessee.first_name, lessee.last_name].filter(Boolean).join(' ')
                : detail.customer_name}
              className="text-sm font-medium min-w-0 truncate"
            />
          </div>
          <div className="grid grid-cols-2 gap-3 mt-3">
            {lessee?.id_number && <Field label={t('partnerCase.idNumber')} value={formatCid(lessee.id_number)} />}
            {lessee?.date_of_birth && (
              <Field
                label={t('partnerCase.dateOfBirth')}
                value={<><DateTime value={lessee.date_of_birth} showTime={false} />{age != null && <span className="text-subtle"> · {t('partnerCase.ageYears', { age })}</span>}</>}
              />
            )}
            {lessee?.tel && <Field label={t('partnerCase.tel')} value={formatTel(lessee.tel)} />}
          </div>

          {otherParties.map((p, i) => (
            <div key={i} className="mt-3 rounded-md border border-line px-3 py-2">
              <div className="flex items-center gap-2">
                <Badge size="sm">{t(`partnerCase.role_${p.role ?? 'CO_LESSEE'}`, { defaultValue: p.role ?? '' })}</Badge>
                <span className="text-sm font-medium">{[p.prefix, p.first_name, p.last_name].filter(Boolean).join(' ')}</span>
              </div>
              <div className="grid grid-cols-2 gap-3 mt-2">
                {p.id_number && <Field label={t('partnerCase.idNumber')} value={formatCid(p.id_number)} />}
                {p.tel && <Field label={t('partnerCase.tel')} value={formatTel(p.tel)} />}
              </div>
            </div>
          ))}

          <div className="mt-3 flex flex-col gap-3">
            {photoGroups.length === 0 ? (
              <div className="text-sm text-subtler flex items-center gap-2">
                <ImageOff size={14} /> {t('partnerCase.noCustomerPhotos')}
              </div>
            ) : photoGroups.map(g => (
              <div key={g.key}>
                <div className="text-xs font-medium text-subtle mb-1.5">{g.label}</div>
                <div className="flex flex-wrap gap-2">
                  {g.items.map(item => (
                    <MediaThumbButton
                      key={item.id}
                      mediaKey={item.thumb}
                      alt={g.label}
                      onClick={() => openPhoto(item.key)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* 4. How to reach them */}
        <Section icon={<Phone size={14} />} title={t('partnerCase.reachTitle')}>
          <div className="flex flex-col gap-3">
            <AddressLine
              label={t('partnerCase.contractAddress')}
              value={contractAddress ? formatAddress(contractAddress) : null}
            />
            <AddressLine
              label={t('partnerCase.workAddress')}
              value={workAddress ? formatAddress(workAddress) : null}
            />
            <div>
              <div className="text-xs text-subtle">{t('partnerCase.otherContacts')}</div>
              {extraPhones.length === 0 ? (
                <div className="text-sm text-subtler">—</div>
              ) : (
                <div className="flex flex-col gap-0.5 mt-0.5">
                  {extraPhones.map(c => (
                    <div key={c.key} className="text-sm flex gap-2">
                      <span className="text-subtle w-20 shrink-0">{c.label}</span>
                      <span className="tabular-nums truncate">{c.value}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div>
              <div className="text-xs text-subtle flex items-center gap-1"><Users size={12} />{t('partnerCase.references')}</div>
              {references.length === 0 ? (
                <div className="text-sm text-subtler">—</div>
              ) : (
                <div className="flex flex-col gap-1 mt-1">
                  {references.map((r, i) => (
                    <div key={r.id ?? i} className="text-sm flex items-baseline gap-2 min-w-0">
                      <span className="font-medium truncate">{[r.name, r.last_name].filter(Boolean).join(' ')}</span>
                      {r.relation && <span className="text-subtle text-xs shrink-0">{r.relation}</span>}
                      <span className="flex-1" />
                      {r.tel && <span className="tabular-nums shrink-0">{formatTel(r.tel)}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </Section>

        {/* 5. How they paid before */}
        <Section icon={<History size={14} />} title={t('partnerCase.paymentRecordTitle')}>
          {/* A reviewer reads only their own fund's contracts (the views are
              scoped by company), so a customer behind on a contract at another
              branch of the group looks clean here. Say so where it matters. */}
          <div className="text-xs text-subtle mb-2">{t('partnerCase.recordScopeNote')}</div>
          {ranContracts.length > 0 && (
            <div className="flex flex-wrap gap-x-3 gap-y-1 mb-2 text-xs text-subtle">
              {(['onTime', 'late', 'overdue', 'future'] as const).map(k => (
                <span key={k} className="inline-flex items-center gap-1">
                  <span className={`block w-3 h-3 rounded-sm border ${MARK_CLASS[k]}`} />
                  {t(`partnerCase.legend_${k}`)}
                </span>
              ))}
            </div>
          )}
          {ranContracts.length === 0 ? (
            <div className="text-sm text-subtler">{t('partnerCase.noPaymentRecord')}</div>
          ) : (
            <div className="rounded-md border border-line overflow-hidden">
              {sortedRan.map(c => {
                const late = lateBy.get(c.contract_id);
                const overdue = c.overdue_count ?? 0;
                const paid = c.paid_installment_count ?? 0;
                return (
                  <div key={c.contract_id} className="px-3 py-2 border-b border-line last:border-b-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <EntityCodeLink
                        to={`/admin/contracts/search/${c.contract_id}`}
                        code={c.contract_code}
                        className="text-sm font-medium shrink-0"
                      />
                      <Badge size="sm">{t(`contract.state_${c.state}`, { defaultValue: c.state })}</Badge>
                      <span className="flex-1 min-w-0 truncate text-xs text-subtle">{c.product_display_name ?? ''}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 mt-1 text-xs">
                      <span className="text-subtle tabular-nums">
                        {t('partnerCase.paidOf', { paid, total: c.total_installments ?? 0 })}
                      </span>
                      {overdue > 0 && (
                        <Badge color="danger" size="xs">
                          {t('partnerCase.overdueNow', { count: overdue, amount: fmtCurrency(c.overdue_amount ?? 0) })}
                        </Badge>
                      )}
                      {late ? (
                        <Badge color="warning" size="xs">
                          {t('partnerCase.paidLate', { count: late.lateCount, days: late.worstDays })}
                        </Badge>
                      ) : paid > 0 && overdue === 0 ? (
                        <Badge color="success" size="xs">{t('partnerCase.onTime')}</Badge>
                      ) : null}
                    </div>
                    {/* One mark per instalment, in order — how this customer
                        actually pays, not just a count. Hover for the dates. */}
                    {marksOf(c.contract_id).length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {marksOf(c.contract_id).map(i => {
                          const kind = markKind(i);
                          return (
                            <Tooltip key={i.pay_no} content={markTip(i, kind)} placement="top">
                              <span
                                className={`block w-3.5 h-3.5 rounded-sm border ${MARK_CLASS[kind]}`}
                                aria-label={markLabel(i, kind)}
                              />
                            </Tooltip>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {/* Drafts that expired or were cancelled never ran, so they say
              nothing about paying — counted, out of the way, openable. */}
          {unopenedContracts.length > 0 && (
            <div className="mt-2">
              <button
                type="button"
                onClick={() => setShowUnopened(v => !v)}
                className="text-xs text-primary-fg hover:underline bg-transparent border-none cursor-pointer p-0"
              >
                {showUnopened
                  ? t('partnerCase.hideUnopened')
                  : t('partnerCase.showUnopened', { count: unopenedContracts.length })}
              </button>
              {showUnopened && (
                <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
                  {unopenedContracts.map(c => (
                    <span key={c.contract_id} className="text-xs inline-flex items-center gap-1">
                      <EntityCodeLink to={`/admin/contracts/search/${c.contract_id}`} code={c.contract_code} iconSize={10} />
                      <span className="text-subtle">{t(`contract.state_${c.state}`, { defaultValue: c.state })}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </Section>

        {/* 6. The deal: the money, exactly as submitted */}
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

        {/* The device, plus its own photo album when it has one */}
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

          {/* Only the photos that exist. Device photos are not needed to decide
              a case (UI_SUMMARY/139: "รูปไม่ใช่ด่านยื่น") and almost every case
              arrives without them, so listing empty slots as "missing" read as
              a problem the reviewer had to act on. */}
          <div className="mt-3 flex flex-col gap-3">
            {devicePhotos.length === 0 ? (
              <div className="text-sm text-subtler flex items-center gap-2">
                <ImageOff size={14} /> {t('partnerCase.noPhotos')}
              </div>
            ) : devicePhotos.map(slot => (
              <div key={slot.slot}>
                <div className="text-xs font-medium text-subtle mb-1.5">{slot.label_th}</div>
                <div className="flex flex-wrap gap-2">
                  {(slot.photos ?? []).map(p => (
                    <MediaThumbButton
                      key={p.entity_media_id}
                      mediaKey={p.variants_json?.sm ?? p.storage_path}
                      alt={slot.label_th}
                      onClick={() => openPhoto(p.storage_path, devicePhotoKeys)}
                    />
                  ))}
                </div>
              </div>
            ))}
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

function AddressLine({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <div className="text-xs text-subtle flex items-center gap-1"><MapPin size={12} />{label}</div>
      <div className={`text-sm ${value ? '' : 'text-subtler'}`}>{value ?? '—'}</div>
    </div>
  );
}

/** One flag in the top row — a soft pill, coloured only when it means something. */
function Signal({ tone, icon, children }: {
  tone: 'danger' | 'warning' | 'success' | 'neutral';
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  const cls = {
    danger: 'bg-danger-soft text-danger-fg border-danger-border',
    warning: 'bg-warning-soft text-warning-fg border-warning-border',
    success: 'bg-success-soft text-success-fg border-success-border',
    neutral: 'bg-surface-soft text-fg border-line',
  }[tone];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${cls}`}>
      {icon}{children}
    </span>
  );
}
