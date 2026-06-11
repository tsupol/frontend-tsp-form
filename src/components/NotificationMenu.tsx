import { useRef, useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Badge, PopOver } from 'tsp-form';
import { Bell, MessageSquare, FileText, CreditCard, AlertTriangle, CheckCheck } from 'lucide-react';
import clsx from 'clsx';
import { apiClient } from '../lib/api';

type NotifCategory = 'contract' | 'chat' | 'payment' | 'system';

type NotificationRow = {
  notification_id: number;
  event_type: string;
  category: NotifCategory | string;
  title: string | null;
  body: string | null;
  payload: { deeplink?: string; contract_id?: number; contract_display?: string; customer_display?: string } | null;
  contract_ids: number[] | null;
  created_at: string;
  is_read: boolean;
};

type ListResponse = {
  items: NotificationRow[];
  total: number;
  limit: number;
  offset: number;
};

function relativeTime(t: ReturnType<typeof useTranslation>['t'], iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diffMin = Math.floor((Date.now() - then) / 60_000);
  if (diffMin < 1) return t('notifCenter.time.justNow');
  if (diffMin < 60) return t('notifCenter.time.minAgo', { n: diffMin });
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return t('notifCenter.time.hrAgo', { n: diffHr });
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return t('notifCenter.time.dayAgo', { n: diffDay });
  const diffWk = Math.floor(diffDay / 7);
  return t('notifCenter.time.weekAgo', { n: diffWk });
}

function iconForCategory(category: string) {
  switch (category) {
    case 'contract': return <FileText size={14} />;
    case 'chat':     return <MessageSquare size={14} />;
    case 'payment': return <CreditCard size={14} />;
    default:         return <AlertTriangle size={14} />;
  }
}

type Props = {
  collapsed: boolean;
  isMobile: boolean;
  unreadCount: number;
};

export function NotificationMenuItem({ collapsed, isMobile, unreadCount }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['notif', 'panel-list'],
    queryFn: () => apiClient.rpc<ListResponse>('fn_staff_list_notifications', {
      p_category: null,
      p_unread_only: false,
      p_limit: 20,
      p_offset: 0,
    }),
    enabled: open,
    refetchOnWindowFocus: true,
    staleTime: 0,
  });

  const markRead = useMutation({
    mutationFn: (id: number) => apiClient.rpc('fn_staff_mark_notification_read', { p_notification_id: id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notif', 'panel-list'] });
      queryClient.invalidateQueries({ queryKey: ['nav', 'notif-unread-summary'] });
    },
  });

  const markAllRead = useMutation({
    mutationFn: () => apiClient.rpc('fn_staff_mark_all_read', { p_category: null }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notif', 'panel-list'] });
      queryClient.invalidateQueries({ queryKey: ['nav', 'notif-unread-summary'] });
    },
  });

  const handleRowClick = (row: NotificationRow) => {
    if (!row.is_read) markRead.mutate(row.notification_id);
    const link = row.payload?.deeplink;
    setOpen(false);
    if (link) navigate(link);
  };

  const label = unreadCount > 99 ? '99+' : String(unreadCount);
  const showCollapsedDot = collapsed && !isMobile && unreadCount > 0;

  return (
    <>
      <button
        ref={triggerRef}
        className={clsx('side-menu-item', open && 'active')}
        onClick={() => setOpen(o => !o)}
        aria-label={t('nav.notifications')}
      >
        <span className="side-menu-item-icon relative inline-flex">
          <Bell size="1rem" />
          {showCollapsedDot && (
            <span
              className="absolute -top-1.5 -right-2 inline-flex items-center justify-center min-w-[14px] h-[14px] px-1 pt-px rounded-full text-[9px] font-semibold tabular-nums ring-1 ring-bg"
              style={{
                background: 'var(--color-badge-warning-bg, color-mix(in srgb, var(--color-warning) 20%, var(--color-surface)))',
                color: 'var(--color-badge-warning-fg, var(--color-warning-fade, var(--color-warning)))',
              }}
              aria-label={`${label} unread`}
            >
              {label}
            </span>
          )}
        </span>
        {!collapsed && <span className="side-menu-item-label">{t('nav.notifications')}</span>}
        {!collapsed && unreadCount > 0 && <Badge color="warning" size="xs">{label}</Badge>}
      </button>
      <PopOver
        isOpen={open}
        onClose={() => setOpen(false)}
        triggerRef={triggerRef}
        placement="right"
        align="start"
        offset={4}
        minWidth="320px"
        maxWidth="420px"
        maxHeight="70dvh"
      >
        <div className="flex flex-col">
          <div className="px-3 py-2 flex items-center justify-between border-b border-line">
            <span className="text-sm font-semibold">{t('notifCenter.title')}</span>
            <button
              type="button"
              className="text-xs text-primary-fg hover:underline disabled:opacity-50 inline-flex items-center gap-1 bg-transparent border-none p-0 cursor-pointer"
              onClick={() => markAllRead.mutate()}
              disabled={markAllRead.isPending || unreadCount === 0}
            >
              <CheckCheck size={12} />
              {t('notifCenter.markAllRead')}
            </button>
          </div>

          <div className="overflow-y-auto better-scroll" style={{ maxHeight: '52dvh' }}>
            {isLoading && (
              <div className="px-3 py-6 text-sm text-subtle text-center">{t('notifCenter.loading')}</div>
            )}
            {isError && (
              <div className="px-3 py-6 text-sm text-danger text-center">{t('notifCenter.error')}</div>
            )}
            {!isLoading && !isError && (data?.items ?? []).length === 0 && (
              <div className="px-3 py-8 text-sm text-subtle text-center">{t('notifCenter.empty')}</div>
            )}
            {(data?.items ?? []).map((row) => {
              const dotClass = row.is_read ? 'bg-line' : 'bg-primary';
              const titleClass = row.is_read ? 'text-subtle' : 'text-fg font-medium';
              return (
                <button
                  key={row.notification_id}
                  type="button"
                  className="w-full text-left px-3 py-2.5 hover:bg-item-hover-bg transition-colors border-b border-line/60 last:border-b-0 cursor-pointer bg-transparent"
                  onClick={() => handleRowClick(row)}
                >
                  <div className="flex items-start gap-2">
                    <span className={clsx('mt-1.5 w-1.5 h-1.5 rounded-full shrink-0', dotClass)} />
                    <span className="mt-0.5 text-subtle shrink-0">{iconForCategory(row.category)}</span>
                    <div className="flex-1 min-w-0">
                      <div className={clsx('text-sm leading-snug truncate', titleClass)}>
                        {row.title || row.event_type}
                      </div>
                      {row.body && (
                        <div className="text-xs text-subtle leading-snug truncate mt-0.5">{row.body}</div>
                      )}
                      <div className="text-[11px] text-subtle mt-1">{relativeTime(t, row.created_at)}</div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </PopOver>
    </>
  );
}
