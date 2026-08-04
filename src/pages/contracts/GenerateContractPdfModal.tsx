import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Modal, Button, useSnackbarContext } from 'tsp-form';
import { Loader2, Printer, XCircle, AlertTriangle, ExternalLink, Eye } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { BeMediaError, type BeMediaContractDoc } from '../../lib/beMedia';
import { useGenerateContractPdfServer } from './useGenerateContractPdfServer';
import { ContractPreviewModal } from './ContractPreviewModal';
import { CLAUSE_6_REPO_THRESHOLD_DAYS } from '../../lib/contractPdf/constants';
import {
  useCompanyLessors,
  useBranchSignatoryDefaults,
  useContractSignatories,
  composeName,
  type SignatorySlot,
} from './workspace/useContractSignatories';
import { SignatureThumb } from './workspace/SignatureThumb';
import { useState } from 'react';
import { translateApiError } from '../../lib/apiErrors';

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
  // When set, renders that specific sealed signing's document. Omit → the
  // Overview whole-packet flow (preview-all / print-all).
  signingId?: number | null;
  // When set, this is a pre-signing SAMPLE preview of one doc kind (from a
  // COLLECTING signing). Preview renders the doc; there's nothing sealed to
  // print, so the Print button is hidden.
  previewDoc?: BeMediaContractDoc | null;
}

// Only LESSOR is a branch signatory bound to the contract. Witnesses are now
// assigned at the signing ceremony (mig 345/346/400), not from the branch
// signatory book, so they are no longer part of print readiness here.
const SLOTS: { slot: SignatorySlot; labelKey: string }[] = [
  { slot: 'LESSOR', labelKey: 'workspace.signatoryLessor' },
];

export function GenerateContractPdfModal({ open, onClose, contract, signingId, previewDoc }: Props) {
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
  const { data: defaults = [] } = useBranchSignatoryDefaults(branchId);
  const { data: bound = [] } = useContractSignatories(contractId);

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
    const out: Partial<Record<SignatorySlot, { name: string; signature_media_id: number | null; source: 'bound' | 'default' | null }>> = {
      LESSOR: { name: '', signature_media_id: null, source: null },
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
  const missingPick = !resolved.LESSOR?.signature_media_id;
  const noBankAccount = bankAccount === null;
  const blocked = lessorPoolEmpty || missingPick || noBankAccount;

  const [previewOpen, setPreviewOpen] = useState(false);

  const batteryDisplay = assetRow?.battery_health != null ? `${assetRow.battery_health}%` : '—';

  const handlePrint = async () => {
    if (!contract || blocked) return;
    try {
      // Specific sealed signing → that one doc. Otherwise Overview print =
      // print-all (all sealed docs in one PDF). A doc-preview has nothing
      // sealed to print, so the Print button is hidden in that mode.
      await generate(contract, signingId != null ? { signingId } : { printAll: true });
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
                      {r?.name || <span className="text-subtler italic">{t('common.notSet', { defaultValue: 'Not set' })}</span>}
                    </div>
                    {r?.source === 'default' && (
                      <span className="text-[11px] text-subtle italic shrink-0">
                        {t('contract.printDefaultBadge', { defaultValue: 'branch default' })}
                      </span>
                    )}
                    {r?.signature_media_id && <SignatureThumb mediaId={r.signature_media_id} size={24} />}
                  </div>
                );
              })}
            </div>
            {lessorPoolEmpty && (
              <div className="alert alert-danger">
                <AlertTriangle size={14} />
                <div className="flex flex-col gap-1">
                  <span>{t('contract.printBlock_noLessorInBook', { defaultValue: 'Branch signatory book has no active lessor.' })}</span>
                  <Link to="/admin/company/signatories" className="text-sm underline inline-flex items-center gap-1 w-fit">
                    {t('contract.printBlock_openSignatoryBook', { defaultValue: 'Open Signatory Book' })}
                    <ExternalLink size={12} />
                  </Link>
                </div>
              </div>
            )}
            {missingPick && !lessorPoolEmpty && (
              <div className="alert alert-warning">
                <AlertTriangle size={14} />
                <span>{t('contract.printBlock_noSignatoryBound', { defaultValue: 'No signatory bound and no branch default — set defaults on the Signatory Book first.' })}</span>
              </div>
            )}
          </section>

          {/* Battery health — used assets only (NEW devices read null). Handover
              (box/cable/charger/pincode) moved to the BIND device addendum, so
              it is not shown on the contract print. */}
          {assetRow?.battery_health != null && (
            <section className="flex flex-col gap-2">
              <div className="text-xs font-semibold text-subtle uppercase tracking-wider">
                {t('contract.batteryHealth', { defaultValue: 'Battery health (%)' })}
              </div>
              <ReadOnlyRow label={t('contract.batteryHealth', { defaultValue: 'Battery health (%)' })} value={batteryDisplay} />
            </section>
          )}

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
        {/* No sealed doc to print in doc-preview mode — Preview only. */}
        {previewDoc == null && (
          <Button
            color="primary"
            onClick={handlePrint}
            disabled={generating || blocked}
            startIcon={generating ? <Loader2 size={14} className="animate-spin" /> : <Printer size={14} />}
          >
            {generating ? t('common.loading') : t('contract.printContractPdf', { defaultValue: 'Print contract PDF' })}
          </Button>
        )}
      </div>

      <ContractPreviewModal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        contract={contract}
        // doc-preview (COLLECTING) → live SAMPLE of that doc kind; specific
        // sealed signing → that signed doc; otherwise Overview preview-all.
        target={
          previewDoc != null ? { doc: previewDoc }
          : signingId != null ? { signingId }
          : { previewAll: true }
        }
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

function surfaceError(err: unknown, t: (k: string, opts?: Record<string, unknown>) => string, addSnackbar: (s: { message: React.ReactNode; type?: 'success' | 'error' }) => void) {
  let msg = '';
  if (err instanceof BeMediaError) {
    msg = t(err.code, { ns: 'apiErrors', defaultValue: err.message });
  } else if (err instanceof ApiError) {
    msg = translateApiError(err, t)
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
