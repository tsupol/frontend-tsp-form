// Inline section showing the active promise + history for a contract.
// Renders inside the Overview tab; create / cancel actions reuse the existing
// AppointmentCreateModal + AppointmentCancelModal.
//
// View shape (v_contract_appointments):
//   { id, contract_id, installment_id, promise_date, status, note,
//     created_by, created_at, holding_id }
//
// status values: ACTIVE / CANCELLED / EXPIRED / FULFILLED (auto-set by cron)

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button } from 'tsp-form';
import { CalendarCheck, CalendarPlus, CalendarX } from 'lucide-react';
import { apiClient } from '../../lib/api';
import { DateTime } from '../../components/DateTime';
import { AppointmentCreateModal, AppointmentCancelModal } from './AppointmentModals';

type AppointmentStatus = 'ACTIVE' | 'CANCELLED' | 'EXPIRED' | 'FULFILLED';

interface AppointmentRow {
  id: number;
  contract_id: number;
  installment_id: number | null;
  promise_date: string;
  status: AppointmentStatus;
  note: string | null;
  created_at: string;
  created_by: number | null;
}

function statusColor(s: AppointmentStatus): 'success' | 'default' | 'warning' | 'info' {
  switch (s) {
    case 'ACTIVE':    return 'success';
    case 'FULFILLED': return 'info';
    case 'EXPIRED':   return 'warning';
    case 'CANCELLED': return 'default';
    default:          return 'default';
  }
}

export function AppointmentsSection({ contractId }: { contractId: number }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['contract-appointments', contractId] });
    queryClient.invalidateQueries({ queryKey: ['contract-appointment-active', contractId] });
  };

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['contract-appointments', contractId],
    queryFn: () => apiClient.get<AppointmentRow[]>(
      `/v_contract_appointments?contract_id=eq.${contractId}&order=created_at.desc&limit=10`,
    ),
    staleTime: 30_000,
  });

  const active = rows.find(r => r.status === 'ACTIVE') ?? null;
  const history = rows.filter(r => r.status !== 'ACTIVE');

  return (
    <div className="border border-line rounded-md px-4 py-3">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-subtle uppercase tracking-wider flex items-center gap-1.5">
          <CalendarCheck size={13} />
          {t('contract.appointment_sectionTitle')}
        </h3>
        {active ? (
          <Button
            size="sm"
            variant="outline"
            color="danger"
            startIcon={<CalendarX size={14} />}
            onClick={() => setCancelOpen(true)}
          >
            {t('contract.action_appointment_cancel')}
          </Button>
        ) : (
          <Button
            size="sm"
            color="primary"
            startIcon={<CalendarPlus size={14} />}
            onClick={() => setCreateOpen(true)}
          >
            {t('contract.action_appointment_create')}
          </Button>
        )}
      </div>

      {isLoading && rows.length === 0 ? (
        <div className="text-xs text-subtler">{t('common.loading')}</div>
      ) : active ? (
        <div className="rounded-md border border-success-border bg-success-soft px-3 py-2.5 mb-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Badge size="xs" color="success">{t('contract.appointment_status_ACTIVE')}</Badge>
              <span>
                {t('contract.appointment_promiseDate')}: <DateTime value={active.promise_date} showTime={false} />
              </span>
            </div>
            <span className="text-[11px] text-subtle">
              {t('signing.createdAt')} <DateTime value={active.created_at} />
            </span>
          </div>
          {active.note && (
            <div className="text-xs text-subtle mt-1 break-words">{active.note}</div>
          )}
        </div>
      ) : (
        <div className="text-xs text-subtler mb-2">{t('contract.appointment_noneActive')}</div>
      )}

      {history.length > 0 && (
        <div className="flex flex-col gap-1.5 mt-2 pt-2 border-t border-line">
          <div className="text-[11px] text-subtle uppercase tracking-wider">
            {t('contract.appointment_history')}
          </div>
          <ul className="flex flex-col">
            {history.map(r => (
              <li
                key={r.id}
                className="flex items-center justify-between gap-2 py-1.5 text-xs border-b border-line last:border-b-0"
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <Badge size="xs" color={statusColor(r.status)}>
                    {t(`contract.appointment_status_${r.status}`, { defaultValue: r.status })}
                  </Badge>
                  <span className="tabular-nums shrink-0">
                    <DateTime value={r.promise_date} showTime={false} />
                  </span>
                  {r.note && (
                    <span className="text-subtle truncate">— {r.note}</span>
                  )}
                </div>
                <span className="text-[11px] text-subtler shrink-0">
                  <DateTime value={r.created_at} showTime={false} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <AppointmentCreateModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSuccess={() => { refresh(); setCreateOpen(false); }}
        contractId={contractId}
      />
      <AppointmentCancelModal
        open={cancelOpen}
        onClose={() => { refresh(); setCancelOpen(false); }}
        onSuccess={() => { refresh(); }}
        contractId={contractId}
      />
    </div>
  );
}
