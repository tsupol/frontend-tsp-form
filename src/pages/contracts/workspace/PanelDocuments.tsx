import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from 'tsp-form';
import type { UploadedImage } from 'tsp-form';
import { XCircle, CreditCard, Eye, ScrollText, AlertTriangle, PenLine, CheckCircle } from 'lucide-react';
import { apiClient, ApiError } from '../../../lib/api';
import { uploadFromImage, invalidateMediaUrl } from '../../../lib/upload';
import { useMediaUrl } from '../../../hooks/useMediaUrl';
import { useWorkspace } from './WorkspaceContext';
import { SingleUpload } from './SingleUpload';
import { ContractSignModal } from './ContractSignModal';
import { ContractPreviewModal } from '../ContractPreviewModal';
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

  // Preview + signature require the contract to be "ready enough" to render.
  // We gate on the same cards the renderer + activate flow care about.
  const prereqCards: Array<{ id: string; labelKey: string }> = [
    { id: 'customer', labelKey: 'workspace.cardCustomer' },
    { id: 'productPlan', labelKey: 'workspace.cardProduct' },
    { id: 'contactRef', labelKey: 'workspace.cardContactRef' },
    { id: 'guarantor', labelKey: 'workspace.cardGuarantor' },
    { id: 'signatory', labelKey: 'workspace.cardSignatory' },
  ];
  const missingPrereqs = prereqCards.filter(c => getCardStatus(c.id) !== 'complete');
  const prereqsMet = missingPrereqs.length === 0;

  const [uploading, setUploading] = useState('');
  const [error, setError] = useState('');
  const [cacheBust, setCacheBust] = useState(0);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [signOpen, setSignOpen] = useState(false);

  // Build ContractMin from the workspace server state for the preview modal.
  // Preview reads bound signatories + handover straight from v_contract_detail,
  // so no overrides needed — what the customer sees matches the current state.
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

  // Fetch customer documents (ID_CARD_FRONT)
  const { data: customerDocs = [] } = useQuery({
    queryKey: ['customer-documents', customerId],
    queryFn: () => apiClient.get<CustomerDocument[]>(
      `/v_customer_documents?customer_id=eq.${customerId}&doc_type=eq.ID_CARD_FRONT&is_active=eq.true`
    ),
    enabled: !!customerId,
  });

  // Fetch contract documents (SIGNATURE_PAD)
  const { data: contractDocs = [] } = useQuery({
    queryKey: ['contract-documents', contractId],
    queryFn: () => apiClient.get<ContractDocument[]>(
      `/v_contract_documents?contract_id=eq.${contractId}&doc_type=eq.SIGNATURE_PAD`
    ),
    enabled: !!contractId,
  });

  const idCard = customerDocs[0] ?? null;
  const signature = contractDocs.find(d => d.customer_id === customerId) ?? null;

  // ── ID Card upload ──────────────────────────────────────────────────
  const uploadIdCard = async (images: UploadedImage[]) => {
    if (!customerId || images.length === 0) return;
    setUploading('ID_CARD');
    setError('');
    try {
      const results = await uploadFromImage({
        type: 'customer_id_card',
        image: images[0],
        params: { customer_id: customerId },
      });
      const key = results.lg?.key ?? Object.values(results)[0]?.key;
      if (!key) throw new Error('Upload returned no key');
      await apiClient.rpc('fn_customer_document_upload', {
        p_customer_id: customerId,
        p_doc_type: 'ID_CARD_FRONT',
        p_file_url: `/${key}`,
      });
      queryClient.invalidateQueries({ queryKey: ['customer-documents', customerId] });
      setCacheBust(n => n + 1);
      invalidateCustomer();
    } catch (err) {
      if (err instanceof ApiError) {
        const tr = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
          || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
        setError(tr || err.code || err.message);
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally { setUploading(''); }
  };

  // ── Signature upload ────────────────────────────────────────────────
  const uploadSignature = async (images: UploadedImage[]) => {
    if (!contractId || !customerId || images.length === 0) return;
    setUploading('SIGNATURE');
    setError('');
    try {
      const results = await uploadFromImage({
        type: 'contract_signature',
        image: images[0],
        params: { contract_id: contractId, customer_id: customerId },
      });
      // Signature spec emits a single size. Use a fallback chain so the
      // upload survives any future relabel from the backend (was `sm`,
      // currently `md`).
      const key = results.md?.key ?? results.sm?.key ?? Object.values(results)[0]?.key;
      if (!key) throw new Error('Upload returned no key');
      await apiClient.rpc('fn_contract_document_upload', {
        p_contract_id: contractId,
        p_doc_type: 'SIGNATURE_PAD',
        p_file_url: `/${key}`,
        p_customer_id: customerId,
      });
      // Re-upload overwrites at the same storage key, so the previously
      // cached presigned URL still resolves but points at the OLD image
      // (browser cache hit on the same URL). Drop the presign cache so
      // useMediaUrl fetches a fresh signed URL — the new URL string forces
      // the browser to refetch.
      invalidateMediaUrl(key);
      queryClient.invalidateQueries({ queryKey: ['contract-documents', contractId] });
      setCacheBust(n => n + 1);
      invalidateDocs();
    } catch (err) {
      if (err instanceof ApiError) {
        const tr = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
          || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
        setError(tr || err.code || err.message);
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally { setUploading(''); }
  };

  if (!contractId) return null;

  return (
    <div className="p-4 flex flex-col gap-8 max-w-2xl">
      {error && <div className="alert alert-danger"><XCircle size={18} /><div><div className="alert-description">{error}</div></div></div>}

      {/* ID Card / Passport */}
      <SingleUpload
        icon={<CreditCard size={14} />}
        label={t('workspace.docIdPhoto')}
        fileUrl={idCard?.file_url ?? null}
        uploading={uploading === 'ID_CARD'}
        onUpload={uploadIdCard}
        disabled={!customerId}
        cacheBust={cacheBust}
      />

      {/* Prerequisite alert — preview and signature stay disabled until ready */}
      {!prereqsMet && (
        <div className="alert alert-warning">
          <AlertTriangle size={16} />
          <div className="flex flex-col gap-0.5">
            <div className="alert-title">{t('workspace.docPrereqTitle')}</div>
            <div className="alert-description">
              {missingPrereqs.map(c => t(c.labelKey)).join(' · ')}
            </div>
          </div>
        </div>
      )}

      {/* Preview + Signature — side-by-side cards */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 mb-1">
          {signature?.file_url
            ? <CheckCircle size={14} className="text-success" />
            : <span className="w-3.5 h-3.5 rounded-full border-2 border-fg/30" />}
          <ScrollText size={14} />
          <label className="form-label mb-0">
            {t('workspace.docContractAndSignature', { defaultValue: 'Contract & signature' })}
          </label>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <PreviewCard
            disabled={!previewContract || !prereqsMet}
            onClick={() => setPreviewOpen(true)}
          />
          <SignatureCard
            fileUrl={signature?.file_url ?? null}
            cacheBust={cacheBust}
            disabled={!customerId || !prereqsMet}
            onClick={() => setSignOpen(true)}
          />
        </div>
      </div>

      <ContractPreviewModal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        contract={previewContract}
        onAcceptAndSign={() => {
          setPreviewOpen(false);
          setSignOpen(true);
        }}
      />

      <ContractSignModal
        open={signOpen}
        onClose={() => setSignOpen(false)}
        fileUrl={signature?.file_url ?? null}
        uploading={uploading === 'SIGNATURE'}
        onUpload={uploadSignature}
        disabled={!customerId || !prereqsMet}
        cacheBust={cacheBust}
        onSigned={() => setSignOpen(false)}
      />
    </div>
  );
}

// Preview card — static, just a click target that opens the preview modal.
function PreviewCard({ disabled, onClick }: { disabled: boolean; onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="group flex flex-col items-center justify-center gap-3 h-40 w-full border border-line rounded-lg bg-surface hover:border-primary hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-line disabled:hover:bg-surface transition-colors text-subtle"
    >
      <ScrollText size={28} className="text-fg/70 group-hover:text-primary group-disabled:text-subtle transition-colors" />
      <div className="flex flex-col items-center gap-0.5">
        <span className="text-sm font-medium text-fg">{t('workspace.docPreviewContract')}</span>
        <span className="text-xs inline-flex items-center gap-1">
          <Eye size={12} />
          {t('contract.previewContract')}
        </span>
      </div>
    </button>
  );
}

// Signature card — shows saved signature thumbnail or empty state; opens sign modal.
function SignatureCard({ fileUrl, cacheBust, disabled, onClick }: {
  fileUrl: string | null;
  cacheBust: number;
  disabled: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  const { url: displayUrl } = useMediaUrl(fileUrl, cacheBust);
  const signed = !!fileUrl;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="group flex flex-col h-40 w-full border border-line rounded-lg overflow-hidden bg-surface hover:border-primary disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-line transition-colors"
    >
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-line text-xs">
        <span className="inline-flex items-center gap-1.5 font-medium text-fg">
          {signed
            ? <CheckCircle size={12} className="text-success" />
            : <span className="w-3 h-3 rounded-full border-2 border-fg/30" />}
          {t('workspace.docSignature')}
        </span>
        <span className="inline-flex items-center gap-1 text-subtle">
          <PenLine size={12} />
          {signed ? t('workspace.sigRetake') : t('contract.acceptAndSign', { defaultValue: 'Accept & sign' })}
        </span>
      </div>
      <div className="flex-1 min-h-0 bg-white flex items-center justify-center overflow-hidden">
        {signed ? (
          displayUrl ? (
            <img
              key={displayUrl}
              src={displayUrl}
              alt=""
              className="max-w-full max-h-full object-contain p-2"
            />
          ) : (
            <span className="text-xs text-subtle">{t('common.loading')}</span>
          )
        ) : (
          <span className="text-xs text-subtle">{t('workspace.sigNotSignedYet', { defaultValue: 'Not signed yet' })}</span>
        )}
      </div>
    </button>
  );
}

