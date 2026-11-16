// The card of one job in the repo yard: everything the repo team needs to decide on it
// (UI_SUMMARY 168 §3) from the yard row itself, then the actions fn_repo_available_actions
// allows. The common ones run here (pick up / put down, log a visit, note, send back to the
// collectors, give up to legal) plus the field-find buttons; the rest (location window,
// prints, handover) live on the job's detail page, one link away.

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Tooltip, useSnackbarContext } from 'tsp-form';
import { ClipboardList, ExternalLink, MapPin, Phone, Scale, Smartphone, Star, StarOff, Undo2, User, PenLine, X } from 'lucide-react';
import { apiClient } from '../../../lib/api';
import { translateApiError } from '../../../lib/apiErrors';
import { fmtCurrency, formatTel } from '../../../lib/format';
import { DateTime } from '../../../components/DateTime';
import { DetailLine, DetailSection } from '../../../components/DetailLine';
import { fetchRepoActions, invalidateRepoQueries, type RepoAction, type RepoActionCode } from '../repoApi';
import { RepoLogAttemptModal } from '../RepoLogAttemptModal';
import { RepoGiveUpModal } from '../RepoGiveUpModal';
import { RepoNoteActionModal, type NoteActionConfig } from '../RepoNoteActionModal';
import { NOTE_ACTIONS, RETURN_TO_COLLECTOR } from '../repoNoteActions';
import type { YardJob } from './yardApi';
import { FieldFindPanel } from '../../../components/fieldFind/FieldFindPanel';
import { useMyPermissions } from '../../../hooks/useMyPermissions';

export function YardCard({ job: j, gone }: { job: YardJob; gone: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { addSnackbar } = useSnackbarContext();
  const { data: actions = [] } = useQuery({
    queryKey: ['repo', 'actions', j.contract_id],
    queryFn: () => fetchRepoActions(j.contract_id),
    staleTime: 15_000,
    enabled: !gone,
  });
  const [logOpen, setLogOpen] = useState(false);
  const [giveUpOpen, setGiveUpOpen] = useState(false);
  const [noteAction, setNoteAction] = useState<NoteActionConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const mayFieldFind = useMyPermissions().hasPermission('MDM.FIELD_FIND');

  const refresh = () => invalidateRepoQueries(qc);
  const act = (code: RepoActionCode) => actions.find((a: RepoAction) => a.action_code === code && a.is_permitted) ?? null;
  const toggleFocus = async (add: boolean) => {
    setBusy(true);
    try {
      await apiClient.rpc(add ? 'ops_repo_focus_add' : 'ops_repo_focus_remove', { p_contract_id: j.contract_id });
      refresh();
    } catch (err) {
      addSnackbar({ message: <div className="alert alert-danger"><X size={16} /><span>{translateApiError(err, t)}</span></div>, type: 'error', duration: 4000 });
    } finally {
      setBusy(false);
    }
  };

  const focus = act(j.picked_by_me ? 'REPO_FOCUS_REMOVE' : 'REPO_FOCUS_ADD');
  const log = act('REPO_LOG_ATTEMPT');
  const note = act('REPO_ADD_NOTE');
  const sendBack = act('REPO_REVERT_ACTIVE');
  const giveUp = act('REPO_GIVE_UP');
  const actionButton = (a: RepoAction | null, node: (disabled: boolean) => React.ReactNode) => a && (
    a.is_available ? node(false) : <Tooltip content={t('repo.action.notAvailableNow')}><span>{node(true)}</span></Tooltip>
  );

  return (
    <div className="flex flex-col gap-3" data-testid="yard-card">
      {gone && <div className="alert alert-info"><span className="alert-description">{t('repoYard.gone')}</span></div>}

      <DetailSection icon={<ClipboardList size={14} />} title={t('repoYard.card.job')}>
        <DetailLine label={t('repoYard.card.shop')}><span className="font-medium">{j.branch_name}</span><span className="text-xs text-subtle">{j.company_name}</span></DetailLine>
        <DetailLine label={t('repoYard.card.inQueue')}><span>{t('repoYard.inQueueDays', { n: j.wait_days })}</span><span className="text-xs text-subtle"><DateTime value={j.queued_at} /></span></DetailLine>
        <DetailLine label={t('repoYard.card.sentBy')}>
          {j.sent_kind === 'SYSTEM'
            ? <span className="text-subtle">{t('repoYard.sentBySystem')}</span>
            : <span className="flex flex-col gap-0.5 min-w-0"><span className="font-medium">{j.sent_by_username ?? '—'}</span>{j.reason && <span className="whitespace-pre-wrap break-words">{j.reason}</span>}</span>}
        </DetailLine>
        <DetailLine label={t('repoYard.card.pickedBy')}>
          {j.pickers.length
            ? <span className="flex flex-col gap-0.5">{j.pickers.map(p => <span key={p.user_id}>{p.username} <span className="text-xs text-subtle"><DateTime value={p.picked_at} /></span></span>)}</span>
            : <span className="text-danger-fg font-medium">{t('repoYard.nobodyPicked')}</span>}
        </DetailLine>
        <DetailLine label={t('repoYard.card.attempts')}>
          <span>{t('repoYard.attemptsN', { n: j.attempt_count })}</span>
          {j.last_action_result && <span className="text-xs text-subtle">{t(`repo.result.${j.last_action_result}`, { defaultValue: j.last_action_result })}{j.last_action_at && <> · <DateTime value={j.last_action_at} /></>}</span>}
        </DetailLine>
        {j.repo_note && <DetailLine label={t('repoYard.card.note')}><span className="whitespace-pre-wrap text-subtle">{j.repo_note}</span></DetailLine>}
      </DetailSection>

      <DetailSection icon={<User size={14} />} title={t('repoYard.card.customer')}>
        <DetailLine label={t('repoYard.card.name')}><span className="font-medium">{j.customer_name ?? '—'}</span></DetailLine>
        {j.customer_tel && (
          <DetailLine label={t('repoYard.card.phone')}>
            <Button size="sm" variant="outline" startIcon={<Phone size={14} />} onClick={() => { window.location.href = `tel:${j.customer_tel!.replace(/\D/g, '')}`; }}>{formatTel(j.customer_tel)}</Button>
          </DetailLine>
        )}
        <DetailLine label={t('repoYard.card.area')}><span>{[j.district, j.province].filter(Boolean).join(' · ') || '—'}</span></DetailLine>
        <DetailLine label={t('repoYard.card.overdue')}><span>{t('repoYard.overdueDays', { n: j.overdue_days })}</span><span className="text-xs text-subtle">{t('repoYard.outstanding', { amount: fmtCurrency(j.outstanding) })}</span></DetailLine>
      </DetailSection>

      <DetailSection icon={<Smartphone size={14} />} title={t('repoYard.card.device')}>
        <DetailLine label={t('repoYard.card.product')}>
          <span className="flex flex-col gap-0.5 min-w-0">
            <span className="font-medium">{j.product_display_name ?? '—'}</span>
            {(j.asset_code_display || j.serial_no) && <span className="text-xs text-subtle font-mono">{[j.asset_code_display, j.serial_no].filter(Boolean).join(' · ')}</span>}
          </span>
          {j.is_loaner && <Badge size="xs" color="warning">{t('repoYard.loaner')}</Badge>}
        </DetailLine>
        <DetailLine label="MDM">
          {!j.has_mdm
            ? <span className="text-subtle">{t('repoYard.noMdm')}</span>
            : <span className="flex flex-col gap-0.5">
                <span>{t('repoYard.lastSeen')} {j.mdm_last_seen_at ? <DateTime value={j.mdm_last_seen_at} /> : t('repoYard.unknown')}</span>
                {(j.lost_mode_active || j.battery_percent != null) && <span className="text-xs text-subtle">{[j.lost_mode_active ? t('repoYard.lostModeOn') : '', j.battery_percent != null ? t('repoYard.battery', { n: j.battery_percent }) : ''].filter(Boolean).join(' · ')}</span>}
              </span>}
        </DetailLine>
        <DetailLine label={t('repoYard.card.location')}>
          {j.fix_count > 0
            ? <span className="inline-flex items-center gap-1"><MapPin size={13} className="text-success-fg" />{t('repoYard.fixes', { n: j.fix_count })} · {t('repoYard.lastFix')} <DateTime value={j.last_fix_at} /></span>
            : <span className="text-subtle">{t('repoYard.noFix')}</span>}
        </DetailLine>
      </DetailSection>

      {/* Field find — make the device show itself at the door (IMPLEMENT 2026-11-16 field_find_buttons_477). */}
      {!gone && mayFieldFind && j.has_mdm && <FieldFindPanel target={{ contractId: j.contract_id }} />}

      {/* Actions — only what fn_repo_available_actions permits; unavailable ones stay, greyed. */}
      {!gone && (
        <div className="flex flex-wrap gap-2 pt-1 border-t border-line">
          {actionButton(log, (d) => <Button size="sm" color="primary" startIcon={<ClipboardList size={14} />} disabled={d} onClick={() => setLogOpen(true)}>{t('repo.action.REPO_LOG_ATTEMPT')}</Button>)}
          {actionButton(focus, (d) => (
            <Button size="sm" variant="outline" disabled={d || busy} startIcon={j.picked_by_me ? <StarOff size={14} /> : <Star size={14} />} onClick={() => toggleFocus(!j.picked_by_me)}>
              {j.picked_by_me ? t('repoYard.putDown') : t('repoYard.pickUp')}
            </Button>
          ))}
          {actionButton(note, (d) => <Button size="sm" variant="outline" startIcon={<PenLine size={14} />} disabled={d} onClick={() => setNoteAction(NOTE_ACTIONS.REPO_ADD_NOTE ?? null)}>{t('repo.action.REPO_ADD_NOTE')}</Button>)}
          {actionButton(sendBack, (d) => <Button size="sm" variant="outline" startIcon={<Undo2 size={14} />} disabled={d} onClick={() => setNoteAction(RETURN_TO_COLLECTOR)}>{t('repoYard.sendBack')}</Button>)}
          {actionButton(giveUp, (d) => <Button size="sm" variant="outline" startIcon={<Scale size={14} />} disabled={d} onClick={() => setGiveUpOpen(true)}>{t('repo.action.REPO_GIVE_UP')}</Button>)}
          <Link to={`/admin/repo/pool/${j.contract_id}`} className="text-sm text-primary-fg hover:underline inline-flex items-center gap-1 self-center ml-auto">
            {t('repoYard.openDetail')}<ExternalLink size={12} />
          </Link>
        </div>
      )}

      <RepoLogAttemptModal open={logOpen} contractId={j.contract_id} contractCode={j.code_display} onClose={() => setLogOpen(false)} onSuccess={refresh} />
      <RepoGiveUpModal open={giveUpOpen} contractId={j.contract_id} contractCode={j.code_display} onClose={() => setGiveUpOpen(false)} onSuccess={refresh} />
      <RepoNoteActionModal open={!!noteAction} config={noteAction} contractId={j.contract_id} contractCode={j.code_display} onClose={() => setNoteAction(null)} onSuccess={refresh} />
    </div>
  );
}
