import { useState, useEffect } from 'react';
import { Button } from 'tsp-form';

const STORAGE_KEY_ROLE = 'quick_login_last_role';
const STORAGE_KEY_BRANCH = 'quick_login_last_branch';

type RoleColor = 'danger' | 'warning' | 'info' | 'success';

interface RoleDef {
  key: string;
  label: string;
  color: RoleColor;
  // Static username for non-branch roles
  username?: string;
  // Username template for branch roles, suffix appended (e.g. 'ui_branch_manager' -> 'ui_branch_manager_a1')
  usernameTemplate?: string;
}

const ROLES: RoleDef[] = [
  { key: 'HOLD_ADMIN', label: 'HOLD_ADMIN', color: 'warning', username: 'ui_holding_admin' },
  { key: 'CO_ADMIN', label: 'CO_ADMIN', color: 'info', username: 'ui_company_admin_a' },
  { key: 'CO_ACCT', label: 'CO_ACCT', color: 'info', username: 'ui_company_accountant_a' },
  { key: 'CO_INV', label: 'CO_INV', color: 'info', username: 'ui_company_inventory_a' },
  { key: 'BR_MGR', label: 'BR_MGR', color: 'success', usernameTemplate: 'ui_branch_manager' },
  { key: 'BR_STAFF', label: 'BR_STAFF', color: 'success', usernameTemplate: 'ui_branch_staff' },
];

const BRANCHES = [
  { key: 'a1', label: 'A1' },
  { key: 'a2', label: 'A2' },
  { key: 'b1', label: 'B1' },
  { key: 'b2', label: 'B2' },
  { key: 'extx', label: 'ExtX' },
  { key: 'dpx', label: 'DPX' },
];

// BRANCH_STAFF only exists for the four main branches
const STAFF_BRANCHES = new Set(['a1', 'a2', 'b1', 'b2']);

function buildUsername(role: RoleDef, branch: string): string {
  if (role.usernameTemplate) return `${role.usernameTemplate}_${branch}`;
  return role.username || '';
}

interface QuickLoginProps {
  onSelect: (username: string, password: string) => void;
}

export function QuickLogin({ onSelect }: QuickLoginProps) {
  const [activeRole, setActiveRole] = useState<string>(() => {
    localStorage.removeItem('quick_login_last_user');
    return localStorage.getItem(STORAGE_KEY_ROLE) || '';
  });
  const [activeBranch, setActiveBranch] = useState<string>(() => {
    return localStorage.getItem(STORAGE_KEY_BRANCH) || 'a1';
  });

  const role = ROLES.find((r) => r.key === activeRole);
  const isBranchRole = !!role?.usernameTemplate;
  const availableBranches = activeRole === 'BR_STAFF'
    ? BRANCHES.filter((b) => STAFF_BRANCHES.has(b.key))
    : BRANCHES;

  useEffect(() => {
    if (role) {
      const branch = isBranchRole && !availableBranches.some((b) => b.key === activeBranch)
        ? availableBranches[0].key
        : activeBranch;
      onSelect(buildUsername(role, branch), 'Test123456');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRoleClick = (roleKey: string) => {
    setActiveRole(roleKey);
    localStorage.setItem(STORAGE_KEY_ROLE, roleKey);
    const next = ROLES.find((r) => r.key === roleKey);
    if (!next) return;
    const nextAvailable = roleKey === 'BR_STAFF'
      ? BRANCHES.filter((b) => STAFF_BRANCHES.has(b.key))
      : BRANCHES;
    const branch = next.usernameTemplate && !nextAvailable.some((b) => b.key === activeBranch)
      ? nextAvailable[0].key
      : activeBranch;
    if (branch !== activeBranch) {
      setActiveBranch(branch);
      localStorage.setItem(STORAGE_KEY_BRANCH, branch);
    }
    onSelect(buildUsername(next, branch), 'Test123456');
  };

  const handleBranchClick = (branchKey: string) => {
    setActiveBranch(branchKey);
    localStorage.setItem(STORAGE_KEY_BRANCH, branchKey);
    if (role && isBranchRole) {
      onSelect(buildUsername(role, branchKey), 'Test123456');
    }
  };

  return (
    <div className="flex flex-col gap-2 mb-4">
      <label className="form-label">Quick login</label>
      <div className="flex flex-wrap gap-1">
        {ROLES.map((r) => (
          <Button
            key={r.key}
            type="button"
            size="sm"
            color={r.color}
            variant={activeRole === r.key ? 'solid' : 'outline'}
            onClick={() => handleRoleClick(r.key)}
          >
            {r.label}
          </Button>
        ))}
      </div>
      {isBranchRole && (
        <div className="flex flex-wrap gap-1">
          {availableBranches.map((b) => (
            <Button
              key={b.key}
              type="button"
              size="sm"
              color="success"
              variant={activeBranch === b.key ? 'solid' : 'outline'}
              onClick={() => handleBranchClick(b.key)}
            >
              {b.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
