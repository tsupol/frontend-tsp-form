// "ตั้งแบบจบ" — finance decides how this return ends.
//
// Three ways out, and which one is right depends on money that already moved:
// nothing paid yet (the shop still owns the device), paid and the shop buys it
// back, or paid and the device goes to the fund's warehouse. The backend
// proposes one (`resolution_default`) and refuses the wrong ones, so the picker
// shows every option with a live sentence saying what it will do — the choice
// is consequential and the labels alone do not carry it.

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Button, Select, TextArea } from 'tsp-form';
import { Info } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import { ModalErrorBand } from '../../components/ModalErrorBand';
import { ActionDoneView } from '../contracts/ActionDoneView';
import { fmtCurrency } from '../../lib/format';
import { usePartnerReturnInvalidate, useReturnResolutionRef } from './usePartnerReturns';
import type {
  PartnerReturnActionsResponse,
  PartnerReturnDetail,
  PartnerReturnResolution,
  ReturnSetResolutionResult,
} from './partnerReturnTypes';

interface Props {
  open: boolean;
  detail: PartnerReturnDetail | null;
  actions: PartnerReturnActionsResponse | null;
  onClose: () => void;
}

export function ReturnSetResolutionModal({ open, detail, actions, onClose }: Props) {
  const { t, i18n } = useTranslation();
  const invalidate = usePartnerReturnInvalidate();
  const resolutions = useReturnResolutionRef();

  const suggested = actions?.resolution_default ?? null;

  const [view, setView] = useState<'form' | 'done'>('form');
  const [resolution, setResolution] = useState<string>('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReturnSetResolutionResult | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  // Seed the picker from whatever is known at the moment the modal opens, and
  // from nothing else. Saving refetches the document, which changes
  // `detail.resolution` and the suggestion — if those were in the dependency
  // list the reset would re-run on success and throw the user back to an empty
  // form instead of the "done" view. The seed is read through a ref so the
  // effect can stay keyed on `open` alone.
  const seed = useRef('');
  seed.current = detail?.resolution ?? suggested ?? '';
  const [initial, setInitial] = useState('');

  useEffect(() => {
    if (!open) return;
    setView('form');
    setResolution(seed.current);
    setInitial(seed.current);
    setNote('');
    setSaving(false);
    setError(null);
    setResult(null);
    setConfirmClose(false);
  }, [open]);

  const dirty = resolution !== initial || !!note.trim();
  const canSubmit = !!resolution;

  const forceClose = () => { setConfirmClose(false); onClose(); };
  const handleClose = () => {
    if (view === 'done') { forceClose(); return; }
    if (dirty) { setConfirmClose(true); return; }
    forceClose();
  };

  const label = (code: string) => {
    const row = resolutions.find(r => r.code === code);
    if (!row) return t(`partnerReturn.resolution_${code}`, { defaultValue: code });
    return i18n.language === 'th' ? row.name_th : row.name_en;
  };

  const options = resolutions.map(r => ({
    value: r.code,
    label: suggested === r.code
      ? `${i18n.language === 'th' ? r.name_th : r.name_en} · ${t('partnerReturn.suggested')}`
      : (i18n.language === 'th' ? r.name_th : r.name_en),
  }));

  // What the picked option will actually do, said in one sentence rather than
  // left to the code name.
  const picked = resolutions.find(r => r.code === resolution) ?? null;
  const buybackTotal = (actions?.buyback_amount ?? 0) + (actions?.buyback_fee ?? 0);

  const handleSave = async () => {
    if (!detail || !canSubmit) return;
    setSaving(true);
    setError(null);
    try {
      const res = await apiClient.rpc<ReturnSetResolutionResult>('fn_partner_return_set_resolution', {
        p_return_id: detail.return_id,
        p_resolution: resolution as PartnerReturnResolution,
        p_note: note.trim() || null,
      });
      setResult(res);
      setView('done');
      invalidate(detail.return_id);
    } catch (err) {
      setError(err instanceof ApiError ? translateApiError(err, t) : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Modal
        open={open}
        onClose={handleClose}
        maxWidth="32rem"
        width="100%"
        ariaLabel={t('partnerReturn.action_SET_RESOLUTION')}
      >
        <div className="modal-header">
          <h2 className="modal-title">{t('partnerReturn.action_SET_RESOLUTION')}</h2>
          <button type="button" className="modal-close-btn" onClick={handleClose}>&times;</button>
        </div>

        {view === 'form' ? (
          <>
            <div className="modal-content">
              <div className="px-3 py-2.5 rounded-md bg-surface border border-line">
                <div className="font-medium text-sm">{detail?.return_code ?? ''}</div>
                <div className="text-xs text-subtle mt-0.5">
                  {detail?.branch_name}
                  {detail?.device_code && <> · {detail.device_code}</>}
                </div>
                {detail?.settlement_code && (
                  <div className="text-xs text-subtle mt-0.5">
                    {detail.settlement_code} ·{' '}
                    {t(`partnerSettlement.status.${detail.settlement_status}`, {
                      defaultValue: detail.settlement_status ?? '—',
                    })}
                    {detail.settlement_net_amount != null && <> · {fmtCurrency(detail.settlement_net_amount)}</>}
                  </div>
                )}
              </div>

              <div className="form-grid mt-4">
                <div className="flex flex-col">
                  <label className="form-label">{t('partnerReturn.resolutionLabel')}</label>
                  <Select
                    options={options}
                    value={resolution || null}
                    onChange={v => setResolution((v as string) ?? '')}
                    placeholder={t('partnerReturn.resolutionPlaceholder')}
                  />
                </div>

                {picked && (
                  <div className="alert alert-info">
                    <Info size={16} className="shrink-0" />
                    <div className="flex flex-col gap-1">
                      <span>{t(`partnerReturn.resolutionHint_${picked.code}`)}</span>
                      {picked.code === 'BUYBACK' && buybackTotal > 0 && (
                        <span className="text-sm">
                          {t('partnerReturn.buybackTotal')}: <b>{fmtCurrency(buybackTotal)}</b>
                          {' '}({t('partnerReturn.buybackAmount')} {fmtCurrency(actions?.buyback_amount ?? 0)}
                          {' + '}{t('partnerReturn.buybackFee')} {fmtCurrency(actions?.buyback_fee ?? 0)})
                        </span>
                      )}
                    </div>
                  </div>
                )}

                <div className="flex flex-col">
                  <label className="form-label">{t('partnerReturn.note')}</label>
                  <TextArea value={note} onChange={e => setNote(e.target.value)} rows={2} />
                </div>
              </div>
            </div>

            <ModalErrorBand message={error} onDismiss={() => setError(null)} />

            <div className="modal-footer">
              <Button variant="ghost" onClick={handleClose} disabled={saving}>{t('common.cancel')}</Button>
              <Button color="primary" onClick={handleSave} disabled={saving || !canSubmit}>
                {t('common.save')}
              </Button>
            </div>
          </>
        ) : result && (
          <ActionDoneView
            headline={t('partnerReturn.resolutionSetHeadline')}
            contractCode={result.return_code}
            detailRows={[
              { label: t('partnerReturn.resolutionLabel'), value: label(result.resolution) },
              ...(result.buyback_total != null
                ? [{
                    label: t('partnerReturn.buybackTotal'),
                    value: fmtCurrency(result.buyback_total),
                    emphasis: true,
                  }]
                : []),
              ...(result.close_block?.reason
                ? [{
                    label: t('partnerReturn.nextStepLabel'),
                    value: t(`partnerReturn.nextStep_${result.close_block.reason}`, {
                      defaultValue: result.close_block.reason,
                    }),
                  }]
                : []),
            ]}
            onClose={forceClose}
          />
        )}
      </Modal>

      <Modal
        open={confirmClose}
        onClose={() => setConfirmClose(false)}
        maxWidth="24rem"
        width="100%"
        ariaLabel={t('common.unsavedChanges')}
      >
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
