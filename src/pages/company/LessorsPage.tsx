import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useForm, Controller } from 'react-hook-form';
import { useQueryClient } from '@tanstack/react-query';
import {
  Button, Input, MaskedInput, TextArea, Modal, Switch, PopOver, MenuItem, MenuSeparator,
  useSnackbarContext, FormErrorMessage, type UploadedImage,
} from 'tsp-form';
import {
  Plus, MoreHorizontal, Pencil, RefreshCw, Trash2, ShieldOff,
  XCircle, CheckCircle, Loader2,
} from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import { useAuth } from '../../contexts/AuthContext';
import { uploadFromImage, mimeFromKey } from '../../lib/upload';
import { toStoragePath } from '../../lib/mediaPath';
import { passesThaiCidChecksum } from '../../lib/ocr/extractIdCard';
import { SignatureCapture } from '../contracts/workspace/SignatureCapture';
import { SignatureThumb } from '../contracts/workspace/SignatureThumb';
import {
  useCompanyLessors, useInvalidateSignatories, composeName, type CompanyLessor,
} from '../contracts/workspace/useContractSignatories';

interface LessorForm {
  prefix: string;
  first_name: string;
  last_name: string;
  id_number: string;
  address: string;
}

type ModalMode = 'create' | 'edit' | 'replace';

export function LessorsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const companyId = user?.company_id ?? null;
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();
  const invalidate = useInvalidateSignatories();

  const [modalMode, setModalMode] = useState<ModalMode | null>(null);
  const [editLessor, setEditLessor] = useState<CompanyLessor | null>(null);
  const [deleteLessor, setDeleteLessor] = useState<CompanyLessor | null>(null);

  const { data: lessors = [], isLoading } = useCompanyLessors(companyId, { includeInactive: true });

  const openCreate = () => { setEditLessor(null); setModalMode('create'); };
  const openEdit = (l: CompanyLessor) => { setEditLessor(l); setModalMode('edit'); };
  const openReplace = (l: CompanyLessor) => { setEditLessor(l); setModalMode('replace'); };

  const closeModal = () => { setModalMode(null); setEditLessor(null); };

  const handleSetActive = async (l: CompanyLessor, active: boolean) => {
    try {
      await apiClient.rpc('fn_company_lessor_set_active', {
        p_lessor_id: l.lessor_id,
        p_active: active,
      });
      invalidate({ companyId });
      addSnackbar({
        message: <div className="alert alert-success"><CheckCircle size={16} /><span>{t('common.saved')}</span></div>,
        type: 'success',
      });
    } catch (err) {
      surfaceError(err, t, addSnackbar);
    }
  };

  return (
    <div className="page-content flex flex-col gap-6 max-w-5xl">
      {/* Header */}
      <div className="flex flex-col gap-2">
        <h1 className="heading-2">{t('lessors.title')}</h1>
        <p className="text-sm text-subtle">{t('lessors.subtitle')}</p>
      </div>

      <section className="flex flex-col gap-3">
        <div className="flex justify-end">
          <Button color="primary" startIcon={<Plus size={14} />} onClick={openCreate}>
            {t('lessors.add')}
          </Button>
        </div>

        <div className="border border-line rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface">
              <tr>
                <th className="px-3 py-2 text-left w-20">{t('lessors.colSignature')}</th>
                <th className="px-3 py-2 text-left">{t('lessors.colName')}</th>
                <th className="px-3 py-2 text-left w-44">{t('lessors.colId')}</th>
                <th className="px-3 py-2 text-left w-24">{t('lessors.colActive')}</th>
                <th className="px-3 py-2 text-right w-16">{t('lessors.colActions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {isLoading ? (
                <tr><td colSpan={5} className="px-3 py-4 text-center text-subtle">
                  <Loader2 size={14} className="animate-spin inline mr-2" />
                  {t('common.loading')}
                </td></tr>
              ) : lessors.length === 0 ? (
                <tr><td colSpan={5} className="px-3 py-4 text-center text-subtle">{t('lessors.noResults')}</td></tr>
              ) : lessors.map(l => (
                <tr key={l.lessor_id}>
                  <td className="px-3 py-2">
                    <SignatureThumb mediaId={l.signature_media_id} size={28} />
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium">{composeName(l.prefix, l.first_name, l.last_name)}</div>
                    {l.default_usage_count > 0 && (
                      <div className="text-xs text-subtle mt-0.5">
                        {t('lessors.defaultOnBranches', { count: l.default_usage_count })}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{formatCidMasked(l.id_number)}</td>
                  <td className="px-3 py-2">
                    <Switch
                      checked={l.is_active}
                      onChange={e => handleSetActive(l, e.target.checked)}
                      size="sm"
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <RowActions
                      lessor={l}
                      onEdit={openEdit}
                      onReplace={openReplace}
                      onDelete={setDeleteLessor}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <LessorFormModal
        open={modalMode !== null}
        mode={modalMode ?? 'create'}
        lessor={editLessor}
        companyId={companyId}
        onClose={closeModal}
        onDone={() => { closeModal(); invalidate({ companyId }); queryClient.invalidateQueries({ queryKey: ['company-lessors'] }); }}
      />

      <DeleteLessorModal
        open={!!deleteLessor}
        lessor={deleteLessor}
        otherLessors={lessors.filter(l =>
          l.lessor_id !== deleteLessor?.lessor_id
          && l.is_active
          && l.default_usage_count === 0
        )}
        onClose={() => setDeleteLessor(null)}
        onDone={() => { setDeleteLessor(null); invalidate({ companyId }); }}
      />
    </div>
  );
}

// ── Row actions ──────────────────────────────────────────────────────────

function RowActions({ lessor, onEdit, onReplace, onDelete }: {
  lessor: CompanyLessor;
  onEdit: (l: CompanyLessor) => void;
  onReplace: (l: CompanyLessor) => void;
  onDelete: (l: CompanyLessor) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <PopOver
      isOpen={open}
      onClose={() => setOpen(false)}
      placement="bottom"
      align="end"
      offset={4}
      openDelay={0}
      trigger={
        <button
          className="p-1 rounded hover:bg-surface-hover transition-colors cursor-pointer"
          onClick={(e: React.MouseEvent) => { e.stopPropagation(); setOpen(!open); }}
          aria-label="Actions"
        >
          <MoreHorizontal size={16} className="opacity-50" />
        </button>
      }
    >
      <div className="py-1 min-w-[180px]">
        <MenuItem icon={<Pencil size={14} />} label={t('common.edit')} onClick={() => { setOpen(false); onEdit(lessor); }} />
        <MenuItem icon={<RefreshCw size={14} />} label={t('lessors.replaceSignature')} onClick={() => { setOpen(false); onReplace(lessor); }} />
        <MenuSeparator />
        <MenuItem icon={<Trash2 size={14} className="text-danger" />} label={t('common.delete')} onClick={() => { setOpen(false); onDelete(lessor); }} />
      </div>
    </PopOver>
  );
}

// ── Create / Edit / Replace modal ────────────────────────────────────────

interface FormModalProps {
  open: boolean;
  mode: ModalMode;
  lessor: CompanyLessor | null;
  companyId: number | null;
  onClose: () => void;
  onDone: () => void;
}

function LessorFormModal({ open, mode, lessor, companyId, onClose, onDone }: FormModalProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [sigFileUrl, setSigFileUrl] = useState<string | null>(null);
  const [sigMediaId, setSigMediaId] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [sigError, setSigError] = useState('');

  const { register, handleSubmit, reset, control, formState: { errors } } = useForm<LessorForm>({
    defaultValues: { prefix: '', first_name: '', last_name: '', id_number: '', address: '' },
  });

  useEffect(() => {
    if (!open) return;
    if (lessor) {
      reset({
        prefix: lessor.prefix,
        first_name: lessor.first_name,
        last_name: lessor.last_name ?? '',
        id_number: lessor.id_number,
        address: lessor.address,
      });
    } else {
      reset({ prefix: '', first_name: '', last_name: '', id_number: '', address: '' });
    }
    setSigFileUrl(null);
    setSigMediaId(null);
    setErrorMessage('');
    setSigError('');
  }, [open, lessor, reset]);

  const handleSignatureUpload = async (imgs: UploadedImage[]) => {
    if (!imgs[0] || !user) return;
    setUploading(true);
    setSigError('');
    try {
      const slug = `lessor-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const branchHint = user.branch_id ?? 0;
      const results = await uploadFromImage({
        type: 'branch_signatory_signature',
        image: imgs[0],
        params: { branch_id: branchHint, signatory_slug: slug },
      });
      const primary = results.md?.key ?? results.sm?.key ?? Object.values(results)[0]?.key;
      if (!primary) throw new Error('Upload returned no key');
      const attach = await apiClient.rpc<{ media_id: number }>('fn_media_attach', {
        p_holding_id: user.holding_id,
        p_storage_path: toStoragePath(primary),
        p_variants_json: null,
        p_media_type: 'IMAGE',
        p_access_level: 'CONFIDENTIAL',
        p_mime_type: mimeFromKey(primary),
        p_file_size_bytes: imgs[0].file?.size ?? imgs[0].originalSize ?? 0,
        p_original_filename: imgs[0].originalFile?.name ?? imgs[0].file?.name ?? 'signature.webp',
        p_entity_type: 'COMPANY',
        p_entity_id: companyId,
        p_usage_type: 'SIGNATORY_SIGNATURE',
        p_sort_order: 0,
        p_caption: null,
      });
      setSigMediaId(attach.media_id);
      setSigFileUrl(toStoragePath(primary));
    } catch (err) {
      setSigError(err instanceof ApiError ? translateApiError(err, t) : (err instanceof Error ? err.message : String(err)));
    } finally {
      setUploading(false);
    }
  };

  const onSubmit = async (data: LessorForm) => {
    setErrorMessage('');
    if (mode === 'create' || mode === 'replace') {
      if (!sigMediaId) { setSigError(t('lessors.signatureRequired')); return; }
    }
    if (!companyId) return;
    setSubmitting(true);
    try {
      if (mode === 'create') {
        await apiClient.rpc('fn_company_lessor_create', {
          p_company_id: companyId,
          p_prefix: data.prefix.trim(),
          p_first_name: data.first_name.trim(),
          p_last_name: data.last_name.trim() || null,
          p_id_number: data.id_number.trim(),
          p_address: data.address.trim(),
          p_signature_media_id: sigMediaId,
        });
      } else if (mode === 'edit' && lessor) {
        await apiClient.rpc('fn_company_lessor_update', {
          p_lessor_id: lessor.lessor_id,
          p_prefix: data.prefix.trim() || null,
          p_first_name: data.first_name.trim() || null,
          p_last_name: data.last_name.trim() || null,
          p_id_number: data.id_number.trim() || null,
          p_address: data.address.trim() || null,
        });
      } else if (mode === 'replace' && lessor) {
        await apiClient.rpc('fn_company_lessor_replace', {
          p_old_lessor_id: lessor.lessor_id,
          p_signature_media_id: sigMediaId,
          p_prefix: data.prefix.trim() || null,
          p_first_name: data.first_name.trim() || null,
          p_last_name: data.last_name.trim() || null,
          p_id_number: data.id_number.trim() || null,
          p_address: data.address.trim() || null,
        });
      }
      onDone();
    } catch (err) {
      setErrorMessage(err instanceof ApiError ? translateApiError(err, t) : (err instanceof Error ? err.message : String(err)));
    } finally {
      setSubmitting(false);
    }
  };

  const titleKey = mode === 'create' ? 'lessors.addTitle' : mode === 'edit' ? 'lessors.editTitle' : 'lessors.replaceTitle';
  const showSignature = mode === 'create' || mode === 'replace';
  const existingSigUrl: string | null = null;

  return (
    <Modal open={open} onClose={onClose} maxWidth="36rem" width="100%">
      <form className="flex flex-col overflow-hidden" onSubmit={handleSubmit(onSubmit)}>
        <div className="modal-header">
          <h2 className="modal-title">{t(titleKey)}</h2>
        </div>
        <div className="modal-content">
          {mode === 'replace' && (
            <div className="alert alert-info mb-4">
              <RefreshCw size={14} />
              <span>{t('lessors.replaceHint')}</span>
            </div>
          )}
          {errorMessage && (
            <div className="alert alert-danger mb-4">
              <XCircle size={18} />
              <span>{errorMessage}</span>
            </div>
          )}

          <div className="form-grid">
            <div className="flex gap-3">
              <div className="flex flex-col" style={{ width: '14rem' }}>
                <label className="form-label">{t('lessors.prefix')}</label>
                <Input
                  {...register('prefix', { required: t('common.required') })}
                  placeholder={t('lessors.prefixPlaceholder')}
                  className="w-full"
                />
                <FormErrorMessage error={errors.prefix} />
              </div>
              <div className="flex flex-col flex-1 min-w-0">
                <label className="form-label">{t('lessors.firstName')}</label>
                <Input {...register('first_name', { required: t('common.required') })} className="w-full" />
                <FormErrorMessage error={errors.first_name} />
              </div>
              <div className="flex flex-col flex-1 min-w-0">
                <label className="form-label">{t('lessors.lastName')}</label>
                <Input
                  {...register('last_name')}
                  placeholder={t('lessors.lastNamePlaceholder')}
                  className="w-full"
                />
              </div>
            </div>

            <div className="flex flex-col" style={{ maxWidth: '20rem' }}>
              <label className="form-label">{t('lessors.idNumber')}</label>
              <Controller
                name="id_number"
                control={control}
                rules={{
                  required: t('common.required'),
                  validate: v => (/^\d{13}$/.test(v) && passesThaiCidChecksum(v)) || t('lessors.idInvalid'),
                }}
                render={({ field }) => (
                  <MaskedInput
                    mask="#-####-#####-##-#"
                    placeholder=""
                    value={field.value}
                    onChange={(raw) => field.onChange(raw)}
                    className="w-full"
                    endIcon={<CidChecksumIcon digits={field.value} />}
                  />
                )}
              />
              <FormErrorMessage error={errors.id_number} />
            </div>

            <div className="flex flex-col">
              <label className="form-label">{t('lessors.address')}</label>
              <TextArea
                {...register('address', { required: t('common.required') })}
                rows={2}
                className="w-full"
              />
              <FormErrorMessage error={errors.address} />
            </div>

            {showSignature && (
              <div className="flex flex-col">
                <label className="form-label">{t('lessors.signature')}</label>
                <SignatureCapture
                  fileUrl={sigFileUrl ?? existingSigUrl}
                  uploading={uploading}
                  onUpload={handleSignatureUpload}
                />
                <FormErrorMessage error={sigError ? { message: sigError } : undefined} />
              </div>
            )}
          </div>
        </div>
        <div className="modal-footer">
          <Button type="button" onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            type="submit"
            color="primary"
            disabled={submitting || uploading}
            startIcon={submitting ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
          >
            {submitting ? t('common.saving') : t('common.save')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ── Delete modal (with optional transfer-default) ────────────────────────

function DeleteLessorModal({ open, lessor, otherLessors, onClose, onDone }: {
  open: boolean;
  lessor: CompanyLessor | null;
  otherLessors: CompanyLessor[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const { addSnackbar } = useSnackbarContext();
  const [transferTo, setTransferTo] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const hasDefaults = !!lessor && lessor.default_usage_count > 0;

  useEffect(() => {
    if (open) { setTransferTo(null); setErrorMessage(''); }
  }, [open]);

  const handleConfirm = async () => {
    if (!lessor) return;
    if (hasDefaults && transferTo == null) {
      setErrorMessage(t('lessors.transferRequired'));
      return;
    }
    setSubmitting(true);
    try {
      await apiClient.rpc('fn_company_lessor_delete', {
        p_lessor_id: lessor.lessor_id,
        p_transfer_default_to: transferTo,
      });
      addSnackbar({
        message: <div className="alert alert-success"><CheckCircle size={16} /><span>{t('common.deleted')}</span></div>,
        type: 'success',
      });
      onDone();
    } catch (err) {
      setErrorMessage(err instanceof ApiError ? translateApiError(err, t) : (err instanceof Error ? err.message : String(err)));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} maxWidth="28rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">{t('lessors.deleteTitle')}</h2>
      </div>
      <div className="modal-content">
        <p className="text-sm mb-4">
          {t('lessors.deleteConfirm', { name: lessor ? composeName(lessor.prefix, lessor.first_name, lessor.last_name) : '' })}
        </p>
        {hasDefaults && (
          <div className="alert alert-warning mb-4">
            <ShieldOff size={14} />
            <div>
              <div className="alert-description">
                {t('lessors.deleteHasDefaults', { count: lessor!.default_usage_count })}
              </div>
            </div>
          </div>
        )}
        {hasDefaults && (
          <div className="form-grid">
            <div className="flex flex-col">
              <label className="form-label">{t('lessors.transferTo')}</label>
              <select
                className="w-full border border-line rounded px-2 py-1.5 text-sm bg-surface"
                value={transferTo ?? ''}
                onChange={e => setTransferTo(e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">{t('common.select')}</option>
                {otherLessors.map(l => (
                  <option key={l.lessor_id} value={l.lessor_id}>{composeName(l.prefix, l.first_name, l.last_name)}</option>
                ))}
              </select>
            </div>
          </div>
        )}
        {errorMessage && (
          <div className="alert alert-danger mt-2">
            <XCircle size={14} />
            <span>{errorMessage}</span>
          </div>
        )}
      </div>
      <div className="modal-footer">
        <Button type="button" onClick={onClose}>{t('common.cancel')}</Button>
        <Button
          type="button"
          color="danger"
          onClick={handleConfirm}
          disabled={submitting}
          startIcon={submitting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
        >
          {submitting ? t('common.saving') : t('common.delete')}
        </Button>
      </div>
    </Modal>
  );
}

// ── helpers ──────────────────────────────────────────────────────────────

function CidChecksumIcon({ digits }: { digits: string }) {
  const raw = digits.replace(/\D/g, '');
  if (raw.length !== 13) return null;
  return passesThaiCidChecksum(raw)
    ? <CheckCircle size={14} className="text-success" />
    : <XCircle size={14} className="text-warning-fg" />;
}

function formatCidMasked(cid: string): string {
  if (!/^\d{13}$/.test(cid)) return cid;
  return `${cid[0]}-${cid.slice(1, 5)}-${cid.slice(5, 10)}-${cid.slice(10, 12)}-${cid[12]}`;
}

function surfaceError(err: unknown, t: ReturnType<typeof useTranslation>['t'], addSnackbar: (s: { message: React.ReactNode; type?: 'success' | 'error' }) => void) {
  const msg = err instanceof ApiError
    ? translateApiError(err, t)
    : (err instanceof Error ? err.message : String(err));
  addSnackbar({
    message: <div className="alert alert-danger"><XCircle size={16} /><span>{msg}</span></div>,
    type: 'error',
  });
}

