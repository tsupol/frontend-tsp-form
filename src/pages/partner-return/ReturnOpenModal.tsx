// Open a device-return document — UI_SUMMARY/146 §3 (`fn_partner_return_open`),
// work order §2 step 1.
//
// An active deal-partner contract ends only through this document, so this is
// the dialog behind the contract footer's one remaining button.
//
// Two things the session decides, not the user:
//   - The shop always returns at the shop (`BRANCH`): the backend refuses
//     COMPANY_DIRECT from a shop session (403 COMPANY_SIDE_ONLY), so the shop
//     never sees a picker offering a choice it cannot make.
//   - The finance team picks a receive point from the ref view, and picking
//     "shipped to the company" reveals the date the device arrived — required,
//     never in the future.
//
// The reason list comes from the ref view, including which reason makes the
// note mandatory (`requires_note`, today only OTHER). Nothing is hardcoded, so
// a reason added later needs no FE change.

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Button, Select, TextArea, InputDatePicker } from 'tsp-form';
import { Info, Keyboard, PenLine } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import { makeDatePickerFormat, parseLocalDate, toLocalDateStr } from '../../lib/format';
import { ModalErrorBand } from '../../components/ModalErrorBand';
import { ActionDoneView } from '../contracts/ActionDoneView';
import { useAuth } from '../../contexts/AuthContext';
import {
  useReturnReasons, useReturnReceivePoints, usePartnerReturnInvalidate,
} from './usePartnerReturn';
import type { PartnerReturnOpenResult } from './partnerReturnTypes';

const NOTE_MIN = 3;

/** Turn a typed `DD/MM/YYYY` (Buddhist years included) into a Date. */
function parseTypedDate(raw: string): Date | null {
  if (raw.length !== 8) return null;
  const day = parseInt(raw.slice(0, 2), 10);
  const month = parseInt(raw.slice(2, 4), 10);
  let year = parseInt(raw.slice(4, 8), 10);
  if (year > 2400) year -= 543;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return d;
}

interface ReturnOpenModalProps {
  open: boolean;
  contractId: number | null;
  contractCode: string;
  onClose: () => void;
  /** Called with the new document so the caller can navigate to it. */
  onOpened?: (result: PartnerReturnOpenResult) => void;
}

export function ReturnOpenModal({
  open, contractId, contractCode, onClose, onOpened,
}: ReturnOpenModalProps) {
  const { t, i18n } = useTranslation();
  const { isDealPartner } = useAuth();
  const invalidate = usePartnerReturnInvalidate();
  const reasons = useReturnReasons();
  const receivePoints = useReturnReceivePoints();
  const isThai = i18n.language === 'th';

  const [view, setView] = useState<'form' | 'done'>('form');
  const [reasonCode, setReasonCode] = useState('');
  const [receivePoint, setReceivePoint] = useState('BRANCH');
  const [receivedDate, setReceivedDate] = useState(() => toLocalDateStr(new Date()));
  const [dateTyping, setDateTyping] = useState(false);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PartnerReturnOpenResult | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  useEffect(() => {
    if (!open) return;
    setView('form');
    setReasonCode('');
    setReceivePoint('BRANCH');
    setReceivedDate(toLocalDateStr(new Date()));
    setDateTyping(false);
    setNote('');
    setSaving(false);
    setError(null);
    setResult(null);
    setConfirmClose(false);
  }, [open, contractId]);

  const label = (row: { name_th: string; name_en: string }) => (isThai ? row.name_th : row.name_en);

  const reasonOptions = useMemo(
    () => reasons.map(r => ({ value: r.code, label: label(r) })),
    [reasons, isThai],
  );

  // A shop session never picks a receive point: the only one it may use is
  // BRANCH, and the ref view marks the other `company_side_only`.
  const pointOptions = useMemo(
    () => receivePoints.filter(p => !p.company_side_only).concat(
      receivePoints.filter(p => p.company_side_only),
    ).map(p => ({ value: p.code, label: label(p) })),
    [receivePoints, isThai],
  );

  const chosenReason = reasons.find(r => r.code === reasonCode) ?? null;
  const noteRequired = chosenReason?.requires_note === true;
  const isCompanyDirect = receivePoint === 'COMPANY_DIRECT';
  const dateInFuture = isCompanyDirect && receivedDate > toLocalDateStr(new Date());

  const dirty = reasonCode !== '' || note.trim() !== '';
  const canSubmit = contractId != null
    && reasonCode !== ''
    && (!noteRequired || note.trim().length >= NOTE_MIN)
    && (!isCompanyDirect || (receivedDate !== '' && !dateInFuture));

  const forceClose = () => { setConfirmClose(false); onClose(); };

  const handleClose = () => {
    if (view === 'done') { forceClose(); return; }
    if (dirty) { setConfirmClose(true); return; }
    forceClose();
  };

  const handleRun = async () => {
    if (!canSubmit || contractId == null) return;
    setSaving(true);
    setError(null);
    try {
      const res = await apiClient.rpc<PartnerReturnOpenResult>('fn_partner_return_open', {
        p_contract_id: contractId,
        p_reason_code: reasonCode,
        p_receive_point: isDealPartner ? 'BRANCH' : receivePoint,
        p_note: note.trim() || null,
        ...(isCompanyDirect && !isDealPartner ? { p_received_date: receivedDate } : {}),
      });
      setResult(res);
      setView('done');
      invalidate(contractId);
      onOpened?.(res);
    } catch (err) {
      setError(err instanceof ApiError ? translateApiError(err, t) : String(err));
    } finally {
      setSaving(false);
    }
  };

  const title = t('partnerReturn.openTitle');

  return (
    <>
      <Modal open={open} onClose={handleClose} maxWidth="30rem" width="100%" ariaLabel={title}>
        <div className="modal-header">
          <h2 className="modal-title">{title}</h2>
          <button type="button" className="modal-close-btn" onClick={handleClose}>&times;</button>
        </div>

        {view === 'form' ? (
          <>
            <div className="modal-content">
              <div className="px-3 py-2.5 rounded-md bg-surface border border-line">
                <div className="font-medium text-sm">{contractCode}</div>
              </div>

              <div className="alert alert-info mt-3">
                <Info size={16} className="shrink-0" />
                <span>
                  {isDealPartner ? t('partnerReturn.openHintShop') : t('partnerReturn.openHintStaff')}
                </span>
              </div>

              <div className="form-grid mt-4">
                <div className="flex flex-col">
                  <label className="form-label">{t('partnerReturn.reason')}</label>
                  <Select
                    options={reasonOptions}
                    value={reasonCode || null}
                    onChange={v => setReasonCode((v as string) ?? '')}
                    placeholder={t('partnerReturn.reasonPlaceholder')}
                  />
                </div>

                {/* A shop has exactly one receive point, so it reads as a fact,
                    not a choice. Only staff get the picker. */}
                {!isDealPartner && (
                  <div className="flex flex-col">
                    <label className="form-label">{t('partnerReturn.receivePoint')}</label>
                    <Select
                      options={pointOptions}
                      value={receivePoint || null}
                      onChange={v => setReceivePoint((v as string) ?? 'BRANCH')}
                      placeholder={t('partnerReturn.receivePointPlaceholder')}
                    />
                  </div>
                )}

                {!isDealPartner && isCompanyDirect && (
                  <div className="flex flex-col">
                    <label className="form-label">{t('partnerReturn.receivedDate')}</label>
                    <InputDatePicker
                      value={parseLocalDate(receivedDate)}
                      onChange={v => setReceivedDate(toLocalDateStr(v))}
                      dateFormat={makeDatePickerFormat(i18n.language)}
                      locale={i18n.language}
                      calendar="gregorian"
                      typingMode={dateTyping}
                      onTypingModeChange={setDateTyping}
                      typingMask="##/##/####"
                      typingPlaceholder="DD/MM/YYYY"
                      parseTypedDate={parseTypedDate}
                      endIcon={<Keyboard size={16} />}
                      onEndIconClick={() => setDateTyping(v => !v)}
                      error={dateInFuture}
                    />
                    {dateInFuture && (
                      <span className="text-xs text-danger-fg mt-1">
                        {t('partnerReturn.receivedDateFuture')}
                      </span>
                    )}
                  </div>
                )}

                <div className="flex flex-col">
                  <label className="form-label">
                    {noteRequired ? t('partnerReturn.noteRequired') : t('partnerReturn.note')}
                  </label>
                  <TextArea
                    value={note}
                    onChange={e => setNote(e.target.value)}
                    rows={3}
                    placeholder={t('partnerReturn.notePlaceholder')}
                    error={noteRequired && note.trim().length > 0 && note.trim().length < NOTE_MIN}
                  />
                  {noteRequired && (
                    <span className="text-xs text-subtle mt-1">
                      {t('partnerReturn.noteMin', { count: NOTE_MIN })}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <ModalErrorBand message={error} onDismiss={() => setError(null)} />

            <div className="modal-footer">
              <Button variant="ghost" onClick={handleClose} disabled={saving}>
                {t('common.cancel')}
              </Button>
              <Button
                color="primary"
                onClick={handleRun}
                disabled={saving || !canSubmit}
                data-action="PARTNER_RETURN_OPEN"
                data-blocked-reason={saving ? 'in_flight' : !canSubmit ? 'incomplete' : undefined}
              >
                {t('partnerReturn.openConfirm')}
              </Button>
            </div>
          </>
        ) : result && (
          <ActionDoneView
            headline={t('partnerReturn.openDone')}
            contractCode={result.return_code}
            tone="success"
            detailRows={[
              {
                label: t('partnerReturn.statusLabel'),
                value: t(`partnerReturn.status_${result.status}`, { defaultValue: result.status }),
                emphasis: true,
              },
              {
                label: t('partnerReturn.receivePoint'),
                value: t(`partnerReturn.receivePoint_${result.receive_point}`, {
                  defaultValue: result.receive_point,
                }),
              },
            ]}
            extras={result.requires_customer_signing ? (
              <div className="alert alert-info">
                <PenLine size={16} className="shrink-0" />
                <span>{t('partnerReturn.openDoneSigningHint')}</span>
              </div>
            ) : (
              <div className="alert alert-success">
                <Info size={16} className="shrink-0" />
                <span>{t('partnerReturn.openDoneReceivedHint')}</span>
              </div>
            )}
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
