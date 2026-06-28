import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Select, Button } from 'tsp-form';
import { CheckCircle, XCircle, Info, ExternalLink, Loader2, AlertTriangle } from 'lucide-react';
import { apiClient, ApiError } from '../../../lib/api';
import { translateApiError } from '../../../lib/apiErrors';
import { useWorkspace } from './WorkspaceContext';
import {
  useCompanyLessors,
  useBranchSignatoryDefaults,
  composeName,
} from './useContractSignatories';
import { SignatureThumb } from './SignatureThumb';

const USE_DEFAULT = '__default__';

/**
 * Per-contract LESSOR selection. Witnesses are no longer picked at draft — they
 * are chosen at signing time (mig 345/346). The lessor picker is OPTIONAL:
 * leave it empty and contract-open auto-binds the branch default lessor (mig
 * 350/351). Staff only need to touch it to switch lessor when a company has
 * more than one. Calls fn_contract_signatory_bind (4-arg).
 */
export function SignatoryEditor() {
  const { t } = useTranslation();
  const { contract, signatories, invalidateSignatories } = useWorkspace();
  const branchId = contract?.branch_id ?? null;
  const companyId = contract?.company_id ?? null;
  const contractId = contract?.id ?? null;

  const { data: lessorPool = [], isLoading: lessorsLoading } = useCompanyLessors(companyId);
  const { data: defaults = [] } = useBranchSignatoryDefaults(branchId);

  const lessorDefault = defaults.find(d => d.slot === 'LESSOR');
  const lessorDefaultId = lessorDefault?.lessor_id ?? null;

  const noLessorsAtAll = !lessorsLoading && lessorPool.length === 0;

  // Pending selection:
  //   null = nothing chosen yet
  //   USE_DEFAULT = bind with branch default
  //   "<id>" = explicit override to that lessor id
  const [pending, setPending] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const bound = signatories.find(x => x.slot === 'LESSOR');
    const boundId = bound?.lessor_id_ref ?? null;
    if (bound) {
      setPending(boundId != null && boundId === lessorDefaultId ? USE_DEFAULT : (boundId != null ? String(boundId) : null));
    } else {
      setPending(lessorDefaultId != null ? USE_DEFAULT : null);
    }
  }, [signatories, lessorDefaultId]);

  const options: { value: string; label: string }[] = [];
  if (lessorDefault && lessorDefaultId != null) {
    const defName = composeName(lessorDefault.person_prefix, lessorDefault.person_first_name, lessorDefault.person_last_name);
    options.push({
      value: USE_DEFAULT,
      label: defName ? `${t('workspace.signatoryUseDefault')} — ${defName}` : t('workspace.signatoryUseDefault'),
    });
  }
  for (const l of lessorPool) {
    if (!l.is_active) continue;
    options.push({ value: String(l.lessor_id), label: composeName(l.prefix, l.first_name, l.last_name) });
  }

  const previewMediaId: number | null = (() => {
    if (pending === null) return null;
    if (pending === USE_DEFAULT) return lessorDefault?.signature_media_id ?? null;
    return lessorPool.find(l => l.lessor_id === Number(pending))?.signature_media_id ?? null;
  })();

  const bound = signatories.find(x => x.slot === 'LESSOR');
  const boundId = bound?.lessor_id_ref ?? null;
  const targetId =
    pending === null ? null
    : pending === USE_DEFAULT ? lessorDefaultId
    : Number(pending);
  const boundMatches = bound != null && targetId != null && boundId === targetId;

  const handleBind = async () => {
    if (!contractId || pending === null) return;
    setError('');

    let lessorId: number | null;
    if (pending === USE_DEFAULT) {
      if (lessorDefaultId == null) return;
      lessorId = lessorDefaultId;
    } else {
      lessorId = Number(pending);
    }

    if (bound && boundId === lessorId) return;

    setBusy(true);
    try {
      await apiClient.rpc('fn_contract_signatory_bind', {
        p_contract_id: contractId,
        p_slot: 'LESSOR',
        p_lessor_id: lessorId,
        p_witness_id: null,
      });
      invalidateSignatories();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(translateApiError(err, t));
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setBusy(false);
    }
  };

  if (!branchId) {
    return (
      <div className="alert alert-warning">
        <AlertTriangle size={16} />
        <span>{t('workspace.signatoryNoBranch')}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="text-xs text-subtle">{t('workspace.signatoryLessorOptionalHint')}</div>

      {noLessorsAtAll && (
        <div className="alert alert-warning">
          <AlertTriangle size={16} />
          <div>
            <div className="alert-description">{t('workspace.signatoryNoCompanyLessors')}</div>
            <div className="mt-1.5">
              <Link to="/admin/company/lessors" className="text-primary-fg text-sm inline-flex items-center gap-1 hover:underline">
                <ExternalLink size={12} />
                {t('workspace.signatoryLessorsPage')}
              </Link>
            </div>
          </div>
        </div>
      )}

      {!noLessorsAtAll && lessorDefaultId == null && (
        <div className="alert alert-warning">
          <Info size={16} />
          <div>
            <div className="alert-description">{t('workspace.signatoryNoLessorDefault')}</div>
            <div className="mt-1.5">
              <Link to="/admin/company/signers" className="text-primary-fg text-sm inline-flex items-center gap-1 hover:underline">
                <ExternalLink size={12} />
                {t('workspace.signatoryBranchSignersPage')}
              </Link>
            </div>
          </div>
        </div>
      )}

      {lessorsLoading && (
        <div className="flex items-center gap-2 text-subtle text-sm">
          <Loader2 size={14} className="animate-spin" />
          <span>{t('common.loading')}</span>
        </div>
      )}

      <div className="flex items-center gap-2">
        <label className="form-label mb-0 w-20 shrink-0">{t('workspace.signatoryLessor')}</label>
        <div className="flex-1 min-w-0">
          <Select
            options={options}
            value={pending}
            onChange={(val) => setPending((val as string) || null)}
            placeholder={t('common.select')}
            searchable
            clearable={false}
            size="sm"
          />
        </div>
        {previewMediaId != null && <SignatureThumb mediaId={previewMediaId} size={28} />}
        {previewMediaId == null && bound?.signature_media_id != null && (
          <SignatureThumb mediaId={bound.signature_media_id} size={28} />
        )}
        {boundMatches && <CheckCircle size={14} className="text-success shrink-0" />}
      </div>

      {error && (
        <div className="alert alert-danger">
          <XCircle size={14} />
          <span>{error}</span>
        </div>
      )}

      <div className="flex justify-end">
        <Button
          color="primary"
          size="sm"
          onClick={handleBind}
          disabled={busy || noLessorsAtAll || boundMatches || pending === null}
          startIcon={busy ? <Loader2 size={14} className="animate-spin" /> : undefined}
        >
          {busy ? t('common.saving') : t('common.save')}
        </Button>
      </div>
    </div>
  );
}
