import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Modal, Button, Input, Select } from 'tsp-form';
import { XCircle, Link2, CheckCircle2, Link as LinkIcon } from 'lucide-react';
import { apiClient } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import { parseLocalDate } from '../../lib/format';

/* ───────────────────────────────────────────────────────────────────────────
 * "จัดการฟอร์มนายทุน" — manage the financier Google Forms.
 *
 * The financier (นายทุน) issues a FRESH form file every month, per company (TPA
 * and SABUY use different URLs). Until a month's form is registered, that month's
 * feed rows have no prefill_url and can't be opened. This modal is a PERMANENT
 * management surface — reachable any time from the [จัดการฟอร์ม] header button —
 * not a one-shot that only appears when a form is missing:
 *   • lists every registered form (v_financier_forms) with its verified state,
 *   • lets staff paste/replace the URL for ANY month (this month, a month that's
 *     already set — wrong link / financier swapped mid-month — or next month in
 *     advance so 1st-of-month never breaks).
 *
 * Company scoping is automatic from the JWT — branch/company users never pick a
 * company; the view and RPC use their own. The URL must be a responder link
 * (…/forms/d/e/…/viewform); an /edit link is rejected with FORM_URL_INVALID.
 * Spec: UI_SUMMARY/130_FINANCIER_FORM_FEED.md §2 · NOTICE 2026-07-29.
 * ─────────────────────────────────────────────────────────────────────────── */

interface FinancierForm {
  company_id: number;
  company_name: string;
  form_month: string;   // yyyy-mm-01
  form_id: string;
  form_url: string;
  verified: boolean;
  set_by: number | null;
  set_at: string;
}

/** first-of-month ISO for `offset` months from now (offset 0 = this month). */
function monthIsoFromNow(offset: number): string {
  // Build from parts to stay in local time (no UTC day-shift).
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

export function SetFormUrlModal({
  open,
  preselectMonth,   // yyyy-mm-01 — month to preselect (from banner / FORM_URL_MISSING); optional
  onClose,
  onSaved,
}: {
  open: boolean;
  preselectMonth?: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t, i18n } = useTranslation();

  const [month, setMonth] = useState<string>('');
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedMonth, setSavedMonth] = useState<string | null>(null); // inline success flag
  const [confirmClose, setConfirmClose] = useState(false);

  const formsQuery = useQuery({
    queryKey: ['financier-forms'],
    queryFn: () => apiClient.get<FinancierForm[]>('/v_financier_forms?order=form_month.desc'),
    enabled: open,
  });
  const forms = useMemo(() => formsQuery.data ?? [], [formsQuery.data]);

  const monthLabel = (iso: string): string => {
    const d = parseLocalDate(iso);
    if (!d) return iso;
    return d.toLocaleDateString(i18n.language === 'th' ? 'th-TH' : 'en-GB', { month: 'long', year: 'numeric' });
  };

  // Month options: this month + next 2 (register ahead) + every already-set month.
  const monthOptions = useMemo(() => {
    const set = new Set<string>([monthIsoFromNow(0), monthIsoFromNow(1), monthIsoFromNow(2)]);
    for (const f of forms) set.add(f.form_month);
    return Array.from(set)
      .sort((a, b) => (a < b ? 1 : -1)) // newest first
      .map(m => ({ value: m, label: monthLabel(m) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forms, i18n.language]);

  // Seed the form on open: preselected month if given, else this month.
  useEffect(() => {
    if (open) {
      setMonth(preselectMonth || monthIsoFromNow(0));
      setUrl('');
      setError('');
      setSaving(false);
      setSavedMonth(null);
      setConfirmClose(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, preselectMonth]);

  const isDirty = url.trim().length > 0;

  const handleClose = () => {
    if (isDirty) { setConfirmClose(true); return; }
    onClose();
  };

  const handleSubmit = async () => {
    if (!month || url.trim().length === 0) return;
    setError('');
    setSaving(true);
    try {
      await apiClient.rpc('fn_financier_form_set_url', { p_month: month, p_url: url.trim() });
      setSavedMonth(month);
      setUrl('');           // clear so the field is no longer dirty
      await formsQuery.refetch();
      onSaved();            // let the page re-fetch its feed (banner may clear)
    } catch (err) {
      setError(translateApiError(err, t));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Modal open={open} onClose={handleClose} maxWidth="34rem" width="100%">
        <div className="modal-header">
          <h2 className="modal-title">{t('financierForm.manageTitle')}</h2>
          <button type="button" className="modal-close-btn" onClick={handleClose}>&times;</button>
        </div>

        <div className="modal-content">
          {/* Registered forms — one row per month, newest first. */}
          <div className="mb-5">
            <div className="text-xs font-medium text-subtle mb-2">{t('financierForm.registeredForms')}</div>
            {formsQuery.isLoading ? (
              <div className="text-sm text-subtle py-3">{t('common.loading')}</div>
            ) : forms.length === 0 ? (
              <div className="text-sm text-subtler py-3">{t('financierForm.noFormsYet')}</div>
            ) : (
              <div className="border border-line rounded-md divide-y divide-line">
                {forms.map(f => (
                  <div key={`${f.company_id}-${f.form_month}`} className="flex items-center gap-3 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">{monthLabel(f.form_month)}</div>
                      <a
                        href={f.form_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-primary-fg hover:underline inline-flex items-center gap-1 truncate max-w-full"
                      >
                        <LinkIcon size={11} className="shrink-0" />
                        <span className="truncate">{shortUrl(f.form_url)}</span>
                      </a>
                    </div>
                    <div className="shrink-0">
                      {f.verified ? (
                        <span className="inline-flex items-center gap-1 text-xs text-success-fg">
                          <CheckCircle2 size={13} /> {t('financierForm.verified')}
                        </span>
                      ) : (
                        <span className="text-xs text-subtler">{t('financierForm.unverified')}</span>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="shrink-0"
                      onClick={() => { setMonth(f.form_month); setUrl(''); setSavedMonth(null); }}
                    >
                      {t('financierForm.changeUrl')}
                    </Button>
                  </div>
                ))}
              </div>
            )}
            {/* Unverified hint — light nudge, never a blocker (NOTICE §4b). */}
            {forms.some(f => !f.verified) && (
              <p className="text-xs text-subtler mt-1.5">{t('financierForm.unverifiedHint')}</p>
            )}
          </div>

          {/* Set / replace URL for a chosen month. */}
          <div className="form-grid">
            <div className="flex flex-col">
              <label className="form-label">{t('financierForm.month')}</label>
              <div style={{ width: '14rem' }}>
                <Select
                  options={monthOptions}
                  value={month || null}
                  onChange={(v) => { setMonth((v as string) || ''); setSavedMonth(null); }}
                  searchable={false}
                />
              </div>
            </div>

            <div className="flex flex-col">
              <label className="form-label">{t('financierForm.formUrl')}</label>
              <Input
                className="w-full"
                value={url}
                onChange={(e) => { setUrl(e.target.value); setSavedMonth(null); }}
                placeholder="https://docs.google.com/forms/d/e/…/viewform"
                startIcon={<Link2 size={16} />}
              />
              <p className="text-xs text-subtle mt-1.5">{t('financierForm.formUrlHint')}</p>
            </div>

            {savedMonth && !isDirty && (
              <div className="alert alert-success">
                <CheckCircle2 size={16} />
                <span>{t('financierForm.setUrlSavedFor', { month: monthLabel(savedMonth) })}</span>
              </div>
            )}

            {error && (
              <div className="alert alert-danger">
                <XCircle size={16} />
                <span>{error}</span>
              </div>
            )}
          </div>
        </div>

        <div className="modal-footer">
          <Button variant="ghost" onClick={handleClose}>{t('common.close')}</Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            disabled={saving || !month || url.trim().length === 0}
          >
            {saving ? t('common.saving') : t('financierForm.setUrlSubmit')}
          </Button>
        </div>
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

/** Trim a Google Forms URL to something readable in a narrow row. */
function shortUrl(u: string): string {
  return u.replace(/^https?:\/\//, '').replace(/\/viewform.*$/, '');
}
