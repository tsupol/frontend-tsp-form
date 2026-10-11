// Evidence photos for one movement of a fund-money document (mig 1293).
//
// The photo attaches to the MOVEMENT, not to the document: a payout writes two
// movements and only one of them is a real transfer, so a slip belongs to that
// one. The same album serves a transfer slip and a receipt for a fund expense,
// because to the service they are the same thing — proof one movement happened.
//
// Always optional. Nothing here blocks recording a movement, so the component is
// a strip that is empty until someone adds to it.
//
// The shop sees only its own movements' photos, which the backend enforces; the
// fund company's own movement never has one, since it touches no bank account.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Button, Modal } from 'tsp-form';
import { ImageIcon, Loader2, Plus, Trash2 } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { translateApiError } from '../../lib/apiErrors';
import { normalizeKey } from '../../lib/mediaPath';
import { MediaLightboxKeyGallery } from '../../components/MediaLightbox';
import { MultiImageUploader } from '../../components/MultiImageUploader';
import { useMediaUrl } from '../../hooks/useMediaUrl';
import { FUND_PAYMENT_EVIDENCE_MAX } from '../../lib/beMedia';
import {
  FUND_PAYMENT_EVIDENCE_ENTITY_TYPE as ENTITY_TYPE,
  FUND_PAYMENT_EVIDENCE_USAGE_TYPE as USAGE_TYPE,
  uploadFundPaymentEvidenceFile,
} from '../../lib/fundPaymentEvidence';

interface EvidenceRow {
  entity_media_id: number;
  media_id: number;
  sort_order: number;
  storage_path: string;
  variants_json: Record<string, string> | null;
}

function pickThumbKey(m: EvidenceRow): string | null {
  const v = m.variants_json ?? {};
  return v.sm || v.lg || v.original || m.storage_path || null;
}
function pickFullKey(m: EvidenceRow): string | null {
  const v = m.variants_json ?? {};
  return v.lg || v.original || v.sm || m.storage_path || null;
}

interface FundPaymentEvidenceProps {
  paymentId: number;
  /** False on a shop session or a cancelled movement: view only. */
  canEdit?: boolean;
}

export function FundPaymentEvidence({ paymentId, canEdit = true }: FundPaymentEvidenceProps) {
  const { t } = useTranslation();
  const { user } = useAuth();

  const [manageOpen, setManageOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [staged, setStaged] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<EvidenceRow | null>(null);

  const { data: rows = [], refetch } = useQuery({
    queryKey: ['fund-payment-evidence', paymentId],
    queryFn: () => apiClient.get<EvidenceRow[]>(
      `/v_entity_media?entity_type=eq.${ENTITY_TYPE}&entity_id=eq.${paymentId}&usage_type=eq.${USAGE_TYPE}`
      + '&select=entity_media_id,media_id,sort_order,storage_path,variants_json&order=sort_order',
    ),
    staleTime: 30 * 1000,
  });

  const fullKeys = rows.map(m => {
    const k = pickFullKey(m);
    return k ? normalizeKey(k) : '';
  });

  const remaining = FUND_PAYMENT_EVIDENCE_MAX - rows.length;

  /**
   * Upload each staged photo, then register it.
   *
   * One at a time rather than in parallel: be-media mints the index per request
   * for this type, and firing several at once has produced colliding keys on
   * other albums. A failure part-way leaves the ones already done attached,
   * which is the honest outcome — they are on the server.
   */
  const handleUpload = async () => {
    if (staged.length === 0 || user?.holding_id == null) return;
    setBusy(true);
    setError(null);
    try {
      for (const file of staged) {
        await uploadFundPaymentEvidenceFile(paymentId, file, user.holding_id);
      }
      setStaged([]);
      await refetch();
    } catch (err) {
      setError(err instanceof ApiError ? translateApiError(err, t) : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async () => {
    if (!removing) return;
    setBusy(true);
    setError(null);
    try {
      await apiClient.rpc('fn_media_detach', { p_entity_media_id: removing.entity_media_id });
      setRemoving(null);
      await refetch();
    } catch (err) {
      setError(err instanceof ApiError ? translateApiError(err, t) : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="flex items-center gap-2 flex-wrap">
        {rows.map((m, i) => (
          <EvidenceThumb key={m.entity_media_id} row={m} onOpen={() => setLightboxIndex(i)} />
        ))}

        {rows.length === 0 && (
          <span className="text-xs text-subtler inline-flex items-center gap-1">
            <ImageIcon size={12} />
            {t('fundBill.noEvidence')}
          </span>
        )}

        {canEdit && (
          <Button
            variant="outline"
            size="sm"
            startIcon={<Plus size={14} />}
            onClick={() => setManageOpen(true)}
          >
            {t('fundBill.addEvidence')}
          </Button>
        )}
      </div>

      <MediaLightboxKeyGallery
        open={lightboxIndex != null}
        mediaKeys={fullKeys}
        index={lightboxIndex ?? 0}
        onIndexChange={setLightboxIndex}
        onClose={() => setLightboxIndex(null)}
      />

      <Modal
        open={manageOpen}
        onClose={() => { if (!busy) { setManageOpen(false); setStaged([]); setError(null); } }}
        maxWidth="32rem"
        width="100%"
        ariaLabel={t('fundBill.evidenceTitle')}
      >
        <div className="modal-header">
          <h2 className="modal-title">{t('fundBill.evidenceTitle')}</h2>
          <button
            type="button"
            className="modal-close-btn"
            onClick={() => { if (!busy) { setManageOpen(false); setStaged([]); } }}
          >
            &times;
          </button>
        </div>

        <div className="modal-content min-w-0">
          <div className="alert alert-info">
            <span>{t('fundBill.evidenceOptional')}</span>
          </div>

          {/* Already on the server. Removing one asks first, because the
           *  registry soft-unlinks rather than deleting and a mistaken press
           *  still needs a trip to the backend to undo. */}
          {rows.length > 0 && (
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              {rows.map((m, i) => (
                <div key={m.entity_media_id} className="relative inline-flex">
                  <EvidenceThumb row={m} onOpen={() => setLightboxIndex(i)} />
                  <Button
                    variant="outline"
                    size="sm"
                    className="absolute -top-2 -right-2"
                    startIcon={<Trash2 size={12} className="text-danger" />}
                    disabled={busy}
                    onClick={() => setRemoving(m)}
                  />
                </div>
              ))}
            </div>
          )}

          <div className="mt-4">
            <MultiImageUploader
              items={staged.map((file, i) => ({ kind: 'staged' as const, id: String(i), file }))}
              onAdd={files => setStaged(prev => [...prev, ...files].slice(0, Math.max(remaining, 0)))}
              onRemove={item => setStaged(prev => prev.filter((_, i) => String(i) !== item.id))}
              max={Math.max(remaining, 0)}
              disabled={busy}
              busyLabel={busy ? t('fundBill.uploadingEvidence') : undefined}
              onError={setError}
            />
          </div>
        </div>

        {error && (
          <div className="px-4 pb-2">
            <div className="alert alert-danger"><span>{error}</span></div>
          </div>
        )}

        <div className="modal-footer">
          <Button
            variant="ghost"
            onClick={() => { setManageOpen(false); setStaged([]); setError(null); }}
            disabled={busy}
          >
            {t('common.close', { defaultValue: 'Close' })}
          </Button>
          <Button
            color="primary"
            onClick={handleUpload}
            disabled={busy || staged.length === 0}
            startIcon={busy ? <Loader2 size={14} className="animate-spin" /> : undefined}
          >
            {t('fundBill.uploadEvidence')}
          </Button>
        </div>
      </Modal>

      <Modal
        open={!!removing}
        onClose={() => setRemoving(null)}
        maxWidth="24rem"
        width="100%"
        ariaLabel={t('fundBill.removeEvidence')}
      >
        <div className="modal-header">
          <h2 className="modal-title">{t('fundBill.removeEvidence')}</h2>
        </div>
        <div className="modal-content"><p>{t('fundBill.removeEvidenceConfirm')}</p></div>
        <div className="modal-footer">
          <Button variant="ghost" onClick={() => setRemoving(null)} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button color="danger" onClick={handleRemove} disabled={busy}>
            {t('common.delete', { defaultValue: 'Delete' })}
          </Button>
        </div>
      </Modal>
    </>
  );
}

/** One thumbnail. Private keys need a presigned URL, so it goes through the hook. */
function EvidenceThumb({ row, onOpen }: { row: EvidenceRow; onOpen: () => void }) {
  const key = pickThumbKey(row);
  const { url } = useMediaUrl(key ? normalizeKey(key) : null);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-14 h-14 rounded-md overflow-hidden border border-line bg-surface p-0 cursor-pointer"
    >
      {url ? (
        <img src={url} alt="" className="w-full h-full object-cover" />
      ) : (
        <span className="flex items-center justify-center w-full h-full text-subtler">
          <ImageIcon size={14} />
        </span>
      )}
    </button>
  );
}
