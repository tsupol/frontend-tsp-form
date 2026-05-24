import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Modal, Button, Select, Input, MaskedInput, LabeledCheckbox, useSnackbarContext } from 'tsp-form';
import { Loader2, Printer, XCircle, AlertTriangle, ExternalLink, Eye } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { useGenerateContractPdf, type PdfOverrides } from './useGenerateContractPdf';
import { ContractPreviewModal } from './ContractPreviewModal';
import { CLAUSE_6_REPO_THRESHOLD_DAYS } from '../../lib/contractPdf/constants';
import {
  useBranchSignatories,
  useBranchSignatoryDefaults,
  useContractSignatories,
  type SignatorySlot,
  type SignatoryRole,
} from './workspace/useContractSignatories';
import { useContractHandover, useInvalidateHandover } from './workspace/useContractHandover';
import { SignatureThumb } from './workspace/SignatureThumb';

interface ContractMin {
  id: number;
  code: string;
  code_display: string | null;
  branch_id: number;
  branch_name: string;
  customer_id: number | null;
  device_id: number | null;
  device_identifier: string | null;
  model_name: string | null;
  variant_name: string | null;
  down_payment: number | null;
  insurance_deposit: number | null;
  installment_amount: number | null;
  snapshot_installment_amount: number | null;
  snapshot_term_months: number | null;
  total_installments: number | null;
  activated_at: string | null;
  created_at: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  contract: ContractMin | null;
}

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

export function GenerateContractPdfModal({ open, onClose, contract }: Props) {
  const { t } = useTranslation();
  const { addSnackbar } = useSnackbarContext();
  const { generating, generate } = useGenerateContractPdf();
  const branchId = contract?.branch_id ?? null;
  const contractId = contract?.id ?? null;

  const { data: book = [] } = useBranchSignatories(branchId);
  const { data: defaults = [] } = useBranchSignatoryDefaults(branchId);
  const { data: bound = [] } = useContractSignatories(contractId);
  const { data: handover } = useContractHandover(contractId);
  const invalidateHandover = useInvalidateHandover();

  // Battery is pulled from the asset row so staff can tweak the printed value
  // without editing the asset record.
  const deviceId = contract?.device_id ?? null;
  const { data: assetRow } = useQuery({
    queryKey: ['pdf-modal-asset', deviceId],
    queryFn: () => apiClient.get<Array<{ asset_id: number; battery_health: number | null }>>(
      `/v_assets?asset_id=eq.${deviceId}&select=asset_id,battery_health&limit=1`,
    ).then(rows => rows[0] ?? null),
    enabled: !!deviceId && open,
    staleTime: 30_000,
  });

  // Bank account — at least one active account required, picks the default.
  const { data: bankAccount } = useQuery({
    queryKey: ['pdf-modal-bank', branchId],
    queryFn: () => apiClient.get<Array<{ bank_name: string; account_number: string; account_name: string }>>(
      `/v_bank_accounts?branch_id=eq.${branchId}&is_active=is.true&order=is_default.desc&select=bank_name,account_number,account_name&limit=1`,
    ).then(rows => rows[0] ?? null),
    enabled: !!branchId && open,
    staleTime: 60_000,
  });

  // ── Signatory selections (per-slot signatory_id) ──────────────────────
  const [sigPick, setSigPick] = useState<Record<SignatorySlot, number | null>>({
    LESSOR: null,
    WITNESS_1: null,
    WITNESS_2: null,
  });
  useEffect(() => {
    if (!open) return;
    const next: Record<SignatorySlot, number | null> = { LESSOR: null, WITNESS_1: null, WITNESS_2: null };
    for (const s of SLOTS) {
      const b = bound.find(x => x.slot === s.slot);
      if (b) next[s.slot] = b.signatory_id;
      else next[s.slot] = defaults.find(d => d.slot === s.slot)?.signatory_id ?? null;
    }
    setSigPick(next);
  }, [open, bound, defaults]);

  // ── Handover state ────────────────────────────────────────────────────
  const [hasBox, setHasBox] = useState(true);
  const [hasChargerSet, setHasChargerSet] = useState(true);
  const [hasChargerCable, setHasChargerCable] = useState(true);
  const [passcode, setPasscode] = useState('');
  useEffect(() => {
    if (!open) return;
    if (handover) {
      setHasBox(handover.has_box);
      setHasChargerSet(handover.has_charger_set);
      setHasChargerCable(handover.has_charger_cable);
      setPasscode(handover.device_unlock_code ?? '');
    } else {
      setHasBox(true);
      setHasChargerSet(true);
      setHasChargerCable(true);
      setPasscode('');
    }
  }, [open, handover]);

  // Battery is editable so staff can tweak the printed value without touching
  // the asset record.
  const [battery, setBattery] = useState('');
  useEffect(() => {
    if (!open) return;
    setBattery(assetRow?.battery_health != null ? `${assetRow.battery_health}%` : '');
  }, [open, assetRow]);

  // Clause 6 repo threshold — overridable per print until BE adds the field.
  const [repoThreshold, setRepoThreshold] = useState(String(CLAUSE_6_REPO_THRESHOLD_DAYS));
  useEffect(() => {
    if (!open) return;
    setRepoThreshold(String(CLAUSE_6_REPO_THRESHOLD_DAYS));
  }, [open]);

  // ── Options per slot ──────────────────────────────────────────────────
  const optionsFor = (slotDef: SlotDef) => {
    const pool = book.filter(b => b.role === slotDef.role && b.is_active);
    const otherSlot: SignatorySlot | null =
      slotDef.slot === 'WITNESS_1' ? 'WITNESS_2' :
      slotDef.slot === 'WITNESS_2' ? 'WITNESS_1' : null;
    const otherId = otherSlot ? sigPick[otherSlot] : null;
    return pool
      .filter(s => otherId == null || s.signatory_id !== otherId)
      .map(s => ({ value: String(s.signatory_id), label: `${s.first_name} ${s.last_name}` }));
  };

  const findSig = (id: number | null) => id ? book.find(s => s.signatory_id === id) ?? null : null;

  const witnessDup = useMemo(() => {
    return sigPick.WITNESS_1 != null && sigPick.WITNESS_1 === sigPick.WITNESS_2;
  }, [sigPick]);

  // Prerequisite checks — surface as alerts in the modal instead of letting
  // the generator throw at print time.
  const lessorPoolEmpty = book.filter(b => b.role === 'LESSOR' && b.is_active).length === 0;
  const witnessPoolShort = book.filter(b => b.role === 'WITNESS' && b.is_active).length < 2;
  const signatoryPicksIncomplete = sigPick.LESSOR == null || sigPick.WITNESS_1 == null || sigPick.WITNESS_2 == null;
  const noBankAccount = bankAccount === null;
  const blocked = lessorPoolEmpty || witnessPoolShort || signatoryPicksIncomplete || witnessDup || noBankAccount;

  // Preview state — opened on top of this modal; this modal stays mounted.
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewOverrides, setPreviewOverrides] = useState<PdfOverrides | null>(null);
  const [persisting, setPersisting] = useState(false);

  // Build overrides from current modal state. Shared by Print and Preview.
  const buildOverrides = (): PdfOverrides => {
    const lessor = findSig(sigPick.LESSOR);
    const w1 = findSig(sigPick.WITNESS_1);
    const w2 = findSig(sigPick.WITNESS_2);
    const parsedRepo = parseInt(repoThreshold, 10);
    return {
      lessorMediaId: lessor?.signature_media_id ?? null,
      lessorName: lessor ? `${lessor.first_name} ${lessor.last_name}` : '',
      witness1MediaId: w1?.signature_media_id ?? null,
      witness1Name: w1 ? `${w1.first_name} ${w1.last_name}` : '',
      witness2MediaId: w2?.signature_media_id ?? null,
      witness2Name: w2 ? `${w2.first_name} ${w2.last_name}` : '',
      battery,
      hasBox,
      hasChargerSet,
      hasChargerCable,
      repoThresholdDays: Number.isFinite(parsedRepo) && parsedRepo > 0 ? parsedRepo : CLAUSE_6_REPO_THRESHOLD_DAYS,
    };
  };

  // Persist handover (upsert) so the contract record matches what we're about
  // to render/print. Used by both Print and Preview.
  const persistHandover = async (): Promise<boolean> => {
    if (!contractId) return false;
    setPersisting(true);
    try {
      await apiClient.rpc('fn_contract_set_handover', {
        p_contract_id: contractId,
        p_has_box: hasBox,
        p_has_charger_set: hasChargerSet,
        p_has_charger_cable: hasChargerCable,
        p_device_unlock_code: passcode.trim() || null,
      });
      invalidateHandover(contractId);
      return true;
    } catch (err) {
      surfaceError(err, t, addSnackbar);
      return false;
    } finally {
      setPersisting(false);
    }
  };

  const handleGenerate = async () => {
    if (!contract || !contractId) return;
    if (blocked) return;
    const ok = await persistHandover();
    if (!ok) return;
    try {
      await generate(contract, buildOverrides());
      onClose();
    } catch (err) {
      surfaceError(err, t, addSnackbar);
    }
  };

  const handlePreview = async () => {
    if (!contract || !contractId) return;
    if (blocked) return;
    const ok = await persistHandover();
    if (!ok) return;
    setPreviewOverrides(buildOverrides());
    setPreviewOpen(true);
  };

  return (
    <Modal open={open} onClose={onClose} maxWidth="36rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">{t('contract.printContractPdf', { defaultValue: 'Print contract PDF' })}</h2>
      </div>
      <div className="modal-content">
        <div className="flex flex-col gap-5">
          {/* Signatories */}
          <section className="flex flex-col gap-2">
            <div className="text-xs font-semibold text-subtle uppercase tracking-wider">{t('workspace.cardSignatory')}</div>
            {SLOTS.map(slotDef => {
              const sig = findSig(sigPick[slotDef.slot]);
              return (
                <div key={slotDef.slot} className="flex items-center gap-2">
                  <div className="w-24 text-sm shrink-0">{t(slotDef.labelKey)}</div>
                  <div className="flex-1 min-w-0">
                    <Select
                      options={optionsFor(slotDef)}
                      value={sigPick[slotDef.slot] != null ? String(sigPick[slotDef.slot]) : null}
                      onChange={(val) => setSigPick(prev => ({ ...prev, [slotDef.slot]: val ? Number(val) : null }))}
                      placeholder={t('common.select')}
                      searchable
                      clearable={false}
                      size="sm"
                    />
                  </div>
                  {sig && <SignatureThumb mediaId={sig.signature_media_id} size={24} />}
                </div>
              );
            })}
            {(lessorPoolEmpty || witnessPoolShort) && (
              <div className="alert alert-danger">
                <AlertTriangle size={14} />
                <div className="flex flex-col gap-1">
                  <span>
                    {lessorPoolEmpty && witnessPoolShort
                      ? t('contract.printBlock_signatoryBookEmpty', { defaultValue: 'Branch signatory book is missing a lessor and at least 2 active witnesses.' })
                      : lessorPoolEmpty
                        ? t('contract.printBlock_noLessorInBook', { defaultValue: 'Branch signatory book has no active lessor.' })
                        : t('contract.printBlock_notEnoughWitnesses', { defaultValue: 'Branch signatory book needs at least 2 active witnesses.' })}
                  </span>
                  <Link to="/admin/company/signatories" className="text-sm underline inline-flex items-center gap-1 w-fit">
                    {t('contract.printBlock_openSignatoryBook', { defaultValue: 'Open Signatory Book' })}
                    <ExternalLink size={12} />
                  </Link>
                </div>
              </div>
            )}
            {witnessDup && (
              <div className="alert alert-danger">
                <AlertTriangle size={14} />
                <span>{t('workspace.signatoryDuplicateWitness')}</span>
              </div>
            )}
          </section>

          {/* Handover */}
          <section className="flex flex-col gap-2">
            <div className="text-xs font-semibold text-subtle uppercase tracking-wider">{t('workspace.cardHandover')}</div>
            <div className="flex flex-col gap-2">
              <LabeledCheckbox label={t('workspace.handoverHasBox')} checked={hasBox} onChange={e => setHasBox(e.target.checked)} />
              <LabeledCheckbox label={t('workspace.handoverHasChargerSet')} checked={hasChargerSet} onChange={e => setHasChargerSet(e.target.checked)} />
              <LabeledCheckbox label={t('workspace.handoverHasChargerCable')} checked={hasChargerCable} onChange={e => setHasChargerCable(e.target.checked)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col">
                <label className="form-label">{t('workspace.handoverUnlockCode')}</label>
                <Input value={passcode} onChange={e => setPasscode(e.target.value)} className="w-full" size="sm" placeholder="123456" />
                <span className="text-xs text-subtle mt-1">{t('workspace.handoverUnlockCodeHint')}</span>
              </div>
              <div className="flex flex-col">
                <label className="form-label">{t('contract.batteryHealth', { defaultValue: 'Battery health' })}</label>
                <Input
                  value={battery}
                  onChange={e => setBattery(e.target.value)}
                  className="w-full"
                  size="sm"
                  placeholder="100%"
                />
              </div>
            </div>
          </section>

          {/* Clause 6 — repo threshold */}
          <section className="flex flex-col gap-2">
            <div className="text-xs font-semibold text-subtle uppercase tracking-wider">
              {t('contract.printRepoThresholdTitle', { defaultValue: 'Repossession threshold (clause 6)' })}
            </div>
            <div className="flex flex-col gap-1">
              <label className="form-label">{t('contract.printRepoThresholdLabel', { defaultValue: 'Days unreachable before repossession' })}</label>
              <div className="w-32">
                <MaskedInput
                  mask="number"
                  decimalScale={0}
                  value={repoThreshold}
                  onChange={(raw) => setRepoThreshold(raw)}
                  size="sm"
                  className="w-full"
                />
              </div>
              <span className="text-xs text-subtle">
                {t('contract.printRepoThresholdHint', { defaultValue: 'Defaults to 15 days. Override only when needed.' })}
              </span>
            </div>
          </section>

          {/* Bank account — required for the payment footer. */}
          <section className="flex flex-col gap-2">
            <div className="text-xs font-semibold text-subtle uppercase tracking-wider">
              {t('contract.printBankAccountTitle', { defaultValue: 'Payment bank account' })}
            </div>
            {bankAccount ? (
              <div className="border border-line rounded-md px-3 py-2 text-sm">
                <div className="font-semibold">{bankAccount.bank_name}</div>
                <div className="text-subtle">{bankAccount.account_number} — {bankAccount.account_name}</div>
              </div>
            ) : (
              <div className="alert alert-danger">
                <AlertTriangle size={14} />
                <div className="flex flex-col gap-1">
                  <span>{t('contract.printBlock_noBankAccount', { defaultValue: 'Branch has no active bank account set.' })}</span>
                  <Link to="/admin/company/bank-accounts" className="text-sm underline inline-flex items-center gap-1 w-fit">
                    {t('contract.printBlock_openBankAccounts', { defaultValue: 'Open Bank Accounts' })}
                    <ExternalLink size={12} />
                  </Link>
                </div>
              </div>
            )}
          </section>

        </div>
      </div>
      <div className="modal-footer">
        <Button onClick={onClose} disabled={generating || persisting}>{t('common.cancel')}</Button>
        <Button
          onClick={handleGenerate}
          disabled={generating || persisting || blocked}
          startIcon={generating ? <Loader2 size={14} className="animate-spin" /> : <Printer size={14} />}
        >
          {generating ? t('common.loading') : t('contract.printContractPdf', { defaultValue: 'Print contract PDF' })}
        </Button>
        <Button
          color="primary"
          onClick={handlePreview}
          disabled={generating || persisting || blocked}
          startIcon={persisting ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}
        >
          {persisting ? t('common.loading') : t('contract.previewContract', { defaultValue: 'Preview' })}
        </Button>
      </div>

      <ContractPreviewModal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        contract={contract}
        overrides={previewOverrides ?? {}}
      />
    </Modal>
  );
}

function surfaceError(err: unknown, t: (k: string, opts?: Record<string, unknown>) => string, addSnackbar: (s: { message: React.ReactNode; type?: 'success' | 'error' }) => void) {
  let msg = '';
  if (err instanceof ApiError) {
    msg = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
      || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '')
      || err.message;
  } else {
    msg = err instanceof Error ? err.message : String(err);
  }
  addSnackbar({
    message: (
      <div className="alert alert-danger">
        <XCircle size={16} />
        <span>{msg}</span>
      </div>
    ),
    type: 'error',
  });
}

