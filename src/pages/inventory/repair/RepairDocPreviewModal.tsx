// Fullscreen viewer for a repair document PDF (server-rendered by be-media,
// /api/v1/repair/pdf). INTAKE / CHARGE_NOTICE / RETURN — rendered live from
// current state. Mirrors ContractPreviewModal. The signature image is not
// embedded in the PDF yet (BE PDF v2 pending).
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Button } from 'tsp-form';
import { Loader2, X, AlertTriangle, Download } from 'lucide-react';
import { beMediaRepairPdf, BeMediaError, type BeMediaRepairDoc } from '../../../lib/beMedia';
import { PdfCanvasViewer } from '../../../components/PdfCanvasViewer';

export function RepairDocPreviewModal({
  open,
  onClose,
  repairOrderId,
  repairCode,
  docType,
}: {
  open: boolean;
  onClose: () => void;
  repairOrderId: number | null;
  repairCode: string | null;
  docType: BeMediaRepairDoc;
}) {
  const { t } = useTranslation();
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!open || repairOrderId == null) return;
    let cancelled = false;
    let createdUrl: string | null = null;
    setLoading(true);
    setErrMsg(null);
    setBlobUrl(null);

    (async () => {
      try {
        const blob = await beMediaRepairPdf(repairOrderId, docType);
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
  }, [open, repairOrderId, docType, t]);

  const download = () => {
    if (!blobUrl) return;
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = `${repairCode ?? 'repair'}-${docType}.pdf`;
    a.click();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      width="100vw"
      height="100dvh"
      maxWidth="100vw"
      maxHeight="100dvh"
      ariaLabel={t(`repair.doc_${docType}`)}
    >
      <div className="modal-header">
        <h2 className="modal-title">
          {t(`repair.doc_${docType}`)}
          {repairCode && <span className="ml-2 text-sm font-normal text-subtle">{repairCode}</span>}
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
            <PdfCanvasViewer src={blobUrl} loadingText={t('common.loading')} />
          </div>
        )}
      </div>

      <div className="modal-footer">
        <Button onClick={onClose}>{t('common.close')}</Button>
        <Button color="primary" startIcon={<Download size={16} />} disabled={!blobUrl || loading} onClick={download}>
          {t('common.download')}
        </Button>
      </div>
    </Modal>
  );
}
