import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Badge, Tooltip, useSnackbarContext } from 'tsp-form';
import {
  User, Phone, Smartphone, MapPin, Loader2, ClipboardList, Scale,
  Star, StarOff, CheckCircle, Clock, AlertTriangle,
} from 'lucide-react';
import { DateTime } from '../../components/DateTime';
import { apiClient } from '../../lib/api';
import { formatTel, fmtCurrency } from '../../lib/format';
import {
  fetchContractRepo, fetchRepoActions,
  type RepoAction, type RepoActionCode, type GeoPrecision,
} from './repoApi';
import { RepoLogAttemptModal } from './RepoLogAttemptModal';
import { RepoGiveUpModal } from './RepoGiveUpModal';
import { RepoNoteActionModal, type NoteActionConfig } from './RepoNoteActionModal';

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
]);

const ACTION_COLOR: Partial<Record<RepoActionCode, 'primary' | 'warning' | 'danger'>> = {
  REPO_LOG_ATTEMPT: 'primary',
  REPO_GIVE_UP: 'warning',
  LEGAL_FINISH: 'primary',
};

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

export function RepoDetailPanel({ contractId, isMobile, onChanged }: {
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

  const [logOpen, setLogOpen] = useState(false);
  const [giveUpOpen, setGiveUpOpen] = useState(false);
  const [noteAction, setNoteAction] = useState<NoteActionConfig | null>(null);
  const [focusBusy, setFocusBusy] = useState(false);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['repo', 'detail', contractId] });
    queryClient.invalidateQueries({ queryKey: ['repo', 'actions', contractId] });
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

  const runAction = (a: RepoAction) => {
    if (!a.is_available) return;
    switch (a.action_code) {
      case 'REPO_LOG_ATTEMPT': setLogOpen(true); break;
      case 'REPO_GIVE_UP': setGiveUpOpen(true); break;
      case 'REPO_FOCUS_ADD': toggleFocus(true); break;
      case 'REPO_FOCUS_REMOVE': toggleFocus(false); break;
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
  const footerActions = actions
    .filter((a) => a.is_permitted)
    .filter((a) => a.action_code !== 'REPO_FOCUS_ADD' && a.action_code !== 'REPO_FOCUS_REMOVE'); // focus is its own header control

  const focusAction = actions.find((a) => (a.action_code === 'REPO_FOCUS_ADD' || a.action_code === 'REPO_FOCUS_REMOVE') && a.is_permitted && a.is_available);
  const onFocus = detail.on_focus;

  const statusColor = detail.dunning_status === 'WAIT_FOR_LEGAL' ? 'warning'
    : detail.dunning_status === 'REPO_COMPLETED' || detail.dunning_status === 'LEGAL_COMPLETED' ? 'success'
    : 'danger';

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* Header */}
      <div className="flex-none flex items-center h-panel-header-h px-4 border-b border-line gap-2">
        <span className="font-mono text-sm font-medium truncate">{contractCode}</span>
        <Badge color={statusColor} size="sm">{t(`repo.status.${detail.dunning_status}`, { defaultValue: detail.dunning_status })}</Badge>
        <div className="ml-auto flex items-center gap-2">
          {focusAction && (
            <Button
              variant="outline"
              size="sm"
              startIcon={focusBusy ? <Loader2 size={14} className="animate-spin" /> : onFocus ? <StarOff size={14} /> : <Star size={14} />}
              disabled={focusBusy}
              onClick={() => toggleFocus(!onFocus)}
            >
              {onFocus ? t('repo.focus.remove') : t('repo.focus.add')}
            </Button>
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
                <div className="font-mono text-xs">{detail.device_code_display}</div>
                {detail.device_serial && <div className="text-xs text-subtle font-mono">{detail.device_serial}</div>}
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

      {/* Action footer */}
      {footerActions.length > 0 && (
        <div className="flex-none border-t border-line px-4 py-3 flex flex-wrap gap-2">
          {footerActions.map((a) => {
            const wired = INLINE_OR_DEDICATED.has(a.action_code) || !!NOTE_ACTIONS[a.action_code];
            const isSetTarget = a.action_code === 'REPO_SET_TARGET'; // deferred in MVP
            const disabled = !a.is_available || !wired || isSetTarget;
            const lines: string[] = [t(a.action_code, { ns: 'contractActions', defaultValue: t(`repo.action.${a.action_code}`, { defaultValue: a.action_code }) })];
            if (isSetTarget) lines.push(t('repo.action.setTargetDeferred'));
            else if (!a.is_available) lines.push(t('repo.action.notAvailableNow'));
            const tip = lines.length === 1 ? lines[0] : (
              <div className="flex flex-col gap-0.5">{lines.map((l, i) => <div key={i} className={i === 0 ? 'font-medium' : 'text-xs opacity-90'}>{l}</div>)}</div>
            );
            return (
              <Tooltip key={a.action_code} content={tip} placement="top">
                <Button
                  variant={a.action_code === 'REPO_LOG_ATTEMPT' ? undefined : 'outline'}
                  size="sm"
                  color={ACTION_COLOR[a.action_code]}
                  disabled={disabled}
                  startIcon={a.action_code === 'REPO_GIVE_UP' ? <Scale size={14} /> : undefined}
                  onClick={() => runAction(a)}
                >
                  {t(`repo.action.${a.action_code}`, { defaultValue: a.action_code })}
                </Button>
              </Tooltip>
            );
          })}
        </div>
      )}

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
    </div>
  );
}
