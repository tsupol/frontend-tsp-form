// Fullscreen modal that shows the contract PDF (server-rendered by be-media)
// in a canvas viewer for staff to show the customer before signing/printing.
// be-media assembles + renders from the contract id; draft vs signed is
// decided server-side by contract state (signatures simply absent until
// signed), so no client-side preview flag is needed.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Button } from 'tsp-form';
import { Loader2, X, AlertTriangle, PenLine } from 'lucide-react';
import {
  beMediaContractPdf,
  beMediaContractPreviewAll,
  beMediaContractPrintAll,
  BeMediaError,
  type BeMediaContractDoc,
} from '../../lib/beMedia';
import type { ContractMin } from '../../lib/contractPdf/contractMin';
import { PdfCanvasViewer } from '../../components/PdfCanvasViewer';

// Which document to render in the viewer. Defaults to previewAll (the wizard
// "read before you sign" packet) when omitted.
export interface PreviewTarget {
  previewAll?: boolean;
  printAll?: boolean;
  signingId?: number;
  doc?: BeMediaContractDoc;
  coLesseeCustomerId?: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  contract: ContractMin | null;
  // What to render. Omit → preview-all (wizard packet preview).
  target?: PreviewTarget;
  // When provided, an "Accept & sign" primary button shows in the footer.
  // Caller is responsible for closing the preview after triggering its own
  // sign flow.
  onAcceptAndSign?: () => void;
}

export function ContractPreviewModal({ open, onClose, contract, target, onAcceptAndSign }: Props) {
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

    setContractCode(contract.code_display ?? contract.code);

    (async () => {
      try {
        let blob: Blob;
        if (target?.printAll) {
          blob = await beMediaContractPrintAll(contract.id);
        } else if (target?.signingId != null || target?.doc) {
          blob = await beMediaContractPdf({
            contractId: contract.id,
            signingId: target.signingId,
            doc: target.doc,
            coLesseeCustomerId: target.coLesseeCustomerId,
          });
        } else {
          // Default + explicit previewAll → the wizard "to sign" packet.
          blob = await beMediaContractPreviewAll(contract.id);
        }
        if (cancelled) return;
        createdUrl = URL.createObjectURL(blob);
        setBlobUrl(createdUrl);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof BeMediaError) {
          setErrMsg(t(err.code, { ns: 'apiErrors', defaultValue: err.message }));
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
  }, [open, contract, target?.previewAll, target?.printAll, target?.signingId, target?.doc, target?.coLesseeCustomerId, t]);

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
