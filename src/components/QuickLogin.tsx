import { useState, useEffect } from 'react';
import { Button } from 'tsp-form';

const STORAGE_KEY = 'quick_login_last_user';

const GROUPS = [
  {
    label: 'System / Holding',
    users: [
      { username: 'alice', role: 'SYS_DEV' },
      { username: 'test_holding_admin', role: 'HOLD_ADMIN' },
    ],
  },
  {
    label: 'Company',
    users: [
      { username: 'test_company_admin', role: 'CO_ADMIN' },
      { username: 'test_company_accountant', role: 'CO_ACCT' },
      { username: 'test_company_inventory', role: 'CO_INV' },
      { username: 'test_company_collector', role: 'CO_COLL' },
      { username: 'test_company_repo', role: 'CO_REPO' },
    ],
  },
  {
    label: 'Branch',
    users: [
      { username: 'test_branch_manager', role: 'BR_MGR' },
      { username: 'test_branch_staff', role: 'BR_STAFF' },
    ],
  },
];

interface QuickLoginProps {
  onSelect: (username: string, password: string) => void;
}

export function QuickLogin({ onSelect }: QuickLoginProps) {
  const [active, setActive] = useState<string>(() => {
    return localStorage.getItem(STORAGE_KEY) || '';
  });

  useEffect(() => {
    // Auto-select last used on mount
    if (active) {
      onSelect(active, 'Test123456');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleClick = (username: string) => {
    setActive(username);
    localStorage.setItem(STORAGE_KEY, username);
    onSelect(username, 'Test123456');
  };

  return (
    <div className="flex flex-col gap-2 mb-4">
      <label className="form-label">Quick login</label>
      {GROUPS.map((group) => (
        <div key={group.label}>
          <div className="text-xs text-text-muted mb-1">{group.label}</div>
          <div className="flex flex-wrap gap-1">
            {group.users.map((u) => (
              <Button
                key={u.username}
                type="button"
                size="sm"
                color={active === u.username ? 'primary' : undefined}
                variant={active === u.username ? 'solid' : 'outline'}
                onClick={() => handleClick(u.username)}
              >
                {u.role}
              </Button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
