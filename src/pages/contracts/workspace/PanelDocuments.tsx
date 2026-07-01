import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, useSnackbarContext, type UploadedImage } from 'tsp-form';
import { XCircle, CreditCard, Eye, Printer, Loader2, Smartphone, ImageOff, MonitorSmartphone, AlertTriangle } from 'lucide-react';
import { apiClient, ApiError } from '../../../lib/api';
import { invalidateMediaUrl } from '../../../lib/upload';
import { beMediaUploadFromImage, BeMediaError } from '../../../lib/beMedia';
import { normalizeKey } from '../../../lib/mediaPath';
import { useMediaUrl } from '../../../hooks/useMediaUrl';
import { MediaLightbox } from '../../../components/MediaLightbox';
import { ContractCaptureModal } from './ContractCaptureModal';
import { ContractViewQrModal } from './ContractViewQrModal';
import { useWorkspace } from './WorkspaceContext';
import { IdPhotoUpload } from './IdPhotoUpload';
import { ContractPreviewModal } from '../ContractPreviewModal';
import { useGenerateContractPdfServer } from '../useGenerateContractPdfServer';
import { SignatoryEditor } from './SignatoryEditor';
import { ConfidenceScoreEditor } from './ConfidenceScoreEditor';
import { useContractCoLessees } from './useContractCoLessees';
import type { ContractMin } from '../../../lib/contractPdf/contractMin';

interface CustomerDocument {
  id: number;
  customer_id: number;
  doc_type: string;
  file_url: string;
  is_active: boolean;
  uploaded_at: string;
}

interface ReadinessError {
  code: string;
  detail?: Record<string, unknown>;
}

interface ContractAttachment {
  entity_media_id: number;
  media_id: number;
  sort_order: number;
  storage_path: string;
  variants_json: Record<string, string> | null;
  caption: string | null;
}

interface Props { onClose: () => void }

export function PanelDocuments({ onClose: _onClose }: Props) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();
  const { data: workspace, contract, getCardStatus, invalidateCustomer } = useWorkspace();
  const contractId = workspace.contractId;
  const customerId = workspace.customerId;
  const { generating: printing, generate } = useGenerateContractPdfServer();
  const [previewAllOpen, setPreviewAllOpen] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [viewQrOpen, setViewQrOpen] = useState(false);
  const [lightboxKey, setLightboxKey] = useState<string | null>(null);
  // While a mobile-capture session is live, keep polling the album even after
  // the QR modal closes — the phone may still be uploading until the backend
  // session TTL. Holds the session's expiry; polling stops once it passes.
  const [captureExpiresAt, setCaptureExpiresAt] = useState<string | null>(null);

  // Contract attachment album — photos captured via the Mobile Capture Bridge
  // (phone-scanned QR) land here as (CONTRACT, ATTACHMENT). Same view the
  // detail panel reads; refetched as photos arrive in the capture modal.
  const { data: attachments = [], refetch: refetchAttachments } = useQuery({
    queryKey: ['contract-attachments', contractId],
    queryFn: () => apiClient.get<ContractAttachment[]>(
      `/v_entity_media?entity_type=eq.CONTRACT&entity_id=eq.${contractId}&usage_type=eq.ATTACHMENT&select=entity_media_id,media_id,sort_order,storage_path,variants_json,caption&order=sort_order`,
    ),
    enabled: !!contractId,
    // Poll for phone uploads while a capture session is live (survives modal close).
    refetchInterval: captureExpiresAt && new Date(captureExpiresAt).getTime() > Date.now() ? 3000 : false,
  });

  // Signatory used to be a prereq card — it now lives inline at the top of
  // this panel via <SignatoryEditor />, so it's no longer in the prereq list.
  const prereqCards: Array<{ id: string; labelKey?: string; labelText?: string }> = [
    { id: 'customer', labelKey: 'workspace.cardCustomer' },
    { id: 'productPlan', labelKey: 'workspace.cardProduct' },
    { id: 'contactRef', labelKey: 'workspace.cardContactRef' },
    { id: 'co_lessee', labelKey: 'workspace.cardCoLessee' },
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

  const { data: coLessees = [] } = useContractCoLessees(contractId);

  // BE readiness — same validator the "open bill" button uses. When not ready
  // the document can't be previewed/signed; the Contract & signature section
  // shows WHY (these typed codes) instead of the preview + signature cards.
  // Shares the ['contract-readiness', id] cache with PanelReviewPay.
  const { data: readiness } = useQuery({
    queryKey: ['contract-readiness', contractId],
    queryFn: () => apiClient.rpc<{ ready: boolean; errors: ReadinessError[] }>(
      'fn_contract_validate_ready',
      { p_contract_id: contractId },
    ),
    enabled: !!contractId,
    staleTime: 0,
  });
  const notReadyErrors = readiness && !readiness.ready ? readiness.errors : undefined;

  // All ID cards for everyone on the contract (lessee + co-lessees). One
  // batched query keyed on the full customer-id set so we don't N+1.
  const docCustomerIds = [
    ...(customerId ? [customerId] : []),
    ...coLessees.map(g => g.customer_id),
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

  const lesseeIdCard = customerId ? idCardByCustomer.get(customerId) ?? null : null;

  // Print-readiness — same cards as before, plus an ID-card per person on
  // the contract (lessee + each co-lessee). Signatures stay optional.
  const missingIdCardPeople: Array<{ id: string; labelKey?: string; labelText?: string }> = [];
  if (!lesseeIdCard) {
    missingIdCardPeople.push({ id: 'idCard-lessee', labelKey: 'workspace.docIdPhoto' });
  }
  for (const g of coLessees) {
    if (!idCardByCustomer.has(g.customer_id)) {
      missingIdCardPeople.push({
        id: `idCard-${g.customer_id}`,
        labelText: `${t('workspace.docIdPhoto')} — ${g.customer_name}`,
      });
    }
  }
  // Signatory completeness — only the LESSOR matters at draft (witnesses are
  // picked at signing time, mig 345/346). A configured branch default lessor
  // counts as ready since contract-open auto-binds it. Surfaced inline via the
  // embedded SignatoryEditor; here it just gates the "Generate contract" button.
  const signatoryReady = getCardStatus('signatory') === 'complete';
  const missingPrereqs = [...missingCardPrereqs, ...missingIdCardPeople];
  if (!signatoryReady) {
    missingPrereqs.push({ id: 'signatory', labelKey: 'workspace.cardSignatory' });
  }
  const prereqsMet = missingPrereqs.length === 0;

  // Whole-packet actions (wizard): Preview = preview-all (SAMPLE packet of
  // everything to sign); Print = print-all (all sealed docs). Both need the
  // contract prereqs met to render.
  const handlePrintAll = async () => {
    if (!previewContract || !prereqsMet) return;
    try {
      await generate(previewContract, { printAll: true });
    } catch (err) {
      let msg = '';
      if (err instanceof BeMediaError) {
        msg = t(err.code, { ns: 'apiErrors', defaultValue: err.message });
      } else {
        msg = err instanceof Error ? err.message : String(err);
      }
      addSnackbar({
        message: (
          <div className="alert alert-danger"><XCircle size={16} /><span>{msg}</span></div>
        ),
        type: 'error',
      });
    }
  };

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
      const results = await beMediaUploadFromImage({
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

  if (!contractId) return null;

  return (
    <div className="p-4 flex flex-col gap-8 max-w-2xl">
      {error && <div className="alert alert-danger"><XCircle size={18} /><div><div className="alert-description">{error}</div></div></div>}

      {/* ── Customer confidence rating (readiness prerequisite) ─────── */}
      <ConfidenceScoreEditor />

      {/* ── Signatory selection (lessor + witnesses) ────────────────── */}
      <div className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold text-subtle uppercase tracking-wider">
          {t('workspace.cardSignatory')}
        </h3>
        <SignatoryEditor />
      </div>

      {/* ── Whole-packet actions — preview-all / print-all ──────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          startIcon={<Eye size={14} />}
          onClick={() => setPreviewAllOpen(true)}
          disabled={!previewContract || !prereqsMet}
        >
          {t('contract.previewContract', { defaultValue: 'Preview' })}
        </Button>
        <Button
          color="primary"
          startIcon={printing ? <Loader2 size={14} className="animate-spin" /> : <Printer size={14} />}
          onClick={handlePrintAll}
          disabled={!previewContract || !prereqsMet || printing}
        >
          {printing ? t('common.loading') : t('contract.printContractPdf', { defaultValue: 'Print contract PDF' })}
        </Button>
        <Button
          variant="outline"
          startIcon={<MonitorSmartphone size={14} />}
          onClick={() => setViewQrOpen(true)}
          disabled={!previewContract || !prereqsMet}
        >
          {t('workspace.contractViewQr', { defaultValue: 'Read on phone' })}
        </Button>
      </div>

      {/* ── Contract photos — capture from phone (Mobile Capture Bridge) ─ */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-semibold text-subtle uppercase tracking-wider">
            {t('workspace.cardAttachments', { defaultValue: 'Contract photos' })}
            <span className="ml-2 normal-case font-normal text-subtler">{attachments.length}</span>
          </h3>
          <Button
            variant="outline"
            size="sm"
            startIcon={<Smartphone size={14} />}
            onClick={() => setCaptureOpen(true)}
          >
            {t('workspace.captureFromPhone', { defaultValue: 'Capture from phone' })}
          </Button>
        </div>
        {attachments.length === 0 ? (
          <div className="text-xs text-subtler italic py-4 border border-dashed border-line rounded-md text-center">
            {t('workspace.captureEmpty', { defaultValue: 'No photos yet. Scan the QR with a phone to add.' })}
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-2">
            {attachments.map((m) => (
              <AttachmentThumb
                key={m.entity_media_id}
                media={m}
                onPreview={(key) => setLightboxKey(key)}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Lessee block — unchanged layout ─────────────────────────── */}
      <IdPhotoUpload
        icon={<CreditCard size={14} />}
        label={t('workspace.docIdPhoto')}
        type="customer_id_card"
        fileUrl={lesseeIdCard?.file_url ?? null}
        uploading={uploading === `ID_CARD:${customerId}`}
        onUpload={customerId ? uploadIdCardFor(customerId) : () => {}}
        disabled={!customerId}
        cacheBust={cacheBust}
      />

      {/* Why-not-ready — the BE readiness list (preview/print/sign live in the
          action buttons above; this just explains what's still missing). */}
      {notReadyErrors && notReadyErrors.length > 0 && (
        <div className="alert alert-warning">
          <AlertTriangle size={16} />
          <div className="flex flex-col gap-0.5 min-w-0">
            <div className="alert-title">
              {t('workspace.docNotReadyTitle', { defaultValue: 'Complete these before previewing or signing' })}
            </div>
            <ul className="alert-description list-disc pl-5 flex flex-col gap-0.5">
              {notReadyErrors.map((err, i) => (
                <li key={`${err.code}-${i}`}>{readinessLabel(err, t)}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* ── Co-lessee blocks — ID card only (signing happens on the bridge) ── */}
      {coLessees.map(g => {
        const gIdCard = idCardByCustomer.get(g.customer_id) ?? null;
        return (
          <div key={g.customer_id} className="flex flex-col gap-6 pt-6 border-t border-line">
            <div className="text-sm font-semibold text-fg">
              {t('workspace.docsCoLesseeHeading', {
                defaultValue: 'Co-lessee: {{name}}',
                name: g.customer_name,
              })}
            </div>
            <IdPhotoUpload
              icon={<CreditCard size={14} />}
              label={t('workspace.docIdPhoto')}
              type="customer_id_card"
              fileUrl={gIdCard?.file_url ?? null}
              uploading={uploading === `ID_CARD:${g.customer_id}`}
              onUpload={uploadIdCardFor(g.customer_id)}
              cacheBust={cacheBust}
            />
          </div>
        );
      })}

      {/* preview-all: SAMPLE packet of everything to sign */}
      <ContractPreviewModal
        open={previewAllOpen}
        onClose={() => setPreviewAllOpen(false)}
        contract={previewContract}
        target={{ previewAll: true }}
      />

      {/* QR capture — phone scans, photos auto-attach to the contract album */}
      <ContractCaptureModal
        open={captureOpen}
        onClose={() => setCaptureOpen(false)}
        contractId={contractId}
        contractCode={contract?.code_display ?? null}
        onUploaded={() => refetchAttachments()}
        onSessionActive={setCaptureExpiresAt}
      />

      {/* QR — let the customer read the contract on a 2nd device (read-only) */}
      <ContractViewQrModal
        open={viewQrOpen}
        onClose={() => setViewQrOpen(false)}
        contractId={contractId}
        contractCode={contract?.code_display ?? null}
      />

      <MediaLightbox
        open={lightboxKey != null}
        onClose={() => setLightboxKey(null)}
        mediaKey={lightboxKey}
        alt="Contract photo"
      />
    </div>
  );
}

// ── Attachment thumbnail ─────────────────────────────────────────────────────

function AttachmentThumb({
  media,
  onPreview,
}: {
  media: ContractAttachment;
  onPreview: (fullKey: string) => void;
}) {
  const v = media.variants_json ?? {};
  const thumbKey = v.md || v.sm || v.lg || media.storage_path || null;
  const fullKey = v.lg || v.md || media.storage_path || null;
  const { url } = useMediaUrl(thumbKey ? normalizeKey(thumbKey) : null);

  return (
    <button
      type="button"
      onClick={() => fullKey && onPreview(normalizeKey(fullKey))}
      className="aspect-square rounded-md border border-line overflow-hidden bg-surface flex items-center justify-center cursor-zoom-in p-0"
      aria-label="Preview photo"
    >
      {url ? (
        <img src={url} alt={media.caption ?? ''} className="w-full h-full object-cover" />
      ) : (
        <ImageOff size={18} className="text-subtler" />
      )}
    </button>
  );
}

// BE readiness error → human line. SIGNATORY_INCOMPLETE carries detail.missing
// (LESSOR / WITNESS_1 / WITNESS_2) so we append the specific slot.
function readinessLabel(
  err: ReadinessError,
  t: ReturnType<typeof useTranslation>['t'],
): string {
  const base = t(err.code, { ns: 'apiErrors', defaultValue: err.code });
  const missing = err.detail?.missing;
  if (typeof missing === 'string' && missing) {
    const slot = t(
      `workspace.signatory${missing === 'LESSOR' ? 'Lessor' : missing === 'WITNESS_1' ? 'Witness1' : missing === 'WITNESS_2' ? 'Witness2' : ''}`,
      { defaultValue: missing },
    );
    return `${base} — ${slot}`;
  }
  return base;
}
