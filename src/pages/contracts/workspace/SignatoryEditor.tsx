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
  useBranchWitnesses,
  useBranchSignatoryDefaults,
  composeName,
  type SignatorySlot,
  type SourceKind,
} from './useContractSignatories';
import { SignatureThumb } from './SignatureThumb';

interface SlotDef {
  slot: SignatorySlot;
  kind: SourceKind;
  labelKey: string;
}

const SLOTS: SlotDef[] = [
  { slot: 'LESSOR', kind: 'LESSOR', labelKey: 'workspace.signatoryLessor' },
  { slot: 'WITNESS_1', kind: 'WITNESS', labelKey: 'workspace.signatoryWitness1' },
  { slot: 'WITNESS_2', kind: 'WITNESS', labelKey: 'workspace.signatoryWitness2' },
];

const USE_DEFAULT = '__default__';

/**
 * Per-contract signatory selection. Pulls lessor from company pool and
 * witnesses from branch pool. Calls fn_contract_signatory_bind v2 (4-arg).
 */
export function SignatoryEditor() {
  const { t } = useTranslation();
  const { contract, signatories, invalidateSignatories } = useWorkspace();
  const branchId = contract?.branch_id ?? null;
  const companyId = contract?.company_id ?? null;
  const contractId = contract?.id ?? null;

  const { data: lessorPool = [], isLoading: lessorsLoading } = useCompanyLessors(companyId);
  const { data: witnessPool = [], isLoading: witnessesLoading } = useBranchWitnesses(branchId);
  const { data: defaults = [] } = useBranchSignatoryDefaults(branchId);

  const lessorDefault = defaults.find(d => d.slot === 'LESSOR');
  const w1Default = defaults.find(d => d.slot === 'WITNESS_1');
  const w2Default = defaults.find(d => d.slot === 'WITNESS_2');

  const noLessorsAtAll = !lessorsLoading && lessorPool.length === 0;
  const noWitnessesAtAll = !witnessesLoading && witnessPool.length === 0;

  // Pending selection state per slot:
  //   null = nothing chosen yet
  //   USE_DEFAULT = bind with branch default
  //   "<id>" = explicit override to that lessor/witness id
  const [pending, setPending] = useState<Record<SignatorySlot, string | null>>({
    LESSOR: null,
    WITNESS_1: null,
    WITNESS_2: null,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const next: Record<SignatorySlot, string | null> = { LESSOR: null, WITNESS_1: null, WITNESS_2: null };
    for (const s of SLOTS) {
      const bound = signatories.find(x => x.slot === s.slot);
      const def = defaults.find(d => d.slot === s.slot);
      const boundId = bound ? (bound.lessor_id_ref ?? bound.witness_id_ref) : null;
      const defId = def ? (def.lessor_id ?? def.witness_id) : null;
      if (bound) {
        next[s.slot] = boundId != null && boundId === defId ? USE_DEFAULT : (boundId != null ? String(boundId) : null);
      } else {
        next[s.slot] = defId != null ? USE_DEFAULT : null;
      }
    }
    setPending(next);
  }, [signatories, defaults]);

  const optionsFor = (slotDef: SlotDef) => {
    const def = defaults.find(d => d.slot === slotDef.slot);
    const defId = def ? (def.lessor_id ?? def.witness_id) : null;

    // Witness exclusion: hide whatever's currently selected in the other witness slot
    const otherSel: string | null = (() => {
      if (slotDef.slot === 'WITNESS_1') return pending.WITNESS_2;
      if (slotDef.slot === 'WITNESS_2') return pending.WITNESS_1;
      return null;
    })();
    const otherId: number | null = (() => {
      if (!otherSel) return null;
      if (otherSel === USE_DEFAULT) {
        const otherSlot: SignatorySlot = slotDef.slot === 'WITNESS_1' ? 'WITNESS_2' : 'WITNESS_1';
        const otherDef = defaults.find(d => d.slot === otherSlot);
        return otherDef?.witness_id ?? null;
      }
      return Number(otherSel);
    })();

    const opts: { value: string; label: string }[] = [];
    if (def && defId != null) {
      const defName = composeName(def.person_prefix, def.person_first_name, def.person_last_name);
      opts.push({
        value: USE_DEFAULT,
        label: defName
          ? `${t('workspace.signatoryUseDefault')} — ${defName}`
          : t('workspace.signatoryUseDefault'),
      });
    }
    if (slotDef.kind === 'LESSOR') {
      for (const l of lessorPool) {
        if (!l.is_active) continue;
        opts.push({ value: String(l.lessor_id), label: composeName(l.prefix, l.first_name, l.last_name) });
      }
    } else {
      for (const w of witnessPool) {
        if (!w.is_active) continue;
        if (otherId != null && w.witness_id === otherId) continue;
        opts.push({ value: String(w.witness_id), label: composeName(w.prefix, w.first_name, w.last_name) });
      }
    }
    return opts;
  };

  type Resolved =
    | { useDefault: true }
    | { useDefault: false; lessor_id: number | null; witness_id: number | null };

  const resolveSelected = (slotDef: SlotDef): Resolved | null => {
    const val = pending[slotDef.slot];
    if (val === null) return null;
    if (val === USE_DEFAULT) return { useDefault: true };
    const id = Number(val);
    return slotDef.kind === 'LESSOR'
      ? { useDefault: false, lessor_id: id, witness_id: null }
      : { useDefault: false, lessor_id: null, witness_id: id };
  };

  const previewMediaIdFor = (slotDef: SlotDef): number | null => {
    const val = pending[slotDef.slot];
    if (val === null) return null;
    if (val === USE_DEFAULT) {
      const def = defaults.find(d => d.slot === slotDef.slot);
      return def?.signature_media_id ?? null;
    }
    const id = Number(val);
    if (slotDef.kind === 'LESSOR') {
      return lessorPool.find(l => l.lessor_id === id)?.signature_media_id ?? null;
    }
    return witnessPool.find(w => w.witness_id === id)?.signature_media_id ?? null;
  };

  const handleBindAll = async () => {
    if (!contractId) return;
    setError('');
    setBusy(true);
    try {
      for (const slotDef of SLOTS) {
        const sel = resolveSelected(slotDef);
        if (sel == null) continue;

        const bound = signatories.find(x => x.slot === slotDef.slot);
        const boundId = bound ? (bound.lessor_id_ref ?? bound.witness_id_ref) : null;

        let lessorId: number | null = null;
        let witnessId: number | null = null;
        if (sel.useDefault) {
          const def = defaults.find(d => d.slot === slotDef.slot);
          if (!def) continue;
          lessorId = def.lessor_id;
          witnessId = def.witness_id;
        } else {
          lessorId = sel.lessor_id;
          witnessId = sel.witness_id;
        }

        const targetId = lessorId ?? witnessId;
        if (bound && boundId === targetId) continue;

        try {
          await apiClient.rpc('fn_contract_signatory_bind', {
            p_contract_id: contractId,
            p_slot: slotDef.slot,
            p_lessor_id: lessorId,
            p_witness_id: witnessId,
          });
        } catch (err) {
          if (err instanceof ApiError) {
            setError(translateApiError(err, t));
          } else {
            setError(err instanceof Error ? err.message : String(err));
          }
          break;
        }
      }
      invalidateSignatories();
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

  const missingDefaults = SLOTS.filter(s => {
    const def = defaults.find(d => d.slot === s.slot);
    if (!def) return true;
    return def.lessor_id == null && def.witness_id == null;
  });

  const noPoolsReady = noLessorsAtAll || noWitnessesAtAll;

  return (
    <div className="flex flex-col gap-3">
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

      {noWitnessesAtAll && (
        <div className="alert alert-warning">
          <AlertTriangle size={16} />
          <div>
            <div className="alert-description">{t('workspace.signatoryNoBranchWitnesses')}</div>
            <div className="mt-1.5">
              <Link to="/admin/company/signers" className="text-primary-fg text-sm inline-flex items-center gap-1 hover:underline">
                <ExternalLink size={12} />
                {t('workspace.signatoryBranchSignersPage')}
              </Link>
            </div>
          </div>
        </div>
      )}

      {!noPoolsReady && missingDefaults.length > 0 && (
        <div className="alert alert-warning">
          <Info size={16} />
          <div>
            <div className="alert-description">{t('workspace.signatoryNoDefault')}</div>
            <div className="mt-1.5">
              <Link to="/admin/company/signers" className="text-primary-fg text-sm inline-flex items-center gap-1 hover:underline">
                <ExternalLink size={12} />
                {t('workspace.signatoryBranchSignersPage')}
              </Link>
            </div>
          </div>
        </div>
      )}

      {(lessorsLoading || witnessesLoading) && (
        <div className="flex items-center gap-2 text-subtle text-sm">
          <Loader2 size={14} className="animate-spin" />
          <span>{t('common.loading')}</span>
        </div>
      )}

      {SLOTS.map(slotDef => {
        const opts = optionsFor(slotDef);
        const previewMediaId = previewMediaIdFor(slotDef);
        const bound = signatories.find(s => s.slot === slotDef.slot);
        const sel = resolveSelected(slotDef);
        const boundId = bound ? (bound.lessor_id_ref ?? bound.witness_id_ref) : null;
        const def = slotDef.slot === 'LESSOR' ? lessorDefault : slotDef.slot === 'WITNESS_1' ? w1Default : w2Default;
        const defId = def ? (def.lessor_id ?? def.witness_id) : null;
        const targetId =
          sel == null ? null
          : sel.useDefault ? defId
          : (sel.lessor_id ?? sel.witness_id);
        const boundMatches = bound != null && targetId != null && boundId === targetId;

        return (
          <div key={slotDef.slot} className="flex items-center gap-2">
            <label className="form-label mb-0 w-20 shrink-0">{t(slotDef.labelKey)}</label>
            <div className="flex-1 min-w-0">
              <Select
                options={opts}
                value={pending[slotDef.slot]}
                onChange={(val) => setPending(prev => ({ ...prev, [slotDef.slot]: (val as string) || null }))}
                placeholder={t('common.select')}
                searchable
                clearable={false}
                size="sm"
              />
            </div>
            {previewMediaId != null && (
              <SignatureThumb mediaId={previewMediaId} size={28} />
            )}
            {previewMediaId == null && bound?.signature_media_id != null && (
              <SignatureThumb mediaId={bound.signature_media_id} size={28} />
            )}
            {boundMatches && (
              <CheckCircle size={14} className="text-success shrink-0" />
            )}
          </div>
        );
      })}

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
          onClick={handleBindAll}
          disabled={busy || noPoolsReady}
          startIcon={busy ? <Loader2 size={14} className="animate-spin" /> : undefined}
        >
          {busy ? t('common.saving') : t('common.save')}
        </Button>
      </div>
    </div>
  );
}
