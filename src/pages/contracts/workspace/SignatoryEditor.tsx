import { useMemo, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Select, Button } from 'tsp-form';
import { CheckCircle, XCircle, Info, ExternalLink, Loader2, AlertTriangle } from 'lucide-react';
import { apiClient, ApiError } from '../../../lib/api';
import { useWorkspace } from './WorkspaceContext';
import {
  useBranchSignatories,
  useBranchSignatoryDefaults,
  type SignatorySlot,
  type SignatoryRole,
} from './useContractSignatories';
import { SignatureThumb } from './SignatureThumb';

interface SlotDef {
  slot: SignatorySlot;
  role: SignatoryRole;
  labelKey: string;
}

const SLOTS: SlotDef[] = [
  { slot: 'LESSOR', role: 'LESSOR', labelKey: 'workspace.signatoryLessor' },
  { slot: 'WITNESS_1', role: 'WITNESS', labelKey: 'workspace.signatoryWitness1' },
  { slot: 'WITNESS_2', role: 'WITNESS', labelKey: 'workspace.signatoryWitness2' },
];

const USE_DEFAULT = '__default__';

/**
 * The signatory selection UI without panel chrome — slots, validation, save
 * button. Originally lived in PanelSignatory; lifted out so PanelDocuments
 * can embed the same editor inline.
 */
export function SignatoryEditor() {
  const { t } = useTranslation();
  const { contract, signatories, invalidateSignatories } = useWorkspace();
  const branchId = contract?.branch_id ?? null;
  const contractId = contract?.id ?? null;

  const { data: bookRaw = [], isLoading: bookLoading } = useBranchSignatories(branchId);
  const { data: defaultsRaw = [] } = useBranchSignatoryDefaults(branchId);

  const lessors = useMemo(() => bookRaw.filter(s => s.role === 'LESSOR'), [bookRaw]);
  const witnesses = useMemo(() => bookRaw.filter(s => s.role === 'WITNESS'), [bookRaw]);

  const [pending, setPending] = useState<Record<SignatorySlot, string | null>>({
    LESSOR: null,
    WITNESS_1: null,
    WITNESS_2: null,
  });
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    const next: Record<SignatorySlot, string | null> = { LESSOR: null, WITNESS_1: null, WITNESS_2: null };
    for (const s of SLOTS) {
      const bound = signatories.find(x => x.slot === s.slot);
      if (bound) {
        const def = defaultsRaw.find(d => d.slot === s.slot);
        next[s.slot] = def && def.signatory_id === bound.signatory_id ? USE_DEFAULT : String(bound.signatory_id);
      } else {
        const def = defaultsRaw.find(d => d.slot === s.slot);
        next[s.slot] = def ? USE_DEFAULT : null;
      }
    }
    setPending(next);
  }, [signatories, defaultsRaw]);

  const optionsFor = (slotDef: SlotDef) => {
    const pool = slotDef.role === 'LESSOR' ? lessors : witnesses;
    const def = defaultsRaw.find(d => d.slot === slotDef.slot);

    const otherWitnessSel: string | null = (() => {
      if (slotDef.slot === 'WITNESS_1') return pending.WITNESS_2;
      if (slotDef.slot === 'WITNESS_2') return pending.WITNESS_1;
      return null;
    })();

    const otherId: number | null = (() => {
      if (!otherWitnessSel) return null;
      if (otherWitnessSel === USE_DEFAULT) {
        const otherSlot: SignatorySlot = slotDef.slot === 'WITNESS_1' ? 'WITNESS_2' : 'WITNESS_1';
        return defaultsRaw.find(d => d.slot === otherSlot)?.signatory_id ?? null;
      }
      return Number(otherWitnessSel);
    })();

    const opts: { value: string; label: string }[] = [];
    if (def) {
      const defSig = bookRaw.find(s => s.signatory_id === def.signatory_id);
      opts.push({
        value: USE_DEFAULT,
        label: defSig
          ? `${t('workspace.signatoryUseDefault')} — ${defSig.first_name} ${defSig.last_name}`
          : t('workspace.signatoryUseDefault'),
      });
    }
    for (const s of pool) {
      if (otherId != null && s.signatory_id === otherId) continue;
      opts.push({ value: String(s.signatory_id), label: `${s.first_name} ${s.last_name}` });
    }
    return opts;
  };

  const resolveSelected = (slot: SignatorySlot): { sendNull: boolean; signatory_id: number | null } => {
    const val = pending[slot];
    if (val === null) return { sendNull: false, signatory_id: null };
    if (val === USE_DEFAULT) return { sendNull: true, signatory_id: null };
    return { sendNull: false, signatory_id: Number(val) };
  };

  const previewFor = (slot: SignatorySlot): number | null => {
    const val = pending[slot];
    if (val === null) return null;
    if (val === USE_DEFAULT) {
      const def = defaultsRaw.find(d => d.slot === slot);
      if (!def) return null;
      return bookRaw.find(s => s.signatory_id === def.signatory_id)?.signature_media_id ?? null;
    }
    return bookRaw.find(s => s.signatory_id === Number(val))?.signature_media_id ?? null;
  };

  const handleBindAll = async () => {
    if (!contractId) return;
    setError('');
    setBusy(true);
    try {
      for (const slotDef of SLOTS) {
        const bound = signatories.find(x => x.slot === slotDef.slot);
        const sel = resolveSelected(slotDef.slot);
        if (!sel.sendNull && sel.signatory_id == null) continue;
        if (bound) {
          if (sel.sendNull) {
            const def = defaultsRaw.find(d => d.slot === slotDef.slot);
            if (def && def.signatory_id === bound.signatory_id) continue;
          } else if (sel.signatory_id === bound.signatory_id) {
            continue;
          }
        }
        try {
          await apiClient.rpc('fn_contract_signatory_bind', {
            p_contract_id: contractId,
            p_slot: slotDef.slot,
            p_signatory_id: sel.sendNull ? null : sel.signatory_id,
          });
        } catch (err) {
          if (err instanceof ApiError) {
            const tr = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
              || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
            setError(tr || err.message);
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

  const missingDefaults = SLOTS.filter(s => !defaultsRaw.find(d => d.slot === s.slot));

  return (
    <div className="flex flex-col gap-3">
      {missingDefaults.length > 0 && (
        <div className="alert alert-warning">
          <Info size={16} />
          <div>
            <div className="alert-description">{t('workspace.signatoryNoDefault')}</div>
            <div className="mt-1.5">
              <Link to="/admin/company/signatories" className="text-primary text-sm inline-flex items-center gap-1">
                <ExternalLink size={12} />
                {t('signatory.title')}
              </Link>
            </div>
          </div>
        </div>
      )}

      {bookLoading && (
        <div className="flex items-center gap-2 text-subtle text-sm">
          <Loader2 size={14} className="animate-spin" />
          <span>{t('common.loading')}</span>
        </div>
      )}

      {SLOTS.map(slotDef => {
        const opts = optionsFor(slotDef);
        const previewMediaId = previewFor(slotDef.slot);
        const bound = signatories.find(s => s.slot === slotDef.slot);
        const sel = resolveSelected(slotDef.slot);
        const boundMatches = bound && (
          (sel.sendNull && defaultsRaw.find(d => d.slot === slotDef.slot)?.signatory_id === bound.signatory_id)
          || (!sel.sendNull && sel.signatory_id === bound.signatory_id)
        );
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
          disabled={busy}
          startIcon={busy ? <Loader2 size={14} className="animate-spin" /> : undefined}
        >
          {busy ? t('common.saving') : t('common.save')}
        </Button>
      </div>
    </div>
  );
}
