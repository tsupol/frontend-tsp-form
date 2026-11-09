import { SettingsBox } from './SettingsBox';
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
    <SettingsBox title={t('lostMode.sectionTitle')} hint={t('lostMode.fundHint')}>
      {/* Fields and buttons span the whole box, like every other box on the tab. */}
      <div className="form-grid gap-4">
        <LostModeFields draft={draft} phoneEmptyHint={t('lostMode.phoneEmptyCompany')} disabled={saving} />
      </div>
      {/* Pinned to the box's foot when the box beside it (the Telegram bot) is taller. */}
      <div className="mt-auto">
      {draft.generalError && (
        <div className="alert alert-danger mb-3"><XCircle size={16} /><div><div className="alert-description text-xs">{draft.generalError}</div></div></div>
      )}
      {/* Preview on the left, away from the box's ยกเลิก/บันทึก pair at the right. */}
      <div className="flex items-center gap-2">
        <LostModePreviewButton draft={draft} disabled={saving} />
        <span className="flex-1" />
        <Button size="sm" onClick={draft.revert} disabled={saving || !draft.isDirty}>{t('common.cancel')}</Button>
        <Button size="sm" color="primary" startIcon={<Save size={14} />} onClick={handleSave} disabled={saving || !draft.isDirty}>
          {saving ? t('common.saving') : t('common.save')}
        </Button>
      </div>
      </div>
      <LostModePreviewModal open={draft.previewOpen} onClose={draft.closePreview} content={draft.previewData} />
    </SettingsBox>
  );
}
