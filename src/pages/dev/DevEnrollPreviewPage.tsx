// ============================================================================
// DevEnrollPreviewPage — see every state of the public /mdm-enroll page without
// a token, a device, or a production login.
//
// WHY THIS EXISTS. The real page's states each need a physical handset in a
// particular condition: waiting for a wipe, mid-enrollment with the org key
// still landing, finished, or behind a link that has expired. Nobody can stage
// those on demand — the dev server has no enrolled devices at all, and on
// production you would be wiping a customer's phone to see one screen. So every
// state but the first has, until now, only ever been reasoned about.
//
// This renders the SAME components the real page uses (EnrollChecklist,
// KeyBanner, SerialHero) against fabricated status rows, so what you see here is
// what branch B sees — if this looks wrong, the real page is wrong.
//
// Local dev only (isLocalDev), and it never calls an RPC.
// ============================================================================

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from 'tsp-form';
import { AlertCircle, Clock, PartyPopper, RefreshCw } from 'lucide-react';
import { Checkmark } from 'tsp-form';
import { EnrollChecklist, KeyBanner } from '../inventory/mdm/shared/EnrollChecklist';
import { SerialHero } from '../inventory/mdm/shared/SerialDisplay';
import { fromRemoteStatus, type RemoteEnrollStatus } from '../inventory/mdm/shared/enrollView';

const SERIAL = 'DJKPHM9LG3';

/** Minutes ago, as an ISO string — for ageing the wait hints. */
function agoIso(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

/** A complete remote payload; scenarios override only what they change. */
function base(over: Partial<RemoteEnrollStatus> = {}): RemoteEnrollStatus {
  return {
    serial_number: SERIAL,
    mdm_status: 'NOT_STARTED',
    prepare_status: null,
    prepare_blocked_reason: null,
    prepare_requested_at: null,
    prepare_is_reenroll: false,
    in_mdm: false,
    can_prepare: true,
    lock_ready: false,
    lock_verdict_code: null,
    has_pull_key: false,
    has_push_key: false,
    push_key_applied_at: null,
    completed: false,
    link_expires_at: new Date(Date.now() + 2 * 3600_000 + 14 * 60_000).toISOString(),
    ...over,
  };
}

type Scenario = {
  key: string;
  label: string;
  /** null = a non-checklist screen (dead link / finished / offline). */
  status: RemoteEnrollStatus | null;
  screen?: 'finished' | 'expired' | 'revoked' | 'notfound' | 'offline';
  note: string;
};

const SCENARIOS: Scenario[] = [
  {
    key: 'fresh',
    label: 'Fresh — not started',
    status: base(),
    note: 'What B sees on opening a link for a device nobody has touched yet.',
  },
  {
    key: 'preparing',
    label: 'Preparing (sending to Apple)',
    status: base({ mdm_status: 'PREPARING', prepare_status: 'PENDING', can_prepare: false }),
    note: 'The one state that legitimately shows a spinner — the system really is working.',
  },
  {
    key: 'wipe',
    label: 'Ready — waiting for the wipe',
    status: base({
      mdm_status: 'PROFILE_READY',
      prepare_status: 'READY',
      prepare_requested_at: agoIso(2),
      can_prepare: false,
    }),
    note: 'The instruction state. NOT a spinner — the system has finished and is waiting on a person.',
  },
  {
    key: 'wipe-10',
    label: 'Waiting 12 min — "wiped it yet?"',
    status: base({
      mdm_status: 'PROFILE_READY',
      prepare_status: 'READY',
      prepare_requested_at: agoIso(12),
      can_prepare: false,
    }),
    note: 'First escalation of the wait hint.',
  },
  {
    key: 'wipe-60',
    label: 'Waiting 90 min — "check the serial"',
    status: base({
      mdm_status: 'PROFILE_READY',
      prepare_status: 'READY',
      prepare_requested_at: agoIso(90),
      can_prepare: false,
    }),
    note: 'Second escalation — the serial on the asset probably is not the device in their hand.',
  },
  {
    key: 'keys',
    label: 'Enrolled — org key still landing',
    status: base({
      mdm_status: 'IN_MDM',
      prepare_status: 'READY',
      in_mdm: true,
      can_prepare: false,
      has_pull_key: true,
      has_push_key: false,
      lock_ready: false,
      lock_verdict_code: 'NO_ORG_LOCK_IN_ABM',
    }),
    note: 'The dangerous window: enrolled and looking fine, but NOT safe to hand over yet.',
  },
  {
    key: 'keys-applying',
    label: 'Enrolled — org key not yet confirmed',
    status: base({
      mdm_status: 'IN_MDM',
      prepare_status: 'READY',
      in_mdm: true,
      can_prepare: false,
      has_pull_key: true,
      has_push_key: true,
      push_key_applied_at: null,
      lock_ready: false,
      lock_verdict_code: 'ORG_KEY_NOT_APPLIED',
    }),
    note: 'Key exists but Apple has not confirmed it landed — three states, not two.',
  },
  {
    key: 'protected',
    label: 'Enrolled + protected',
    status: base({
      mdm_status: 'IN_MDM',
      prepare_status: 'READY',
      in_mdm: true,
      can_prepare: false,
      has_pull_key: true,
      has_push_key: true,
      push_key_applied_at: agoIso(3),
      lock_ready: true,
      lock_verdict_code: 'PROTECTED',
    }),
    note: 'Both keys present and confirmed.',
  },
  {
    key: 'failed',
    label: 'Prepare failed (remote wording)',
    status: base({
      mdm_status: 'PREPARE_FAILED',
      prepare_status: 'NOT_ON_SERVER',
      prepare_blocked_reason: 'device not on NNF-MDM-1',
      can_prepare: true,
    }),
    note: 'Says "contact the branch" — B cannot reach ABM. The raw reason is hidden from them.',
  },
  {
    key: 'reenroll',
    label: 'Re-enroll ready',
    status: base({
      mdm_status: 'IN_MDM',
      prepare_status: 'READY',
      prepare_is_reenroll: true,
      prepare_requested_at: agoIso(1),
      in_mdm: true,
      can_prepare: false,
    }),
    note: 'mdm_status stays IN_MDM, so the wipe signal comes from prepare_status.',
  },
  { key: 'finished', label: '✅ Finished', status: null, screen: 'finished', note: 'The ending — B turns the phone around to show A.' },
  { key: 'expired', label: '⛔ Link expired', status: null, screen: 'expired', note: 'Links last 3 hours.' },
  { key: 'revoked', label: '⛔ Link revoked', status: null, screen: 'revoked', note: 'Branch A cancelled it.' },
  { key: 'notfound', label: '⛔ Bad token', status: null, screen: 'notfound', note: 'Mistyped or never existed.' },
  { key: 'offline', label: '📡 Offline', status: null, screen: 'offline', note: 'Phone lost signal — retryable, unlike a dead link.' },
];

/** Mirrors the real page's Shell so the preview matches its geometry. */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-full bg-bg flex justify-center px-4 py-6">
      <div className="w-full max-w-md flex flex-col gap-4">{children}</div>
    </div>
  );
}

export function DevEnrollPreviewPage() {
  const { t } = useTranslation();
  const [active, setActive] = useState<Scenario>(SCENARIOS[0]);

  const view = useMemo(
    () => (active.status ? fromRemoteStatus(active.status) : null),
    [active],
  );

  return (
    <div className="flex flex-col gap-4 p-4 min-w-0">
      <div>
        <h1 className="heading-2">Remote enroll — state preview</h1>
        <p className="text-sm text-subtle mt-1">
          The real <code>/mdm-enroll</code> components against fabricated data. No token, no RPC.
          These states need a physical handset in a specific condition, so this is the only
          practical way to review them.
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {SCENARIOS.map((s) => (
          <Button
            key={s.key}
            size="sm"
            variant={active.key === s.key ? 'primary' : 'outline'}
            onClick={() => setActive(s)}
          >
            {s.label}
          </Button>
        ))}
      </div>

      <div className="alert alert-info">
        <AlertCircle size={16} className="shrink-0" />
        <span className="min-w-0">{active.note}</span>
      </div>

      {/* Phone-width frame, so it reads the way B will actually see it. */}
      <div className="flex justify-center">
        <div
          className="border border-line rounded-xl overflow-auto better-scroll bg-bg"
          style={{ width: 420, height: 780 }}
        >
          {view && active.status ? (
            <Shell>
              <div className="pt-2">
                <SerialHero serial={view.serial_number} />
              </div>
              <div className="flex items-center justify-center gap-1.5 text-xs text-subtle">
                <Clock size={12} className="shrink-0" />
                <span className="tabular-nums">{t('remoteEnroll.expiresInHm', { h: 2, m: 14 })}</span>
              </div>
              <EnrollChecklist
                view={view}
                audience="remote"
                onPrepare={() => {}}
                hideKeyBanner
              />
              {view.in_mdm && <KeyBanner view={view} />}
              <div className="flex items-center justify-center gap-2 text-xs text-subtle">
                <span className="w-1.5 h-1.5 rounded-full bg-success-fg" aria-hidden />
                <span>{t('remoteEnroll.updatedJustNow')}</span>
              </div>
            </Shell>
          ) : active.screen === 'finished' ? (
            <Shell>
              <div className="flex flex-col items-center text-center gap-4 pt-10">
                <div className="w-20 h-20 rounded-full bg-success-soft border border-success-border flex items-center justify-center">
                  <Checkmark className="w-10 h-10 text-success-fg remote-enroll-check" />
                </div>
                <h1 className="heading-2">{t('remoteEnroll.done.title')}</h1>
                <p className="text-subtle">{t('remoteEnroll.done.body')}</p>
                <div className="font-mono text-sm text-subtle tracking-widest">{SERIAL}</div>
                <div className="alert alert-success mt-2 text-left">
                  <PartyPopper size={18} className="shrink-0" />
                  <span>{t('remoteEnroll.done.tellBranch')}</span>
                </div>
              </div>
            </Shell>
          ) : active.screen === 'offline' ? (
            <Shell>
              <div className="flex flex-col items-center text-center gap-3 pt-10">
                <AlertCircle size={56} className="text-danger-fg" />
                <h1 className="heading-2">{t('remoteEnroll.offline.title')}</h1>
                <p className="text-subtle">{t('remoteEnroll.offline.body')}</p>
                <Button variant="outline" startIcon={<RefreshCw size={16} />}>
                  {t('common.refresh')}
                </Button>
              </div>
            </Shell>
          ) : (
            <Shell>
              <div className="flex flex-col items-center text-center gap-3 pt-10">
                <AlertCircle size={56} className="text-warning-fg" />
                <h1 className="heading-2">
                  {t(`remoteEnroll.dead.${active.screen === 'expired' ? 'EXPIRED'
                    : active.screen === 'revoked' ? 'REVOKED' : 'NOT_FOUND'}.title`)}
                </h1>
                <p className="text-subtle">
                  {t(`remoteEnroll.dead.${active.screen === 'expired' ? 'EXPIRED'
                    : active.screen === 'revoked' ? 'REVOKED' : 'NOT_FOUND'}.body`)}
                </p>
              </div>
            </Shell>
          )}
        </div>
      </div>
    </div>
  );
}
