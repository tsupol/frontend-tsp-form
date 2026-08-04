import { useTranslation } from 'react-i18next';
import { Select } from 'tsp-form';
import { ALL_SENTINEL, type BranchScope } from './useReconcileBranchScope';
import type { Branch } from './accountingTypes';

/**
 * Branch picker for ①② — "ทุกสาขา" or any number of ticked branches.
 *
 * "ทุกสาขา" is one option among the branches rather than a separate toggle:
 * picking it clears the ticks, ticking a branch drops it. Company-level users
 * get the multi-select; a branch user sees their own branch, disabled.
 */
export function BranchScopeSelect({
  branches, scope, onChange, disabled = false,
}: {
  branches: Branch[];
  scope: BranchScope;
  onChange: (scope: BranchScope) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();

  const value = scope.mode === 'ALL' ? [ALL_SENTINEL] : scope.branchIds.map(String);

  return (
    // The "ทุกสาขา" chip gets no × — removing it has no meaningful target (the
    // scope would just snap back to ทุกสาขา, reading as a broken button). Ticking
    // a branch is how you leave it.
    <div className={scope.mode === 'ALL' ? 'branch-scope-select-all' : undefined}>
    <Select
      multiple
      value={value}
      onChange={(v) => {
        const picked = (Array.isArray(v) ? v : v ? [v] : []) as string[];
        // "ทุกสาขา" and specific branches are mutually exclusive. Whichever the
        // user just added wins: if ALL is newly present, collapse to ALL;
        // otherwise drop ALL and keep the branches.
        const wasAll = scope.mode === 'ALL';
        if (picked.includes(ALL_SENTINEL) && !wasAll) {
          onChange({ mode: 'ALL' });
          return;
        }
        const ids = picked.filter(p => p !== ALL_SENTINEL).map(Number).filter(Number.isInteger);
        // Unticking the last branch falls back to "ทุกสาขา" rather than an empty
        // set — an empty p_branch_ids is a 400 (SALE.VALIDATION.BRANCH_REQUIRED),
        // so the picker never lets the user reach it.
        onChange(ids.length === 0 ? { mode: 'ALL' } : { mode: 'SET', branchIds: ids });
      }}
      placeholder={t('accounting.reconcile.pickBranch')}
      options={[
        ...(disabled ? [] : [{ label: t('accounting.reconcile.allBranches'), value: ALL_SENTINEL }]),
        ...branches.map(b => ({ label: b.name, value: String(b.id) })),
      ]}
      size="sm"
      showChevron
      showSelectedInList
      clearable={false}
      disabled={disabled}
    />
    </div>
  );
}
