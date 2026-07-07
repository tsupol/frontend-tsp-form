// Shared stages table for all 4 Dunning Config tabs. Renders rows from the
// per-module list RPC, with click → edit modal. Same component handles 1 row
// (blacklist/legal) and 9 rows (notif) — no special pagination logic.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Button } from 'tsp-form';
import { AlertCircle, RefreshCw, Pencil } from 'lucide-react';
import { DateTime } from '../../components/DateTime';
import { useDunningStages } from './useDunningStages';
import { DunningStageEditModal } from './DunningStageEditModal';
import { DunningStageResetModal } from './DunningStageResetModal';
import type { DunningModule, DunningStageRow } from './dunningTypes';

interface Props {
  module: DunningModule;
}

export function DunningStagesTable({ module }: Props) {
  const { t } = useTranslation();
  const { rows, isLoading, error, config } = useDunningStages(module);
  const [editStage, setEditStage] = useState<DunningStageRow | null>(null);
  const [resetStage, setResetStage] = useState<DunningStageRow | null>(null);

  if (isLoading) {
    return <div className="p-8 text-center text-subtle text-sm">{t('common.loading')}</div>;
  }

  if (error) {
    return (
      <div className="alert alert-danger">
        <AlertCircle size={16} />
        <div className="alert-description">{error instanceof Error ? error.message : String(error)}</div>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="border border-dashed border-line rounded-md p-8 text-center text-sm text-subtle">
        {t('dunningSystem.empty')}
      </div>
    );
  }

  return (
    <>
      <div className="border border-line rounded-md overflow-hidden">
        <div className="hidden md:grid grid-cols-[1fr_auto_auto_auto_auto] gap-3 px-3 py-2 bg-surface border-b border-line text-xs uppercase tracking-wider text-subtle">
          <div>{t('dunningSystem.colStage')}</div>
          <div className="text-right tabular-nums">{t('dunningSystem.colDayWindow')}</div>
          <div className="text-right tabular-nums">{t('dunningSystem.colPriority')}</div>
          <div className="text-center">{t('dunningSystem.colActive')}</div>
          <div className="w-20" />
        </div>

        {rows.map(row => (
          <StageRow
            key={row.stage}
            row={row}
            extraField={config.extraField}
            onEdit={() => setEditStage(row)}
            onReset={() => setResetStage(row)}
          />
        ))}
      </div>

      <DunningStageEditModal
        open={editStage !== null}
        onClose={() => setEditStage(null)}
        module={module}
        row={editStage}
      />

      <DunningStageResetModal
        open={resetStage !== null}
        onClose={() => setResetStage(null)}
        module={module}
        row={resetStage}
      />
    </>
  );
}

function StageRow({ row, extraField, onEdit, onReset }: {
  row: DunningStageRow;
  extraField: 'reason_code' | 'intent_type' | 'action_code' | undefined;
  onEdit: () => void;
  onReset: () => void;
}) {
  const { t } = useTranslation();
  // effective is null when the holding hasn't overridden this stage — fall back
  // to the template (system default), which is then what's applied.
  const eff = row.effective ?? row.template;
  const isCustom = row.effective?.is_custom ?? false;
  const dayLabel = formatDayWindow(eff.day_from, eff.day_to);
  const extraValue = extraField ? eff[extraField] : row.event_type;

  return (
    <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto_auto_auto] gap-3 px-3 py-3 items-center border-b border-line">
      {/* Stage label + description */}
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm font-mono">{row.stage}</span>
          {isCustom && (
            <Badge size="xs" color="info">{t('dunningSystem.custom')}</Badge>
          )}
          <Badge size="xs" color="default">{row.kind}</Badge>
        </div>
        <div className="text-xs text-subtle mt-0.5">{row.description}</div>
        {extraValue && (
          <div className="text-[11px] text-subtler mt-0.5 font-mono">{extraValue}</div>
        )}
      </div>

      {/* Day window */}
      <div className="text-sm tabular-nums text-right md:min-w-[5rem]">
        {dayLabel}
      </div>

      {/* Priority */}
      <div className="text-sm tabular-nums text-right md:min-w-[3rem]">
        {eff.priority}
      </div>

      {/* Active flag */}
      <div className="text-center md:min-w-[4rem]">
        {eff.active
          ? <Badge size="xs" color="success">{t('dunningSystem.active')}</Badge>
          : <Badge size="xs" color="default">{t('dunningSystem.inactive')}</Badge>
        }
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 justify-end">
        <Button size="sm" variant="ghost" className="btn-icon-sm" onClick={onEdit} startIcon={<Pencil size={14} />} />
        {isCustom && (
          <Button size="sm" variant="ghost" className="btn-icon-sm" onClick={onReset} startIcon={<RefreshCw size={14} />} />
        )}
      </div>

      {/* Audit footer — only when custom */}
      {isCustom && eff.updated_at && (
        <div className="col-span-full text-[11px] text-subtler">
          {t('dunningSystem.lastUpdated')} <DateTime value={eff.updated_at} />
        </div>
      )}
    </div>
  );
}

function formatDayWindow(from: number, to: number | null): string {
  const fmt = (n: number) => n > 0 ? `+${n}` : String(n);
  if (to == null) return `${fmt(from)}…`;
  if (to === from) return `${fmt(from)}d`;
  return `${fmt(from)} → ${fmt(to)}`;
}
