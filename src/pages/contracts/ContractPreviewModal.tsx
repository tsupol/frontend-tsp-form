// Fullscreen modal that shows the contract PDF (server-rendered by misc-go)
// in an iframe for staff to show the customer before signing/printing.
// Same endpoint as the print flow, with `preview: true` so the server omits
// the lessee signature — that's the only difference between preview and print.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Button } from 'tsp-form';
import { Loader2, X, AlertTriangle, PenLine } from 'lucide-react';
import { config } from '../../config/config';
import {
  buildContractRenderData,
  ContractRenderPrerequisiteError,
  type ContractMin,
} from '../../lib/contractPdf/buildRenderData';
import { PdfCanvasViewer } from '../../components/PdfCanvasViewer';

interface Props {
  open: boolean;
  onClose: () => void;
  contract: ContractMin | null;
  // When provided, an "Accept & sign" primary button shows in the footer.
  // Caller is responsible for closing the preview after triggering its own
  // sign flow.
  onAcceptAndSign?: () => void;
}

export function ContractPreviewModal({ open, onClose, contract, onAcceptAndSign }: Props) {
  const { t } = useTranslation();
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [contractCode, setContractCode] = useState<string>('');

  useEffect(() => {
    if (!open || !contract) return;
    let cancelled = false;
    let createdUrl: string | null = null;
    setLoading(true);
    setErrMsg(null);
    setBlobUrl(null);

    (async () => {
      try {
        const input = await buildContractRenderData(contract);
        if (cancelled) return;
        setContractCode(input.contractCode);
        const res = await fetch(`${config.uploadUrl}/contract/pdf`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...input, preview: true }),
        });
        if (!res.ok) {
          let detail = '';
          try {
            const j = await res.json();
            detail = j?.error?.message || j?.error?.code || '';
          } catch { /* non-json body */ }
          throw new Error(`server pdf ${res.status}${detail ? `: ${detail}` : ''}`);
        }
        const blob = await res.blob();
        if (cancelled) return;
        createdUrl = URL.createObjectURL(blob);
        setBlobUrl(createdUrl);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ContractRenderPrerequisiteError) {
          setErrMsg(prerequisiteMsg(err.reason, t));
        } else {
          setErrMsg(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [open, contract, t]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      width="100vw"
      height="100dvh"
      maxWidth="100vw"
      maxHeight="100dvh"
      ariaLabel={t('contract.previewModalTitle', { defaultValue: 'Contract preview' })}
    >
      <div className="modal-header">
        <h2 className="modal-title">
          {t('contract.previewModalTitle', { defaultValue: 'Contract preview' })}
          {contractCode && (
            <span className="ml-2 text-sm font-normal text-subtle">
              {contractCode}
            </span>
          )}
        </h2>
        <button type="button" className="modal-close-btn" onClick={onClose} aria-label={t('common.close')}>
          <X size={20} />
        </button>
      </div>

      <div className="modal-content" style={{ padding: 0, display: 'flex', flexDirection: 'column' }}>
        {loading && (
          <div className="flex items-center justify-center py-10 text-subtle">
            <Loader2 size={20} className="animate-spin mr-2" />
            <span>{t('common.loading')}</span>
          </div>
        )}
        {errMsg && !loading && (
          <div className="max-w-2xl mx-auto mt-8 alert alert-danger">
            <AlertTriangle size={16} />
            <span>{errMsg}</span>
          </div>
        )}
        {blobUrl && !loading && (
          <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
            <PdfCanvasViewer
              src={blobUrl}
              loadingText={t('common.loading')}
            />
          </div>
        )}
      </div>

      <div className="modal-footer">
        <Button onClick={onClose}>{t('common.close')}</Button>
        {onAcceptAndSign && (
          <Button
            color="primary"
            onClick={onAcceptAndSign}
            disabled={loading || !!errMsg}
            startIcon={<PenLine size={16} />}
          >
            {t('contract.acceptAndSign', { defaultValue: 'Accept & sign' })}
          </Button>
        )}
      </div>
    </Modal>
  );
}

function prerequisiteMsg(reason: string, t: (k: string, opts?: Record<string, unknown>) => string): string {
  switch (reason) {
    case 'no_bank_account':
      return t('contract.printBlock_noBankAccount', { defaultValue: 'Branch has no active bank account set.' });
    case 'no_lessor':
      return t('contract.printBlock_noLessorInBook', { defaultValue: 'Branch signatory book has no active lessor.' });
    case 'no_witnesses':
      return t('contract.printBlock_notEnoughWitnesses', { defaultValue: 'Branch signatory book needs at least 2 active witnesses.' });
    default:
      return reason;
  }
}
