import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';
import { Button, Modal, TextArea, FormErrorMessage } from 'tsp-form';
import { apiClient, ApiError } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import { IdentifierInput } from '../../components/SerialInput';
import { ModalErrorBand } from '../../components/ModalErrorBand';
import { identifierFormatReason, isAppleBrand } from '../../lib/validators';
import { codeDisplay } from './inventoryUtils';

/** The device fields this window reads — any asset-shaped row will do. */
export interface IdentifierTargetAsset {
  asset_id: number;
  asset_code: string;
  asset_code_display?: string | null;
  brand_name?: string | null;
  family_name?: string | null;
  model_name?: string | null;
}

// ============================================================================
// AddIdentifierModal — wraps fn_inv_asset_identifier_add (mig 113).
// Used when an asset is missing an IMEI/Serial because admin forgot to scan
// it during convert. For replacing an existing (mistyped) value use the
// ASSET_IDENTIFIER_CORRECT action in the footer instead.
// ============================================================================

export function AddIdentifierModal({
  open,
  identifierType,
  asset,
  onClose,
  onSuccess,
}: {
  open: boolean;
  identifierType: string | null;
  asset: IdentifierTargetAsset;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setValue('');
      setNote('');
      setError('');
    }
  }, [open, identifierType]);

  const mutation = useMutation({
    mutationFn: () => apiClient.rpc<{ asset_id: number; identifier_id: number; identifier_type: string; value: string }>(
      'fn_inv_asset_identifier_add',
      {
        p_asset_id: asset.asset_id,
        p_identifier_type: identifierType,
        p_value: value.trim(),
        p_note: note.trim() || null,
        p_branch_id: null,
      },
    ),
    onSuccess: () => onSuccess(),
    onError: (err) => {
      if (err instanceof ApiError) {
        const translated =
          translateApiError(err, t);
        setError(translated || err.message);
      } else {
        setError(String(err));
      }
    },
  });

  // Same rule the backend enforces (mig 1357); null = valid or nothing typed yet.
  const formatError = value.trim() ? identifierFormatReason(identifierType, value, isAppleBrand(asset.brand_name)) : null;
  const canSubmit = !!identifierType && !!value.trim() && !formatError && !mutation.isPending;

  const typeLabel = identifierType ? t(`asset.idType.${identifierType}`, { defaultValue: identifierType }) : '';
  const title = identifierType
    ? t('identifierAdd.title', { ns: 'assetActions', defaultValue: 'Add {{type}}', type: typeLabel })
    : '';

  return (
    <Modal open={open && !!identifierType} onClose={onClose} maxWidth="28rem" width="100%">
      <div className="flex flex-col overflow-hidden">
        <div className="modal-header">
          <h2 className="modal-title">{title}</h2>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">&times;</button>
        </div>
        <div className="modal-content">
          <div className="mb-4 px-3 py-2.5 rounded-md bg-surface border border-line">
            <div className="font-medium text-sm font-mono">{codeDisplay(asset.asset_code_display, asset.asset_code)}</div>
            <div className="text-xs text-subtle truncate">
              {[asset.brand_name, asset.family_name, asset.model_name].filter(Boolean).join(' ')}
            </div>
          </div>
          <div className="form-grid gap-4">
            <div className="flex flex-col">
              <label className="form-label">{typeLabel} *</label>
              <IdentifierInput
                identifierType={identifierType}
                value={value}
                onChange={setValue}
                placeholder={identifierType === 'IMEI' || identifierType === 'IMEI2'
                  ? t('asset.imeiPlaceholder')
                  : t('identifierAdd.valuePlaceholder', { ns: 'assetActions', defaultValue: 'Value' })}
                error={!!formatError}
                className="w-full"
                autoFocus
              />
              <FormErrorMessage error={formatError ? { message: t(`identifierFormat.${formatError}`) } : undefined} />
            </div>
            <div className="flex flex-col">
              <label className="form-label">{t('identifierAdd.note', { ns: 'assetActions', defaultValue: 'Note' })}</label>
              <TextArea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder={t('identifierAdd.notePlaceholder', { ns: 'assetActions', defaultValue: 'Why is this being added later? (optional)' })}
              />
            </div>
          </div>
        </div>
        <ModalErrorBand message={error} onDismiss={() => setError('')} />
        <div className="modal-footer">
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button color="primary" onClick={() => mutation.mutate()} disabled={!canSubmit}>
            {mutation.isPending
              ? t('common.loading')
              : t('identifierAdd.submit', { ns: 'assetActions', defaultValue: 'Add' })}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
