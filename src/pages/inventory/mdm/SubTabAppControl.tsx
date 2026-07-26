// ============================================================================
// Sub-tab 5 — ควบคุมแอป (131 §7). Pick a preset → preview (p_preview:true) →
// confirm → apply (p_preview:false). The preview shows the resolved app_count
// + bundle list; only apply returns an intent_id (tracked in the queue).
//
// ⚠️ app_count > the preset's list is expected — the system always adds the
// baseline apps (phone/messages/settings/NNF) so the device stays usable (§7).
// ============================================================================

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Button, Select } from 'tsp-form';
import { AppWindow, Eye, Send, PackageCheck } from 'lucide-react';
import { fetchWhitelistPresets, applyAppWhitelist, parseMdmError, type AssetMdmStatus, type ApplyPresetResult, type ParsedMdmError } from './mdmApi';
import { useMdmCommand } from './useMdmCommand';
import { MdmErrorAlert, CommandAckNote } from './MdmSharedBits';

export function SubTabAppControl({
  status,
  onAck,
  onNotEnrolled,
}: {
  status: AssetMdmStatus;
  onAck: (intentIds: number[]) => void;
  onNotEnrolled: () => void;
}) {
  const { t } = useTranslation();
  const [presetKey, setPresetKey] = useState<string | null>(null);
  const [preview, setPreview] = useState<ApplyPresetResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<ParsedMdmError | null>(null);
  const cmd = useMdmCommand({ onAck, onNotEnrolled });

  const { data: presets = [] } = useQuery({
    queryKey: ['mdm-whitelist-presets'],
    queryFn: fetchWhitelistPresets,
  });

  const runPreview = async () => {
    if (!presetKey) return;
    setPreviewing(true);
    setPreviewError(null);
    cmd.reset();
    try {
      const r = await applyAppWhitelist(status.asset_id, presetKey, true);
      setPreview(r);
    } catch (err) {
      setPreview(null);
      setPreviewError(parseMdmError(err, t));
    } finally {
      setPreviewing(false);
    }
  };

  const applyReal = async () => {
    if (!presetKey) return;
    // p_preview MUST be false here (§7 gotcha).
    await cmd.run(
      () => applyAppWhitelist(status.asset_id, presetKey, false),
      (r) => (r.intent_id != null ? [r.intent_id] : []),
    );
    setPreview(null);
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-subtle">{t('asset.mdm.appControl.intro')}</p>

      <MdmErrorAlert error={cmd.error ?? previewError} onGoToEnroll={onNotEnrolled} />
      <CommandAckNote show={cmd.acked && !cmd.error} />

      <div className="flex items-end gap-2">
        <div className="flex flex-col flex-1 min-w-0">
          <label className="form-label">{t('asset.mdm.appControl.presetLabel')}</label>
          <Select
            value={presetKey}
            onChange={(v) => { setPresetKey(v as string); setPreview(null); }}
            options={presets.map((p) => ({ value: p.preset_key, label: p.display_name }))}
            placeholder={t('asset.mdm.appControl.presetPlaceholder')}
            size="sm"
            showChevron
          />
        </div>
        <Button variant="outline" size="sm" startIcon={<Eye size={15} />} disabled={!presetKey || previewing} onClick={runPreview}>
          {t('asset.mdm.appControl.preview')}
        </Button>
      </div>

      {preview && (
        <div className="border border-line rounded-md p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <PackageCheck size={16} className="text-info-fg" />
            <span className="text-sm font-semibold">{t('asset.mdm.appControl.previewTitle')}</span>
          </div>
          <div className="text-sm text-subtle">
            {t('asset.mdm.appControl.appCount', { count: preview.app_count })}
          </div>
          <div className="text-xs text-subtler">{t('asset.mdm.appControl.baselineNote')}</div>
          <div className="flex flex-wrap gap-1.5 max-h-40 overflow-auto better-scroll">
            {preview.bundle_ids.map((b) => (
              <span key={b} className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-surface border border-line text-xs font-mono">
                <AppWindow size={11} className="text-subtle" />{b}
              </span>
            ))}
          </div>
          <div>
            <Button color="primary" size="sm" startIcon={<Send size={15} />} disabled={cmd.pending} onClick={applyReal}>
              {t('asset.mdm.appControl.apply')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
