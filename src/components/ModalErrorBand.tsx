import { useTranslation } from 'react-i18next';
import { XCircle, X } from 'lucide-react';

// ============================================================================
// ModalErrorBand — where a write-modal's submit error goes.
//
// `.modal-content` is the scrolling element (overflow-y:auto, flex:1) between a
// static header and footer. An alert rendered inside it scrolls with the form,
// so on a long modal the error lands below the fold and the user sees nothing
// happen after pressing Save. Measured on a 390px viewport: the error rendered
// at y=966 with the content viewport ending at 740, scrollTop 0.
//
// This band sits BETWEEN modal-content and modal-footer — outside the scroller,
// directly above the button that triggered the error. Renders nothing when
// there is no message, so it costs no space in the common case.
//
// Usage — note it is a SIBLING of modal-content, never a child:
//
//   <div className="modal-content">…fields…</div>
//   <ModalErrorBand message={error} />
//   <div className="modal-footer">…buttons…</div>
// ============================================================================

export interface ModalErrorBandProps {
  /** Falsy renders nothing. */
  message?: string | null;
  /** Swap the danger styling for a warning (e.g. a known backend gap). */
  variant?: 'danger' | 'warning';
  /** Clears the parent's error state. Omit to render a non-dismissable band. */
  onDismiss?: () => void;
}

export function ModalErrorBand({ message, variant = 'danger', onDismiss }: ModalErrorBandProps) {
  const { t } = useTranslation();
  if (!message) return null;
  return (
    <div className="px-4 py-3 border-t border-line shrink-0">
      <div className={`alert alert-${variant} mb-0`} role="alert" aria-live="polite">
        <XCircle size={16} className="shrink-0" />
        <span className="flex-1 min-w-0">{message}</span>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label={t('common.dismiss', { defaultValue: 'Dismiss' })}
            className="shrink-0 bg-transparent border-none p-0 cursor-pointer text-current opacity-60 hover:opacity-100 flex items-center"
          >
            <X size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
