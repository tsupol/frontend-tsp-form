// Screen Time passcode + recovery email for one asset.
//
// Backend (INV mig 97):
//   GET  /v_asset_screentime?asset_id=eq.<id>   — permission-scoped view.
//        0 rows = caller can't see it (BRANCH_STAFF / customer) → render nothing.
//        Visible to BRANCH_MANAGER (own branch) + all COMPANY_* roles.
//   POST /rpc/fn_asset_set_screentime_recovery_email { p_asset_id, p_email }
//        Edit allowed for BRANCH_MANAGER only; "" / null clears.
//
// passcode is DB-generated from the serial — read-only, copyable, never editable.
// Used on the Asset detail panel AND the contract Device tab (same asset_id).

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Input } from 'tsp-form';
import { ShieldCheck, Pencil, XCircle } from 'lucide-react';
import { apiClient, ApiError } from '../lib/api';
import { CopyButton } from './CopyButton';
import { useAuth } from '../contexts/AuthContext';

interface ScreenTimeRow {
  asset_id: number;
  asset_code: string;
  serial_no: string | null;
  imei: string | null;
  screentime_passcode: string | null;
  screentime_recovery_email: string | null;
}

export function AssetScreenTimeSection({
  assetId,
  className,
}: {
  assetId: number;
  /** Wrapper classes — callers tune padding/border to match their layout. */
  className?: string;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const canEdit = user?.role_code === 'BRANCH_MANAGER';

  const { data, isLoading } = useQuery({
    queryKey: ['asset-screentime', assetId],
    queryFn: () =>
      apiClient
        .get<ScreenTimeRow[]>(`/v_asset_screentime?asset_id=eq.${assetId}`)
        .then((rows) => rows[0] ?? null),
    staleTime: 30 * 1000,
  });

  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!editing) setValue(data?.screentime_recovery_email ?? '');
  }, [data?.screentime_recovery_email, editing]);

  const mutation = useMutation({
    mutationFn: () =>
      apiClient.rpc<{ asset_id: number; screentime_recovery_email: string | null }>(
        'fn_asset_set_screentime_recovery_email',
        { p_asset_id: assetId, p_email: value.trim() || null },
      ),
    onSuccess: () => {
      setEditing(false);
      setError('');
      queryClient.invalidateQueries({ queryKey: ['asset-screentime', assetId] });
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        const translated =
          (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '') ||
          (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
        setError(translated || err.message);
      } else {
        setError(String(err));
      }
    },
  });

  // 0 rows = no permission (or no asset) → render nothing per the delivery doc.
  if (isLoading || !data) return null;

  const startEdit = () => {
    setValue(data.screentime_recovery_email ?? '');
    setError('');
    setEditing(true);
  };
  const cancelEdit = () => {
    setEditing(false);
    setError('');
    setValue(data.screentime_recovery_email ?? '');
  };

  return (
    <section className={`border border-line rounded-md ${className ?? ''}`}>
      <header className="flex items-center gap-2 px-4 py-2.5 border-b border-line">
        <ShieldCheck size={16} className="text-subtle" />
        <h3 className="text-sm font-semibold">{t('asset.screentime_title')}</h3>
      </header>
      <div className="px-4 py-3 flex flex-col gap-3">
        {/* Passcode — read-only, copyable */}
        <div>
          <div className="text-xs text-subtle">{t('asset.screentime_passcode')}</div>
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-mono tracking-widest">
              {data.screentime_passcode || <span className="text-subtler italic font-sans tracking-normal">—</span>}
            </span>
            {data.screentime_passcode && <CopyButton value={data.screentime_passcode} size={12} />}
          </div>
        </div>

        {/* Recovery email — BM-editable */}
        <div>
          <div className="text-xs text-subtle">{t('asset.screentime_recoveryEmail')}</div>
          {!editing ? (
            <div className="flex items-center gap-1.5">
              <span className="text-sm">
                {data.screentime_recovery_email || (
                  <span className="text-subtler italic">{t('asset.screentime_noRecoveryEmail')}</span>
                )}
              </span>
              {canEdit && (
                <Button variant="ghost" size="xs" startIcon={<Pencil size={12} />} onClick={startEdit} />
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 mt-1">
              <Input
                value={value}
                onChange={(e) => setValue(e.target.value)}
                size="sm"
                type="email"
                placeholder={t('asset.screentime_recoveryEmail_placeholder')}
                className="w-full"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') mutation.mutate();
                  if (e.key === 'Escape') cancelEdit();
                }}
              />
              <Button size="sm" color="primary" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
                {mutation.isPending ? t('common.saving') : t('common.save')}
              </Button>
              <Button size="sm" variant="ghost" onClick={cancelEdit} disabled={mutation.isPending}>
                {t('common.cancel')}
              </Button>
            </div>
          )}
          {error && (
            <div className="alert alert-danger mt-2">
              <XCircle size={16} />
              <span>{error}</span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
