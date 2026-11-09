// ============================================================================
// Surface 4a — "permission grants" for ONE user, opened from the users list.
//
// The switches themselves live in UserGrantsPanel, shared with the detail
// panel of the permission-grants page; this is only the window around them.
// ============================================================================

import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Button } from 'tsp-form';
import { UserGrantsPanel, type GrantTargetUser } from './UserGrantsPanel';

export type { GrantTargetUser };

export function UserPermissionGrantsModal({ user: userProp, open, onClose }: {
  user: GrantTargetUser | null;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  // The users list clears its row on close; keep showing it while the window fades.
  const last = useRef(userProp);
  if (userProp) last.current = userProp;
  const user = userProp ?? last.current;

  return (
    <Modal open={open} onClose={onClose} maxWidth="34rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">{t('permissionGrants.manageFor')}</h2>
        <button type="button" className="modal-close-btn" onClick={onClose} aria-label={t('common.close')}>&times;</button>
      </div>

      <div className="modal-content min-w-0">
        <div className="flex flex-col gap-4">
          <div className="px-3 py-2.5 rounded-md bg-surface border border-line">
            <div className="font-medium text-sm">{user?.username ?? '—'}</div>
            <div className="text-xs text-subtle">
              {t(`role.${user?.role_code}`, { defaultValue: user?.role_code ?? '' })}
              {user?.company_name && ` · ${t('permissionGrants.companyScope', { company: user.company_name })}`}
            </div>
          </div>
          {user && <UserGrantsPanel user={user} enabled={open} />}
        </div>
      </div>

      <div className="modal-footer">
        <Button variant="outline" onClick={onClose}>{t('common.close')}</Button>
      </div>
    </Modal>
  );
}
