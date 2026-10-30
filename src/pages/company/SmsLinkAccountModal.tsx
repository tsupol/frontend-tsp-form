// Link one of the company's bank accounts to an SMS phone. Spec: UI_SUMMARY/154 §3.7.
// Choices come from the existing v_bank_accounts of the phone's company, the
// fund's own accounts first (what a phone normally receives SMS for).
//
// One phone = one account (mig 1536): every SMS then knows its account without
// reading the text. A phone that already has one opens as "change account":
// the old link is ended, then the new one made (the backend refuses a second
// open link, SMS_SOURCE_ALREADY_LINKED, so the order matters).

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Modal, Button, Select } from 'tsp-form';
import { Link2 } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import { ModalErrorBand } from '../../components/ModalErrorBand';
import { ActionDoneView } from '../contracts/ActionDoneView';
import { SourceTargetBox } from './SmsSetupModal';
import { accountLine, type SmsBankAccountOption, type SmsSource } from './smsRelayTypes';

interface Props {
  open: boolean;
  source: SmsSource | null;
  onClose: () => void;
  onLinked: () => void;
}

export function SmsLinkAccountModal({ open, source: sourceProp, onClose, onLinked }: Props) {
  const { t } = useTranslation();

  const lastSource = useRef(sourceProp);
  if (sourceProp) lastSource.current = sourceProp;
  const source = sourceProp ?? lastSource.current;

  const [view, setView] = useState<'form' | 'done'>('form');
  const [accountId, setAccountId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [linked, setLinked] = useState<SmsBankAccountOption | null>(null);

  useEffect(() => {
    if (open) { setView('form'); setAccountId(''); setBusy(false); setError(''); setLinked(null); unlinkedRef.current = null; }
  }, [open]);

  const companyId = source?.company_id;
  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ['sms-relay', 'bank-accounts', companyId],
    queryFn: () => apiClient.get<SmsBankAccountOption[]>(
      `/v_bank_accounts?company_id=eq.${companyId}&is_active=eq.true&order=id`,
    ),
    enabled: open && companyId != null,
  });

  const current = source?.linked_accounts[0] ?? null;
  const unlinkedRef = useRef<number | null>(null);
  const isChange = current != null;
  const linkedIds = new Set((source?.linked_accounts ?? []).map(a => a.bank_account_id));
  // The same number can sit on a branch row and a fund row; say which is which.
  const optionLabel = (a: SmsBankAccountOption) => `${accountLine(a)} · ${
    a.is_company_account ? t('smsRelay.link.fundAccount') : (a.branch_name ?? t('smsRelay.link.branchAccount'))}`;
  const options = [...accounts]
    .sort((x, y) => Number(y.is_company_account) - Number(x.is_company_account) || x.id - y.id)
    .filter(a => !linkedIds.has(a.id))
    .map(a => ({ value: String(a.id), label: optionLabel(a) }));

  const [confirmClose, setConfirmClose] = useState(false);
  const forceClose = () => { setConfirmClose(false); onClose(); };
  const handleClose = () => {
    if (busy) return;
    if (view === 'form' && accountId) { setConfirmClose(true); return; }
    forceClose();
  };

  const submit = async () => {
    if (!source || !accountId) return;
    setBusy(true);
    setError('');
    try {
      // A change ends the old link first; if the new link then fails the phone
      // is left with none, and the error says so.
      if (current && unlinkedRef.current !== current.link_id) {
        await apiClient.rpc('fn_sms_source_unlink_account', { p_link_id: current.link_id });
        unlinkedRef.current = current.link_id;   // a retry after a failed link skips this
      }
      await apiClient.rpc('fn_sms_source_link_account', {
        p_source_id: source.source_id,
        p_bank_account_id: Number(accountId),
      });
      setLinked(accounts.find(a => a.id === Number(accountId)) ?? null);
      setView('done');
      onLinked();
    } catch (err) {
      const msg = err instanceof ApiError ? translateApiError(err, t) : t('common.error');
      setError(current ? `${msg} — ${t('smsRelay.link.changeHalfDone')}` : msg);
      if (current) onLinked();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
    <Modal open={open} onClose={handleClose} maxWidth="32rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">{isChange ? t('smsRelay.link.changeTitle') : t('smsRelay.link.title')}</h2>
        <button type="button" className="modal-close-btn" onClick={handleClose}>&times;</button>
      </div>

      {view === 'done' ? (
        <ActionDoneView
          headline={isChange ? t('smsRelay.link.changeDone') : t('smsRelay.link.done')}
          contractCode={source?.label ?? ''}
          detailRows={linked ? [
            { label: t('smsRelay.link.account'), value: accountLine(linked) },
            ...(linked.branch_name ? [{ label: t('smsRelay.link.branch'), value: linked.branch_name }] : []),
          ] : []}
          onClose={forceClose}
        />
      ) : (
        <>
          <div className="modal-content">
            <SourceTargetBox label={source?.label ?? null} purpose={source?.purpose ?? null} />
            {current && (
              <p className="text-sm text-subtle mt-3 mb-0">
                {t('smsRelay.link.currentAccount')}: <span className="text-fg">{accountLine(current)}</span>
              </p>
            )}
            <div className="form-grid mt-4">
              <div className="flex flex-col">
                <label className="form-label">{t('smsRelay.link.account')}</label>
                {isLoading ? (
                  <p className="text-xs text-subtle">{t('common.loading')}</p>
                ) : options.length === 0 ? (
                  <p className="text-sm text-subtle">
                    {accounts.length === 0 ? t('smsRelay.link.noAccounts') : t('smsRelay.link.allLinked')}
                  </p>
                ) : (
                  <Select
                    options={options}
                    value={accountId || null}
                    onChange={(v) => setAccountId((v as string) ?? '')}
                    placeholder={t('smsRelay.link.pick')}
                    showChevron
                  />
                )}
                <p className="text-xs text-subtle mt-1">{t('smsRelay.link.hint')}</p>
              </div>
            </div>
          </div>
          <ModalErrorBand message={error} onDismiss={() => setError('')} />
          <div className="modal-footer">
            <Button variant="ghost" onClick={handleClose} disabled={busy}>{t('common.cancel')}</Button>
            <Button color="primary" onClick={submit} disabled={busy || !accountId} startIcon={<Link2 size={15} />}>
              {isChange ? t('smsRelay.link.changeSubmit') : t('smsRelay.link.submit')}
            </Button>
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
