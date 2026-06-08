import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { Badge, Button, Input, Select, Modal, TextArea, Tooltip, useSnackbarContext } from 'tsp-form';
import { ChevronLeft, ChevronRight, Copy, Check, Pencil, Truck, CheckCircle, XCircle, Loader2, Upload, Camera, Smartphone, Plus, UserPlus, UserMinus, Phone, IdCard, Trash2, ExternalLink, Printer, AlertTriangle } from 'lucide-react';
import { useGenerateContractPdfServer } from './useGenerateContractPdfServer';
import { GenerateContractPdfModal } from './GenerateContractPdfModal';
import { Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { ApiError } from '../../lib/api';
import { uploadFromImage, getUploadSpec, specToResize, deleteMedia } from '../../lib/upload';
import { toStoragePath, normalizeKey } from '../../lib/mediaPath';
import { useMediaUrl } from '../../hooks/useMediaUrl';
import { useAuth } from '../../contexts/AuthContext';
import { apiClient } from '../../lib/api';
import { DateTime } from '../../components/DateTime';
import { fmtCurrency } from '../../lib/format';
import { getStateColor, getStateLabel } from './contractUtils';
import { ContractActionButtons } from './ContractActions';
import { WalletsTab } from './wallet/WalletsTab';
import { DeviceTab } from './DeviceTab';
import { BillReceipt } from './workspace/BillReceipt';
import { useNavGuard } from '../../contexts/NavGuardContext';
import { CustomerPickerModal } from './CustomerPickerModal';
import { BranchPinInput } from '../../components/BranchPinInput';
import { MediaLightbox, MediaThumbButton } from '../../components/MediaLightbox';
import { CustomerLoginCard, useCustomerLoginInfo, useInvalidateLoginInfo, type CustomerLoginInfo } from '../../components/CustomerLoginCard';

// ── Types ────────────────────────────────────────────────────────────────────

interface ContractDetail {
  id: number;
  code: string;
  code_display: string | null;
  holding_id: number;
  company_id: number;
  branch_id: number;
  branch_name: string;
  state: string;
  close_reason: string | null;
  close_reason_note: string | null;
  commercial_model: string | null;
  customer_id: number | null;
  customer_name: string | null;
  draft_note: string | null;
  device_id: number | null;
  device_identifier: string | null;
  device_current_bucket: string | null;
  device_condition_grade: string | null;
  loaner_device_id: number | null;
  is_used_asset: boolean;
  is_paused: boolean;
  paused_at: string | null;
  product_id: number | null;
  model_id: number | null;
  model_name: string | null;
  variant_id: number | null;
  variant_name: string | null;
  rate_card_id: number | null;
  cost_price: number | null;
  list_price: number | null;
  rate_percent: number | null;
  agreed_price: number | null;
  down_payment: number | null;
  insurance_deposit: number | null;
  insurance_balance: number | null;
  installment_amount: number | null;
  value_month: number | null;
  saving_target_amount: number | null;
  snapshot_term_months: number | null;
  snapshot_installment_amount: number | null;
  snapshot_total_financed: number | null;
  agreed_total_financed: number | null;
  discount_amount: number | null;
  discount_percent: number | null;
  discount_approval_id: number | null;
  discount_approval_status: string | null;
  total_paid: number | null;
  outstanding_amount: number | null;
  credit_balance: number | null;
  credit_balance_company: number | null;
  credit_balance_holding: number | null;
  late_fee_balance: number | null;
  total_refunded: number | null;
  saving_balance: number | null;
  paid_installment_count: number | null;
  total_installments: number | null;
  next_due_date: string | null;
  next_due_amount: number | null;
  next_due_in_days: number | null;
  last_payment_date: string | null;
  overdue_amount: number | null;
  overdue_count: number | null;
  overdue_since_date: string | null;
  overdue_days: number | null;
  staff_confidence_score: number | null;
  commission_owner_id: number | null;
  commission_owner_name: string | null;
  shipped_at: string | null;
  shipping_method: string | null;
  tracking_number: string | null;
  source: string | null;
  last_note: string | null;
  created_by: number | null;
  created_by_name: string | null;
  created_at: string;
  activated_at: string | null;
  closed_at: string | null;
  updated_at: string;
  current_step: string | null;
  step_data: unknown;
  draft_age_days: number | null;
  transfer_to_branch_id: number | null;
}

interface Installment {
  id: number;
  contract_id: number;
  pay_no: number;
  status: string;
  due_date: string;
  due_amount: number;
  paid_amount: number;
  paid_at: string | null;
  deferred_from: number | null;
  created_at: string;
}

interface ContractTxn {
  id: number;
  contract_id: number;
  txn_type: string;
  amount: number;
  pay_no: number | null;
  ref_type: string | null;
  ref_id: number | null;
  note: string | null;
  created_by: number;
  created_by_name: string;
  created_at: string;
}

interface ContractCustomer {
  id: number;
  contract_id: number;
  customer_id: number;
  customer_name: string;
  role: string;
  relation: string | null;
  created_at: string;
}

interface ContractNote {
  id: number;
  contract_id: number;
  note: string;
  created_by: number;
  created_by_name: string;
  created_at: string;
}

interface EntityMedia {
  entity_media_id: number;
  media_id: number;
  entity_type: string;
  entity_id: number;
  usage_type: string;
  display_mode?: string;
  sort_order: number;
  caption?: string | null;
  is_active?: boolean;
  // Backend changed 2026-04-14: storage_path is a text key, variants live in variants_json.
  storage_path: string;
  variants_json: Record<string, string> | null;
  created_at: string;
}

// ── Tabs ─────────────────────────────────────────────────────────────────────

type DetailTab = 'overview' | 'money' | 'device' | 'customers' | 'notes';

const TABS: DetailTab[] = ['overview', 'money', 'device', 'customers', 'notes'];

type MoneySection = 'installments' | 'txns' | 'wallets' | 'bills';

const MONEY_SECTIONS: MoneySection[] = ['installments', 'wallets', 'bills', 'txns'];

// ── Scrollable Tabs ─────────────────────────────────────────────────────────

function ScrollableTabs<T extends string>({ tabs, activeTab, onTabChange, renderLabel }: {
  tabs: readonly T[];
  activeTab: T;
  onTabChange: (tab: T) => void;
  renderLabel: (tab: T) => React.ReactNode;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 0);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);

  useEffect(() => {
    checkScroll();
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener('scroll', checkScroll, { passive: true });
    const ro = new ResizeObserver(checkScroll);
    ro.observe(el);
    return () => { el.removeEventListener('scroll', checkScroll); ro.disconnect(); };
  }, [checkScroll]);

  const scroll = (dir: 'left' | 'right') => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: dir === 'left' ? -120 : 120, behavior: 'smooth' });
  };

  return (
    <div className="flex-none relative border-b border-line">
      {canScrollLeft && (
        <button
          className="absolute left-0 top-0 bottom-0 z-10 w-7 flex items-center justify-center bg-bg border-r border-line cursor-pointer border-y-0 border-l-0"
          onClick={() => scroll('left')}
        >
          <ChevronLeft size={14} className="text-subtle" />
        </button>
      )}
      <div ref={scrollRef} className="flex px-2 overflow-x-auto hidden-scroll">
        {tabs.map(tab => (
          <button
            key={tab}
            className={`py-2 px-3 text-sm font-medium transition-colors cursor-pointer border-b-2 whitespace-nowrap ${
              activeTab === tab
                ? 'border-primary-fg text-primary-fg'
                : 'border-transparent text-fg'
            }`}
            onClick={() => onTabChange(tab)}
          >
            {renderLabel(tab)}
          </button>
        ))}
      </div>
      {canScrollRight && (
        <button
          className="absolute right-0 top-0 bottom-0 z-10 w-7 flex items-center justify-center bg-bg border-l border-line cursor-pointer border-y-0 border-r-0"
          onClick={() => scroll('right')}
        >
          <ChevronRight size={14} className="text-subtle" />
        </button>
      )}
    </div>
  );
}

// ── Component ────────────────────────────────────────────────────────────────

export function ContractDetailPanel({ contractId, isMobile }: { contractId: number; isMobile: boolean }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<DetailTab>('overview');
  const [copied, setCopied] = useState(false);
  const [requestedAction, setRequestedAction] = useState<
    | 'bind_device'
    | 'unbind_device'
    | 'deposit_device'
    | 'return_deposit'
    | 'bind_loaner'
    | 'unbind_loaner'
    | 'device_repair_request'
    | 'detach_customer'
    | null
  >(null);
  const [deliveryModalOpen, setDeliveryModalOpen] = useState(false);
  const notesDirtyRef = useRef(false);
  const [pendingTab, setPendingTab] = useState<DetailTab | null>(null);
  const navGuard = useNavGuard();

  useEffect(() => {
    navGuard?.setDirtyRef(notesDirtyRef);
  }, [navGuard]);

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (notesDirtyRef.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  const handleTabChange = useCallback((next: DetailTab) => {
    if (notesDirtyRef.current && activeTab !== next) {
      setPendingTab(next);
      return;
    }
    setActiveTab(next);
  }, [activeTab]);

  const confirmDiscardTab = () => {
    if (!pendingTab) return;
    notesDirtyRef.current = false;
    setActiveTab(pendingTab);
    setPendingTab(null);
  };

  const handleCopyCode = useCallback((code: string) => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, []);

  const { data: contract, isLoading } = useQuery({
    queryKey: ['contract-detail', contractId],
    queryFn: async () => {
      const result = await apiClient.get<ContractDetail[]>(`/v_contract_detail?id=eq.${contractId}`);
      return result[0] ?? null;
    },
    placeholderData: keepPreviousData,
  });

  if (isLoading && !contract) {
    return <div className="flex-1 flex items-center justify-center text-subtler">{t('common.loading')}</div>;
  }

  if (!contract) {
    return <div className="flex-1 flex items-center justify-center text-subtler">{t('common.noData')}</div>;
  }

  return (
    <div className="relative flex flex-col h-full min-w-0">
      {/* Desktop header */}
      {!isMobile && (
        <div className="flex-none flex items-center h-panel-header-h px-4 border-b border-line gap-2">
          <span className="font-semibold">{contract.code_display ?? contract.code}</span>
          <button
            type="button"
            onClick={() => handleCopyCode(contract.code_display ?? contract.code)}
            className="p-1 rounded hover:bg-surface-hover transition-colors cursor-pointer text-subtle hover:text-fg"
            aria-label={t('common.copy')}
            title={copied ? t('common.copied') : t('common.copy')}
          >
            {copied ? <Check size={14} className="text-success" /> : <Copy size={14} />}
          </button>
          <Badge size="xs" color={getStateColor(contract.state)}>
            {getStateLabel(contract.state, t)}
          </Badge>
          {contract.is_paused && (
            <Badge size="xs" color="warning">{t('contract.paused')}</Badge>
          )}
          {contract.commercial_model && (
            <span className="text-xs text-subtle">{contract.commercial_model}</span>
          )}
        </div>
      )}

      {/* Tabs with scroll arrows */}
      <ScrollableTabs
        tabs={TABS}
        activeTab={activeTab}
        onTabChange={handleTabChange}
        renderLabel={(tab) => t(`contract.tab_${tab}`)}
      />

      {/* Tab content */}
      <div className="flex-1 overflow-auto better-scroll">
        {activeTab === 'overview' && (
          <OverviewTab
            contract={contract}
            t={t}
            queryClient={queryClient}
            onRequestBindDevice={() => setRequestedAction('bind_device')}
            deliveryModalOpen={deliveryModalOpen}
            setDeliveryModalOpen={setDeliveryModalOpen}
          />
        )}
        {activeTab === 'money' && <MoneyTab contractId={contractId} contract={contract} t={t} />}
        {activeTab === 'customers' && (
          <CustomersTab
            contractId={contractId}
            customerId={contract.customer_id}
            customerName={contract.customer_name}
            t={t}
            onRequestDetachCustomer={() => setRequestedAction('detach_customer')}
          />
        )}
        {activeTab === 'notes' && <NotesTab contractId={contractId} t={t} dirtyRef={notesDirtyRef} />}
        {activeTab === 'device' && (
          <DeviceTab contract={contract} onRequestAction={setRequestedAction} />
        )}
      </div>

      {/* Contract actions */}
      <ContractActionButtons
        contract={contract}
        requestedAction={requestedAction}
        onRequestedActionConsumed={() => setRequestedAction(null)}
        onNavigateTab={(tab) => handleTabChange(tab)}
        onRefresh={() => {
          queryClient.invalidateQueries({ queryKey: ['contract-detail', contractId] });
          queryClient.invalidateQueries({ queryKey: ['contract-search'] });
          queryClient.invalidateQueries({ queryKey: ['saving-contracts'] });
          queryClient.invalidateQueries({ queryKey: ['contract-installments', contractId] });
          queryClient.invalidateQueries({ queryKey: ['contract-txns', contractId] });
          queryClient.invalidateQueries({ queryKey: ['contract-bills', contractId] });
          queryClient.invalidateQueries({ queryKey: ['contract-bill-payments', contractId] });
        }}
      />

      <Modal open={!!pendingTab} onClose={() => setPendingTab(null)} maxWidth="400px" ariaLabel={t('common.unsavedChanges')}>
        <div className="modal-header">
          <h2 className="modal-title">{t('common.unsavedChanges')}</h2>
          <button type="button" className="modal-close-btn" onClick={() => setPendingTab(null)} aria-label="Close">&times;</button>
        </div>
        <div className="modal-content">
          <p>{t('common.unsavedChangesMessage')}</p>
        </div>
        <div className="modal-footer">
          <Button variant="ghost" onClick={() => setPendingTab(null)}>{t('common.cancel')}</Button>
          <Button color="danger" onClick={confirmDiscardTab}>{t('common.discard')}</Button>
        </div>
      </Modal>
    </div>
  );
}

// ── Media thumbnail helper ───────────────────────────────────────────────────

function DeliveryPhotoThumb({ media, onPreview, onRemove, disabled }: {
  media: EntityMedia;
  onPreview: () => void;
  onRemove: () => void;
  disabled?: boolean;
}) {
  const v = media.variants_json ?? {};
  const thumbKey = v.sm || v.thumb || v.md || v.medium || v.lg || v.original || media.storage_path;
  if (!thumbKey) return null;
  return (
    <div className="relative group">
      <MediaThumbButton
        mediaKey={normalizeKey(thumbKey)}
        alt={media.caption ?? ''}
        className="w-20 h-20 rounded border border-line overflow-hidden cursor-zoom-in hover:opacity-80 transition-opacity bg-surface-shallow p-0"
        fit="cover"
        onClick={onPreview}
      />
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        aria-label="Remove"
        className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-danger text-white flex items-center justify-center shadow-sm hover:bg-danger/90 disabled:opacity-50 disabled:cursor-not-allowed border-none p-0 cursor-pointer"
      >
        <Trash2 size={11} />
      </button>
    </div>
  );
}

function pickThumbKey(media: EntityMedia): string | null {
  const v = media.variants_json ?? {};
  return v.sm || v.thumb || v.md || v.medium || v.lg || v.original || media.storage_path || null;
}

function pickFullKey(media: EntityMedia): string | null {
  const v = media.variants_json ?? {};
  return v.original || v.lg || v.md || v.medium || media.storage_path || null;
}

function MediaThumbnail({ media, onClick }: { media: EntityMedia; onClick?: () => void }) {
  const thumbKey = pickThumbKey(media);
  if (!thumbKey) return null;
  return (
    <div className="relative group">
      <MediaThumbButton
        mediaKey={normalizeKey(thumbKey)}
        alt={media.caption ?? media.usage_type}
        className="w-16 h-16 rounded border border-line overflow-hidden cursor-zoom-in hover:opacity-80 transition-opacity bg-surface-shallow p-0"
        fit="cover"
        onClick={onClick ?? (() => {})}
      />
      {media.caption && (
        <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[10px] px-1 py-0.5 rounded-b truncate pointer-events-none">
          {media.caption}
        </div>
      )}
    </div>
  );
}

function MediaRow({ label, media }: { label: string; media: EntityMedia[] }) {
  const [lightboxKey, setLightboxKey] = useState<string | null>(null);
  const [lightboxAlt, setLightboxAlt] = useState<string>('');
  if (media.length === 0) return null;
  return (
    <div>
      <div className="text-xs text-subtle mb-1">{label}</div>
      <div className="flex gap-2 flex-wrap">
        {media.map(m => {
          const fullKey = pickFullKey(m);
          return (
            <MediaThumbnail
              key={m.entity_media_id}
              media={m}
              onClick={fullKey ? () => {
                setLightboxKey(normalizeKey(fullKey));
                setLightboxAlt(m.caption ?? m.usage_type);
              } : undefined}
            />
          );
        })}
      </div>
      <MediaLightbox
        open={lightboxKey != null}
        onClose={() => setLightboxKey(null)}
        mediaKey={lightboxKey}
        alt={lightboxAlt}
      />
    </div>
  );
}

// ── Overview Tab ─────────────────────────────────────────────────────────────

function OverviewTab({ contract, t, queryClient, onRequestBindDevice, deliveryModalOpen, setDeliveryModalOpen }: {
  contract: ContractDetail;
  t: ReturnType<typeof useTranslation>['t'];
  queryClient: ReturnType<typeof useQueryClient>;
  onRequestBindDevice: () => void;
  deliveryModalOpen: boolean;
  setDeliveryModalOpen: (open: boolean) => void;
}) {
  const isFin2 = contract.commercial_model === 'FIN2';
  const isActive = contract.state === 'ACTIVE' || contract.state === 'COMPLETED' || contract.state === 'TERMINATED';
  const needsDeviceBind =
    (contract.state === 'ACTIVE' || contract.state === 'WAIT_LEGAL_PROCESS' || contract.state === 'ON_LEGAL_PROCESS') &&
    contract.device_id == null &&
    !contract.is_used_asset;
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const { generating: printingPdf } = useGenerateContractPdfServer();
  const [pdfModalOpen, setPdfModalOpen] = useState(false);
  const [printBlockOpen, setPrintBlockOpen] = useState(false);
  const [printBlockReasons, setPrintBlockReasons] = useState<string[]>([]);

  // ID card (primary customer)
  const { data: idCardDocs = [] } = useQuery({
    queryKey: ['customer-documents-id-card', contract.customer_id],
    queryFn: () => apiClient.get<Array<{ id: number; file_url: string }>>(
      `/v_customer_documents?customer_id=eq.${contract.customer_id}&doc_type=eq.ID_CARD_FRONT&is_active=eq.true`,
    ),
    enabled: contract.customer_id != null,
  });

  // Signature (per contract)
  const { data: signatureDocs = [] } = useQuery({
    queryKey: ['contract-documents-signature', contract.id],
    queryFn: () => apiClient.get<Array<{ id: number; file_url: string; customer_id: number }>>(
      `/v_contract_documents?contract_id=eq.${contract.id}&doc_type=eq.SIGNATURE_PAD`,
    ),
  });

  const idCardKey = idCardDocs[0]?.file_url ?? null;
  const signatureKey = signatureDocs[0]?.file_url ?? null;

  // Print button requires a bound device. iCloud is no longer required.
  const printReadiness = (() => {
    const reasons: string[] = [];
    if (contract.device_id == null) reasons.push(t('contract.printBlock_noDevice'));
    return { ready: reasons.length === 0, reasons };
  })();

  // Client-side PDF generation (pdfmake + Sarabun Thai font). Downloads
  // CT-XXXX.pdf to the user's machine; backend storage will come later when
  // fn_contract_export_pdf lands.
  const handlePrintPdf = () => {
    if (!printReadiness.ready) {
      setPrintBlockReasons(printReadiness.reasons);
      setPrintBlockOpen(true);
      return;
    }
    setPdfModalOpen(true);
  };

  const copyValue = (field: string, value: string) => {
    navigator.clipboard.writeText(value).then(() => {
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 1500);
    });
  };

  return (
    <div className="p-4 flex flex-col gap-4">
      {/* Bind device reminder — NEW asset post-activate */}
      {needsDeviceBind && (
        <div className="border rounded-md px-4 py-3 border-warning/30 bg-warning/5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <Smartphone size={14} className="text-warning-fg shrink-0" />
              <div className="min-w-0">
                <div className="text-xs font-semibold uppercase tracking-wider text-warning-fg">
                  {t('contract.deviceNotBound')}
                </div>
                <div className="text-sm text-warning-fg/90 mt-0.5">
                  {t('contract.bindDeviceReminder')}
                </div>
              </div>
            </div>
            <Button size="sm" color="primary" onClick={onRequestBindDevice} className="shrink-0">
              {t('contract.action_bind_device')}
            </Button>
          </div>
        </div>
      )}

      {/* Customer & Device */}
      <div className="border border-line rounded-md px-4 py-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-xs text-subtle">{t('contract.customer')}</div>
            <div className="font-semibold text-sm flex items-center gap-1">
              <span>{contract.customer_name ?? '—'}</span>
              {contract.customer_name && (
                <button
                  type="button"
                  onClick={() => copyValue('customer', contract.customer_name!)}
                  className="p-0.5 rounded hover:bg-surface-hover transition-colors cursor-pointer text-subtle hover:text-fg"
                  aria-label={t('common.copy')}
                  title={copiedField === 'customer' ? t('common.copied') : t('common.copy')}
                >
                  {copiedField === 'customer' ? <Check size={12} className="text-success" /> : <Copy size={12} />}
                </button>
              )}
            </div>
          </div>
          <div>
            <div className="text-xs text-subtle">{t('contract.branch')}</div>
            <div className="font-semibold text-sm">{contract.branch_name}</div>
          </div>
        </div>
        {(contract.model_name || contract.device_identifier) && (
          <div className="grid grid-cols-2 gap-3 mt-3 pt-3 border-t border-line">
            <div>
              <div className="text-xs text-subtle">{t('contract.device')}</div>
              <div className="text-sm">{contract.variant_name ?? contract.model_name ?? '—'}</div>
            </div>
            {contract.device_identifier && (
              <div>
                <div className="text-xs text-subtle">IMEI</div>
                <div className="text-sm font-mono">{contract.device_identifier}</div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Documents — ID card, signature */}
      <div className="border border-line rounded-md px-4 py-3">
        <div className="flex items-center justify-between gap-2 mb-3">
          <h3 className="text-xs font-semibold text-subtle uppercase tracking-wider">
            {t('contract.documents', { defaultValue: 'Documents' })}
          </h3>
          <Tooltip
            content={printReadiness.ready
              ? t('contract.downloadContractPdf', { defaultValue: 'Download contract PDF' })
              : printReadiness.reasons.join(' · ')}
            placement="top"
          >
            <Button
              size="sm"
              variant="outline"
              startIcon={printingPdf ? <Loader2 size={14} className="animate-spin" /> : <Printer size={14} />}
              endIcon={!printReadiness.ready && !printingPdf ? <AlertTriangle size={14} className="text-warning-fg" /> : undefined}
              onClick={handlePrintPdf}
              disabled={printingPdf}
            >
              {t('contract.printContractPdf', { defaultValue: 'Print contract PDF' })}
            </Button>
          </Tooltip>
        </div>
        <div className="flex flex-wrap gap-4">
          <DocumentPresence
            icon={<IdCard size={14} />}
            label={t('contract.idCard', { defaultValue: 'ID card' })}
            present={!!idCardKey}
          />
          <DocumentPresence
            icon={<Pencil size={14} />}
            label={t('contract.signature', { defaultValue: 'Signature' })}
            present={!!signatureKey}
          />
        </div>
      </div>

      {/* Financial summary */}
      <div className="border border-line rounded-md px-4 py-3">
        <h3 className="text-xs font-semibold text-subtle uppercase tracking-wider mb-3">{t('contract.financials')}</h3>
        <div className="grid grid-cols-2 gap-3">
          <InfoCell label={t('contract.agreedPrice')} value={fmtCurrency(contract.agreed_price)} />
          <InfoCell label={t('contract.downPayment')} value={fmtCurrency(contract.down_payment)} />
          <InfoCell label={t('contract.installmentAmount')} value={fmtCurrency(contract.installment_amount)} />
          <InfoCell
            label={t('contract.termMonths')}
            value={contract.snapshot_term_months ? `${contract.snapshot_term_months} ${t('contract.months')}` : '—'}
          />
          <InfoCell label={t('contract.totalPaid')} value={fmtCurrency(contract.total_paid)} />
          <InfoCell label={t('contract.outstanding')} value={fmtCurrency(contract.outstanding_amount)} highlight={contract.outstanding_amount != null && contract.outstanding_amount > 0} />
          {isFin2 && (
            <>
              <InfoCell label={t('contract.insuranceDeposit')} value={fmtCurrency(contract.insurance_deposit)} />
              <InfoCell label={t('contract.insuranceBalance')} value={fmtCurrency(contract.insurance_balance)} />
            </>
          )}
          {contract.credit_balance != null && contract.credit_balance > 0 && (
            <InfoCell label={t('contract.creditBalance')} value={fmtCurrency(contract.credit_balance)} />
          )}
          {contract.late_fee_balance != null && contract.late_fee_balance > 0 && (
            <InfoCell label={t('contract.lateFee')} value={fmtCurrency(contract.late_fee_balance)} highlight />
          )}
          {contract.discount_amount != null && contract.discount_amount > 0 && (
            <InfoCell label={t('contract.discount')} value={`${fmtCurrency(contract.discount_amount)} (${contract.discount_percent ?? 0}%)`} />
          )}
        </div>
      </div>

      {/* Payment progress */}
      {contract.paid_installment_count != null && contract.total_installments != null && (
        <div className="border border-line rounded-md px-4 py-3">
          <h3 className="text-xs font-semibold text-subtle uppercase tracking-wider mb-3">{t('contract.paymentProgress')}</h3>
          <div className="flex items-center gap-3 mb-2">
            <div className="flex-1 bg-fg/10 rounded-full h-2">
              <div
                className="bg-primary rounded-full h-2 transition-all"
                style={{ width: `${contract.total_installments > 0 ? Math.min(100, (contract.paid_installment_count / contract.total_installments) * 100) : 0}%` }}
              />
            </div>
            <span className="text-sm font-medium tabular-nums shrink-0">
              {contract.paid_installment_count}/{contract.total_installments}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <InfoCell label={t('contract.nextDueDate')} value={contract.next_due_date ? <DateTime value={contract.next_due_date} showTime={false} /> : '—'} />
            <InfoCell label={t('contract.nextDueAmount')} value={fmtCurrency(contract.next_due_amount)} />
            <InfoCell label={t('contract.lastPaymentDate')} value={contract.last_payment_date ? <DateTime value={contract.last_payment_date} showTime={false} /> : '—'} />
            {contract.overdue_count != null && contract.overdue_count > 0 && (
              <InfoCell
                label={t('contract.overdue')}
                value={`${contract.overdue_count} ${t('contract.installments')} · ${fmtCurrency(contract.overdue_amount)}`}
                highlight
              />
            )}
          </div>
          {contract.overdue_days != null && contract.overdue_days > 0 && (
            <div className="mt-2 text-xs text-danger">
              {t('contract.overdueSince', { date: contract.overdue_since_date, days: contract.overdue_days })}
            </div>
          )}
        </div>
      )}

      {/* Saving progress (for SAVING contracts) */}
      {contract.state === 'SAVING' && contract.saving_target_amount != null && (
        <div className="border border-line rounded-md px-4 py-3">
          <h3 className="text-xs font-semibold text-subtle uppercase tracking-wider mb-3">{t('contract.savingProgress')}</h3>
          <div className="flex items-center gap-3 mb-2">
            <div className="flex-1 bg-fg/10 rounded-full h-2">
              <div
                className="bg-info rounded-full h-2 transition-all"
                style={{ width: `${contract.saving_target_amount > 0 ? Math.min(100, ((contract.saving_balance ?? 0) / contract.saving_target_amount) * 100) : 0}%` }}
              />
            </div>
            <span className="text-sm font-medium tabular-nums shrink-0">
              {fmtCurrency(contract.saving_balance)} / {fmtCurrency(contract.saving_target_amount)}
            </span>
          </div>
        </div>
      )}

      {/* Delivery */}
      {isActive && (
        <div className={`border rounded-md px-4 py-3 ${contract.shipped_at ? 'border-line' : 'border-warning/30 bg-warning/5'}`}>
          <div className="flex items-center justify-between mb-2">
            <h3 className={`text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5 ${contract.shipped_at ? 'text-subtle' : 'text-warning-fg'}`}>
              <Truck size={13} />
              {t('contract.shipping')}
            </h3>
            <button
              type="button"
              onClick={() => setDeliveryModalOpen(true)}
              className="p-1 rounded hover:bg-surface-hover transition-colors cursor-pointer text-subtle hover:text-fg bg-transparent border-none"
              title={t('common.edit')}
            >
              <Pencil size={13} />
            </button>
          </div>
          {contract.shipped_at ? (
            <div className="grid grid-cols-2 gap-3">
              <InfoCell label={t('contract.shippedAt')} value={<DateTime value={contract.shipped_at} showTime={false} />} />
              {contract.shipping_method && <InfoCell label={t('contract.shippingMethod')} value={contract.shipping_method} />}
              {contract.tracking_number && <InfoCell label={t('contract.trackingNumber')} value={contract.tracking_number} />}
            </div>
          ) : (
            <div className="text-sm text-warning-fg">{t('contract.deliveryNotRecorded')}</div>
          )}
        </div>
      )}

      {/* Meta info */}
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-subtle pb-4">
        <span>{t('contract.createdBy')}: {contract.created_by_name ?? '—'}</span>
        <span>{t('contract.createdAt')}: <DateTime value={contract.created_at} /></span>
        {contract.activated_at && <span>{t('contract.activatedAt')}: <DateTime value={contract.activated_at} /></span>}
        {contract.closed_at && <span>{t('contract.closedAt')}: <DateTime value={contract.closed_at} /></span>}
        {contract.close_reason && <span>{t('contract.closeReason')}: {contract.close_reason}</span>}
        {contract.commission_owner_name && <span>{t('contract.commissionOwner')}: {contract.commission_owner_name}</span>}
        {contract.last_note && <span>{t('contract.lastNote')}: {contract.last_note}</span>}
      </div>

      {/* Delivery modal */}
      <DeliveryModal
        open={deliveryModalOpen}
        contract={contract}
        onClose={() => setDeliveryModalOpen(false)}
        onSuccess={() => {
          setDeliveryModalOpen(false);
          queryClient.invalidateQueries({ queryKey: ['contract-detail', contract.id] });
        }}
      />

      <GenerateContractPdfModal
        open={pdfModalOpen}
        onClose={() => setPdfModalOpen(false)}
        contract={contract}
      />

      <Modal open={printBlockOpen} onClose={() => setPrintBlockOpen(false)} maxWidth="28rem" width="100%">
        <div className="modal-header">
          <h2 className="modal-title">{t('contract.printBlock_title')}</h2>
        </div>
        <div className="modal-content">
          <div className="alert alert-warning mb-3">
            <AlertTriangle size={16} />
            <span>{t('contract.printBlock_intro')}</span>
          </div>
          <ul className="list-disc pl-5 text-sm flex flex-col gap-1">
            {printBlockReasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
        <div className="modal-footer">
          <Button color="primary" onClick={() => setPrintBlockOpen(false)}>{t('common.close')}</Button>
        </div>
      </Modal>
    </div>
  );
}

// ── Money Tab (wraps Installments / Txns / Payments / Wallets) ───────────────

function MoneyTab({ contractId, contract, t }: {
  contractId: number;
  contract: ContractDetail;
  t: ReturnType<typeof useTranslation>['t'];
}) {
  const [section, setSection] = useState<MoneySection>('installments');

  // Counts for sub-tab badges. Use HEAD (count=exact) so we don't pull rows
  // we won't render.
  const { data: installmentDueCount } = useQuery({
    queryKey: ['contract-installments-due-count', contractId],
    queryFn: async () => {
      const res = await apiClient.getPaginated<Installment>(
        `/v_installments?contract_id=eq.${contractId}&status=in.(PENDING,DUE,OVERDUE)`,
        { page: 1, pageSize: 1 },
      );
      return res.totalCount;
    },
    staleTime: 30 * 1000,
  });

  const { data: txnCount } = useQuery({
    queryKey: ['contract-txns-count', contractId],
    queryFn: async () => {
      const res = await apiClient.getPaginated<ContractTxn>(
        `/v_contract_txns?contract_id=eq.${contractId}`,
        { page: 1, pageSize: 1 },
      );
      return res.totalCount;
    },
    staleTime: 30 * 1000,
  });

  // Bills count — INVOICE only (CREDIT_NOTE/JOURNAL aren't customer-facing).
  const { data: billCount } = useQuery({
    queryKey: ['contract-bills-count', contractId],
    queryFn: async () => {
      const res = await apiClient.getPaginated<{ id: number }>(
        `/v_bills?contract_id=eq.${contractId}&bill_type=eq.INVOICE`,
        { page: 1, pageSize: 1 },
      );
      return res.totalCount;
    },
    staleTime: 30 * 1000,
  });

  const walletNonEmptyCount = [
    contract.saving_balance,
    contract.credit_balance,
    contract.insurance_balance,
  ].filter(b => b != null && b !== 0).length;

  const counts: Record<MoneySection, number | null> = {
    installments: installmentDueCount ?? null,
    txns: txnCount ?? null,
    wallets: walletNonEmptyCount,
    bills: billCount ?? null,
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <ScrollableTabs
        tabs={MONEY_SECTIONS}
        activeTab={section}
        onTabChange={setSection}
        renderLabel={(s) => {
          const c = counts[s];
          const isActive = section === s;
          return (
            <span className="inline-flex items-center gap-1.5">
              {t(`contract.moneySection_${s}`)}
              {c != null && c > 0 && (
                <Badge size="xs" color={isActive ? 'primary' : 'default'}>
                  {c}
                </Badge>
              )}
            </span>
          );
        }}
      />
      <div className="flex-1 overflow-auto better-scroll">
        {section === 'installments' && <InstallmentsTab contractId={contractId} t={t} />}
        {section === 'txns' && <TxnsTab contractId={contractId} t={t} />}
        {section === 'wallets' && <WalletsTab contract={contract} />}
        {section === 'bills' && <BillsTab contractId={contractId} t={t} />}
      </div>
    </div>
  );
}

// ── Installments Tab ─────────────────────────────────────────────────────────

function getInstallmentStatusColor(status: string): 'success' | 'warning' | 'danger' | 'info' | 'default' {
  switch (status) {
    case 'PAID': return 'success';
    case 'PENDING': return 'warning';
    default: return 'default';
  }
}

function InstallmentsTab({ contractId, t }: { contractId: number; t: ReturnType<typeof useTranslation>['t'] }) {
  const { data: installments, isLoading } = useQuery({
    queryKey: ['contract-installments', contractId],
    queryFn: () => apiClient.get<Installment[]>(`/v_installments?contract_id=eq.${contractId}&order=pay_no`),
  });

  if (isLoading) return <div className="p-8 text-center text-subtler">{t('common.loading')}</div>;
  if (!installments || installments.length === 0) return <div className="p-8 text-center text-subtler">{t('common.noData')}</div>;

  return (
    <div className="p-4">
      <div className="border border-line rounded-md overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line bg-surface">
              <th className="text-left px-3 py-2 font-medium text-subtle">#</th>
              <th className="text-left px-3 py-2 font-medium text-subtle">{t('contract.due')}</th>
              <th className="text-right px-3 py-2 font-medium text-subtle">{t('contract.amount')}</th>
              <th className="text-right px-3 py-2 font-medium text-subtle">{t('contract.paid')}</th>
              <th className="text-left px-3 py-2 font-medium text-subtle">{t('common.status')}</th>
            </tr>
          </thead>
          <tbody>
            {installments.map(inst => (
              <tr key={inst.id} className="border-b border-line last:border-b-0">
                <td className="px-3 py-2 tabular-nums">
                  {inst.pay_no}
                  {inst.deferred_from != null && (
                    <span className="text-xs text-subtle ml-1">(→{inst.deferred_from})</span>
                  )}
                </td>
                <td className="px-3 py-2 text-xs text-subtle"><DateTime value={inst.due_date} showTime={false} /></td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtCurrency(inst.due_amount)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtCurrency(inst.paid_amount)}</td>
                <td className="px-3 py-2">
                  <Badge size="xs" color={getInstallmentStatusColor(inst.status)}>
                    {t(`contract.installmentStatus_${inst.status}`, { defaultValue: inst.status })}
                  </Badge>
                  {inst.paid_at && (
                    <div className="text-xs text-subtle mt-0.5"><DateTime value={inst.paid_at} /></div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Transactions Tab ─────────────────────────────────────────────────────────

function TxnsTab({ contractId, t }: { contractId: number; t: ReturnType<typeof useTranslation>['t'] }) {
  const { data: txns, isLoading } = useQuery({
    queryKey: ['contract-txns', contractId],
    queryFn: () => apiClient.get<ContractTxn[]>(`/v_contract_txns?contract_id=eq.${contractId}&order=created_at.desc`),
  });

  if (isLoading) return <div className="p-8 text-center text-subtler">{t('common.loading')}</div>;
  if (!txns || txns.length === 0) return <div className="p-8 text-center text-subtler">{t('common.noData')}</div>;

  return (
    <div className="p-4 flex flex-col gap-2">
      {txns.map(txn => (
        <div key={txn.id} className="border border-line rounded-md px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm">{t(`contract.txnType_${txn.txn_type}`, { defaultValue: txn.txn_type })}</span>
              {txn.pay_no != null && (
                <span className="text-xs text-subtle">#{txn.pay_no}</span>
              )}
            </div>
            <span className={`font-medium text-sm tabular-nums ${txn.amount < 0 ? 'text-danger' : ''}`}>
              {txn.amount > 0 ? '+' : ''}{fmtCurrency(txn.amount)}
            </span>
          </div>
          {txn.note && <div className="text-xs text-subtle mt-1">{txn.note}</div>}
          <div className="flex items-center gap-3 mt-2 text-xs text-subtle">
            <span>{txn.created_by_name}</span>
            <DateTime value={txn.created_at} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Customers Tab ────────────────────────────────────────────────────────────

interface CustomerDetail {
  id: number;
  full_name: string;
  tel: string | null;
  tel2: string | null;
  id_number: string | null;
  prefix: string | null;
}

function CustomersTab({ contractId, customerId, customerName, t, onRequestDetachCustomer }: {
  contractId: number;
  customerId: number | null;
  customerName: string | null;
  t: ReturnType<typeof useTranslation>['t'];
  onRequestDetachCustomer: () => void;
}) {
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();
  const [pickerMode, setPickerMode] = useState<'attach' | 'guarantor' | null>(null);
  const [removeTarget, setRemoveTarget] = useState<ContractCustomer | null>(null);

  // v_contract_customers stores ONLY guarantors today (despite older docs that
  // suggested it'd also include the primary). The primary customer lives on
  // contract.customer_id directly — we get it via props.
  const { data: guarantors, isLoading } = useQuery({
    queryKey: ['contract-customers', contractId],
    queryFn: () => apiClient.get<ContractCustomer[]>(`/v_contract_customers?contract_id=eq.${contractId}&order=created_at`),
  });

  const successSnack = (msg: string) => {
    addSnackbar({
      message: (
        <div className="alert alert-success">
          <CheckCircle size={16} />
          <span>{msg}</span>
        </div>
      ),
    });
  };

  const handleAttach = async (newCustomerId: number, fullName: string) => {
    await apiClient.rpc('fn_contract_attach_customer', {
      p_contract_id: contractId,
      p_customer_id: newCustomerId,
    });
    queryClient.invalidateQueries({ queryKey: ['contract-detail', contractId] });
    successSnack(t('contract.attached_customer', { defaultValue: `Attached ${fullName}`, customer: fullName }));
  };

  const handleAddGuarantor = async (newCustomerId: number, fullName: string) => {
    if (newCustomerId === customerId) {
      throw new Error(t('workspace.guarantorCannotBeSelf', { defaultValue: 'Guarantor cannot be the primary customer' }));
    }
    if ((guarantors ?? []).some(g => g.customer_id === newCustomerId)) {
      throw new Error(t('workspace.guarantorAlreadyAttached', { defaultValue: 'Already a guarantor on this contract' }));
    }
    await apiClient.rpc('fn_contract_add_guarantor', {
      p_contract_id: contractId,
      p_customer_id: newCustomerId,
      p_relation: null,
    });
    queryClient.invalidateQueries({ queryKey: ['contract-customers', contractId] });
    successSnack(t('contract.added_guarantor', { defaultValue: `Added ${fullName} as guarantor`, customer: fullName }));
  };

  // Customer ID card media (primary customer only)
  const { data: idCardMedia = [] } = useQuery({
    queryKey: ['entity-media', 'CUSTOMER', customerId],
    queryFn: () => apiClient.get<EntityMedia[]>(
      `/v_entity_media?entity_type=eq.CUSTOMER&entity_id=eq.${customerId}&usage_type=eq.ID_CARD`
    ),
    enabled: !!customerId,
  });

  // App-login state (username / locked / last_login_at) for the primary customer
  const { data: primaryLogin } = useCustomerLoginInfo(customerId);
  const invalidateLogin = useInvalidateLoginInfo();

  // Pull customer detail for primary + every guarantor — gives us phone + ID number.
  const allCustomerIds = [
    ...(customerId ? [customerId] : []),
    ...((guarantors ?? []).map(c => c.customer_id)),
  ];
  const { data: customerDetails = [] } = useQuery({
    queryKey: ['customer-details', allCustomerIds.join(',')],
    queryFn: () => apiClient.get<CustomerDetail[]>(
      `/v_customers?id=in.(${allCustomerIds.join(',')})&select=id,full_name,tel,tel2,id_number,prefix`,
    ),
    enabled: allCustomerIds.length > 0,
  });
  const detailById = new Map(customerDetails.map(d => [d.id, d]));

  // Login state for primary + every guarantor — one batched query so each row
  // can render its own CustomerLoginCard without N parallel hooks.
  const guarantorIds = (guarantors ?? []).map(c => c.customer_id);
  const { data: customerLogins = [] } = useQuery({
    queryKey: ['customer-logins', allCustomerIds.join(',')],
    queryFn: () => apiClient.get<CustomerLoginInfo[]>(
      `/v_customers?id=in.(${allCustomerIds.join(',')})&select=id,full_name,id_number,tel,username,has_login,last_login_at,failed_login_count,locked_until,is_currently_locked`,
    ),
    enabled: guarantorIds.length > 0,
  });
  const loginById = new Map(customerLogins.map(l => [l.id, l]));

  if (isLoading) return <div className="p-8 text-center text-subtler">{t('common.loading')}</div>;

  const guarantorList = guarantors ?? [];
  const primaryDetail = customerId != null ? detailById.get(customerId) : null;

  const renderGuarantorRow = (c: ContractCustomer) => {
    const d = detailById.get(c.customer_id);
    const login = loginById.get(c.customer_id) ?? null;
    return (
      <div key={c.id} className="border border-line rounded-md px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <Link
              to={`/admin/customers/${c.customer_id}`}
              className="font-medium text-sm inline-flex items-center gap-1 hover:underline"
            >
              <span>{d?.prefix ? `${d.prefix} ` : ''}{c.customer_name}</span>
              <ExternalLink size={12} className="text-subtle" />
            </Link>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-xs text-subtle">
              {d?.tel && (
                <span className="inline-flex items-center gap-1"><Phone size={11} />{d.tel}</span>
              )}
              {d?.id_number && (
                <span className="inline-flex items-center gap-1"><IdCard size={11} />{d.id_number}</span>
              )}
              {c.relation && (
                <span>{t('contract.relation')}: {c.relation}</span>
              )}
            </div>
            <div className="text-xs text-subtler mt-1">
              <DateTime value={c.created_at} />
            </div>
          </div>
          <Tooltip content={t('contract.removeGuarantor', { defaultValue: 'Remove guarantor' })} placement="top">
            <Button
              size="sm"
              variant="outline"
              color="danger"
              className="btn-icon-sm"
              startIcon={<Trash2 size={14} />}
              onClick={() => setRemoveTarget(c)}
            />
          </Tooltip>
        </div>
        {login && (
          <div className="mt-3 pt-3 border-t border-line">
            <CustomerLoginCard
              customer={login}
              onChanged={() => invalidateLogin(login.id)}
              noCard
            />
          </div>
        )}
      </div>
    );
  };

  const renderPrimaryRow = () => {
    if (customerId == null) return null;
    return (
      <div className="border border-line rounded-md px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <Link
              to={`/admin/customers/${customerId}`}
              className="font-medium text-sm inline-flex items-center gap-1 hover:underline"
            >
              <span>{primaryDetail?.prefix ? `${primaryDetail.prefix} ` : ''}{customerName ?? primaryDetail?.full_name ?? '—'}</span>
              <ExternalLink size={12} className="text-subtle" />
            </Link>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-xs text-subtle">
              {primaryDetail?.tel && (
                <span className="inline-flex items-center gap-1"><Phone size={11} />{primaryDetail.tel}</span>
              )}
              {primaryDetail?.id_number && (
                <span className="inline-flex items-center gap-1"><IdCard size={11} />{primaryDetail.id_number}</span>
              )}
            </div>
          </div>
          <Tooltip content={t('contract.detachCustomer', { defaultValue: 'Detach customer' })} placement="top">
            <Button
              size="sm"
              variant="outline"
              color="danger"
              className="btn-icon-sm"
              startIcon={<UserMinus size={14} />}
              onClick={onRequestDetachCustomer}
            />
          </Tooltip>
        </div>
        {idCardMedia.length > 0 && (
          <div className="mt-2 pt-2 border-t border-line">
            <MediaRow label={t('contract.idCard')} media={idCardMedia} />
          </div>
        )}
        {primaryLogin && (
          <div className="mt-3 pt-3 border-t border-line">
            <CustomerLoginCard
              customer={primaryLogin}
              onChanged={() => invalidateLogin(primaryLogin.id)}
              noCard
            />
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="p-4 flex flex-col gap-5">
      {/* Primary customer section */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="text-xs font-semibold uppercase tracking-wider text-subtle">
            {t('contract.primaryCustomer', { defaultValue: 'Primary customer' })}
          </div>
          {customerId == null && (
            <Button
              size="sm"
              variant="outline"
              startIcon={<UserPlus size={14} />}
              onClick={() => setPickerMode('attach')}
            >
              {t('contract.attachCustomer', { defaultValue: 'Attach customer' })}
            </Button>
          )}
        </div>
        {customerId == null ? (
          <div className="text-xs text-subtler border border-dashed border-line rounded-md px-4 py-3">
            {t('contract.noPrimaryCustomer', { defaultValue: 'No primary customer attached' })}
          </div>
        ) : (
          renderPrimaryRow()
        )}
      </div>

      {/* Guarantors section */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="text-xs font-semibold uppercase tracking-wider text-subtle">
            {t('contract.guarantors', { defaultValue: 'Guarantors' })}
            {guarantorList.length > 0 && <span className="ml-1.5 text-fg/40">({guarantorList.length})</span>}
          </div>
          <Button
            size="sm"
            variant="outline"
            startIcon={<UserPlus size={14} />}
            onClick={() => setPickerMode('guarantor')}
          >
            {t('contract.addGuarantor', { defaultValue: 'Add guarantor' })}
          </Button>
        </div>
        {guarantorList.length === 0 ? (
          <div className="text-xs text-subtler border border-dashed border-line rounded-md px-4 py-3">
            {t('contract.noGuarantors', { defaultValue: 'No guarantors yet' })}
          </div>
        ) : (
          guarantorList.map(c => renderGuarantorRow(c))
        )}
      </div>

      <CustomerPickerModal
        open={pickerMode !== null}
        title={
          pickerMode === 'attach'
            ? t('contract.attachCustomer', { defaultValue: 'Attach customer' })
            : t('contract.addGuarantor', { defaultValue: 'Add guarantor' })
        }
        excludeCustomerIds={
          pickerMode === 'attach'
            ? (customerId != null ? [customerId] : [])
            : [
                ...(customerId != null ? [customerId] : []),
                ...guarantorList.map(g => g.customer_id),
              ]
        }
        onClose={() => setPickerMode(null)}
        onPick={async (cid, name) => {
          if (pickerMode === 'attach') await handleAttach(cid, name);
          else if (pickerMode === 'guarantor') await handleAddGuarantor(cid, name);
        }}
      />

      <RemoveGuarantorModal
        target={removeTarget}
        contractId={contractId}
        onClose={() => setRemoveTarget(null)}
        onSuccess={(name) => {
          setRemoveTarget(null);
          queryClient.invalidateQueries({ queryKey: ['contract-customers', contractId] });
          successSnack(t('contract.removed_guarantor', { defaultValue: `Removed ${name}`, customer: name }));
        }}
        t={t}
      />
    </div>
  );
}

// ── Remove guarantor confirm + PIN modal ─────────────────────────────────────

function RemoveGuarantorModal({ target, contractId, onClose, onSuccess, t }: {
  target: ContractCustomer | null;
  contractId: number;
  onClose: () => void;
  onSuccess: (name: string) => void;
  t: ReturnType<typeof useTranslation>['t'];
}) {
  const [pin, setPin] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (target) { setPin(''); setReason(''); setError(''); setSubmitting(false); }
  }, [target]);

  const handleConfirm = async () => {
    if (!target) return;
    setSubmitting(true); setError('');
    try {
      await apiClient.rpc('fn_contract_remove_guarantor', {
        p_contract_id: contractId,
        p_customer_id: target.customer_id,
        p_reason: reason.trim() || null,
        p_pin: pin || null,
      });
      onSuccess(target.customer_name);
    } catch (err) {
      if (err instanceof ApiError) {
        const tr = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
          || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
        setError(tr || err.code || err.message);
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
      setSubmitting(false);
    }
  };

  return (
    <Modal open={!!target} onClose={onClose} maxWidth="28rem" width="100%">
      <div className="flex flex-col overflow-hidden">
        <div className="modal-header">
          <h2 className="modal-title">{t('contract.removeGuarantor', { defaultValue: 'Remove guarantor' })}</h2>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">&times;</button>
        </div>
        <div className="modal-content">
          {error && (
            <div className="alert alert-danger mb-3">
              <XCircle size={16} />
              <span>{error}</span>
            </div>
          )}
          <p className="text-sm mb-4">
            {t('contract.removeGuarantorConfirm', {
              defaultValue: 'Remove {{name}} as guarantor?',
              name: target?.customer_name ?? '',
            })}
          </p>
          <div className="form-grid gap-3">
            <div className="flex flex-col">
              <label className="form-label">{t('contract.reason', { defaultValue: 'Reason (optional)' })}</label>
              <Input value={reason} onChange={(e) => setReason(e.target.value)} className="w-full" />
            </div>
            <BranchPinInput value={pin} onChange={setPin} required />
          </div>
        </div>
        <div className="modal-footer">
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            color="danger"
            onClick={handleConfirm}
            disabled={submitting || pin.length !== 6}
            startIcon={submitting ? <Loader2 size={14} className="animate-spin" /> : undefined}
          >
            {submitting ? t('common.saving') : t('common.remove')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Notes Tab ────────────────────────────────────────────────────────────────

function NotesTab({ contractId, t, dirtyRef }: {
  contractId: number;
  t: ReturnType<typeof useTranslation>['t'];
  dirtyRef?: React.MutableRefObject<boolean>;
}) {
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (dirtyRef) dirtyRef.current = draft.trim().length > 0;
    return () => {
      if (dirtyRef) dirtyRef.current = false;
    };
  }, [draft, dirtyRef]);

  const { data: notes, isLoading } = useQuery({
    queryKey: ['contract-notes', contractId],
    queryFn: () => apiClient.get<ContractNote[]>(`/v_contract_notes?contract_id=eq.${contractId}&order=created_at.desc`),
  });

  const addNote = useMutation({
    mutationFn: (note: string) => apiClient.rpc('fn_contract_add_note', {
      p_contract_id: contractId,
      p_note: note,
    }),
    onSuccess: () => {
      setDraft('');
      setError('');
      queryClient.invalidateQueries({ queryKey: ['contract-notes', contractId] });
      addSnackbar({
        message: (
          <div className="alert alert-success">
            <CheckCircle size={16} />
            <span>{t('contract.note_added', { defaultValue: 'Note added' })}</span>
          </div>
        ),
      });
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        const translated = err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '';
        setError(translated || err.message);
      } else {
        setError(String(err));
      }
    },
  });

  const handleSubmit = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    addNote.mutate(trimmed);
  };

  return (
    <div className="p-4 flex flex-col gap-3">
      <div className="flex flex-col gap-2 pb-4 border-b border-line">
        {error && (
          <div className="alert alert-danger">
            <XCircle size={16} />
            <span>{error}</span>
          </div>
        )}
        <TextArea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t('contract.note_placeholder', { defaultValue: 'Write a note…' })}
          rows={3}
        />
        <div className="flex justify-end">
          <Button
            size="sm"
            color="primary"
            startIcon={<Plus size={14} />}
            disabled={!draft.trim() || addNote.isPending}
            onClick={handleSubmit}
          >
            {addNote.isPending
              ? t('common.loading')
              : t('contract.add_note', { defaultValue: 'Add note' })}
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="p-8 text-center text-subtler">{t('common.loading')}</div>
      ) : !notes || notes.length === 0 ? (
        <div className="p-8 text-center text-subtler">{t('common.noData')}</div>
      ) : (
        <div className="flex flex-col gap-2">
          {notes.map(n => (
            <div key={n.id} className="border border-line rounded-md px-4 py-3">
              <div className="text-sm whitespace-pre-wrap">{n.note}</div>
              <div className="flex items-center gap-3 mt-2 text-xs text-subtle">
                <span>{n.created_by_name}</span>
                <DateTime value={n.created_at} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Bills Tab ────────────────────────────────────────────────────────────────

interface BillRow {
  id: number;
  code_display: string;
  bill_purpose: string;
  bill_purpose_label: string | null;
  bill_type: string;
  bill_type_label_short: string | null;
  total_amount: number;
  paid_amount: number;
  status: string;
  bill_date: string;
  is_cancelled: boolean;
}

function getBillStatusColor(status: string, isCancelled: boolean): 'success' | 'warning' | 'danger' | 'default' {
  if (isCancelled) return 'danger';
  switch (status) {
    case 'PAID': return 'success';
    case 'OPEN': return 'warning';
    case 'VOIDED': return 'danger';
    default: return 'default';
  }
}

interface BillPaymentEmbedded {
  id: number;
  code_display: string | null;
  method: string | null;
  amount: number;
  bank_name: string | null;
  account_number: string | null;
  reference: string | null;
  is_reversal: boolean;
  ref_voided_id: number | null;
  void_note: string | null;
  bank_account_id: number | null;
  created_at: string;
  created_by: number | null;
  created_by_name: string | null;
}

function BillsTab({ contractId, t }: { contractId: number; t: ReturnType<typeof useTranslation>['t'] }) {
  const queryClient = useQueryClient();

  // Bill list (INVOICE only — CREDIT_NOTE/JOURNAL aren't shown here).
  const { data: bills, isLoading } = useQuery({
    queryKey: ['contract-bills', contractId],
    queryFn: () => apiClient.get<BillRow[]>(
      `/v_bills?contract_id=eq.${contractId}&bill_type=eq.INVOICE&order=created_at.desc`,
    ),
  });

  // Payments embedded per bill via v_bill_detail. One query per bill keeps each
  // row cacheable for the print path (which fetches the same key).
  const billIds = bills?.map(b => b.id) ?? [];
  const billIdsKey = billIds.join(',');
  const { data: paymentsByBill } = useQuery<Record<number, BillPaymentEmbedded[]>>({
    queryKey: ['contract-bill-payments', contractId, billIdsKey],
    enabled: billIds.length > 0,
    queryFn: async () => {
      // PostgREST in.(...) — single round trip for all bills on this contract.
      const rows = await apiClient.get<Array<{ bill_id: number; payments: BillPaymentEmbedded[] | null }>>(
        `/v_bill_detail?bill_id=in.(${billIdsKey})`,
      );
      const out: Record<number, BillPaymentEmbedded[]> = {};
      for (const r of rows) out[r.bill_id] = r.payments ?? [];
      return out;
    },
  });

  // Payment slips — currently linked to CONTRACT (not bill_payment yet).
  // Show as a chronological strip on top until backend adds the FK.
  const { data: paymentSlips = [] } = useQuery({
    queryKey: ['entity-media', 'CONTRACT', contractId, 'PAYMENT_SLIP'],
    queryFn: () => apiClient.get<EntityMedia[]>(
      `/v_entity_media?entity_type=eq.CONTRACT&entity_id=eq.${contractId}&usage_type=eq.PAYMENT_SLIP&order=sort_order`,
    ),
  });

  // Print: render receipt off-screen and call window.print().
  // No modal — tsp-form Modal portals into a fixed/overflow-hidden container
  // that doesn't translate to the @page box, so the receipt gets clipped.
  const [printBillId, setPrintBillId] = useState<number | null>(null);
  const [printReady, setPrintReady] = useState(false);
  const handlePrint = useCallback(async (billId: number) => {
    setPrintBillId(billId);
    try {
      const billRows = await queryClient.fetchQuery({
        queryKey: ['bill-detail', billId],
        queryFn: () => apiClient.get<unknown[]>(`/v_bill_detail?bill_id=eq.${billId}`).then(rows => rows[0] ?? null),
      });
      const branchId = (billRows as { branch_id?: number } | null)?.branch_id;
      if (branchId != null) {
        await queryClient.fetchQuery({
          queryKey: ['branch-info', branchId],
          queryFn: () => apiClient.get(`/v_branches?id=eq.${branchId}&select=id,name,address`).then((rows: unknown) => (rows as unknown[])[0] ?? null),
        });
      }
    } catch {
      // Fall through — receipt will show its loading state and still print empty if data fails.
    }
    setPrintReady(true);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      window.print();
      setPrintReady(false);
      setPrintBillId(null);
    }));
  }, [queryClient]);

  if (isLoading) return <div className="p-8 text-center text-subtler">{t('common.loading')}</div>;
  if (!bills || bills.length === 0) return <div className="p-8 text-center text-subtler">{t('common.noData')}</div>;

  return (
    <div className="p-4 flex flex-col gap-4">
      {paymentSlips.length > 0 && (
        <div className="border border-line rounded-md px-4 py-3">
          <MediaRow label={t('contract.paymentSlips')} media={paymentSlips} />
        </div>
      )}

      <div className="flex flex-col gap-2">
        {bills.map(bill => {
          const payments = paymentsByBill?.[bill.id] ?? [];
          return (
            <div
              key={bill.id}
              className={`border border-line rounded-md px-4 py-3 ${bill.is_cancelled ? 'opacity-60' : ''}`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <Link
                    to={`/admin/accounting/bills/${bill.id}`}
                    className="font-mono text-xs text-primary-fg inline-flex items-center gap-1 no-underline hover:underline"
                  >
                    {bill.code_display}
                    <ExternalLink size={12} />
                  </Link>
                  <Badge size="xs" color={getBillStatusColor(bill.status, bill.is_cancelled)}>
                    {bill.is_cancelled
                      ? t('contract.billStatus_CANCELLED', { defaultValue: 'Cancelled' })
                      : t(`contract.billStatus_${bill.status}`, { defaultValue: bill.status })}
                  </Badge>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Tooltip content={t('wizard.receipt_print')}>
                    <Button
                      variant="outline"
                      color="default"
                      size="sm"
                      className="btn-icon-xs"
                      onClick={() => handlePrint(bill.id)}
                      aria-label={t('wizard.receipt_print')}
                    >
                      <Printer size={14} />
                    </Button>
                  </Tooltip>
                </div>
              </div>
              <div className="flex items-center justify-between gap-3 mt-2">
                <div className="min-w-0">
                  <div className="text-sm">{bill.bill_purpose_label ?? bill.bill_purpose}</div>
                  {bill.bill_type_label_short && (
                    <div className="text-xs text-subtle">{bill.bill_type_label_short}</div>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-medium tabular-nums">{fmtCurrency(bill.total_amount)}</div>
                  <div className="text-xs text-subtle"><DateTime value={bill.bill_date} showTime={false} /></div>
                </div>
              </div>

              {payments.length > 0 && (
                <div className="mt-3 pt-3 border-t border-line flex flex-col gap-1.5">
                  {payments.map(p => (
                    <div
                      key={p.id}
                      className={`flex items-center justify-between gap-3 text-xs ${p.is_reversal ? 'opacity-50 line-through' : ''}`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-subtle">└</span>
                        <span>{p.method ? t(`wizard.method_${p.method}`, { defaultValue: p.method }) : '—'}</span>
                        {p.bank_name && <span className="text-subtle">{p.bank_name}</span>}
                        {p.reference && <span className="text-subtle font-mono">{p.reference}</span>}
                        {p.is_reversal && (
                          <Badge size="xs" color="danger">VOID</Badge>
                        )}
                      </div>
                      <span className="tabular-nums shrink-0">{fmtCurrency(p.amount)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {printReady && printBillId != null && createPortal(
        <div className="print-only-receipt" aria-hidden>
          <BillReceipt billId={printBillId} hidePrintButton />
        </div>,
        document.body,
      )}
    </div>
  );
}

// ── Delivery Modal ──────────────────────────────────────────────────────────

const SHIPPING_OPTIONS = [
  { value: 'PICKUP', label: 'Pickup at store' },
  { value: 'DELIVERY', label: 'Delivery' },
  { value: 'COURIER', label: 'Courier / Shipping' },
];

function DeliveryModal({ open, contract, onClose, onSuccess }: {
  open: boolean;
  contract: ContractDetail;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { t } = useTranslation();
  const { addSnackbar } = useSnackbarContext();
  const { user } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [method, setMethod] = useState(contract.shipping_method ?? 'PICKUP');
  const [trackingNumber, setTrackingNumber] = useState(contract.tracking_number ?? '');
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [lightboxKey, setLightboxKey] = useState<string | null>(null);
  const [lightboxAlt, setLightboxAlt] = useState<string>('');
  const [removingId, setRemovingId] = useState<number | null>(null);

  useEffect(() => {
    if (open) {
      setMethod(contract.shipping_method ?? 'PICKUP');
      setTrackingNumber(contract.tracking_number ?? '');
      setError('');
    }
  }, [open, contract.shipping_method, contract.tracking_number]);

  // Contract photos (ATTACHMENT)
  const { data: photos = [], refetch: refetchPhotos } = useQuery({
    queryKey: ['contract-media', contract.id],
    queryFn: () => apiClient.get<EntityMedia[]>(
      `/v_entity_media?entity_type=eq.CONTRACT&entity_id=eq.${contract.id}&usage_type=eq.ATTACHMENT&order=sort_order`
    ),
    enabled: open,
  });

  const handleRemovePhoto = async (m: EntityMedia) => {
    setRemovingId(m.entity_media_id);
    setError('');
    try {
      // Detach DB row first — source of truth. R2 cleanup after, best-effort.
      await apiClient.rpc('fn_media_detach', { p_entity_media_id: m.entity_media_id });
      const keys: string[] = [];
      if (m.storage_path) keys.push(m.storage_path);
      for (const v of Object.values(m.variants_json ?? {})) {
        if (typeof v === 'string' && v) keys.push(v);
      }
      if (keys.length > 0) {
        deleteMedia(keys).catch(() => {});
      }
      refetchPhotos();
    } catch (err) {
      if (err instanceof ApiError) {
        const translated = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
          || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
        setError(translated || err.message);
      } else {
        setError(String(err));
      }
    } finally {
      setRemovingId(null);
    }
  };

  const mutation = useMutation({
    mutationFn: () => apiClient.rpc('fn_contract_update_delivery', {
      p_contract_id: contract.id,
      p_shipping_method: method,
      p_tracking_number: trackingNumber.trim() || null,
      p_shipped_at: contract.shipped_at ?? new Date().toISOString(),
    }),
    onSuccess: () => {
      addSnackbar({
        message: <div className="alert alert-success"><CheckCircle size={16} /><span>{t('contract.deliverySaved')}</span></div>,
      });
      onSuccess();
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        const translated = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
          || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
        setError(translated || err.message);
      } else setError(String(err));
    },
  });

  const handleUploadPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !user) return;
    setUploading(true);
    try {
      const spec = await getUploadSpec('contract_evidence');
      // Build resized variants matching the spec's sizes.
      const resize = specToResize(spec)!;
      const img = new Image();
      const url = URL.createObjectURL(file);
      const variants = await new Promise<Record<string, File>>((resolve) => {
        img.onload = async () => {
          URL.revokeObjectURL(url);
          const out: Record<string, File> = {};
          for (const sz of spec.sizes) {
            const maxW = sz.width, maxH = sz.width;
            let w = img.width, h = img.height;
            if (w > maxW || h > maxH) {
              const ratio = Math.min(maxW / w, maxH / h);
              w = Math.round(w * ratio); h = Math.round(h * ratio);
            }
            const canvas = document.createElement('canvas');
            canvas.width = w; canvas.height = h;
            canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
            const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, 'image/webp', spec.quality));
            if (blob) out[sz.label] = new File([blob], file.name, { type: 'image/webp' });
          }
          resolve(out);
        };
        img.src = url;
      });
      void resize;

      const fakeImage = {
        id: Math.random().toString(36).slice(2),
        originalFile: file,
        originalWidth: img.width, originalHeight: img.height, originalSize: file.size,
        file: variants.sm ?? variants.md ?? Object.values(variants)[0],
        variants: Object.fromEntries(
          Object.entries(variants).map(([k, f]) => [k, { file: f, preview: '', width: 0, height: 0, size: f.size }]),
        ),
      };
      const results = await uploadFromImage({
        type: 'contract_evidence',
        image: fakeImage as any, // eslint-disable-line @typescript-eslint/no-explicit-any
        idx: photos.length,
        params: { contract_id: contract.id },
      });
      const primary = results.sm?.key ?? Object.values(results)[0]?.key;
      if (!primary) throw new Error('Upload returned no key');
      // Private media — backend chk_media_variants_keys requires variant
      // values to be PUBLIC paths regardless of access_level, so pass null.
      await apiClient.rpc('fn_media_attach', {
        p_holding_id: user.holding_id,
        p_storage_path: toStoragePath(primary),
        p_variants_json: null,
        p_media_type: 'IMAGE',
        p_access_level: 'CONFIDENTIAL',
        p_mime_type: 'image/webp',
        p_file_size_bytes: (variants.sm ?? Object.values(variants)[0]).size,
        p_original_filename: file.name,
        p_entity_type: 'CONTRACT',
        p_entity_id: contract.id,
        p_usage_type: 'ATTACHMENT',
        p_sort_order: 0,
        p_caption: null,
      });
      refetchPhotos();
    } catch {
      setError(t('contract.uploadFailed'));
    } finally {
      setUploading(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} maxWidth="32rem" width="100%">
      <div className="flex flex-col overflow-hidden">
        <div className="modal-header">
          <h2 className="modal-title">{t('contract.shipping')}</h2>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">&times;</button>
        </div>
        <div className="modal-content">
          {error && (
            <div className="alert alert-danger mb-4">
              <XCircle size={16} />
              <span>{error}</span>
            </div>
          )}
          <div className="form-grid">
            <div className="flex flex-col">
              <label className="form-label">{t('contract.shippingMethod')}</label>
              <Select options={SHIPPING_OPTIONS} value={method} onChange={(val) => setMethod(val as string)} showChevron />
            </div>
            {method !== 'PICKUP' && (
              <div className="flex flex-col">
                <label className="form-label">{t('contract.trackingNumber')}</label>
                <Input value={trackingNumber} onChange={(e) => setTrackingNumber(e.target.value)} placeholder={t('contract.trackingPlaceholder')} className="w-full" />
              </div>
            )}
          </div>

          {/* Contract photos */}
          <div className="mt-5 pt-4 border-t border-line">
            <label className="form-label flex items-center gap-1.5">
              <Camera size={14} />
              {t('contract.deliveryPhotos')}
            </label>
            <div className="flex flex-wrap gap-2 mt-2">
              {photos.map(m => {
                const v = m.variants_json ?? {};
                const fullKey = v.original || v.lg || v.md || v.medium || m.storage_path;
                return (
                  <DeliveryPhotoThumb
                    key={m.entity_media_id}
                    media={m}
                    disabled={removingId === m.entity_media_id}
                    onPreview={() => {
                      if (fullKey) {
                        setLightboxKey(normalizeKey(fullKey));
                        setLightboxAlt(m.caption ?? '');
                      }
                    }}
                    onRemove={() => handleRemovePhoto(m)}
                  />
                );
              })}
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleUploadPhoto} />
              <button
                type="button"
                className="w-20 h-20 flex flex-col items-center justify-center gap-1 rounded border-2 border-dashed border-line hover:border-primary hover:bg-surface-hover transition-colors cursor-pointer text-subtle bg-transparent"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
              >
                {uploading
                  ? <Loader2 size={16} className="animate-spin" />
                  : <><Upload size={16} /><span className="text-[10px]">{t('common.add')}</span></>
                }
              </button>
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            color="primary"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            startIcon={mutation.isPending ? <Loader2 size={16} className="animate-spin" /> : undefined}
          >
            {mutation.isPending ? t('common.loading') : t('common.save')}
          </Button>
        </div>
      </div>
      <MediaLightbox
        open={lightboxKey != null}
        onClose={() => setLightboxKey(null)}
        mediaKey={lightboxKey}
        alt={lightboxAlt}
      />
    </Modal>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function InfoCell({ label, value, highlight }: { label: string; value: React.ReactNode; highlight?: boolean }) {
  return (
    <div>
      <div className="text-xs text-subtle">{label}</div>
      <div className={`text-sm font-medium tabular-nums ${highlight ? 'text-danger' : ''}`}>{value}</div>
    </div>
  );
}

function DocumentPresence({
  icon,
  label,
  present,
}: {
  icon: React.ReactNode;
  label: string;
  present: boolean;
}) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded border border-line bg-surface-shallow">
      <span className="text-subtle shrink-0">{icon}</span>
      <span className="text-sm">{label}</span>
      {present
        ? <CheckCircle size={14} className="text-success-fg shrink-0" />
        : <XCircle size={14} className="text-subtler shrink-0" />}
    </div>
  );
}
