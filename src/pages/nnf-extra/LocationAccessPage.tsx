// Who has been given the personal "may view device locations" grant (UI_SUMMARY
// 159 §3). Only SYSTEM_DEV / HOLDING_ADMIN (can_grant). The other ways in — the
// collection pool, the repo grant, branch manager, company admin — come from the
// person's job and are not listed or managed here.

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, DataTable, Input, MobileHeader, Modal, Select } from 'tsp-form';
import { ArrowRightFromLine, Loader2, Plus, UserMinus } from 'lucide-react';
import { apiClient } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import { DateTime } from '../../components/DateTime';
import { ModalErrorBand } from '../../components/ModalErrorBand';
import { ActionDoneView } from '../contracts/ActionDoneView';
import {
  fetchLocationGrants, setLocationGrant, useLocationViewCan, type LocationGrant,
} from '../../components/deviceLocation/deviceLocationApi';

const GRANTS_KEY = ['mdm-location-grants'];

export function LocationAccessPage() {
  const { t } = useTranslation();
  const { data: can, isLoading: canLoading } = useLocationViewCan();
  const canGrant = can?.can_grant === true;

  const { data: grants = [], isLoading, error } = useQuery({
    queryKey: GRANTS_KEY,
    queryFn: fetchLocationGrants,
    enabled: canGrant,
  });

  const [addOpen, setAddOpen] = useState(false);
  const [revoke, setRevoke] = useState<LocationGrant | null>(null);

  const addButton = canGrant && (
    <Button color="primary" size="sm" startIcon={<Plus size={14} />} onClick={() => setAddOpen(true)}>
      {t('locationAccess.add')}
    </Button>
  );

  return (
    <>
      <MobileHeader className="mobile-header-bordered md:hidden">
        <div className="mobile-header-start">
          <button
            className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current"
            aria-label="Open menu"
            onClick={() => window.dispatchEvent(new CustomEvent('sidemenu:open'))}
          >
            <ArrowRightFromLine size={18} />
          </button>
        </div>
        <div className="mobile-header-title mobile-header-title-truncate">{t('locationAccess.title')}</div>
        <div className="mobile-header-end w-nav" />
      </MobileHeader>

      <div className="page-content responsive-dvh-mobile-header">
        <div className="flex items-center justify-between gap-3 mb-1 flex-none max-md:hidden">
          <h1 className="heading-2">{t('locationAccess.title')}</h1>
          {addButton}
        </div>
        <p className="text-sm text-subtle mb-4 flex-none">{t('locationAccess.hint')}</p>
        <div className="md:hidden mb-3 flex-none">{addButton}</div>

        {!canLoading && !canGrant ? (
          <div className="alert alert-warning"><span>{t('locationAccess.notAllowed')}</span></div>
        ) : error ? (
          <div className="alert alert-danger"><span>{translateApiError(error, t)}</span></div>
        ) : (
          <DataTable<LocationGrant>
            outlined
            data={grants}
            columns={[
              { id: 'username', header: t('locationAccess.col.user'), cell: ({ row }) => <span className="font-medium">{row.original.username}</span> },
              { id: 'role', header: t('locationAccess.col.role'), cell: ({ row }) => t(`role.${row.original.role_code}`, { defaultValue: row.original.role_code }) },
              { id: 'note', header: t('locationAccess.col.note'), cell: ({ row }) => row.original.note ?? '—' },
              { id: 'granted_at', header: t('locationAccess.col.grantedAt'), cell: ({ row }) => <DateTime value={row.original.granted_at} /> },
              {
                id: 'actions',
                header: '',
                className: 'w-10',
                cell: ({ row }) => (
                  <Button
                    size="sm"
                    variant="ghost"
                    color="danger"
                    startIcon={<UserMinus size={14} />}
                    onClick={() => setRevoke(row.original)}
                  >
                    {t('locationAccess.revoke')}
                  </Button>
                ),
              },
            ]}
            className={`flex-1 min-h-0 ${isLoading ? 'opacity-60' : ''}`}
            noResults={<div className="p-8 text-center text-subtler">{isLoading ? t('common.loading') : t('locationAccess.empty')}</div>}
          />
        )}
      </div>

      <GrantDialog open={addOpen} onClose={() => setAddOpen(false)} />
      <RevokeDialog grant={revoke} onClose={() => setRevoke(null)} />
    </>
  );
}

interface UserOption {
  id: number;
  username: string;
  role_code: string;
  branch_name: string | null;
  company_name: string | null;
}

function GrantDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [view, setView] = useState<'form' | 'done'>('form');
  const [userId, setUserId] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const picked = useRef<UserOption | null>(null);

  useEffect(() => {
    if (open) {
      setView('form'); setUserId(null); setNote(''); setError(null); setSaving(false);
      setConfirmClose(false); setSearch(''); setDebounced(''); picked.current = null;
    }
  }, [open]);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(id);
  }, [search]);

  const { data: users = [], isFetching } = useQuery({
    queryKey: ['location-access-users', debounced],
    queryFn: () => apiClient.get<UserOption[]>(
      `/v_users?is_active=is.true&username=ilike.*${encodeURIComponent(debounced)}*&select=id,username,role_code,branch_name,company_name&order=username&limit=30`,
    ),
    enabled: open && debounced.length >= 2,
    staleTime: 60_000,
  });

  // Keep the chosen person selectable while the search moves on.
  const shown = picked.current && !users.some((u) => u.id === picked.current!.id) ? [picked.current, ...users] : users;
  const options = shown.map((u) => ({
    value: String(u.id),
    label: `${u.username} · ${t(`role.${u.role_code}`, { defaultValue: u.role_code })}${u.branch_name || u.company_name ? ` · ${u.branch_name ?? u.company_name}` : ''}`,
  }));

  const isDirty = userId != null || note.trim().length > 0;
  const canSubmit = !saving && userId != null && note.trim().length > 0;
  const forceClose = () => { setConfirmClose(false); onClose(); };
  const handleClose = () => {
    if (view === 'done' || !isDirty) { forceClose(); return; }
    setConfirmClose(true);
  };

  const submit = async () => {
    if (!canSubmit || userId == null) return;
    setSaving(true);
    setError(null);
    try {
      await setLocationGrant(userId, true, note.trim());
      setView('done');
      queryClient.invalidateQueries({ queryKey: GRANTS_KEY });
    } catch (err) {
      setError(translateApiError(err, t));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Modal open={open} onClose={handleClose} maxWidth="30rem" width="100%" ariaLabel={t('locationAccess.add')}>
        <div className="modal-header">
          <h2 className="modal-title">{t('locationAccess.add')}</h2>
          <button type="button" className="modal-close-btn" onClick={handleClose}>×</button>
        </div>
        {view === 'done' ? (
          <ActionDoneView
            headline={t('locationAccess.doneAdd')}
            contractCode={picked.current?.username ?? ''}
            detailRows={[{ label: t('locationAccess.col.note'), value: note.trim() }]}
            onClose={forceClose}
          />
        ) : (
          <>
            <div className="modal-content">
              <div className="form-grid pb-0">
                <div className="flex flex-col">
                  <label className="form-label">{t('locationAccess.col.user')} <span className="text-danger">*</span></label>
                  <Select
                    options={options}
                    value={userId != null ? String(userId) : null}
                    onChange={(v) => {
                      const id = v ? Number(v) : null;
                      setUserId(id);
                      picked.current = shown.find((u) => u.id === id) ?? null;
                    }}
                    onSearchChange={setSearch}
                    filterOptions={false}
                    loading={isFetching}
                    placeholder={t('locationAccess.userPlaceholder')}
                    size="sm"
                    showChevron
                  />
                </div>
                <div className="flex flex-col">
                  <label className="form-label">{t('locationAccess.col.note')} <span className="text-danger">*</span></label>
                  <Input size="sm" className="w-full" value={note} onChange={(e) => setNote(e.target.value)} />
                </div>
              </div>
            </div>
            <ModalErrorBand message={error} onDismiss={() => setError(null)} />
            <div className="modal-footer">
              <Button variant="ghost" onClick={handleClose} disabled={saving}>{t('common.cancel')}</Button>
              <Button color="primary" disabled={!canSubmit} startIcon={saving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} onClick={submit}>
                {t('locationAccess.add')}
              </Button>
            </div>
          </>
        )}
      </Modal>
      <DiscardModal open={confirmClose} onStay={() => setConfirmClose(false)} onDiscard={forceClose} />
    </>
  );
}

function RevokeDialog({ grant: grantProp, onClose }: { grant: LocationGrant | null; onClose: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const open = grantProp != null;
  // The parent clears the row on close; keep showing it through the transition.
  const last = useRef(grantProp);
  if (grantProp) last.current = grantProp;
  const grant = grantProp ?? last.current;

  const [view, setView] = useState<'form' | 'done'>('form');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);

  useEffect(() => {
    if (open) { setView('form'); setNote(''); setError(null); setSaving(false); setConfirmClose(false); }
  }, [open]);

  const forceClose = () => { setConfirmClose(false); onClose(); };
  const handleClose = () => {
    if (view === 'done' || !note.trim()) { forceClose(); return; }
    setConfirmClose(true);
  };

  const submit = async () => {
    if (!grant || !note.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      await setLocationGrant(grant.user_id, false, note.trim());
      setView('done');
      queryClient.invalidateQueries({ queryKey: GRANTS_KEY });
    } catch (err) {
      setError(translateApiError(err, t));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Modal open={open} onClose={handleClose} maxWidth="28rem" width="100%" ariaLabel={t('locationAccess.revoke')}>
        <div className="modal-header">
          <h2 className="modal-title">{t('locationAccess.revoke')}</h2>
          <button type="button" className="modal-close-btn" onClick={handleClose}>×</button>
        </div>
        {view === 'done' ? (
          <ActionDoneView
            headline={t('locationAccess.doneRevoke')}
            contractCode={grant?.username ?? ''}
            detailRows={[{ label: t('locationAccess.col.note'), value: note.trim() }]}
            onClose={forceClose}
          />
        ) : (
          <>
            <div className="modal-content">
              <div className="flex flex-col gap-3">
                <div className="px-3 py-2.5 rounded-md bg-surface border border-line">
                  <div className="font-medium text-sm">{grant?.username}</div>
                </div>
                <div className="form-grid pb-0">
                  <div className="flex flex-col">
                    <label className="form-label">{t('locationAccess.col.note')} <span className="text-danger">*</span></label>
                    <Input size="sm" className="w-full" value={note} onChange={(e) => setNote(e.target.value)} />
                  </div>
                </div>
              </div>
            </div>
            <ModalErrorBand message={error} onDismiss={() => setError(null)} />
            <div className="modal-footer">
              <Button variant="ghost" onClick={handleClose} disabled={saving}>{t('common.cancel')}</Button>
              <Button color="danger" disabled={!note.trim() || saving} startIcon={saving ? <Loader2 size={16} className="animate-spin" /> : <UserMinus size={16} />} onClick={submit}>
                {t('locationAccess.revoke')}
              </Button>
            </div>
          </>
        )}
      </Modal>
      <DiscardModal open={confirmClose} onStay={() => setConfirmClose(false)} onDiscard={forceClose} />
    </>
  );
}

function DiscardModal({ open, onStay, onDiscard }: { open: boolean; onStay: () => void; onDiscard: () => void }) {
  const { t } = useTranslation();
  return (
    <Modal open={open} onClose={onStay} maxWidth="24rem" width="100%">
      <div className="modal-header"><h2 className="modal-title">{t('common.unsavedChanges')}</h2></div>
      <div className="modal-content"><p>{t('common.unsavedChangesMessage')}</p></div>
      <div className="modal-footer">
        <Button variant="ghost" onClick={onStay}>{t('common.cancel')}</Button>
        <Button color="danger" onClick={onDiscard}>{t('common.discard')}</Button>
      </div>
    </Modal>
  );
}
