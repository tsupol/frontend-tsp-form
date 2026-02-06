import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PopOver } from 'tsp-form';
import { ChevronsUpDown, ChevronRight, LogOut, Check } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';

function MenuItem({
  label,
  onClick,
  icon,
  checked,
}: {
  label: string;
  onClick?: () => void;
  icon?: React.ReactNode;
  checked?: boolean;
}) {
  return (
    <button
      className="w-full text-left px-3 py-2 text-sm hover:bg-surface-hover transition-colors cursor-pointer flex items-center gap-2"
      onClick={onClick}
    >
      {checked !== undefined && (
        <span className="w-4 h-4 flex items-center justify-center">
          {checked && <Check size={14} />}
        </span>
      )}
      {icon && <span className="w-4 h-4 flex items-center justify-center">{icon}</span>}
      <span className="flex-1">{label}</span>
    </button>
  );
}

function SubMenu({
  label,
  options,
  value,
  onSelect,
}: {
  label: string;
  options: { value: string; label: string }[];
  value: string;
  onSelect: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleClose = () => {
    closeTimer.current = setTimeout(() => setOpen(false), 150);
  };

  const cancelClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  };

  const handleSelect = (val: string) => {
    onSelect(val);
    setOpen(false);
  };

  return (
    <PopOver
      isOpen={open}
      onClose={() => setOpen(false)}
      placement="right"
      align="start"
      offset={0}
      openDelay={0}
      trigger={
        <button
          className="w-full text-left px-3 py-2 text-sm hover:bg-surface-hover transition-colors cursor-pointer flex items-center justify-between"
          onMouseEnter={() => {
            cancelClose();
            setOpen(true);
          }}
          onMouseLeave={() => scheduleClose()}
        >
          <span>{label}</span>
          <ChevronRight size={14} />
        </button>
      }
    >
      <div
        className="py-1 min-w-[140px]"
        onMouseEnter={() => cancelClose()}
        onMouseLeave={() => scheduleClose()}
      >
        {options.map((opt) => (
          <MenuItem
            key={opt.value}
            label={opt.label}
            onClick={() => handleSelect(opt.value)}
            checked={value === opt.value}
          />
        ))}
      </div>
    </PopOver>
  );
}

function getInitials(name: string): string {
  if (!name) return '??';
  const words = name.trim().split(/\s+/);
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

interface UserMenuProps {
  collapsed?: boolean;
}

export function UserMenu({ collapsed }: UserMenuProps) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);

  const handleLogout = async () => {
    setMenuOpen(false);
    await logout();
    navigate('/login');
  };

  const initials = getInitials(user?.username || '');

  return (
    <PopOver
      isOpen={menuOpen}
      onClose={() => setMenuOpen(false)}
      placement="top"
      align="start"
      offset={4}
      trigger={
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          className="flex items-center gap-2 py-2 px-1 rounded-lg transition-all text-item-fg hover:bg-item-hover-bg w-full"
        >
          {/* Avatar with initials */}
          <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-primary-contrast text-xs font-semibold shrink-0">
            {initials}
          </div>

          {!collapsed && (
            <>
              <div className="flex-1 text-left truncate">
                <span className="text-sm">{user?.username ?? 'User'}</span>
              </div>
              <ChevronsUpDown size={14} className="opacity-50 shrink-0" />
            </>
          )}
        </button>
      }
    >
      <div className="py-1 w-[260px]">
        <SubMenu
          label={t('theme.title')}
          value={theme}
          onSelect={(val) => setTheme(val as 'light' | 'dark' | 'system')}
          options={[
            { value: 'light', label: t('theme.light') },
            { value: 'dark', label: t('theme.dark') },
            { value: 'system', label: t('theme.system') },
          ]}
        />
        <SubMenu
          label={t('language.title')}
          value={i18n.language}
          onSelect={(val) => i18n.changeLanguage(val)}
          options={[
            { value: 'en', label: t('language.en') },
            { value: 'th', label: t('language.th') },
          ]}
        />
        <hr className="my-1 border-line" />
        <MenuItem
          label={t('auth.logout')}
          onClick={handleLogout}
          icon={<LogOut size={14} />}
        />
      </div>
    </PopOver>
  );
}
