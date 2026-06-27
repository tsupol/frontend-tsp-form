// In-app witness assignment for a COLLECTING signing's witness slot.
//
// Per the mig 346 signatory model, the snapshot creates BLANK witness slots
// (LESSOR auto-signs; witnesses are chosen at signing time). Staff can pick the
// witness here at the desk (or it can be done on the capture bridge — same RPC).
//
//   CASE 1 (designated_witness_id set, from the draft binding): pre-select that
//           witness, Confirm assigns it. Staff may also change to another.
//   CASE 2 (designated null): a dropdown of branch witnesses → pick → assign.
//
// One RPC for every case/channel: api.fn_signing_assign_witness(signing_id,
// slot, witness_id) — it picks, applies the pre-registered signature, blocks
// duplicates, and seals the signing if that was the last party.
// See UI_FEEDBACK/2026-06-28_IMPLEMENT_witness_signing_direct_vs_bridge.

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Button, Select } from 'tsp-form';
import { Check, Pencil, X } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { useBranchWitnesses } from './workspace/useContractSignatories';

interface WitnessSlotRow {
  signing_id: number;
  slot: 'WITNESS_1' | 'WITNESS_2';
  frozen_full_name: string;
  has_signed: boolean;
  designated_witness_id: number | null;
  designated_name: string | null;
}

export function WitnessSlotPicker({
  contractId,
  signingId,
  slot,
  onAssigned,
}: {
  contractId: number;
  signingId: number;
  slot: 'WITNESS_1' | 'WITNESS_2';
  onAssigned: () => void;
}) {
  const { t } = useTranslation();
  const [picking, setPicking] = useState(false);   // CASE 1 → user chose to change
  const [pickedId, setPickedId] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const { data: slotRow } = useQuery({
    queryKey: ['signing-witness-slot', signingId, slot],
    queryFn: () => apiClient.get<WitnessSlotRow[]>(
      `/v_signing_witness_slots?signing_id=eq.${signingId}&slot=eq.${slot}` +
        `&select=signing_id,slot,frozen_full_name,has_signed,designated_witness_id,designated_name`,
    ).then(rows => rows[0] ?? null),
    staleTime: 5 * 1000,
  });

  // Branch comes from the contract — one small lookup, cached per contract.
  const { data: branchId } = useQuery({
    queryKey: ['contract-branch', contractId],
    queryFn: () => apiClient.get<Array<{ branch_id: number }>>(
      `/v_contracts?id=eq.${contractId}&select=branch_id&limit=1`,
    ).then(rows => rows[0]?.branch_id ?? null),
    staleTime: 60 * 1000,
  });

  const designated = slotRow?.designated_witness_id ?? null;
  const isCase2 = designated == null;
  // Load the witness list for CASE 2, or when changing a CASE-1 pick.
  const needList = isCase2 || picking;
  const { data: witnesses = [] } = useBranchWitnesses(needList ? (branchId ?? null) : null);

  const options = useMemo(
    () => witnesses
      .filter(w => w.is_active)
      .map(w => ({
        value: String(w.witness_id),
        label: `${w.prefix ?? ''} ${w.first_name} ${w.last_name ?? ''}`.trim(),
      })),
    [witnesses],
  );

  if (!slotRow || slotRow.has_signed) return null;

  const assign = async (witnessId: number) => {
    setBusy(true);
    setError('');
    try {
      await apiClient.rpc('fn_signing_assign_witness', {
        p_signing_id: signingId,
        p_slot: slot,
        p_witness_id: witnessId,
      });
      setPicking(false);
      onAssigned();
    } catch (err) {
      const msg = err instanceof ApiError
        ? (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
          || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '')
          || err.message
        : String(err);
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  // CASE 1 (designated, not yet changing) → pre-selected name + Confirm + change.
  if (designated != null && !picking) {
    return (
      <div className="flex flex-col items-end gap-1">
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            color="primary"
            startIcon={<Check size={13} />}
            disabled={busy}
            onClick={() => assign(designated)}
          >
            {t('signing.witnessConfirm', { defaultValue: 'Confirm {{name}}', name: slotRow.designated_name ?? '' })}
          </Button>
          <Button
            size="sm"
            variant="outline"
            startIcon={<Pencil size={13} />}
            disabled={busy}
            onClick={() => setPicking(true)}
          >
            {t('signing.witnessChange', { defaultValue: 'Change' })}
          </Button>
        </div>
        {error && <span className="text-[11px] text-danger">{error}</span>}
      </div>
    );
  }

  // CASE 2, or CASE 1 in "change" mode → dropdown + assign.
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-1.5">
        <div style={{ width: '12rem' }}>
          <Select
            options={options}
            value={pickedId || null}
            onChange={(v) => setPickedId((v as string) ?? '')}
            placeholder={t('signing.witnessPick', { defaultValue: 'Select witness' })}
            size="sm"
            searchable
          />
        </div>
        <Button
          size="sm"
          color="primary"
          startIcon={<Check size={13} />}
          disabled={busy || !pickedId}
          onClick={() => pickedId && assign(Number(pickedId))}
        >
          {t('signing.witnessAssign', { defaultValue: 'Assign' })}
        </Button>
        {picking && (
          <Button
            size="sm"
            variant="ghost"
            startIcon={<X size={13} />}
            disabled={busy}
            onClick={() => { setPicking(false); setPickedId(''); }}
          />
        )}
      </div>
      {error && <span className="text-[11px] text-danger">{error}</span>}
    </div>
  );
}
