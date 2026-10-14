import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Select, Button } from 'tsp-form';
import { XCircle, Info, ExternalLink, Loader2, AlertTriangle } from 'lucide-react';
import { apiClient, ApiError } from '../../../lib/api';
import { translateApiError } from '../../../lib/apiErrors';
import { useWorkspace } from './WorkspaceContext';
import {
  useCompanyLessors,
  useBranchSignatoryDefaults,
  composeName,
} from './useContractSignatories';

const USE_DEFAULT = '__default__';

/**
 * Who signs as LESSOR, as one quiet line — "ผู้ให้เช่า: <name> · branch default".
 * It sits in the sample-contract box: nothing here is required, so it must not
 * read like a task. Witnesses are chosen at signing time (mig 345/346).
 *
 * Choosing is OPTIONAL: left alone, contract-open binds the branch default
 * lessor (mig 350/351). "Change" appears only when the company has someone
 * else to pick, and opens the picker in place. Calls fn_contract_signatory_bind.
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
  const activeLessors = lessorPool.filter(l => l.is_active);
  const noLessorsAtAll = !lessorsLoading && activeLessors.length === 0;

  const bound = signatories.find(x => x.slot === 'LESSOR');
  const boundId = bound?.lessor_id_ref ?? null;

  // Who signs, as things stand: the bound lessor, else the branch default.
  const currentId = boundId ?? lessorDefaultId;
  const currentIsDefault = currentId != null && currentId === lessorDefaultId;
  const currentLessor = activeLessors.find(l => l.lessor_id === currentId);
  const currentName = bound
    ? composeName(bound.prefix, bound.first_name, bound.last_name)
    : currentLessor
      ? composeName(currentLessor.prefix, currentLessor.first_name, currentLessor.last_name)
      : lessorDefault
        ? composeName(lessorDefault.person_prefix, lessorDefault.person_first_name, lessorDefault.person_last_name)
        : '';
  // Someone else to pick? Then "Change" earns its place.
  const canChange = activeLessors.some(l => l.lessor_id !== currentId);

  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (editing) return;
    setPending(currentId == null ? null : currentIsDefault ? USE_DEFAULT : String(currentId));
  }, [editing, currentId, currentIsDefault]);

  const options: { value: string; label: string }[] = [];
  if (lessorDefault && lessorDefaultId != null) {
    const defName = composeName(lessorDefault.person_prefix, lessorDefault.person_first_name, lessorDefault.person_last_name);
    options.push({
      value: USE_DEFAULT,
      label: defName ? `${t('workspace.signatoryDefaultShort')} — ${defName}` : t('workspace.signatoryUseDefault'),
    });
  }
  for (const l of activeLessors) {
    if (l.lessor_id === lessorDefaultId) continue; // already offered as the default
    options.push({ value: String(l.lessor_id), label: composeName(l.prefix, l.first_name, l.last_name) });
  }

  const targetId =
    pending === null ? null
    : pending === USE_DEFAULT ? lessorDefaultId
    : Number(pending);
  const unchanged = bound != null && targetId != null && boundId === targetId;

  const handleBind = async () => {
    if (!contractId || targetId == null) return;
    setError('');
    if (unchanged) { setEditing(false); return; }
    setBusy(true);
    try {
      await apiClient.rpc('fn_contract_signatory_bind', {
        p_contract_id: contractId,
        p_slot: 'LESSOR',
        p_lessor_id: targetId,
        p_witness_id: null,
      });
      invalidateSignatories();
      setEditing(false);
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
    <div className="flex flex-col gap-2">
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

      {!noLessorsAtAll && !lessorsLoading && lessorDefaultId == null && !bound && (
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

      {editing ? (
        // In-place picker: pick, then save or back out.
        <div className="flex flex-col gap-2">
          <Select
            options={options}
            value={pending}
            onChange={(val) => setPending((val as string) || null)}
            placeholder={t('common.select')}
            searchable
            clearable={false}
            size="sm"
          />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setError(''); }} disabled={busy}>
              {t('common.cancel')}
            </Button>
            <Button
              size="sm"
              color="primary"
              onClick={handleBind}
              disabled={busy || targetId == null}
              startIcon={busy ? <Loader2 size={14} className="animate-spin" /> : undefined}
            >
              {busy ? t('common.saving') : t('common.save')}
            </Button>
          </div>
        </div>
      ) : currentName ? (
        <div className="text-sm flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-subtle">{t('workspace.cardSignatory')}</span>
          <span className="font-medium">{currentName}</span>
          <span className="text-xs text-subtle">
            {currentIsDefault ? t('workspace.signatoryIsBranchDefault') : t('workspace.signatoryChosenForContract')}
          </span>
          {canChange && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-xs text-primary-fg hover:underline bg-transparent border-none p-0 cursor-pointer"
            >
              {t('workspace.signatoryChange')}
            </button>
          )}
        </div>
      ) : lessorsLoading ? (
        <div className="flex items-center gap-2 text-subtle text-sm">
          <Loader2 size={14} className="animate-spin" />
          <span>{t('common.loading')}</span>
        </div>
      ) : null}

      {error && (
        <div className="alert alert-danger">
          <XCircle size={14} />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
