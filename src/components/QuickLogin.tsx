import { useState, useEffect } from 'react';
import { Button } from 'tsp-form';

const STORAGE_KEY = 'quick_login_last_user';

const USERS = [
  { username: 'alice', role: 'SYS_DEV', color: 'danger' as const },
  { username: 'ui_holding_admin', role: 'HOLD_ADMIN', color: 'warning' as const },
  { username: 'ui_company_admin', role: 'CO_ADMIN', color: 'info' as const },
  { username: 'ui_company_inventory', role: 'CO_INV', color: 'info' as const },
  { username: 'ui_branch_manager', role: 'BR_MGR', color: 'success' as const },
  { username: 'ui_branch_staff', role: 'BR_STAFF', color: 'success' as const },
];

interface QuickLoginProps {
  onSelect: (username: string, password: string) => void;
}

export function QuickLogin({ onSelect }: QuickLoginProps) {
  const [active, setActive] = useState<string>(() => {
    return localStorage.getItem(STORAGE_KEY) || '';
  });

  useEffect(() => {
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
      <div className="flex flex-wrap gap-1">
        {USERS.map((u) => (
          <Button
            key={u.username}
            type="button"
            size="sm"
            color={u.color}
            variant={active === u.username ? 'solid' : 'outline'}
            onClick={() => handleClick(u.username)}
          >
            {u.role}
          </Button>
        ))}
      </div>
    </div>
  );
}
