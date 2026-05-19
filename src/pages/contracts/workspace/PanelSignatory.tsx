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

interface Props { onClose: () => void }

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

export function PanelSignatory({ onClose: _onClose }: Props) {
  const { t } = useTranslation();
  const { contract, signatories, invalidateSignatories } = useWorkspace();
  const branchId = contract?.branch_id ?? null;
  const contractId = contract?.id ?? null;

  const { data: bookRaw = [], isLoading: bookLoading } = useBranchSignatories(branchId);
  const { data: defaultsRaw = [] } = useBranchSignatoryDefaults(branchId);

  // Group book by role
  const lessors = useMemo(() => bookRaw.filter(s => s.role === 'LESSOR'), [bookRaw]);
  const witnesses = useMemo(() => bookRaw.filter(s => s.role === 'WITNESS'), [bookRaw]);

  // Local pending selection per slot. value:
  //   - 'signatory_id' as string → override (uses that signatory)
  //   - USE_DEFAULT → use branch default (server: NULL)
  //   - null → unset (no pending change, but if no binding exists, will show empty)
  const [pending, setPending] = useState<Record<SignatorySlot, string | null>>({
    LESSOR: null,
    WITNESS_1: null,
    WITNESS_2: null,
  });
  const [busy, setBusy] = useState<SignatorySlot | null>(null);
  const [error, setError] = useState<string>('');

  // Pre-fill: if no binding yet but a default exists → show "use default" pre-selected
  // If a binding exists, show the bound signatory id.
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

  // Build options per slot
  const optionsFor = (slotDef: SlotDef) => {
    const pool = slotDef.role === 'LESSOR' ? lessors : witnesses;
    const def = defaultsRaw.find(d => d.slot === slotDef.slot);

    // For witness slots, exclude the other witness's currently-selected signatory id
    const otherWitnessSel: string | null = (() => {
      if (slotDef.slot === 'WITNESS_1') return pending.WITNESS_2;
      if (slotDef.slot === 'WITNESS_2') return pending.WITNESS_1;
      return null;
    })();

    // Resolve the actual id of the "other witness" (whether it points to a default or override)
    const otherId: number | null = (() => {
      if (!otherWitnessSel) return null;
      if (otherWitnessSel === USE_DEFAULT) {
        const otherSlot: SignatorySlot = slotDef.slot === 'WITNESS_1' ? 'WITNESS_2' : 'WITNESS_1';
        return defaultsRaw.find(d => d.slot === otherSlot)?.signatory_id ?? null;
      }
      return Number(otherWitnessSel);
    })();

    const opts: Array<{ value: string; label: string }> = [];
    if (def) {
      const dname = `${def.first_name} ${def.last_name}`;
      opts.push({ value: USE_DEFAULT, label: `${t('workspace.signatoryUseDefault')} (${dname})` });
    }
    for (const s of pool) {
      if (otherId != null && s.signatory_id === otherId) continue;
      opts.push({ value: String(s.signatory_id), label: `${s.first_name} ${s.last_name}` });
    }
    return opts;
  };

  const resolveSelected = (slot: SignatorySlot): { signatory_id: number | null; sendNull: boolean } => {
    const val = pending[slot];
    if (val == null) return { signatory_id: null, sendNull: false };
    if (val === USE_DEFAULT) return { signatory_id: null, sendNull: true };
    return { signatory_id: Number(val), sendNull: false };
  };

  const previewFor = (slot: SignatorySlot) => {
    const val = pending[slot];
    if (val == null) return null;
    if (val === USE_DEFAULT) {
      return defaultsRaw.find(d => d.slot === slot)?.signature_media_id ?? null;
    }
    return bookRaw.find(s => s.signatory_id === Number(val))?.signature_media_id ?? null;
  };

  const handleSave = async (slotDef: SlotDef) => {
    if (!contractId) return;
    const { signatory_id, sendNull } = resolveSelected(slotDef.slot);
    if (!sendNull && signatory_id == null) return;
    setBusy(slotDef.slot);
    setError('');
    try {
      await apiClient.rpc('fn_contract_signatory_bind', {
        p_contract_id: contractId,
        p_slot: slotDef.slot,
        p_signatory_id: sendNull ? null : signatory_id,
      });
      invalidateSignatories();
    } catch (err) {
      if (err instanceof ApiError) {
        const tr = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
          || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
        setError(tr || err.message);
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setBusy(null);
    }
  };

  const handleBindAll = async () => {
    if (!contractId) return;
    setError('');
    for (const slotDef of SLOTS) {
      const bound = signatories.find(x => x.slot === slotDef.slot);
      const sel = resolveSelected(slotDef.slot);
      // Skip if nothing selected
      if (!sel.sendNull && sel.signatory_id == null) continue;
      // Skip if already bound to same target
      if (bound) {
        if (sel.sendNull) {
          const def = defaultsRaw.find(d => d.slot === slotDef.slot);
          if (def && def.signatory_id === bound.signatory_id) continue;
        } else if (sel.signatory_id === bound.signatory_id) {
          continue;
        }
      }
      setBusy(slotDef.slot);
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
    setBusy(null);
    invalidateSignatories();
  };

  if (!branchId) {
    return (
      <div className="p-4">
        <div className="alert alert-warning">
          <AlertTriangle size={16} />
          <span>{t('workspace.signatoryNoBranch')}</span>
        </div>
      </div>
    );
  }

  // Detect "no defaults" state (likely needs management page)
  const missingDefaults = SLOTS.filter(s => !defaultsRaw.find(d => d.slot === s.slot));

  return (
    <div className="flex flex-col h-full max-w-2xl">
      <div className="flex-1 overflow-y-auto better-scroll p-4 flex flex-col gap-5">
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
            <div key={slotDef.slot} className="flex flex-col gap-2">
              <label className="form-label">{t(slotDef.labelKey)}</label>
              <div className="flex items-center gap-2">
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
                <Button
                  size="sm"
                  color={boundMatches ? undefined : 'primary'}
                  onClick={() => handleSave(slotDef)}
                  disabled={busy === slotDef.slot || (!sel.sendNull && sel.signatory_id == null) || !!boundMatches}
                  startIcon={busy === slotDef.slot ? <Loader2 size={14} className="animate-spin" /> : (boundMatches ? <CheckCircle size={14} className="text-success" /> : undefined)}
                >
                  {boundMatches ? t('workspace.signatoryBound') : t('common.save')}
                </Button>
              </div>
              {bound && (
                <div className="text-xs text-subtle">
                  {t('workspace.signatoryBound')}: {bound.first_name} {bound.last_name}
                </div>
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
      </div>

      <div className="shrink-0 border-t border-line bg-bg px-4 py-3 flex justify-end gap-2">
        <Button color="primary" onClick={handleBindAll} disabled={busy !== null}>
          {busy !== null ? t('common.saving') : t('common.save')}
        </Button>
      </div>
    </div>
  );
}
