// "สแกนเครื่องด้วยบัญชีไหน" — the ABM account selector that must sit in front of
// every enroll action. Spec §2.1 of the 2026-09-11 IMPLEMENT ticket.
//
// Three shapes, all mandatory:
//   0 rows  → the caller must DISABLE its action. This branch has no ABM account,
//             so any enroll would be pushed at a guessed org. We say so instead
//             of letting someone press a button that cannot work.
//   1 row   → no control worth showing, but the id STILL rides on the request.
//             A quiet "บัญชี: …" line so the operator can spot a wrong default.
//   >1 rows → the picker proper, preselected to the view's is_default row.
//
// The email is the option text because that is what the operator typed into
// Apple Configurator minutes ago. The org name trails it so two similar emails
// in different orgs stay distinguishable; `label` is a self-chosen nickname and
// is tooltip-only (§2.1: "อย่าใช้แทนอีเมล").

import { useTranslation } from 'react-i18next';
import { Select } from 'tsp-form';
import { AlertTriangle, Mail } from 'lucide-react';
import type { MdmEnrollAccount } from '../enrollAccounts';

export interface EnrollAccountPickerProps {
  accounts: MdmEnrollAccount[];
  loading?: boolean;
  /** Currently chosen source_id — null until the accounts land. */
  value: number | null;
  onChange: (sourceId: number) => void;
  /** Smaller type for inside a confirm dialog. */
  size?: 'sm' | 'md';
}

export function EnrollAccountPicker({
  accounts, loading = false, value, onChange, size = 'md',
}: EnrollAccountPickerProps) {
  const { t } = useTranslation();

  if (loading) {
    return <p className="text-xs text-subtle">{t('common.loading')}</p>;
  }

  // The caller disables its own button off accounts.length === 0; this is the
  // explanation that sits next to that dead button.
  if (accounts.length === 0) {
    return (
      <div className="alert alert-warning">
        <AlertTriangle size={16} className="shrink-0" />
        <span className="min-w-0">{t('mdmEnrollAccount.noneForBranch')}</span>
      </div>
    );
  }

  if (accounts.length === 1) {
    const only = accounts[0];
    return (
      <p className="text-xs text-subtle inline-flex items-center gap-1.5 flex-wrap" title={only.label ?? undefined}>
        <Mail size={13} className="shrink-0" />
        <span>{t('mdmEnrollAccount.singleLine')}</span>
        <span className="font-medium break-all">{only.login_email}</span>
        <span className="text-subtler">· {only.abm_display_name}</span>
      </p>
    );
  }

  // ⛔ accounts is rendered in the view's own order — no sort here. The default
  //    row is first by construction and re-sorting would move it.
  const options = accounts.map(a => ({
    value: String(a.source_id),
    label: `${a.login_email} · ${a.abm_display_name}`,
  }));

  return (
    <div className="flex flex-col gap-1">
      <label className="form-label">{t('mdmEnrollAccount.pickerLabel')}</label>
      <Select
        options={options}
        value={value != null ? String(value) : null}
        onChange={(v) => { if (v) onChange(Number(v)); }}
        placeholder={t('mdmEnrollAccount.pickerPlaceholder')}
        size={size === 'sm' ? 'sm' : undefined}
        showChevron
      />
      <p className="text-xs text-subtle">{t('mdmEnrollAccount.pickerHint')}</p>
    </div>
  );
}
