// ============================================================================
// The iCloud (Apple ID) menu's REAL state on the device — "is it actually
// greyed · what is in flight · what does the company's rule say".
// UI_SUMMARY 134 §3b / 160 §1b, IMPLEMENT 2026-11-06 (nnf-mdm migs 438-440).
//
// One component, two places: MDM tab 1 and the contract's iCloud box. They must
// say the same thing (the backend has one source, mdm.fn_asset_icloud_menu), so
// both read the same v_asset_mdm_status row through this file.
//
// Rules this file keeps:
//   - The state comes from icloud_menu_state, never enforcement_badge (LIGHT
//     covers both greyed and open) and never icloud_locked_now (that is the
//     rule's verdict, not the device — the 11-06 case said "locked" while the
//     phone was open).
//   - A company that doesn't lock (source OFF, or N = 0 — MNT) is NOT a problem:
//     an open menu there is grey/neutral, never a warning.
//   - Every number is the row's own (N, paid). Nothing is worked out here.
//   - null state = the device isn't in MDM → draw nothing.
// ============================================================================

import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from 'tsp-form';
import { Cloud } from 'lucide-react';
import { DateTime } from '../../../components/DateTime';
import type { AssetMdmStatus } from './mdmApi';

export type IcloudMenuFields = Pick<AssetMdmStatus,
  | 'icloud_menu_state' | 'icloud_menu_rule_locked' | 'icloud_menu_observed_locked'
  | 'icloud_menu_observed_at' | 'icloud_menu_pending_template'
  | 'icloud_lock_until_paid' | 'icloud_lock_source' | 'icloud_paid_count'>;

type Tone = 'success' | 'warning' | 'danger' | 'default';

interface IcloudMenuView {
  tone: Tone;
  label: string;
  /** A second sentence, only where the state needs one (what happens next). */
  hint: string | null;
}

/** The badge + sentence for a row, or null when there is nothing to say. */
export function useIcloudMenuView(s: IcloudMenuFields | null | undefined): IcloudMenuView | null {
  const { t } = useTranslation();
  if (!s || !s.icloud_menu_state) return null;
  const n = s.icloud_lock_until_paid;
  const noRule = s.icloud_lock_source === 'OFF' || n === 0 || n == null;

  switch (s.icloud_menu_state) {
    case 'LOCKED':
      return { tone: 'success', label: t('icloudMenu.locked'), hint: null };
    case 'APPLYING':
      return { tone: 'warning', label: t('icloudMenu.applying'), hint: t('icloudMenu.waitOnline') };
    case 'RELEASING':
      return { tone: 'warning', label: t('icloudMenu.releasing'), hint: t('icloudMenu.waitOnline') };
    case 'OPEN_MISMATCH':
      return { tone: 'danger', label: t('icloudMenu.mismatch'), hint: t('icloudMenu.mismatchHint') };
    case 'UNKNOWN':
      return { tone: 'default', label: t('icloudMenu.unknown'), hint: null };
    case 'OPEN':
    default:
      if (noRule) {
        // A contract flag set to 0 turned it off for this contract only.
        const contractOff = s.icloud_lock_source === 'CONTRACT' && n === 0;
        return { tone: 'default', label: t(contractOff ? 'icloudMenu.contractOff' : 'icloudMenu.companyOff'), hint: null };
      }
      if (s.icloud_lock_source === 'DEVICE_ALLOWANCE') {
        return { tone: 'success', label: t('icloudMenu.releasedByOps'), hint: null };
      }
      return { tone: 'success', label: t('icloudMenu.released'), hint: null };
  }
}

/** "จ่ายแล้ว 0/1 งวด · เครื่องรายงาน 16:29" — the numbers the work order requires. */
export function IcloudMenuFacts({ s }: { s: IcloudMenuFields }) {
  const { t } = useTranslation();
  const n = s.icloud_lock_until_paid;
  const parts: ReactNode[] = [];
  if (n != null && n > 0 && s.icloud_paid_count != null) {
    parts.push(<span key="paid">{t('icloudMenu.paidOf', { paid: s.icloud_paid_count, n })}</span>);
  }
  if (s.icloud_lock_source === 'CONTRACT' && n != null && n > 0) {
    parts.push(<span key="src">{t('icloudMenu.byContractFlag')}</span>);
  }
  if (s.icloud_menu_observed_at) {
    parts.push(
      <span key="seen">{t('icloudMenu.reportedAt')} <DateTime value={s.icloud_menu_observed_at} showTime /></span>,
    );
  }
  if (parts.length === 0) return null;
  return (
    <div className="text-xs text-subtle flex flex-wrap gap-x-1">
      {parts.map((p, i) => <span key={i}>{i > 0 && '· '}{p}</span>)}
    </div>
  );
}

export function IcloudMenuBadge({ view }: { view: IcloudMenuView }) {
  return <Badge size="xs" color={view.tone}>{view.label}</Badge>;
}

/** MDM tab 1's box. Renders nothing for a device outside MDM. */
export function IcloudMenuStatusBox({ status }: { status: IcloudMenuFields }) {
  const { t } = useTranslation();
  const view = useIcloudMenuView(status);
  if (!view) return null;
  return (
    <div className="border border-line rounded-md px-4 py-3 flex flex-col gap-1.5" data-testid="icloud-menu-status">
      <div className="flex items-center gap-2 flex-wrap">
        <Cloud size={16} className="text-subtle shrink-0" />
        <span className="text-sm font-semibold">{t('icloudMenu.title')}</span>
        <IcloudMenuBadge view={view} />
      </div>
      {view.hint && <div className="text-sm">{view.hint}</div>}
      <IcloudMenuFacts s={status} />
    </div>
  );
}
