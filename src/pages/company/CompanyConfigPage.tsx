import { useState, useRef, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  PageNav, PageNavPanel, DataTable, MobileHeader, Input,
} from 'tsp-form';
import { ArrowRightFromLine, ArrowLeft, Settings2 } from 'lucide-react';
import { apiClient } from '../../lib/api';
import type { CompanyConfig } from './companyConfigTypes';
import { CompanyConfigDetail } from './CompanyConfigDetailPage';

// ── Company settings — PageNav 2-panel ───────────────────────────────────────
// Left rail: the companies of this holding. Right panel: that company's
// settings, edited in place. The detail is also reachable at its own URL
// (/admin/company/config/:companyId) so older links keep working — the id in
// the URL just preselects the rail row.

export function CompanyConfigPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { companyId } = useParams<{ companyId?: string }>();

  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [selectedId, setSelectedId] = useState<number | null>(
    companyId ? Number(companyId) : null,
  );

  const { data: configs = [], isFetching, isLoading } = useQuery({
    queryKey: ['company-config-list'],
    queryFn: () => apiClient.get<CompanyConfig[]>('/v_company_config?order=company_name'),
  });

  // A deep link (or a back/forward step) drives the selection.
  useEffect(() => {
    setSelectedId(companyId ? Number(companyId) : null);
  }, [companyId]);

  const filtered = useMemo(() => {
    if (!search.trim()) return configs;
    const term = search.trim().toLowerCase();
    return configs.filter(c => c.company_name.toLowerCase().includes(term));
  }, [configs, search]);

  const totalCount = filtered.length;
  const paginated = filtered.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize);

  const handleSearch = (value: string) => {
    setSearchInput(value);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setSearch(value);
      setPageIndex(0);
    }, 300);
  };

  const selectedName = configs.find(c => c.company_id === selectedId)?.company_name ?? '';

  return (
    <PageNav
      panels={['list', 'detail']}
      defaultPanel={companyId ? 'detail' : undefined}
      className="h-dvh overflow-hidden"
    >
      {({ isMobile, isRoot, goTo, goBack }) => {
        const select = (row: CompanyConfig) => {
          setSelectedId(row.company_id);
          navigate(`/admin/company/config/${row.company_id}`, { replace: true });
          if (isMobile) goTo('detail');
        };

        return (
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
                      aria-label="Go back"
                      onClick={goBack}
                    >
                      <ArrowLeft size={20} />
                    </button>
                  )}
                </div>
                <div className="mobile-header-title mobile-header-title-truncate">
                  {isRoot ? t('settings.config.title') : selectedName}
                </div>
                <div className="mobile-header-end w-nav" />
              </MobileHeader>
            )}

            {!isMobile && (
              <div className="flex-none px-4 py-2.5 border-b border-line flex items-center gap-4">
                <h1 className="heading-2 shrink-0">{t('settings.config.title')}</h1>
              </div>
            )}

            <div className={isMobile ? 'pagenav-panels' : 'flex flex-1 min-h-0'}>
              {/* ── List rail ── */}
              <PageNavPanel
                id="list"
                className={isMobile ? '' : 'w-1/3 xl:w-1/4 border-r border-line flex flex-col'}
              >
                <div className="flex-none p-2 border-b border-line">
                  <Input
                    placeholder={t('common.search')}
                    value={searchInput}
                    onChange={(e) => handleSearch(e.target.value)}
                    size="sm"
                    className="w-full"
                  />
                </div>

                <DataTable<CompanyConfig>
                  data={paginated}
                  getRowProps={row => ({
                    'data-state': row.original.company_id === selectedId ? 'selected' : undefined,
                  })}
                  enableKeyboardNav={!isMobile}
                  onRowActivate={row => {
                    setSelectedId(row.original.company_id);
                    navigate(`/admin/company/config/${row.original.company_id}`, { replace: true });
                  }}
                  renderRow={row => {
                    const c = row.original;
                    return (
                      <button
                        type="button"
                        className="w-full text-left px-4 py-2.5 flex flex-col gap-1 transition-colors cursor-pointer"
                        onClick={() => select(c)}
                      >
                        <span className="text-sm font-medium truncate">{c.company_name}</span>
                        <span className="text-xs text-subtle tabular-nums">
                          {t('settings.config.grace')} {c.grace_period_days}d
                          {' · '}
                          {t('settings.config.draft')} {c.draft_expiry_days}d
                          {' · '}฿{(c.late_fee_per_day ?? 0).toLocaleString()}
                        </span>
                      </button>
                    );
                  }}
                  enablePagination
                  pageIndex={pageIndex}
                  pageSize={pageSize}
                  pageSizeOptions={[25, 50]}
                  rowCount={totalCount}
                  onPageChange={({ pageIndex: pi, pageSize: ps }) => { setPageIndex(pi); setPageSize(ps); }}
                  className={`flex-1 min-h-0 panel-datatable ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}
                  noResults={
                    <div className="p-8 text-center text-subtler">
                      {isLoading ? t('common.loading') : t('settings.config.empty')}
                    </div>
                  }
                />
              </PageNavPanel>

              {/* ── Detail panel ── */}
              <PageNavPanel
                id="detail"
                className={isMobile ? '' : 'flex-1 min-w-0 flex flex-col'}
              >
                {selectedId == null ? (
                  <div className="flex-1 h-full flex items-center justify-center text-subtler">
                    <div className="text-center">
                      <Settings2 size={32} className="mx-auto mb-2 opacity-40" />
                      <div className="text-sm">{t('settings.config.selectToEdit')}</div>
                    </div>
                  </div>
                ) : (
                  <CompanyConfigDetail companyId={selectedId} isMobile={isMobile} />
                )}
              </PageNavPanel>
            </div>
          </>
        );
      }}
    </PageNav>
  );
}
