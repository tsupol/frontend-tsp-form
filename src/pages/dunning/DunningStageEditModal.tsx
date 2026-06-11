// Edit modal for one dunning stage. Backend BE pattern: every holding has a
// row in dunning_stage_holding seeded from the template, and `_set` updates
// fields via COALESCE — omitting a field means "no change." If the resulting
// effective row differs from template, the stage is flagged `is_custom`.
//
// Form fields:
//   - day_from, day_to (integer day window; day_to may be NULL = open-ended)
//   - priority (small int — disambiguates overlapping windows)
//   - active (boolean)
//   - extra (per-module: reason_code / intent_type / action_code) — text
//
// Notif has no editable extra (event_type is fixed by stage_template).
//
// Follows the write-modal checklist:
//   1. view: 'form' | 'done' — no auto-close on success
//   2. ActionDoneView in 'done' branch
//   3. handleClose guards a dirty form via useFormSnapshot
//   4. <Modal open={...}> always mounted

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Modal, Input, MaskedInput, Switch } from 'tsp-form';
import { XCircle } from 'lucide-react';
import { ApiError } from '../../lib/api';
import { ActionDoneView } from '../contracts/ActionDoneView';
import { useFormSnapshot } from '../../hooks/useFormSnapshot';
import { useDunningStages } from './useDunningStages';
import { getEffectiveExtra } from './dunningTypes';
import type { DunningModule, DunningStageRow } from './dunningTypes';

interface Props {
  open: boolean;
  onClose: () => void;
  module: DunningModule;
  /** The stage to edit. Pass null to keep the modal mounted but closed. */
  row: DunningStageRow | null;
}

function describeApiError(
  err: unknown,
  t: (k: string, opts?: Record<string, unknown>) => string,
): string {
  if (err instanceof ApiError) {
    const translated = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
      || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
    return translated || err.message;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

export function DunningStageEditModal({ open, onClose, module, row }: Props) {
  const { t } = useTranslation();
  const { save, config } = useDunningStages(module);

  const [view, setView] = useState<'form' | 'done'>('form');
  const [confirmClose, setConfirmClose] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // Form state — initialized from row, reset on open.
  const [dayFrom, setDayFrom] = useState('');
  const [dayTo, setDayTo] = useState('');
  const [priority, setPriority] = useState('');
  const [active, setActive] = useState(true);
  const [extra, setExtra] = useState('');

  // Dirty tracking — compares current form values to the last reset baseline.
  const snapshot = useFormSnapshot({
    dayFrom,
    dayTo,
    priority,
    active,
    extra,
  });

  useEffect(() => {
    if (open && row) {
      setView('form');
      setConfirmClose(false);
      setErrorMessage('');
      setDayFrom(String(row.effective.day_from));
      setDayTo(row.effective.day_to == null ? '' : String(row.effective.day_to));
      setPriority(String(row.effective.priority));
      setActive(row.effective.active);
      setExtra(getEffectiveExtra(row, config) ?? '');
      // Baseline the snapshot on the next render — by then the setState
      // calls above will have flushed and `values` reflects the hydrated
      // row, so isDirty starts false.
      snapshot.resetNext();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, row, config]);

  const handleClose = () => {
    if (view === 'done') { onClose(); return; }
    if (snapshot.isDirty) { setConfirmClose(true); return; }
    onClose();
  };

  const forceClose = () => {
    setConfirmClose(false);
    onClose();
  };

  const handleSubmit = async () => {
    if (!row) return;
    setErrorMessage('');

    // Send only fields that changed vs effective. Use undefined to skip;
    // the hook strips undefined keys before calling the RPC.
    const eff = row.effective;
    const nextDayFrom = parseInt(dayFrom, 10);
    const nextDayTo = dayTo === '' ? null : parseInt(dayTo, 10);
    const nextPriority = parseInt(priority, 10);
    const nextExtra = extra.trim();
    const effExtra = getEffectiveExtra(row, config) ?? '';

    try {
      await save.mutateAsync({
        stage: row.stage,
        day_from: nextDayFrom !== eff.day_from ? nextDayFrom : undefined,
        day_to: nextDayTo !== eff.day_to ? nextDayTo : undefined,
        priority: nextPriority !== eff.priority ? nextPriority : undefined,
        active: active !== eff.active ? active : undefined,
        extra: config.extraField && nextExtra !== effExtra ? nextExtra : undefined,
      });
      snapshot.reset();
      setView('done');
    } catch (err) {
      setErrorMessage(describeApiError(err, t));
    }
  };

  const canSubmit = row != null
    && dayFrom.trim() !== ''
    && priority.trim() !== ''
    && !save.isPending;

  return (
    <>
      <Modal open={open} onClose={handleClose} maxWidth="32rem" width="100%">
        <div className="modal-header">
          <h2 className="modal-title">
            {view === 'done'
              ? t('dunningSystem.editDoneTitle')
              : t('dunningSystem.editTitle', { stage: row?.stage ?? '' })
            }
          </h2>
          <button type="button" className="modal-close-btn" onClick={handleClose} aria-label="Close">&times;</button>
        </div>

        {view === 'form' && row && (
          <>
            <div className="modal-content">
              {errorMessage && (
                <div className="alert alert-danger mb-4 animate-pop-in">
                  <XCircle size={16} />
                  <span>{errorMessage}</span>
                </div>
              )}

              <div className="text-xs text-subtle mb-4">{row.description}</div>

              <div className="form-grid">
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col">
                    <label className="form-label">{t('dunningSystem.fieldDayFrom')}</label>
                    <MaskedInput
                      mask="number"
                      decimalScale={0}
                      allowNegative
                      value={dayFrom}
                      onChange={(raw) => setDayFrom(raw)}
                      className="w-full"
                    />
                    <div className="text-[11px] text-subtler mt-1">{t('dunningSystem.fieldDayFromHint')}</div>
                  </div>
                  <div className="flex flex-col">
                    <label className="form-label">{t('dunningSystem.fieldDayTo')}</label>
                    <MaskedInput
                      mask="number"
                      decimalScale={0}
                      allowNegative
                      value={dayTo}
                      onChange={(raw) => setDayTo(raw)}
                      className="w-full"
                    />
                    <div className="text-[11px] text-subtler mt-1">{t('dunningSystem.fieldDayToHint')}</div>
                  </div>
                </div>

                <div className="flex flex-col">
                  <label className="form-label">{t('dunningSystem.fieldPriority')}</label>
                  <MaskedInput
                    mask="number"
                    decimalScale={0}
                    value={priority}
                    onChange={(raw) => setPriority(raw)}
                    className="w-full"
                  />
                  <div className="text-[11px] text-subtler mt-1">{t('dunningSystem.fieldPriorityHint')}</div>
                </div>

                {config.extraField && (
                  <div className="flex flex-col">
                    <label className="form-label">
                      {t(`dunningSystem.field_${config.extraField}`)}
                    </label>
                    <Input
                      value={extra}
                      onChange={(e) => setExtra(e.target.value)}
                      className="w-full"
                    />
                  </div>
                )}

                {/* Notif event_type is read-only — show as info */}
                {!config.extraField && row.event_type && (
                  <div className="flex flex-col">
                    <label className="form-label">{t('dunningSystem.field_event_type')}</label>
                    <div className="text-sm font-mono text-subtle px-3 py-2 bg-surface rounded-md border border-line">
                      {row.event_type}
                    </div>
                    <div className="text-[11px] text-subtler mt-1">{t('dunningSystem.fieldEventTypeHint')}</div>
                  </div>
                )}

                <div className="flex items-center justify-between">
                  <div>
                    <label className="form-label mb-0">{t('dunningSystem.fieldActive')}</label>
                    <div className="text-[11px] text-subtler mt-0.5">{t('dunningSystem.fieldActiveHint')}</div>
                  </div>
                  <Switch checked={active} onChange={(e) => setActive(e.target.checked)} />
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <Button onClick={handleClose}>{t('common.cancel')}</Button>
              <Button color="primary" onClick={handleSubmit} disabled={!canSubmit}>
                {save.isPending ? t('common.loading') : t('common.save')}
              </Button>
            </div>
          </>
        )}

        {view === 'done' && row && (
          <ActionDoneView
            headline={t('dunningSystem.editDoneHeadline')}
            contractCode={row.stage}
            detailRows={[
              { label: t('dunningSystem.fieldDayFrom'), value: dayFrom },
              { label: t('dunningSystem.fieldDayTo'), value: dayTo === '' ? '∞' : dayTo },
              { label: t('dunningSystem.fieldPriority'), value: priority },
              { label: t('dunningSystem.fieldActive'), value: active ? t('dunningSystem.active') : t('dunningSystem.inactive') },
              ...(config.extraField && extra ? [{ label: t(`dunningSystem.field_${config.extraField}`), value: extra }] : []),
            ]}
            onClose={onClose}
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
