import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Button } from 'tsp-form';
import { AlertTriangle, Ban, Info, XCircle } from 'lucide-react';
import { apiClient } from '../../../lib/api';
import { useAuth } from '../../../contexts/AuthContext';
import { LiftBlacklistModal } from '../../customers/BlacklistModals';
import type { ModalId } from './WorkspaceTypes';
import { ERROR_TO_MODAL } from './WorkspaceTypes';

// ============================================================================
// The one place a "contract is not ready to open" answer is rendered.
//
// Two backend paths produce the SAME list and both land here:
//   fn_contract_validate_ready → data.errors[] / data.warnings[]   (ok:true even when not ready)
//   fn_bill_contract_open      → error.params.errors[] under SALE.VALIDATION.CONTRACT_NOT_READY
// The second is the last line of defence — someone can blacklist a customer
// between the check and the button — so it must show the same checklist rather
// than the envelope's English "Contract is not ready".
//
// Every line is translated from its `code`; the backend's `message` /
// `default_message` are developer English and some are out of date, so they are
// never shown. An unknown code falls back to a Thai sentence plus the code in
// small grey text, so staff can screenshot it.
// Spec: nnf UI_FEEDBACK/2026-09-26_IMPLEMENT_contract_open_error_messages_thai.md
// ============================================================================

export const BLACKLIST_CODE = 'CONTRACT.VALIDATION.CUSTOMER_BLACKLISTED';

/** One hit inside the blacklist error's detail — one per blacklisted party. */
interface BlacklistHit {
  blacklist_id: number;
  customer_id: number;
  role: string;
  blacklist_type: string;
  reason_code: string | null;
  reason: string | null;
  created_at: string;
}

export interface ReadinessItem {
  code: string;
  detail?: unknown;
  /** Present on the two PARTNER_* rows, at row level rather than inside detail. */
  field?: string;
  fix_rpc?: string | null;
}

interface ReasonOption {
  kind: 'ADD' | 'LIFT';
  code: string;
  name_th: string;
  name_en: string;
}

interface ContractParty {
  customer_id: number;
  customer_name: string;
  role: string;
}

function hitsOf(item: ReadinessItem): BlacklistHit[] {
  const detail = item.detail as { hits?: unknown } | undefined;
  return Array.isArray(detail?.hits) ? (detail.hits as BlacklistHit[]) : [];
}

/** `detail` is an object of interpolation facts for most codes; pass them to i18next. */
function detailParams(item: ReadinessItem): Record<string, unknown> {
  const d = item.detail;
  return d && typeof d === 'object' && !Array.isArray(d) ? (d as Record<string, unknown>) : {};
}

/**
 * Translate one readiness code. Returns '' when the catalog has no entry or the
 * entry still carries an unresolved placeholder — the caller then shows the
 * unknown-code fallback rather than a half-built sentence.
 */
function useCodeText() {
  const { t } = useTranslation();
  return (item: ReadinessItem): string => {
    const value = t(item.code, { ns: 'apiErrors', defaultValue: '', ...detailParams(item) });
    if (typeof value !== 'string' || value === '') return '';
    return value.includes('{{') ? '' : value;
  };
}

/** A line whose code the catalog doesn't know — Thai sentence + the raw code, small and grey. */
function UnknownCodeLine({ code }: { code: string }) {
  const { t } = useTranslation();
  return (
    <span className="flex flex-col items-start">
      <span>{t('readiness.unknownCode')}</span>
      <span className="text-xs text-subtler">{code}</span>
    </span>
  );
}

/**
 * The blacklist box — its own card above the plain checklist, because it is the
 * one blocker branch staff cannot clear themselves. Says who is blocked, why,
 * and what happens next, once per hit (both lessee and co-lessee can be hit).
 */
function BlacklistBlock({
  item,
  contractId,
  onLifted,
}: {
  item: ReadinessItem;
  contractId: number | null;
  onLifted: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { can } = useAuth();
  const hits = hitsOf(item);
  const [liftEntry, setLiftEntry] = useState<{ blacklistId: number; customerName: string } | null>(null);

  // Names are not in the error — they come from the contract's own party list.
  const { data: parties = [] } = useQuery({
    queryKey: ['contract-customers', contractId],
    queryFn: () => apiClient.get<ContractParty[]>(
      `/v_contract_customers?contract_id=eq.${contractId}&order=created_at`,
    ),
    enabled: !!contractId && hits.length > 0,
  });

  // Reason codes are only set on the manually-added rows; the nightly automatic
  // ones carry a free-text Thai reason instead.
  const { data: reasons = [] } = useQuery({
    queryKey: ['blacklist-reasons'],
    queryFn: () => apiClient.get<ReasonOption[]>('/v_ref_blacklist_reasons?order=kind,sort_order'),
    staleTime: 60 * 60 * 1000,
  });

  const nameOf = (customerId: number) =>
    parties.find((p) => p.customer_id === customerId)?.customer_name ?? '';

  const reasonLabel = (code: string) => {
    const row = reasons.find((r) => r.kind === 'ADD' && r.code === code);
    if (!row) return code;
    return i18n.language === 'th' ? row.name_th : row.name_en;
  };

  if (hits.length === 0) return null;

  const canLift = can('BLACKLIST.LIFT');

  return (
    <>
      <div className="rounded-lg border border-danger-border bg-danger-soft px-3 py-2.5 flex flex-col gap-2.5">
        {hits.map((hit, i) => {
          const name = nameOf(hit.customer_id);
          const roleLabel = t(`readiness.blacklistRole.${hit.role}`, { defaultValue: hit.role });
          const isAuto = hit.blacklist_type === 'AUTO';
          return (
            <div key={hit.blacklist_id ?? i} className="flex items-start gap-2">
              <Ban size={16} className="shrink-0 mt-0.5 text-danger-fg" />
              <div className="flex flex-col gap-1 min-w-0 flex-1">
                <span className="text-sm font-medium text-danger-fg">
                  {name
                    ? t('readiness.blacklistHeadline', { role: roleLabel, name })
                    : t('readiness.blacklistHeadlineNoName', { role: roleLabel })}
                </span>

                {/* Why. A manual row names a catalog reason and keeps the typed
                    note as a second line; an automatic row has only the note,
                    which is already Thai — never render this blank. */}
                {hit.reason_code ? (
                  <span className="text-sm text-fg">
                    {t('readiness.blacklistReason', { reason: reasonLabel(hit.reason_code) })}
                    {hit.reason ? <span className="block text-xs text-subtle">{hit.reason}</span> : null}
                  </span>
                ) : hit.reason ? (
                  <span className="text-sm text-fg">
                    {t('readiness.blacklistReason', { reason: hit.reason })}
                  </span>
                ) : null}

                {isAuto && (
                  <span className="text-xs text-subtle">{t('readiness.blacklistAutoTag')}</span>
                )}

                {/* What happens next — differs by permission. */}
                {canLift ? (
                  <div className="flex items-center gap-2 mt-0.5">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setLiftEntry({ blacklistId: hit.blacklist_id, customerName: name })}
                    >
                      {t('readiness.blacklistLift')}
                    </Button>
                  </div>
                ) : (
                  <span className="text-sm text-fg">{t('readiness.blacklistAskAdmin')}</span>
                )}

                {/* The trap worth naming out loud: an automatic entry is
                    recomputed nightly, so lifting it while the debt still
                    stands puts it straight back. */}
                {isAuto && (
                  <span className="flex items-start gap-1.5 text-xs text-subtle mt-0.5">
                    <Info size={13} className="shrink-0 mt-0.5" />
                    <span>{t('readiness.blacklistAutoNote')}</span>
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <LiftBlacklistModal
        open={!!liftEntry}
        onClose={() => { setLiftEntry(null); onLifted(); }}
        entry={liftEntry}
      />
    </>
  );
}

export interface ReadinessChecklistProps {
  errors: ReadinessItem[];
  warnings?: ReadinessItem[];
  contractId: number | null;
  /** Opens the modal that can fix a line, when one exists. */
  onOpenModal?: (modal: ModalId) => void;
  /** Re-run the readiness check (after a lift, the answer changes). */
  onRecheck?: () => void;
  /** Heading above the list. Omitted inside the card that already has one. */
  showHeadline?: boolean;
}

export function ReadinessChecklist({
  errors,
  warnings = [],
  contractId,
  onOpenModal,
  onRecheck,
  showHeadline = false,
}: ReadinessChecklistProps) {
  const { t } = useTranslation();
  const codeText = useCodeText();

  // The blacklist rows are pulled out and rendered above the plain list.
  const blacklistItems = useMemo(() => errors.filter((e) => e.code === BLACKLIST_CODE), [errors]);
  const plainErrors = useMemo(() => errors.filter((e) => e.code !== BLACKLIST_CODE), [errors]);

  if (errors.length === 0 && warnings.length === 0) return null;

  const renderLine = (item: ReadinessItem, tone: 'error' | 'warning') => {
    const targetModal = onOpenModal ? ERROR_TO_MODAL[item.code] : undefined;
    const text = codeText(item);
    const Icon = tone === 'error' ? XCircle : AlertTriangle;
    const toneClass = tone === 'error' ? 'text-danger' : 'text-warning-fg';
    return (
      <button
        key={item.code}
        type="button"
        className={`flex items-start gap-2 text-sm text-left w-full ${toneClass} ${
          targetModal ? 'hover:underline cursor-pointer' : 'cursor-default'
        }`}
        onClick={targetModal ? () => onOpenModal?.(targetModal) : undefined}
        disabled={!targetModal}
      >
        <Icon size={14} className="shrink-0 mt-0.5" />
        {text ? <span>{text}</span> : <UnknownCodeLine code={item.code} />}
      </button>
    );
  };

  return (
    <div className="flex flex-col gap-2.5">
      {showHeadline && errors.length > 0 && (
        <div className="text-sm font-medium text-danger-fg">
          {t('readiness.notReadyHeadline', { count: errors.length })}
        </div>
      )}

      {blacklistItems.map((item, i) => (
        <BlacklistBlock
          key={i}
          item={item}
          contractId={contractId}
          onLifted={() => onRecheck?.()}
        />
      ))}

      {plainErrors.length > 0 && (
        <div className="flex flex-col gap-1.5">{plainErrors.map((e) => renderLine(e, 'error'))}</div>
      )}

      {warnings.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {warnings.map((w) => renderLine(w, 'warning'))}
        </div>
      )}
    </div>
  );
}
