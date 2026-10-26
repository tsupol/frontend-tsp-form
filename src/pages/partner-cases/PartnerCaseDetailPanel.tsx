// The credit reviewer's view of one request.
//
// Built for this one job, on purpose not from the contract page's parts, so it
// can be shaped around the decision. It reads top to bottom in the order a
// reviewer decides:
//   1. a checklist — identity, blacklist, payment record, reach, shop rating —
//      each line coloured only when it needs a look, and opening its section
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

import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button, Tooltip } from 'tsp-form';
import {
  ArrowLeft, Clock, FileText, Smartphone, User, Wallet, MapPin, Phone, Users,
  History, AlertTriangle, ImageOff, Star, ChevronRight,
  CheckCircle2, XCircle, Info, MessageCircle, Percent,
} from 'lucide-react';
import { apiClient } from '../../lib/api';
import { DateTime } from '../../components/DateTime';
import { EntityCodeLink } from '../../components/EntityCodeLink';
import { fmtCurrency, formatTel, formatCid } from '../../lib/format';
import { MediaLightboxKeyGallery, MediaThumbButton } from '../../components/MediaLightbox';
import { normalizeKey } from '../../lib/mediaPath';
import { useContractAlbumPhotos } from '../contracts/contractPhotoStatus';
import { passesThaiCidChecksum } from '../../lib/ocr/extractIdCard';
import { thaiPhoneReason } from '../../lib/validators';
import { TelLink, ValidMark } from '../../components/TelLink';
import { ContactValue } from '../../components/ContactValue';
import { PaymentRecordList } from '../../components/PaymentRecord';
import { usePaymentRecord } from '../../hooks/usePaymentRecord';
import { ageFrom } from './customerRisk';
import { usePartnerCaseActions, usePartnerCaseReturnReasons, useAssetEvidence } from './usePartnerCases';
import { outcomeBadgeColor, type PartnerCaseDetail } from './partnerCaseTypes';
import { PartnerCaseApproveModal } from './PartnerCaseApproveModal';
import { adjustLabel, adjustValue, adjustmentRows } from './adjustFormat';
import { PartnerCaseReturnModal } from './PartnerCaseReturnModal';
import { PartnerCaseCommissionSection } from './PartnerCaseCommissionSection';

interface PartnerCaseDetailPanelProps {
  detail: PartnerCaseDetail | null;
  loading: boolean;
  isMobile: boolean;
  onBack?: () => void;
  /** Called after an approve/return so the queue can drop the row. */
  onDecided?: () => void;
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

/** Row of `v_contract_photo_slots` — the group names for the contract's photos. */
interface PhotoSlotRef {
  usage_type: string;
  label_th: string;
  label_en: string;
  sort_order: number;
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
  const identityRef = useRef<HTMLElement>(null);
  const reachRef = useRef<HTMLElement>(null);
  const recordRef = useRef<HTMLElement>(null);
  const jumpTo = (ref: React.RefObject<HTMLElement | null>) =>
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

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

  // How they paid before — every other contract of theirs this fund can see.
  const record = usePaymentRecord(customerId, contractId);

  const { data: evidence = [] } = useAssetEvidence(assetId);

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

  const { ran: ranContracts, totalOverdue, totalLate, worstLate, totalPaid } = record;

  // The contract's address and reference people are the ones submitted; the
  // work address and phone numbers are the customer record's.
  const contractAddress = lessee?.address ?? null;
  const workAddress = addresses.find(a => a.address_type === 'WORK') ?? null;
  const references: ReferencePerson[] = (lessee?.references?.length ? lessee.references : liveReferences);
  // Every number the customer can be called on, the contract's own first, each
  // once; then the non-phone channels.
  const digits = (v: string | null | undefined) => (v ?? '').replace(/\D/g, '');
  const phones: Array<{ key: string; label: string; raw: string }> = [];
  const seen = new Set<string>();
  const addPhone = (key: string, label: string, raw: string | null | undefined) => {
    const d = digits(raw);
    if (!d || seen.has(d)) return;
    seen.add(d);
    phones.push({ key, label, raw: d });
  };
  addPhone('main', t('partnerCase.mainPhone'), lessee?.tel);
  addPhone('tel2', t('partnerCase.contactType_MOBILE'), customer?.tel2);
  for (const c of contacts) {
    if (['MOBILE', 'HOME', 'WORK'].includes(c.contact_type)) {
      addPhone(`c${c.id}`, t(`partnerCase.contactType_${c.contact_type}`), c.value);
    }
  }
  const channels = [
    ...contacts
      .filter(c => !['MOBILE', 'HOME', 'WORK'].includes(c.contact_type))
      .map(c => ({ key: `c${c.id}`, label: t(`partnerCase.contactType_${c.contact_type}`, { defaultValue: c.contact_type }), value: c.value })),
    ...(customer?.line_id ? [{ key: 'line', label: 'LINE', value: customer.line_id }] : []),
    ...(customer?.facebook ? [{ key: 'fb', label: 'Facebook', value: customer.facebook }] : []),
  ];
  const badPhones = phones.filter(ph => thaiPhoneReason(ph.raw) !== null).length
    + references.filter(r => r.tel && thaiPhoneReason(r.tel) !== null).length;

  // The ID number: only a citizen ID has a check digit to test.
  const cidDigits = digits(lessee?.id_number);
  const cidChecked = (lessee?.id_type ?? 'CITIZEN_ID') === 'CITIZEN_ID' && cidDigits.length > 0;
  const cidValid = cidChecked ? passesThaiCidChecksum(cidDigits) : null;

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

        {/* 1. The checklist: one line per thing a reviewer decides, in page
            order. Only problems are coloured; a line opens its section. */}
        <div className="rounded-md border border-line divide-y divide-line">
          <CheckRow
            status={cidValid === false ? 'bad' : idDocs.length === 0 ? 'warn' : 'ok'}
            label={t('partnerCase.chkIdentity')}
            detail={cidValid === false
              ? t('partnerCase.chkCidInvalid')
              : idDocs.length === 0
                ? t('partnerCase.chkIdentityNoId')
                : contractPhotos.length > 0
                  ? t('partnerCase.chkIdentityOk', { count: contractPhotos.length })
                  : t('partnerCase.chkIdentityIdOnly')}
            onJump={() => jumpTo(identityRef)}
          />
          {customer && (
            <CheckRow
              status={customer.is_blacklisted ? 'bad' : 'ok'}
              label={t('partnerCase.chkBlacklist')}
              detail={customer.is_blacklisted
                ? (blacklist[0]?.reason || t('partnerCase.chkBlacklisted'))
                : t('partnerCase.chkNotBlacklisted')}
            />
          )}
          <CheckRow
            status={totalOverdue > 0 ? 'bad' : totalLate > 0 ? 'warn' : totalPaid > 0 ? 'ok' : 'info'}
            label={t('partnerCase.chkRecord')}
            detail={ranContracts.length === 0
              ? t('partnerCase.chkRecordNone')
              : [
                totalOverdue > 0 ? t('partnerCase.chkRecordOverdue', { count: totalOverdue }) : null,
                totalLate > 0 ? t('partnerCase.chkRecordLate', { count: totalLate, days: worstLate }) : null,
                totalOverdue === 0 && totalLate === 0
                  ? (totalPaid > 0
                    ? t('partnerCase.chkRecordOnTime', { count: ranContracts.length })
                    : t('partnerCase.chkRecordNotDue'))
                  : null,
              ].filter(Boolean).join(' · ')}
            onJump={() => jumpTo(recordRef)}
          />
          <CheckRow
            status={!contractAddress || references.length === 0 || badPhones > 0 ? 'warn' : 'ok'}
            label={t('partnerCase.chkReach')}
            detail={!contractAddress
              ? t('partnerCase.chkReachNoAddress')
              : references.length === 0
                ? t('partnerCase.chkReachNoRef')
                : badPhones > 0
                  ? t('partnerCase.chkReachBadPhone', { count: badPhones })
                  : t('partnerCase.chkReachOk', {
                    addresses: (contractAddress ? 1 : 0) + (workAddress ? 1 : 0),
                    phones: phones.length,
                    refs: references.length,
                  })}
            onJump={() => jumpTo(reachRef)}
          />
          {rating != null && (
            <CheckRow
              status={rating <= 2 ? 'warn' : 'info'}
              label={t('partnerCase.chkRating')}
              detail={
                <span className="inline-flex items-center gap-0.5">
                  {[1, 2, 3, 4, 5].map(n => (
                    <Star key={n} size={12} className={n <= rating ? 'text-warning-fg fill-warning' : 'text-subtler'} />
                  ))}
                  <span className="ml-1">{t('partnerCase.chkRatingScore', { score: rating })}</span>
                </span>
              }
            />
          )}
        </div>

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
          {/* Approved with adjustments: what credit changed, why, and whether
              the shop has acknowledged it yet (billing and signing wait on it). */}
          {detail.has_adjustments && (
            <div className="mt-3 -mx-3 rounded-md border border-line px-3 py-2 flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium flex-1">{t('partnerCase.adjustedTitle')}</span>
                {detail.awaiting_ack ? (
                  <Badge color="warning" size="sm">{t('partnerCase.ackWaiting')}</Badge>
                ) : (
                  <Badge color="success" size="sm">{t('partnerCase.ackDone')}</Badge>
                )}
              </div>
              <div className="flex flex-col gap-1 text-sm">
                {adjustmentRows(detail.adjustments).map(r => (
                  <div key={r.key} className="flex items-center gap-2">
                    <span className="text-subtle flex-1 min-w-0">{adjustLabel(r.key, t)}</span>
                    <span className="tabular-nums text-subtle">{adjustValue(r.key, r.requested, t)}</span>
                    <span className="text-subtler">→</span>
                    <span className="tabular-nums font-medium">{adjustValue(r.key, r.approved, t)}</span>
                  </div>
                ))}
              </div>
              {detail.approve_note && (
                <div className="text-sm">{detail.approve_note}</div>
              )}
              {detail.acknowledged_at && (
                <div className="text-xs text-subtle">
                  {t('partnerCase.acknowledgedAt')}{' '}
                  <DateTime value={detail.acknowledged_at} showTime />
                  {detail.acknowledged_by_name && <> · {detail.acknowledged_by_name}</>}
                </div>
              )}
            </div>
          )}
        </section>

        {/* 3. Who the customer is, with every photo of them */}
        <Section icon={<User size={14} />} title={t('partnerCase.customerTitle')} sectionRef={identityRef}>
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
            {lessee?.id_number && (
              <Field
                label={t('partnerCase.idNumber')}
                value={
                  <span className="inline-flex items-center gap-1.5">
                    {formatCid(lessee.id_number)}
                    {cidValid !== null && (
                      <ValidMark
                        ok={cidValid}
                        tip={cidValid ? t('partnerCase.cidValid') : t('partnerCase.cidInvalid')}
                      />
                    )}
                  </span>
                }
              />
            )}
            {lessee?.date_of_birth && (
              <Field
                label={t('partnerCase.dateOfBirth')}
                value={<><DateTime value={lessee.date_of_birth} showTime={false} />{age != null && <span className="text-subtle"> · {t('partnerCase.ageYears', { age })}</span>}</>}
              />
            )}
            {lessee?.tel && <Field label={t('partnerCase.tel')} value={<TelLink tel={lessee.tel} />} />}
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
        <Section icon={<Phone size={14} />} title={t('partnerCase.reachTitle')} sectionRef={reachRef}>
          <div className="flex flex-col gap-4">
            <AddressBlock
              label={t('partnerCase.contractAddress')}
              value={contractAddress ? formatAddress(contractAddress) : null}
            />
            <AddressBlock
              label={t('partnerCase.workAddress')}
              value={workAddress ? formatAddress(workAddress) : null}
            />

            <div>
              <SubLabel icon={<Phone size={12} />}>{t('partnerCase.phones')}</SubLabel>
              {phones.length === 0 ? (
                <div className="text-sm text-subtler mt-1.5">—</div>
              ) : (
                <div className="mt-1.5 rounded-md border border-line divide-y divide-line">
                  {phones.map(ph => (
                    <div key={ph.key} className="flex items-center gap-2 px-3 py-2 text-sm">
                      <span className="text-subtle flex-1 min-w-0 truncate">{ph.label}</span>
                      <TelLink tel={ph.raw} />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {channels.length > 0 && (
              <div>
                <SubLabel icon={<MessageCircle size={12} />}>{t('partnerCase.otherContacts')}</SubLabel>
                <div className="mt-1.5 rounded-md border border-line divide-y divide-line">
                  {channels.map(c => (
                    <div key={c.key} className="flex items-center gap-2 px-3 py-2 text-sm">
                      <span className="text-subtle flex-1 min-w-0 truncate">{c.label}</span>
                      <ContactValue value={c.value} />
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div>
              <SubLabel icon={<Users size={12} />}>{t('partnerCase.references')}</SubLabel>
              {references.length === 0 ? (
                <div className="text-sm text-subtler mt-1.5">{t('partnerCase.noReferences')}</div>
              ) : (
                <div className="mt-1.5 rounded-md border border-line divide-y divide-line">
                  {references.map((r, i) => (
                    <div key={r.id ?? i} className="flex items-center gap-3 px-3 py-2">
                      <span className="w-8 h-8 rounded-full bg-surface-soft border border-line flex items-center justify-center shrink-0 text-subtle">
                        <User size={14} />
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{[r.name, r.last_name].filter(Boolean).join(' ') || '—'}</div>
                        {r.relation && <div className="text-xs text-subtle truncate">{r.relation}</div>}
                      </div>
                      {r.tel && <TelLink tel={r.tel} />}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </Section>

        {/* 5. How they paid before */}
        <Section icon={<History size={14} />} title={t('partnerCase.paymentRecordTitle')} sectionRef={recordRef}>
          {/* A reviewer reads only their own fund's contracts (the views are
              scoped by company), so a customer behind on a contract at another
              branch of the group looks clean here. Say so where it matters. */}
          <div className="text-xs text-subtle mb-2">{t('partnerCase.recordScopeNote')}</div>
          <PaymentRecordList record={record} emptyText={t('partnerCase.noPaymentRecord')} />
        </Section>

        {/* 6. The deal: the money as approved — credit's figures when it
             adjusted, else the request (the deal_* columns, mig 1526). */}
        <Section icon={<Wallet size={14} />} title={t('partnerCase.moneyTitle')}>
          {/* No agreed price here. It is a derived figure — the down payment
           *  plus every instalment — and on a shop contract there is no price
           *  negotiated with the fund for it to represent: the shop prices the
           *  phone through the plan below, and the fund pays device cost plus
           *  commission regardless. Showing it (and the discount derived from
           *  it) implied a negotiation that does not happen.
           *
           *  What the owner does want (NOTICE 2026-10-24 price display): the
           *  device's selling price, the uplift on top, and the net price they
           *  make. The net is the one sum done here — BE's own rule (device +
           *  uplift; net − down = financed on every case). */}
          {(() => {
            const retail = snapshot?.rated?.retail_price ?? null;
            const uplift = detail.deal_uplift_amount ?? 0;
            const net = retail != null ? retail + uplift : null;
            return (
              <div className="rounded-md border border-line divide-y divide-line text-sm mb-3">
                <div className="flex items-center gap-3 px-3 py-1.5">
                  <span className="flex-1 text-subtle">{t('partnerCase.retailPrice')}</span>
                  <span className="tabular-nums">{fmtCurrency(retail)}</span>
                </div>
                <div className="flex items-center gap-3 px-3 py-1.5">
                  <span className="flex-1 text-subtle">+ {t('partnerCase.uplift')}</span>
                  <span className="tabular-nums">{fmtCurrency(uplift)}</span>
                </div>
                <div className="flex items-center gap-3 px-3 py-1.5">
                  <span className="flex-1 font-medium">= {t('partnerCase.netPrice')}</span>
                  <span className="tabular-nums font-semibold">{fmtCurrency(net)}</span>
                </div>
              </div>
            );
          })()}
          <div className="grid grid-cols-2 gap-3">
            {detail.guarantee_days != null && (
              <Field label={t('partnerCase.guarantee')} value={t('partnerCase.guaranteeDays', { n: detail.guarantee_days })} />
            )}
            <Field label={t('partnerCase.downPayment')} value={fmtCurrency(detail.deal_down_payment)} />
            <Field
              label={t('partnerCase.financedAmount')}
              value={fmtCurrency(detail.deal_financed_amount)}
              emphasis
            />
            <Field
              label={t('partnerCase.installments')}
              value={`${detail.deal_term_months ?? '—'} × ${fmtCurrency(detail.deal_installment_amount)}`}
            />
            <Field
              label={t('partnerCase.lastInstallment')}
              value={fmtCurrency(detail.deal_last_installment_amount)}
            />
            <Field label={t('partnerCase.docFee')} value={fmtCurrency(detail.deal_doc_fee_amount)} />
            {/* No deal total comes down ready-made; the agreed price is the
                down plus every installment (BE's own definition), so the
                total is that price less the down. */}
            {detail.deal_agreed_price != null && detail.deal_down_payment != null && (
              <Field
                label={t('partnerCase.installmentTotal')}
                value={fmtCurrency(detail.deal_agreed_price - detail.deal_down_payment)}
              />
            )}
          </div>
        </Section>

        {/* The shop's commission and what lowering it took off the interest.
            Hidden on cases from before the commission was frozen on the case. */}
        <PartnerCaseCommissionSection
          caseId={detail.case_id}
          status={detail.status}
          wrap={body => (
            <Section icon={<Percent size={14} />} title={t('partnerCase.commissionTitle')}>{body}</Section>
          )}
        />

        {/* The device, plus its own photo album when it has one */}
        <Section icon={<Smartphone size={14} />} title={t('partnerCase.deviceTitle')}>
          {/* The product name is the long one (brand + model + storage +
              colour), so it gets the row and wraps rather than cutting off;
              the condition is one word and sits beside it. */}
          <div className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-3">
            {/* The view's standard name (mig 1422) — not the snapshot's bare
             *  variant, which hid the model. */}
            <div className="min-w-0">
              <div className="text-xs text-subtle">{t('partnerCase.product')}</div>
              <div className="text-sm">{detail.product_display_name ?? '—'}</div>
            </div>
            <Field
              label={t('partnerCase.condition')}
              value={detail.is_used_asset ? t('partnerCase.used') : t('partnerCase.new')}
            />
          </div>
          <div className="grid grid-cols-2 gap-3 mt-3">
            <Field label={t('partnerCase.assetCode')} value={asset?.asset_code ?? detail.asset_code ?? '—'} />
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

function Section({ icon, title, children, sectionRef }: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  /** For the checklist's jump links. */
  sectionRef?: React.Ref<HTMLElement>;
}) {
  return (
    <section ref={sectionRef} className="border border-line rounded-md px-4 py-3 scroll-mt-3">
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

function SubLabel({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return <div className="text-xs text-subtle flex items-center gap-1">{icon}{children}</div>;
}

function AddressBlock({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <SubLabel icon={<MapPin size={12} />}>{label}</SubLabel>
      <div className={`text-sm mt-1.5 leading-relaxed ${value ? '' : 'text-subtler'}`}>{value ?? '—'}</div>
    </div>
  );
}

type CheckStatus = 'ok' | 'warn' | 'bad' | 'info';

/** One line of the checklist. With onJump it opens its section below. */
function CheckRow({ status, label, detail, onJump }: {
  status: CheckStatus;
  label: string;
  detail: React.ReactNode;
  onJump?: () => void;
}) {
  const icon = {
    ok: <CheckCircle2 size={15} className="text-success-fg" />,
    warn: <AlertTriangle size={15} className="text-warning-fg" />,
    bad: <XCircle size={15} className="text-danger-fg" />,
    info: <Info size={15} className="text-subtle" />,
  }[status];
  const detailClass = status === 'bad' ? 'text-danger-fg' : status === 'warn' ? 'text-warning-fg' : 'text-subtle';
  const body = (
    <>
      <span className="shrink-0 mt-0.5">{icon}</span>
      <span className="text-sm font-medium w-28 shrink-0">{label}</span>
      <span className={`text-sm flex-1 min-w-0 ${detailClass}`}>{detail}</span>
      {onJump && <ChevronRight size={14} className="text-subtle shrink-0 mt-0.5" />}
    </>
  );
  return onJump ? (
    <button
      type="button"
      onClick={onJump}
      className="w-full flex items-start gap-2 px-3 py-2 text-left bg-transparent border-none cursor-pointer hover:bg-item-hover-bg transition-colors"
    >
      {body}
    </button>
  ) : (
    <div className="flex items-start gap-2 px-3 py-2">{body}</div>
  );
}
