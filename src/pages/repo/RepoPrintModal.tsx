// Fullscreen viewer for the two sheets a repo agent carries into the field
// (server-rendered by be-media, /api/v1/repo/pdf/*). Mirrors
// RepairDocPreviewModal.
//
//  · authority — one page: power of attorney on top, the device-return +
//    contract-termination record the customer signs at the door below. The
//    authority row is issued (or reused) by the first press; there is no
//    separate "create" step.
//  · contract — every SEALED document for the contract, stamped COPY, because
//    the original stays at the shop.
//
// The paper says สัญญาเช่า throughout, so the screen does too.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Button } from 'tsp-form';
import { Loader2, X, AlertTriangle, Download, ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';
import { beMediaRepoAuthorityPdf, beMediaRepoContractPdf, BeMediaError } from '../../lib/beMedia';
import { PdfCanvasViewer } from '../../components/PdfCanvasViewer';

export type RepoPrintDoc = 'authority' | 'contract';

export function RepoPrintModal({
  open,
  onClose,
  contractId,
  contractCode,
  doc,
}: {
  open: boolean;
  onClose: () => void;
  contractId: number | null;
  contractCode: string | null;
  doc: RepoPrintDoc;
}) {
  const { t } = useTranslation();
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  // AGENT_PROFILE_INCOMPLETE is the one error the user can fix themselves, so
  // the band carries a link to their own profile instead of just the message.
  const [needsProfile, setNeedsProfile] = useState(false);

  useEffect(() => {
    if (!open || contractId == null) return;
    let cancelled = false;
    let createdUrl: string | null = null;
    setLoading(true);
    setErrMsg(null);
    setNeedsProfile(false);
    setBlobUrl(null);

    (async () => {
      try {
        const blob = doc === 'authority'
          ? await beMediaRepoAuthorityPdf(contractId)
          : await beMediaRepoContractPdf(contractId);
        if (cancelled) return;
        createdUrl = URL.createObjectURL(blob);
        setBlobUrl(createdUrl);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof BeMediaError) {
          if (err.code === 'OPS.VALIDATION.AGENT_PROFILE_INCOMPLETE') {
            setNeedsProfile(true);
            // mig 1357: the same code with reason "signature" means only the
            // signature is missing — say that, not the whole checklist.
            setErrMsg(err.params?.reason === 'signature'
              ? t('repo.print.noSignature')
              : t(err.code, { ns: 'apiErrors', defaultValue: err.message }));
          } else {
            setErrMsg(t(err.code, { ns: 'apiErrors', defaultValue: err.message }));
          }
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
  }, [open, contractId, doc, t]);

  const download = () => {
    if (!blobUrl) return;
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = `${contractCode ?? 'contract'}-${doc === 'authority' ? 'authority' : 'copy'}.pdf`;
    a.click();
  };

  const title = doc === 'authority' ? t('repo.print.authorityTitle') : t('repo.print.contractTitle');

  return (
    <Modal
      open={open}
      onClose={onClose}
      width="100vw"
      height="100dvh"
      maxWidth="100vw"
      maxHeight="100dvh"
      ariaLabel={title}
    >
      <div className="modal-header">
        <h2 className="modal-title">
          {title}
          {contractCode && <span className="ml-2 text-sm font-normal text-subtle">{contractCode}</span>}
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
            <div className="flex flex-col gap-1 min-w-0">
              <span>{errMsg}</span>
              {needsProfile && (
                <Link
                  to="/admin/settings/profile"
                  className="inline-flex items-center gap-1 text-primary-fg hover:underline font-medium"
                  onClick={onClose}
                >
                  <ExternalLink size={13} />
                  {t('repo.print.openProfile')}
                </Link>
              )}
            </div>
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
