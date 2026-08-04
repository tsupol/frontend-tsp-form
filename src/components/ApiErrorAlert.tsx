import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { XCircle, ExternalLink } from 'lucide-react';
import { ApiError } from '../lib/api';
import { translateApiError } from '../lib/apiErrors';

/**
 * Standard `alert alert-danger` block for a failed API call.
 *
 * Beyond translating the message, it turns an identifier conflict into a way
 * out: `INV.CONFLICT.IDENTIFIER_CONFLICT` names the asset already holding the
 * value, so the alert offers a link to it. That is the whole point of the
 * error — staff hit it when the device is already registered but they searched
 * by an identifier the import never carried, and "duplicate" alone leaves them
 * stuck. The link only renders when the backend actually sent the asset id
 * (it degrades to `{type, value}` if the conflicting row vanishes mid-request).
 *
 * Pass either a caught error (preferred — enables the link) or a plain string
 * for callers that only kept the message.
 */
export function ApiErrorAlert({
  error,
  className = 'alert alert-danger mb-4 animate-pop-in',
}: {
  error: unknown;
  className?: string;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  if (!error) return null;

  const message = typeof error === 'string' ? error : translateApiError(error, t);
  if (!message) return null;

  const params = error instanceof ApiError ? error.messageParams : undefined;
  const conflictAssetId = params?.existing_asset_id;
  const conflictAssetCode = params?.existing_asset_code;
  const canLink =
    (typeof conflictAssetId === 'number' || typeof conflictAssetId === 'string') && !!conflictAssetId;

  return (
    <div className={className}>
      <XCircle size={16} />
      <div className="flex flex-col gap-1 min-w-0">
        <span>{message}</span>
        {canLink && (
          <button
            type="button"
            onClick={() => navigate(`/admin/inventory/assets/${conflictAssetId}`)}
            className="text-sm font-medium text-primary-fg hover:underline inline-flex items-center gap-1 bg-transparent border-none p-0 cursor-pointer self-start"
          >
            {t('inventory.viewConflictingAsset', {
              code: typeof conflictAssetCode === 'string' ? conflictAssetCode : '',
            })}
            <ExternalLink size={12} />
          </button>
        )}
      </div>
    </div>
  );
}
