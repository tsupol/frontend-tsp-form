import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';
import { Button, Select, TextArea, MaskedInput, InputDatePicker } from 'tsp-form';
import { XCircle, Keyboard } from 'lucide-react';
import { apiClient, ApiError } from '../../../lib/api';
import { makeDatePickerFormat, toLocalDateStr } from '../../../lib/format';
import { useFormSnapshot } from '../../../hooks/useFormSnapshot';
import { getLine } from './useBuyback';
import {
  OVERALL_CONDITION_OPTIONS, SCREEN_CONDITION_OPTIONS, BODY_CONDITION_OPTIONS,
  ITEM_CONDITION_OPTIONS, resolveOptions,
} from './types';
import type { BuybackDraft } from './types';

export function PanelCondition({
  draft,
  dirtyRef,
  onSaved,
  onClose,
}: {
  draft: BuybackDraft;
  dirtyRef?: React.MutableRefObject<boolean>;
  onSaved: () => void;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const line = getLine(draft);
  const snap = (line?.condition_snapshot ?? {}) as Record<string, string>;

  const [grade, setGrade] = useState<string>(line?.item_condition ?? 'USED_A');
  const [overall, setOverall] = useState<string>(snap.OVERALL_CONDITION ?? '');
  const [screen, setScreen] = useState<string>(snap.SCREEN_CONDITION ?? '');
  const [body, setBody] = useState<string>(snap.BODY_CONDITION ?? '');
  const [battery, setBattery] = useState<string>(snap.BATTERY_HEALTH ?? '');
  const [warranty, setWarranty] = useState<string>(line?.warranty_expired_date?.slice(0, 10) ?? '');
  const [typingWarranty, setTypingWarranty] = useState(false);
  const [notes, setNotes] = useState<string>(snap.CONDITION_NOTES ?? '');
  const [error, setError] = useState('');

  const formSnapshot = useFormSnapshot({ grade, overall, screen, body, battery, warranty, notes });

  useEffect(() => {
    if (dirtyRef) dirtyRef.current = formSnapshot.isDirty;
  }, [formSnapshot.isDirty, dirtyRef]);

  useEffect(() => {
    const l = getLine(draft);
    const s = (l?.condition_snapshot ?? {}) as Record<string, string>;
    setGrade(l?.item_condition ?? 'USED_A');
    setOverall(s.OVERALL_CONDITION ?? '');
    setScreen(s.SCREEN_CONDITION ?? '');
    setBody(s.BODY_CONDITION ?? '');
    setBattery(s.BATTERY_HEALTH ?? '');
    setWarranty(l?.warranty_expired_date?.slice(0, 10) ?? '');
    setNotes(s.CONDITION_NOTES ?? '');
    formSnapshot.resetNext();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  const save = useMutation({
    mutationFn: async () => {
      if (!line) throw new Error('No line');
      const payload: Record<string, string> = {};
      if (overall) payload.OVERALL_CONDITION = overall;
      if (screen) payload.SCREEN_CONDITION = screen;
      if (body) payload.BODY_CONDITION = body;
      if (battery) payload.BATTERY_HEALTH = battery;
      if (notes.trim()) payload.CONDITION_NOTES = notes.trim();

      await apiClient.rpc('fn_inv_buyback_update_line', {
        p_line_id: line.po_line_id,
        p_model_id: null,
        p_variant_id: null,
        p_buyback_price: null,
        p_item_condition: grade,
        p_condition_snapshot: payload,
        p_note: null,
        p_branch_id: null,
        p_warranty_expired_date: warranty || null,
      });
    },
    onSuccess: () => {
      setError('');
      formSnapshot.reset();
      if (dirtyRef) dirtyRef.current = false;
      onSaved();
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        const translated = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
          || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
        setError(translated || err.message);
      } else {
        setError(String(err));
      }
    },
  });

  const canSave = !save.isPending && !!grade;

  return (
    <div className="flex flex-col h-full min-w-0 overflow-hidden">
      <div className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden better-scroll">
        <div className="p-4 max-w-2xl min-w-0">
          <h2 className="heading-3 mb-4">{t('buybackWizard.cardCondition', { defaultValue: 'Condition' })}</h2>

          {error && (
            <div className="alert alert-danger mb-4">
              <XCircle size={16} />
              <span>{error}</span>
            </div>
          )}

          <div className="form-grid gap-4">
            <div className="flex flex-col">
              <label className="form-label">{t('buybackWizard.grade', { defaultValue: 'Grade' })} *</label>
              <Select
                options={resolveOptions(ITEM_CONDITION_OPTIONS, t)}
                value={grade}
                onChange={(v) => setGrade((v as string) || 'USED_A')}
                showChevron
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex flex-col">
                <label className="form-label">{t('buybackWizard.overall', { defaultValue: 'Overall condition' })}</label>
                <Select
                  options={resolveOptions(OVERALL_CONDITION_OPTIONS, t)}
                  value={overall || null}
                  onChange={(v) => setOverall((v as string) || '')}
                  placeholder="—"
                  showChevron
                  clearable
                />
              </div>
              <div className="flex flex-col">
                <label className="form-label">{t('buybackWizard.screen', { defaultValue: 'Screen' })}</label>
                <Select
                  options={resolveOptions(SCREEN_CONDITION_OPTIONS, t)}
                  value={screen || null}
                  onChange={(v) => setScreen((v as string) || '')}
                  placeholder="—"
                  showChevron
                  clearable
                />
              </div>
              <div className="flex flex-col">
                <label className="form-label">{t('buybackWizard.body', { defaultValue: 'Body' })}</label>
                <Select
                  options={resolveOptions(BODY_CONDITION_OPTIONS, t)}
                  value={body || null}
                  onChange={(v) => setBody((v as string) || '')}
                  placeholder="—"
                  showChevron
                  clearable
                />
              </div>
              <div className="flex flex-col">
                <label className="form-label">{t('buybackWizard.batteryHealth', { defaultValue: 'Battery health (%)' })}</label>
                <MaskedInput
                  mask="number"
                  decimalScale={0}
                  value={battery}
                  onChange={(raw) => {
                    // Clamp to 0–100. Empty stays empty.
                    if (raw === '') { setBattery(''); return; }
                    const n = parseInt(raw, 10);
                    if (isNaN(n)) return;
                    setBattery(String(Math.max(0, Math.min(100, n))));
                  }}
                  placeholder="1-100"
                  className="w-full"
                  suffix="%"
                />
              </div>
              <div className="flex flex-col">
                <label className="form-label">{t('buybackWizard.warrantyExpired', { defaultValue: 'Warranty expiry date' })}</label>
                <InputDatePicker
                  value={warranty ? new Date(warranty + 'T00:00:00') : null}
                  onChange={(v) => setWarranty(toLocalDateStr(v))}
                  dateFormat={makeDatePickerFormat(i18n.language)}
                  locale={i18n.language}
                  calendar="gregorian"
                  endIcon={<Keyboard size={16} />}
                  onEndIconClick={() => setTypingWarranty(t => !t)}
                  typingMode={typingWarranty}
                  onTypingModeChange={setTypingWarranty}
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
              </div>
            </div>

            <div className="flex flex-col">
              <label className="form-label">{t('buybackWizard.conditionNotes', { defaultValue: 'Notes' })}</label>
              <TextArea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder={t('buybackWizard.conditionNotesPlaceholder', { defaultValue: 'Anything else worth noting about the condition' })}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="flex-none border-t border-line px-4 py-3 flex justify-end gap-2">
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button color="primary" disabled={!canSave} onClick={() => save.mutate()}>
          {save.isPending ? t('common.loading') : t('common.save', { defaultValue: 'Save' })}
        </Button>
      </div>
    </div>
  );
}
