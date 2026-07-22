import { useState, useEffect, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Badge, Button, Modal, Select } from 'tsp-form';
import { XCircle, User, Phone, Smartphone, Wrench, Loader2, FileSignature, Eye, BatteryMedium, Package } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { DateTime } from '../../components/DateTime';
import { formatTel } from '../../lib/format';
import { ActionDoneView } from './ActionDoneView';
import { useContractInvalidate } from './useContractInvalidate';
import { codeDisplay, assetCodeMatches } from '../inventory/inventoryUtils';

// Two-line loaner option: asset code (bold) over the product name, with a color
// swatch. `label` stays a single line for the collapsed display; renderOption
// draws the richer two-line row in the dropdown.
function renderLoanerOption(opt: { label: string; primary?: string; secondary?: string; colorHex?: string | null }) {
  const primary = opt.primary ?? opt.label;
  return (
    <div className="flex items-center gap-2 min-w-0 py-0.5">
      {opt.colorHex && (
        <span
          className="w-3 h-3 rounded-full shrink-0 border border-line"
          style={{ backgroundColor: opt.colorHex }}
        />
      )}
      <div className="flex flex-col min-w-0 leading-tight">
        <span className="truncate tabular-nums">{primary}</span>
        {opt.secondary && <span className="text-xs text-subtle truncate">{opt.secondary}</span>}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Loaner (ยืมเครื่องทดแทน) — assign + return, both via the 4-signature ceremony.
//
// DP-13 mental model: pressing the button only ISSUES a signing sheet. The
// loaner device moves buckets (and contract.loaner_device_id is set/cleared)
// when the signing SEALs — customer + lessor + 2 witnesses. So both flows end
// the same way the deposit flow does: check → confirm → issue signing → done
// view that sends staff to the Signing tab. No PIN here (signatures are the
// control). Mirrors DepositModals.tsx.
// ─────────────────────────────────────────────────────────────────────────────

// ── Shared shapes (fn_contract_check_loan_assign / _return) ───────────────────

interface LoanerDevice {
  asset_id: number;
  asset_code: string;
  serial_no: string | null;
  imei: string | null;
  current_bucket: string;
  product_display_name: string | null;
}
interface CheckContract { contract_id: number; code_display: string; state: string }
interface CheckCustomer { customer_id: number; full_name: string; tel: string | null }

interface AssignCheckResult {
  allowed: boolean;
  reason?: string;
  contract: CheckContract;
  customer: CheckCustomer;
  primary_device: LoanerDevice | null;
  loaner_device: LoanerDevice | null;   // null until a loaner is scanned
}

interface ReturnCheckResult {
  allowed: boolean;
  reason?: string;
  loaner_device_id?: number;
  contract: CheckContract;
  customer: CheckCustomer;
  loaner_device: LoanerDevice | null;
}

// loan_assign / loan_return both return the signing sheet, NOT a completed
// move (assigned/returned stays false until the signing SEALs).
interface LoanSigningResult {
  contract_id: number;
  loaner_asset_id: number;
  signing_id: number;
  signing_status: string;
  assigned?: boolean;
  returned?: boolean;
  next_action: string;
}

interface LoanerAssetOption {
  asset_id: number;
  asset_code: string;
  asset_code_display: string | null;
  model_name: string;
  variant_name: string;
  product_display_name: string | null;
  master_color_hex: string | null;
  master_color_name_en: string | null;
}

// Full asset detail for the "ดูเครื่องยืม" viewer (owner-requested pre-return
// condition check — v_assets filtered by asset_id).
interface LoanerAssetDetail {
  asset_id: number;
  asset_code: string;
  asset_code_display: string | null;
  product_display_name: string | null;
  serial_no: string | null;
  imei: string | null;
  current_bucket: string;
  condition_grade: string | null;
  battery_health: number | null;
  has_box: boolean | null;
  warranty_expired_date: string | null;
  branch_name: string | null;
}

function apiErr(err: unknown, t: ReturnType<typeof useTranslation>['t']): string {
  if (err instanceof ApiError) {
    return (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
      || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '')
      || err.message;
  }
  return err instanceof Error ? err.message : String(err);
}

// Read-only customer + device summary line.
function PartyLine({ customer }: { customer: CheckCustomer }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <User size={14} className="text-subtle shrink-0" />
      <span className="font-medium truncate">{customer.full_name}</span>
      {customer.tel && (
        <span className="inline-flex items-center gap-1 text-xs text-subtle shrink-0 tabular-nums">
          <Phone size={11} />{formatTel(customer.tel)}
        </span>
      )}
    </div>
  );
}

function DeviceLine({ label, device, icon, colorHex }: {
  label: string; device: LoanerDevice; icon?: React.ReactNode; colorHex?: string | null;
}) {
  const identifier = device.serial_no ?? device.imei;
  return (
    <div className="flex items-start gap-2 text-sm">
      {icon ?? <Smartphone size={14} className="text-subtle shrink-0 mt-0.5" />}
      <div className="min-w-0">
        <div className="text-xs text-subtle">{label}</div>
        <div className="truncate flex items-center gap-1.5">
          {colorHex && (
            <span
              className="w-3 h-3 rounded-full shrink-0 border border-line"
              style={{ backgroundColor: colorHex }}
            />
          )}
          <span className="truncate">{device.product_display_name ?? device.asset_code}</span>
        </div>
        <div className="text-xs text-subtle font-mono">
          {device.asset_code}{identifier ? ` · ${identifier}` : ''}
        </div>
      </div>
    </div>
  );
}

// ── "ดูเครื่องยืม" — asset detail viewer (condition check before assign/return) ─
function ViewLoanerModal({ open, onClose, assetId }: { open: boolean; onClose: () => void; assetId: number | null }) {
  const { t } = useTranslation();
  const { data: asset, isLoading } = useQuery({
    queryKey: ['loaner-asset-detail', assetId],
    queryFn: () => apiClient.get<LoanerAssetDetail[]>(
      `/v_assets?asset_id=eq.${assetId}&select=asset_id,asset_code,asset_code_display,product_display_name,serial_no,imei,current_bucket,condition_grade,battery_health,has_box,warranty_expired_date,branch_name&limit=1`,
    ).then(rows => rows[0] ?? null),
    enabled: open && assetId != null,
    staleTime: 30 * 1000,
  });

  const rows: { label: string; value: React.ReactNode }[] = asset ? [
    { label: t('loaner.view_model'), value: asset.product_display_name ?? '—' },
    { label: t('contract.assetCode'), value: codeDisplay(asset.asset_code_display, asset.asset_code) },
    { label: 'IMEI', value: asset.imei ?? '—' },
    { label: 'SN', value: asset.serial_no ?? '—' },
    { label: t('loaner.view_condition'), value: asset.condition_grade ?? '—' },
    { label: t('loaner.view_battery'), value: asset.battery_health != null ? `${asset.battery_health}%` : '—' },
    { label: t('loaner.view_box'), value: asset.has_box == null ? '—' : asset.has_box ? t('common.yes') : t('common.no') },
    { label: t('loaner.view_warranty'), value: asset.warranty_expired_date ? <DateTime value={asset.warranty_expired_date} showTime={false} /> : '—' },
    { label: t('contract.branch'), value: asset.branch_name ?? '—' },
  ] : [];

  return (
    <Modal open={open} onClose={onClose} maxWidth="28rem" width="100%">
      <div className="flex flex-col overflow-hidden">
        <div className="modal-header">
          <h2 className="modal-title">{t('loaner.view_title')}</h2>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label={t('common.close')}>&times;</button>
        </div>
        <div className="modal-content">
          {isLoading ? (
            <div className="py-8 text-center text-subtler text-sm">
              <Loader2 size={16} className="animate-spin inline mr-2" />{t('common.loading')}
            </div>
          ) : asset ? (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <Package size={16} className="text-subtle shrink-0" />
                <span className="font-medium text-sm">{asset.product_display_name ?? asset.asset_code}</span>
                <Badge size="xs" color="info">{asset.current_bucket}</Badge>
              </div>
              <div className="rounded-md border border-line divide-y divide-line">
                {rows.map((r, i) => (
                  <div key={i} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <span className="text-subtle">{r.label}</span>
                    <span className="font-medium text-right min-w-0 truncate">{r.value}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="py-8 text-center text-subtler text-sm">{t('common.noData')}</div>
          )}
        </div>
        <div className="modal-footer">
          <Button onClick={onClose}>{t('common.close')}</Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Assign loaner (มอบเครื่องยืมทดแทน) ─────────────────────────────────────────
//
// check (no loaner) → confirm primary is IN_REPAIR → scan/pick loaner from
// ON_HAND_AVAILABLE → re-check with loaner → fn_contract_loan_assign (issues
// signing) → done view → Signing tab. Device moves on SEAL (§0 DP-13).

export function LoanAssignModal({
  open, onClose, contract, branchId, onNavigateSigning,
}: {
  open: boolean;
  onClose: () => void;
  contract: { id: number };
  branchId: number;
  onNavigateSigning?: () => void;
}) {
  const { t } = useTranslation();
  const invalidate = useContractInvalidate(contract.id);

  const [view, setView] = useState<'form' | 'done'>('form');
  const [loanerAssetId, setLoanerAssetId] = useState<string | null>(null);
  const [assetSearch, setAssetSearch] = useState('');
  const [check, setCheck] = useState<AssignCheckResult | null>(null);
  const [viewAssetId, setViewAssetId] = useState<number | null>(null);
  const [error, setError] = useState('');

  // (Re)run the check. Pass the scanned loaner once chosen so the confirm screen
  // shows the exact device and the guard re-validates it (same guard as the RPC).
  const runCheck = useCallback(async (loanerId: number | null) => {
    setError('');
    try {
      const res = await apiClient.rpc<AssignCheckResult>('fn_contract_check_loan_assign', {
        p_contract_id: contract.id,
        p_loaner_asset_id: loanerId,
      });
      setCheck(res);
    } catch (err) {
      setError(apiErr(err, t));
    }
  }, [contract.id, t]);

  useEffect(() => {
    if (open) {
      setView('form');
      setLoanerAssetId(null);
      setAssetSearch('');
      setCheck(null);
      setViewAssetId(null);
      setError('');
      runCheck(null);
    }
  }, [open, runCheck]);

  // Loaner candidates: ON_HAND_AVAILABLE at this branch (owner may pick any
  // available stock device as the replacement).
  const { data: assets = [] } = useQuery({
    queryKey: ['loaner-assign-candidates', branchId],
    queryFn: () => {
      const params = new URLSearchParams({
        select: 'asset_id,asset_code,asset_code_display,model_name,variant_name,product_display_name,master_color_hex,master_color_name_en',
        current_bucket: 'eq.ON_HAND_AVAILABLE',
        branch_id: `eq.${branchId}`,
        order: 'asset_code',
        limit: '100',
      });
      return apiClient.get<LoanerAssetOption[]>(`/v_assets?${params.toString()}`);
    },
    staleTime: 60 * 1000,
    enabled: open,
  });

  // Primary device color — the check RPC doesn't return it, so fetch the swatch
  // by asset_id for the "primary in repair" line.
  const primaryAssetId = check?.primary_device?.asset_id ?? null;
  const { data: primaryColorHex = null } = useQuery({
    queryKey: ['loaner-primary-color', primaryAssetId],
    queryFn: () => apiClient.get<{ master_color_hex: string | null }[]>(
      `/v_assets?asset_id=eq.${primaryAssetId}&select=master_color_hex&limit=1`,
    ).then(rows => rows[0]?.master_color_hex ?? null),
    enabled: open && primaryAssetId != null,
    staleTime: 60 * 1000,
  });

  const options = useMemo(() => {
    const q = assetSearch.trim().toLowerCase();
    // Prefer the deduped product_display_name; fall back to model+variant only
    // when it's missing (avoids "Base 128GB Base 128GB Black" doubling).
    const productName = (a: LoanerAssetOption) =>
      a.product_display_name?.trim()
      || [a.model_name, a.variant_name].filter(Boolean).join(' ');
    const filtered = q
      ? assets.filter(a =>
          assetCodeMatches(q, a.asset_code_display, a.asset_code)
          || productName(a).toLowerCase().includes(q)
          || (a.master_color_name_en ?? '').toLowerCase().includes(q))
      : assets;
    return filtered.map(a => {
      const code = codeDisplay(a.asset_code_display, a.asset_code);
      const name = productName(a);
      return {
        value: String(a.asset_id),
        label: `${code} · ${name}`,
        primary: code,
        secondary: name,
        colorHex: a.master_color_hex,
      };
    });
  }, [assets, assetSearch]);

  const onPickLoaner = (v: string | null) => {
    setLoanerAssetId(v);
    runCheck(v ? Number(v) : null);
  };

  const mutation = useMutation({
    mutationFn: () => apiClient.rpc<LoanSigningResult>('fn_contract_loan_assign', {
      p_contract_id: contract.id,
      p_loaner_asset_id: Number(loanerAssetId),
    }),
    onSuccess: () => {
      // Issue the assign sheet → success. Signing happens externally (customer's
      // phone / signing tab); nothing more for staff to do here.
      setView('done');
      invalidate();
    },
    onError: (err) => setError(apiErr(err, t)),
  });

  // Two-stage gate: the base contract must be assignable (primary IN_REPAIR, no
  // loaner yet) AND a valid loaner must be chosen + re-checked allowed.
  const primaryInRepair = check?.primary_device?.current_bucket === 'IN_REPAIR';
  const loanerChosenAndOk = !!loanerAssetId && check?.loaner_device?.asset_id === Number(loanerAssetId) && check?.allowed === true;
  const canSubmit = loanerChosenAndOk && !mutation.isPending;

  // Two views: form → done (success after issuing). Signing is external.
  return (
    <Modal open={open} onClose={onClose} maxWidth="30rem" width="100%">
      <div className="flex flex-col overflow-hidden">
        <div className="modal-header">
          <h2 className="modal-title">
            {view === 'done' ? t('loaner.assign_done_title') : t('loaner.assign_title')}
          </h2>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label={t('common.close')}>&times;</button>
        </div>

        {view === 'form' ? (
          <>
            <div className="modal-content">
              {error && (
                <div className="alert alert-danger mb-4 animate-pop-in">
                  <XCircle size={16} />
                  <span>{error}</span>
                </div>
              )}

              {check == null && !error ? (
                <div className="py-8 text-center text-subtler text-sm">
                  <Loader2 size={16} className="animate-spin inline mr-2" />{t('common.loading')}
                </div>
              ) : check ? (
                <div className="flex flex-col gap-4">
                  <div className="rounded-md border border-line px-3 py-3 bg-surface flex flex-col gap-3">
                    <PartyLine customer={check.customer} />
                    {check.primary_device && (
                      <DeviceLine
                        label={t('loaner.primaryInRepair')}
                        device={check.primary_device}
                        icon={<Wrench size={14} className="text-warning shrink-0 mt-0.5" />}
                        colorHex={primaryColorHex}
                      />
                    )}
                  </div>

                  {/* The primary must be in for repair to justify a loaner. If the
                      base check already failed (e.g. not IN_REPAIR), surface it. */}
                  {!primaryInRepair && (
                    <div className="alert alert-warning">
                      <Wrench size={16} />
                      <span>{t('loaner.primaryNotInRepairHint')}</span>
                    </div>
                  )}

                  {/* Loaner picker */}
                  <div className="flex flex-col min-w-0 gap-1.5">
                    <label className="form-label">{t('loaner.selectLoaner')} *</label>
                    <Select
                      options={options}
                      value={loanerAssetId}
                      onChange={(v) => onPickLoaner((v as string) || null)}
                      placeholder={t('loaner.selectLoaner')}
                      showChevron
                      searchable
                      onSearchChange={setAssetSearch}
                      filterOptions={false}
                      renderOption={renderLoanerOption}
                      disabled={!primaryInRepair}
                    />
                    <div className="text-xs text-subtle">{t('loaner.selectLoanerHint')}</div>
                  </div>

                  {/* Chosen loaner confirmation + view-detail. Color comes from
                      the candidate list (the check RPC doesn't return it). */}
                  {check.loaner_device && (
                    <div className="rounded-md border border-info-border bg-info-soft px-3 py-3 flex flex-col gap-2">
                      <DeviceLine
                        label={t('loaner.loanerDevice')}
                        device={check.loaner_device}
                        colorHex={assets.find(a => a.asset_id === check.loaner_device!.asset_id)?.master_color_hex ?? null}
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        startIcon={<Eye size={14} />}
                        onClick={() => setViewAssetId(check.loaner_device!.asset_id)}
                        className="self-start"
                      >
                        {t('loaner.viewLoaner')}
                      </Button>
                    </div>
                  )}
                </div>
              ) : null}
            </div>
            <div className="modal-footer">
              <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
              <Button
                color="primary"
                startIcon={mutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <FileSignature size={14} />}
                onClick={() => mutation.mutate()}
                disabled={!canSubmit}
              >
                {t('loaner.issueForSigning')}
              </Button>
            </div>
          </>
        ) : view === 'done' ? (
          <ActionDoneView
            headline={t('loaner.assign_done_headline')}
            contractCode={check?.contract.code_display ?? `#${contract.id}`}
            tone="neutral"
            extras={
              <div className="alert alert-info">
                <FileSignature size={16} />
                <span>{t('loaner.assign_done_awaitSign')}</span>
              </div>
            }
            secondaryAction={onNavigateSigning ? {
              label: t('loaner.goToSigning'),
              startIcon: <FileSignature size={14} />,
              onClick: () => { onNavigateSigning(); onClose(); },
            } : undefined}
            onClose={onClose}
          />
        ) : null}
      </div>

      <ViewLoanerModal open={viewAssetId != null} onClose={() => setViewAssetId(null)} assetId={viewAssetId} />
    </Modal>
  );
}

// ── Return loaner (รับคืนเครื่องยืมทดแทน) ───────────────────────────────────────
//
// check → confirm the bound loaner (with a view-detail button for condition
// inspection) → fn_contract_loan_return (issues signing) → done view → Signing
// tab. Loaner moves LOANED_OUT → QUARANTINED on SEAL (§0 DP-13).

export function LoanReturnModal({
  open, onClose, contract, onNavigateSigning,
}: {
  open: boolean;
  onClose: () => void;
  contract: { id: number };
  onNavigateSigning?: () => void;
}) {
  const { t } = useTranslation();
  const invalidate = useContractInvalidate(contract.id);

  const [view, setView] = useState<'form' | 'done'>('form');
  const [check, setCheck] = useState<ReturnCheckResult | null>(null);
  const [viewAssetId, setViewAssetId] = useState<number | null>(null);
  const [error, setError] = useState('');

  const runCheck = useCallback(async () => {
    setError('');
    try {
      const res = await apiClient.rpc<ReturnCheckResult>('fn_contract_check_loan_return', {
        p_contract_id: contract.id,
      });
      setCheck(res);
    } catch (err) {
      setError(apiErr(err, t));
    }
  }, [contract.id, t]);

  useEffect(() => {
    if (open) {
      setView('form');
      setCheck(null);
      setViewAssetId(null);
      setError('');
      runCheck();
    }
  }, [open, runCheck]);

  const mutation = useMutation({
    mutationFn: () => apiClient.rpc<LoanSigningResult>('fn_contract_loan_return', {
      p_contract_id: contract.id,
    }),
    onSuccess: () => {
      // Issue the return sheet → success. Signing is external.
      setView('done');
      invalidate();
    },
    onError: (err) => setError(apiErr(err, t)),
  });

  const canSubmit = check?.allowed === true && !mutation.isPending;

  // Loaner color — the check RPC doesn't return it, fetch the swatch by id.
  const loanerAssetId = check?.loaner_device?.asset_id ?? null;
  const { data: loanerColorHex = null } = useQuery({
    queryKey: ['loaner-return-color', loanerAssetId],
    queryFn: () => apiClient.get<{ master_color_hex: string | null }[]>(
      `/v_assets?asset_id=eq.${loanerAssetId}&select=master_color_hex&limit=1`,
    ).then(rows => rows[0]?.master_color_hex ?? null),
    enabled: open && loanerAssetId != null,
    staleTime: 60 * 1000,
  });

  // Two views: form → done (success after issuing). Signing is external.
  return (
    <Modal open={open} onClose={onClose} maxWidth="30rem" width="100%">
      <div className="flex flex-col overflow-hidden">
        <div className="modal-header">
          <h2 className="modal-title">
            {view === 'done' ? t('loaner.return_done_title') : t('loaner.return_title')}
          </h2>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label={t('common.close')}>&times;</button>
        </div>

        {view === 'form' ? (
          <>
            <div className="modal-content">
              {error && (
                <div className="alert alert-danger mb-4 animate-pop-in">
                  <XCircle size={16} />
                  <span>{error}</span>
                </div>
              )}

              {check == null && !error ? (
                <div className="py-8 text-center text-subtler text-sm">
                  <Loader2 size={16} className="animate-spin inline mr-2" />{t('common.loading')}
                </div>
              ) : check ? (
                <div className="flex flex-col gap-4">
                  <div className="rounded-md border border-line px-3 py-3 bg-surface">
                    <PartyLine customer={check.customer} />
                  </div>

                  {check.loaner_device && (
                    <div className="rounded-md border border-line px-3 py-3 flex flex-col gap-2">
                      <DeviceLine label={t('loaner.loanerDevice')} device={check.loaner_device} colorHex={loanerColorHex} />
                      <Button
                        size="sm"
                        variant="outline"
                        startIcon={<Eye size={14} />}
                        onClick={() => setViewAssetId(check.loaner_device!.asset_id)}
                        className="self-start"
                      >
                        {t('loaner.viewLoaner')}
                      </Button>
                    </div>
                  )}

                  <p className="text-xs text-subtler flex items-center gap-1.5">
                    <BatteryMedium size={13} />{t('loaner.return_inspectHint')}
                  </p>
                </div>
              ) : null}
            </div>
            <div className="modal-footer">
              <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
              <Button
                color="primary"
                startIcon={mutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <FileSignature size={14} />}
                onClick={() => mutation.mutate()}
                disabled={!canSubmit}
              >
                {t('loaner.issueForSigning')}
              </Button>
            </div>
          </>
        ) : view === 'done' ? (
          <ActionDoneView
            headline={t('loaner.return_done_headline')}
            contractCode={check?.contract.code_display ?? `#${contract.id}`}
            tone="neutral"
            extras={
              <div className="alert alert-info">
                <FileSignature size={16} />
                <span>{t('loaner.return_done_awaitSign')}</span>
              </div>
            }
            secondaryAction={onNavigateSigning ? {
              label: t('loaner.goToSigning'),
              startIcon: <FileSignature size={14} />,
              onClick: () => { onNavigateSigning(); onClose(); },
            } : undefined}
            onClose={onClose}
          />
        ) : null}
      </div>

      <ViewLoanerModal open={viewAssetId != null} onClose={() => setViewAssetId(null)} assetId={viewAssetId} />
    </Modal>
  );
}
