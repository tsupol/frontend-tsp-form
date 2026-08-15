import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Modal, Button, Input, MaskedInput, TextArea, Badge, FormErrorMessage } from 'tsp-form';
import { XCircle, User, Package, FileText } from 'lucide-react';
import { apiClient, ApiError } from '../../../lib/api';
import { validateiPhoneSerial } from '../../../lib/validators';
import { isSearchable } from '../../../lib/searchKeyword';
import { ActionDoneView } from '../../contracts/ActionDoneView';
import { getStateColor } from '../../contracts/contractUtils';
import type { RepairType } from '../repairTypes';
import { translateApiError } from '../../../lib/apiErrors';
import { SearchInput } from '../../../components/SearchInput';

// Thai phone mask (mirrors the project convention in tsp-form-guide-here).
const thaiPhoneMask = (digits: string) => {
  if (digits.startsWith('02')) return '##-###-####';
  const prefix = digits.slice(0, 2);
  if (['03', '04', '05', '07'].includes(prefix)) return '###-###-###';
  return '###-###-####';
};

interface ContractHit {
  id: number;
  code_display: string | null;
  code: string;
  state: string;
  device_id: number | null;
  device_code_display: string | null;
  device_serial: string | null;
  customer_name: string | null;
  product_display_name: string | null;
  // is_my_branch = contract branch matches the caller's JWT branch. The repair
  // intake RPC requires the device's custody branch = caller branch, so a
  // cross-branch contract can't be turned into a repair here (would fail
  // INV.AUTH.BRANCH_CUSTODY_MISMATCH). branchless users (company/holding admin)
  // get false for everything — correct: they have no branch to intake at.
  is_my_branch: boolean | null;
  branch_name: string | null;
}

interface CreateResult {
  repair_order_id: number;
  code_display: string;
  repair_no: string;
}

function translateErr(err: unknown, t: ReturnType<typeof useTranslation>['t']): string {
  if (err instanceof ApiError) {
    const translated = translateApiError(err, t);
    return translated || err.message;
  }
  return t('common.error');
}

/**
 * New repair (DRAFT). Three entry paths — the repair_type is DERIVED by the BE
 * from what we send:
 *   WALK_IN            → ext_customer_name + phone (+ optional serial/imei/model)
 *   CUSTOMER_CONTRACT  → asset_id + contract_id  (device on an ACTIVE contract)
 *   SHOP_STOCK         → asset_id only           (our own stock device)
 * DEC-2: a contract that isn't ACTIVE is treated as a pure walk-in (no link /
 * pre-fill) — no guarantee the holder owns the contract.
 */
export function RepairCreateModal({
  open, onClose, onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (repairOrderId: number) => void;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<RepairType>('WALK_IN');
  const [view, setView] = useState<'form' | 'done'>('form');
  const [result, setResult] = useState<CreateResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // shared symptom + condition
  const [repairNote, setRepairNote] = useState('');
  const [conditionNote, setConditionNote] = useState('');
  const [intakeTerms, setIntakeTerms] = useState('');
  const [promisedDate, setPromisedDate] = useState('');

  // walk-in fields
  const [extName, setExtName] = useState('');
  const [extPhone, setExtPhone] = useState('');
  const [extModel, setExtModel] = useState('');
  const [extSerial, setExtSerial] = useState('');

  // contract / stock pick
  const [pickedContract, setPickedContract] = useState<ContractHit | null>(null);
  const [keyword, setKeyword] = useState('');
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    if (open) {
      setTab('WALK_IN'); setView('form'); setResult(null); setBusy(false); setErrorMessage('');
      setRepairNote(''); setConditionNote(''); setIntakeTerms(''); setPromisedDate('');
      setExtName(''); setExtPhone(''); setExtModel(''); setExtSerial('');
      setPickedContract(null); setKeyword(''); setDebounced('');
    }
  }, [open]);

  // Debounce + floor both live in SearchInput. Short keywords never reach
  // fn_contract_search — it ignores them and returns recent contracts instead,
  // which would look like picker results.

  // Contract search for the CUSTOMER_CONTRACT tab.
  const { data: contractHits, isFetching: searching } = useQuery({
    queryKey: ['repair-create-contract-search', debounced],
    queryFn: () => apiClient.rpc<{ contracts: ContractHit[] }>('fn_contract_search', {
      p_keyword: debounced, p_page: 1, p_per_page: 15,
    }).then(r => r.contracts),
    enabled: open && tab === 'CUSTOMER_CONTRACT' && isSearchable(debounced),
  });

  const symptomOk = repairNote.trim().length >= 3;

  // Serial is optional for a walk-in, but when typed it must be a valid Apple
  // serial (same rule as the register flow — mostly-Apple product). Blank = ok.
  const serialError = extSerial.trim().length > 0
    ? validateiPhoneSerial(extSerial).error ?? null
    : null;

  const canSubmit = useMemo(() => {
    if (busy || !symptomOk) return false;
    if (tab === 'WALK_IN') return extName.trim().length > 0 && extPhone.trim().length > 0 && !serialError;
    if (tab === 'CUSTOMER_CONTRACT') return pickedContract != null && pickedContract.device_id != null;
    return false; // SHOP_STOCK handled in its own tab body
  }, [busy, symptomOk, tab, extName, extPhone, pickedContract, serialError]);

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true); setErrorMessage('');
    const params: Record<string, unknown> = {
      p_repair_note: repairNote.trim(),
      p_condition_note: conditionNote.trim() || null,
      p_intake_terms: intakeTerms.trim() || null,
      p_promised_date: promisedDate || null,
      p_asset_id: null, p_contract_id: null,
      p_ext_customer_name: null, p_ext_customer_phone: null,
      p_ext_serial: null, p_ext_imei: null, p_ext_model: null,
    };
    if (tab === 'WALK_IN') {
      params.p_ext_customer_name = extName.trim();
      params.p_ext_customer_phone = extPhone.trim();
      params.p_ext_model = extModel.trim() || null;
      // Normalize like the register flow: strip spaces, uppercase.
      params.p_ext_serial = extSerial.replace(/\s/g, '').toUpperCase() || null;
    } else if (tab === 'CUSTOMER_CONTRACT' && pickedContract) {
      params.p_asset_id = pickedContract.device_id;
      params.p_contract_id = pickedContract.id;
    }
    try {
      const res = await apiClient.rpc<CreateResult>('fn_inv_repair_draft_create', params);
      setResult(res);
      setView('done');
    } catch (err) {
      setErrorMessage(translateErr(err, t));
    } finally {
      setBusy(false);
    }
  };

  const tabs: { key: RepairType; label: string; icon: React.ReactNode }[] = [
    { key: 'WALK_IN', label: t('repair.type_WALK_IN'), icon: <User size={15} /> },
    { key: 'CUSTOMER_CONTRACT', label: t('repair.type_CUSTOMER_CONTRACT'), icon: <FileText size={15} /> },
  ];

  return (
    <Modal open={open} onClose={busy ? () => {} : onClose} maxWidth="34rem" width="100%">
      {view === 'form' ? (
        <>
          <div className="modal-header">
            <h2 className="modal-title">{t('repair.createTitle')}</h2>
            <button type="button" className="modal-close-btn" onClick={onClose} aria-label={t('common.close')}>&times;</button>
          </div>
          <div className="modal-content">
            {/* Entry-type tabs — project segmented-control pattern (see SignatureCapture) */}
            <div role="tablist" className="inline-flex border border-line rounded-md p-0.5 self-start bg-surface-shallow mb-4">
              {tabs.map(tb => (
                <button
                  key={tb.key}
                  type="button"
                  role="tab"
                  aria-selected={tab === tb.key}
                  onClick={() => { setTab(tb.key); setErrorMessage(''); }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded transition-colors cursor-pointer ${
                    tab === tb.key ? 'bg-item-active-bg text-item-active-fg font-medium' : 'text-subtle hover:text-fg'
                  }`}
                >
                  {tb.icon}{tb.label}
                </button>
              ))}
            </div>

            {tab === 'CUSTOMER_CONTRACT' && (
              <div className="mb-4">
                <SearchInput
                  value={keyword}
                  onChange={setKeyword}
                  onDebouncedChange={setDebounced}
                  placeholder={t('repair.searchContractPlaceholder')}
                  className="w-full"
                />
                {pickedContract ? (
                  <div className="mt-2 flex items-center justify-between gap-2 px-3 py-2 rounded-md border border-line bg-surface">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{pickedContract.code_display ?? pickedContract.code}</span>
                        <Badge size="xs" color={getStateColor(pickedContract.state)}>{t(`contract.state_${pickedContract.state}`, pickedContract.state)}</Badge>
                      </div>
                      <div className="text-xs text-subtle truncate">
                        {[pickedContract.customer_name, pickedContract.product_display_name, pickedContract.device_serial].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => setPickedContract(null)}>{t('common.change')}</Button>
                  </div>
                ) : (
                  isSearchable(debounced) && (
                    <div className="mt-2 max-h-52 overflow-auto better-scroll rounded-md border border-line divide-y divide-line">
                      {searching && <div className="p-3 text-sm text-subtle">{t('common.loading')}</div>}
                      {!searching && (contractHits ?? []).length === 0 && <div className="p-3 text-sm text-subtler">{t('repair.noContractFound')}</div>}
                      {(contractHits ?? []).map(c => {
                        const active = c.state === 'ACTIVE';
                        const hasDevice = c.device_id != null;
                        const myBranch = c.is_my_branch === true;
                        const selectable = active && hasDevice && myBranch;
                        // Reason for a non-selectable row — checked in intake order
                        // (state → device → branch) so the message points at the
                        // first blocker, mirroring the RPC's own validation order.
                        const reason = !active
                          ? t('repair.contractNotActive')
                          : !hasDevice
                            ? t('repair.contractNoDevice')
                            : !myBranch
                              ? t('repair.contractOtherBranch', { branch: c.branch_name ?? '' })
                              : '';
                        return (
                          <button
                            key={c.id}
                            type="button"
                            disabled={!selectable}
                            onClick={() => selectable && setPickedContract(c)}
                            className={`w-full text-left px-3 py-2 flex flex-col gap-0.5 ${selectable ? 'cursor-pointer hover:bg-surface' : 'opacity-50 cursor-not-allowed'}`}
                          >
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-sm">{c.code_display ?? c.code}</span>
                              <Badge size="xs" color={getStateColor(c.state)}>{t(`contract.state_${c.state}`, c.state)}</Badge>
                            </div>
                            <div className="text-xs text-subtle truncate">
                              {[c.customer_name, c.product_display_name].filter(Boolean).join(' · ')}
                            </div>
                            {reason && <div className="text-xs text-danger">{reason}</div>}
                          </button>
                        );
                      })}
                    </div>
                  )
                )}
                {/* DEC-2 hint */}
                <p className="text-xs text-subtler mt-1.5">{t('repair.contractSearchHint')}</p>
              </div>
            )}

            {tab === 'WALK_IN' && (
              <div className="form-grid mb-4">
                <div className="flex gap-2">
                  <div className="flex flex-col flex-1">
                    <label className="form-label">{t('repair.customerName')}</label>
                    <Input value={extName} onChange={(e) => setExtName(e.target.value)} className="w-full" />
                  </div>
                  <div className="flex flex-col" style={{ width: '11rem' }}>
                    <label className="form-label">{t('repair.customerPhone')}</label>
                    <MaskedInput dynamicMask={thaiPhoneMask} value={extPhone} onChange={(raw) => setExtPhone(raw)} className="w-full" />
                  </div>
                </div>
                <div className="flex gap-2">
                  <div className="flex flex-col flex-1">
                    <label className="form-label">{t('repair.deviceModel')}</label>
                    <Input value={extModel} onChange={(e) => setExtModel(e.target.value)} placeholder={t('repair.deviceModelPlaceholder')} className="w-full" />
                  </div>
                  <div className="flex flex-col flex-1">
                    <label className="form-label">{t('repair.deviceSerial')}</label>
                    <Input
                      value={extSerial}
                      onChange={(e) => setExtSerial(e.target.value)}
                      className="w-full"
                      error={!!serialError}
                    />
                    <FormErrorMessage error={serialError ? { message: t('repair.serialInvalid') } : undefined} />
                  </div>
                </div>
              </div>
            )}

            {/* Shared: symptom + condition + terms + promised date */}
            <div className="form-grid">
              <div className="flex flex-col">
                <label className="form-label">{t('repair.symptom')} <span className="text-danger">*</span></label>
                <TextArea value={repairNote} onChange={(e) => setRepairNote(e.target.value)} rows={2} placeholder={t('repair.symptomPlaceholder')} />
                {repairNote.length > 0 && !symptomOk && <span className="text-xs text-danger mt-1">{t('repair.symptomTooShort')}</span>}
              </div>
              <div className="flex flex-col">
                <label className="form-label">{t('repair.conditionNote')}</label>
                <TextArea value={conditionNote} onChange={(e) => setConditionNote(e.target.value)} rows={2} placeholder={t('repair.conditionNotePlaceholder')} />
              </div>
              <div className="flex flex-col">
                <label className="form-label">{t('repair.intakeTerms')}</label>
                <TextArea value={intakeTerms} onChange={(e) => setIntakeTerms(e.target.value)} rows={2} placeholder={t('repair.intakeTermsPlaceholder')} />
              </div>
            </div>

            {errorMessage && (
              <div className="alert alert-danger mt-4 animate-pop-in"><XCircle size={16} /><span>{errorMessage}</span></div>
            )}
          </div>
          <div className="modal-footer">
            <Button variant="ghost" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
            <Button color="primary" onClick={submit} disabled={!canSubmit}>{busy ? t('common.loading') : t('repair.createDraft')}</Button>
          </div>
        </>
      ) : (
        <ActionDoneView
          headline={t('repair.createDone')}
          contractCode={result?.code_display ?? ''}
          detailRows={[{ label: t('repair.type'), value: t(`repair.type_${tab}`) }]}
          secondaryAction={result ? {
            label: t('repair.openDraft'),
            startIcon: <Package size={16} />,
            onClick: () => { onCreated(result.repair_order_id); onClose(); },
          } : undefined}
          onClose={() => { if (result) onCreated(result.repair_order_id); onClose(); }}
        />
      )}
    </Modal>
  );
}
