import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Modal, Button, Input, Select } from 'tsp-form';
import { XCircle, Link2, CheckCircle2, Link as LinkIcon } from 'lucide-react';
import { apiClient } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import { useAuth } from '../../contexts/AuthContext';
import { DateTime } from '../../components/DateTime';

/* ───────────────────────────────────────────────────────────────────────────
 * "จัดการฟอร์มนายทุน" — manage the financier Google Forms.
 *
 * ⭐ Forms are PER BRANCH, not per company/month (mig 47, UPDATE 2026-07-31).
 * Each branch has its own financier form URL. There is NO monthly cycle: a form
 * has an effective_from date and stays in force until a newer one is placed.
 * The financier may swap the form on any day — the branch pastes the new URL
 * that day, and the old one is kept as history (a new row, never overwritten).
 *
 * This is a PERMANENT management surface — reachable any time from the
 * [จัดการฟอร์ม] header button — not a one-shot that only appears when a form is
 * missing. It lists every form the branch has ever had (v_financier_forms),
 * newest first, with the current one highlighted and the rest shown as history.
 *
 * Scope: a BRANCH_MANAGER manages only their own branch (no branch picker — the
 * JWT supplies it). A COMPANY_ADMIN / HOLDING_ADMIN picks the target branch.
 * The URL must be a responder link (…/forms/d/e/…/viewform); an /edit link is
 * rejected with FORM_URL_INVALID. Spec: UI_SUMMARY/130 · UPDATE 2026-07-31.
 * ─────────────────────────────────────────────────────────────────────────── */

interface FinancierForm {
  branch_id: number;
  branch_name: string;
  company_id: number;
  company_name: string;
  effective_from: string;   // yyyy-mm-dd
  form_label: string | null;
  form_id: string;
  form_url: string;
  verified: boolean;
  is_current: boolean;
  set_by: number | null;
  set_at: string;
}

interface BranchRow {
  id: number;
  name: string;
}

export function SetFormUrlModal({
  open,
  preselectBranch,   // branch_id to preselect (from banner / FORM_URL_MISSING); optional
  onClose,
  onSaved,
}: {
  open: boolean;
  preselectBranch?: number | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  // Branch users manage only their own branch; company/holding users pick one.
  const ownBranchId = user?.branch_id ?? null;
  const needsBranchPicker = ownBranchId == null;

  const [branchId, setBranchId] = useState<number | null>(null);
  const [url, setUrl] = useState('');
  const [label, setLabel] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false); // inline success flag
  const [confirmClose, setConfirmClose] = useState(false);

  // Branch list for the picker (company/holding scope via RLS). Skipped for BM.
  const branchesQuery = useQuery({
    queryKey: ['financier-branches'],
    queryFn: () => apiClient.get<BranchRow[]>('/v_branches?is_active=is.true&order=name&select=id,name'),
    enabled: open && needsBranchPicker,
  });
  const branches = branchesQuery.data ?? [];

  // Effective target branch: explicit pick (company/holding) or own (branch user).
  const targetBranch = needsBranchPicker ? branchId : ownBranchId;

  // Every form this branch has ever had, newest first.
  const formsQuery = useQuery({
    queryKey: ['financier-forms', targetBranch],
    queryFn: () => apiClient.get<FinancierForm[]>(
      `/v_financier_forms?branch_id=eq.${targetBranch}&order=effective_from.desc`,
    ),
    enabled: open && targetBranch != null,
  });
  const forms = useMemo(() => formsQuery.data ?? [], [formsQuery.data]);

  // Seed on open: preselected branch (banner / missing-form) or own branch.
  useEffect(() => {
    if (open) {
      setBranchId(preselectBranch ?? ownBranchId ?? null);
      setUrl('');
      setLabel('');
      setError('');
      setSaving(false);
      setSaved(false);
      setConfirmClose(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, preselectBranch, ownBranchId]);

  const isDirty = url.trim().length > 0 || label.trim().length > 0;

  const handleClose = () => {
    if (isDirty) { setConfirmClose(true); return; }
    onClose();
  };

  const handleSubmit = async () => {
    if (targetBranch == null || url.trim().length === 0) return;
    setError('');
    setSaving(true);
    try {
      // effective_from defaults to today server-side — the financier told us the
      // form today, we place it today. No month, no back-dating in the normal case.
      await apiClient.rpc('fn_financier_form_set_url', {
        p_branch_id: targetBranch,
        p_url: url.trim(),
        p_label: label.trim() || null,
      });
      setSaved(true);
      setUrl('');     // clear so the field is no longer dirty
      setLabel('');
      await formsQuery.refetch();
      onSaved();      // let the page re-fetch its feed (banner may clear)
    } catch (err) {
      setError(translateApiError(err, t));
    } finally {
      setSaving(false);
    }
  };

  const branchName = needsBranchPicker
    ? branches.find(b => b.id === targetBranch)?.name
    : user?.branch_name;
  const title = branchName
    ? t('financierForm.manageTitleBranch', { branch: branchName })
    : t('financierForm.manageTitle');

  return (
    <>
      <Modal open={open} onClose={handleClose} maxWidth="34rem" width="100%">
        <div className="modal-header">
          <h2 className="modal-title">{title}</h2>
          <button type="button" className="modal-close-btn" onClick={handleClose}>&times;</button>
        </div>

        <div className="modal-content">
          {/* Branch picker — company/holding users only. */}
          {needsBranchPicker && (
            <div className="flex flex-col mb-5">
              <label className="form-label">{t('financierForm.branch')}</label>
              <div style={{ width: '18rem' }}>
                <Select
                  options={branches.map(b => ({ value: String(b.id), label: b.name }))}
                  value={targetBranch != null ? String(targetBranch) : null}
                  onChange={(v) => { setBranchId(v ? Number(v) : null); setSaved(false); }}
                  placeholder={t('financierForm.selectBranch')}
                  size="sm"
                  searchable
                />
              </div>
            </div>
          )}

          {targetBranch == null ? (
            <div className="text-sm text-subtler py-3">{t('financierForm.pickBranchFirst')}</div>
          ) : (
            <>
              {/* Every form this branch has had — current highlighted, rest history. */}
              <div className="mb-5">
                <div className="text-xs font-medium text-subtle mb-2">{t('financierForm.registeredForms')}</div>
                {formsQuery.isLoading ? (
                  <div className="text-sm text-subtle py-3">{t('common.loading')}</div>
                ) : forms.length === 0 ? (
                  <div className="text-sm text-subtler py-3">{t('financierForm.noFormsYet')}</div>
                ) : (
                  // Capped height + own scroll so a long history never pushes the
                  // URL field out of reach.
                  <div className="border border-line rounded-md divide-y divide-line max-h-64 overflow-y-auto better-scroll">
                    {forms.map(f => (
                      <div
                        key={`${f.branch_id}-${f.effective_from}-${f.form_id}`}
                        className={`flex items-center gap-3 px-3 py-2 ${f.is_current ? 'bg-primary-soft' : ''}`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium truncate">
                              {f.form_label || t('financierForm.formUnlabeled')}
                            </span>
                            {f.is_current ? (
                              <span className="text-[11px] px-1.5 py-0.5 rounded bg-primary text-primary-contrast shrink-0">
                                {t('financierForm.current')}
                              </span>
                            ) : (
                              <span className="text-[11px] text-subtler shrink-0">{t('financierForm.history')}</span>
                            )}
                          </div>
                          <div className="text-xs text-subtle mt-0.5 inline-flex items-center gap-1">
                            <span>{t('financierForm.effectiveFromLabel')}</span>
                            <DateTime value={f.effective_from} showTime={false} />
                          </div>
                          <a
                            href={f.form_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-primary-fg hover:underline inline-flex items-center gap-1 truncate max-w-full mt-0.5"
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
                      </div>
                    ))}
                  </div>
                )}
                {/* Unverified hint — light nudge, never a blocker (§3.5). */}
                {forms.some(f => !f.verified) && (
                  <p className="text-xs text-subtler mt-1.5">{t('financierForm.unverifiedHint')}</p>
                )}
              </div>

              {/* Place a NEW form (financier sent a new one). No month, no overwrite —
                  a fresh row keeps the old form as history. */}
              <div className="form-grid">
                <div className="text-xs font-medium text-subtle -mb-2">{t('financierForm.placeNewForm')}</div>
                <div className="flex flex-col">
                  <label className="form-label">{t('financierForm.formUrl')}</label>
                  <Input
                    className="w-full"
                    value={url}
                    onChange={(e) => { setUrl(e.target.value); setSaved(false); }}
                    placeholder="https://docs.google.com/forms/d/e/…/viewform"
                    startIcon={<Link2 size={16} />}
                  />
                  <p className="text-xs text-subtle mt-1.5">{t('financierForm.formUrlHint')}</p>
                </div>

                <div className="flex flex-col">
                  <label className="form-label">{t('financierForm.formLabel')}</label>
                  <Input
                    className="w-full"
                    value={label}
                    onChange={(e) => { setLabel(e.target.value); setSaved(false); }}
                    placeholder={t('financierForm.formLabelPlaceholder')}
                  />
                  <p className="text-xs text-subtler mt-1.5">{t('financierForm.keepOldHint')}</p>
                </div>

                {saved && !isDirty && (
                  <div className="alert alert-success">
                    <CheckCircle2 size={16} />
                    <span>{t('financierForm.setUrlSaved')}</span>
                  </div>
                )}

                {error && (
                  <div className="alert alert-danger">
                    <XCircle size={16} />
                    <span>{error}</span>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <div className="modal-footer">
          <Button variant="ghost" onClick={handleClose}>{t('common.close')}</Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            disabled={saving || targetBranch == null || url.trim().length === 0}
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
