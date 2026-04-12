import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Button } from 'tsp-form';
import { CheckCircle, XCircle, Loader2, AlertCircle } from 'lucide-react';
import { apiClient, ApiError } from '../../../lib/api';
import { useWorkspace } from './WorkspaceContext';
import type { ReadinessResult } from './WorkspaceTypes';
import { ERROR_TO_MODAL } from './WorkspaceTypes';

export function CardReadiness() {
  const { t } = useTranslation();
  const { data, setOpenModal, updateData, readinessKey } = useWorkspace();

  const { data: readiness, isFetching, refetch } = useQuery({
    queryKey: ['contract-readiness', data.contractId, readinessKey],
    queryFn: () => apiClient.rpc<ReadinessResult>('fn_contract_validate_ready', {
      p_contract_id: data.contractId,
    }),
    staleTime: 0,
    enabled: !!data.contractId && !data.billId,
  });

  const [billLoading, setBillLoading] = useState(false);
  const [billError, setBillError] = useState('');

  const handleCreateBill = async () => {
    if (!readiness?.ready) return;
    setBillLoading(true);
    setBillError('');
    try {
      const res = await apiClient.rpc<{
        bill_id: number;
        bill_code: string;
        down_payment: number;
        insurance_deposit: number;
        total_amount: number;
        lines: Array<{ line_item_id: number; line_type: string; description: string; amount: number }>;
      }>('fn_bill_contract_open', {
        p_contract_id: data.contractId,
      });
      updateData({
        billId: res.bill_id,
        billCode: res.bill_code,
        billData: res,
      });
    } catch (err) {
      if (err instanceof ApiError) {
        const translated = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
          || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
        setBillError(translated || err.message);
      } else {
        setBillError(String(err));
      }
    } finally {
      setBillLoading(false);
    }
  };

  return (
    <div className="border border-line rounded-lg bg-bg">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-line">
        <AlertCircle size={16} className="text-fg/50 shrink-0" />
        <span className="font-medium text-sm flex-1">{t('workspace.cardReadiness')}</span>
        <Button size="sm" variant="ghost" onClick={() => refetch()} disabled={isFetching}>
          {isFetching ? <Loader2 size={14} className="animate-spin" /> : t('workspace.recheck')}
        </Button>
      </div>

      <div className="px-4 py-3">
        {isFetching && !readiness ? (
          <div className="flex items-center gap-2 text-sm text-subtle">
            <Loader2 size={14} className="animate-spin" />
            <span>{t('workspace.checking')}</span>
          </div>
        ) : readiness ? (
          <div className="flex flex-col gap-2">
            {/* Readiness checks */}
            {readiness.ready ? (
              <div className="flex items-center gap-2 text-sm text-success">
                <CheckCircle size={14} />
                <span>{t('workspace.allReady')}</span>
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                {readiness.errors.map((err, i) => {
                  const targetModal = ERROR_TO_MODAL[err.code];
                  return (
                    <button
                      key={i}
                      className={`flex items-center gap-2 text-sm text-left w-full ${
                        targetModal ? 'text-danger hover:underline cursor-pointer' : 'text-danger cursor-default'
                      }`}
                      onClick={targetModal ? () => setOpenModal(targetModal) : undefined}
                      disabled={!targetModal}
                    >
                      <XCircle size={14} className="shrink-0" />
                      <span>{err.message}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Bill error */}
            {billError && (
              <div className="alert alert-danger text-xs mt-2">
                <XCircle size={14} />
                <span>{billError}</span>
              </div>
            )}

            {/* Create bill button */}
            <div className="flex justify-end mt-2">
              <Button
                color="primary"
                onClick={handleCreateBill}
                disabled={!readiness.ready || billLoading}
                startIcon={billLoading ? <Loader2 size={16} className="animate-spin" /> : undefined}
              >
                {billLoading ? t('common.loading') : t('workspace.createBill')}
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

