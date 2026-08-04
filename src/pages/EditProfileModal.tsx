import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Modal, Button, Input, InputDatePicker, TextArea, FormErrorMessage } from 'tsp-form';
import { Keyboard, XCircle } from 'lucide-react';
import { apiClient, ApiError } from '../lib/api';
import { PhoneInput } from '../components/PhoneInput';
import { useAuth } from '../contexts/AuthContext';
import { useFormSnapshot } from '../hooks/useFormSnapshot';
import { makeDatePickerFormat, parseLocalDate, toLocalDateStr } from '../lib/format';
import type { UserProfile } from '../lib/auth';
import { ActionDoneView } from './contracts/ActionDoneView';
import { translateApiError } from '../lib/apiErrors';

// Self-editable profile fields (allow-list mirrors api.me_profile_update —
// see UI_FEEDBACK/2026-07-05_DELIVERY_me_profile_update_self_service.md).
// national_id / role / branch / email are admin-only and stay read-only.
type EditableFields = {
  firstname: string;
  lastname: string;
  nickname: string;
  tel: string;
  address: string;
  date_of_birth: string; // YYYY-MM-DD or ''
};

function fieldsFrom(profile: UserProfile | null): EditableFields {
  return {
    firstname: profile?.firstname ?? '',
    lastname: profile?.lastname ?? '',
    nickname: profile?.nickname ?? '',
    tel: profile?.tel ?? '',
    address: profile?.address ?? '',
    date_of_birth: profile?.date_of_birth ? toLocalDateStr(parseLocalDate(profile.date_of_birth)) : '',
  };
}

interface Props {
  open: boolean;
  onClose: () => void;
  profile: UserProfile | null;
}

export function EditProfileModal({ open, onClose, profile }: Props) {
  const { t, i18n } = useTranslation();
  const { refreshUser } = useAuth();
  const queryClient = useQueryClient();

  const [view, setView] = useState<'form' | 'done'>('form');
  const [fields, setFields] = useState<EditableFields>(() => fieldsFrom(profile));
  const [isTypingDob, setIsTypingDob] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  const snapshot = useFormSnapshot(fields as unknown as Record<string, unknown>);

  // Reset to a clean form seeded from the current profile each time the modal opens.
  useEffect(() => {
    if (open) {
      setView('form');
      setFields(fieldsFrom(profile));
      setIsTypingDob(false);
      setApiError(null);
      setConfirmClose(false);
      snapshot.resetNext();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, profile]);

  const set = <K extends keyof EditableFields>(key: K, value: EditableFields[K]) =>
    setFields((f) => ({ ...f, [key]: value }));

  const forceClose = () => {
    setConfirmClose(false);
    onClose();
  };

  const handleClose = () => {
    if (view === 'done') { forceClose(); return; }
    if (snapshot.isDirty) { setConfirmClose(true); return; }
    forceClose();
  };

  // Build a partial patch — only fields that changed from the seeded baseline.
  const buildPatch = (): Partial<EditableFields> => {
    const base = fieldsFrom(profile);
    const patch: Partial<EditableFields> = {};
    (Object.keys(fields) as (keyof EditableFields)[]).forEach((k) => {
      if (fields[k] !== base[k]) patch[k] = fields[k];
    });
    return patch;
  };

  const onSubmit = async () => {
    setApiError(null);
    const patch = buildPatch();
    if (Object.keys(patch).length === 0) { forceClose(); return; }
    setSubmitting(true);
    try {
      await apiClient.rpc('me_profile_update', { p_patch: patch });
      await queryClient.invalidateQueries({ queryKey: ['me', 'profile'] });
      await refreshUser();
      snapshot.reset();
      setView('done');
    } catch (err) {
      if (err instanceof ApiError) {
        const translated = translateApiError(err, t);
        setApiError(translated || err.message);
      } else {
        setApiError(t('common.error'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const fullName = [fields.firstname, fields.lastname].filter(Boolean).join(' ') || fields.nickname || '—';

  return (
    <>
      <Modal open={open} onClose={handleClose} maxWidth="30rem" width="100%">
        {view === 'form' && (
          <>
            <div className="modal-header">
              <h2 className="modal-title">{t('profile.editProfile')}</h2>
              <button type="button" className="modal-close-btn" onClick={handleClose} aria-label="Close">×</button>
            </div>
            <div className="modal-content">
              <div className="form-grid">
                {apiError && (
                  <div className="alert alert-danger">
                    <XCircle size={18} />
                    <div><div className="alert-description">{apiError}</div></div>
                  </div>
                )}

                <div className="flex gap-3">
                  <div className="flex flex-col flex-1 min-w-0">
                    <label className="form-label">{t('profile.firstname')}</label>
                    <Input value={fields.firstname} onChange={(e) => set('firstname', e.target.value)} className="w-full" />
                  </div>
                  <div className="flex flex-col flex-1 min-w-0">
                    <label className="form-label">{t('profile.lastname')}</label>
                    <Input value={fields.lastname} onChange={(e) => set('lastname', e.target.value)} className="w-full" />
                  </div>
                </div>

                <div className="flex gap-3">
                  <div className="flex flex-col flex-1 min-w-0">
                    <label className="form-label">{t('profile.nickname')}</label>
                    <Input value={fields.nickname} onChange={(e) => set('nickname', e.target.value)} className="w-full" />
                  </div>
                  <div className="flex flex-col flex-1 min-w-0">
                    <label className="form-label">{t('profile.tel')}</label>
                    <PhoneInput value={fields.tel} onChange={(raw) => set('tel', raw)} className="w-full" />
                  </div>
                </div>

                <div className="flex flex-col">
                  <label className="form-label">{t('profile.dateOfBirth')}</label>
                  <InputDatePicker
                    value={parseLocalDate(fields.date_of_birth)}
                    onChange={(date) => set('date_of_birth', toLocalDateStr(date))}
                    endIcon={<Keyboard size={16} />}
                    onEndIconClick={() => setIsTypingDob((v) => !v)}
                    calendar="gregorian"
                    locale={i18n.language}
                    dateFormat={makeDatePickerFormat(i18n.language)}
                    typingMode={isTypingDob}
                    onTypingModeChange={setIsTypingDob}
                    typingMask="##/##/####"
                    typingPlaceholder="DD/MM/YYYY"
                    parseTypedDate={(raw) => {
                      if (raw.length !== 8) return null;
                      const day = parseInt(raw.slice(0, 2), 10);
                      const month = parseInt(raw.slice(2, 4), 10);
                      let year = parseInt(raw.slice(4, 8), 10);
                      if (year > 2400) year -= 543;
                      if (month < 1 || month > 12 || day < 1 || day > 31) return null;
                      const d = new Date(year, month - 1, day);
                      if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
                      return d;
                    }}
                  />
                  <FormErrorMessage />
                </div>

                <div className="flex flex-col">
                  <label className="form-label">{t('profile.address')}</label>
                  <TextArea
                    value={fields.address}
                    onChange={(e) => set('address', e.target.value)}
                    rows={3}
                    className="w-full"
                  />
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <Button variant="ghost" onClick={handleClose}>{t('common.cancel')}</Button>
              <Button color="primary" onClick={onSubmit} disabled={submitting || !snapshot.isDirty}>
                {submitting ? t('common.loading') : t('common.save')}
              </Button>
            </div>
          </>
        )}

        {view === 'done' && (
          <ActionDoneView
            headline={t('profile.profileUpdated')}
            contractCode={fullName}
            detailRows={[
              { label: t('profile.firstname'), value: fields.firstname || '—' },
              { label: t('profile.lastname'), value: fields.lastname || '—' },
              { label: t('profile.nickname'), value: fields.nickname || '—' },
              { label: t('profile.tel'), value: fields.tel || '—' },
              { label: t('profile.dateOfBirth'), value: fields.date_of_birth || '—' },
              { label: t('profile.address'), value: fields.address || '—' },
            ]}
            onClose={forceClose}
          />
        )}
      </Modal>

      <Modal open={confirmClose} onClose={() => setConfirmClose(false)} maxWidth="24rem" width="100%">
        <div className="modal-header"><h2 className="modal-title">{t('common.unsavedChanges')}</h2></div>
        <div className="modal-content"><p>{t('common.unsavedChangesMessage')}</p></div>
        <div className="modal-footer">
          <Button variant="ghost" onClick={() => setConfirmClose(false)}>{t('common.cancel')}</Button>
          <Button color="danger" onClick={forceClose}>{t('common.discard')}</Button>
        </div>
      </Modal>
    </>
  );
}
