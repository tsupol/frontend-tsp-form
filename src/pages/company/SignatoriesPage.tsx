import { useMemo, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Select, Input, Switch, Modal, useSnackbarContext, FormErrorMessage, type UploadedImage } from 'tsp-form';
import { PenLine, Plus, Trash2, RefreshCw, XCircle, CheckCircle, Loader2 } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { uploadFromImage } from '../../lib/upload';
import { toStoragePath } from '../../lib/mediaPath';
import { SignatureCapture } from '../contracts/workspace/SignatureCapture';
import { SignatureThumb } from '../contracts/workspace/SignatureThumb';
import {
  useBranchSignatories,
  useBranchSignatoryDefaults,
  useInvalidateSignatories,
  type BranchSignatory,
  type SignatorySlot,
  type SignatoryRole,
} from '../contracts/workspace/useContractSignatories';

interface Branch { id: number; name: string }

const SLOTS: Array<{ slot: SignatorySlot; role: SignatoryRole; labelKey: string }> = [
  { slot: 'LESSOR', role: 'LESSOR', labelKey: 'workspace.signatoryLessor' },
  { slot: 'WITNESS_1', role: 'WITNESS', labelKey: 'workspace.signatoryWitness1' },
  { slot: 'WITNESS_2', role: 'WITNESS', labelKey: 'workspace.signatoryWitness2' },
];

export function SignatoriesPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();

  const [branchId, setBranchId] = useState<number | null>(user?.branch_id ?? null);
  const [showInactive, setShowInactive] = useState(false);
  const invalidateSignatories = useInvalidateSignatories();

  // Branch list (CA/HA see all; BM only their own)
  const { data: branches = [] } = useQuery({
    queryKey: ['branches', 'active'],
    queryFn: () => apiClient.get<Branch[]>('/v_branches?is_active=is.true&order=name'),
    staleTime: 5 * 60 * 1000,
  });

  // Auto-pick first branch if none chosen yet
  useEffect(() => {
    if (branchId == null && branches.length > 0) setBranchId(branches[0].id);
  }, [branches, branchId]);

  const { data: book = [], isLoading } = useBranchSignatories(branchId, { includeInactive: showInactive });
  const { data: defaults = [] } = useBranchSignatoryDefaults(branchId);

  const branchOptions = useMemo(() => branches.map(b => ({ value: String(b.id), label: b.name })), [branches]);

  const [addModalOpen, setAddModalOpen] = useState(false);
  const [replaceModal, setReplaceModal] = useState<BranchSignatory | null>(null);

  // ── Set default ───────────────────────────────────────────────────────
  const handleSetDefault = async (slot: SignatorySlot, signatoryId: number | null) => {
    if (!branchId || signatoryId == null) return;
    try {
      await apiClient.rpc('fn_branch_signatory_set_default', {
        p_branch_id: branchId,
        p_slot: slot,
        p_signatory_id: signatoryId,
      });
      invalidateSignatories({ branchId });
    } catch (err) {
      surfaceError(err, t, addSnackbar);
    }
  };

  // ── Toggle active ─────────────────────────────────────────────────────
  const handleToggleActive = async (id: number, active: boolean) => {
    try {
      await apiClient.rpc('fn_branch_signatory_set_active', {
        p_signatory_id: id,
        p_active: active,
      });
      invalidateSignatories({ branchId });
    } catch (err) {
      surfaceError(err, t, addSnackbar);
    }
  };

  // ── Delete ────────────────────────────────────────────────────────────
  const handleDelete = async (id: number) => {
    if (!window.confirm(t('signatory.deleteConfirm'))) return;
    try {
      await apiClient.rpc('fn_branch_signatory_delete', { p_signatory_id: id });
      invalidateSignatories({ branchId });
    } catch (err) {
      surfaceError(err, t, addSnackbar);
    }
  };

  const lessors = book.filter(b => b.role === 'LESSOR');
  const witnesses = book.filter(b => b.role === 'WITNESS');

  return (
    <div className="page-content flex flex-col gap-6 max-w-5xl">
      {/* Header */}
      <div className="flex flex-col gap-2">
        <h1 className="heading-2">{t('signatory.title')}</h1>
        <p className="text-sm text-subtle">{t('signatory.subtitle')}</p>
      </div>

      {/* Branch picker */}
      <div className="flex items-center gap-3">
        <label className="form-label mb-0 shrink-0">{t('signatory.selectBranch')}</label>
        <div style={{ width: '18rem' }}>
          <Select
            options={branchOptions}
            value={branchId != null ? String(branchId) : null}
            onChange={(val) => setBranchId(val ? Number(val) : null)}
            placeholder={t('signatory.selectBranch')}
            searchable
            clearable={false}
            size="sm"
          />
        </div>
      </div>

      {!branchId ? null : (
        <>
          {/* Defaults */}
          <section className="flex flex-col gap-3">
            <div>
              <h2 className="text-base font-medium">{t('signatory.defaultsTitle')}</h2>
              <p className="text-xs text-subtle">{t('signatory.defaultsHint')}</p>
            </div>
            <div className="border border-line rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <tbody className="divide-y divide-line">
                  {SLOTS.map(({ slot, role, labelKey }) => {
                    const def = defaults.find(d => d.slot === slot);
                    const pool = role === 'LESSOR' ? lessors.filter(s => s.is_active) : witnesses.filter(s => s.is_active);
                    const opts = pool.map(s => ({ value: String(s.signatory_id), label: `${s.first_name} ${s.last_name}` }));
                    return (
                      <tr key={slot}>
                        <td className="px-3 py-2 font-medium w-32">{t(labelKey)}</td>
                        <td className="px-3 py-2 w-16">
                          {def && <SignatureThumb mediaId={def.signature_media_id} size={28} />}
                        </td>
                        <td className="px-3 py-2">
                          <Select
                            options={opts}
                            value={def ? String(def.signatory_id) : null}
                            onChange={(val) => handleSetDefault(slot, val ? Number(val) : null)}
                            placeholder={t('common.select')}
                            searchable
                            clearable={false}
                            size="sm"
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {/* Book */}
          <section className="flex flex-col gap-3">
            <div className="flex items-end justify-between gap-3">
              <div>
                <h2 className="text-base font-medium">{t('signatory.bookTitle')}</h2>
                <p className="text-xs text-subtle">{t('signatory.bookHint')}</p>
              </div>
              <div className="flex items-center gap-3">
                <label className="inline-flex items-center gap-2 text-sm">
                  <Switch checked={showInactive} onChange={e => setShowInactive(e.target.checked)} size="sm" />
                  <span>{t('signatory.showInactive')}</span>
                </label>
                <Button color="primary" startIcon={<Plus size={14} />} size="sm" onClick={() => setAddModalOpen(true)}>
                  {t('signatory.addSignatory')}
                </Button>
              </div>
            </div>

            <div className="border border-line rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-surface">
                  <tr>
                    <th className="px-3 py-2 text-left w-20">{t('signatory.colSignature')}</th>
                    <th className="px-3 py-2 text-left">{t('signatory.colName')}</th>
                    <th className="px-3 py-2 text-left w-24">{t('signatory.colRole')}</th>
                    <th className="px-3 py-2 text-left w-24">{t('signatory.colActive')}</th>
                    <th className="px-3 py-2 text-right w-60">{t('signatory.colActions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {isLoading ? (
                    <tr><td colSpan={5} className="px-3 py-4 text-center text-subtle">
                      <Loader2 size={14} className="animate-spin inline mr-2" />
                      {t('common.loading')}
                    </td></tr>
                  ) : book.length === 0 ? (
                    <tr><td colSpan={5} className="px-3 py-4 text-center text-subtle">{t('signatory.noResults')}</td></tr>
                  ) : book.map(row => (
                    <tr key={row.signatory_id}>
                      <td className="px-3 py-2">
                        <SignatureThumb mediaId={row.signature_media_id} size={28} />
                      </td>
                      <td className="px-3 py-2 font-medium">{row.first_name} {row.last_name}</td>
                      <td className="px-3 py-2 text-subtle">
                        {row.role === 'LESSOR' ? t('signatory.roleLessor') : t('signatory.roleWitness')}
                      </td>
                      <td className="px-3 py-2">
                        <Switch
                          checked={row.is_active}
                          onChange={e => handleToggleActive(row.signatory_id, e.target.checked)}
                          size="sm"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex gap-2 justify-end">
                          <Button size="sm" startIcon={<RefreshCw size={14} />} onClick={() => setReplaceModal(row)}>
                            {t('signatory.replace')}
                          </Button>
                          <Button size="sm" startIcon={<Trash2 size={14} className="text-danger" />} onClick={() => handleDelete(row.signatory_id)}>
                            {t('signatory.delete')}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {/* Add modal */}
      <SignatoryFormModal
        open={addModalOpen}
        mode="add"
        branchId={branchId}
        onClose={() => setAddModalOpen(false)}
        onDone={() => { setAddModalOpen(false); invalidateSignatories({ branchId }); queryClient.invalidateQueries({ queryKey: ['branch-signatories'] }); }}
      />
      <SignatoryFormModal
        open={!!replaceModal}
        mode="replace"
        branchId={branchId}
        existing={replaceModal}
        onClose={() => setReplaceModal(null)}
        onDone={() => { setReplaceModal(null); invalidateSignatories({ branchId }); queryClient.invalidateQueries({ queryKey: ['branch-signatories'] }); }}
      />
    </div>
  );
}

// ── Add / Replace modal ──────────────────────────────────────────────────

interface FormModalProps {
  open: boolean;
  mode: 'add' | 'replace';
  branchId: number | null;
  existing?: BranchSignatory | null;
  onClose: () => void;
  onDone: () => void;
}

function SignatoryFormModal({ open, mode, branchId, existing, onClose, onDone }: FormModalProps) {
  const { t } = useTranslation();
  const { user } = useAuth();

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [role, setRole] = useState<SignatoryRole>('WITNESS');
  const [sigFileUrl, setSigFileUrl] = useState<string | null>(null);
  const [sigMediaId, setSigMediaId] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [fieldError, setFieldError] = useState<{ firstName?: string; lastName?: string; signature?: string }>({});

  useEffect(() => {
    if (open) {
      if (mode === 'replace' && existing) {
        setFirstName(existing.first_name);
        setLastName(existing.last_name);
        setRole(existing.role);
      } else {
        setFirstName('');
        setLastName('');
        setRole('WITNESS');
      }
      setSigFileUrl(null);
      setSigMediaId(null);
      setError('');
      setFieldError({});
    }
  }, [open, mode, existing]);

  // Upload signature → attach as core.media → media_id
  const handleSignatureUpload = async (imgs: UploadedImage[]) => {
    if (!imgs[0] || !branchId || !user) return;
    setUploading(true);
    setError('');
    try {
      // Atomic-create: signatory row doesn't exist yet, so we generate a
      // client-side slug for the storage path. Spec writes to
      //   private/branches/{branch_id}/signatory-{signatory_slug}-sm.png
      const signatorySlug = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const results = await uploadFromImage({
        type: 'branch_signatory_signature',
        image: imgs[0],
        params: { branch_id: branchId, signatory_slug: signatorySlug },
      });
      const primary = results.md?.key ?? results.sm?.key ?? Object.values(results)[0]?.key;
      if (!primary) throw new Error('Upload returned no key');

      // Private media (CONFIDENTIAL access) — backend table constraint
      // chk_media_variants_keys requires all variant paths to be PUBLIC.
      // Skip variants_json and just point at the chosen size as the main path.
      const attach = await apiClient.rpc<{ media_id: number }>('fn_media_attach', {
        p_holding_id: user.holding_id,
        p_storage_path: toStoragePath(primary),
        p_variants_json: null,
        p_media_type: 'IMAGE',
        p_access_level: 'CONFIDENTIAL',
        p_mime_type: 'image/webp',
        p_file_size_bytes: imgs[0].file?.size ?? imgs[0].originalSize ?? 0,
        p_original_filename: imgs[0].originalFile?.name ?? imgs[0].file?.name ?? 'signature.webp',
        p_entity_type: 'BRANCH',
        p_entity_id: branchId,
        p_usage_type: 'SIGNATORY_SIGNATURE',
        p_sort_order: 0,
        p_caption: null,
      });
      setSigMediaId(attach.media_id);
      setSigFileUrl(toStoragePath(primary));
    } catch (err) {
      if (err instanceof ApiError) {
        const tr = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
          || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
        setError(tr || err.message);
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async () => {
    setFieldError({});
    const fe: typeof fieldError = {};
    if (!firstName.trim()) fe.firstName = t('common.required');
    if (!lastName.trim()) fe.lastName = t('common.required');
    if (!sigMediaId) fe.signature = t('signatory.signatureRequired');
    if (Object.keys(fe).length) { setFieldError(fe); return; }

    if (!branchId) return;
    setSubmitting(true);
    setError('');
    try {
      if (mode === 'add') {
        await apiClient.rpc('fn_branch_signatory_create', {
          p_branch_id: branchId,
          p_role: role,
          p_first_name: firstName.trim(),
          p_last_name: lastName.trim(),
          p_signature_media_id: sigMediaId,
        });
      } else if (mode === 'replace' && existing) {
        await apiClient.rpc('fn_branch_signatory_replace', {
          p_old_id: existing.signatory_id,
          p_first_name: firstName.trim(),
          p_last_name: lastName.trim(),
          p_signature_media_id: sigMediaId,
        });
      }
      onDone();
    } catch (err) {
      if (err instanceof ApiError) {
        const tr = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
          || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
        setError(tr || err.message);
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} maxWidth="32rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">
          {mode === 'add' ? t('signatory.addTitle') : t('signatory.replaceTitle')}
        </h2>
      </div>
      <div className="modal-content">
        {mode === 'replace' && (
          <div className="alert alert-info mb-4">
            <PenLine size={14} />
            <span>{t('signatory.replaceHint')}</span>
          </div>
        )}
        {error && (
          <div className="alert alert-danger mb-4">
            <XCircle size={14} />
            <span>{error}</span>
          </div>
        )}

        <div className="form-grid">
          <div className="flex flex-col">
            <label className="form-label">{t('signatory.firstName')}</label>
            <Input value={firstName} onChange={e => setFirstName(e.target.value)} className="w-full" />
            <FormErrorMessage error={fieldError.firstName ? { message: fieldError.firstName } : undefined} />
          </div>
          <div className="flex flex-col">
            <label className="form-label">{t('signatory.lastName')}</label>
            <Input value={lastName} onChange={e => setLastName(e.target.value)} className="w-full" />
            <FormErrorMessage error={fieldError.lastName ? { message: fieldError.lastName } : undefined} />
          </div>
          {mode === 'add' && (
            <div className="flex flex-col">
              <label className="form-label">{t('signatory.role')}</label>
              <Select
                options={[
                  { value: 'LESSOR', label: t('signatory.roleLessor') },
                  { value: 'WITNESS', label: t('signatory.roleWitness') },
                ]}
                value={role}
                onChange={val => setRole(val as SignatoryRole)}
                clearable={false}
              />
            </div>
          )}
          <div className="flex flex-col">
            <SignatureCapture
              fileUrl={sigFileUrl}
              uploading={uploading}
              onUpload={handleSignatureUpload}
            />
            <FormErrorMessage error={fieldError.signature ? { message: fieldError.signature } : undefined} />
          </div>
        </div>
      </div>
      <div className="modal-footer">
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button
          color="primary"
          onClick={handleSubmit}
          disabled={submitting || uploading}
          startIcon={submitting ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
        >
          {submitting ? t('common.saving') : (mode === 'add' ? t('signatory.saveAdd') : t('signatory.saveReplace'))}
        </Button>
      </div>
    </Modal>
  );
}

// ── Error helper ─────────────────────────────────────────────────────────

function surfaceError(err: unknown, t: (k: string, opts?: Record<string, unknown>) => string, addSnackbar: (s: { message: React.ReactNode; type?: 'success' | 'error' }) => void) {
  let msg = '';
  if (err instanceof ApiError) {
    msg = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
      || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '')
      || err.message;
  } else {
    msg = err instanceof Error ? err.message : String(err);
  }
  addSnackbar({
    message: (
      <div className="alert alert-danger">
        <XCircle size={16} />
        <span>{msg}</span>
      </div>
    ),
    type: 'error',
  });
}
