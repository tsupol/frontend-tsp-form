import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import {
  PageNav, PageNavPanel, MobileHeader, DataTableFooter,
  Badge, Input, Switch,
} from 'tsp-form';
import { ArrowLeft, ArrowRightFromLine, ChevronDown, Image as ImageIcon } from 'lucide-react';
import { apiClient } from '../../lib/api';
import { formatSmart } from '../../lib/format';
import { MediaLightbox } from '../../components/MediaLightbox';
import { ChatThreadPanel } from './ChatThreadPanel';
import type { ChatInboxRow } from './chatTypes';

export function ChatPage() {
  const { t, i18n } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const contractParam = searchParams.get('contract');
  const selectedContractId = contractParam ? parseInt(contractParam, 10) : null;

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [lightboxKey, setLightboxKey] = useState<string | null>(null);
  const [mobileDetailsOpen, setMobileDetailsOpen] = useState(false);

  useEffect(() => { setPageIndex(0); }, [search, unreadOnly]);
  useEffect(() => { setMobileDetailsOpen(false); }, [selectedContractId]);
  useEffect(() => () => { if (searchTimer.current) clearTimeout(searchTimer.current); }, []);

  const handleSearch = (value: string) => {
    setSearchInput(value);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setSearch(value), 300);
  };

  const queryUrl = useMemo(() => {
    const params: string[] = ['order=last_message_at.desc.nullslast'];
    if (unreadOnly) params.push('unread_count=gt.0');
    if (search.trim()) {
      const q = encodeURIComponent(search.trim());
      params.push(`or=(customer_name.ilike.*${q}*,contract_code.ilike.*${q}*)`);
    }
    return `/v_branch_chat_list?${params.join('&')}`;
  }, [search, unreadOnly]);

  const { data, isFetching } = useQuery({
    queryKey: ['chat-inbox', search, unreadOnly, pageIndex, pageSize],
    queryFn: () => apiClient.getPaginated<ChatInboxRow>(
      queryUrl,
      { page: pageIndex + 1, pageSize },
    ),
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
  });

  const rows = data?.data ?? [];
  const totalCount = data?.totalCount ?? 0;

  const selectThread = (contractId: number, goTo?: (id: string) => void) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.set('contract', String(contractId));
      return next;
    }, { replace: true });
    if (goTo) goTo('thread');
  };

  const selectedRow = rows.find(r => r.contract_id === selectedContractId);
  const headerTitle = selectedRow?.customer_name ?? t('chat.title');

  return (
    <PageNav
      panels={['list', 'thread']}
      defaultPanel={selectedContractId !== null ? 'thread' : undefined}
      className="h-dvh"
    >
      {({ isMobile, isRoot, goTo, goBack }) => (
        <>
          {isMobile && (
            <MobileHeader className="mobile-header-bordered">
              <div className="mobile-header-start">
                {isRoot ? (
                  <button
                    className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current"
                    aria-label="Open menu"
                    onClick={() => window.dispatchEvent(new CustomEvent('sidemenu:open'))}
                  >
                    <ArrowRightFromLine size={18} />
                  </button>
                ) : (
                  <button
                    className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current"
                    aria-label={t('chat.backToInbox')}
                    onClick={goBack}
                  >
                    <ArrowLeft size={20} />
                  </button>
                )}
              </div>
              <div className="mobile-header-title mobile-header-title-truncate">
                {isRoot ? t('chat.title') : headerTitle}
              </div>
              <div className="mobile-header-end w-nav">
                {!isRoot && (
                  <button
                    className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current"
                    aria-label={t('chat.detailsToggle')}
                    aria-expanded={mobileDetailsOpen}
                    onClick={() => setMobileDetailsOpen(o => !o)}
                  >
                    <ChevronDown
                      size={18}
                      className={`transition-transform ${mobileDetailsOpen ? 'rotate-180' : ''}`}
                    />
                  </button>
                )}
              </div>
            </MobileHeader>
          )}

          {/* Desktop header */}
          {!isMobile && (
            <div className="flex-none px-4 py-2.5 border-b border-line flex items-center gap-4">
              <h1 className="heading-2 shrink-0">{t('chat.title')}</h1>
            </div>
          )}

          <div className={isMobile ? 'pagenav-panels' : 'flex flex-1 min-h-0'}>
            {/* Left panel — inbox list */}
            <PageNavPanel
              id="list"
              className={isMobile ? '' : 'w-1/3 xl:w-1/4 border-r border-line flex flex-col'}
            >
              <div className="flex-none flex items-center gap-2 p-2 border-b border-line">
                <div className="flex-1 min-w-0">
                  <Input
                    size="sm"
                    className="w-full"
                    placeholder={t('chat.searchPlaceholder')}
                    value={searchInput}
                    onChange={e => handleSearch(e.target.value)}
                  />
                </div>
                <label className="inline-flex items-center gap-2 text-xs shrink-0 cursor-pointer">
                  <Switch size="sm" checked={unreadOnly} onChange={e => setUnreadOnly(e.target.checked)} />
                  <span>{t('chat.unreadOnly')}</span>
                </label>
              </div>

              <div className={`flex-1 min-h-0 overflow-auto better-scroll ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}>
                {rows.length === 0 ? (
                  <div className="p-8 text-center text-subtle text-sm">{t('chat.empty')}</div>
                ) : (
                  <div className="flex flex-col">
                    {rows.map(row => {
                      const isSelected = selectedContractId === row.contract_id;
                      const isImage = row.last_message_type === 'IMAGE';
                      return (
                        <button
                          key={row.contract_id}
                          type="button"
                          className={`text-left px-3 py-2.5 border-b border-line cursor-pointer transition-colors ${
                            isSelected ? 'bg-primary-soft' : 'hover:bg-surface-hover'
                          }`}
                          onClick={() => selectThread(row.contract_id, isMobile ? goTo : undefined)}
                        >
                          <div className="flex items-start justify-between gap-2 min-w-0">
                            <div className="text-sm font-medium truncate min-w-0">
                              {row.customer_name ?? '—'}
                            </div>
                            <div className="flex flex-col items-end gap-1 shrink-0">
                              <span className="text-[11px] text-subtle tabular-nums">
                                {formatSmart(row.last_message_at, i18n.language)}
                              </span>
                              {row.unread_count > 0 && (
                                <Badge size="sm" color="primary">{row.unread_count}</Badge>
                              )}
                            </div>
                          </div>
                          <div className="text-[11px] text-subtle truncate font-mono">
                            {row.contract_code_display}
                          </div>
                          <div className="text-xs text-subtle truncate mt-0.5">
                            {isImage ? (
                              <span className="inline-flex items-center gap-1">
                                <ImageIcon size={12} /> {t('chat.imageMessage')}
                              </span>
                            ) : (
                              row.last_message_text ?? ''
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {totalCount > pageSize && (
                <div className="flex-none border-t border-line">
                  <DataTableFooter
                    currentPage={pageIndex + 1}
                    totalPages={Math.ceil(totalCount / pageSize)}
                    onPageChange={p => setPageIndex(p - 1)}
                    pageSize={pageSize}
                    pageSizeOptions={[25, 50, 100]}
                    onPageSizeChange={ps => { setPageSize(ps); setPageIndex(0); }}
                    totalRows={totalCount}
                    controlSize="sm"
                  />
                </div>
              )}
            </PageNavPanel>

            {/* Right panel — thread */}
            <PageNavPanel id="thread" className="flex-1 min-h-0 flex flex-col">
              <ChatThreadPanel
                contractId={selectedContractId}
                onOpenImage={setLightboxKey}
                mobileDetailsOpen={mobileDetailsOpen}
              />
            </PageNavPanel>
          </div>

          <MediaLightbox
            open={lightboxKey !== null}
            onClose={() => setLightboxKey(null)}
            mediaKey={lightboxKey}
            alt={t('chat.imageMessage')}
          />
        </>
      )}
    </PageNav>
  );
}
