// MDM Devices — SEARCH-ONLY screen with the two safest MDM actions (enroll +
// baseline lock). Spec: UI_FEEDBACK/2026-08-10_IMPLEMENT_mdm_device_search.md,
// which superseded §7/§9 of the 2026-08-01 list spec. Everything else in the
// older doc (columns, links, both buttons, auto-poll) still applies.
//
// This is the shortcut counterpart to the per-device tab-1 panel (NnfMdmPage):
// "find the device in your hand → press the button", not "inspect one device"
// and not "browse the fleet". Deep controls (wallpaper / lost mode / app control
// / pause) stay on tab-1.
//
// WHY SEARCH-ONLY: staff hold one device and want it enrolled. Listing every
// unenrolled device to serve that is paying 1,399× the real work — and the old
// list ordered by the COMPUTED in_mdm column, so PostgreSQL evaluated the whole
// holding before it could page (491ms, EXPLAIN loops=1399). The RPC is ~90ms and
// its cost no longer grows with fleet size. There is deliberately no filter-chip
// or branch dropdown: both only meant something over a full list, and keeping
// them as client-side filters over a ≤50-row result would quietly answer a
// different question than the one they appear to ask.
//
// Load-bearing rules:
//  - ONE search box — contract code, asset code, customer name, serial, or IMEI
//    (full or last 5). Scan a barcode straight in; no "search by" picker.
//  - The 3-char floor is enforced in the DB, not just here. We still avoid firing
//    early (UX), and the debounce is 300ms per the spec.
//  - needs_keyword ≠ no results. "Keep typing" and "nothing matched" must never
//    look alike — staff read the latter as "this device isn't in the system".
//  - truncated = show the "narrow your search" hint. There is no pagination: the
//    RPC caps at 50 and the answer to "too many" is a better keyword.
//  - After an action the results STAY — no clearing the box, so the next device
//    can be scanned immediately (owner's intent, carried over from the old spec).
//  - Auto-poll (20s) only while a row is mid-transition; re-searches the current
//    keyword, not the fleet.
//  - Buttons render on every eligible row; the RPCs self-enforce permission, so we
//    do NOT gate on a may_* column (none exist). A denied lock surfaces
//    MDM.AUTH.PERMISSION_DENIED. enroll is safe on every row.
//  - Lock needs a p_preview dialog before the real p_preview:false apply; enroll
//    needs the "scanned into ABM?" reminder.
//  - Decide lock state from enforcement_badge, never enforcement_level (raw).
//  - Do NOT render prepare_status here (owner, 2026-08-05): READY sticks forever
//    after a successful enroll, so it showed on nearly every row and meant nothing.
//  - last_seen_at / sim_info (mig 1004, now on the RPC via mig 1058): null = not
//    in MDM, render "—" not an error. sim_info is what the DEVICE reported, not
//    the contract's tel — the difference is the useful part when chasing a customer.

import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import {
  Button, Input, Badge, Modal, MobileHeader, useSnackbarContext,
} from 'tsp-form';
import {
  ArrowRightFromLine, Lock, Send, Loader2, CheckCircle, XCircle, AlertTriangle,
  ExternalLink, KeyRound, Search,
} from 'lucide-react';
import { formatRelativeAgo } from '../../lib/format';
import { useAuth } from '../../contexts/AuthContext';
import { ColorSwatch } from '../../components/ColorAutocomplete';
import {
  prepareAsset, applyLightLock, searchMdmDevices,
  type MdmDeviceListRow, type MdmDeviceListBadge, type ApplyTemplateResult,
} from '../inventory/mdm/mdmApi';
import { parseMdmError } from '../inventory/mdm/mdmApi';
import { ActivationLockRevealModal } from './ActivationLockRevealModal';
import { SEARCH_MIN_CHARS, isSearchable, isBelowSearchMin } from '../../lib/searchKeyword';

// Activation Lock codes can unlock a repossessed device for resale, so the
// owner restricted reveal to company level on purpose — a branch must ask a
// company admin. This is the anti-fraud control, not an inconvenience.
// The RPC enforces it too; hiding the button just avoids a guaranteed 403.
// (IMPLEMENT 2026-08-07 — this is the one place role_code IS the right check:
// it's UI visibility of an action, not data scoping.)
const MAY_REVEAL_ACTIVATION_LOCK = new Set(['COMPANY_ADMIN', 'SYSTEM_DEV']);

const POLL_MS = 20_000;
/** RPC default is 20, hard ceiling 50. Past this the answer is a better keyword. */
const SEARCH_LIMIT = 20;

// Is anything in the current result still moving? PENDING = enroll requested,
// waiting on Apple; APPLYING = a lock template is being pushed. Those are the
// only states that change without the user acting, so they are the only reason
// to keep polling. READY is excluded on purpose — it sticks forever after a
// successful enroll (see the header note), so treating it as "in progress"
// would poll for good on almost every row.
function hasPendingRow(rows: MdmDeviceListRow[] | undefined): boolean {
  return (rows ?? []).some(
    r => r.prepare_status === 'PENDING' || r.enforcement_badge === 'APPLYING',
  );
}

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

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const [enrollTarget, setEnrollTarget] = useState<MdmDeviceListRow | null>(null);
  const [lockTarget, setLockTarget] = useState<MdmDeviceListRow | null>(null);
  const [revealTarget, setRevealTarget] = useState<MdmDeviceListRow | null>(null);
  const mayRevealLock = MAY_REVEAL_ACTIVATION_LOCK.has(user?.role_code ?? '');

  // `enabled` keeps the screen silent until the keyword is long enough — the
  // empty state is the resting state here, not an unfiltered list.
  const { data, isError, error, isFetching, refetch } = useQuery({
    queryKey: ['mdm-device-search', search],
    queryFn: () => searchMdmDevices(search, SEARCH_LIMIT),
    enabled: isSearchable(search),
    placeholderData: keepPreviousData,
    // Poll only while a row on screen is mid-transition (enroll awaiting Apple, or
    // a lock being pushed). Re-runs the current keyword only — never the fleet.
    // A settled result has nothing to re-read; enroll/lock call refetch() directly.
    refetchInterval: (q) => (hasPendingRow(q.state.data?.devices) ? POLL_MS : false),
    refetchIntervalInBackground: false,
    staleTime: 0,
  });

  const rows = data?.devices ?? [];
  const truncated = data?.truncated === true;

  // Below SEARCH_MIN_CHARS we don't fire at all: the RPC would return empty with
  // needs_keyword anyway, so the request buys nothing. Clearing `search` also
  // disables the query, which is what empties the screen when the box is cleared.
  const handleSearch = (value: string) => {
    setSearchInput(value);
    clearTimeout(searchTimer.current);
    const next = isSearchable(value) ? value.trim() : '';
    searchTimer.current = setTimeout(() => setSearch(next), 300);
  };

  const okSnack = (msg: string) => addSnackbar({
    message: <div className="alert alert-success"><CheckCircle size={18} /><div><div className="alert-title">{msg}</div></div></div>,
    type: 'success', duration: 3000,
  });
  const errSnack = (msg: string) => addSnackbar({
    message: <div className="alert alert-danger"><XCircle size={18} /><div><div className="alert-title">{msg}</div></div></div>,
    type: 'error', duration: 5000,
  });

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

        {/* One box. Scan or type — no filters, no scope picker (see header note). */}
        <div className="flex-none pb-4">
          <div className="max-w-lg">
            <Input
              placeholder={t('mdmDevices.searchPlaceholder')}
              value={searchInput}
              onChange={(e) => handleSearch(e.target.value)}
              size="sm"
              className="w-full search-min-hint"
              startIcon={<Search size={15} />}
              endIcon={isBelowSearchMin(searchInput)
                ? <span className="text-[11px] whitespace-nowrap">
                    {t('common.searchMinCharsShort', { n: SEARCH_MIN_CHARS })}
                  </span>
                : undefined}
            />
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
                <div className="p-8 text-center text-subtle flex flex-col items-center gap-2">
                  {/* Two DIFFERENT answers that must never look alike:
                      not searching yet → "scan or type to find a device"
                      3+, no hits       → "nothing matched" — staff read anything
                                          else here as "it isn't in the system".
                      The 1-2 char case is NOT repeated here: the input's own
                      "at least 3 chars" end-icon already says it, right where
                      the user is typing. */}
                  <Search size={28} className="text-subtler" />
                  <span>
                    {isSearchable(searchInput)
                      ? t('mdmDevices.noResults')
                      : t('mdmDevices.searchPrompt')}
                  </span>
                </div>
              ) : (
                <>
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
                  {/* Capped, not paged — the fix for "too many" is a better keyword. */}
                  {truncated && (
                    <div className="pt-3 text-xs text-subtle text-center">
                      {t('mdmDevices.truncatedHint', { count: rows.length })}
                    </div>
                  )}
                </>
              )}
            </div>
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
