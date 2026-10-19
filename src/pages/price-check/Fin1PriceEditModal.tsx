import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button, FormErrorMessage, InputDatePicker, MaskedInput, Modal, RadioGroup,
} from 'tsp-form';
import { AlertTriangle, ArrowRight, CalendarX, Keyboard } from 'lucide-react';
import { apiClient } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import { fmtCurrency, formatDateTime, makeDatePickerFormat, toLocalDateStr } from '../../lib/format';
import { useFormSnapshot } from '../../hooks/useFormSnapshot';
import { ActionDoneView } from '../contracts/ActionDoneView';
import { ModalErrorBand } from '../../components/ModalErrorBand';
import type { Fin1PriceRow } from './fin1PriceTypes';
import { fmtRange } from './fin1PriceTableExport';

// ============================================================================
// แก้ราคา (FIN1) — one model at a time, from the price table.
// UI_FEEDBACK/2026-10-18_IMPLEMENT_fin1_price_table_edit_dialog.md (mig 1458–1460).
//
// Takes effect now, or from a chosen day (tomorrow … +365, 00:00 Thai time).
// The fields start from the price that change builds on: today's price, or —
// when scheduling over a price change already waiting — that waiting price.
// Only what the user changed is sent (a min/max pair always travels together);
// the backend fills the rest from that same base. The checks on screen are a
// courtesy so the common mistakes don't need a round trip; the backend's answer
// is the verdict and its message is always shown.
// ============================================================================

type Mode = 'now' | 'scheduled';
type FieldKey = 'retail' | 'upMin' | 'upMax' | 'usedMin' | 'usedMax' | 'usedUpMin' | 'usedUpMax';
type Fields = Record<FieldKey, string>;

interface PriceSetResult {
  model_id: number;
  scheduled: boolean;
  effective_from: string | null;
  price: Fin1PriceRow;
}

interface ChangeRow { label: string; before: string; after: string }

interface Done {
  kind: 'saved' | 'scheduled' | 'cancelled';
  effectiveFrom: string | null;
  rows: { label: string; value: string; emphasis?: boolean }[];
}

const s = (n: number | null | undefined) => (n == null ? '' : String(n));
const num = (v: string | undefined): number | null => (!v || v.trim() === '' ? null : Number(v));

const EMPTY_FIELDS: Fields = { retail: '', upMin: '', upMax: '', usedMin: '', usedMax: '', usedUpMin: '', usedUpMax: '' };

/** The values a change builds on, as field strings. */
function baseFields(row: Fin1PriceRow, mode: Mode): Fields {
  if (mode === 'scheduled' && row.has_upcoming) {
    return {
      retail: s(row.next_retail_price),
      upMin: s(row.next_uplift_min), upMax: s(row.next_uplift_max),
      usedMin: s(row.next_used_retail_min), usedMax: s(row.next_used_retail_max),
      usedUpMin: s(row.next_used_uplift_min), usedUpMax: s(row.next_used_uplift_max),
    };
  }
  // A POLICY frame is the holding default, not the model's own — the field
  // stays empty (= keep using the default) and the default shows as a hint.
  const ownUplift = row.uplift_source === 'MODEL';
  return {
    retail: s(row.retail_price),
    upMin: ownUplift ? s(row.uplift_min) : '', upMax: ownUplift ? s(row.uplift_max) : '',
    usedMin: s(row.used_retail_min), usedMax: s(row.used_retail_max),
    usedUpMin: s(row.used_uplift_min), usedUpMax: s(row.used_uplift_max),
  };
}

function dayOffset(days: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d;
}

function parseTyped(raw: string): Date | null {
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

export function Fin1PriceEditModal({ open, row: rowProp, onClose, onSaved }: {
  open: boolean;
  row: Fin1PriceRow | null;
  onClose: () => void;
  onSaved: (row: Fin1PriceRow) => void;
}) {
  const { t, i18n } = useTranslation();

  // Keep rendering the last row through the close animation.
  const lastRow = useRef(rowProp);
  if (rowProp) lastRow.current = rowProp;
  const row = rowProp ?? lastRow.current;

  const [mode, setMode] = useState<Mode>('now');
  const [date, setDate] = useState<Date | null>(null);
  const [typingDate, setTypingDate] = useState(false);
  const [fields, setFields] = useState<Fields>(() => (row ? baseFields(row, 'now') : EMPTY_FIELDS));
  const [view, setView] = useState<'form' | 'done'>('form');
  const [done, setDone] = useState<Done | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<'save' | 'cancel' | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  const snapshot = useFormSnapshot({ mode, date: date ? toLocalDateStr(date) : '', ...fields });

  useEffect(() => {
    if (open && rowProp) {
      setMode('now');
      setDate(null);
      setTypingDate(false);
      setFields(baseFields(rowProp, 'now'));
      setView('form');
      setDone(null);
      setError('');
      setBusy(null);
      setConfirmClose(false);
      snapshot.resetNext();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, rowProp?.model_id]);

  const switchMode = (next: Mode) => {
    setMode(next);
    // Only a model with a waiting price has a different starting point per mode.
    if (row?.has_upcoming) setFields(baseFields(row, next));
  };

  const setField = (k: FieldKey) => (raw: string) => setFields(f => ({ ...f, [k]: raw }));

  const base = useMemo(() => (row ? baseFields(row, mode) : null), [row, mode]);

  // ── What changed, and the checks the screen can do on its own ───────────────

  const pairs = [
    { key: 'uplift', min: 'upMin', max: 'upMax', label: t('fin1PriceTable.col.uplift'), hundreds: true },
    { key: 'used_retail', min: 'usedMin', max: 'usedMax', label: t('fin1PriceTable.col.used'), hundreds: false },
    { key: 'used_uplift', min: 'usedUpMin', max: 'usedUpMax', label: t('fin1PriceTable.col.usedUplift'), hundreds: true },
  ] as const;

  const retailChanged = !!base && num(fields.retail) !== num(base.retail);
  const pairChanged = (p: typeof pairs[number]) => !!base
    && (num(fields[p.min]) !== num(base[p.min]) || num(fields[p.max]) !== num(base[p.max]));

  const effectiveRetail = num(fields.retail);
  const fieldErrors: Partial<Record<'retail' | typeof pairs[number]['key'] | 'date', string>> = {};
  if (row && (!row.has_price || retailChanged) && (effectiveRetail == null || effectiveRetail <= 0)) {
    fieldErrors.retail = t('fin1PriceTable.edit.errRetail');
  }
  for (const p of pairs) {
    const lo = num(fields[p.min]);
    const hi = num(fields[p.max]);
    if (!pairChanged(p)) continue;
    if ((lo == null) !== (hi == null)) fieldErrors[p.key] = t('fin1PriceTable.edit.errPair');
    else if (lo != null && hi != null) {
      if (lo > hi) fieldErrors[p.key] = t('fin1PriceTable.edit.errOrder');
      else if (p.hundreds && (lo % 100 !== 0 || hi % 100 !== 0)) fieldErrors[p.key] = t('fin1PriceTable.edit.errHundreds');
      else if (p.key === 'used_retail' && effectiveRetail != null && hi > effectiveRetail) {
        fieldErrors[p.key] = t('fin1PriceTable.edit.errUsedOverRetail', { price: fmtCurrency(effectiveRetail) });
      }
    }
  }
  const minDate = dayOffset(1);
  const maxDate = dayOffset(365);
  if (mode === 'scheduled' && (!date || date < minDate || date > maxDate)) {
    fieldErrors.date = date ? t('fin1PriceTable.edit.errDateRange') : t('fin1PriceTable.edit.errDate');
  }

  const anyChange = retailChanged || pairs.some(pairChanged);
  const canSave = !!row && anyChange && Object.keys(fieldErrors).length === 0 && !busy;

  const buildPatch = (): Record<string, number | null> => {
    const patch: Record<string, number | null> = {};
    if (retailChanged) patch.retail_price = effectiveRetail;
    if (pairChanged(pairs[0])) { patch.uplift_min = num(fields.upMin); patch.uplift_max = num(fields.upMax); }
    if (pairChanged(pairs[1])) { patch.used_retail_min = num(fields.usedMin); patch.used_retail_max = num(fields.usedMax); }
    if (pairChanged(pairs[2])) { patch.used_uplift_min = num(fields.usedUpMin); patch.used_uplift_max = num(fields.usedUpMax); }
    return patch;
  };

  // "before → after" lines, shown before saving and kept on the done view.
  const rangeOrNone = (lo: string, hi: string, none: string) => fmtRange(num(lo), num(hi)) ?? none;
  const changeRows = (): ChangeRow[] => {
    if (!base) return [];
    const out: ChangeRow[] = [];
    if (retailChanged) {
      out.push({
        label: t('fin1PriceTable.col.retailPrice'),
        before: base.retail ? fmtCurrency(num(base.retail)) : t('fin1PriceTable.unpriced'),
        after: fmtCurrency(effectiveRetail),
      });
    }
    const none: Record<string, string> = {
      uplift: t('fin1PriceTable.policy'),
      used_retail: t('fin1PriceTable.notAcceptingUsed'),
      used_uplift: t('fin1PriceTable.noUplift'),
    };
    for (const p of pairs) {
      if (!pairChanged(p)) continue;
      out.push({
        label: p.label,
        before: rangeOrNone(base[p.min], base[p.max], none[p.key]),
        after: rangeOrNone(fields[p.min], fields[p.max], none[p.key]),
      });
    }
    return out;
  };

  const upcomingDate = row?.next_effective_from ? formatDateTime(row.next_effective_from, i18n.language, false) : '';

  const handleSave = async () => {
    if (!row || !canSave) return;
    setBusy('save');
    setError('');
    const rows = changeRows().map((r, i) => ({ label: r.label, value: `${r.before} → ${r.after}`, emphasis: i === 0 }));
    try {
      const res = await apiClient.rpc<PriceSetResult>('fn_fin1_price_set', {
        p_model_id: row.model_id,
        p_patch: buildPatch(),
        ...(mode === 'scheduled' && date ? { p_effective_date: toLocalDateStr(date) } : {}),
      });
      onSaved(res.price);
      setDone({
        kind: res.scheduled ? 'scheduled' : 'saved',
        effectiveFrom: res.effective_from,
        rows,
      });
      setView('done');
    } catch (err) {
      setError(translateApiError(err, t));
    } finally {
      setBusy(null);
    }
  };

  const handleCancelUpcoming = async () => {
    if (!row || busy) return;
    setBusy('cancel');
    setError('');
    try {
      const res = await apiClient.rpc<{ price: Fin1PriceRow }>('fn_fin1_price_upcoming_cancel', { p_model_id: row.model_id });
      onSaved(res.price);
      setDone({
        kind: 'cancelled',
        effectiveFrom: row.next_effective_from,
        rows: [{
          label: t('fin1PriceTable.edit.cancelledPrice'),
          value: `${fmtCurrency(row.next_retail_price)} · ${upcomingDate}`,
        }],
      });
      setView('done');
    } catch (err) {
      setError(translateApiError(err, t));
    } finally {
      setBusy(null);
    }
  };

  const forceClose = () => { setConfirmClose(false); onClose(); };
  const handleClose = () => {
    if (view === 'done') { forceClose(); return; }
    if (snapshot.isDirty) { setConfirmClose(true); return; }
    forceClose();
  };

  const policyHint = row && row.uplift_source === 'POLICY' && mode === 'now'
    ? t('fin1PriceTable.edit.policyNow', { range: fmtRange(row.uplift_min, row.uplift_max) ?? '—' })
    : t('fin1PriceTable.edit.policyEmpty');

  const pairInput = (p: typeof pairs[number], hint?: string) => (
    <div className="flex flex-col">
      <label className="form-label">{p.label}</label>
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <MaskedInput
            mask="number"
            decimalScale={0}
            value={fields[p.min]}
            onChange={raw => setField(p.min)(raw)}
            placeholder={t('fin1PriceTable.edit.min')}
            error={!!fieldErrors[p.key]}
          />
        </div>
        <span className="text-subtle">–</span>
        <div className="flex-1 min-w-0">
          <MaskedInput
            mask="number"
            decimalScale={0}
            value={fields[p.max]}
            onChange={raw => setField(p.max)(raw)}
            placeholder={t('fin1PriceTable.edit.max')}
            error={!!fieldErrors[p.key]}
          />
        </div>
      </div>
      {fieldErrors[p.key]
        ? <FormErrorMessage error={{ message: fieldErrors[p.key] }} />
        : hint && <div className="text-xs text-subtle mt-1">{hint}</div>}
    </div>
  );

  const preview = view === 'form' && canSave ? changeRows() : [];

  return (
    <>
      <Modal open={open} onClose={handleClose} maxWidth="32rem" width="100%">
        <div className="modal-header">
          <h2 className="modal-title">
            {row?.has_price ? t('fin1PriceTable.edit.title') : t('fin1PriceTable.edit.titleNew')}
          </h2>
          <button type="button" className="modal-close-btn" onClick={handleClose}>×</button>
        </div>

        {view === 'form' && row && (
          <>
            <div className="modal-content min-w-0">
              <div className="form-grid">
                <div className="px-3 py-2.5 rounded-md bg-surface border border-line">
                  <div className="font-medium text-sm">{row.product_display_name}</div>
                  <div className="text-xs text-subtle tabular-nums">
                    {row.has_price
                      ? `${t('fin1PriceTable.edit.currentPrice')} ${fmtCurrency(row.retail_price)}`
                      : t('fin1PriceTable.unpriced')}
                  </div>
                </div>

                <div className="flex flex-col">
                  <label className="form-label">{t('fin1PriceTable.edit.effective')}</label>
                  <RadioGroup
                    name="fin1-price-effective"
                    value={mode}
                    onChange={v => switchMode(v as Mode)}
                    options={[
                      { value: 'now', label: t('fin1PriceTable.edit.now') },
                      { value: 'scheduled', label: t('fin1PriceTable.edit.scheduled') },
                    ]}
                  />
                  {mode === 'scheduled' && (
                    <div className="mt-2">
                      <InputDatePicker
                        value={date}
                        onChange={setDate}
                        dateFormat={makeDatePickerFormat(i18n.language)}
                        locale={i18n.language}
                        calendar="gregorian"
                        datePickerProps={{ minDate, maxDate }}
                        endIcon={<Keyboard size={16} />}
                        onEndIconClick={() => setTypingDate(v => !v)}
                        typingMode={typingDate}
                        onTypingModeChange={setTypingDate}
                        typingMask="##/##/####"
                        typingPlaceholder="DD/MM/YYYY"
                        parseTypedDate={parseTyped}
                        error={!!date && !!fieldErrors.date}
                      />
                      {date && fieldErrors.date
                        ? <FormErrorMessage error={{ message: fieldErrors.date }} />
                        : <div className="text-xs text-subtle mt-1">{t('fin1PriceTable.edit.scheduledHint')}</div>}
                    </div>
                  )}
                  {row.has_upcoming && (
                    <div className={`alert ${mode === 'scheduled' ? 'alert-warning' : 'alert-info'} mt-2`}>
                      <AlertTriangle size={16} />
                      <span>
                        {mode === 'scheduled'
                          ? t('fin1PriceTable.edit.replacesUpcoming', { date: upcomingDate, price: fmtCurrency(row.next_retail_price) })
                          : t('fin1PriceTable.edit.keepsUpcoming', { date: upcomingDate, price: fmtCurrency(row.next_retail_price) })}
                      </span>
                    </div>
                  )}
                </div>

                <div className="flex flex-col">
                  <label className="form-label">{t('fin1PriceTable.col.retailPrice')}</label>
                  <MaskedInput
                    mask="number"
                    decimalScale={0}
                    value={fields.retail}
                    onChange={raw => setField('retail')(raw)}
                    error={!!fieldErrors.retail && (retailChanged || !row.has_price)}
                  />
                  {fieldErrors.retail && (retailChanged || !row.has_price) && fields.retail !== ''
                    ? <FormErrorMessage error={{ message: fieldErrors.retail }} />
                    : <div className="text-xs text-subtle mt-1">{t('fin1PriceTable.edit.retailHint')}</div>}
                </div>

                {pairInput(pairs[0], policyHint)}
                {pairInput(pairs[1], t('fin1PriceTable.edit.usedHint'))}
                {pairInput(pairs[2], t('fin1PriceTable.edit.usedUpliftHint'))}

                {preview.length > 0 && (
                  <div className="flex flex-col gap-1 px-3 py-2.5 rounded-md bg-surface border border-line">
                    <div className="text-xs font-medium text-subtle">
                      {mode === 'scheduled' && date
                        ? t('fin1PriceTable.edit.previewScheduled', { date: formatDateTime(toLocalDateStr(date), i18n.language, false) })
                        : t('fin1PriceTable.edit.previewNow')}
                    </div>
                    {preview.map(p => (
                      <div key={p.label} className="flex items-baseline justify-between gap-3 text-sm">
                        <span className="text-subtle">{p.label}</span>
                        <span className="tabular-nums text-right inline-flex items-center gap-1">
                          {p.before}
                          <ArrowRight size={12} className="text-subtler" />
                          <span className="font-medium">{p.after}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <ModalErrorBand message={error} onDismiss={() => setError('')} />
            <div className="modal-footer">
              {row.has_upcoming && (
                <Button
                  variant="ghost"
                  startIcon={<CalendarX size={16} className="text-danger-fg" />}
                  onClick={handleCancelUpcoming}
                  disabled={!!busy}
                  className="mr-auto"
                >
                  {busy === 'cancel' ? t('common.saving') : t('fin1PriceTable.edit.cancelUpcoming')}
                </Button>
              )}
              <Button variant="ghost" onClick={handleClose}>{t('common.cancel')}</Button>
              <Button color="primary" onClick={handleSave} disabled={!canSave}>
                {busy === 'save' ? t('common.saving') : t('common.save')}
              </Button>
            </div>
          </>
        )}

        {view === 'done' && done && row && (
          <ActionDoneView
            headline={
              done.kind === 'scheduled' ? t('fin1PriceTable.edit.doneScheduled')
                : done.kind === 'cancelled' ? t('fin1PriceTable.edit.doneCancelled')
                  : t('fin1PriceTable.edit.doneSaved')
            }
            contractCode={row.product_display_name}
            detailRows={[
              ...(done.kind !== 'cancelled' ? [{
                label: t('fin1PriceTable.edit.effective'),
                value: done.kind === 'scheduled' && done.effectiveFrom
                  ? formatDateTime(done.effectiveFrom, i18n.language, false)
                  : t('fin1PriceTable.edit.now'),
              }] : []),
              ...done.rows,
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
