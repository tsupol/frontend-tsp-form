import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Input, Modal, Select } from 'tsp-form';
import { Info, Loader2, PenLine } from 'lucide-react';
import { apiClient } from '../../lib/api';
import { BranchPinInput } from '../../components/BranchPinInput';
import { ActionDoneView } from './ActionDoneView';
import { AssetSummaryLines, type Asset } from './ContractActions';
import { SwapProblemBox, swapProblemFromError, type SwapProblem } from './swapDeviceMessages';
import { useContractInvalidate } from './useContractInvalidate';

// "สลับเครื่อง" — replace the device bound to an active deal-partner contract with
// another one from the same shop's stock (mig 1697). Same RPC as binding,
// fn_contract_bind_device; the backend picks REBIND because a device is bound.
//   SWAP_DEVICE          the shop: PIN + reason, same day as the contract opened
//   SWAP_DEVICE_COMPANY  the office helping the shop: reason only, any day (mig 1701)
// Only the same model and the same new/used as the contract may go in (mig 1699);
// the list is filtered with the backend's own fields (mig 1702) so the shop never
// picks a device that would bounce.

export type SwapAction = 'SWAP_DEVICE' | 'SWAP_DEVICE_COMPANY';

export interface ContractForSwap {
  id: number;
  code_display?: string | null;
  branch_id: number;
  device_id: number | null;
  model_id?: number | null;
  is_used_asset?: boolean;
  product_display_name?: string | null;
  model_name?: string | null;
}

interface BindResult {
  mode?: string;
  device_id?: number;
  handover_signing?: { signing_id?: number | null } | null;
}

export function SwapDeviceModal({
  open, onClose, contract, action, oldDeviceCode,
}: {
  open: boolean;
  onClose: () => void;
  contract: ContractForSwap;
  action: SwapAction;
  oldDeviceCode: string | null;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const invalidate = useContractInvalidate(contract.id);
  const needsPin = action === 'SWAP_DEVICE';

  const [view, setView] = useState<'form' | 'done'>('form');
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [pin, setPin] = useState('');
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<SwapProblem | null>(null);
  const [result, setResult] = useState<{ newCode: string; signingId: number | null } | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  useEffect(() => {
    if (!open) return;
    setView('form'); setDeviceId(null); setReason(''); setNote(''); setPin('');
    setSaving(false); setProblem(null); setResult(null); setConfirmClose(false);
  }, [open]);

  const modelId = contract.model_id ?? null;
  const isUsed = contract.is_used_asset ?? null;
  // can_be_bound = this shop's own, in a bindable bucket, not held by another
  // contract (mig 1702) — plus the contract's model and new/used (mig 1699).
  const { data: assets, isFetching: assetsLoading } = useQuery({
    queryKey: ['swap-device-assets', contract.id, contract.branch_id, modelId, isUsed],
    queryFn: () => {
      const params = new URLSearchParams({
        select: 'asset_id,asset_code,asset_code_display,family_name,model_name,variant_name,physical_color,master_color_hex,master_color_name_en,serial_no,imei,condition_grade,has_box,box_branch_id,box_branch_name',
        can_be_bound: 'is.true',
        branch_id: `eq.${contract.branch_id}`,
        model_id: `eq.${modelId}`,
        is_used: `is.${isUsed}`,
        order: 'asset_code',
        limit: '500',
      });
      if (contract.device_id != null) params.set('asset_id', `neq.${contract.device_id}`);
      return apiClient.get<Asset[]>(`/v_assets?${params.toString()}`);
    },
    enabled: open && modelId != null && isUsed != null,
    staleTime: 30 * 1000,
  });

  const assetMap = useMemo(() => new Map((assets ?? []).map(a => [String(a.asset_id), a])), [assets]);
  const options = useMemo(() => (assets ?? []).map(a => ({
    value: String(a.asset_id),
    label: `${a.asset_code_display ?? a.asset_code} ${a.imei ?? ''} ${a.serial_no ?? ''}`.trim(),
  })), [assets]);

  const modelLabel = contract.product_display_name ?? contract.model_name ?? '—';
  const conditionLabel = isUsed ? t('swapDevice.used') : t('swapDevice.new');
  const canSubmit = !!deviceId && reason.trim() !== '' && (!needsPin || pin.length === 6) && !saving;
  const isDirty = !!deviceId || reason.trim() !== '' || note.trim() !== '' || pin !== '';

  const handleClose = () => {
    if (saving) return;
    if (view === 'form' && isDirty) { setConfirmClose(true); return; }
    onClose();
  };

  const submit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    setProblem(null);
    try {
      const res = await apiClient.rpc<BindResult>('fn_contract_bind_device', {
        p_contract_id: contract.id,
        p_device_id: Number(deviceId),
        p_reason: reason.trim(),
        p_note: note.trim() || null,
        ...(needsPin ? { p_pin: pin } : {}),
      });
      const picked = assetMap.get(deviceId!);
      setResult({
        newCode: picked ? (picked.asset_code_display ?? picked.asset_code) : String(deviceId),
        signingId: res?.handover_signing?.signing_id ?? null,
      });
      setView('done');
      invalidate();
      queryClient.invalidateQueries({ queryKey: ['contract-actions', contract.id] });
      queryClient.invalidateQueries({ queryKey: ['asset-summary'] });
      queryClient.invalidateQueries({ predicate: q => String(q.queryKey[0]).includes('settlement') });
    } catch (err) {
      setProblem(swapProblemFromError(err));
      // A 409 on the state may mean finance just moved the payment request:
      // refresh the buttons so what the screen shows matches (§6 edge cases).
      queryClient.invalidateQueries({ queryKey: ['contract-actions', contract.id] });
    } finally {
      setSaving(false);
    }
  };

  const signingPath = `/admin/contracts/search/${contract.id}?tab=signing`;

  return (
    <>
      <Modal open={open} onClose={handleClose} maxWidth="34rem" width="100%">
        <div className="flex flex-col overflow-hidden">
          <div className="modal-header">
            <h2 className="modal-title">{t(action === 'SWAP_DEVICE' ? 'swapDevice.title' : 'swapDevice.titleCompany')}</h2>
            <button type="button" className="modal-close-btn" onClick={handleClose} aria-label="Close">&times;</button>
          </div>

          {view === 'done' && result ? (
            <ActionDoneView
              headline={t('swapDevice.doneTitle')}
              contractCode={contract.code_display ?? ''}
              detailRows={[
                { label: t('swapDevice.oldDevice'), value: <span className="font-mono">{oldDeviceCode ?? '—'}</span> },
                { label: t('swapDevice.newDevice'), value: <span className="font-mono">{result.newCode}</span>, emphasis: true },
              ]}
              extras={
                <div className="flex flex-col gap-2">
                  {/* Either way the shop's close-out must go in again with the right
                      device's photos — when the office swaps, it tells the shop. */}
                  <div className="alert alert-warning">
                    <Info size={16} className="shrink-0" />
                    <span>{t('swapDevice.resubmitReminder')}</span>
                  </div>
                  <div className="text-xs text-subtle">{t('swapDevice.mdmFollows')}</div>
                </div>
              }
              secondaryAction={{
                label: t('swapDevice.goSign'),
                to: signingPath,
                startIcon: <PenLine size={16} />,
                isNextStep: true,
                onClick: () => { onClose(); navigate(signingPath); },
              }}
              onClose={onClose}
            />
          ) : (
            <>
              <div className="modal-content min-w-0">
                <div className="mb-4 px-3 py-2.5 rounded-md bg-surface border border-line">
                  <div className="font-medium text-sm">{contract.code_display}</div>
                  <div className="text-xs text-subtle">
                    {t('swapDevice.contractSays', { model: modelLabel, condition: conditionLabel })}
                  </div>
                  {oldDeviceCode && (
                    <div className="text-xs text-subtle">{t('swapDevice.currentDevice', { code: oldDeviceCode })}</div>
                  )}
                </div>

                <div className="form-grid">
                  <div className="flex flex-col">
                    <label className="form-label">{t('swapDevice.pickDevice')} *</label>
                    {assetsLoading && !assets ? (
                      <div className="text-sm text-subtler py-2">{t('common.loading')}</div>
                    ) : (assets?.length ?? 0) === 0 ? (
                      // The stock really has nothing that fits — say what is needed and the way out,
                      // or the shop keeps trying the button (§4 ⭐).
                      <div className="alert alert-info items-start">
                        <Info size={16} className="shrink-0 mt-0.5" />
                        <div className="flex flex-col gap-1">
                          <span className="font-medium">{t('swapDevice.noStock', { model: modelLabel, condition: conditionLabel })}</span>
                          <span className="text-sm">{t('swapDevice.noStockWayOut')}</span>
                        </div>
                      </div>
                    ) : (
                      <>
                        <Select
                          options={options}
                          value={deviceId}
                          onChange={(v) => setDeviceId((v as string) || null)}
                          placeholder={t('swapDevice.pickPlaceholder')}
                          searchable
                          showChevron
                          renderOption={(o) => {
                            const a = assetMap.get(o.value);
                            return a ? <div className="py-0.5"><AssetSummaryLines asset={a} dense contractBranchId={contract.branch_id} /></div> : <span>{o.label}</span>;
                          }}
                        />
                        <div className="text-xs text-subtler mt-1">{t('swapDevice.pickHint', { model: modelLabel, condition: conditionLabel })}</div>
                      </>
                    )}
                  </div>

                  <div className="flex flex-col">
                    <label className="form-label">{t('swapDevice.reason')} *</label>
                    <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('swapDevice.reasonPlaceholder')} className="w-full" />
                  </div>
                  <div className="flex flex-col">
                    <label className="form-label">{t('swapDevice.note')}</label>
                    <Input value={note} onChange={(e) => setNote(e.target.value)} className="w-full" />
                  </div>
                  {needsPin && (
                    <BranchPinInput value={pin} onChange={setPin} required label={t('swapDevice.pinLabel')} />
                  )}
                </div>
              </div>

              {problem && (
                <div className="px-4 py-2 border-t border-line">
                  <SwapProblemBox problem={problem} contractId={contract.id} onWithdrawn={() => setProblem(null)} />
                </div>
              )}

              <div className="modal-footer">
                <Button onClick={handleClose} disabled={saving}>{t('common.cancel')}</Button>
                <Button color="primary" onClick={submit} disabled={!canSubmit}
                  startIcon={saving ? <Loader2 size={14} className="animate-spin" /> : undefined}>
                  {t(action === 'SWAP_DEVICE' ? 'swapDevice.submit' : 'swapDevice.submitCompany')}
                </Button>
              </div>
            </>
          )}
        </div>
      </Modal>

      <Modal open={confirmClose} onClose={() => setConfirmClose(false)} maxWidth="24rem" width="100%">
        <div className="modal-header"><h2 className="modal-title">{t('common.unsavedChanges')}</h2></div>
        <div className="modal-content"><p>{t('common.unsavedChangesMessage')}</p></div>
        <div className="modal-footer">
          <Button variant="ghost" onClick={() => setConfirmClose(false)}>{t('common.cancel')}</Button>
          <Button color="danger" onClick={() => { setConfirmClose(false); onClose(); }}>{t('common.discard')}</Button>
        </div>
      </Modal>
    </>
  );
}
