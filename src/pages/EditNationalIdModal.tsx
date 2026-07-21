import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Modal, Button, MaskedInput, FormErrorMessage } from 'tsp-form';
import { ShieldCheck, XCircle } from 'lucide-react';
import { apiClient, ApiError } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import type { UserProfile } from '../lib/auth';
import { ActionDoneView } from './contracts/ActionDoneView';

interface Props {
  open: boolean;
  onClose: () => void;
  profile: UserProfile | null;
}

interface SetResult {
  has_national_id: boolean;
  national_id_last4: string | null;
}

export function EditNationalIdModal({ open, onClose, profile }: Props) {
  const { t } = useTranslation();
  const { refreshUser } = useAuth();
  const queryClient = useQueryClient();

  const [view, setView] = useState<'form' | 'done'>('form');
  const [cid, setCid] = useState(''); // raw digits, no separators
  const [submitting, setSubmitting] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [result, setResult] = useState<SetResult | null>(null);

  // Fresh, empty form on each open — the full number is never seeded (we don't hold it).
  useEffect(() => {
    if (open) {
      setView('form');
      setCid('');
      setSubmitting(false);
      setApiError(null);
      setConfirmClose(false);
      setResult(null);
    }
  }, [open]);

  const isDirty = cid.length > 0;

  const forceClose = () => {
    setConfirmClose(false);
    onClose();
  };

  const handleClose = () => {
    if (view === 'done') { forceClose(); return; }
    if (isDirty) { setConfirmClose(true); return; }
    forceClose();
  };

  const onSubmit = async () => {
    setApiError(null);
    setSubmitting(true);
    try {
      // Backend validates the Thai checksum + encrypts; accepts dashes/spaces but we send raw digits.
      const res = await apiClient.rpc<SetResult>('me_national_id_set', { p_national_id: cid });
      setResult(res);
      await queryClient.invalidateQueries({ queryKey: ['me', 'profile'] });
      await refreshUser();
      setView('done');
    } catch (err) {
      if (err instanceof ApiError) {
        const translated = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
          || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
        setApiError(translated || err.message);
      } else {
        setApiError(t('common.error'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const isReplacing = !!profile?.has_national_id;

  return (
    <>
      <Modal open={open} onClose={handleClose} maxWidth="28rem" width="100%">
        {view === 'form' && (
          <>
            <div className="modal-header">
              <h2 className="modal-title">{t('profile.nationalId')}</h2>
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

                {isReplacing && profile?.national_id_last4 && (
                  <div className="text-sm text-subtle">
                    {t('profile.nationalIdCurrent', { last4: profile.national_id_last4 })}
                  </div>
                )}

                <div className="flex flex-col">
                  <label className="form-label">{t('profile.nationalIdNumber')}</label>
                  <MaskedInput
                    mask="#-####-#####-##-#"
                    value={cid}
                    onChange={(raw) => { setCid(raw); if (apiError) setApiError(null); }}
                    placeholder="X-XXXX-XXXXX-XX-X"
                    className="w-full"
                    autoFocus
                  />
                  <FormErrorMessage />
                  <p className="text-xs text-subtle mt-1.5">{t('profile.nationalIdHint')}</p>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <Button variant="ghost" onClick={handleClose}>{t('common.cancel')}</Button>
              <Button color="primary" onClick={onSubmit} disabled={submitting || cid.length !== 13}>
                {submitting ? t('common.loading') : t('common.save')}
              </Button>
            </div>
          </>
        )}

        {view === 'done' && result && (
          <ActionDoneView
            headline={t('profile.nationalIdSaved')}
            contractCode={t('profile.nationalIdMasked', { last4: result.national_id_last4 ?? '' })}
            extras={
              <div className="alert alert-warning">
                <ShieldCheck size={18} />
                <div><div className="alert-description">{t('profile.nationalIdConfirmLast4')}</div></div>
              </div>
            }
            detailRows={[
              { label: t('profile.nationalIdLast4'), value: result.national_id_last4 ?? '—', emphasis: true },
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
