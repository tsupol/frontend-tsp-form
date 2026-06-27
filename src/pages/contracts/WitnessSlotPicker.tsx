// In-app witness assignment for a COLLECTING signing's witness slot.
//
// Per the mig 346 signatory model, the snapshot creates BLANK witness slots
// (LESSOR auto-signs; witnesses are chosen at signing time). Staff can pick the
// witness here at the desk (or it can be done on the capture bridge — same RPC).
//
// One consistent control: a dropdown of branch witnesses, pre-selected to the
// draft-designated witness (if any), plus an Assign button. No separate
// confirm/change buttons.
//
// One RPC for every case/channel: api.fn_signing_assign_witness(signing_id,
// slot, witness_id) — it picks, applies the pre-registered signature, blocks
// duplicates, and seals the signing if that was the last party.
// See UI_FEEDBACK/2026-06-28_IMPLEMENT_witness_signing_direct_vs_bridge.

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Button, Select } from 'tsp-form';
import { Check } from 'lucide-react';
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

  const { data: witnesses = [] } = useBranchWitnesses(branchId ?? null);

  const options = useMemo(
    () => witnesses
      .filter(w => w.is_active)
      .map(w => ({
        value: String(w.witness_id),
        label: `${w.prefix ?? ''} ${w.first_name} ${w.last_name ?? ''}`.trim(),
      })),
    [witnesses],
  );

  // Pre-select the draft-designated witness once the slot loads.
  useEffect(() => {
    if (!pickedId && slotRow?.designated_witness_id != null) {
      setPickedId(String(slotRow.designated_witness_id));
    }
  }, [slotRow, pickedId]);

  if (!slotRow || slotRow.has_signed) return null;

  const assign = async () => {
    if (!pickedId) return;
    setBusy(true);
    setError('');
    try {
      await apiClient.rpc('fn_signing_assign_witness', {
        p_signing_id: signingId,
        p_slot: slot,
        p_witness_id: Number(pickedId),
      });
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
          onClick={assign}
        >
          {t('signing.witnessAssign', { defaultValue: 'Assign' })}
        </Button>
      </div>
      {error && <span className="text-[11px] text-danger">{error}</span>}
    </div>
  );
}
