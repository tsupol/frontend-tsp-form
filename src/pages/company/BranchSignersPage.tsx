import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useForm, Controller } from 'react-hook-form';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button, Input, Select, MaskedInput, TextArea, Modal, Switch, PopOver, MenuItem, MenuSeparator,
  useSnackbarContext, FormErrorMessage, type UploadedImage,
} from 'tsp-form';
import {
  Plus, MoreHorizontal, Pencil, RefreshCw, Trash2, ShieldOff,
  XCircle, CheckCircle, Loader2, Info,
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
  useCompanyLessors,
  useBranchWitnesses,
  useBranchSignatoryDefaults,
  useInvalidateSignatories,
  composeName,
  type BranchWitness,
  type SignatorySlot,
} from '../contracts/workspace/useContractSignatories';

interface Branch { id: number; name: string; company_id: number }

interface WitnessForm {
  prefix: string;
  first_name: string;
  last_name: string;
  id_number: string;
  address: string;
}

type ModalMode = 'create' | 'edit' | 'replace';

export function BranchSignersPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();
  const invalidate = useInvalidateSignatories();

  const [branchId, setBranchId] = useState<number | null>(user?.branch_id ?? null);
  const [modalMode, setModalMode] = useState<ModalMode | null>(null);
  const [editWitness, setEditWitness] = useState<BranchWitness | null>(null);
  const [deleteWitness, setDeleteWitness] = useState<BranchWitness | null>(null);

  // Branch list
  const { data: branches = [] } = useQuery({
    queryKey: ['branches', 'active'],
    queryFn: () => apiClient.get<Branch[]>('/v_branches?is_active=is.true&order=name'),
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (branchId == null && branches.length > 0) setBranchId(branches[0].id);
  }, [branches, branchId]);

  const currentBranch = useMemo(() => branches.find(b => b.id === branchId) ?? null, [branches, branchId]);
  const companyId = currentBranch?.company_id ?? user?.company_id ?? null;

  const { data: witnesses = [], isLoading: witnessesLoading } = useBranchWitnesses(branchId, { includeInactive: true });
  const { data: defaults = [] } = useBranchSignatoryDefaults(branchId);
  const { data: lessors = [] } = useCompanyLessors(companyId);

  const branchOptions = useMemo(() => branches.map(b => ({ value: String(b.id), label: b.name })), [branches]);

  const openCreate = () => { setEditWitness(null); setModalMode('create'); };
  const openEdit = (w: BranchWitness) => { setEditWitness(w); setModalMode('edit'); };
  const openReplace = (w: BranchWitness) => { setEditWitness(w); setModalMode('replace'); };
  const closeModal = () => { setModalMode(null); setEditWitness(null); };

  const handleSetActive = async (w: BranchWitness, active: boolean) => {
    try {
      await apiClient.rpc('fn_branch_witness_set_active', {
        p_witness_id: w.witness_id,
        p_active: active,
      });
      invalidate({ branchId });
    } catch (err) {
      surfaceError(err, t, addSnackbar);
    }
  };

  const handleSetDefault = async (slot: SignatorySlot, lessorId: number | null, witnessId: number | null) => {
    if (!branchId) return;
    try {
      await apiClient.rpc('fn_branch_signatory_set_default', {
        p_branch_id: branchId,
        p_slot: slot,
        p_lessor_id: lessorId,
        p_witness_id: witnessId,
      });
      invalidate({ branchId });
    } catch (err) {
      surfaceError(err, t, addSnackbar);
    }
  };

  return (
    <div className="page-content flex flex-col gap-6 max-w-5xl">
      {/* Header */}
      <div className="flex flex-col gap-2">
        <h1 className="heading-2">{t('branchSigners.title')}</h1>
        <p className="text-sm text-subtle">{t('branchSigners.subtitle')}</p>
      </div>

      {/* Branch picker */}
      <div className="flex items-center gap-3">
        <label className="form-label mb-0 shrink-0">{t('branchSigners.selectBranch')}</label>
        <div style={{ width: '18rem' }}>
          <Select
            options={branchOptions}
            value={branchId != null ? String(branchId) : null}
            onChange={(val) => setBranchId(val ? Number(val) : null)}
            placeholder={t('branchSigners.selectBranch')}
            searchable
            clearable={false}
          />
        </div>
      </div>

      {!branchId ? null : (
        <>
          {/* Defaults */}
          <DefaultsSection
            defaults={defaults}
            lessors={lessors}
            witnesses={witnesses.filter(w => w.is_active)}
            onSetDefault={handleSetDefault}
          />

          {/* Witnesses CRUD */}
          <section className="flex flex-col gap-3">
            <div className="flex items-end justify-between gap-3">
              <div>
                <h2 className="text-base font-medium">{t('branchSigners.witnessesTitle')}</h2>
                <p className="text-xs text-subtle">{t('branchSigners.witnessesHint')}</p>
              </div>
              <Button color="primary" startIcon={<Plus size={14} />} onClick={openCreate}>
                {t('branchSigners.addWitness')}
              </Button>
            </div>

            <div className="border border-line rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-surface">
                  <tr>
                    <th className="px-3 py-2 text-left w-20">{t('branchSigners.colSignature')}</th>
                    <th className="px-3 py-2 text-left">{t('branchSigners.colName')}</th>
                    <th className="px-3 py-2 text-left w-44">{t('branchSigners.colId')}</th>
                    <th className="px-3 py-2 text-left w-24">{t('branchSigners.colActive')}</th>
                    <th className="px-3 py-2 text-right w-16">{t('branchSigners.colActions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {witnessesLoading ? (
                    <tr><td colSpan={5} className="px-3 py-4 text-center text-subtle">
                      <Loader2 size={14} className="animate-spin inline mr-2" />
                      {t('common.loading')}
                    </td></tr>
                  ) : witnesses.length === 0 ? (
                    <tr><td colSpan={5} className="px-3 py-4 text-center text-subtle">{t('branchSigners.noWitnesses')}</td></tr>
                  ) : witnesses.map(w => (
                    <tr key={w.witness_id}>
                      <td className="px-3 py-2">
                        <SignatureThumb mediaId={w.signature_media_id} size={28} />
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-medium">{composeName(w.prefix, w.first_name, w.last_name)}</div>
                        {w.default_usage_count > 0 && (
                          <div className="text-xs text-subtle mt-0.5">
                            {t('branchSigners.defaultUsage', { count: w.default_usage_count })}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{formatCidMasked(w.id_number)}</td>
                      <td className="px-3 py-2">
                        <Switch
                          checked={w.is_active}
                          onChange={e => handleSetActive(w, e.target.checked)}
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <RowActions witness={w} onEdit={openEdit} onReplace={openReplace} onDelete={setDeleteWitness} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      <WitnessFormModal
        open={modalMode !== null}
        mode={modalMode ?? 'create'}
        witness={editWitness}
        branchId={branchId}
        onClose={closeModal}
        onDone={() => { closeModal(); invalidate({ branchId }); queryClient.invalidateQueries({ queryKey: ['branch-witnesses'] }); }}
      />

      <DeleteWitnessModal
        open={!!deleteWitness}
        witness={deleteWitness}
        otherWitnesses={witnesses.filter(w =>
          w.witness_id !== deleteWitness?.witness_id
          && w.is_active
          && w.default_usage_count === 0
        )}
        onClose={() => setDeleteWitness(null)}
        onDone={() => { setDeleteWitness(null); invalidate({ branchId }); }}
      />
    </div>
  );
}

// ── Defaults card ────────────────────────────────────────────────────────

function DefaultsSection({ defaults, lessors, witnesses, onSetDefault }: {
  defaults: ReturnType<typeof useBranchSignatoryDefaults>['data'];
  lessors: ReturnType<typeof useCompanyLessors>['data'];
  witnesses: BranchWitness[];
  onSetDefault: (slot: SignatorySlot, lessorId: number | null, witnessId: number | null) => void;
}) {
  const { t } = useTranslation();
  const lessorList = lessors ?? [];
  const defaultsList = defaults ?? [];

  const lessorDefault = defaultsList.find(d => d.slot === 'LESSOR');
  const w1Default = defaultsList.find(d => d.slot === 'WITNESS_1');
  const w2Default = defaultsList.find(d => d.slot === 'WITNESS_2');

  const lessorOptions = lessorList.filter(l => l.is_active).map(l => ({
    value: String(l.lessor_id),
    label: composeName(l.prefix, l.first_name, l.last_name),
  }));
  const witnessOptions = witnesses.map(w => ({
    value: String(w.witness_id),
    label: composeName(w.prefix, w.first_name, w.last_name),
  }));

  // For W2: exclude whatever's in W1 (and vice versa)
  const w2Options = witnessOptions.filter(o => Number(o.value) !== w1Default?.witness_id);
  const w1Options = witnessOptions.filter(o => Number(o.value) !== w2Default?.witness_id);

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-base font-medium">{t('branchSigners.defaultsTitle')}</h2>
        <p className="text-xs text-subtle">{t('branchSigners.defaultsHint')}</p>
      </div>
      <div className="border border-line rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <tbody className="divide-y divide-line">
            <tr>
              <td className="px-3 py-2 font-medium w-32">{t('branchSigners.slotLessor')}</td>
              <td className="px-3 py-2 w-16">
                {lessorDefault?.signature_media_id != null
                  ? <SignatureThumb mediaId={lessorDefault.signature_media_id} size={28} />
                  : null}
              </td>
              <td className="px-3 py-2">
                {lessorList.length === 0 ? (
                  <span className="text-xs text-subtle inline-flex items-center gap-1">
                    <Info size={14} />
                    {t('branchSigners.noCompanyLessors')}
                  </span>
                ) : (
                  <Select
                    options={lessorOptions}
                    value={lessorDefault?.lessor_id != null ? String(lessorDefault.lessor_id) : null}
                    onChange={(val) => onSetDefault('LESSOR', val ? Number(val) : null, null)}
                    placeholder={t('common.select')}
                    searchable
                    clearable={false}
                  />
                )}
              </td>
            </tr>
            <tr>
              <td className="px-3 py-2 font-medium">{t('branchSigners.slotWitness1')}</td>
              <td className="px-3 py-2">
                {w1Default?.signature_media_id != null
                  ? <SignatureThumb mediaId={w1Default.signature_media_id} size={28} />
                  : null}
              </td>
              <td className="px-3 py-2">
                <Select
                  options={w1Options}
                  value={w1Default?.witness_id != null ? String(w1Default.witness_id) : null}
                  onChange={(val) => onSetDefault('WITNESS_1', null, val ? Number(val) : null)}
                  placeholder={t('common.select')}
                  searchable
                  clearable={false}
                />
              </td>
            </tr>
            <tr>
              <td className="px-3 py-2 font-medium">{t('branchSigners.slotWitness2')}</td>
              <td className="px-3 py-2">
                {w2Default?.signature_media_id != null
                  ? <SignatureThumb mediaId={w2Default.signature_media_id} size={28} />
                  : null}
              </td>
              <td className="px-3 py-2">
                <Select
                  options={w2Options}
                  value={w2Default?.witness_id != null ? String(w2Default.witness_id) : null}
                  onChange={(val) => onSetDefault('WITNESS_2', null, val ? Number(val) : null)}
                  placeholder={t('common.select')}
                  searchable
                  clearable={false}
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ── Row actions ──────────────────────────────────────────────────────────

function RowActions({ witness, onEdit, onReplace, onDelete }: {
  witness: BranchWitness;
  onEdit: (w: BranchWitness) => void;
  onReplace: (w: BranchWitness) => void;
  onDelete: (w: BranchWitness) => void;
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
        <MenuItem icon={<Pencil size={14} />} label={t('common.edit')} onClick={() => { setOpen(false); onEdit(witness); }} />
        <MenuItem icon={<RefreshCw size={14} />} label={t('branchSigners.replaceSignature')} onClick={() => { setOpen(false); onReplace(witness); }} />
        <MenuSeparator />
        <MenuItem icon={<Trash2 size={14} className="text-danger" />} label={t('common.delete')} onClick={() => { setOpen(false); onDelete(witness); }} />
      </div>
    </PopOver>
  );
}

// ── Witness form modal (create / edit / replace) ─────────────────────────

function WitnessFormModal({ open, mode, witness, branchId, onClose, onDone }: {
  open: boolean;
  mode: ModalMode;
  witness: BranchWitness | null;
  branchId: number | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();

  const [sigFileUrl, setSigFileUrl] = useState<string | null>(null);
  const [sigMediaId, setSigMediaId] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [sigError, setSigError] = useState('');

  const { register, handleSubmit, reset, control, formState: { errors } } = useForm<WitnessForm>({
    defaultValues: { prefix: '', first_name: '', last_name: '', id_number: '', address: '' },
  });

  useEffect(() => {
    if (!open) return;
    if (witness) {
      reset({
        prefix: witness.prefix,
        first_name: witness.first_name,
        last_name: witness.last_name ?? '',
        id_number: witness.id_number,
        address: witness.address,
      });
    } else {
      reset({ prefix: '', first_name: '', last_name: '', id_number: '', address: '' });
    }
    setSigFileUrl(null);
    setSigMediaId(null);
    setErrorMessage('');
    setSigError('');
  }, [open, witness, reset]);

  const handleSignatureUpload = async (imgs: UploadedImage[]) => {
    if (!imgs[0] || !branchId || !user) return;
    setUploading(true);
    setSigError('');
    try {
      const slug = `witness-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const results = await uploadFromImage({
        type: 'branch_signatory_signature',
        image: imgs[0],
        params: { branch_id: branchId, signatory_slug: slug },
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
        p_entity_type: 'BRANCH',
        p_entity_id: branchId,
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

  const onSubmit = async (data: WitnessForm) => {
    setErrorMessage('');
    if (mode === 'create' || mode === 'replace') {
      if (!sigMediaId) { setSigError(t('branchSigners.signatureRequired')); return; }
    }
    if (!branchId) return;
    setSubmitting(true);
    try {
      if (mode === 'create') {
        await apiClient.rpc('fn_branch_witness_create', {
          p_branch_id: branchId,
          p_prefix: data.prefix.trim(),
          p_first_name: data.first_name.trim(),
          p_last_name: data.last_name.trim() || null,
          p_id_number: data.id_number.trim(),
          p_address: data.address.trim(),
          p_signature_media_id: sigMediaId,
        });
      } else if (mode === 'edit' && witness) {
        await apiClient.rpc('fn_branch_witness_update', {
          p_witness_id: witness.witness_id,
          p_prefix: data.prefix.trim() || null,
          p_first_name: data.first_name.trim() || null,
          p_last_name: data.last_name.trim() || null,
          p_id_number: data.id_number.trim() || null,
          p_address: data.address.trim() || null,
        });
      } else if (mode === 'replace' && witness) {
        await apiClient.rpc('fn_branch_witness_replace', {
          p_old_witness_id: witness.witness_id,
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

  const titleKey = mode === 'create' ? 'branchSigners.addWitnessTitle' : mode === 'edit' ? 'branchSigners.editWitnessTitle' : 'branchSigners.replaceWitnessTitle';
  const showSignature = mode === 'create' || mode === 'replace';
  // In replace mode, the user uploads a new signature anyway; we don't need
  // to surface the old one here (views don't expose its storage path).
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
              <span>{t('branchSigners.replaceHint')}</span>
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
                <label className="form-label">{t('branchSigners.prefix')}</label>
                <Input
                  {...register('prefix', { required: t('common.required') })}
                  placeholder={t('branchSigners.prefixPlaceholder')}
                  className="w-full"
                />
                <FormErrorMessage error={errors.prefix} />
              </div>
              <div className="flex flex-col flex-1 min-w-0">
                <label className="form-label">{t('branchSigners.firstName')}</label>
                <Input {...register('first_name', { required: t('common.required') })} className="w-full" />
                <FormErrorMessage error={errors.first_name} />
              </div>
              <div className="flex flex-col flex-1 min-w-0">
                <label className="form-label">{t('branchSigners.lastName')}</label>
                <Input {...register('last_name')} className="w-full" />
              </div>
            </div>

            <div className="flex flex-col" style={{ maxWidth: '20rem' }}>
              <label className="form-label">{t('branchSigners.idNumber')}</label>
              <Controller
                name="id_number"
                control={control}
                rules={{
                  required: t('common.required'),
                  validate: v => (/^\d{13}$/.test(v) && passesThaiCidChecksum(v)) || t('branchSigners.idInvalid'),
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
              <label className="form-label">{t('branchSigners.address')}</label>
              <TextArea
                {...register('address', { required: t('common.required') })}
                rows={2}
                className="w-full"
              />
              <FormErrorMessage error={errors.address} />
            </div>

            {showSignature && (
              <div className="flex flex-col">
                <label className="form-label">{t('branchSigners.signature')}</label>
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

// ── Delete witness modal ─────────────────────────────────────────────────

function DeleteWitnessModal({ open, witness, otherWitnesses, onClose, onDone }: {
  open: boolean;
  witness: BranchWitness | null;
  otherWitnesses: BranchWitness[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [transferTo, setTransferTo] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const hasDefault = !!witness && witness.default_usage_count > 0;

  useEffect(() => {
    if (open) { setTransferTo(null); setErrorMessage(''); }
  }, [open]);

  const handleConfirm = async () => {
    if (!witness) return;
    if (hasDefault && transferTo == null) {
      setErrorMessage(t('branchSigners.transferRequired'));
      return;
    }
    setSubmitting(true);
    try {
      await apiClient.rpc('fn_branch_witness_delete', {
        p_witness_id: witness.witness_id,
        p_transfer_default_to: transferTo,
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
        <h2 className="modal-title">{t('branchSigners.deleteWitnessTitle')}</h2>
      </div>
      <div className="modal-content">
        <p className="text-sm mb-4">{t('branchSigners.deleteWitnessConfirm', { name: witness ? composeName(witness.prefix, witness.first_name, witness.last_name) : '' })}</p>
        {hasDefault && (
          <div className="alert alert-warning mb-4">
            <ShieldOff size={14} />
            <span>{t('branchSigners.deleteWitnessHasDefault')}</span>
          </div>
        )}
        {hasDefault && (
          <div className="form-grid">
            <div className="flex flex-col">
              <label className="form-label">{t('branchSigners.transferTo')}</label>
              <Select
                options={otherWitnesses.map(w => ({ value: String(w.witness_id), label: composeName(w.prefix, w.first_name, w.last_name) }))}
                value={transferTo != null ? String(transferTo) : null}
                onChange={(val) => setTransferTo(val ? Number(val) : null)}
                placeholder={t('common.select')}
                clearable={false}
                searchable
              />
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
