// Read-only signing tab for the contract detail panel.
//
// Data sources (per UI_SUMMARY/42_CONTRACT_SIGNING.md §8):
//   - api.v_contract_signing_history  → one row per signing, with state /
//     change_reason / sealed_at / ttl / counts
//   - api.v_contract_signing_party    → one row per party (LESSOR / LESSEE /
//     GUARANTOR / WITNESS), with frozen identity + signed_at
//
// When `v_contract_signing_history` returns 403 (see UI_FEEDBACK/
// 2026-06-11_ALERT_signing_history_view_403.md), the tab falls back to
// rendering party-only groups so the surface still loads.
//
// Sign / void / create actions are NOT exposed in this iteration. The Sign
// and Void modals exist (SigningVoidModal, SigningSignModal) and were
// verified end-to-end manually; entry points are hidden until the action
// surface (BE-driven action list, permission gating, manual create) is
// settled.

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Badge, Tooltip } from 'tsp-form';
import {
  AlertTriangle, CheckCircle2, Circle, Clock, FileSignature, XCircle,
} from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { DateTime } from '../../components/DateTime';

type SigningStatus = 'COLLECTING' | 'SEALED' | 'SUPERSEDED' | 'VOIDED';
type SigningCategory = 'CONTRACT' | 'AMENDMENT' | 'RECEIPT' | null;
type PartyRole = 'LESSOR' | 'LESSEE' | 'GUARANTOR' | 'WITNESS';

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

function statusColor(s: SigningStatus): 'success' | 'warning' | 'default' | 'danger' {
  switch (s) {
    case 'COLLECTING': return 'warning';
    case 'SEALED':     return 'success';
    case 'SUPERSEDED': return 'default';
    case 'VOIDED':     return 'danger';
    default:           return 'default';
  }
}

function roleColor(r: PartyRole): 'primary' | 'info' | 'default' {
  switch (r) {
    case 'LESSOR':    return 'primary';
    case 'LESSEE':    return 'primary';
    case 'GUARANTOR': return 'info';
    case 'WITNESS':   return 'default';
    default:          return 'default';
  }
}

// Format a Postgres `interval` string like "01:23:45" or "1 day 02:00:00" into
// a compact "Xh Ym" hint. Returns null when the input is null or unparseable.
function formatTtl(raw: string | null): string | null {
  if (!raw) return null;
  // Strip leading "N day(s) " if present
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

export function SigningTab({ contractId }: { contractId: number }) {
  const { t } = useTranslation();

  // Read history first. Treat 403 as "view unavailable" so the tab still
  // renders party groups for read-only inspection.
  const historyQuery = useQuery({
    queryKey: ['contract-signings', contractId],
    queryFn: async () => {
      try {
        return await apiClient.get<SigningHistoryRow[]>(
          `/v_contract_signing_history?contract_id=eq.${contractId}&order=created_at.desc`,
        );
      } catch (err) {
        if (err instanceof ApiError && err.httpStatus === 403) return null;
        throw err;
      }
    },
    staleTime: 30_000,
  });

  const partyQuery = useQuery({
    queryKey: ['contract-signing-parties', contractId],
    queryFn: () => apiClient.get<SigningPartyRow[]>(
      `/v_contract_signing_party?contract_id=eq.${contractId}&order=signing_id.desc,party_index.asc`,
    ),
    staleTime: 30_000,
  });

  // Group party rows by signing_id for fast lookup.
  const partiesBySigning = useMemo(() => {
    const map = new Map<number, SigningPartyRow[]>();
    for (const p of partyQuery.data ?? []) {
      const arr = map.get(p.signing_id);
      if (arr) arr.push(p);
      else map.set(p.signing_id, [p]);
    }
    return map;
  }, [partyQuery.data]);

  // When the history view 403s, synthesize stub rows from parties so each
  // signing still shows up.
  const signings: SigningHistoryRow[] = useMemo(() => {
    if (historyQuery.data && historyQuery.data.length > 0) return historyQuery.data;
    if (historyQuery.data === null) {
      // Fallback: derive minimal rows from parties.
      const ids = Array.from(partiesBySigning.keys()).sort((a, b) => b - a);
      return ids.map<SigningHistoryRow>(id => {
        const parties = partiesBySigning.get(id) ?? [];
        const signed = parties.filter(p => p.has_signed).length;
        return {
          signing_id: id,
          contract_id: contractId,
          version: null,
          type: '',
          category: null,
          required_witnesses: null,
          status: signed === parties.length && parties.length > 0 ? 'SEALED' : 'COLLECTING',
          is_current_full_contract: false,
          change_reason: null,
          change_reason_fk: null,
          change_note: null,
          is_forced: false,
          supersedes_id: null,
          superseded_by: null,
          created_at: parties[0]?.signed_at ?? new Date().toISOString(),
          sealed_at: null,
          voided_at: null,
          void_reason: null,
          expires_at: null,
          ttl_remaining: null,
          signed_count: signed,
          total_parties: parties.length,
          pdf_available: false,
        };
      });
    }
    return [];
  }, [historyQuery.data, partiesBySigning, contractId]);

  const collecting = signings.find(s => s.status === 'COLLECTING');
  const historyUnavailable = historyQuery.data === null;
  const isLoading = historyQuery.isLoading || partyQuery.isLoading;
  const error = historyQuery.error ?? partyQuery.error;

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
  if (signings.length === 0) {
    return (
      <div className="p-8 text-center text-subtler flex flex-col items-center gap-2">
        <FileSignature size={28} className="text-subtle" />
        <div>{t('signing.empty')}</div>
      </div>
    );
  }

  return (
    <div className="p-4 flex flex-col gap-4">
      {historyUnavailable && (
        <div className="alert alert-warning">
          <AlertTriangle size={16} />
          <div className="alert-description text-xs">
            {t('signing.historyViewUnavailable')}
          </div>
        </div>
      )}

      {/* Pending-action callout — top of tab */}
      {collecting && !historyUnavailable && (
        <PendingCallout signing={collecting} />
      )}

      {signings.map(s => (
        <SigningCard
          key={s.signing_id}
          signing={s}
          parties={partiesBySigning.get(s.signing_id) ?? []}
        />
      ))}
    </div>
  );
}

function PendingCallout({ signing }: { signing: SigningHistoryRow }) {
  const { t } = useTranslation();
  const ttl = formatTtl(signing.ttl_remaining);
  const remaining = signing.total_parties - signing.signed_count;
  return (
    <div className="border border-warning/40 bg-warning/5 rounded-md px-4 py-3 flex items-start gap-3">
      <Clock size={18} className="text-warning-fg shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-warning-fg">
          {t('signing.pendingCallout', { count: remaining })}
        </div>
        <div className="text-xs text-subtle mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
          {signing.change_reason && (
            <span>
              {t(`signing.reason_${signing.change_reason}`, { defaultValue: signing.change_reason })}
            </span>
          )}
          {ttl && (
            <span>
              · {t('signing.ttlLabel')}: <span className="tabular-nums">{ttl}</span>
            </span>
          )}
          {signing.expires_at && (
            <span>
              · {t('signing.expiresAt')}: <DateTime value={signing.expires_at} />
            </span>
          )}
        </div>
        <div className="text-[11px] text-subtler mt-1">
          {t('signing.createdAt')} <DateTime value={signing.created_at} />
        </div>
      </div>
    </div>
  );
}

function SigningCard({ signing, parties }: {
  signing: SigningHistoryRow;
  parties: SigningPartyRow[];
}) {
  const { t } = useTranslation();
  const ttl = formatTtl(signing.ttl_remaining);

  return (
    <div className="border border-line rounded-md overflow-hidden">
      {/* Header row */}
      <div className="px-4 py-3 border-b border-line bg-surface/40 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge size="sm" color={statusColor(signing.status)}>
              {t(`signing.status_${signing.status}`, { defaultValue: signing.status })}
            </Badge>
            {signing.change_reason && (
              <span className="text-sm font-medium">
                {t(`signing.reason_${signing.change_reason}`, { defaultValue: signing.change_reason })}
              </span>
            )}
            {signing.is_current_full_contract && (
              <Badge size="xs" color="success">{t('signing.currentContract')}</Badge>
            )}
            {signing.is_forced && (
              <Badge size="xs" color="warning">{t('signing.forced')}</Badge>
            )}
            {signing.version != null && (
              <span className="text-xs text-subtle">v{signing.version}</span>
            )}
          </div>
          <div className="text-xs text-subtle mt-1 flex flex-col gap-0.5">
            <div className="flex flex-wrap gap-x-3">
              {signing.category && (
                <span>{t(`signing.category_${signing.category}`, { defaultValue: signing.category })}</span>
              )}
              <span>{t('signing.createdAt')} <DateTime value={signing.created_at} /></span>
              {ttl && signing.status === 'COLLECTING' && (
                <span className="text-warning-fg">{t('signing.ttlLabel')}: <span className="tabular-nums">{ttl}</span></span>
              )}
            </div>
            {signing.sealed_at && (
              <div>{t('signing.sealedAt')} <DateTime value={signing.sealed_at} /></div>
            )}
            {signing.voided_at && (
              <div>{t('signing.voidedAt')} <DateTime value={signing.voided_at} /></div>
            )}
          </div>
          {signing.void_reason && (
            <div className="text-xs text-danger mt-1">
              {t('signing.voidReason')}: {signing.void_reason}
            </div>
          )}
          {signing.change_note && (
            <div className="text-xs text-subtle mt-1 italic">"{signing.change_note}"</div>
          )}
        </div>
        <div className="shrink-0 text-right">
          <div className="text-sm font-semibold tabular-nums">
            {signing.signed_count} / {signing.total_parties}
          </div>
          <div className="text-[11px] text-subtle">{t('signing.signedCount')}</div>
        </div>
      </div>

      {/* Party list */}
      {parties.length === 0 ? (
        <div className="px-4 py-3 text-xs text-subtler">{t('signing.noParties')}</div>
      ) : (
        <ul className="divide-y divide-line">
          {parties.map(p => (
            <li key={p.id} className="px-4 py-2.5 flex items-center gap-3">
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
                  {p.frozen_id_number && <span>{p.frozen_id_number}</span>}
                  {p.frozen_phone && <span>{p.frozen_phone}</span>}
                </div>
              </div>
              <div className="shrink-0 text-right text-[11px] text-subtle tabular-nums">
                {p.signed_at ? (
                  <Tooltip content={<DateTime value={p.signed_at} />}>
                    <span><DateTime value={p.signed_at} showTime={false} /></span>
                  </Tooltip>
                ) : (
                  <span className="text-warning-fg">{t('signing.partyPending')}</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
