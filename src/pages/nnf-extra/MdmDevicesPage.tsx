// MDM Devices — branch-wide device list with the two safest MDM actions
// (enroll + baseline lock). Spec: UI_FEEDBACK/2026-08-01_IMPLEMENT_mdm_device_list_screen.md.
//
// This is the shortcut counterpart to the per-device tab-1 panel (NnfMdmPage):
// "find the device that needs action → press the button", not "inspect one device".
// Deep controls (wallpaper / lost mode / app control / pause) stay on tab-1.
//
// Load-bearing rules from the spec:
//  - ONE search box, matched against search_key (lowercased) — scan a barcode in.
//  - Buttons render on every eligible row; the RPCs self-enforce permission, so we
//    do NOT gate on a may_* column (none exist on this view). A denied lock just
//    surfaces MDM.AUTH.PERMISSION_DENIED. enroll is safe on every row.
//  - Lock button needs a p_preview dialog (shows what the device will get) before
//    the real p_preview:false apply. enroll needs an "scanned into ABM?" reminder.
//  - Auto-poll (20s): prepare_status / in_mdm change on their own; a stale screen
//    made a branch think enroll succeeded when it never ran (2026-08-01).
//  - A row leaves the "not enrolled" filter ONLY when in_mdm flips true — never on
//    the intermediate PENDING/READY, or the staffer loses the row mid-task.
//  - Decide lock state from enforcement_badge, never enforcement_level (raw/unreliable).
//  - Do NOT render prepare_status on this list (owner, 2026-08-05): READY sticks
//    forever after a successful enroll (105 of ~140 rows), so "profile ready —
//    erase the device" showed on nearly every row and meant nothing. That advice
//    only belongs on the per-device screen, and only while in_mdm = false.
//  - last_seen_at / sim_info (mig 1004): null = not in MDM, render "—" not an
//    error. sim_info is what the DEVICE reported, not the contract's tel — the
//    two can differ and that difference is the useful part when chasing a customer.

import { useState, useMemo, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import {
  Button, Input, Select, Badge, Modal, DataTableFooter, MobileHeader,
  useSnackbarContext,
} from 'tsp-form';
import {
  ArrowRightFromLine, Lock, Send, Loader2, CheckCircle, XCircle, AlertTriangle,
  ExternalLink, KeyRound,
} from 'lucide-react';
import { apiClient } from '../../lib/api';
import { formatRelativeAgo } from '../../lib/format';
import { useAuth } from '../../contexts/AuthContext';
import { ColorSwatch } from '../../components/ColorAutocomplete';
import {
  prepareAsset, applyLightLock,
  type MdmDeviceListRow, type MdmDeviceListBadge, type ApplyTemplateResult,
} from '../inventory/mdm/mdmApi';
import { parseMdmError } from '../inventory/mdm/mdmApi';
import { ActivationLockRevealModal } from './ActivationLockRevealModal';

// Activation Lock codes can unlock a repossessed device for resale, so the
// owner restricted reveal to company level on purpose — a branch must ask a
// company admin. This is the anti-fraud control, not an inconvenience.
// The RPC enforces it too; hiding the button just avoids a guaranteed 403.
// (IMPLEMENT 2026-08-07 — this is the one place role_code IS the right check:
// it's UI visibility of an action, not data scoping.)
const MAY_REVEAL_ACTIVATION_LOCK = new Set(['COMPANY_ADMIN', 'SYSTEM_DEV']);

type MdmFilter = 'not_enrolled' | 'enrolled' | 'all';
const POLL_MS = 20_000;
const PAGE_SIZE_OPTIONS = [50, 100, 200];

// enforcement_badge → pill. NONE = not locked (default), LIGHT/ENFORCED = locked.
const BADGE_STYLE: Record<MdmDeviceListBadge, { color: 'default' | 'success' | 'info'; }> = {
  NOT_IN_MDM: { color: 'default' },
  APPLYING: { color: 'info' },
  NONE: { color: 'default' },
  LIGHT: { color: 'success' },
  ENFORCED: { color: 'success' },
};

function EnforcementBadge({ badge }: { badge: MdmDeviceListBadge }) {
  const { t } = useTranslation();
  if (badge === 'NOT_IN_MDM') return <span className="text-xs text-subtler">—</span>;
  return <Badge size="sm" color={BADGE_STYLE[badge].color}>{t(`mdmDevices.lock.${badge}`)}</Badge>;
}

// Last contact with MDM. null = not enrolled, so "—" is the honest render.
function LastSeen({ value }: { value: string | null }) {
  const { t, i18n } = useTranslation();
  if (!value) return <span className="text-subtler">—</span>;
  const { rel } = formatRelativeAgo(value, i18n.language);
  return (
    <span>
      <span className="text-subtler">{t('mdmDevices.lastSeen')}: </span>
      <span className="text-fg">{rel}</span>
    </span>
  );
}

export function MdmDevicesPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const actorId = user?.user_id ?? null;
  const { addSnackbar } = useSnackbarContext();

  const [filter, setFilter] = useState<MdmFilter>('not_enrolled');
  const [branchId, setBranchId] = useState<number | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(50);

  const [enrollTarget, setEnrollTarget] = useState<MdmDeviceListRow | null>(null);
  const [lockTarget, setLockTarget] = useState<MdmDeviceListRow | null>(null);
  const [revealTarget, setRevealTarget] = useState<MdmDeviceListRow | null>(null);
  const mayRevealLock = MAY_REVEAL_ACTIVATION_LOCK.has(user?.role_code ?? '');

  const buildEndpoint = useCallback(() => {
    const params: string[] = ['order=in_mdm.asc,asset_id.asc'];
    if (filter === 'not_enrolled') params.push('in_mdm=is.false');
    else if (filter === 'enrolled') params.push('in_mdm=is.true');
    if (branchId != null) params.push(`branch_id=eq.${branchId}`);
    if (search.trim()) params.push(`search_key=like.*${encodeURIComponent(search.trim().toLowerCase())}*`);
    return `/v_mdm_device_list?${params.join('&')}`;
  }, [filter, branchId, search]);

  const { data, isError, error, isFetching, refetch } = useQuery({
    queryKey: ['mdm-device-list', filter, branchId, search, pageIndex, pageSize],
    queryFn: () => apiClient.getPaginated<MdmDeviceListRow>(buildEndpoint(), { page: pageIndex + 1, pageSize }),
    placeholderData: keepPreviousData,
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false,
    staleTime: 0,
  });

  const rows = data?.data ?? [];
  const totalCount = data?.totalCount ?? 0;

  // Branch dropdown comes from v_branches (RLS-scoped to what the user can see),
  // NOT from the device rows. Deriving it from rows only listed branches that
  // already had an MDM-known device — and only those on the current page — so a
  // company user saw an incomplete branch list (2026-08-02 report).
  const { data: branches } = useQuery({
    queryKey: ['mdm-branches'],
    queryFn: () => apiClient.get<{ id: number; name: string }[]>('/v_branches?is_active=is.true&order=name&select=id,name'),
    staleTime: 5 * 60 * 1000,
  });
  const branchOptions = useMemo(
    () => (branches ?? []).map((b) => ({ value: String(b.id), label: b.name })),
    [branches],
  );
  // A branch-scoped user only sees their own branch → dropdown hides.
  const showBranchDropdown = branchOptions.length > 1 || branchId != null;

  const handleSearch = (value: string) => {
    setSearchInput(value);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => { setSearch(value); setPageIndex(0); }, 300);
  };

  const okSnack = (msg: string) => addSnackbar({
    message: <div className="alert alert-success"><CheckCircle size={18} /><div><div className="alert-title">{msg}</div></div></div>,
    type: 'success', duration: 3000,
  });
  const errSnack = (msg: string) => addSnackbar({
    message: <div className="alert alert-danger"><XCircle size={18} /><div><div className="alert-title">{msg}</div></div></div>,
    type: 'error', duration: 5000,
  });

  const filterChips: { key: MdmFilter; label: string }[] = [
    { key: 'not_enrolled', label: t('mdmDevices.filter.notEnrolled') },
    { key: 'enrolled', label: t('mdmDevices.filter.enrolled') },
    { key: 'all', label: t('mdmDevices.filter.all') },
  ];

  return (
    <>
      <MobileHeader className="mobile-header-bordered md:hidden">
        <div className="mobile-header-start">
          <button
            className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current"
            aria-label="Open menu"
            onClick={() => window.dispatchEvent(new CustomEvent('sidemenu:open'))}
          >
            <ArrowRightFromLine size={18} />
          </button>
        </div>
        <div className="mobile-header-title mobile-header-title-truncate">{t('mdmDevices.title')}</div>
        <div className="mobile-header-end" />
      </MobileHeader>

      <div className="page-content responsive-dvh-mobile-header">
        <div className="flex items-center justify-between mb-4 flex-none max-md:hidden">
          <h1 className="heading-2">{t('mdmDevices.title')}</h1>
        </div>

        {/* Filter chips + search + branch */}
        <div className="flex-none pb-4 flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {filterChips.map((chip) => (
              <button
                key={chip.key}
                type="button"
                onClick={() => { setFilter(chip.key); setPageIndex(0); }}
                className={`px-3 py-1.5 rounded-md text-sm transition-colors cursor-pointer ${
                  filter === chip.key
                    ? 'bg-item-active-bg text-item-active-fg font-medium'
                    : 'text-item-fg hover:bg-item-hover-bg'
                }`}
              >
                {chip.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0 md:max-w-72">
              <Input
                placeholder={t('mdmDevices.searchPlaceholder')}
                value={searchInput}
                onChange={(e) => handleSearch(e.target.value)}
                size="sm"
                className="w-full"
              />
            </div>
            {showBranchDropdown && (
              <div style={{ width: '14rem' }}>
                <Select
                  options={branchOptions}
                  value={branchId != null ? String(branchId) : null}
                  onChange={(val) => { setBranchId(val ? Number(val) : null); setPageIndex(0); }}
                  placeholder={t('mdmDevices.allBranches')}
                  size="sm"
                  showChevron
                  clearable
                />
              </div>
            )}
          </div>
        </div>

        {isError && (
          <div className="alert alert-danger flex-none">
            <XCircle size={18} />
            <span>{error instanceof Error ? error.message : t('common.error')}</span>
          </div>
        )}

        {!isError && (
          <div className={`flex-1 min-h-0 flex flex-col ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}>
            <div className="flex-1 overflow-auto better-scroll pb-8">
              {rows.length === 0 ? (
                <div className="p-8 text-center text-subtle">{t('mdmDevices.noResults')}</div>
              ) : (
                <div className="flex flex-col divide-y divide-line border-b border-line">
                  {rows.map((row) => (
                    <DeviceRow
                      key={row.asset_id}
                      row={row}
                      onOpenAsset={() => navigate(`/admin/inventory/assets/${row.asset_id}`)}
                      onOpenContract={() => row.contract_id && navigate(`/admin/contracts/search/${row.contract_id}`)}
                      onEnroll={() => setEnrollTarget(row)}
                      onLock={() => setLockTarget(row)}
                      onRevealLock={mayRevealLock ? () => setRevealTarget(row) : null}
                    />
                  ))}
                </div>
              )}
            </div>
            <DataTableFooter
              currentPage={pageIndex + 1}
              totalPages={Math.max(1, Math.ceil(totalCount / pageSize))}
              onPageChange={(p) => setPageIndex(p - 1)}
              pageSize={pageSize}
              pageSizeOptions={PAGE_SIZE_OPTIONS}
              onPageSizeChange={(ps) => { setPageSize(ps); setPageIndex(0); }}
              totalRows={totalCount}
            />
          </div>
        )}
      </div>

      <EnrollDialog
        row={enrollTarget}
        onClose={() => setEnrollTarget(null)}
        onDone={(msg) => { okSnack(msg); refetch(); }}
        onError={errSnack}
      />
      <LockDialog
        row={lockTarget}
        actorId={actorId}
        onClose={() => setLockTarget(null)}
        onDone={(msg) => { okSnack(msg); refetch(); }}
        onError={errSnack}
      />
      {/* Read-only reveal — nothing to refetch afterwards. */}
      <ActivationLockRevealModal
        target={revealTarget}
        onClose={() => setRevealTarget(null)}
      />
    </>
  );
}

// ── One device row ───────────────────────────────────────────────────────────

function DeviceRow({
  row, onOpenAsset, onOpenContract, onEnroll, onLock, onRevealLock,
}: {
  row: MdmDeviceListRow;
  onOpenAsset: () => void;
  onOpenContract: () => void;
  onEnroll: () => void;
  onLock: () => void;
  /** Null hides the action entirely — see MAY_REVEAL_ACTIVATION_LOCK. */
  onRevealLock: (() => void) | null;
}) {
  const { t } = useTranslation();
  const applying = row.enforcement_badge === 'APPLYING';
  return (
    <div className="flex items-start gap-3 px-1 py-3">
      <ColorSwatch hex={row.color_hex} title={row.color_name ?? undefined} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <button type="button" onClick={onOpenAsset} className="text-sm font-medium text-primary-fg hover:underline inline-flex items-center gap-1 bg-transparent border-none p-0 cursor-pointer">
            {row.asset_code_display}<ExternalLink size={12} className="opacity-60" />
          </button>
          {row.in_mdm
            ? <Badge size="sm" color="success">{t('mdmDevices.inMdm')}</Badge>
            : <Badge size="sm" color="default">{t('mdmDevices.notInMdm')}</Badge>}
          <EnforcementBadge badge={row.enforcement_badge} />
        </div>
        <div className="text-sm text-subtle truncate">{row.product_name}</div>
        <div className="text-xs truncate flex flex-wrap gap-x-3 gap-y-0.5">
          {row.serial_number && (
            <span>
              <span className="text-subtler">{t('mdmDevices.serial')}: </span>
              <span className="font-mono text-fg">{row.serial_number}</span>
            </span>
          )}
          {row.imei && (
            <span>
              <span className="text-subtler">{t('mdmDevices.imei')}: </span>
              <span className="font-mono text-fg">{row.imei}</span>
            </span>
          )}
          {!row.serial_number && !row.imei && <span className="text-subtler">—</span>}
        </div>
        {/* mig 1004 — device heartbeat + the SIM the DEVICE reported. */}
        <div className="text-xs flex flex-wrap gap-x-3 gap-y-0.5">
          <LastSeen value={row.last_seen_at} />
          <span className="min-w-0">
            <span className="text-subtler">{t('mdmDevices.sim')}: </span>
            {row.sim_info
              ? <span className="text-fg">{row.sim_info}</span>
              : <span className="text-subtler">—</span>}
          </span>
        </div>
        <div className="text-xs text-subtler truncate">
          {row.customer_name}
          {row.contract_code && (
            <>
              {row.customer_name && ' · '}
              <button type="button" onClick={onOpenContract} className="text-primary-fg hover:underline inline-flex items-center gap-0.5 bg-transparent border-none p-0 cursor-pointer">
                {row.contract_code}<ExternalLink size={11} className="opacity-60" />
              </button>
            </>
          )}
        </div>
      </div>
      <div className="shrink-0 flex flex-col items-end gap-1.5">
        {!row.in_mdm && (
          <Button size="sm" variant="outline" startIcon={<Send size={14} />} onClick={onEnroll}>
            {t('mdmDevices.enrollButton')}
          </Button>
        )}
        {row.in_mdm && !applying && row.enforcement_badge === 'NONE' && (
          <Button size="sm" color="primary" startIcon={<Lock size={14} />} onClick={onLock}>
            {t('mdmDevices.lockButton')}
          </Button>
        )}
        {applying && (
          <span className="text-xs text-info-fg inline-flex items-center gap-1">
            <Loader2 size={12} className="animate-spin" />{t('mdmDevices.lock.APPLYING')}
          </span>
        )}
        {onRevealLock && row.in_mdm && (
          <Button size="sm" variant="outline" startIcon={<KeyRound size={14} />} onClick={onRevealLock}>
            {t('mdmDevices.activationLock.rowButton')}
          </Button>
        )}
      </div>
    </div>
  );
}

// ── Enroll confirm dialog (safest RPC; just a "scanned into ABM?" reminder) ────

function EnrollDialog({
  row, onClose, onDone, onError,
}: {
  row: MdmDeviceListRow | null;
  onClose: () => void;
  onDone: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    if (!row) return;
    setBusy(true);
    try {
      await prepareAsset(row.asset_id);
      onDone(t('mdmDevices.enrollQueued'));
      onClose();
    } catch (err) {
      onError(parseMdmError(err, t).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={!!row} onClose={() => !busy && onClose()} maxWidth="26rem" width="100%">
      <div className="modal-header"><h2 className="modal-title">{t('mdmDevices.enrollConfirmTitle')}</h2></div>
      <div className="modal-content">
        <p className="text-sm text-subtle">{t('mdmDevices.enrollConfirmBody')}</p>
        <p className="text-sm mt-2">
          <span className="font-medium">{row?.asset_code_display}</span>
          {row?.serial_number && <span className="font-mono text-subtle"> · {row.serial_number}</span>}
        </p>
      </div>
      <div className="modal-footer">
        <Button variant="ghost" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
        <Button color="primary" onClick={confirm} disabled={busy} startIcon={<Send size={15} />}>
          {t('mdmDevices.enrollConfirmButton')}
        </Button>
      </div>
    </Modal>
  );
}

// ── Lock confirm dialog (preview → apply; RPC self-enforces MDM.PROFILE) ───────

function LockDialog({
  row, actorId, onClose, onDone,
}: {
  row: MdmDeviceListRow | null;
  actorId: number | null;
  onClose: () => void;
  onDone: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const { t } = useTranslation();
  const [preview, setPreview] = useState<ApplyTemplateResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const lastAssetRef = useRef<number | null>(null);

  // Fetch the preview once per opened row (render-phase guard, no effect needed).
  if (row && lastAssetRef.current !== row.asset_id) {
    lastAssetRef.current = row.asset_id;
    setPreview(null);
    setErr(null);
    setBusy(true);
    (async () => {
      try {
        if (actorId == null) throw new Error('no actor');
        setPreview(await applyLightLock(row.asset_id, actorId, true));
      } catch (e) {
        setErr(parseMdmError(e, t).message);
      } finally {
        setBusy(false);
      }
    })();
  }
  if (!row) lastAssetRef.current = null;

  const confirm = async () => {
    if (!row) return;
    setBusy(true);
    setErr(null);
    try {
      if (actorId == null) throw new Error('no actor');
      await applyLightLock(row.asset_id, actorId, false); // ⛔ false = real apply
      onDone(t('mdmDevices.lockQueued'));
      onClose();
    } catch (e) {
      setErr(parseMdmError(e, t).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={!!row} onClose={() => !busy && onClose()} maxWidth="28rem" width="100%">
      <div className="modal-header"><h2 className="modal-title">{t('mdmDevices.lockConfirmTitle')}</h2></div>
      <div className="modal-content">
        {busy && !preview ? (
          <div className="flex items-center gap-2 text-sm text-subtle py-2"><Loader2 size={16} className="animate-spin" />{t('common.loading')}</div>
        ) : err ? (
          <div className="alert alert-danger"><XCircle size={16} /><span>{err}</span></div>
        ) : preview ? (
          <>
            <p className="text-sm text-subtle">{t('mdmDevices.lockConfirmBody')}</p>
            <p className="text-sm mt-2">
              <span className="font-medium">{row?.asset_code_display}</span>
              {row?.serial_number && <span className="font-mono text-subtle"> · {row.serial_number}</span>}
            </p>
            <div className="alert alert-warning mt-3">
              <AlertTriangle size={16} className="shrink-0" />
              <div className="min-w-0">
                <div className="alert-title">{t('mdmDevices.lockReminderTitle')}</div>
                <ul className="alert-description mt-1 flex flex-col gap-0.5 list-disc pl-4">
                  <li>{t('mdmDevices.lockReminderIcloud')}</li>
                  <li>{t('mdmDevices.lockReminderFindMy')}</li>
                  <li>{t('mdmDevices.lockReminderNnfApp')}</li>
                </ul>
              </div>
            </div>
            <ul className="text-xs text-subtle mt-3 flex flex-col gap-1">
              {preview.restrictions.map((r) => (
                <li key={r.key} className="inline-flex items-center gap-1.5">
                  <Lock size={11} className="shrink-0" />
                  {t(`asset.mdm.step7.flag.${r.key}`, { defaultValue: r.key })}
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </div>
      <div className="modal-footer">
        <Button variant="ghost" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
        <Button color="primary" onClick={confirm} disabled={busy || !preview} startIcon={<Lock size={15} />}>
          {t('mdmDevices.lockConfirmButton')}
        </Button>
      </div>
    </Modal>
  );
}
