// Capture and submit a signature for one pending party of a COLLECTING signing.
//
// Flow:
//   1. SignatureCapture produces an UploadedImage[]
//   2. uploadFromImage(contract_signature, ...) → misc-go writes WebP and
//      returns the storage_path (private bucket)
//   3. fn_media_attach with entity_type=CONTRACT, usage_type=SIGNATURE →
//      returns media_id
//   4. fn_contract_signing_sign(p_signing_id, p_party_role, p_party_index,
//      p_signature_media_id=media_id)
//
// Customer-party only for now. Staff witnesses (party_role=WITNESS without
// customer_id) need a different upload type and are deferred.
//
// Follows the tsp-form modal pattern: success step (view='done') inside the
// modal; the user closes themselves. Dirty-form close guard skipped because
// the form has no editable text input — the only "dirty" state is mid-upload
// or mid-mutation, which we already block via `submitting`.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Modal } from 'tsp-form';
import type { UploadedImage } from 'tsp-form';
import { XCircle } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { uploadFromImage } from '../../lib/upload';
import { toStoragePath } from '../../lib/mediaPath';
import { useAuth } from '../../contexts/AuthContext';
import { SignatureCapture } from './workspace/SignatureCapture';
import { ActionDoneView } from './ActionDoneView';

interface PendingParty {
  signing_id: number;
  party_role: 'LESSOR' | 'LESSEE' | 'GUARANTOR' | 'WITNESS';
  party_index: number;
  customer_id: number | null;
  staff_id: number | null;
  frozen_full_name: string | null;
}

interface SignResult {
  signing_id: number;
  party_id?: number;
  state: string;            // 'COLLECTING' or 'SEALED' if last signature
  remaining_parties?: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  contractId: number;
  party: PendingParty | null;
}

function describeApiError(
  err: unknown,
  t: (k: string, opts?: Record<string, unknown>) => string,
): string {
  if (err instanceof ApiError) {
    const translated = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
      || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
    return translated || err.message;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

export function SigningSignModal({ open, onClose, contractId, party }: Props) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [view, setView] = useState<'form' | 'done'>('form');
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<SignResult | null>(null);

  useEffect(() => {
    if (open) {
      setView('form');
      setError('');
      setUploading(false);
      setResult(null);
    }
  }, [open]);

  const mutation = useMutation({
    mutationFn: async (mediaId: number) => {
      if (!party) throw new Error('No party');
      return apiClient.rpc<SignResult>('fn_contract_signing_sign', {
        p_signing_id: party.signing_id,
        p_party_role: party.party_role,
        p_party_index: party.party_index,
        p_signature_media_id: mediaId,
      });
    },
    onSuccess: (res) => {
      setResult(res);
      setView('done');
      queryClient.invalidateQueries({ queryKey: ['contract-signings', contractId] });
      queryClient.invalidateQueries({ queryKey: ['contract-signing-parties', contractId] });
    },
    onError: (err) => setError(describeApiError(err, t)),
  });

  const handleUpload = async (images: UploadedImage[]) => {
    if (!party || images.length === 0) return;
    if (party.customer_id == null) {
      setError(t('signing.signStaffPartyUnsupported'));
      return;
    }
    if (!user?.holding_id) {
      setError(t('common.errorGeneric'));
      return;
    }
    setError('');
    setUploading(true);
    try {
      const results = await uploadFromImage({
        type: 'contract_signature',
        image: images[0],
        params: { contract_id: contractId, customer_id: party.customer_id },
      });
      // contract_signature has a single 'sm' size — pick it (or any first key).
      const first = results.sm ?? Object.values(results)[0];
      if (!first) throw new Error('Upload returned no result');
      const attached = await apiClient.rpc<{ media_id: number }>('fn_media_attach', {
        p_holding_id: user.holding_id,
        p_storage_path: toStoragePath(first.key),
        p_variants_json: null,
        p_media_type: 'IMAGE',
        p_access_level: 'CONFIDENTIAL',
        p_mime_type: 'image/webp',
        p_file_size_bytes: null,
        p_original_filename: null,
        p_entity_type: 'CONTRACT',
        p_entity_id: contractId,
        p_usage_type: 'SIGNATURE',
        p_sort_order: 0,
        p_caption: null,
      });
      mutation.mutate(attached.media_id);
    } catch (err) {
      setError(describeApiError(err, t));
    } finally {
      setUploading(false);
    }
  };

  const submitting = uploading || mutation.isPending;
  // While the upload or RPC is in flight, the close-X / footer button stay
  // visible but disabled. No dirty-form prompt needed — the SignatureCapture
  // surface is canvas-based and not a text editor.
  const handleClose = () => {
    if (submitting) return;
    onClose();
  };

  return (
    <Modal open={open} onClose={handleClose} maxWidth="42rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">
          {view === 'done' ? t('signing.signDoneTitle') : t('signing.signTitle')}
        </h2>
        <button type="button" className="modal-close-btn" onClick={handleClose} aria-label="Close" disabled={submitting}>&times;</button>
      </div>

      {view === 'form' && (
        <>
          <div className="modal-content">
            {party && (
              <div className="mb-3 px-3 py-2 rounded-md bg-surface border border-line flex items-center gap-2 flex-wrap">
                <Badge size="xs" color="info">
                  {t(`signing.role_${party.party_role}`, { defaultValue: party.party_role })}
                </Badge>
                <span className="text-sm font-medium">{party.frozen_full_name ?? '—'}</span>
              </div>
            )}
            {error && (
              <div className="alert alert-danger mb-3 animate-pop-in">
                <XCircle size={16} />
                <span>{error}</span>
              </div>
            )}
            <SignatureCapture
              fileUrl={null}
              uploading={submitting}
              disabled={submitting}
              onUpload={handleUpload}
              startInEditing
            />
          </div>
          <div className="modal-footer">
            <Button onClick={handleClose} disabled={submitting}>{t('common.close')}</Button>
          </div>
        </>
      )}

      {view === 'done' && result && (
        <ActionDoneView
          headline={
            result.state === 'SEALED'
              ? t('signing.signDoneSealed')
              : t('signing.signDoneCollecting')
          }
          contractCode={`SGN-${result.signing_id}`}
          tone="success"
          stateTransition={
            result.state === 'SEALED'
              ? { from: 'COLLECTING', to: 'SEALED' }
              : undefined
          }
          detailRows={[
            ...(party ? [{
              label: t(`signing.role_${party.party_role}`, { defaultValue: party.party_role }),
              value: party.frozen_full_name ?? '—',
            }] : []),
            ...(result.remaining_parties != null && result.state !== 'SEALED' ? [{
              label: t('signing.remainingParties'),
              value: String(result.remaining_parties),
            }] : []),
          ]}
          onClose={onClose}
        />
      )}
    </Modal>
  );
}
