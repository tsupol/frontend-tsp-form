// Add an ABM account (Company → ABM account OTP → Manage).
//
// This modal is unusual in one way that drives its whole shape: the response
// contains a `token` that is shown EXACTLY ONCE. The DB keeps only a hash and
// there is no endpoint to read it back. If the user closes without copying it,
// the only recovery is creating another account with the same email — which
// immediately kills the old key and means re-doing the iOS Shortcut on the
// phone. So the success step is deliberately loud, is not an ActionDoneView
// (which would render a secret as just another receipt row), and its close
// button is worded as an acknowledgement.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Button, Input, Select } from 'tsp-form';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, KeyRound, CheckCircle } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import { CopyButton } from '../../components/CopyButton';
import { ModalErrorBand } from '../../components/ModalErrorBand';
import type { AbmOtpSourceCreated } from './abmOtpTypes';

interface Branch { id: number; name: string; }

interface Props {
  open: boolean;
  companyId: number | null;
  onClose: () => void;
  onCreated: () => void;
}

export function AbmOtpSourceCreateModal({ open, companyId, onClose, onCreated }: Props) {
  const { t } = useTranslation();

  const [view, setView] = useState<'form' | 'done'>('form');
  const [email, setEmail] = useState('');
  const [label, setLabel] = useState('');
  const [branchId, setBranchId] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<AbmOtpSourceCreated | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  const { data: branches = [] } = useQuery({
    queryKey: ['branches-active'],
    queryFn: () => apiClient.get<Branch[]>('/v_branches?is_active=is.true&order=name'),
    staleTime: 5 * 60 * 1000,
    enabled: open,
  });

  useEffect(() => {
    if (open) {
      setView('form'); setEmail(''); setLabel(''); setBranchId('');
      setBusy(false); setError(''); setResult(null); setConfirmClose(false);
    }
  }, [open]);

  const isDirty = email.trim() !== '' || label.trim() !== '' || branchId !== '';

  const forceClose = () => { setConfirmClose(false); onClose(); };

  const handleClose = () => {
    if (busy) return;
    // Once the token is on screen the form is no longer the thing at risk —
    // but the token is, so that view has its own acknowledgement instead.
    if (view === 'done') { forceClose(); return; }
    if (isDirty) { setConfirmClose(true); return; }
    forceClose();
  };

  const submit = async () => {
    if (companyId == null) return;
    setBusy(true);
    setError('');
    try {
      // Send every key including the nulls — omitting optional params makes
      // PostgREST fail to resolve the overload (PGRST202).
      const res = await apiClient.rpc<AbmOtpSourceCreated>('fn_abm_otp_source_create', {
        p_company_id: companyId,
        p_login_email: email.trim(),
        p_label: label.trim() || null,
        p_abm_tenant_id: null,
        p_branch_id: branchId ? Number(branchId) : null,
      });
      setResult(res);
      setView('done');
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? translateApiError(err, t) : t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  const branchOptions = branches.map(b => ({ value: String(b.id), label: b.name }));
  const canSubmit = !busy && email.trim().length > 0 && companyId != null;

  return (
    <>
      <Modal open={open} onClose={handleClose} maxWidth="32rem" width="100%">
        <div className="modal-header">
          <h2 className="modal-title">
            {view === 'done' ? t('abmOtp.create.doneTitle') : t('abmOtp.create.title')}
          </h2>
          <button type="button" className="modal-close-btn" onClick={handleClose}>&times;</button>
        </div>

        {view === 'form' ? (
          <>
            <div className="modal-content">
              <div className="form-grid">
                <div className="flex flex-col">
                  <label className="form-label">{t('abmOtp.create.email')} *</label>
                  <Input
                    className="w-full"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="admin@example.co.th"
                  />
                </div>
                <div className="flex flex-col">
                  <label className="form-label">{t('abmOtp.create.label')}</label>
                  <Input
                    className="w-full"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder={t('abmOtp.create.labelPlaceholder')}
                  />
                </div>
                <div className="flex flex-col">
                  <label className="form-label">{t('abmOtp.create.branch')}</label>
                  <Select
                    options={branchOptions}
                    value={branchId || null}
                    onChange={(v) => setBranchId((v as string) ?? '')}
                    placeholder={t('abmOtp.create.branchAllCompany')}
                    showChevron
                    clearable
                  />
                  {/* Scope is decided purely by whether a branch is chosen. */}
                  <p className="text-xs text-subtle mt-1">{t('abmOtp.create.branchHint')}</p>
                </div>
              </div>
            </div>
            <ModalErrorBand message={error} onDismiss={() => setError('')} />
            <div className="modal-footer">
              <Button variant="ghost" onClick={handleClose} disabled={busy}>{t('common.cancel')}</Button>
              <Button color="primary" onClick={submit} disabled={!canSubmit} startIcon={<KeyRound size={15} />}>
                {t('abmOtp.create.submit')}
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="modal-content">
              <div className="flex items-center gap-2 mb-3">
                <CheckCircle size={18} className="text-success" />
                <span className="text-sm font-medium">{result?.login_email}</span>
              </div>

              {/* The one-time secret. Warning goes ABOVE it — after copying,
                  people stop reading. */}
              <div className="alert alert-warning">
                <AlertTriangle size={16} className="shrink-0" />
                <div>
                  <div className="alert-title">{t('abmOtp.create.tokenOnceTitle')}</div>
                  <div className="alert-description">{t('abmOtp.create.tokenOnceBody')}</div>
                </div>
              </div>

              <div className="mt-3 flex flex-col gap-1">
                <label className="form-label">{t('abmOtp.create.tokenLabel')}</label>
                <div className="flex items-center gap-2 rounded-md border border-line bg-surface p-3">
                  <code className="flex-1 min-w-0 font-mono text-sm break-all select-all">{result?.token}</code>
                  {result?.token && <CopyButton value={result.token} size={16} className="shrink-0" />}
                </div>
              </div>

              <div className="mt-3 flex flex-col gap-1">
                <label className="form-label">{t('abmOtp.create.ingestUrlLabel')}</label>
                <div className="flex items-center gap-2 rounded-md border border-line bg-surface p-3">
                  <code className="flex-1 min-w-0 font-mono text-xs break-all select-all">{result?.ingest_url}</code>
                  {result?.ingest_url && <CopyButton value={result.ingest_url} size={16} className="shrink-0" />}
                </div>
              </div>

              <p className="text-xs text-subtle mt-3">{t('abmOtp.create.phoneSetupHint')}</p>
            </div>
            <div className="modal-footer">
              <Button color="primary" onClick={forceClose}>{t('abmOtp.create.tokenSaved')}</Button>
            </div>
          </>
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
