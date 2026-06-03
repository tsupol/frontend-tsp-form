import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { UploadedImage } from 'tsp-form';
import { XCircle, CreditCard, AlertTriangle } from 'lucide-react';
import { apiClient, ApiError } from '../../../lib/api';
import { uploadFromImage, invalidateMediaUrl } from '../../../lib/upload';
import { useWorkspace } from './WorkspaceContext';
import { SingleUpload } from './SingleUpload';
import { ContractPreviewSignPair } from './ContractPreviewSignPair';
import { SignatoryEditor } from './SignatoryEditor';
import { useContractGuarantors } from './useContractGuarantors';
import type { ContractMin } from '../../../lib/contractPdf/buildRenderData';

interface CustomerDocument {
  id: number;
  customer_id: number;
  doc_type: string;
  file_url: string;
  is_active: boolean;
  uploaded_at: string;
}

interface ContractDocument {
  id: number;
  contract_id: number;
  customer_id: number | null;
  customer_name: string | null;
  doc_type: string;
  file_url: string;
  uploaded_at: string;
}

interface Props { onClose: () => void }

export function PanelDocuments({ onClose: _onClose }: Props) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: workspace, contract, getCardStatus, invalidateDocs, invalidateCustomer } = useWorkspace();
  const contractId = workspace.contractId;
  const customerId = workspace.customerId;

  // Signatory used to be a prereq card — it now lives inline at the top of
  // this panel via <SignatoryEditor />, so it's no longer in the prereq list.
  const prereqCards: Array<{ id: string; labelKey: string }> = [
    { id: 'customer', labelKey: 'workspace.cardCustomer' },
    { id: 'productPlan', labelKey: 'workspace.cardProduct' },
    { id: 'contactRef', labelKey: 'workspace.cardContactRef' },
    { id: 'guarantor', labelKey: 'workspace.cardGuarantor' },
  ];
  const missingCardPrereqs = prereqCards.filter(c => getCardStatus(c.id) !== 'complete');

  // uploading is a "<scope>:<customerId>" string so multiple rows can each
  // track their own busy state without colliding.
  const [uploading, setUploading] = useState('');
  const [error, setError] = useState('');
  const [cacheBust, setCacheBust] = useState(0);

  const previewContract: ContractMin | null = contract ? {
    id: contract.id,
    code: contract.code,
    code_display: contract.code_display,
    holding_id: contract.holding_id,
    company_id: contract.company_id,
    branch_id: contract.branch_id,
    branch_name: contract.branch_name,
    customer_id: contract.customer_id,
    device_id: contract.device_id,
    device_identifier: contract.device_identifier,
    model_name: contract.model_name,
    variant_name: contract.variant_name,
    brand_name: contract.brand_name,
    family_name: contract.family_name,
    base_model_name: contract.base_model_name,
    manufacturer_color: contract.manufacturer_color,
    variant_sku_code: contract.variant_sku_code,
    category_name: contract.category_name,
    down_payment: contract.down_payment,
    insurance_deposit: contract.insurance_deposit,
    installment_amount: contract.installment_amount,
    value_month: contract.value_month,
    snapshot_installment_amount: contract.snapshot_installment_amount,
    snapshot_term_months: contract.snapshot_term_months,
    total_installments: contract.total_installments,
    activated_at: contract.activated_at,
    created_at: contract.created_at,
  } : null;

  const { data: guarantors = [] } = useContractGuarantors(contractId);

  // All ID cards for everyone on the contract (lessee + guarantors). One
  // batched query keyed on the full customer-id set so we don't N+1.
  const docCustomerIds = [
    ...(customerId ? [customerId] : []),
    ...guarantors.map(g => g.customer_id),
  ];
  const { data: customerDocs = [] } = useQuery({
    queryKey: ['customer-documents-multi', docCustomerIds],
    queryFn: () => apiClient.get<CustomerDocument[]>(
      `/v_customer_documents?customer_id=in.(${docCustomerIds.join(',')})&doc_type=eq.ID_CARD_FRONT&is_active=eq.true&order=uploaded_at.desc`
    ),
    enabled: docCustomerIds.length > 0,
  });
  const idCardByCustomer = new Map<number, CustomerDocument>();
  for (const d of customerDocs) {
    if (!idCardByCustomer.has(d.customer_id)) idCardByCustomer.set(d.customer_id, d);
  }

  // All signature documents for this contract (lessee + guarantors).
  const { data: contractDocs = [] } = useQuery({
    queryKey: ['contract-documents', contractId],
    queryFn: () => apiClient.get<ContractDocument[]>(
      `/v_contract_documents?contract_id=eq.${contractId}&doc_type=eq.SIGNATURE_PAD`
    ),
    enabled: !!contractId,
  });
  const signatureByCustomer = new Map<number, ContractDocument>();
  for (const d of contractDocs) {
    if (d.customer_id != null) signatureByCustomer.set(d.customer_id, d);
  }

  const lesseeIdCard = customerId ? idCardByCustomer.get(customerId) ?? null : null;

  // Print-readiness — same cards as before, plus an ID-card per person on
  // the contract (lessee + each guarantor). Signatures stay optional.
  const missingIdCardPeople: Array<{ id: string; labelKey?: string; labelText?: string }> = [];
  if (!lesseeIdCard) {
    missingIdCardPeople.push({ id: 'idCard-lessee', labelKey: 'workspace.docIdPhoto' });
  }
  for (const g of guarantors) {
    if (!idCardByCustomer.has(g.customer_id)) {
      missingIdCardPeople.push({
        id: `idCard-${g.customer_id}`,
        labelText: `${t('workspace.docIdPhoto')} — ${g.customer_name}`,
      });
    }
  }
  // Signatory completeness — sign-pair rendering needs lessor + 2 witnesses
  // bound. Surfaced inline via the embedded SignatoryEditor; here it just
  // gates the sign-pair "Generate contract" button.
  const signatoryReady = getCardStatus('signatory') === 'complete';
  const missingPrereqs = [...missingCardPrereqs, ...missingIdCardPeople];
  if (!signatoryReady) {
    missingPrereqs.push({ id: 'signatory', labelKey: 'workspace.cardSignatory' });
  }
  const prereqsMet = missingPrereqs.length === 0;

  // ── Generic upload helpers (parameterised by target customer) ───────
  const handleErr = (err: unknown) => {
    if (err instanceof ApiError) {
      const tr = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
        || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
      setError(tr || err.code || err.message);
    } else {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const uploadIdCardFor = (targetCustomerId: number) => async (images: UploadedImage[]) => {
    if (images.length === 0) return;
    const tag = `ID_CARD:${targetCustomerId}`;
    setUploading(tag);
    setError('');
    try {
      const results = await uploadFromImage({
        type: 'customer_id_card',
        image: images[0],
        params: { customer_id: targetCustomerId },
      });
      const key = results.lg?.key ?? Object.values(results)[0]?.key;
      if (!key) throw new Error('Upload returned no key');
      await apiClient.rpc('fn_customer_document_upload', {
        p_customer_id: targetCustomerId,
        p_doc_type: 'ID_CARD_FRONT',
        p_file_url: `/${key}`,
      });
      invalidateMediaUrl(key);
      queryClient.invalidateQueries({ queryKey: ['customer-documents-multi'] });
      setCacheBust(n => n + 1);
      if (targetCustomerId === customerId) invalidateCustomer();
    } catch (err) {
      handleErr(err);
    } finally { setUploading(''); }
  };

  const uploadSignatureFor = (targetCustomerId: number) => async (images: UploadedImage[]) => {
    if (!contractId || images.length === 0) return;
    const tag = `SIGNATURE:${targetCustomerId}`;
    setUploading(tag);
    setError('');
    try {
      const results = await uploadFromImage({
        type: 'contract_signature',
        image: images[0],
        params: { contract_id: contractId, customer_id: targetCustomerId },
      });
      const key = results.md?.key ?? results.sm?.key ?? Object.values(results)[0]?.key;
      if (!key) throw new Error('Upload returned no key');
      await apiClient.rpc('fn_contract_document_upload', {
        p_contract_id: contractId,
        p_doc_type: 'SIGNATURE_PAD',
        p_file_url: `/${key}`,
        p_customer_id: targetCustomerId,
      });
      invalidateMediaUrl(key);
      queryClient.invalidateQueries({ queryKey: ['contract-documents', contractId] });
      setCacheBust(n => n + 1);
      invalidateDocs();
    } catch (err) {
      handleErr(err);
    } finally { setUploading(''); }
  };

  if (!contractId) return null;

  return (
    <div className="p-4 flex flex-col gap-8 max-w-2xl">
      {error && <div className="alert alert-danger"><XCircle size={18} /><div><div className="alert-description">{error}</div></div></div>}

      {/* ── Signatory selection (lessor + witnesses) ────────────────── */}
      <div className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold text-subtle uppercase tracking-wider">
          {t('workspace.cardSignatory')}
        </h3>
        <SignatoryEditor />
      </div>

      {/* ── Lessee block — unchanged layout ─────────────────────────── */}
      <SingleUpload
        icon={<CreditCard size={14} />}
        label={t('workspace.docIdPhoto')}
        type="customer_id_card"
        fileUrl={lesseeIdCard?.file_url ?? null}
        uploading={uploading === `ID_CARD:${customerId}`}
        onUpload={customerId ? uploadIdCardFor(customerId) : () => {}}
        disabled={!customerId}
        cacheBust={cacheBust}
      />

      {!prereqsMet && (
        <div className="alert alert-warning">
          <AlertTriangle size={16} />
          <div className="flex flex-col gap-0.5">
            <div className="alert-title">{t('workspace.docPrereqTitle')}</div>
            <div className="alert-description">
              {missingPrereqs.map(c => c.labelText ?? t(c.labelKey!)).join(' · ')}
            </div>
          </div>
        </div>
      )}

      <ContractPreviewSignPair
        contract={previewContract}
        fileUrl={customerId ? signatureByCustomer.get(customerId)?.file_url ?? null : null}
        uploading={uploading === `SIGNATURE:${customerId}`}
        onUpload={customerId ? uploadSignatureFor(customerId) : () => {}}
        disabled={!customerId || !prereqsMet}
        cacheBust={cacheBust}
      />

      {/* ── Guarantor blocks ────────────────────────────────────────── */}
      {guarantors.map(g => {
        const gIdCard = idCardByCustomer.get(g.customer_id) ?? null;
        const gSig = signatureByCustomer.get(g.customer_id) ?? null;
        return (
          <div key={g.customer_id} className="flex flex-col gap-6 pt-6 border-t border-line">
            <div className="text-sm font-semibold text-fg">
              {t('workspace.docsGuarantorHeading', {
                defaultValue: 'Guarantor: {{name}}',
                name: g.customer_name,
              })}
            </div>
            <SingleUpload
              icon={<CreditCard size={14} />}
              label={t('workspace.docIdPhoto')}
              type="customer_id_card"
              fileUrl={gIdCard?.file_url ?? null}
              uploading={uploading === `ID_CARD:${g.customer_id}`}
              onUpload={uploadIdCardFor(g.customer_id)}
              cacheBust={cacheBust}
            />
            <ContractPreviewSignPair
              contract={previewContract}
              fileUrl={gSig?.file_url ?? null}
              uploading={uploading === `SIGNATURE:${g.customer_id}`}
              onUpload={uploadSignatureFor(g.customer_id)}
              disabled={!prereqsMet}
              cacheBust={cacheBust}
              pairLabel={t('workspace.docContractAndSignatureFor', {
                defaultValue: 'Contract & signature — {{name}}',
                name: g.customer_name,
              })}
            />
          </div>
        );
      })}
    </div>
  );
}
