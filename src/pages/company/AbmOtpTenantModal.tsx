// Bind (or move) one ABM OTP account to an ABM organisation.
// Spec §1.2 of UI_FEEDBACK/2026-09-11_IMPLEMENT_mdm_abm_account_and_enroll_email_picker.md.
//
// Two jobs behind one modal, because they are the same call:
//  - an account created before 2026-09-11 may have no org at all (the row shows
//    a red "ยังไม่ผูก ABM" badge); this binds it.
//  - an account bound to the wrong org (typo, or the branch genuinely moved)
//    gets moved here. `previous_abm_tenant_id` in the response is what lets the
//    success line say where it came FROM, which is the only way the operator can
//    tell a no-op from a real move.
//
// Moving a default account keeps its default flag — the BE preserves it, so we
// do not warn about losing it.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Button, Select } from 'tsp-form';
import { AlertTriangle, Building2 } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import { ModalErrorBand } from '../../components/ModalErrorBand';
import { ActionDoneView } from '../contracts/ActionDoneView';
import { useAbmServers } from './abmServers';
import type { AbmOtpSource } from './abmOtpTypes';

interface SetTenantResult {
  source_id: number;
  login_email: string;
  abm_tenant_id: number;
  abm_display_name: string;
  dep_name: string;
  previous_abm_tenant_id: number | null;
  is_default: boolean;
}

interface Props {
  open: boolean;
  /** Null is tolerated so the Modal can stay mounted between selections. */
  source: AbmOtpSource | null;
  onClose: () => void;
  onSaved: () => void;
}

export function AbmOtpTenantModal({ open, source, onClose, onSaved }: Props) {
  const { t } = useTranslation();

  const [view, setView] = useState<'form' | 'done'>('form');
  const [tenantId, setTenantId] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<SetTenantResult | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  const { data: abmServers = [], isLoading: serversLoading } = useAbmServers(open);

  useEffect(() => {
    if (!open) return;
    setView('form');
    // Start on the account's current org so the Select never reads empty for an
    // already-bound account — an empty control here looks like data loss.
    setTenantId(source?.abm_tenant_id != null ? String(source.abm_tenant_id) : '');
    setBusy(false); setError(''); setResult(null); setConfirmClose(false);
  }, [open, source?.id, source?.abm_tenant_id]);

  const originalTenant = source?.abm_tenant_id != null ? String(source.abm_tenant_id) : '';
  const isDirty = tenantId !== originalTenant;

  const forceClose = () => { setConfirmClose(false); onClose(); };

  const handleClose = () => {
    if (busy) return;
    if (view === 'done') { forceClose(); return; }
    if (isDirty) { setConfirmClose(true); return; }
    forceClose();
  };

  const submit = async () => {
    if (source == null || tenantId === '') return;
    setBusy(true);
    setError('');
    try {
      const res = await apiClient.rpc<SetTenantResult>('fn_abm_otp_source_set_tenant', {
        p_source_id: source.id,
        p_abm_tenant_id: Number(tenantId),
      });
      setResult(res);
      setView('done');
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? translateApiError(err, t) : t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  const options = abmServers.map(s => ({ value: String(s.abm_tenant_id), label: s.display_name }));
  const canSubmit = !busy && tenantId !== '' && isDirty;

  // The org it is leaving, named rather than numbered.
  const previousName = result?.previous_abm_tenant_id != null
    ? (abmServers.find(s => s.abm_tenant_id === result.previous_abm_tenant_id)?.display_name
       ?? String(result.previous_abm_tenant_id))
    : null;

  return (
    <>
      <Modal open={open} onClose={handleClose} maxWidth="30rem" width="100%">
        <div className="modal-header">
          <h2 className="modal-title">{t('abmOtp.tenant.title')}</h2>
          <button type="button" className="modal-close-btn" onClick={handleClose}>&times;</button>
        </div>

        {view === 'form' ? (
          <>
            <div className="modal-content">
              <p className="text-sm font-medium break-all mb-1">{source?.login_email}</p>
              <p className="text-xs text-subtle mb-3">
                {source?.abm_tenant_name
                  ? `${t('abmOtp.tenant.currentOrg')}: ${source.abm_tenant_name}`
                  : t('abmOtp.tenant.notBoundYet')}
              </p>

              {serversLoading ? (
                <p className="text-sm text-subtle">{t('common.loading')}</p>
              ) : options.length === 0 ? (
                <div className="alert alert-warning">
                  <AlertTriangle size={16} className="shrink-0" />
                  <span className="min-w-0">{t('abmOtp.create.noAbmOrgs')}</span>
                </div>
              ) : (
                <div className="flex flex-col">
                  <label className="form-label">{t('abmOtp.create.abmOrg')} *</label>
                  <Select
                    options={options}
                    value={tenantId || null}
                    onChange={(v) => setTenantId((v as string) ?? '')}
                    placeholder={t('abmOtp.create.abmOrgPlaceholder')}
                    showChevron
                  />
                  <p className="text-xs text-subtle mt-1">{t('abmOtp.tenant.hint')}</p>
                </div>
              )}
            </div>
            <ModalErrorBand message={error} onDismiss={() => setError('')} />
            <div className="modal-footer">
              <Button variant="ghost" onClick={handleClose} disabled={busy}>{t('common.cancel')}</Button>
              <Button color="primary" onClick={submit} disabled={!canSubmit} startIcon={<Building2 size={15} />}>
                {t('abmOtp.tenant.submit')}
              </Button>
            </div>
          </>
        ) : (
          <ActionDoneView
            headline={t('abmOtp.tenant.doneTitle')}
            contractCode={result?.login_email ?? ''}
            detailRows={[
              ...(previousName ? [{ label: t('abmOtp.tenant.movedFrom'), value: previousName }] : []),
              { label: t('abmOtp.tenant.nowIn'), value: result?.abm_display_name ?? '—', emphasis: true },
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
