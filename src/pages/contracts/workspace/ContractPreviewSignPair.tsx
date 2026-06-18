// Side-by-side "Preview contract" + "Signature" card pair, wired to the
// shared ContractPreviewModal + ContractSignModal. Used for the lessee (in
// PanelDocuments) and for guarantors (in PanelGuarantor).
//
// The signature card hides itself in lessee-only modes by setting
// hideSignatureCard if a caller ever wants the preview alone — currently
// both consumers want both.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle, ScrollText, Eye, PenLine, AlertTriangle } from 'lucide-react';
import { useMediaUrl } from '../../../hooks/useMediaUrl';
import { ContractPreviewModal } from '../ContractPreviewModal';
import { ContractSignModal } from './ContractSignModal';
import type { ContractMin } from '../../../lib/contractPdf/buildRenderData';
import type { UploadedImage } from 'tsp-form';

export interface ReadinessError {
  code: string;
  detail?: Record<string, unknown>;
}

interface Props {
  contract: ContractMin | null;
  // Signature target. file_url + uploading + onUpload are passed straight
  // into ContractSignModal; the caller decides which customer (lessee or
  // guarantor) the signature attaches to.
  fileUrl: string | null;
  uploading: boolean;
  onUpload: (imgs: UploadedImage[]) => void;
  // Disable everything until prereqs are met (e.g. customer registered,
  // signatory book ready). Maps to disabled on both modals.
  disabled?: boolean;
  cacheBust?: number;
  // Optional: pair label shown above the cards. Defaults to
  // "Contract & signature". Pass a guarantor name for the guarantor flow.
  pairLabel?: string;
  signCardLabel?: string;
  // When the contract isn't ready to render (BE readiness from
  // fn_contract_render / fn_contract_validate_ready), show WHY here instead of
  // the preview + signature cards — the document can't be previewed or signed
  // until these are filled.
  notReadyErrors?: ReadinessError[];
  // Signature is optional for this party (e.g. guarantor — can sign by hand on
  // the printed contract). Drops the "pending" empty-circle indicator so the
  // unsigned state doesn't read as a blocking requirement.
  signatureOptional?: boolean;
}

export function ContractPreviewSignPair({
  contract,
  fileUrl,
  uploading,
  onUpload,
  disabled = false,
  cacheBust = 0,
  pairLabel,
  signCardLabel,
  notReadyErrors,
  signatureOptional = false,
}: Props) {
  const { t } = useTranslation();
  const [previewOpen, setPreviewOpen] = useState(false);
  const [signOpen, setSignOpen] = useState(false);

  const resolvedPairLabel = pairLabel
    ?? t('workspace.docContractAndSignature', { defaultValue: 'Contract & signature' });
  const resolvedSignCardLabel = signCardLabel ?? t('workspace.docSignature');

  const notReady = (notReadyErrors?.length ?? 0) > 0;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 mb-1">
        {fileUrl
          ? <CheckCircle size={14} className="text-success" />
          : signatureOptional
            ? <ScrollText size={14} className="text-subtle" />
            : <span className="w-3.5 h-3.5 rounded-full border-2 border-fg/30" />}
        {!signatureOptional && <ScrollText size={14} />}
        <label className="form-label mb-0">{resolvedPairLabel}</label>
        {signatureOptional && !fileUrl && (
          <span className="ml-auto text-xs font-normal text-subtle">
            ({t('common.optional', { defaultValue: 'optional' })})
          </span>
        )}
      </div>
      {notReady ? (
        // Not ready to render the document — show WHY (BE readiness codes)
        // instead of the preview + signature cards.
        <div className="alert alert-warning">
          <AlertTriangle size={16} />
          <div className="flex flex-col gap-0.5 min-w-0">
            <div className="alert-title">{t('workspace.docNotReadyTitle', { defaultValue: 'Complete these before previewing or signing' })}</div>
            <ul className="alert-description list-disc pl-5 flex flex-col gap-0.5">
              {notReadyErrors!.map((err, i) => (
                <li key={`${err.code}-${i}`}>{readinessLabel(err, t)}</li>
              ))}
            </ul>
          </div>
        </div>
      ) : (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <PreviewCard
          disabled={!contract || disabled}
          onClick={() => setPreviewOpen(true)}
        />
        <SignatureCard
          fileUrl={fileUrl}
          cacheBust={cacheBust}
          disabled={disabled}
          label={resolvedSignCardLabel}
          onClick={() => setSignOpen(true)}
        />
      </div>
      )}

      <ContractPreviewModal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        contract={contract}
        onAcceptAndSign={() => {
          setPreviewOpen(false);
          setSignOpen(true);
        }}
      />

      <ContractSignModal
        open={signOpen}
        onClose={() => setSignOpen(false)}
        fileUrl={fileUrl}
        uploading={uploading}
        onUpload={onUpload}
        disabled={disabled}
        cacheBust={cacheBust}
        onSigned={() => setSignOpen(false)}
      />
    </div>
  );
}

// Turn a BE readiness error into a human line. Code → i18n (apiErrors ns);
// SIGNATORY_INCOMPLETE carries detail.missing (LESSOR / WITNESS_1 / …) so we
// append the specific slot.
function readinessLabel(err: ReadinessError, t: ReturnType<typeof useTranslation>['t']): string {
  const base = t(err.code, { ns: 'apiErrors', defaultValue: err.code });
  const missing = err.detail?.missing;
  if (typeof missing === 'string' && missing) {
    const slot = t(`workspace.signatory${missing === 'LESSOR' ? 'Lessor' : missing === 'WITNESS_1' ? 'Witness1' : missing === 'WITNESS_2' ? 'Witness2' : ''}`, { defaultValue: missing });
    return `${base} — ${slot}`;
  }
  return base;
}

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

function SignatureCard({ fileUrl, cacheBust, disabled, label, onClick }: {
  fileUrl: string | null;
  cacheBust: number;
  disabled: boolean;
  label: string;
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
          {label}
        </span>
        <span className="inline-flex items-center gap-1 text-subtle">
          <PenLine size={12} />
          {signed ? t('workspace.sigRetake') : t('contract.acceptAndSign', { defaultValue: 'Accept & sign' })}
        </span>
      </div>
      <div className="flex-1 min-h-0 w-full bg-white grid place-items-center overflow-hidden">
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
