// แก้เบอร์โทรที่ตรึงในสัญญา — phone diff + sync
// (UI_FEEDBACK/2026-08-07_IMPLEMENT_contract_phone_sync.md, mig 1034)
//
// A wrongly-keyed phone gets FROZEN into the sealed signing snapshot. Branch
// staff can already fix the CUSTOMER MASTER, but the copy frozen in the contract
// stays wrong and keeps printing on the PDF forever.
//
// The mandated flow is:
//   1. fix the phone on the CUSTOMER screen first (master = the truth)
//   2. open this panel → see the diff: master phone vs frozen phone
//   3. sync per-party with a reason → the RPC copies master → frozen snapshot
//
// fn_contract_phone_sync takes NO phone parameter — it only ever copies from
// core.customers.tel. So this panel must NEVER offer a phone input; if the
// master is still wrong the user is sent to the customer profile instead.
//
// Safe for signatures: the phone is frozen-but-NOT-hashed, and the RPC runs its
// own hash gate on every call.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Badge, Button, Modal, TextArea } from 'tsp-form';
import {
  AlertTriangle, ArrowRight, CheckCircle, ChevronDown, ChevronRight,
  Loader2, Phone, RefreshCw, UserCog,
} from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import { useAuth } from '../../contexts/AuthContext';
import { formatTel } from '../../lib/format';
import { DateTime } from '../../components/DateTime';
import { ModalErrorBand } from '../../components/ModalErrorBand';
import { ActionDoneView } from './ActionDoneView';

// ── Types (shape from fn_contract_phone_diff / _sync) ────────────────────────

interface FrozenPhone {
  party_row_id: number;
  signing_id: number;
  signing_type: string;
  payload_kind: string;
  sealed_at: string | null;
  frozen_phone: string | null;
  matches_live: boolean;
}

export interface PhoneDiffParty {
  customer_id: number;
  party_role: string;          // LESSEE | CO_LESSEE
  full_name: string | null;
  live_tel: string | null;     // master phone — the truth
  live_tel2: string | null;    // secondary phone — context only (see §5 of the doc)
  snapshot_tel: string | null; // phone frozen in the sealed FULL snapshot
  full_signing_id: number | null;
  frozen_phones: FrozenPhone[];
  is_different: boolean;
}

interface PhoneDiffResult {
  contract_id: number;
  contract_code: string;
  has_differences: boolean;
  parties: PhoneDiffParty[];
}

interface PhoneSyncApplied {
  customer_id: number;
  old_tels: string[];
  new_tel: string;
  signings_patched: number[];
  party_rows_patched: number[];
  hash_ok: boolean;
  reason: string;
}

interface PhoneSyncResult extends PhoneDiffResult {
  applied: PhoneSyncApplied;
}

// CONTRACT.PHONE_SYNC is granted to BRANCH_MANAGER and up (mig 1034). Everyone
// who can open the contract sees the diff; only these roles get the sync button.
const SYNC_ROLES = ['BRANCH_MANAGER', 'COMPANY_ADMIN', 'HOLDING_ADMIN', 'SYSTEM_DEV'];

export function useContractPhoneDiff(contractId: number) {
  return useQuery({
    queryKey: ['contract-phone-diff', contractId],
    queryFn: () => apiClient.rpc<PhoneDiffResult>('fn_contract_phone_diff', { p_contract_id: contractId }),
  });
}

// ── Panel ────────────────────────────────────────────────────────────────────

export function ContractPhoneSyncPanel({ contractId, contractCode }: {
  contractId: number;
  contractCode: string;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { data, isLoading } = useContractPhoneDiff(contractId);
  const [syncTarget, setSyncTarget] = useState<PhoneDiffParty | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);

  const canSync = SYNC_ROLES.includes(user?.role_code ?? '');
  const parties = data?.parties ?? [];

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-subtler px-4 py-3 border border-line rounded-md">
        <Loader2 size={14} className="animate-spin" />
        {t('common.loading')}
      </div>
    );
  }

  // Nothing sealed yet (DRAFT / PENDING) — no frozen copies exist to sync.
  const nothingFrozen = parties.every(p => p.snapshot_tel === null && p.frozen_phones.length === 0);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-wider text-subtle">
          {t('contract.phoneSyncTitle')}
        </div>
        {data?.has_differences && (
          <Badge color="warning" size="sm">{t('contract.phoneSyncOutOfSync')}</Badge>
        )}
      </div>

      {nothingFrozen ? (
        <div className="text-xs text-subtler border border-dashed border-line rounded-md px-4 py-3">
          {t('contract.phoneSyncNothingFrozen')}
        </div>
      ) : (
        <>
          <p className="text-xs text-subtle">{t('contract.phoneSyncHint')}</p>
          <div className="flex flex-col gap-2">
            {parties.map(p => (
              <PhoneDiffRow
                key={p.customer_id}
                party={p}
                canSync={canSync}
                expanded={expanded === p.customer_id}
                onToggleExpand={() => setExpanded(expanded === p.customer_id ? null : p.customer_id)}
                onSync={() => setSyncTarget(p)}
                t={t}
              />
            ))}
          </div>
        </>
      )}

      <PhoneSyncModal
        open={syncTarget !== null}
        party={syncTarget}
        contractId={contractId}
        contractCode={contractCode}
        onClose={() => setSyncTarget(null)}
      />
    </div>
  );
}

// ── One party row ────────────────────────────────────────────────────────────

function PhoneDiffRow({ party, canSync, expanded, onToggleExpand, onSync, t }: {
  party: PhoneDiffParty;
  canSync: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  onSync: () => void;
  t: ReturnType<typeof useTranslation>['t'];
}) {
  // The trap from §5 of the doc: staff "fixed" the number but typed it into the
  // SECONDARY phone. Sync copies the PRIMARY, so it would carry the wrong number
  // across. Detect it and tell them to fix the master first.
  const wrongFieldSuspected =
    party.is_different &&
    party.snapshot_tel !== null &&
    party.live_tel2 !== null &&
    party.snapshot_tel !== party.live_tel &&
    party.snapshot_tel === party.live_tel2;

  return (
    <div className="border border-line rounded-md px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Link
              to={`/admin/customers/${party.customer_id}`}
              className="font-medium text-sm text-primary-fg hover:underline"
            >
              {party.full_name ?? '—'}
            </Link>
            <Badge size="xs" color={party.party_role === 'LESSEE' ? 'info' : 'default'}>
              {t(`lesseeRole.${party.party_role}`, { defaultValue: party.party_role })}
            </Badge>
          </div>

          {/* master → frozen */}
          <div className="flex items-center gap-2 mt-2 flex-wrap text-sm">
            <span className="inline-flex items-center gap-1.5">
              <Phone size={12} className="text-subtle" />
              <span className="text-xs text-subtle">{t('contract.phoneSyncMaster')}</span>
              <span className="font-medium tabular-nums">{formatTel(party.live_tel)}</span>
            </span>
            <ArrowRight size={14} className="text-subtler" />
            <span className="inline-flex items-center gap-1.5">
              <span className="text-xs text-subtle">{t('contract.phoneSyncFrozen')}</span>
              <span className={`font-medium tabular-nums ${party.is_different ? 'text-danger-fg' : ''}`}>
                {formatTel(party.snapshot_tel)}
              </span>
            </span>
            {!party.is_different && <CheckCircle size={14} className="text-success" />}
          </div>

          {party.live_tel2 && (
            <div className="text-xs text-subtle mt-1">
              {t('contract.phoneSyncSecondary')}: <span className="tabular-nums">{formatTel(party.live_tel2)}</span>
            </div>
          )}

          {party.frozen_phones.length > 0 && (
            <button
              type="button"
              onClick={onToggleExpand}
              className="mt-2 inline-flex items-center gap-1 text-xs text-subtle hover:text-fg bg-transparent border-none p-0 cursor-pointer"
            >
              {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              {t('contract.phoneSyncFrozenCopies', { count: party.frozen_phones.length })}
            </button>
          )}
        </div>

        {party.is_different && canSync && (
          <Button
            size="sm"
            variant="outline"
            startIcon={<RefreshCw size={14} />}
            onClick={onSync}
            className="shrink-0"
          >
            {t('contract.phoneSyncAction')}
          </Button>
        )}
      </div>

      {wrongFieldSuspected && (
        <div className="alert alert-warning mt-3">
          <AlertTriangle size={16} className="shrink-0" />
          <div className="alert-description text-sm">
            {t('contract.phoneSyncWrongFieldWarning')}
            <Link
              to={`/admin/customers/${party.customer_id}`}
              className="ml-1 text-primary-fg hover:underline inline-flex items-center gap-1"
            >
              <UserCog size={12} />
              {t('contract.phoneSyncFixInProfile')}
            </Link>
          </div>
        </div>
      )}

      {expanded && party.frozen_phones.length > 0 && (
        <div className="mt-3 rounded-md border border-line overflow-hidden">
          {party.frozen_phones.map(f => (
            <div
              key={f.party_row_id}
              className="flex items-center justify-between gap-3 px-3 py-2 border-b border-line last:border-b-0 text-xs"
            >
              <div className="min-w-0">
                <div className="font-medium">
                  {f.signing_type === 'FULL_CONTRACT'
                    ? t('signing.category_CONTRACT')
                    : t('signing.category_AMENDMENT')}
                  <span className="text-subtler ml-1.5">#{f.signing_id}</span>
                </div>
                <div className="text-subtler mt-0.5"><DateTime value={f.sealed_at} showTime /></div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className={`tabular-nums ${f.matches_live ? '' : 'text-danger-fg'}`}>
                  {formatTel(f.frozen_phone)}
                </span>
                {f.matches_live
                  ? <CheckCircle size={14} className="text-success" />
                  : <AlertTriangle size={14} className="text-warning-fg" />}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Sync confirm modal ───────────────────────────────────────────────────────

function PhoneSyncModal({ open, party, contractId, contractCode, onClose }: {
  open: boolean;
  party: PhoneDiffParty | null;
  contractId: number;
  contractCode: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [view, setView] = useState<'form' | 'done'>('form');
  const [result, setResult] = useState<PhoneSyncResult | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  useEffect(() => {
    if (!open) return;
    setReason('');
    setSubmitting(false);
    setError('');
    setView('form');
    setResult(null);
    setConfirmClose(false);
  }, [open, party?.customer_id]);

  // The parent clears its selection on close, so hold the last party through the
  // exit transition — otherwise the body blanks while the panel animates out.
  const [lastParty, setLastParty] = useState<PhoneDiffParty | null>(null);
  useEffect(() => { if (party) setLastParty(party); }, [party]);
  const shown = party ?? lastParty;

  const handleSubmit = async () => {
    if (!shown) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await apiClient.rpc<PhoneSyncResult>('fn_contract_phone_sync', {
        p_contract_id: contractId,
        p_customer_id: shown.customer_id,
        p_reason: reason.trim(),
      });
      setResult(res);
      setView('done');
      queryClient.invalidateQueries({ queryKey: ['contract-phone-diff', contractId] });
      // The sealed snapshot changed — the signing tab renders it, and the PDF
      // re-renders on demand from the same snapshot.
      queryClient.invalidateQueries({ queryKey: ['contract-signings', contractId] });
      queryClient.invalidateQueries({ queryKey: ['contract-signing-parties', contractId] });
    } catch (err) {
      setError(err instanceof ApiError ? translateApiError(err, t) : (err instanceof Error ? err.message : String(err)));
      setSubmitting(false);
    }
  };

  const isDirty = reason.trim() !== '';
  const forceClose = () => { setConfirmClose(false); onClose(); };
  const handleClose = () => {
    if (view === 'done') { forceClose(); return; }
    if (isDirty) { setConfirmClose(true); return; }
    forceClose();
  };

  const canSubmit = reason.trim() !== '' && !submitting;

  return (
    <>
      <Modal open={open} onClose={handleClose} maxWidth="32rem" width="100%">
        <div className="flex flex-col overflow-hidden">
          <div className="modal-header">
            <h2 className="modal-title">{t('contract.phoneSyncModalTitle')}</h2>
            <button type="button" className="modal-close-btn" onClick={handleClose} aria-label="Close">&times;</button>
          </div>

          {view === 'done' && result ? (
            <ActionDoneView
              headline={t('contract.phoneSyncDoneHeadline')}
              contractCode={contractCode}
              detailRows={[
                { label: t('contract.phoneSyncParty'), value: shown?.full_name ?? '—' },
                { label: t('contract.phoneSyncOldPhone'), value: result.applied.old_tels.map(formatTel).join(', ') || '—' },
                { label: t('contract.phoneSyncNewPhone'), value: formatTel(result.applied.new_tel), emphasis: true },
                // party_rows, not signings_patched — a snapshot rewrite touches one
                // signing but several frozen party rows, and the row count is what
                // the panel's expanded "frozen copies" list shows.
                { label: t('contract.phoneSyncSigningsPatched'), value: result.applied.party_rows_patched.length },
              ]}
              extras={
                <div className="alert alert-info">
                  <AlertTriangle size={16} className="shrink-0" />
                  <div className="alert-description text-sm">{t('contract.phoneSyncPaperNote')}</div>
                </div>
              }
              onClose={forceClose}
            />
          ) : (
            <>
              <div className="modal-content">
                <div className="px-3 py-2.5 rounded-md bg-surface border border-line">
                  <div className="font-medium text-sm">{contractCode}</div>
                  <div className="text-xs text-subtle">{shown?.full_name ?? '—'}</div>
                </div>

                {/* old → new, shown large so the user checks before committing */}
                <div className="mt-4 flex items-center justify-center gap-3 flex-wrap">
                  <div className="text-center">
                    <div className="text-xs text-subtle mb-0.5">{t('contract.phoneSyncFrozen')}</div>
                    <div className="text-base font-medium tabular-nums text-danger-fg">
                      {formatTel(shown?.snapshot_tel)}
                    </div>
                  </div>
                  <ArrowRight size={18} className="text-subtle" />
                  <div className="text-center">
                    <div className="text-xs text-subtle mb-0.5">{t('contract.phoneSyncMaster')}</div>
                    <div className="text-base font-medium tabular-nums text-success">
                      {formatTel(shown?.live_tel)}
                    </div>
                  </div>
                </div>

                <p className="text-xs text-subtle mt-4">{t('contract.phoneSyncModalHint')}</p>

                <div className="form-grid gap-3 mt-4">
                  <div className="flex flex-col">
                    <label className="form-label">{t('contract.phoneSyncReason')} *</label>
                    <TextArea
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      rows={2}
                      placeholder={t('contract.phoneSyncReasonPlaceholder')}
                      className="w-full"
                    />
                  </div>
                </div>
              </div>

              <ModalErrorBand message={error} onDismiss={() => setError('')} />

              <div className="modal-footer">
                <Button onClick={handleClose}>{t('common.cancel')}</Button>
                <Button
                  color="primary"
                  onClick={handleSubmit}
                  disabled={!canSubmit}
                  startIcon={submitting ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                >
                  {submitting ? t('common.saving') : t('contract.phoneSyncConfirm')}
                </Button>
              </div>
            </>
          )}
        </div>
      </Modal>

      <Modal open={confirmClose} onClose={() => setConfirmClose(false)} maxWidth="24rem" width="100%">
        <div className="modal-header"><h2 className="modal-title">{t('common.unsavedChanges')}</h2></div>
        <div className="modal-content"><p className="text-sm">{t('common.unsavedChangesMessage')}</p></div>
        <div className="modal-footer">
          <Button variant="ghost" onClick={() => setConfirmClose(false)}>{t('common.cancel')}</Button>
          <Button color="danger" onClick={forceClose}>{t('common.discard')}</Button>
        </div>
      </Modal>
    </>
  );
}
