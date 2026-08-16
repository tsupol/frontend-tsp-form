// ============================================================================
// The dev scenario driver — a floating picker that puts the REAL page into any
// state without a token, a device, or a production login.
//
// WHY: every state but the first needs a physical handset in a specific
// condition — waiting for a wipe, mid-enrollment with the org key still landing,
// finished, behind an expired link. Nobody can stage those on demand, and on
// production you would be wiping a customer's phone to see one screen. So this
// drives the actual page, not a copy of it: what you review here is what branch
// B gets.
//
// ⛔ DEV ONLY, three ways over:
//    1. isLocalDev() — localhost or a private LAN address, never a public host.
//    2. ?mock is required — a normal visitor with a real token never sees it.
//    3. import.meta.env.DEV strips the whole module from a production build.
//
// Floating rather than inline: the picker must not take space from the page it
// is previewing, or you end up reviewing a layout nobody will ever see.
// ============================================================================

import { useState } from 'react';
import { isLocalDev } from '../lib/devEnv';
import type { ApplyTemplateResult } from '../pages/inventory/mdm/mdmApi';
import type { RemoteEnrollStatus } from '../pages/inventory/mdm/shared/enrollView';
import type { DeadReason } from './api';

const SERIAL = 'DJKPHM9LG3';

function agoIso(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

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
    // Steps 6–7. The RPC evaluates may_apply_light as the LINK ISSUER, so a
    // default of false would mock a page nobody actually gets; an unenrolled
    // device is blocked by NOT_IN_MDM, which is the honest reason.
    nnf_app_installed: null,
    nnf_app_checked_at: null,
    escrow_window_status: null,
    escrow_has_code: false,
    escrow_days_remaining: null,
    enforcement_badge: 'NOT_IN_MDM',
    may_apply_light: false,
    apply_light_blocked_reason: 'NOT_IN_MDM',
    enforcement_verify_state: null,
    link_expires_at: new Date(Date.now() + 2 * 3600_000 + 14 * 60_000).toISOString(),
    ...over,
  };
}

export interface Scenario {
  key: string;
  label: string;
  status?: RemoteEnrollStatus;
  dead?: DeadReason;
  offline?: boolean;
}

/**
 * A stand-in for fn_mdm_remote_enroll_apply_light, so the step-7 button and its
 * preview→confirm dialog can actually be REVIEWED in the picker.
 *
 * Without this the mock page passed no onApplyLight and the button hid itself —
 * which silently made the one control this whole screen exists for the only
 * thing you could not preview. The restriction keys are the real ones from
 * ENFORCEMENT_LIGHT, so the dialog shows the same list a device would.
 *
 * Commit (preview:false) resolves but changes nothing: the mock status lives in
 * the URL, so the badge only moves if you pick another scenario. That is honest
 * — this driver mocks the SERVER, and the server's reply to a commit is "queued",
 * not "locked".
 */
const MOCK_LIGHT_RESTRICTIONS = [
  'allowAccountModification',
  'allowModifyFindMy',
  'allowEraseContentAndSettings',
  'allowHostPairing',
  'allowProfileInstallation',
].map((key) => ({ key, allowed: false }));

export async function mockApplyLight(preview: boolean): Promise<ApplyTemplateResult> {
  await new Promise((r) => setTimeout(r, 400)); // the loading state is worth seeing
  return {
    count: MOCK_LIGHT_RESTRICTIONS.length,
    serial: SERIAL,
    preview,
    display_name: 'Enforcement Light',
    template_key: 'ENFORCEMENT_LIGHT',
    removal_disallowed: true,
    restrictions: MOCK_LIGHT_RESTRICTIONS,
    ...(preview ? {} : { intent_id: 90001 }),
  };
}

export const MOCK_SCENARIOS: Scenario[] = [
  { key: 'fresh', label: 'Fresh — not started', status: base() },
  {
    key: 'preparing', label: 'Preparing (sending to Apple)',
    status: base({ mdm_status: 'PREPARING', prepare_status: 'PENDING', can_prepare: false }),
  },
  {
    key: 'wipe', label: 'Ready — wipe the device',
    status: base({ mdm_status: 'PROFILE_READY', prepare_status: 'READY', prepare_requested_at: agoIso(2), can_prepare: false }),
  },
  {
    key: 'wipe12', label: 'Waiting 12 min — "wiped it yet?"',
    status: base({ mdm_status: 'PROFILE_READY', prepare_status: 'READY', prepare_requested_at: agoIso(12), can_prepare: false }),
  },
  {
    key: 'wipe90', label: 'Waiting 90 min — "check the serial"',
    status: base({ mdm_status: 'PROFILE_READY', prepare_status: 'READY', prepare_requested_at: agoIso(90), can_prepare: false }),
  },
  {
    key: 'keys', label: 'Enrolled — org key still landing',
    status: base({
      mdm_status: 'IN_MDM', prepare_status: 'READY', in_mdm: true, can_prepare: false,
      has_pull_key: true, has_push_key: false, lock_verdict_code: 'NO_ORG_LOCK_IN_ABM',
      escrow_window_status: 'OK', escrow_has_code: true,
      enforcement_badge: 'NONE', may_apply_light: true, apply_light_blocked_reason: null,
    }),
  },
  {
    key: 'keys2', label: 'Enrolled — org key unconfirmed',
    status: base({
      mdm_status: 'IN_MDM', prepare_status: 'READY', in_mdm: true, can_prepare: false,
      has_pull_key: true, has_push_key: true, push_key_applied_at: null,
      lock_verdict_code: 'ORG_KEY_NOT_APPLIED',
      escrow_window_status: 'OK', escrow_has_code: true,
      enforcement_badge: 'NONE', may_apply_light: true, apply_light_blocked_reason: null,
    }),
  },
  {
    key: 'protected', label: 'Enrolled + keys OK — not locked yet',
    status: base({
      mdm_status: 'IN_MDM', prepare_status: 'READY', in_mdm: true, can_prepare: false,
      has_pull_key: true, has_push_key: true, push_key_applied_at: agoIso(3),
      lock_ready: true, lock_verdict_code: 'PROTECTED',
      nnf_app_installed: true, nnf_app_checked_at: agoIso(4),
      escrow_window_status: 'OK', escrow_has_code: true,
      enforcement_badge: 'NONE', may_apply_light: true, apply_light_blocked_reason: null,
    }),
  },
  {
    key: 'app-missing', label: 'Step 6 — NNF app not installed',
    status: base({
      mdm_status: 'IN_MDM', prepare_status: 'READY', in_mdm: true, can_prepare: false,
      has_pull_key: true, has_push_key: true, push_key_applied_at: agoIso(9),
      lock_ready: true, lock_verdict_code: 'PROTECTED',
      nnf_app_installed: false, nnf_app_checked_at: agoIso(2),
      escrow_window_status: 'OK', escrow_has_code: false, escrow_days_remaining: 11,
      enforcement_badge: 'NONE', may_apply_light: true, apply_light_blocked_reason: null,
    }),
  },
  {
    key: 'locking', label: 'Step 7 — lock command in flight',
    status: base({
      mdm_status: 'IN_MDM', prepare_status: 'READY', in_mdm: true, can_prepare: false,
      has_pull_key: true, has_push_key: true, push_key_applied_at: agoIso(6),
      lock_ready: true, lock_verdict_code: 'PROTECTED',
      nnf_app_installed: true, nnf_app_checked_at: agoIso(6),
      escrow_window_status: 'OK', escrow_has_code: true,
      enforcement_badge: 'APPLYING', may_apply_light: false,
      apply_light_blocked_reason: 'COMMAND_IN_FLIGHT',
    }),
  },
  {
    key: 'no-lock-perm', label: 'Step 7 — issuer lacks lock permission',
    status: base({
      mdm_status: 'IN_MDM', prepare_status: 'READY', in_mdm: true, can_prepare: false,
      has_pull_key: true, has_push_key: true, push_key_applied_at: agoIso(6),
      lock_ready: true, lock_verdict_code: 'PROTECTED',
      nnf_app_installed: true, nnf_app_checked_at: agoIso(6),
      escrow_window_status: 'OK', escrow_has_code: true,
      enforcement_badge: 'NONE', may_apply_light: false,
      apply_light_blocked_reason: 'NO_PERMISSION',
    }),
  },
  {
    key: 'wallpaper', label: 'Step 7 — wallpaper only (looks locked, isn\'t)',
    status: base({
      mdm_status: 'IN_MDM', prepare_status: 'READY', in_mdm: true, can_prepare: false,
      has_pull_key: true, has_push_key: true, push_key_applied_at: agoIso(20),
      lock_ready: true, lock_verdict_code: 'PROTECTED',
      nnf_app_installed: true, nnf_app_checked_at: agoIso(20),
      escrow_window_status: 'OK', escrow_has_code: true,
      enforcement_badge: 'WALLPAPER_ONLY', may_apply_light: true,
      apply_light_blocked_reason: null,
    }),
  },
  {
    key: 'failed', label: 'Prepare failed → scan into ABM',
    status: base({ mdm_status: 'PREPARE_FAILED', prepare_status: 'NOT_ON_SERVER', can_prepare: true }),
  },
  {
    key: 'reenroll', label: 'Re-enroll ready',
    status: base({
      mdm_status: 'IN_MDM', prepare_status: 'READY', prepare_is_reenroll: true,
      prepare_requested_at: agoIso(1), in_mdm: true, can_prepare: false,
    }),
  },
  {
    key: 'expiring', label: 'Link expiring in 8 min',
    status: base({ link_expires_at: new Date(Date.now() + 8 * 60_000).toISOString() }),
  },
  {
    // "Finished" is now lock_ready + a REAL lock badge (isReadyToHandOver) —
    // there is no `completed` field any more. The page keeps polling and keeps
    // the checklist on screen; only the banner above it changes.
    key: 'done', label: '✅ Finished — ready to hand over',
    status: base({
      mdm_status: 'IN_MDM', prepare_status: 'READY', in_mdm: true, can_prepare: false,
      has_pull_key: true, has_push_key: true, push_key_applied_at: agoIso(2),
      lock_ready: true, lock_verdict_code: 'PROTECTED',
      nnf_app_installed: true, nnf_app_checked_at: agoIso(3),
      escrow_window_status: 'OK', escrow_has_code: true,
      enforcement_badge: 'LIGHT', may_apply_light: false,
      apply_light_blocked_reason: 'ALREADY_ENFORCED',
      enforcement_verify_state: 'VERIFIED',
    }),
  },
  { key: 'expired', label: '⛔ Link expired', dead: 'EXPIRED' },
  { key: 'revoked', label: '⛔ Link revoked', dead: 'REVOKED' },
  { key: 'notfound', label: '⛔ Bad token', dead: 'NOT_FOUND' },
  { key: 'offline', label: '📡 Offline', offline: true },
];

export interface MockState {
  active: boolean;
  status: RemoteEnrollStatus | null;
  dead: DeadReason | null;
  offline: boolean;
  current: Scenario | null;
  select: (s: Scenario) => void;
}

/**
 * `?mock` on a dev host turns the picker on. Absent → the page is fully real.
 *
 * The chosen scenario lives in the URL (`?mock=wipe`), and selecting one does a
 * real NAVIGATION rather than a setState. That is the point: swapping React
 * state shows the destination but skips everything before it — the boot splash,
 * its dwell, and the staggered reveal all happen once per page load. Reviewing
 * a state means reviewing how it ARRIVES, so each pick reloads the page and
 * plays the whole sequence exactly as branch B will see it.
 */
export function useMockScenario(): MockState {
  const params = new URLSearchParams(window.location.search);
  const enabled = import.meta.env.DEV && isLocalDev() && params.has('mock');

  if (!enabled) {
    return { active: false, status: null, dead: null, offline: false, current: null, select: () => {} };
  }

  const requested = params.get('mock');
  const current = MOCK_SCENARIOS.find((s) => s.key === requested) ?? MOCK_SCENARIOS[0];

  const select = (s: Scenario) => {
    const next = new URLSearchParams(window.location.search);
    next.set('mock', s.key);
    // assign(), not pushState: this must be a full document load so the inline
    // splash in enroll.html runs again.
    window.location.assign(`${window.location.pathname}?${next.toString()}`);
  };

  return {
    active: true,
    status: current.status ?? null,
    dead: current.dead ?? null,
    offline: current.offline ?? false,
    current,
    select,
  };
}

/**
 * Floating trigger + popover, pinned top-left over the page.
 * Renders nothing at all unless the mock driver is active.
 */
export function ScenarioPicker({ mock }: { mock: MockState }) {
  const [open, setOpen] = useState(false);
  if (!mock.active) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Preview states"
        aria-expanded={open}
        className="fixed top-3 left-3 z-50 w-10 h-10 rounded-full border border-line bg-surface-elevated text-fg shadow-lg cursor-pointer flex items-center justify-center text-base"
        style={{ lineHeight: 1 }}
      >
        🎛
      </button>

      {open && (
        <>
          {/* Click-away. Below the panel, above the page. */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="fixed top-14 left-3 z-50 w-64 max-h-[70vh] overflow-auto better-scroll rounded-md border border-line bg-surface-elevated shadow-xl p-1.5 flex flex-col gap-0.5"
            role="menu"
          >
            <div className="px-2 py-1.5 text-[11px] uppercase tracking-wide text-subtler">
              Preview state (dev)
            </div>
            {MOCK_SCENARIOS.map((s) => (
              <button
                key={s.key}
                type="button"
                role="menuitem"
                onClick={() => { mock.select(s); setOpen(false); }}
                className={`text-left px-2 py-1.5 rounded text-xs cursor-pointer border-none ${
                  mock.current?.key === s.key
                    ? 'bg-primary text-primary-contrast'
                    : 'bg-transparent text-fg hover:bg-surface-hover'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}
