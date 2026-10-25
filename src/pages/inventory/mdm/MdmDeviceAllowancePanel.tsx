// ============================================================================
// "อนุญาตเฉพาะเครื่องนี้" — per-device permanent allowances.
// IMPLEMENT 2026-10-06 app_removal_min_paid_installments §0.2, §7-§9 ·
// DELIVERY 2026-10-07 device_allowance_rpcs (nnf-mdm mig 348) ·
// IMPLEMENT 2026-10-25 mdm_vpn_allowance_378 — the panel now carries more than
// app removal (VPN, Find My, iCloud menu), so its title and grant wording are
// generic; the "unlike the timed option above" sentence is app removal's only.
//
// Placement (§0.2, owner 2026-10-07): sub-tab 5, directly under the temporary
// "ให้ลูกค้าลบแอปเอง" panel. Same subject, different lifetime — seeing both lets
// staff pick "for 30 minutes" vs "for good". ⛔ Never sub-tab 7 (that corner is
// destructive/legal).
//
// Everything renders from fn_mdm_device_allowance_status:
//   • one block per allowance row the RPC returns — no code is hard-coded;
//   • `can_set=false` hides that allowance's buttons (that's how FINDMY_APP,
//     engineering-only, stays unpressable — §7);
//   • `state_code` picks the wording and the button. ON_BY_RULE has NO revoke
//     button: the right comes from the company rule, there is no row to delete,
//     and the next evaluation would grant it back — the button would look broken
//     (§8). Point to Company → MDM instead;
//   • a granted row that the rule ALSO covers keeps its revoke button but warns
//     that revoking won't close it;
//   • rule_threshold 100 = rule off → never print the threshold.
//
// Setting is async like every MDM act: the reconciler swaps the device's profile
// within ~1 minute, and only once the device is online. WAITING_DEVICE means
// "set in our records, not on the handset yet" — poll every 20s until it moves.
//
// Vocabulary (§0.1): "อนุญาต", never "ปลดล็อก"; no "ธง"/profile/gate on screen.
// description_th is engineering text (mig numbers, profile names) — not shown.
// ============================================================================

import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Modal, TextArea, FormErrorMessage } from 'tsp-form';
import { Unlock, Lock, Loader2, ExternalLink, AlertTriangle, History } from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import { ApiError } from '../../../lib/api';
import { DateTime } from '../../../components/DateTime';
import { ModalErrorBand } from '../../../components/ModalErrorBand';
import { ActionDoneView } from '../../contracts/ActionDoneView';
import { MDM_NO_CACHE } from './useMdmStatus';
import {
  fetchDeviceAllowanceStatus, setDeviceAllowance, parseMdmError,
  type MdmDeviceAllowance, type MdmDeviceAllowanceStatus,
} from './mdmApi';

/** WAITING_DEVICE → ON_DEVICE needs the handset to check in. */
const WAIT_POLL_MS = 20_000;
/** The company rule is "off" at this value (IMPLEMENT §1-§3). */
const RULE_OFF = 100;

function ruleCount(a: MdmDeviceAllowance): number | null {
  return a.rule_threshold != null && a.rule_threshold !== RULE_OFF ? a.rule_threshold : null;
}

type SetTarget = { allowance: MdmDeviceAllowance; allowed: boolean };

export function MdmDeviceAllowancePanel({
  serial,
  onChanged,
}: {
  serial: string | null;
  /** Re-read the surrounding screen — the device's profile changes. */
  onChanged: () => void;
}) {
  const { can } = useAuth();
  // Read is MDM.APP_CONTROL, same as the temporary panel above. Split so the
  // early return doesn't sit above hooks.
  if (!can('MDM.APP_CONTROL') || !serial) return null;
  return <AllowancePanelBody serial={serial} onChanged={onChanged} />;
}

function AllowancePanelBody({ serial, onChanged }: { serial: string; onChanged: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const queryKey = ['mdm-device-allowance-status', serial];

  const { data, isLoading, isError, error } = useQuery<MdmDeviceAllowanceStatus>({
    queryKey,
    queryFn: () => fetchDeviceAllowanceStatus(serial),
    ...MDM_NO_CACHE,
    // Keep polling while any allowance is set but not yet on the handset.
    refetchInterval: (q) =>
      q.state.data?.allowances.some((a) => a.state_code === 'WAITING_DEVICE') ? WAIT_POLL_MS : false,
  });
  const reload = () => qc.invalidateQueries({ queryKey });

  const [target, setTarget] = useState<SetTarget | null>(null);

  if (isError) {
    return (
      <div className="border border-line rounded-md px-3 py-2.5 flex items-center gap-2 text-sm">
        <span className="text-subtle">{t('asset.mdm.allowance.title')}</span>
        <span className="text-danger-fg text-xs min-w-0">
          {error instanceof ApiError && error.isAuthError ? t('auth.sessionExpired') : parseMdmError(error, t).message}
        </span>
        <Button variant="outline" size="sm" className="ml-auto" onClick={reload}>{t('common.retry')}</Button>
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div className="border border-line rounded-md px-3 py-2.5 flex items-center gap-2 text-sm text-subtle">
        <Loader2 size={14} className="animate-spin" />
        {t('asset.mdm.allowance.title')}
      </div>
    );
  }

  // Unknown serial comes back ok with no rows (seen live) — nothing to show.
  if (data.allowances.length === 0) return null;

  const labelOf = (code: string) =>
    data.allowances.find((a) => a.allowance_code === code)?.label_th ?? code;
  // Branch staff see every row but can set none — say who can, instead of rows
  // that silently have no button. Not per row: an admin also gets can_set=false
  // on the engineering-only rows, and "ask your company admin" would be wrong there.
  const noneSettable = !data.allowances.some((a) => a.can_set);

  return (
    <div className="border border-line rounded-md px-3 py-2.5 flex flex-col gap-2.5">
      <span className="text-sm font-medium">{t('asset.mdm.allowance.title')}</span>

      {data.allowances.map((a) => (
        <AllowanceRow
          key={a.allowance_code}
          a={a}
          onSet={(allowed) => setTarget({ allowance: a, allowed })}
        />
      ))}

      {noneSettable && (
        <div className="text-xs text-subtle">{t('asset.mdm.allowance.askCompanyAdmin')}</div>
      )}

      {data.log.length > 0 && <AllowanceLog log={data.log} labelOf={labelOf} />}

      <SetAllowanceModal
        target={target}
        serial={serial}
        onClose={() => setTarget(null)}
        onDone={() => { reload(); onChanged(); }}
      />
    </div>
  );
}

// ── One allowance ────────────────────────────────────────────────────────────

function AllowanceRow({
  a, onSet,
}: {
  a: MdmDeviceAllowance;
  onSet: (allowed: boolean) => void;
}) {
  const { t } = useTranslation();
  const n = ruleCount(a);
  const state = a.state_code.toUpperCase();

  // By-rule only (no person set it): no revoke, point to where it's changed.
  const byRuleOnly = state === 'ON_BY_RULE' && !a.granted;
  const showGrant = a.can_set && !a.granted && !byRuleOnly;
  const showRevoke = a.can_set && a.granted;

  let headline: string;
  switch (state) {
    case 'ON_DEVICE': headline = t('asset.mdm.allowance.state.onDevice'); break;
    case 'WAITING_DEVICE': headline = t('asset.mdm.allowance.state.onDevice'); break;
    case 'ON_BY_RULE': headline = n != null
      ? t('asset.mdm.allowance.state.byRuleCount', { count: n })
      : t('asset.mdm.allowance.state.byRule'); break;
    case 'ESCALATED': headline = t('asset.mdm.allowance.state.escalated'); break;
    case 'NO_ORG_LOCK': headline = t('asset.mdm.allowance.state.noOrgLock'); break;
    case 'NOT_GRANTED': headline = t('asset.mdm.allowance.state.notGranted'); break;
    default: headline = a.granted ? t('asset.mdm.allowance.state.onDevice') : t('asset.mdm.allowance.state.notGranted');
  }
  const isOn = state === 'ON_DEVICE' || state === 'WAITING_DEVICE' || state === 'ON_BY_RULE';

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="text-sm flex items-start gap-1.5 min-w-0 flex-1">
          {isOn
            ? <Unlock size={14} className="text-warning-fg shrink-0 mt-0.5" />
            : <Lock size={14} className="text-subtle shrink-0 mt-0.5" />}
          {/* The panel title is generic, so every row names what it allows. */}
          <div className="flex flex-col min-w-0">
            <span className="font-medium">{a.label_th}</span>
            <span className="text-subtle">{headline}</span>
          </div>
        </div>

        {(showGrant || showRevoke) && (
          <div className="ml-auto">
            {showGrant ? (
              <Button size="sm" variant="outline" startIcon={<Unlock size={14} />} onClick={() => onSet(true)}>
                {t('asset.mdm.allowance.grant')}
              </Button>
            ) : (
              <Button size="sm" variant="outline" startIcon={<Lock size={14} />} onClick={() => onSet(false)}>
                {t('asset.mdm.allowance.revoke')}
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Who set it, why, when — only when a person did. */}
      {a.granted && (a.reason || a.set_by_username || a.set_at) && (
        <div className="text-xs text-subtle">
          {a.reason && <>{t('asset.mdm.allowance.reasonLabel')}: {a.reason}</>}
          {a.set_by_username && <>{a.reason && ' · '}{t('asset.mdm.allowance.setBy', { name: a.set_by_username })}</>}
          {a.set_at && <>{(a.reason || a.set_by_username) && ' · '}<DateTime value={a.set_at} showTime /></>}
        </div>
      )}

      {state === 'WAITING_DEVICE' && (
        <div className="text-xs text-subtle inline-flex items-center gap-1">
          <Loader2 size={12} className="animate-spin shrink-0" />
          {t('asset.mdm.allowance.waitingDevice')}
        </div>
      )}

      {state === 'ESCALATED' && (
        <div className="text-xs text-subtle">{t('asset.mdm.allowance.escalatedNote')}</div>
      )}

      {/* §8: person-set AND rule-granted — revoking won't close it. */}
      {a.granted && a.rule_says_yes && (
        <div className="alert alert-warning">
          <AlertTriangle size={16} className="shrink-0" />
          <div className="alert-description text-xs">
            {n != null
              ? t('asset.mdm.allowance.ruleAlsoCount', { count: n })
              : t('asset.mdm.allowance.ruleAlso')}
          </div>
        </div>
      )}

      {/* §8: from the rule only — no revoke here. */}
      {byRuleOnly && (
        <div className="text-xs text-subtle">
          {n != null
            ? t('asset.mdm.allowance.byRuleNoRevokeCount', { count: n })
            : t('asset.mdm.allowance.byRuleNoRevoke')}{' '}
          <Link
            to="/admin/company/config"
            className="text-primary-fg hover:underline inline-flex items-center gap-1"
          >
            {t('asset.mdm.allowance.companyMdm')}
            <ExternalLink size={12} />
          </Link>
        </div>
      )}
    </div>
  );
}

// ── History ──────────────────────────────────────────────────────────────────

const LOG_PREVIEW = 3;

function AllowanceLog({
  log, labelOf,
}: {
  log: MdmDeviceAllowanceStatus['log'];
  labelOf: (code: string) => string;
}) {
  const { t } = useTranslation();
  const [all, setAll] = useState(false);
  const rows = all ? log : log.slice(0, LOG_PREVIEW);
  const multiCode = new Set(log.map((l) => l.allowance_code)).size > 1;

  return (
    <div className="flex flex-col gap-1 border-t border-line pt-2">
      <span className="text-xs font-medium text-subtle inline-flex items-center gap-1">
        <History size={12} />{t('asset.mdm.allowance.history')}
      </span>
      <ul className="flex flex-col gap-1">
        {rows.map((l, i) => (
          <li key={`${l.created_at}-${i}`} className="text-xs text-subtle">
            <DateTime value={l.created_at} showTime />
            {' · '}
            <span className="text-fg">
              {l.action.toUpperCase() === 'GRANT'
                ? t('asset.mdm.allowance.logGrant')
                : l.action.toUpperCase() === 'REVOKE'
                  ? t('asset.mdm.allowance.logRevoke')
                  : l.action}
            </span>
            {multiCode && <> ({labelOf(l.allowance_code)})</>}
            {l.actor_username && <> · {l.actor_username}</>}
            {l.reason && <> · {l.reason}</>}
          </li>
        ))}
      </ul>
      {log.length > LOG_PREVIEW && (
        <div>
          <Button size="sm" variant="ghost" onClick={() => setAll((v) => !v)}>
            {all ? t('asset.mdm.allowance.historyLess') : t('asset.mdm.allowance.historyAll', { count: log.length })}
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Grant / revoke modal ─────────────────────────────────────────────────────

function SetAllowanceModal({
  target: targetProp, serial, onClose, onDone,
}: {
  /** null = closed. The Modal itself stays mounted. */
  target: SetTarget | null;
  serial: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const actorId = user?.user_id ?? null;
  const open = targetProp !== null;
  // Keep the last target through the close transition — the parent nulls it in
  // the same handler that closes, which would flip the title mid-fade.
  const lastTarget = useRef(targetProp);
  if (targetProp) lastTarget.current = targetProp;
  const target = targetProp ?? lastTarget.current;

  const [view, setView] = useState<'form' | 'done'>('form');
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  /** Frozen at submit so the done view doesn't change if the target clears. */
  const [doneFor, setDoneFor] = useState<SetTarget | null>(null);

  useEffect(() => {
    if (open) {
      setView('form'); setReason(''); setTouched(false);
      setSubmitting(false); setError(null); setConfirmClose(false); setDoneFor(null);
    }
  }, [open, targetProp?.allowance.allowance_code, targetProp?.allowed]);

  const allowed = target?.allowed ?? true;
  const a = target?.allowance ?? null;
  const n = a ? ruleCount(a) : null;
  const reasonMissing = reason.trim() === '';
  const isDirty = reason !== '';

  const forceClose = () => { setConfirmClose(false); onClose(); };
  const handleClose = () => {
    if (submitting) return;
    if (view === 'done') { forceClose(); return; }
    if (isDirty) { setConfirmClose(true); return; }
    forceClose();
  };

  const submit = async () => {
    setTouched(true);
    if (!target || reasonMissing || actorId == null) return;
    setSubmitting(true); setError(null);
    try {
      await setDeviceAllowance({
        serial,
        actorId,
        code: target.allowance.allowance_code,
        allowed: target.allowed,
        reason: reason.trim(),
      });
      setDoneFor(target);
      setView('done');
      onDone();
    } catch (e) {
      setError(parseMdmError(e, t).message);
    } finally {
      setSubmitting(false);
    }
  };

  const doneA = doneFor?.allowance ?? null;
  const doneN = doneA ? ruleCount(doneA) : null;

  return (
    <>
      <Modal open={open} onClose={handleClose} maxWidth="28rem" width="100%">
        {view === 'form' && (
          <>
            <div className="modal-header">
              <h2 className="modal-title">
                {allowed ? t('asset.mdm.allowance.grantTitle') : t('asset.mdm.allowance.revokeTitle')}
              </h2>
              <button type="button" className="modal-close-btn" onClick={handleClose}>&times;</button>
            </div>
            <div className="modal-content flex flex-col gap-3">
              <p className="text-sm">
                <span className="text-subtle">{t('asset.mdm.dunning.deviceLabel')}:</span>{' '}
                <span className="font-mono">{serial}</span>
                {a && <> · {a.label_th}</>}
              </p>
              <p className="text-sm text-subtle">
                {allowed ? (
                  <>
                    {/* Only app removal has a timed twin (the panel above). */}
                    {a?.allowance_code.toUpperCase() === 'APP_REMOVAL' && <>{t('asset.mdm.allowance.grantBodyNotTimed')} </>}
                    {t('asset.mdm.allowance.grantBody')}
                  </>
                ) : t('asset.mdm.allowance.revokeBody')}
              </p>
              {!allowed && a?.rule_says_yes && (
                <div className="alert alert-warning">
                  <AlertTriangle size={16} className="shrink-0" />
                  <div className="alert-description text-xs">
                    {n != null
                      ? t('asset.mdm.allowance.ruleAlsoCount', { count: n })
                      : t('asset.mdm.allowance.ruleAlso')}
                  </div>
                </div>
              )}
              <div className={`flex flex-col ${touched && reasonMissing ? 'pb-5' : ''}`}>
                <label className="form-label">{t('asset.mdm.allowance.reasonLabel')} *</label>
                <TextArea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  onBlur={() => setTouched(true)}
                  rows={3}
                  placeholder={t(`asset.mdm.allowance.reasonPlaceholderByCode.${a?.allowance_code.toUpperCase() ?? ''}`, {
                    defaultValue: t('asset.mdm.allowance.reasonPlaceholder'),
                  })}
                  error={touched && reasonMissing}
                />
                {/* The error line draws into the space below it, so it takes the hint's place. */}
                {touched && reasonMissing ? (
                  <FormErrorMessage error={{ message: t('asset.mdm.allowance.reasonRequired') }} />
                ) : (
                  <span className="text-xs text-subtler mt-1">{t('asset.mdm.allowance.reasonKept')}</span>
                )}
              </div>
            </div>
            <ModalErrorBand message={error} onDismiss={() => setError(null)} />
            <div className="modal-footer">
              <Button variant="ghost" onClick={handleClose} disabled={submitting}>{t('common.cancel')}</Button>
              <Button
                color="primary"
                onClick={submit}
                disabled={submitting || actorId == null || (touched && reasonMissing)}
                startIcon={allowed ? <Unlock size={15} /> : <Lock size={15} />}
              >
                {allowed ? t('asset.mdm.allowance.grant') : t('asset.mdm.allowance.revoke')}
              </Button>
            </div>
          </>
        )}

        {view === 'done' && doneFor && (
          <ActionDoneView
            headline={doneFor.allowed ? t('asset.mdm.allowance.doneGrant') : t('asset.mdm.allowance.doneRevoke')}
            contractCode={serial}
            tone={doneFor.allowed ? 'warning' : 'success'}
            detailRows={[
              ...(doneA ? [{ label: t('asset.mdm.allowance.what'), value: doneA.label_th }] : []),
              { label: t('asset.mdm.allowance.reasonLabel'), value: reason.trim() },
            ]}
            extras={
              <div className="flex flex-col gap-2">
                <p className="text-sm text-subtle">{t('asset.mdm.allowance.doneNote')}</p>
                {!doneFor.allowed && doneA?.rule_says_yes && (
                  <div className="alert alert-warning">
                    <AlertTriangle size={16} className="shrink-0" />
                    <div className="alert-description text-xs">
                      {doneN != null
                        ? t('asset.mdm.allowance.ruleAlsoCount', { count: doneN })
                        : t('asset.mdm.allowance.ruleAlso')}
                    </div>
                  </div>
                )}
              </div>
            }
            onClose={forceClose}
          />
        )}
      </Modal>

      <Modal open={confirmClose} onClose={() => setConfirmClose(false)} maxWidth="24rem" width="100%">
        <div className="modal-header"><h2 className="modal-title">{t('common.unsavedChanges')}</h2></div>
        <div className="modal-content"><p>{t('common.unsavedChangesMessage')}</p></div>
        <div className="modal-footer">
          <Button variant="ghost" onClick={() => setConfirmClose(false)}>{t('common.cancel')}</Button>
          <Button color="danger" onClick={forceClose}>{t('common.discard')}</Button>
        </div>
      </Modal>
    </>
  );
}
