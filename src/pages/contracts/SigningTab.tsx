// Read-only signing tab for the contract detail panel.
//
// Data sources (per UI_SUMMARY/42b §3, UI_TEAM_NOTICE_SNAPSHOT_EVENT_DRIVEN_2026_06_12.md):
//   - api.v_contract_signing_visible  → UI default. Same columns as
//     v_contract_signing_history, with system auto-voids (voided_by=0 — emitted
//     by fn_bill_cancel / fn_contract_unbind_device / etc.) hidden.
//   - api.v_contract_signing_history  → full audit, including system auto-voids.
//     Surfaced via the "Show system events" toggle for audit/debug.
//   - api.v_contract_signing_party    → one row per party (LESSOR / LESSEE /
//     CO_LESSEE / WITNESS), with frozen identity + signed_at.
//
// Rendering model:
//   - One collapsible card per snapshot. Default expanded: newest COLLECTING.
//   - Collapsed view = single header line (status dot, version, reason, counts).
//   - Per-status action surface:
//       COLLECTING        → Void + per-party Sign
//       SEALED/SUPERSEDED → Print contract PDF
//       VOIDED            → no actions, void reason inline
//   - System-voided rows (voided_by=0) show a Bot icon for disambiguation.

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button, Switch, Tooltip } from 'tsp-form';
import {
  Bot, CheckCircle2, ChevronDown, ChevronRight, Circle, Eye, FileSignature, Info, PenLine,
  Printer, Trash2, XCircle,
} from 'lucide-react';
import type { BeMediaContractDoc } from '../../lib/beMedia';
import { apiClient } from '../../lib/api';
import { formatCid, formatTel } from '../../lib/format';
import { DateTime } from '../../components/DateTime';
import { SigningVoidModal } from './SigningVoidModal';
import { SigningSignModal } from './SigningSignModal';
import { SigningDetailModal } from './SigningDetailModal';
import { ContractAttachments } from './ContractAttachments';

type SigningStatus = 'COLLECTING' | 'SEALED' | 'SUPERSEDED' | 'VOIDED';
type SigningCategory = 'CONTRACT' | 'AMENDMENT' | 'RECEIPT' | null;
type PartyRole = 'LESSOR' | 'LESSEE' | 'CO_LESSEE' | 'WITNESS';

interface SigningHistoryRow {
  signing_id: number;
  contract_id: number;
  version: number | null;
  type: 'FULL_CONTRACT' | 'ADDENDUM' | string;
  category: SigningCategory;
  required_witnesses: number | null;
  status: SigningStatus;
  is_current_full_contract: boolean;
  change_reason: string | null;
  change_reason_fk: string | null;
  change_note: string | null;
  is_forced: boolean;
  supersedes_id: number | null;
  superseded_by: number | null;
  created_at: string;
  sealed_at: string | null;
  voided_at: string | null;
  voided_by: number | null;
  void_reason: string | null;
  expires_at: string | null;
  ttl_remaining: string | null;
  signed_count: number;
  total_parties: number;
  pdf_available: boolean;
}

interface SigningPartyRow {
  id: number;
  signing_id: number;
  contract_id: number;
  party_role: PartyRole;
  party_index: number;
  customer_id: number | null;
  staff_id: number | null;
  frozen_full_name: string | null;
  frozen_id_number: string | null;
  frozen_phone: string | null;
  signature_media_id: number | null;
  signed_at: string | null;
  has_signed: boolean;
}

function statusBadgeColor(s: SigningStatus): 'success' | 'warning' | 'default' | 'danger' {
  switch (s) {
    case 'COLLECTING': return 'warning';
    case 'SEALED':     return 'success';
    case 'SUPERSEDED': return 'default';
    case 'VOIDED':     return 'danger';
    default:           return 'default';
  }
}

function statusDotClass(s: SigningStatus): string {
  switch (s) {
    case 'COLLECTING': return 'bg-warning';
    case 'SEALED':     return 'bg-success';
    case 'SUPERSEDED': return 'bg-fg/30';
    case 'VOIDED':     return 'bg-danger/70';
    default:           return 'bg-fg/30';
  }
}

function cardBorderClass(s: SigningStatus): string {
  switch (s) {
    case 'COLLECTING': return 'border-warning-border';
    case 'SEALED':     return 'border-success-border';
    case 'SUPERSEDED':
    case 'VOIDED':     return 'border-line-subtle';
    default:           return 'border-line';
  }
}

function roleColor(r: PartyRole): 'primary' | 'info' | 'default' {
  switch (r) {
    case 'LESSOR':    return 'primary';
    case 'LESSEE':    return 'primary';
    case 'CO_LESSEE': return 'info';
    case 'WITNESS':   return 'default';
    default:          return 'default';
  }
}

// Format a Postgres `interval` string like "01:23:45" or "1 day 02:00:00" into
// a compact "Xh Ym" hint. Returns null when the input is null or unparseable.
function formatTtl(raw: string | null): string | null {
  if (!raw) return null;
  const dayMatch = raw.match(/^(\d+)\s+days?\s+(.*)$/);
  const days = dayMatch ? parseInt(dayMatch[1], 10) : 0;
  const time = dayMatch ? dayMatch[2] : raw;
  const parts = time.split(':');
  if (parts.length < 2) return null;
  const hours = parseInt(parts[0], 10) + days * 24;
  const minutes = parseInt(parts[1], 10);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  if (hours <= 0 && minutes <= 0) return null;
  if (hours >= 1) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function isSystemVoided(row: SigningHistoryRow): boolean {
  return row.status === 'VOIDED' && row.voided_by === 0;
}

// Map a signing's change_reason to the pre-signing preview doc kind. Used for
// the COLLECTING "Preview" button, which renders from live data (no snapshot)
// via the `doc=` path — pointing at an in-progress signing_id falls back to the
// plain contract, so we resolve the right doc here.
function previewDocFor(row: SigningHistoryRow): BeMediaContractDoc {
  switch (row.change_reason) {
    case 'ADD_CO_LESSEE': return 'addendum_colessee';
    case 'BIND':          return 'addendum_device';
    default:              return 'contract';
  }
}

// What a signing card's PDF buttons request from the renderer.
export interface SigningPdfTarget {
  signingId?: number;
  doc?: BeMediaContractDoc;
}

type SignTarget = {
  signing_id: number;
  party_role: PartyRole;
  party_index: number;
  customer_id: number | null;
  staff_id: number | null;
  frozen_full_name: string | null;
  // Snapshot-level context so the modal can pick the right consent body
  // without re-querying the history view.
  signing_type: string;
  change_reason: string | null;
};

export function SigningTab({
  contractId,
  contractCode,
  onRenderPdf,
}: {
  contractId: number;
  contractCode: string | null;
  onRenderPdf?: (target: SigningPdfTarget) => void;
}) {
  const { t } = useTranslation();
  const [voidSigningId, setVoidSigningId] = useState<number | null>(null);
  const [signTarget, setSignTarget] = useState<SignTarget | null>(null);
  const [detailTarget, setDetailTarget] = useState<{
    signing_id: number;
    signing_type: string;
    change_reason: string | null;
  } | null>(null);
  const [showAudit, setShowAudit] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [defaultedFor, setDefaultedFor] = useState<number | null>(null);

  const sourceView = showAudit ? 'v_contract_signing_history' : 'v_contract_signing_visible';
  const historyQuery = useQuery({
    queryKey: ['contract-signings', contractId, sourceView],
    queryFn: () => apiClient.get<SigningHistoryRow[]>(
      `/${sourceView}?contract_id=eq.${contractId}&order=version.desc,created_at.desc`,
    ),
    staleTime: 30_000,
  });

  const partyQuery = useQuery({
    queryKey: ['contract-signing-parties', contractId],
    queryFn: () => apiClient.get<SigningPartyRow[]>(
      `/v_contract_signing_party?contract_id=eq.${contractId}&order=signing_id.desc,party_index.asc`,
    ),
    staleTime: 30_000,
  });

  const partiesBySigning = useMemo(() => {
    const map = new Map<number, SigningPartyRow[]>();
    for (const p of partyQuery.data ?? []) {
      const arr = map.get(p.signing_id);
      if (arr) arr.push(p);
      else map.set(p.signing_id, [p]);
    }
    return map;
  }, [partyQuery.data]);

  const signings: SigningHistoryRow[] = historyQuery.data ?? [];
  const isLoading = historyQuery.isLoading || partyQuery.isLoading;
  const error = historyQuery.error ?? partyQuery.error;

  // Newest non-VOIDED signing wins. Any COLLECTING older than that one is
  // considered superseded by activity (a newer ceremony was opened or sealed)
  // and shouldn't be signable — even though BE didn't auto-void it. Order is
  // by version desc / created_at desc, so the first non-VOIDED in `signings`
  // is the newest. Equal IDs to the newest are signable; everything older
  // gets locked.
  const newestActiveSigningId: number | null = useMemo(() => {
    for (const s of signings) {
      if (s.status !== 'VOIDED') return s.signing_id;
    }
    return null;
  }, [signings]);

  // Auto-expand the newest COLLECTING row once per contract load. Falling back
  // to the first row if no COLLECTING is present. User's manual expand/collapse
  // overrides this — we only seed `defaultedFor` once per contractId.
  useEffect(() => {
    if (defaultedFor === contractId || signings.length === 0) return;
    const seed = signings.find(s => s.status === 'COLLECTING') ?? signings[0];
    if (seed) {
      setExpanded(prev => {
        const next = new Set(prev);
        next.add(seed.signing_id);
        return next;
      });
    }
    setDefaultedFor(contractId);
  }, [contractId, defaultedFor, signings]);

  const toggleExpanded = (signingId: number) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(signingId)) next.delete(signingId);
      else next.add(signingId);
      return next;
    });
  };

  if (isLoading && signings.length === 0) {
    return <div className="p-8 text-center text-subtler">{t('common.loading')}</div>;
  }
  if (error) {
    return (
      <div className="p-4">
        <div className="alert alert-danger">
          <XCircle size={16} />
          <div className="alert-description">{error instanceof Error ? error.message : String(error)}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 flex flex-col gap-3">
      {/* Contract photo album (delivery/handover evidence) — contract-scoped,
          works before and after signing. */}
      <ContractAttachments contractId={contractId} contractCode={contractCode} />

      <Tooltip content={t('signing.auditToggleHint')}>
        <label className="self-end flex items-center gap-2 text-xs text-subtle cursor-pointer">
          <span>{t('signing.auditToggle')}</span>
          <Switch size="sm" checked={showAudit} onChange={e => setShowAudit(e.target.checked)} />
        </label>
      </Tooltip>

      {signings.length === 0 ? (
        <div className="p-8 text-center text-subtler flex flex-col items-center gap-2">
          <FileSignature size={28} className="text-subtle" />
          <div>{t('signing.empty')}</div>
        </div>
      ) : (
        signings.map(s => (
          <SigningCard
            key={s.signing_id}
            signing={s}
            isStale={s.status === 'COLLECTING' && newestActiveSigningId !== null && s.signing_id !== newestActiveSigningId}
            parties={partiesBySigning.get(s.signing_id) ?? []}
            expanded={expanded.has(s.signing_id)}
            onToggleExpand={() => toggleExpanded(s.signing_id)}
            onRequestVoid={() => setVoidSigningId(s.signing_id)}
            onRequestPreview={onRenderPdf ? () => onRenderPdf({ doc: previewDocFor(s) }) : undefined}
            onRequestPrint={onRenderPdf ? () => onRenderPdf({ signingId: s.signing_id }) : undefined}
            onRequestSign={(party) => setSignTarget({
              signing_id: s.signing_id,
              party_role: party.party_role,
              party_index: party.party_index,
              customer_id: party.customer_id,
              staff_id: party.staff_id,
              frozen_full_name: party.frozen_full_name,
              signing_type: s.type,
              change_reason: s.change_reason,
            })}
            onRequestDetail={() => setDetailTarget({
              signing_id: s.signing_id,
              signing_type: s.type,
              change_reason: s.change_reason,
            })}
          />
        ))
      )}

      <SigningVoidModal
        open={voidSigningId !== null}
        onClose={() => setVoidSigningId(null)}
        contractId={contractId}
        signingId={voidSigningId ?? 0}
      />
      <SigningSignModal
        open={signTarget !== null}
        onClose={() => setSignTarget(null)}
        contractId={contractId}
        party={signTarget}
      />
      <SigningDetailModal
        open={detailTarget !== null}
        onClose={() => setDetailTarget(null)}
        signingId={detailTarget?.signing_id ?? null}
        contractId={contractId}
        signingType={detailTarget?.signing_type ?? ''}
        changeReason={detailTarget?.change_reason ?? null}
      />
    </div>
  );
}

function SigningCard({
  signing, isStale, parties, expanded, onToggleExpand,
  onRequestVoid, onRequestSign, onRequestPreview, onRequestPrint, onRequestDetail,
}: {
  signing: SigningHistoryRow;
  isStale: boolean;
  parties: SigningPartyRow[];
  expanded: boolean;
  onToggleExpand: () => void;
  onRequestVoid: () => void;
  onRequestSign: (party: SigningPartyRow) => void;
  onRequestPreview?: () => void;
  onRequestPrint?: () => void;
  onRequestDetail: () => void;
}) {
  const { t } = useTranslation();
  const ttl = formatTtl(signing.ttl_remaining);
  const isCollecting = signing.status === 'COLLECTING';
  const isActionable = isCollecting && !isStale;
  const systemVoided = isSystemVoided(signing);
  const muted = signing.status === 'VOIDED' || signing.status === 'SUPERSEDED' || isStale;

  // Tail line — the right-aligned context that depends on status.
  let tail: React.ReactNode = null;
  if (isCollecting) {
    tail = (
      <span className="tabular-nums">
        {signing.signed_count}/{signing.total_parties}
        {ttl && <span className="text-warning-fg ml-2">{ttl}</span>}
      </span>
    );
  } else if (signing.status === 'SEALED' && signing.sealed_at) {
    tail = <DateTime value={signing.sealed_at} showTime={false} />;
  } else if (signing.status === 'VOIDED' && signing.voided_at) {
    tail = <DateTime value={signing.voided_at} showTime={false} />;
  } else if (signing.status === 'SUPERSEDED' && signing.sealed_at) {
    tail = <DateTime value={signing.sealed_at} showTime={false} />;
  }

  return (
    <div className={`border ${cardBorderClass(signing.status)} rounded-md overflow-hidden ${muted ? 'opacity-80' : ''}`}>
      {/* Collapsed header — clickable to toggle */}
      <button
        type="button"
        onClick={onToggleExpand}
        className="w-full px-3 py-2.5 flex items-center gap-2 text-left hover:bg-surface/40 transition-colors"
        aria-expanded={expanded}
      >
        <span className="shrink-0">
          {expanded ? <ChevronDown size={14} className="text-subtle" /> : <ChevronRight size={14} className="text-subtle" />}
        </span>
        <span className={`shrink-0 w-2 h-2 rounded-full ${statusDotClass(signing.status)}`} />
        {signing.version != null && (
          <span className="shrink-0 text-xs text-subtle tabular-nums">v{signing.version}</span>
        )}
        <span className="text-sm font-medium truncate">
          {signing.change_reason
            ? t(`signing.reason_${signing.change_reason}`, { defaultValue: signing.change_reason })
            : t(`signing.status_${signing.status}`)}
        </span>
        {signing.is_current_full_contract && (
          <Badge size="xs" color="success">{t('signing.currentContract')}</Badge>
        )}
        {signing.is_forced && (
          <Badge size="xs" color="warning">{t('signing.forced')}</Badge>
        )}
        {isStale && (
          <Tooltip content={t('signing.staleHint')}>
            <Badge size="xs" color="default">{t('signing.staleBadge')}</Badge>
          </Tooltip>
        )}
        {systemVoided && (
          <Tooltip content={t('signing.systemEventHint')}>
            <Bot size={13} className="text-subtle shrink-0" />
          </Tooltip>
        )}
        <span className="ml-auto shrink-0 text-xs text-subtle">{tail}</span>
      </button>

      {expanded && (
        <div className="border-t border-line/60">
          {/* Meta strip */}
          <div className="px-3 py-2 text-[11px] text-subtle flex flex-wrap gap-x-3 gap-y-0.5">
            <span>
              <Badge size="xs" color={statusBadgeColor(signing.status)}>
                {t(`signing.status_${signing.status}`, { defaultValue: signing.status })}
              </Badge>
            </span>
            {signing.type && (
              <span>{signing.type === 'FULL_CONTRACT' ? t('signing.category_CONTRACT') : t('signing.category_AMENDMENT')}</span>
            )}
            <span>{t('signing.createdAt')} <DateTime value={signing.created_at} /></span>
            {signing.sealed_at && (
              <span>{t('signing.sealedAt')} <DateTime value={signing.sealed_at} /></span>
            )}
            {signing.voided_at && (
              <span>{t('signing.voidedAt')} <DateTime value={signing.voided_at} /></span>
            )}
            {signing.expires_at && isCollecting && (
              <span>{t('signing.expiresAt')} <DateTime value={signing.expires_at} /></span>
            )}
          </div>

          {isStale && (
            <div className="px-3 pb-2">
              <div className="alert alert-info">
                <Info size={14} />
                <div className="alert-description text-xs">{t('signing.staleHint')}</div>
              </div>
            </div>
          )}
          {signing.void_reason && (
            <div className="px-3 pb-2 text-xs text-danger">
              {t('signing.voidReason')}: {signing.void_reason}
            </div>
          )}
          {signing.change_note && (
            <div className="px-3 pb-2 text-xs text-subtle italic">"{signing.change_note}"</div>
          )}

          {/* Party list */}
          {parties.length === 0 ? (
            <div className="px-3 py-3 text-xs text-subtler border-t border-line/60">{t('signing.noParties')}</div>
          ) : (
            <ul className="divide-y divide-line/60 border-t border-line/60">
              {parties.map(p => (
                <li key={p.id} className="px-3 py-2 flex items-center gap-3">
                  <span className="shrink-0">
                    {p.has_signed
                      ? <CheckCircle2 size={16} className="text-success" />
                      : <Circle size={16} className="text-subtle" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge size="xs" color={roleColor(p.party_role)}>
                        {t(`signing.role_${p.party_role}`, { defaultValue: p.party_role })}
                      </Badge>
                      <span className="text-sm font-medium truncate">
                        {p.frozen_full_name ?? '—'}
                      </span>
                    </div>
                    <div className="text-[11px] text-subtle mt-0.5 flex flex-wrap gap-x-3">
                      {p.frozen_id_number && <span>{formatCid(p.frozen_id_number)}</span>}
                      {p.frozen_phone && <span>{formatTel(p.frozen_phone)}</span>}
                    </div>
                  </div>
                  <div className="shrink-0 flex items-center gap-2">
                    {p.signed_at ? (
                      <Tooltip content={<DateTime value={p.signed_at} />}>
                        <span className="text-[11px] text-subtle tabular-nums">
                          <DateTime value={p.signed_at} showTime={false} />
                        </span>
                      </Tooltip>
                    ) : isActionable && p.customer_id != null ? (
                      <Button
                        size="sm"
                        color="primary"
                        startIcon={<PenLine size={13} />}
                        onClick={() => onRequestSign(p)}
                      >
                        {t('signing.signConfirm')}
                      </Button>
                    ) : isCollecting && isStale ? (
                      <Tooltip content={t('signing.staleHint')}>
                        <span className="text-[11px] text-subtler">—</span>
                      </Tooltip>
                    ) : (
                      <Tooltip content={t('signing.signStaffPartyUnsupported')}>
                        <span className="text-[11px] text-subtler">—</span>
                      </Tooltip>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {/* Footer actions — View detail always; Preview (live SAMPLE doc) on
              COLLECTING; Print (sealed snapshot) on SEALED/SUPERSEDED; Void on
              COLLECTING. */}
          <div className="px-3 py-2.5 border-t border-line/60 flex flex-wrap gap-1.5 justify-end bg-surface/30">
            <Button
              size="sm"
              variant="outline"
              startIcon={<Info size={13} />}
              onClick={onRequestDetail}
            >
              {t('signing.viewDetail', { defaultValue: 'View detail' })}
            </Button>
            {isCollecting && onRequestPreview && (
              <Button
                size="sm"
                variant="outline"
                startIcon={<Eye size={13} />}
                onClick={onRequestPreview}
              >
                {t('contract.previewContract', { defaultValue: 'Preview' })}
              </Button>
            )}
            {(signing.status === 'SEALED' || signing.status === 'SUPERSEDED') && onRequestPrint && (
              <Button
                size="sm"
                variant="outline"
                startIcon={<Printer size={13} />}
                onClick={onRequestPrint}
              >
                {t('contract.printContractPdf', { defaultValue: 'Print contract PDF' })}
              </Button>
            )}
            {isActionable && (
              <Button
                size="sm"
                variant="outline"
                color="danger"
                startIcon={<Trash2 size={13} />}
                onClick={onRequestVoid}
              >
                {t('signing.voidConfirm')}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
