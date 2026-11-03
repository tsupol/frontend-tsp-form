import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, useSnackbarContext } from 'tsp-form';
import { CheckCircle, Save, XCircle } from 'lucide-react';
import { apiClient } from '../../lib/api';
import { useMyPermissions } from '../../hooks/useMyPermissions';
import { LostModeFields, LostModePreviewButton } from '../../components/lostMode/LostModeFields';
import { LostModePreviewModal } from '../../components/lostMode/LostModePreviewModal';
import { useLostModeDraft, type LostModeValues } from '../../components/lostMode/useLostModeDraft';

// A fund keeps one Lost Mode message + phone for all its shops, including shops
// opened later (157 §1b). Own Save button, like the document section above it:
// a different RPC from the rest of this tab.
export function CompanyLostModeSection({ companyId, onDirtyChange }: {
  companyId: number;
  /** Reports unsaved edits up so leaving the page asks first. */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();
  const { hasPermission } = useMyPermissions();
  const canEdit = hasPermission('COMPANY.UPDATE');
  const [saving, setSaving] = useState(false);

  const { data: row, isLoading } = useQuery({
    queryKey: ['company-lost-mode', companyId],
    queryFn: async () => {
      const rows = await apiClient.get<LostModeValues[]>(
        `/v_companies?id=eq.${companyId}&select=lost_mode_message,lost_mode_phone,lost_mode_message_effective,lost_mode_phone_effective`,
      );
      return rows[0] ?? null;
    },
    enabled: canEdit,
  });

  const draft = useLostModeDraft({
    target: { companyId },
    values: row ?? null,
    editable: true,
    seedKey: row ? companyId : null,
  });

  useEffect(() => { onDirtyChange?.(draft.isDirty); }, [draft.isDirty, onDirtyChange]);
  useEffect(() => () => { onDirtyChange?.(false); }, [onDirtyChange]);

  // The view leaves *_effective null on every company that is not a fund (157 §5).
  if (!canEdit || isLoading || !row || row.lost_mode_message_effective == null) return null;

  const handleSave = async () => {
    setSaving(true);
    try {
      await draft.save();
      await queryClient.invalidateQueries({ queryKey: ['company-lost-mode', companyId] });
      // Its shops read these values through v_branches.
      queryClient.invalidateQueries({ queryKey: ['branches-list'] });
      addSnackbar({
        message: (
          <div className="alert alert-success"><CheckCircle size={16} /><span className="alert-description">{t('settings.config.saved')}</span></div>
        ),
        type: 'success',
      });
    } catch {
      // draft.save() already put the refusal under its field.
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <hr className="border-line mt-6 mb-6" />
      <h4 className="text-sm font-semibold text-fg uppercase tracking-wider mb-1">{t('lostMode.sectionTitle')}</h4>
      <p className="text-xs text-subtle mb-3">{t('lostMode.fundHint')}</p>
      <div className="form-grid gap-4 max-w-xl">
        <LostModeFields draft={draft} phoneEmptyHint={t('lostMode.phoneEmptyCompany')} disabled={saving} />
      </div>
      {draft.generalError && (
        <div className="alert alert-danger mb-3"><XCircle size={16} /><div><div className="alert-description text-xs">{draft.generalError}</div></div></div>
      )}
      <div className="flex items-center justify-end gap-2 max-w-xl">
        <LostModePreviewButton draft={draft} disabled={saving} />
        <Button size="sm" onClick={draft.revert} disabled={saving || !draft.isDirty}>{t('common.cancel')}</Button>
        <Button size="sm" color="primary" startIcon={<Save size={14} />} onClick={handleSave} disabled={saving || !draft.isDirty}>
          {saving ? t('common.saving') : t('common.save')}
        </Button>
      </div>
      <LostModePreviewModal open={draft.previewOpen} onClose={draft.closePreview} content={draft.previewData} />
    </>
  );
}
