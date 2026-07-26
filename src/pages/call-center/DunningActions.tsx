// Collector detail actions for round-2 (2026-07-26): change manual flag,
// log a promise-to-pay, reveal an iCloud password. Each is a small modal /
// inline control on the contract detail. Backend contract:
// UI_FEEDBACK/2026-07-26_DELIVERY_callcenter_flag_appt_chat_asset.md

import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Button, TextArea, Badge, InputDatePicker, useSnackbarContext } from 'tsp-form';
import { Flag, XCircle, CheckCircle, Eye, EyeOff, ShieldAlert, Calendar, Keyboard } from 'lucide-react';
import { ApiError } from '../../lib/api';
import { makeDatePickerFormat } from '../../lib/format';
import {
  useFlagLevels, setManualFlag, logPromiseToPay, revealIcloudPassword,
  flagColor, type FlagLevelRef, type IcloudRevealResult,
} from './callCenterApi';

function toLocalDateStr(d: Date | null): string {
  if (!d) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function flagLabel(t: (k: string, o?: Record<string, unknown>) => string, code: string): string {
  return t(`callCenter.flagLevel.${code}`, { defaultValue: '' }) || code;
}

// ── Change manual flag ─────────────────────────────────────────────────────────

/** Modal to set the manual flag. Raising = one tap. Lowering opens a required
 *  free-text reason field (≥10 chars, never a dropdown — anti-whitewash). */
export function FlagChangeModal({
  open, contractId, currentManual, onClose, onChanged,
}: {
  open: boolean;
  contractId: number;
  currentManual: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const { addSnackbar } = useSnackbarContext();
  const { data: levels } = useFlagLevels();
  const [target, setTarget] = useState<string>(currentManual);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) { setTarget(currentManual); setReason(''); setError(''); }
  }, [open, currentManual]);

  const rankOf = useCallback(
    (code: string) => levels?.find(l => l.code === code)?.severity_rank ?? 0,
    [levels],
  );
  const isLowering = rankOf(target) < rankOf(currentManual);
  const reasonTooShort = reason.trim().length < 10;
  const canSave = target !== currentManual && (!isLowering || !reasonTooShort) && !saving;

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await setManualFlag(contractId, target, isLowering ? reason.trim() : null);
      addSnackbar({
        message: <div className="alert alert-success"><CheckCircle size={18} /><span>{t('callCenter.flagChanged')}</span></div>,
        type: 'success', duration: 2500,
      });
      onChanged();
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        // BE forces a reason on a lower — surface the field.
        const key = err.messageKey || err.code || '';
        const translated = key ? t(key, { ns: 'apiErrors', defaultValue: '' }) : '';
        setError(translated || err.message || t('common.error'));
      } else {
        setError(t('common.error'));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} maxWidth="26rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title inline-flex items-center gap-2"><Flag size={16} />{t('callCenter.changeFlag')}</h2>
        <button type="button" className="modal-close-btn" onClick={onClose}>×</button>
      </div>
      <div className="modal-content">
        <div className="form-grid gap-4">
          {/* Level picker — swatch + label so it's never colour-only */}
          <div className="flex flex-col gap-1.5">
            <label className="form-label">{t('callCenter.flagManual')}</label>
            <div className="flex flex-wrap gap-1.5">
              {(levels ?? []).map((lvl: FlagLevelRef) => {
                const selected = lvl.code === target;
                return (
                  <button
                    key={lvl.code}
                    type="button"
                    onClick={() => setTarget(lvl.code)}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-sm cursor-pointer transition-colors ${
                      selected ? 'border-primary-fg bg-primary-soft' : 'border-line hover:bg-surface-hover'
                    }`}
                  >
                    <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: flagColor(levels, lvl.code) }} />
                    {flagLabel(t, lvl.code)}
                  </button>
                );
              })}
            </div>
          </div>

          {isLowering && (
            <div className="flex flex-col gap-1.5">
              <label className="form-label">
                {t('callCenter.flagLowerReason')} <span className="text-danger-fg">*</span>
              </label>
              <TextArea
                className="w-full"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t('callCenter.flagLowerReasonPlaceholder')}
                rows={3}
                autoFocus
              />
              <div className="text-xs text-subtle">
                {t('callCenter.flagLowerReasonHint', { count: reason.trim().length })}
              </div>
            </div>
          )}

          {error && <div className="alert alert-danger"><XCircle size={16} /><span>{error}</span></div>}
        </div>
      </div>
      <div className="modal-footer">
        <Button variant="ghost" onClick={onClose} disabled={saving}>{t('common.cancel')}</Button>
        <Button color="primary" onClick={save} disabled={!canSave}>{t('common.save')}</Button>
      </div>
    </Modal>
  );
}

// ── Promise to pay ─────────────────────────────────────────────────────────────

/** Modal to log a promise-to-pay: pick a date (no past dates), optional note. */
export function PromiseModal({
  open, contractId, onClose, onSaved,
}: {
  open: boolean;
  contractId: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { addSnackbar } = useSnackbarContext();
  const [dateStr, setDateStr] = useState('');
  const [typingMode, setTypingMode] = useState(false);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) { setDateStr(''); setNote(''); setError(''); setTypingMode(false); }
  }, [open]);

  const todayStr = toLocalDateStr(new Date());
  const canSave = !!dateStr && dateStr >= todayStr && !saving;

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await logPromiseToPay({ contractId, promiseDate: dateStr, note: note.trim() || null });
      addSnackbar({
        message: <div className="alert alert-success"><CheckCircle size={18} /><span>{t('callCenter.promiseSaved')}</span></div>,
        type: 'success', duration: 2500,
      });
      onSaved();
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        const key = err.messageKey || err.code || '';
        const translated = key ? t(key, { ns: 'apiErrors', defaultValue: '' }) : '';
        setError(translated || err.message || t('common.error'));
      } else {
        setError(t('common.error'));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} maxWidth="26rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title inline-flex items-center gap-2"><Calendar size={16} />{t('callCenter.logPromise')}</h2>
        <button type="button" className="modal-close-btn" onClick={onClose}>×</button>
      </div>
      <div className="modal-content">
        <div className="form-grid gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="form-label">{t('callCenter.promiseDate')}</label>
            <InputDatePicker
              value={dateStr ? new Date(dateStr + 'T00:00:00') : null}
              onChange={(v) => setDateStr(toLocalDateStr(v))}
              datePickerProps={{ minDate: new Date(todayStr + 'T00:00:00') }}
              endIcon={<Keyboard size={16} />}
              onEndIconClick={() => setTypingMode(m => !m)}
              typingMode={typingMode}
              onTypingModeChange={setTypingMode}
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
              dateFormat={makeDatePickerFormat(i18n.language)}
              locale={i18n.language}
              calendar="gregorian"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="form-label">{t('callCenter.promiseNote')}</label>
            <TextArea
              className="w-full"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t('callCenter.promiseNotePlaceholder')}
              rows={2}
            />
          </div>
          <div className="text-xs text-subtle">{t('callCenter.promiseSuppressesHint')}</div>
          {error && <div className="alert alert-danger"><XCircle size={16} /><span>{error}</span></div>}
        </div>
      </div>
      <div className="modal-footer">
        <Button variant="ghost" onClick={onClose} disabled={saving}>{t('common.cancel')}</Button>
        <Button color="primary" onClick={save} disabled={!canSave}>{t('callCenter.logPromise')}</Button>
      </div>
    </Modal>
  );
}

// ── iCloud reveal ──────────────────────────────────────────────────────────────

const REVEAL_SECONDS = 15;

/** Inline reveal control for an iCloud pool-account password. Shows the password
 *  for 15s (visible countdown) then auto-hides; a Hide button hides it early.
 *  Never cached, never copied, never in a table. Every reveal is audited. */
export function IcloudRevealButton({ accountId }: { accountId: number }) {
  const { t } = useTranslation();
  const [result, setResult] = useState<IcloudRevealResult | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Countdown; clears the password when it hits 0.
  useEffect(() => {
    if (!result || remaining <= 0) return;
    const id = setTimeout(() => setRemaining(r => r - 1), 1000);
    return () => clearTimeout(id);
  }, [result, remaining]);

  useEffect(() => {
    if (result && remaining <= 0) setResult(null);
  }, [result, remaining]);

  const reveal = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await revealIcloudPassword(accountId);
      setResult(res);
      setRemaining(REVEAL_SECONDS);
    } catch (err) {
      if (err instanceof ApiError) {
        const key = err.messageKey || err.code || '';
        const translated = key ? t(key, { ns: 'apiErrors', defaultValue: '' }) : '';
        setError(translated || err.message || t('common.error'));
      } else {
        setError(t('common.error'));
      }
    } finally {
      setLoading(false);
    }
  };

  const hide = () => { setResult(null); setRemaining(0); };

  return (
    <div className="flex flex-col gap-1.5">
      {result ? (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-sm px-2 py-1 rounded bg-surface border border-line select-all">
            {result.password}
          </span>
          <Badge size="sm" color="default">{t('callCenter.icloudHidesIn', { n: remaining })}</Badge>
          <Button variant="ghost" size="sm" startIcon={<EyeOff size={14} />} onClick={hide}>
            {t('callCenter.icloudHide')}
          </Button>
        </div>
      ) : (
        <Button variant="outline" size="sm" startIcon={<Eye size={14} />} onClick={reveal} disabled={loading}>
          {loading ? t('common.loading') : t('callCenter.icloudReveal')}
        </Button>
      )}
      <div className="text-xs text-subtle inline-flex items-center gap-1">
        <ShieldAlert size={12} className="shrink-0" />{t('callCenter.icloudAuditNote')}
      </div>
      {error && <div className="alert alert-danger"><XCircle size={16} /><span>{error}</span></div>}
    </div>
  );
}
