import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { PageNav, PageNavPanel, Badge, Select, Button, Input, Modal, useSnackbarContext } from 'tsp-form';
import { ArrowRightFromLine, CheckCircle, XCircle, Package, PackagePlus } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';

// ============================================================================
// Types
// ============================================================================

interface PurchaseOrder {
  po_id: number;
  po_no: string;
  po_type: string;
  status: string;
  supplier_name: string;
  branch_id: number;
  total_lines: number;
  completed_intakes: number;
  created_at: string;
}

interface PoLine {
  po_line_id: number;
  po_id: number;
  po_no: string;
  branch_id: number;
  variant_id: number;
  model_id: number;
  variant_name: string;
  model_name: string;
  variant_sku_code: string;
  qty: number;
  unit_cost: number;
  line_total: number;
  asset_intake_status: string;
}

interface StockLot {
  lot_id: number;
  lot_code: string;
  current_bucket: string;
  qty_received: number;
  qty_on_hand: number;
  qty_consumed: number;
  unit_cost: number;
  on_hand_value: number;
  is_closed: boolean;
  variant_id: number;
  model_id: number;
  variant_name: string;
  model_name: string;
  po_id: number;
  branch_id: number;
  created_at: string;
}

interface Asset {
  asset_id: number;
  asset_code: string;
  serial_no: string | null;
  imei: string | null;
  intake_condition: string;
  variant_name: string;
  created_at: string;
}

// ============================================================================
// Helpers
// ============================================================================

function fmtNum(n: number): string {
  return n.toLocaleString();
}

function fmtCurrency(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const CONDITION_OPTIONS = [
  { value: 'NEW', label: 'New' },
  { value: 'REFURBISHED', label: 'Refurbished' },
  { value: 'USED_A', label: 'Used A' },
  { value: 'USED_B', label: 'Used B' },
];

const STATUS_BADGE: Record<string, string> = {
  PENDING: 'bg-warning/15 text-warning',
  COMPLETED: 'bg-success/15 text-success',
};

// ============================================================================
// Component
// ============================================================================

export function ReceivingPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();

  const [selectedPoId, setSelectedPoId] = useState<number | null>(null);
  const [selectedLineId, setSelectedLineId] = useState<number | null>(null);

  // Receive lot form state
  const [lotCode, setLotCode] = useState('');
  const [intakeCondition, setIntakeCondition] = useState<string>('NEW');
  const [receiveError, setReceiveError] = useState('');

  // Convert modal state
  const [convertOpen, setConvertOpen] = useState(false);
  const [serialNumber, setSerialNumber] = useState('');
  const [imei, setImei] = useState('');
  const [convertCondition, setConvertCondition] = useState<string>('NEW');
  const [convertError, setConvertError] = useState('');

  // ── Queries ──────────────────────────────────────────────────────────────

  const { data: purchaseOrders } = useQuery({
    queryKey: ['purchase-orders'],
    queryFn: () => apiClient.get<PurchaseOrder[]>('/v_purchase_orders?po_type=eq.PURCHASE&order=created_at.desc'),
  });

  const { data: poLines, isLoading: linesLoading } = useQuery({
    queryKey: ['po-lines', selectedPoId],
    queryFn: () => apiClient.get<PoLine[]>(
      selectedPoId
        ? `/v_po_lines?po_id=eq.${selectedPoId}&po_type=eq.PURCHASE&order=po_line_id`
        : '/v_po_lines?po_type=eq.PURCHASE&order=po_line_id'
    ),
  });

  const selectedLine = poLines?.find(l => l.po_line_id === selectedLineId) ?? null;

  // Lot for the selected PO line (match by po_id + variant_id)
  const { data: lots } = useQuery({
    queryKey: ['lots-for-line', selectedLine?.po_id, selectedLine?.variant_id],
    queryFn: () => apiClient.get<StockLot[]>(
      `/v_stock_lots?po_id=eq.${selectedLine!.po_id}&variant_id=eq.${selectedLine!.variant_id}&order=lot_id.desc`
    ),
    enabled: !!selectedLine,
  });

  const lot = lots?.[0] ?? null;

  // Assets from lot
  const { data: lotAssets } = useQuery({
    queryKey: ['lot-assets', lot?.lot_id],
    queryFn: () => apiClient.get<Asset[]>(
      `/v_assets?source_lot_id=eq.${lot!.lot_id}&order=asset_id.desc`
    ),
    enabled: !!lot,
  });

  // ── Mutations ────────────────────────────────────────────────────────────

  const receiveLotMutation = useMutation({
    mutationFn: (params: { p_receipt_line_id: number; p_lot_code: string; p_intake_condition: string; p_branch_id: number }) =>
      apiClient.rpc('fn_inv_receive_lot', params),
    onSuccess: () => {
      setReceiveError('');
      setLotCode('');
      queryClient.invalidateQueries({ queryKey: ['po-lines'] });
      queryClient.invalidateQueries({ queryKey: ['lots-for-line'] });
      addSnackbar({
        message: (
          <div className="alert alert-success">
            <CheckCircle size={16} />
            <span>{t('receiving.lotReceived')}</span>
          </div>
        ),
      });
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        const translated = err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '';
        setReceiveError(translated || err.message);
      } else {
        setReceiveError(String(err));
      }
    },
  });

  const convertAssetMutation = useMutation({
    mutationFn: (params: {
      p_lot_id: number;
      p_variant_id: number;
      p_identifiers: { type: string; value: string }[];
      p_intake_condition: string;
      p_branch_id: number;
    }) => apiClient.rpc('fn_inv_convert_lot_to_asset', params),
    onSuccess: () => {
      setConvertError('');
      setSerialNumber('');
      setImei('');
      setConvertOpen(false);
      queryClient.invalidateQueries({ queryKey: ['lots-for-line'] });
      queryClient.invalidateQueries({ queryKey: ['lot-assets'] });
      addSnackbar({
        message: (
          <div className="alert alert-success">
            <CheckCircle size={16} />
            <span>{t('receiving.assetRegistered')}</span>
          </div>
        ),
      });
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        const translated = err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '';
        setConvertError(translated || err.message);
      } else {
        setConvertError(String(err));
      }
    },
  });

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleReceiveLot = () => {
    if (!selectedLine || !lotCode.trim()) return;
    setReceiveError('');
    receiveLotMutation.mutate({
      p_receipt_line_id: selectedLine.po_line_id,
      p_lot_code: lotCode.trim(),
      p_intake_condition: intakeCondition,
      p_branch_id: selectedLine.branch_id,
    });
  };

  const handleConvertAsset = () => {
    if (!lot || !serialNumber.trim()) return;
    setConvertError('');
    const identifiers: { type: string; value: string }[] = [
      { type: 'SERIAL_NO', value: serialNumber.trim() },
    ];
    if (imei.trim()) {
      identifiers.push({ type: 'IMEI', value: imei.trim() });
    }
    convertAssetMutation.mutate({
      p_lot_id: lot.lot_id,
      p_variant_id: lot.variant_id,
      p_identifiers: identifiers,
      p_intake_condition: convertCondition,
      p_branch_id: lot.branch_id,
    });
  };

  // ── PO options ───────────────────────────────────────────────────────────

  const poOptions = useMemo(() => {
    if (!purchaseOrders) return [];
    return purchaseOrders.map(po => ({
      value: String(po.po_id),
      label: `${po.po_no} — ${po.supplier_name}`,
    }));
  }, [purchaseOrders]);

  // ── Detail title ─────────────────────────────────────────────────────────

  const detailTitle = selectedLine
    ? `${selectedLine.variant_name}`
    : '';

  return (
    <PageNav panels={['list', 'detail']} className="h-full">
      {({ isMobile, isRoot, goTo, Header }) => (
        <>
          {isMobile && (
            <Header
              title={isRoot ? t('receiving.title') : detailTitle}
              startContent={
                isRoot ? (
                  <button
                    className="flex items-center justify-center w-12 h-12 cursor-pointer hover:bg-surface-hover transition-colors"
                    onClick={() => window.dispatchEvent(new CustomEvent('sidemenu:open'))}
                  >
                    <ArrowRightFromLine size={18} />
                  </button>
                ) : undefined
              }
            />
          )}

          {!isMobile && (
            <div className="flex-none px-4 py-2.5 border-b border-line flex items-center gap-4">
              <h1 className="heading-2 shrink-0">{t('receiving.title')}</h1>
            </div>
          )}

          <div className={isMobile ? 'pagenav-panels' : 'flex flex-1 min-h-0'}>
            {/* ── Left Panel: PO Line List ── */}
            <PageNavPanel id="list" className="w-1/2 xl:w-5/12 border-r border-line overflow-y-auto better-scroll">
              {/* Filter bar */}
              <div className="panel-header sticky top-0 z-10 bg-surface flex gap-2">
                <div style={{ width: '100%' }}>
                  <Select
                    options={poOptions}
                    value={selectedPoId !== null ? String(selectedPoId) : null}
                    onChange={(val) => {
                      setSelectedPoId(val ? Number(val) : null);
                      setSelectedLineId(null);
                    }}
                    placeholder={t('receiving.allPos')}
                    size="sm"
                    showChevron
                    clearable
                  />
                </div>
              </div>

              {linesLoading && (
                <div className="text-center text-control-label py-8">{t('common.loading')}</div>
              )}

              {!linesLoading && (!poLines || poLines.length === 0) && (
                <div className="text-center text-control-label py-8">{t('common.noData')}</div>
              )}

              {poLines?.map(line => {
                const isSelected = selectedLineId === line.po_line_id;
                return (
                  <button
                    key={line.po_line_id}
                    className={`w-full text-left px-4 py-2.5 border-b border-line flex items-center gap-3 transition-colors cursor-pointer ${
                      isSelected ? 'bg-primary/10' : 'hover:bg-surface-hover'
                    }`}
                    onClick={() => {
                      setSelectedLineId(line.po_line_id);
                      setReceiveError('');
                      if (isMobile) goTo('detail');
                    }}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">{line.variant_name}</div>
                      <div className="text-xs text-control-label truncate">{line.po_no}</div>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge size="xs" className={STATUS_BADGE[line.asset_intake_status] ?? 'bg-fg/10 text-fg/60'}>
                          {line.asset_intake_status}
                        </Badge>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-medium tabular-nums">{fmtNum(line.qty)} pcs</div>
                      <div className="text-xs text-control-label tabular-nums">{fmtCurrency(line.unit_cost)}</div>
                    </div>
                  </button>
                );
              })}
            </PageNavPanel>

            {/* ── Right Panel: Receive & Convert ── */}
            <PageNavPanel id="detail" className="flex-1 overflow-y-auto better-scroll">
              {selectedLine ? (
                <DetailPanel
                  line={selectedLine}
                  lot={lot}
                  lotAssets={lotAssets ?? []}
                  receiveError={receiveError}
                  lotCode={lotCode}
                  setLotCode={setLotCode}
                  intakeCondition={intakeCondition}
                  setIntakeCondition={setIntakeCondition}
                  onReceiveLot={handleReceiveLot}
                  receiving={receiveLotMutation.isPending}
                  onOpenConvert={() => {
                    setConvertError('');
                    setSerialNumber('');
                    setImei('');
                    setConvertCondition(intakeCondition);
                    setConvertOpen(true);
                  }}
                  isMobile={isMobile}
                  t={t}
                />
              ) : (
                <div className="flex-1 h-full flex items-center justify-center text-control-label">
                  {t('receiving.noSelection')}
                </div>
              )}
            </PageNavPanel>
          </div>

          {/* ── Convert to Asset Modal ── */}
          <Modal open={convertOpen} onClose={() => setConvertOpen(false)} maxWidth="28rem" width="100%">
            <div className="flex flex-col overflow-hidden">
              <div className="modal-header">
                <h2 className="modal-title">{t('receiving.convertTitle')}</h2>
                <button type="button" className="modal-close-btn" onClick={() => setConvertOpen(false)} aria-label="Close">&times;</button>
              </div>
              <div className="modal-content">
                <div className="form-grid">
                  {convertError && (
                    <div className="alert alert-danger">
                      <XCircle size={16} />
                      <span>{convertError}</span>
                    </div>
                  )}
                  <div className="flex flex-col">
                    <label className="form-label">{t('receiving.serialNumber')}</label>
                    <Input
                      value={serialNumber}
                      onChange={(e) => setSerialNumber(e.target.value)}
                      placeholder={t('receiving.enterSerial')}
                    />
                  </div>
                  <div className="flex flex-col">
                    <label className="form-label">{t('receiving.imei')}</label>
                    <Input
                      value={imei}
                      onChange={(e) => setImei(e.target.value)}
                      placeholder={t('receiving.enterImei')}
                    />
                  </div>
                  <div className="flex flex-col">
                    <label className="form-label">{t('receiving.intakeCondition')}</label>
                    <div>
                      <Select
                        options={CONDITION_OPTIONS}
                        value={convertCondition}
                        onChange={(val) => setConvertCondition((val as string) ?? 'NEW')}
                        showChevron
                      />
                    </div>
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <Button variant="ghost" onClick={() => setConvertOpen(false)}>
                  {t('common.cancel')}
                </Button>
                <Button
                  variant="primary"
                  onClick={handleConvertAsset}
                  disabled={!serialNumber.trim() || convertAssetMutation.isPending}
                >
                  {convertAssetMutation.isPending ? t('common.loading') : t('receiving.registerAsset')}
                </Button>
              </div>
            </div>
          </Modal>
        </>
      )}
    </PageNav>
  );
}

// ============================================================================
// Detail Panel
// ============================================================================

function DetailPanel({
  line,
  lot,
  lotAssets,
  receiveError,
  lotCode,
  setLotCode,
  intakeCondition,
  setIntakeCondition,
  onReceiveLot,
  receiving,
  onOpenConvert,
  isMobile,
  t,
}: {
  line: PoLine;
  lot: StockLot | null;
  lotAssets: Asset[];
  receiveError: string;
  lotCode: string;
  setLotCode: (v: string) => void;
  intakeCondition: string;
  setIntakeCondition: (v: string) => void;
  onReceiveLot: () => void;
  receiving: boolean;
  onOpenConvert: () => void;
  isMobile: boolean;
  t: (key: string) => string;
}) {
  return (
    <div className="flex flex-col h-full">
      {/* Desktop detail header */}
      {!isMobile && (
        <div className="panel-header gap-2">
          <span className="font-semibold">{line.variant_name}</span>
          <Badge size="xs" className={STATUS_BADGE[line.asset_intake_status] ?? 'bg-fg/10 text-fg/60'}>
            {line.asset_intake_status}
          </Badge>
        </div>
      )}

      {/* PO Line info */}
      <div className="flex-none grid grid-cols-3 gap-3 px-4 py-3 border-b border-line bg-surface">
        <div>
          <div className="text-xs text-control-label">{t('receiving.poLine')}</div>
          <div className="font-semibold text-sm">{line.po_no}</div>
          <div className="text-xs text-control-label">{line.model_name}</div>
        </div>
        <div>
          <div className="text-xs text-control-label">{t('receiving.qtyReceived')}</div>
          <div className="font-semibold tabular-nums">{fmtNum(line.qty)}</div>
          <div className="text-xs text-control-label tabular-nums">@ {fmtCurrency(line.unit_cost)}</div>
        </div>
        <div>
          <div className="text-xs text-control-label">{t('inventory.totalValue')}</div>
          <div className="font-semibold tabular-nums">{fmtCurrency(line.qty * line.unit_cost)}</div>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-auto better-scroll p-4 flex flex-col gap-5">
        {/* Section A: Receive Lot (no lot yet for this line) */}
        {!lot && (
          <div>
            <h3 className="text-xs font-semibold text-control-label uppercase tracking-wider mb-3">
              <Package size={14} className="inline mr-1" />
              {t('receiving.receiveLot')}
            </h3>

            {receiveError && (
              <div className="alert alert-danger mb-3">
                <XCircle size={16} />
                <span>{receiveError}</span>
              </div>
            )}

            <div className="form-grid gap-3">
              <div className="flex flex-col">
                <label className="form-label">{t('receiving.lotCode')}</label>
                <Input
                  value={lotCode}
                  onChange={(e) => setLotCode(e.target.value)}
                  placeholder={t('receiving.enterLotCode')}
                />
              </div>
              <div className="flex flex-col">
                <label className="form-label">{t('receiving.intakeCondition')}</label>
                <div>
                  <Select
                    options={CONDITION_OPTIONS}
                    value={intakeCondition}
                    onChange={(val) => setIntakeCondition((val as string) ?? 'NEW')}
                    size="sm"
                    showChevron
                  />
                </div>
              </div>
              <div>
                <Button
                  variant="primary"
                  onClick={onReceiveLot}
                  disabled={!lotCode.trim() || receiving}
                >
                  {receiving ? t('common.loading') : t('receiving.receiveLot')}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Section B: Lot status + Convert to Asset */}
        {lot && (
          <>
            <div>
              <h3 className="text-xs font-semibold text-control-label uppercase tracking-wider mb-3">
                <Package size={14} className="inline mr-1" />
                {t('receiving.lotInfo')}
              </h3>
              <div className="border border-line rounded-md p-3 bg-surface">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-sm">{lot.lot_code}</span>
                  <Badge size="xs" className={lot.qty_on_hand === 0 ? 'bg-fg/10 text-fg/60' : 'bg-success/15 text-success'}>
                    {lot.qty_on_hand === 0 ? t('receiving.depleted') : `${t('receiving.qtyOnHand')}: ${lot.qty_on_hand}`}
                  </Badge>
                </div>

                {/* Progress bar */}
                <div className="mb-2">
                  <div className="flex justify-between text-xs text-control-label mb-1">
                    <span>{t('receiving.qtyConverted')}: {fmtNum(lot.qty_consumed)}</span>
                    <span>{t('receiving.qtyReceived')}: {fmtNum(lot.qty_received)}</span>
                  </div>
                  <div className="w-full h-2 bg-fg/10 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full transition-all"
                      style={{ width: `${lot.qty_received > 0 ? (lot.qty_consumed / lot.qty_received) * 100 : 0}%` }}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <span className="text-control-label">{t('receiving.qtyReceived')}</span>
                    <div className="font-semibold tabular-nums">{fmtNum(lot.qty_received)}</div>
                  </div>
                  <div>
                    <span className="text-control-label">{t('receiving.qtyOnHand')}</span>
                    <div className="font-semibold tabular-nums">{fmtNum(lot.qty_on_hand)}</div>
                  </div>
                  <div>
                    <span className="text-control-label">{t('receiving.qtyConverted')}</span>
                    <div className="font-semibold tabular-nums">{fmtNum(lot.qty_consumed)}</div>
                  </div>
                </div>
              </div>

              {lot.qty_on_hand > 0 && (
                <div className="mt-3">
                  <Button variant="primary" startIcon={<PackagePlus size={16} />} onClick={onOpenConvert}>
                    {t('receiving.registerAsset')}
                  </Button>
                </div>
              )}
            </div>

            {/* Registered assets list */}
            {lotAssets.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-control-label uppercase tracking-wider mb-2">
                  {t('receiving.registeredAssets')} ({lotAssets.length})
                </h3>
                <div className="border border-line rounded-md overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-surface border-b border-line text-xs">
                        <th className="text-left px-3 py-1.5 font-medium">{t('receiving.serialNumber')}</th>
                        <th className="text-left px-3 py-1.5 font-medium">{t('receiving.imei')}</th>
                        <th className="text-left px-3 py-1.5 font-medium">{t('receiving.intakeCondition')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lotAssets.map(a => (
                        <tr key={a.asset_id} className="border-t border-line text-xs">
                          <td className="px-3 py-2 font-mono">{a.serial_no ?? '—'}</td>
                          <td className="px-3 py-2 font-mono">{a.imei ?? '—'}</td>
                          <td className="px-3 py-2">
                            <Badge size="xs" className="bg-fg/10 text-fg/60">{a.intake_condition}</Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
