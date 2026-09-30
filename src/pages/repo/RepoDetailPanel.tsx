import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Badge, Tooltip, PopOver, useSnackbarContext } from 'tsp-form';
import {
  User, Phone, Smartphone, MapPin, Loader2, ClipboardList, Scale,
  Star, StarOff, CheckCircle, Clock, AlertTriangle, Repeat, ExternalLink,
  Printer, FileText, KeyRound, ChevronDown,
} from 'lucide-react';
import { DateTime } from '../../components/DateTime';
import { apiClient } from '../../lib/api';
import { formatTel } from '../../lib/format';
import { DeviceLink } from '../call-center/ccBadges';
import {
  fetchContractRepo, fetchRepoActions, fetchContractDeviceId, invalidateRepoQueries,
  type RepoAction, type RepoActionCode, type GeoPrecision,
} from './repoApi';
import { RepoLogAttemptModal } from './RepoLogAttemptModal';
import { RepoGiveUpModal } from './RepoGiveUpModal';
import { RepoNoteActionModal, type NoteActionConfig } from './RepoNoteActionModal';
import { RepoPrintModal, type RepoPrintDoc } from './RepoPrintModal';
import { beMediaRepoAuthorityPdf, beMediaRepoContractPdf, openPdfInNewTab } from '../../lib/beMedia';
import { RepoIcloudRevealModal } from './RepoIcloudRevealModal';

// Note-driven actions handled by the one reusable modal (keyed by action_code).
const NOTE_ACTIONS: Partial<Record<RepoActionCode, NoteActionConfig>> = {
  REPO_ADD_NOTE: { rpc: 'ops_repo_add_note', keyStem: 'addNote', noteRequired: true, tone: 'neutral' },
  REPO_REVERT_ACTIVE: {
    rpc: 'ops_repo_revert_active', keyStem: 'revertActive', noteRequired: true, tone: 'success',
    transition: { from: 'WAIT_FOR_REPO', to: 'ACTIVE', toColor: 'success' },
  },
  LEGAL_FINISH: {
    rpc: 'ops_legal_finish', keyStem: 'legalFinish', noteRequired: true, tone: 'success', confirmColor: 'primary',
    transition: { from: 'WAIT_FOR_LEGAL', to: 'LEGAL_COMPLETED', toColor: 'success' },
  },
  LEGAL_RETURN_TO_REPO: {
    rpc: 'ops_legal_return_to_repo', keyStem: 'legalReturn', noteRequired: true, tone: 'warning',
    transition: { from: 'WAIT_FOR_LEGAL', to: 'WAIT_FOR_REPO', toColor: 'warning' },
  },
};

// Actions handled inline (focus toggle) or dedicated modals — not the note modal.
const INLINE_OR_DEDICATED = new Set<RepoActionCode>([
  'REPO_LOG_ATTEMPT', 'REPO_GIVE_UP', 'REPO_FOCUS_ADD', 'REPO_FOCUS_REMOVE', 'REPO_SET_TARGET',
  'REPO_PRINT_AUTHORITY', 'REPO_PRINT_CONTRACT',
]);

const ACTION_COLOR: Partial<Record<RepoActionCode, 'primary' | 'warning' | 'danger'>> = {
  REPO_LOG_ATTEMPT: 'primary',
  REPO_GIVE_UP: 'warning',
  LEGAL_FINISH: 'primary',
};

const ACTION_ICON: Partial<Record<RepoActionCode, React.ReactNode>> = {
  REPO_GIVE_UP: <Scale size={14} />,
  REPO_PRINT_AUTHORITY: <Printer size={14} />,
  REPO_PRINT_CONTRACT: <FileText size={14} />,
};

// Why an action can't be used right now.
//
// The repossession evaluator sends only "are you allowed" and "is it possible",
// with no reason — unlike the contract one, which also sends a blocking code.
// But its rules are fixed and public: each action is possible only in a given
// stage of the job. So the reason is derivable here rather than guessed, and
// the user gets "only while the job is waiting for legal" instead of a shrug.
//
// If the backend ever sends a reason of its own, prefer that and delete this.
const STAGE_REQUIRED: Partial<Record<RepoActionCode, 'REPO' | 'LEGAL' | 'EITHER'>> = {
  REPO_LOG_ATTEMPT: 'REPO',
  REPO_GIVE_UP: 'REPO',
  REPO_REVERT_ACTIVE: 'REPO',
  REPO_ADD_NOTE: 'EITHER',
  REPO_SET_TARGET: 'EITHER',
  REPO_PRINT_AUTHORITY: 'EITHER',
  REPO_PRINT_CONTRACT: 'EITHER',
  LEGAL_FINISH: 'LEGAL',
  LEGAL_RETURN_TO_REPO: 'LEGAL',
};

function unavailableReason(
  action: RepoActionCode, t: ReturnType<typeof useTranslation>['t'],
): string {
  const stage = STAGE_REQUIRED[action];
  if (stage === 'REPO') return t('repo.action.onlyWhileAwaitingRepo');
  if (stage === 'LEGAL') return t('repo.action.onlyWhileAwaitingLegal');
  if (stage === 'EITHER') return t('repo.action.onlyWhileInPool');
  return t('repo.action.notAvailableNow');
}

function GeoPin({ precision }: { precision: GeoPrecision }) {
  const { t } = useTranslation();
  if (precision === 'EXACT') {
    return <Tooltip content={t('repo.geo.EXACT')} placement="top"><MapPin size={13} className="text-success-fg shrink-0" /></Tooltip>;
  }
  if (precision === 'CENTROID') {
    return <Tooltip content={t('repo.geo.CENTROID')} placement="top"><MapPin size={13} className="text-warning-fg shrink-0" /></Tooltip>;
  }
  return <Tooltip content={t('repo.geo.NONE')} placement="top"><MapPin size={13} className="text-subtler shrink-0" /></Tooltip>;
}

export function RepoDetailPanel({ contractId, onChanged }: {
  contractId: number;
  isMobile: boolean;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();

  const { data: detail, isLoading } = useQuery({
    queryKey: ['repo', 'detail', contractId],
    queryFn: () => fetchContractRepo(contractId),
    staleTime: 15_000,
  });
  const { data: actions = [] } = useQuery({
    queryKey: ['repo', 'actions', contractId],
    queryFn: () => fetchRepoActions(contractId),
    staleTime: 15_000,
  });
  // The asset page routes by id; the repo views only give the device's code.
  const { data: deviceId = null } = useQuery({
    queryKey: ['repo', 'deviceId', contractId],
    queryFn: () => fetchContractDeviceId(contractId),
    staleTime: 5 * 60_000,
  });

  const [logOpen, setLogOpen] = useState(false);
  const [giveUpOpen, setGiveUpOpen] = useState(false);
  const [noteAction, setNoteAction] = useState<NoteActionConfig | null>(null);
  const [focusBusy, setFocusBusy] = useState(false);
  const [printDoc, setPrintDoc] = useState<RepoPrintDoc | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreTriggerRef = useRef<HTMLDivElement>(null);
  const [icloudOpen, setIcloudOpen] = useState(false);

  // Refresh the whole section, not just this contract: the worklist behind the
  // panel shows the same job, and picking it up here used to leave that row
  // stale. onChanged still fires so the host can react (scroll, close, …).
  const refresh = () => {
    invalidateRepoQueries(queryClient);
    onChanged();
  };

  const contractCode = detail?.contract_code_display ?? '';

  const toggleFocus = async (add: boolean) => {
    setFocusBusy(true);
    try {
      await apiClient.rpc(add ? 'ops_repo_focus_add' : 'ops_repo_focus_remove', { p_contract_id: contractId });
      refresh();
      addSnackbar({
        message: <div className="alert alert-success"><CheckCircle size={16} /><span className="alert-description">{add ? t('repo.focus.added') : t('repo.focus.removed')}</span></div>,
        type: 'success',
      });
    } catch {
      addSnackbar({
        message: <div className="alert alert-danger"><AlertTriangle size={16} /><span className="alert-description">{t('common.error')}</span></div>,
        type: 'error',
      });
    } finally {
      setFocusBusy(false);
    }
  };

  // A print button: in place by default, in a new tab on ctrl/cmd or middle
  // click. If the browser blocks the new tab we fall back to showing it here
  // rather than doing nothing.
  const openPrint = async (action: RepoActionCode, newTab: boolean) => {
    const doc: RepoPrintDoc = action === 'REPO_PRINT_AUTHORITY' ? 'authority' : 'contract';
    if (!newTab) { setPrintDoc(doc); return; }
    const opened = await openPdfInNewTab(() => (
      doc === 'authority'
        ? beMediaRepoAuthorityPdf(contractId)
        : beMediaRepoContractPdf(contractId)
    ));
    if (!opened) setPrintDoc(doc);
  };

  const runAction = (a: RepoAction) => {
    if (!a.is_available) return;
    switch (a.action_code) {
      case 'REPO_LOG_ATTEMPT': setLogOpen(true); break;
      case 'REPO_GIVE_UP': setGiveUpOpen(true); break;
      case 'REPO_FOCUS_ADD': toggleFocus(true); break;
      case 'REPO_FOCUS_REMOVE': toggleFocus(false); break;
      case 'REPO_PRINT_AUTHORITY': setPrintDoc('authority'); break;
      case 'REPO_PRINT_CONTRACT': setPrintDoc('contract'); break;
      default: {
        const cfg = NOTE_ACTIONS[a.action_code];
        if (cfg) setNoteAction(cfg);
      }
    }
  };

  if (isLoading) {
    return <div className="flex-1 flex items-center justify-center text-subtle"><Loader2 size={24} className="animate-spin" /></div>;
  }
  if (!detail) {
    return <div className="flex-1 flex items-center justify-center text-subtler text-sm">{t('common.noData')}</div>;
  }

  // Hide not-permitted; show permitted-but-unavailable as disabled with a tooltip.
  // REPO_SET_TARGET is deferred (no address picker in the MVP) — treat as not-wired.
  // This screen exists so an agent standing outside a customer's house can
  // record what happened. So the actions are split by their role here rather
  // than shown as eleven equals:
  //   · recording the visit      → the one primary button
  //   · the two printed sheets   → beside the device they describe, in the body
  //   · picking the job up       → its own header control
  //   · everything else          → one menu, every action listed with its
  //                                reason when it can't be used
  const permitted = actions.filter((a) => a.is_permitted);
  const isFocusAction = (c: RepoActionCode) => c === 'REPO_FOCUS_ADD' || c === 'REPO_FOCUS_REMOVE';
  const isPrintAction = (c: RepoActionCode) => c === 'REPO_PRINT_AUTHORITY' || c === 'REPO_PRINT_CONTRACT';

  const primaryAction = permitted.find((a) => a.action_code === 'REPO_LOG_ATTEMPT') ?? null;
  const printActions = permitted.filter((a) => isPrintAction(a.action_code));
  const moreActions = permitted.filter(
    (a) => a.action_code !== 'REPO_LOG_ATTEMPT'
      && !isFocusAction(a.action_code)
      && !isPrintAction(a.action_code),
  );

  // Picking a job up is the gate on the iCloud password, so the control must be
  // findable even when the evaluator says no: permitted-but-unavailable renders
  // disabled with the reason, matching every other action here. Filtering on
  // is_available (as this did) made the button disappear entirely, which reads
  // as "the feature doesn't exist" — the reason production shows no picked-up
  // jobs at all (RECHECK 2026-09-30).
  const onFocus = detail.on_focus;
  const focusAction = actions.find(
    (a) => a.action_code === (onFocus ? 'REPO_FOCUS_REMOVE' : 'REPO_FOCUS_ADD') && a.is_permitted,
  );

  const statusColor = detail.dunning_status === 'WAIT_FOR_LEGAL' ? 'warning'
    : detail.dunning_status === 'REPO_COMPLETED' || detail.dunning_status === 'LEGAL_COMPLETED' ? 'success'
    : 'danger';

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* Header */}
      {/* Wraps instead of forcing a minimum width: at a narrow window the code,
          the badge and the two controls could not fit on one line, and because
          nothing here shrinks they pushed the whole panel off the right edge.
          min-h rather than a fixed height so a second line has room. */}
      <div className="flex-none flex items-center flex-wrap gap-2 min-h-panel-header-h px-4 py-1.5 border-b border-line">
        {/* A real link, so ctrl/cmd-click and middle-click open the contract
            in a new tab. */}
        <Link
          to={`/admin/contracts/search/${contractId}`}
          className="font-mono text-sm font-medium truncate text-primary-fg hover:underline inline-flex items-center gap-1"
        >
          {contractCode}
          <ExternalLink size={12} className="shrink-0" />
        </Link>
        <Badge color={statusColor} size="sm">{t(`repo.status.${detail.dunning_status}`, { defaultValue: detail.dunning_status })}</Badge>
        <div className="ml-auto flex items-center gap-2">
          {/* The password is only readable on a job you've picked up, so the
              button is shown disabled (not hidden) with the reason when not. */}
          <Tooltip
            content={onFocus ? t('repo.icloud.title') : t('repo.icloud.pickUpFirst')}
            placement="top"
          >
            <Button
              variant="outline"
              size="sm"
              startIcon={<KeyRound size={14} />}
              disabled={!onFocus}
              onClick={() => setIcloudOpen(true)}
            >
              {t('repo.icloud.button')}
            </Button>
          </Tooltip>
          {focusAction && (
            <Tooltip
              content={focusAction.is_available
                ? (onFocus ? t('repo.focus.remove') : t('repo.focus.add'))
                : t('repo.action.notAvailableNow')}
              placement="top"
            >
              <Button
                variant="outline"
                size="sm"
                startIcon={focusBusy ? <Loader2 size={14} className="animate-spin" /> : onFocus ? <StarOff size={14} /> : <Star size={14} />}
                disabled={focusBusy || !focusAction.is_available}
                onClick={() => toggleFocus(!onFocus)}
              >
                {onFocus ? t('repo.focus.remove') : t('repo.focus.add')}
              </Button>
            </Tooltip>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto better-scroll px-4 py-3 flex flex-col gap-4">
        {/* Baton status */}
        <div className="flex items-center gap-2 text-sm text-subtle">
          <Clock size={14} className="shrink-0" />
          {t('repo.detail.inStatusFor', { days: detail.days_in_status })}
          <span className="text-subtler">·</span>
          {t('repo.detail.attempts', { count: detail.attempt_count })}
        </div>

        {/* Customer */}
        <div className="rounded-md border border-line bg-surface px-3 py-3 flex flex-col gap-2">
          <div className="flex items-center gap-2 text-sm">
            <User size={14} className="text-subtle shrink-0" />
            <span className="font-medium truncate">{detail.customer_name ?? '—'}</span>
            {detail.customer_tel && (
              <a href={`tel:${detail.customer_tel}`} className="inline-flex items-center gap-1 text-xs text-primary-fg hover:underline shrink-0 tabular-nums">
                <Phone size={11} />{formatTel(detail.customer_tel)}
              </a>
            )}
          </div>
          {detail.device_code_display && (
            <div className="flex items-start gap-2 text-sm">
              <Smartphone size={14} className="text-subtle shrink-0 mt-0.5" />
              <div className="min-w-0">
                {detail.product_display_name && <div className="text-sm">{detail.product_display_name}</div>}
                <DeviceLink deviceId={deviceId} code={detail.device_code_display} product={null} />
                {detail.device_serial && <div className="text-xs text-subtle font-mono">{detail.device_serial}</div>}
              </div>
            </div>
          )}
          {/* Loaner — prominent on the repo screen: the crew must collect it too */}
          {detail.has_loaner && (
            <div className="flex items-start gap-2 text-sm rounded-md bg-danger-soft border border-danger-border px-2.5 py-2">
              <Repeat size={14} className="text-danger-fg shrink-0 mt-0.5" />
              <div className="min-w-0">
                <div className="text-xs font-medium text-danger-fg">{t('callCenter.loanerToCollect')}</div>
                {detail.loaner_product_display_name && <div className="text-sm">{detail.loaner_product_display_name}</div>}
                <DeviceLink deviceId={detail.loaner_device_id} code={detail.loaner_code_display} product={null} />
              </div>
            </div>
          )}
          <div className="flex items-start gap-2 text-sm">
            <GeoPin precision={detail.geo_precision} />
            <div className="min-w-0 text-subtle text-xs">{detail.address_display ?? t('repo.detail.noAddress')}</div>
          </div>
          {detail.geo_precision === 'CENTROID' && (
            <div className="text-[11px] text-warning-fg flex items-center gap-1">
              <AlertTriangle size={12} />{t('repo.geo.centroidWarn')}
            </div>
          )}

          {/* The two sheets live here, not in the footer: they describe THIS
              device and address, and they are printed while looking at them,
              before setting off — not at the end of the job. */}
          {printActions.length > 0 && (
            <div className="pt-2 mt-1 border-t border-line flex flex-wrap gap-2">
              {printActions.map((a) => (
                <Tooltip
                  key={a.action_code}
                  content={a.is_available
                    ? t(`repo.action.${a.action_code}`)
                    : unavailableReason(a.action_code, t)}
                  placement="top"
                >
                  <Button
                    variant="outline"
                    size="sm"
                    startIcon={ACTION_ICON[a.action_code]}
                    disabled={!a.is_available}
                    onAuxClick={(e) => {
                      // middle click
                      if (e.button === 1) { e.preventDefault(); openPrint(a.action_code, true); }
                    }}
                    onClick={(e) => openPrint(a.action_code, e.ctrlKey || e.metaKey)}
                  >
                    {t(`repo.action.${a.action_code}`, { defaultValue: a.action_code })}
                  </Button>
                </Tooltip>
              ))}
            </div>
          )}
        </div>

        {/* Last action */}
        <div className="rounded-md border border-line bg-surface px-3 py-3 text-sm">
          <div className="text-xs text-subtle mb-1">{t('repo.detail.lastAction')}</div>
          {detail.never_actioned ? (
            <div className="text-subtler">{t('repo.detail.neverActioned')}</div>
          ) : (
            <div className="flex flex-col gap-0.5">
              <div className="flex items-center gap-2">
                <ClipboardList size={13} className="text-subtle shrink-0" />
                <span>{detail.last_action_result ? t(`repo.result.${detail.last_action_result}`, { defaultValue: detail.last_action_result }) : '—'}</span>
              </div>
              <div className="text-xs text-subtle pl-5">
                {detail.last_action_at && <DateTime value={detail.last_action_at} showTime />}
                {detail.last_action_by_username && <> · {detail.last_action_by_username}</>}
              </div>
            </div>
          )}
          {detail.note && (
            <div className="mt-2 pt-2 border-t border-line text-xs text-subtle whitespace-pre-wrap">{detail.note}</div>
          )}
        </div>
      </div>

      {/* Actions.
          One primary button for the job this screen exists for; everything else
          behind a menu so it can't compete with it. Every action the backend
          returns is listed there — disabled with its reason, never hidden. */}
      {(primaryAction || moreActions.length > 0) && (
        <div className="flex-none border-t border-line px-4 py-3 flex items-center gap-2">
          {primaryAction && (
            <Tooltip
              content={primaryAction.is_available
                ? t('repo.action.REPO_LOG_ATTEMPT')
                : unavailableReason(primaryAction.action_code, t)}
              placement="top"
            >
              <Button
                variant="primary"
                size="sm"
                startIcon={<ClipboardList size={14} />}
                disabled={!primaryAction.is_available}
                onClick={() => runAction(primaryAction)}
              >
                {t('repo.action.REPO_LOG_ATTEMPT')}
              </Button>
            </Tooltip>
          )}

          {moreActions.length > 0 && (
            <div ref={moreTriggerRef} className="ml-auto">
              <Button
                variant="outline"
                size="sm"
                endIcon={<ChevronDown size={14} />}
                onClick={() => setMoreOpen((v) => !v)}
              >
                {t('repo.action.more')}
              </Button>
            </div>
          )}
        </div>
      )}

      <PopOver
        isOpen={moreOpen}
        onClose={() => setMoreOpen(false)}
        triggerRef={moreTriggerRef}
        placement="top"
        align="end"
        maxWidth="22rem"
      >
        <div className="flex flex-col p-1.5">
          {moreActions.map((a) => {
            const wired = INLINE_OR_DEDICATED.has(a.action_code) || !!NOTE_ACTIONS[a.action_code];
            const isSetTarget = a.action_code === 'REPO_SET_TARGET'; // no address picker yet
            const disabled = !a.is_available || !wired || isSetTarget;
            const reason = isSetTarget
              ? t('repo.action.setTargetDeferred')
              : !a.is_available
                ? unavailableReason(a.action_code, t)
                : !wired
                  ? t('repo.action.notWiredHere')
                  : null;
            return (
              <button
                key={a.action_code}
                type="button"
                disabled={disabled}
                onClick={() => { setMoreOpen(false); runAction(a); }}
                className="text-left px-2.5 py-2 rounded-md flex items-start gap-2.5 bg-transparent border-none cursor-pointer hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent"
              >
                <span className="shrink-0 mt-0.5 text-subtle">
                  {ACTION_ICON[a.action_code] ?? <ClipboardList size={14} />}
                </span>
                <span className="min-w-0 flex flex-col gap-0.5">
                  <span className={`text-sm ${ACTION_COLOR[a.action_code] === 'danger' || a.action_code === 'REPO_GIVE_UP' ? 'text-warning-fg' : ''}`}>
                    {t(`repo.action.${a.action_code}`, { defaultValue: a.action_code })}
                  </span>
                  {reason && <span className="text-xs text-subtle">{reason}</span>}
                </span>
              </button>
            );
          })}
        </div>
      </PopOver>

      <RepoLogAttemptModal
        open={logOpen}
        contractId={contractId}
        contractCode={contractCode}
        onClose={() => setLogOpen(false)}
        onSuccess={refresh}
      />
      <RepoGiveUpModal
        open={giveUpOpen}
        contractId={contractId}
        contractCode={contractCode}
        onClose={() => setGiveUpOpen(false)}
        onSuccess={refresh}
      />
      <RepoNoteActionModal
        open={!!noteAction}
        config={noteAction}
        contractId={contractId}
        contractCode={contractCode}
        onClose={() => setNoteAction(null)}
        onSuccess={refresh}
      />
      <RepoPrintModal
        open={!!printDoc}
        doc={printDoc ?? 'authority'}
        contractId={contractId}
        contractCode={contractCode}
        onClose={() => setPrintDoc(null)}
      />
      <RepoIcloudRevealModal
        open={icloudOpen}
        contractId={contractId}
        contractCode={contractCode}
        deviceCode={detail.device_code_display}
        onClose={() => setIcloudOpen(false)}
        onFocusChanged={refresh}
      />
    </div>
  );
}
