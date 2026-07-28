import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Button, Input } from 'tsp-form';
import { XCircle, Link2 } from 'lucide-react';
import { apiClient } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import { ActionDoneView } from '../contracts/ActionDoneView';

/* ───────────────────────────────────────────────────────────────────────────
 * "วาง URL ฟอร์มเดือนใหม่" — registers the financier Google Form for a given
 * (company, month) via fn_financier_form_set_url. The financier issues a fresh
 * form per company per month; until one is registered, that month's feed rows
 * have no prefill_url and can't be opened.
 *
 * The URL must be a responder link (/forms/d/e/…/viewform) — an /edit link is
 * rejected by the backend with ETL.FINANCIER.FORM_URL_INVALID.
 * Spec: UI_SUMMARY/130_FINANCIER_FORM_FEED.md §2.
 * ─────────────────────────────────────────────────────────────────────────── */

interface SetFormUrlResult {
  form_id: string;
  company_id: number;
  form_month: string;   // yyyy-mm-01
}

export function SetFormUrlModal({
  open,
  month,          // yyyy-mm-01 — the month whose form is being registered
  monthLabel,     // human label e.g. "กรกฎาคม 2026"
  onClose,
  onSaved,
}: {
  open: boolean;
  month: string;
  monthLabel: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [view, setView] = useState<'form' | 'done'>('form');
  const [url, setUrl] = useState('');
  const [result, setResult] = useState<SetFormUrlResult | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);

  // Reset to a clean form each time the modal opens.
  useEffect(() => {
    if (open) {
      setView('form');
      setUrl('');
      setResult(null);
      setError('');
      setSaving(false);
      setConfirmClose(false);
    }
  }, [open]);

  const isDirty = view === 'form' && url.trim().length > 0;

  const handleClose = () => {
    if (view === 'done') { onClose(); return; }
    if (isDirty) { setConfirmClose(true); return; }
    onClose();
  };

  const handleSubmit = async () => {
    setError('');
    setSaving(true);
    try {
      const res = await apiClient.rpc<SetFormUrlResult>('fn_financier_form_set_url', {
        p_month: month,
        p_url: url.trim(),
      });
      setResult(res);
      setView('done');
      onSaved();
    } catch (err) {
      setError(translateApiError(err, t));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Modal open={open} onClose={handleClose} maxWidth="30rem" width="100%">
        {view === 'form' && (
          <>
            <div className="modal-header">
              <h2 className="modal-title">{t('financierForm.setUrlTitle')}</h2>
              <button type="button" className="modal-close-btn" onClick={handleClose}>&times;</button>
            </div>
            <div className="modal-content">
              <div className="px-3 py-2.5 rounded-md bg-surface border border-line mb-4">
                <div className="font-medium text-sm">{monthLabel}</div>
                <div className="text-xs text-subtle">{t('financierForm.setUrlForMonth')}</div>
              </div>

              <div className="form-grid">
                <div className="flex flex-col">
                  <label className="form-label">{t('financierForm.formUrl')}</label>
                  <Input
                    className="w-full"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://docs.google.com/forms/d/e/…/viewform"
                    startIcon={<Link2 size={16} />}
                    autoFocus
                  />
                  <p className="text-xs text-subtle mt-1.5">{t('financierForm.formUrlHint')}</p>
                </div>

                {error && (
                  <div className="alert alert-danger">
                    <XCircle size={16} />
                    <span>{error}</span>
                  </div>
                )}
              </div>
            </div>
            <div className="modal-footer">
              <Button variant="ghost" onClick={handleClose}>{t('common.cancel')}</Button>
              <Button
                variant="primary"
                onClick={handleSubmit}
                disabled={saving || url.trim().length === 0}
              >
                {saving ? t('common.saving') : t('financierForm.setUrlSubmit')}
              </Button>
            </div>
          </>
        )}

        {view === 'done' && result && (
          <ActionDoneView
            headline={t('financierForm.setUrlDone')}
            contractCode={monthLabel}
            detailRows={[
              { label: t('financierForm.formUrl'), value: <span className="break-all">{url.trim()}</span> },
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
          <Button color="danger" onClick={() => { setConfirmClose(false); onClose(); }}>{t('common.discard')}</Button>
        </div>
      </Modal>
    </>
  );
}
