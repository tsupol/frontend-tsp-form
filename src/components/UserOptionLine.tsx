// ============================================================================
// One person as a row in a user picker dropdown — two lines:
//   username  [role]
//   company · branch
//
// Same look as the new-owner picker in ContractActions (role badge coloured by
// level). The company is on line 2 because holding-wide pickers list people of
// every company, and the branch alone does not tell two of them apart.
// Use as a Select `renderOption`; keep the option's `label` a plain one-line
// string for the closed field.
// ============================================================================

import { useTranslation } from 'react-i18next';
import { Badge } from 'tsp-form';
import { getRoleLabel } from '../lib/roleLabel';

export interface UserOptionData {
  username: string;
  role_code: string;
  company_name?: string | null;
  branch_name?: string | null;
}

type BadgeColor = 'danger' | 'warning' | 'info' | 'success' | 'default';

export function roleBadgeColor(roleCode: string): BadgeColor {
  if (roleCode.startsWith('SYSTEM')) return 'danger';
  if (roleCode.startsWith('HOLDING')) return 'warning';
  if (roleCode.startsWith('COMPANY')) return 'info';
  if (roleCode.startsWith('BRANCH')) return 'success';
  return 'default';
}

export function UserOptionLine({ user, hideCompany = false }: {
  user: UserOptionData;
  /** The list is already grouped under company headings — show the branch only. */
  hideCompany?: boolean;
}) {
  const { t } = useTranslation();
  const where = [hideCompany ? null : user.company_name, user.branch_name].filter(Boolean).join(' · ');
  return (
    <div className="min-w-0 py-0.5">
      <div className="flex items-center gap-2 min-w-0">
        <span className="truncate">{user.username}</span>
        <Badge size="xs" color={roleBadgeColor(user.role_code)} className="shrink-0">
          {getRoleLabel(t, user.role_code)}
        </Badge>
      </div>
      {where && <div className="text-xs text-subtle truncate">{where}</div>}
    </div>
  );
}
