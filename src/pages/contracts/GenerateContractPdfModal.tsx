import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Modal, Button, useSnackbarContext } from 'tsp-form';
import { Loader2, Printer, XCircle, AlertTriangle, ExternalLink, Eye } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { BeMediaError } from '../../lib/beMedia';
import { useGenerateContractPdfServer } from './useGenerateContractPdfServer';
import { ContractPreviewModal } from './ContractPreviewModal';
import { CLAUSE_6_REPO_THRESHOLD_DAYS } from '../../lib/contractPdf/constants';
import {
  useCompanyLessors,
  useBranchWitnesses,
  useBranchSignatoryDefaults,
  useContractSignatories,
  composeName,
  type SignatorySlot,
} from './workspace/useContractSignatories';
import { useContractHandover } from './workspace/useContractHandover';
import { SignatureThumb } from './workspace/SignatureThumb';
import { useState } from 'react';

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
  brand_name?: string | null;
  family_name?: string | null;
  base_model_name?: string | null;
  manufacturer_color?: string | null;
  variant_sku_code?: string | null;
  category_name?: string | null;
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

const SLOTS: { slot: SignatorySlot; labelKey: string }[] = [
  { slot: 'LESSOR', labelKey: 'workspace.signatoryLessor' },
  { slot: 'WITNESS_1', labelKey: 'workspace.signatoryWitness1' },
  { slot: 'WITNESS_2', labelKey: 'workspace.signatoryWitness2' },
];

export function GenerateContractPdfModal({ open, onClose, contract }: Props) {
  const { t } = useTranslation();
  const { addSnackbar } = useSnackbarContext();
  const { generating, generate } = useGenerateContractPdfServer();
  const branchId = contract?.branch_id ?? null;
  const contractId = contract?.id ?? null;
  const deviceId = contract?.device_id ?? null;

  const { data: branchRow } = useQuery({
    queryKey: ['pdf-modal-branch', branchId],
    queryFn: () => apiClient.get<Array<{ id: number; company_id: number }>>(
      `/v_branches?id=eq.${branchId}&select=id,company_id&limit=1`,
    ).then(rows => rows[0] ?? null),
    enabled: !!branchId && open,
    staleTime: 60_000,
  });
  const companyId = branchRow?.company_id ?? null;

  const { data: lessorPool = [] } = useCompanyLessors(companyId);
  const { data: witnessPool = [] } = useBranchWitnesses(branchId);
  const { data: defaults = [] } = useBranchSignatoryDefaults(branchId);
  const { data: bound = [] } = useContractSignatories(contractId);
  const { data: handover } = useContractHandover(contractId);

  const { data: assetRow } = useQuery({
    queryKey: ['pdf-modal-asset', deviceId],
    queryFn: () => apiClient.get<Array<{ asset_id: number; battery_health: number | null }>>(
      `/v_assets?asset_id=eq.${deviceId}&select=asset_id,battery_health&limit=1`,
    ).then(rows => rows[0] ?? null),
    enabled: !!deviceId && open,
    staleTime: 30_000,
  });

  const { data: bankAccount } = useQuery({
    queryKey: ['pdf-modal-bank', branchId],
    queryFn: () => apiClient.get<Array<{ bank_name: string; account_number: string; account_name: string }>>(
      `/v_bank_accounts?branch_id=eq.${branchId}&is_active=is.true&order=is_default.desc&select=bank_name,account_number,account_name&limit=1`,
    ).then(rows => rows[0] ?? null),
    enabled: !!branchId && open,
    staleTime: 60_000,
  });

  // Resolved signatory per slot: contract binding wins; falls back to branch
  // default. Display only — no editing in this modal.
  const resolved = useMemo(() => {
    const out: Record<SignatorySlot, { name: string; signature_media_id: number | null; source: 'bound' | 'default' | null }> = {
      LESSOR:    { name: '', signature_media_id: null, source: null },
      WITNESS_1: { name: '', signature_media_id: null, source: null },
      WITNESS_2: { name: '', signature_media_id: null, source: null },
    };
    for (const s of SLOTS) {
      const b = bound.find(x => x.slot === s.slot);
      if (b) {
        // v_contract_signatories has prefix-less name parts; compose without prefix
        // to match the existing display.
        out[s.slot] = {
          name: composeName(null, b.first_name, b.last_name),
          signature_media_id: b.signature_media_id,
          source: 'bound',
        };
        continue;
      }
      const d = defaults.find(x => x.slot === s.slot);
      const defName = d ? composeName(d.person_prefix, d.person_first_name, d.person_last_name) : '';
      if (d && defName) {
        out[s.slot] = {
          name: defName,
          signature_media_id: d.signature_media_id,
          source: 'default',
        };
      }
    }
    return out;
  }, [bound, defaults]);

  const lessorPoolEmpty = lessorPool.filter(l => l.is_active).length === 0;
  const witnessPoolShort = witnessPool.filter(w => w.is_active).length < 2;
  const missingPick = !resolved.LESSOR.signature_media_id || !resolved.WITNESS_1.signature_media_id || !resolved.WITNESS_2.signature_media_id;
  const witnessDup = !!resolved.WITNESS_1.signature_media_id
    && resolved.WITNESS_1.signature_media_id === resolved.WITNESS_2.signature_media_id;
  const noBankAccount = bankAccount === null;
  const blocked = lessorPoolEmpty || witnessPoolShort || missingPick || witnessDup || noBankAccount;

  const [previewOpen, setPreviewOpen] = useState(false);

  const batteryDisplay = assetRow?.battery_health != null ? `${assetRow.battery_health}%` : '—';

  const handlePrint = async () => {
    if (!contract || blocked) return;
    try {
      await generate(contract);
      onClose();
    } catch (err) {
      surfaceError(err, t, addSnackbar);
    }
  };

  const handlePreview = () => {
    if (!contract || blocked) return;
    setPreviewOpen(true);
  };

  return (
    <Modal open={open} onClose={onClose} maxWidth="32rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">{t('contract.printContractPdf', { defaultValue: 'Print contract PDF' })}</h2>
      </div>
      <div className="modal-content">
        <div className="flex flex-col gap-5">
          {/* Signatories — read-only */}
          <section className="flex flex-col gap-2">
            <div className="text-xs font-semibold text-subtle uppercase tracking-wider">{t('workspace.cardSignatory')}</div>
            <div className="flex flex-col gap-2">
              {SLOTS.map(s => {
                const r = resolved[s.slot];
                return (
                  <div key={s.slot} className="flex items-center gap-3 px-3 py-2 rounded-md border border-line bg-surface">
                    <div className="w-24 text-xs text-subtle shrink-0">{t(s.labelKey)}</div>
                    <div className="flex-1 min-w-0 text-sm truncate">
                      {r.name || <span className="text-subtler italic">{t('common.notSet', { defaultValue: 'Not set' })}</span>}
                    </div>
                    {r.source === 'default' && (
                      <span className="text-[11px] text-subtle italic shrink-0">
                        {t('contract.printDefaultBadge', { defaultValue: 'branch default' })}
                      </span>
                    )}
                    {r.signature_media_id && <SignatureThumb mediaId={r.signature_media_id} size={24} />}
                  </div>
                );
              })}
            </div>
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
            {missingPick && !lessorPoolEmpty && !witnessPoolShort && (
              <div className="alert alert-warning">
                <AlertTriangle size={14} />
                <span>{t('contract.printBlock_noSignatoryBound', { defaultValue: 'No signatory bound and no branch default — set defaults on the Signatory Book first.' })}</span>
              </div>
            )}
            {witnessDup && (
              <div className="alert alert-danger">
                <AlertTriangle size={14} />
                <span>{t('workspace.signatoryDuplicateWitness')}</span>
              </div>
            )}
          </section>

          {/* Handover — read-only */}
          <section className="flex flex-col gap-2">
            <div className="text-xs font-semibold text-subtle uppercase tracking-wider">{t('workspace.cardHandover')}</div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <ReadOnlyRow label={t('workspace.handoverHasBox')} value={hasOrNot(handover?.has_box, t)} />
              <ReadOnlyRow label={t('workspace.handoverHasChargerSet')} value={hasOrNot(handover?.has_charger_set, t)} />
              <ReadOnlyRow label={t('workspace.handoverHasChargerCable')} value={hasOrNot(handover?.has_charger_cable, t)} />
              <ReadOnlyRow label={t('contract.batteryHealth', { defaultValue: 'Battery health (%)' })} value={batteryDisplay} />
              <ReadOnlyRow label={t('workspace.handoverUnlockCode')} value={handover?.device_unlock_code || '—'} colSpan={2} />
            </div>
          </section>

          {/* Clause 6 — fixed default, no override */}
          <section className="flex flex-col gap-2">
            <div className="text-xs font-semibold text-subtle uppercase tracking-wider">
              {t('contract.printRepoThresholdTitle', { defaultValue: 'Repossession threshold (clause 6)' })}
            </div>
            <ReadOnlyRow
              label={t('contract.printRepoThresholdLabel', { defaultValue: 'Days unreachable before repossession' })}
              value={`${CLAUSE_6_REPO_THRESHOLD_DAYS} ${t('common.days', { defaultValue: 'days' })}`}
            />
          </section>

          {/* Bank account */}
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
        <Button onClick={onClose} disabled={generating}>{t('common.cancel')}</Button>
        <Button
          onClick={handlePreview}
          disabled={generating || blocked}
          startIcon={<Eye size={14} />}
        >
          {t('contract.previewContract', { defaultValue: 'Preview' })}
        </Button>
        <Button
          color="primary"
          onClick={handlePrint}
          disabled={generating || blocked}
          startIcon={generating ? <Loader2 size={14} className="animate-spin" /> : <Printer size={14} />}
        >
          {generating ? t('common.loading') : t('contract.printContractPdf', { defaultValue: 'Print contract PDF' })}
        </Button>
      </div>

      <ContractPreviewModal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        contract={contract}
      />
    </Modal>
  );
}

function ReadOnlyRow({ label, value, colSpan }: { label: string; value: React.ReactNode; colSpan?: 1 | 2 }) {
  return (
    <div className={`px-3 py-2 rounded-md border border-line bg-surface ${colSpan === 2 ? 'col-span-2' : ''}`}>
      <div className="text-xs text-subtle">{label}</div>
      <div className="text-sm">{value}</div>
    </div>
  );
}

// "Has / does not have" — matches how the contract PDF prints handover items
// (มี / ไม่มี) so the modal labels read the same as the printed document.
function hasOrNot(v: boolean | undefined, t: (k: string, opts?: Record<string, unknown>) => string): string {
  if (v == null) return '—';
  return v ? t('common.has', { defaultValue: 'Has' }) : t('common.doesNotHave', { defaultValue: 'Does not have' });
}

function surfaceError(err: unknown, t: (k: string, opts?: Record<string, unknown>) => string, addSnackbar: (s: { message: React.ReactNode; type?: 'success' | 'error' }) => void) {
  let msg = '';
  if (err instanceof BeMediaError) {
    msg = t(err.code, { ns: 'apiErrors', defaultValue: err.message });
  } else if (err instanceof ApiError) {
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
