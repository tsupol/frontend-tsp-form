import { useState, useRef, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { DataTable, Badge, Input, Select } from 'tsp-form';
import { ChevronRight, ChevronDown, ChevronsUpDown } from 'lucide-react';
import { apiClient } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';

// ── Types ────────────────────────────────────────────────────────────────────

interface Model {
  id: number;
  holding_id: number;
  company_id: number | null;
  company_scope_id: number | null;
  category_id: number;
  brand_id: number;
  family_id: number;
  code: string;
  name: string;
  attributes: Record<string, unknown> | null;
  is_contractable: boolean;
  is_sellable: boolean;
  is_giftable: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface Variant {
  id: number;
  sku_code: string;
  name: string;
  manufacturer_color: string | null;
  master_color_code: string | null;
  color_group: string | null;
  attributes: Record<string, unknown> | null;
  is_active: boolean;
}

interface BrandLookup {
  id: number;
  name: string;
}

interface FamilyLookup {
  id: number;
  display_name: string;
}

// ── VariantSubRow ────────────────────────────────────────────────────────────

function VariantSubRow({ modelId, holdingId }: { modelId: number; holdingId: number }) {
  const { t } = useTranslation();
  const { data: variants = [], isLoading } = useQuery({
    queryKey: ['model-variants', modelId],
    queryFn: () => apiClient.get<Variant[]>(
      `/v_ref_product_variants?model_id=eq.${modelId}&holding_id=eq.${holdingId}&order=sku_code`
    ),
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <div className="px-6 py-4 text-center text-control-label text-xs">
        {t('common.loading')}
      </div>
    );
  }

  if (variants.length === 0) {
    return (
      <div className="px-6 py-4 text-center text-control-label text-xs">
        {t('models.noVariantsFound')}
      </div>
    );
  }

  return (
    <div className="px-6 py-3">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-line">
            <th className="px-2 py-1.5 text-left font-medium text-control-label">{t('models.skuCode')}</th>
            <th className="px-2 py-1.5 text-left font-medium text-control-label">{t('models.variantName')}</th>
            <th className="px-2 py-1.5 text-left font-medium text-control-label">{t('models.colorGroup')}</th>
            <th className="px-2 py-1.5 text-left font-medium text-control-label">{t('users.status')}</th>
          </tr>
        </thead>
        <tbody>
          {variants.map((v) => (
            <tr key={v.id} className="border-b border-line last:border-b-0">
              <td className="px-2 py-1.5 font-medium">{v.sku_code}</td>
              <td className="px-2 py-1.5">{v.name}</td>
              <td className="px-2 py-1.5">
                {v.color_group ? (
                  <Badge size="sm" color={v.color_group === 'SPC' ? 'warning' : undefined}>
                    {v.color_group}
                  </Badge>
                ) : '—'}
              </td>
              <td className="px-2 py-1.5">
                <Badge size="sm" color={v.is_active ? 'success' : 'danger'}>
                  {v.is_active ? t('brandsModels.active') : t('brandsModels.inactive')}
                </Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export function ModelsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const holdingId = user?.holding_id ?? null;

  // Table state
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Filters & sort
  const [filterBrand, setFilterBrand] = useState<string>('');
  const [filterFamily, setFilterFamily] = useState<string>('');
  const [sortBy, setSortBy] = useState<string>('code.asc');

  // Expand state
  const [expandedModels, setExpandedModels] = useState<Set<number>>(new Set());

  const toggleExpand = useCallback((modelId: number) => {
    setExpandedModels((prev) => {
      const next = new Set(prev);
      if (next.has(modelId)) next.delete(modelId);
      else next.add(modelId);
      return next;
    });
  }, []);

  // Search debounce
  const handleSearch = (value: string) => {
    setSearchInput(value);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setSearch(value);
      setPageIndex(0);
    }, 300);
  };

  // Brand lookup
  const { data: brands = [] } = useQuery({
    queryKey: ['brand-lookup', holdingId],
    queryFn: () => apiClient.get<BrandLookup[]>(
      `/v_ref_brand_list?holding_id=eq.${holdingId}&is_active=is.true&order=name`
    ),
    staleTime: 5 * 60 * 1000,
  });

  // Family lookup
  const { data: families = [] } = useQuery({
    queryKey: ['family-lookup', holdingId],
    queryFn: () => apiClient.get<FamilyLookup[]>(
      `/v_ref_product_family_list?holding_id=eq.${holdingId}&is_active=is.true&order=display_name`
    ),
    staleTime: 5 * 60 * 1000,
  });

  // Lookup maps
  const brandMap = useMemo(() => {
    const map = new Map<number, string>();
    for (const b of brands) map.set(b.id, b.name);
    return map;
  }, [brands]);

  const familyMap = useMemo(() => {
    const map = new Map<number, string>();
    for (const f of families) map.set(f.id, f.display_name);
    return map;
  }, [families]);

  // Filter & sort options
  const brandOptions = brands.map((b) => ({ value: String(b.id), label: b.name }));
  const familyOptions = families.map((f) => ({ value: String(f.id), label: f.display_name }));
  const sortOptions = [
    { value: 'code.asc', label: `${t('models.modelCode')} A→Z` },
    { value: 'code.desc', label: `${t('models.modelCode')} Z→A` },
    { value: 'name.asc', label: `${t('models.modelName')} A→Z` },
    { value: 'name.desc', label: `${t('models.modelName')} Z→A` },
    { value: 'id.desc', label: t('models.newestFirst') },
    { value: 'id.asc', label: t('models.oldestFirst') },
    { value: 'updated_at.desc', label: t('models.recentlyUpdated') },
  ];

  // Build endpoint
  const buildEndpoint = useCallback(() => {
    const params: string[] = [];
    if (holdingId) params.push(`holding_id=eq.${holdingId}`);
    if (search.trim()) {
      params.push(`or=(code.ilike.*${encodeURIComponent(search.trim())}*,name.ilike.*${encodeURIComponent(search.trim())}*)`);
    }
    if (filterBrand) params.push(`brand_id=eq.${filterBrand}`);
    if (filterFamily) params.push(`family_id=eq.${filterFamily}`);
    params.push(`order=${sortBy}`);
    const qs = params.length > 0 ? `?${params.join('&')}` : '';
    return `/v_ref_product_models${qs}`;
  }, [holdingId, search, filterBrand, filterFamily, sortBy]);

  // Fetch models
  const { data, isError, error, isFetching } = useQuery({
    queryKey: ['models', pageIndex, pageSize, holdingId, search, filterBrand, filterFamily, sortBy],
    queryFn: () => apiClient.getPaginated<Model>(buildEndpoint(), { page: pageIndex + 1, pageSize }),
    placeholderData: keepPreviousData,
  });

  const models = data?.data ?? [];
  const totalCount = data?.totalCount ?? 0;

  return (
    <div className="page-content h-dvh max-h-dvh max-w-[64rem] flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex-none pb-4 space-y-3">
        <h1 className="heading-2">{t('models.title')}</h1>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
          <Input
            placeholder={t('common.search')}
            value={searchInput}
            onChange={(e) => handleSearch(e.target.value)}
            size="sm"
          />
          <div>
            <Select
              options={brandOptions}
              value={filterBrand || null}
              onChange={(val) => {
                setFilterBrand((val as string) ?? '');
                setPageIndex(0);
              }}
              placeholder={t('brandsModels.selectBrand')}
              size="sm"
              showChevron
              clearable
            />
          </div>
          <div>
            <Select
              options={familyOptions}
              value={filterFamily || null}
              onChange={(val) => {
                setFilterFamily((val as string) ?? '');
                setPageIndex(0);
              }}
              placeholder={t('models.selectFamily')}
              size="sm"
              showChevron
              clearable
            />
          </div>
          <div className="flex items-center gap-1.5 text-control-label">
            <ChevronsUpDown size={14} className="shrink-0" />
            <div className="flex-1">
              <Select
                options={sortOptions}
                value={sortBy}
                onChange={(val) => {
                  setSortBy((val as string) ?? 'code.asc');
                  setPageIndex(0);
                }}
                size="sm"
                showChevron
              />
            </div>
          </div>
        </div>
      </div>

      {isError && (
        <div className="px-6">
          <div className="border border-line bg-surface p-6 rounded-lg text-center">
            <div className="text-danger mb-4">{error instanceof Error ? error.message : t('common.error')}</div>
          </div>
        </div>
      )}

      {!isError && (
        <DataTable<Model>
          data={models}
          renderRow={(row) => {
            const model = row.original;
            const isExpanded = expandedModels.has(model.id);
            return (
              <>
                <div
                  className="flex items-center gap-3 px-3 py-2 border-b border-line hover:bg-surface-hover transition-colors cursor-pointer"
                  onClick={() => toggleExpand(model.id)}
                >
                  <div className="shrink-0 w-5">
                    {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{model.code}</div>
                    <div className="text-xs text-control-label truncate">
                      {brandMap.get(model.brand_id) ?? '—'} / {familyMap.get(model.family_id) ?? '—'}
                    </div>
                  </div>
                  <div className="shrink-0 text-xs text-control-label hidden sm:block">
                    {model.name}
                  </div>
                  <div className="shrink-0">
                    <Badge size="sm" color={model.is_active ? 'success' : 'danger'}>
                      {model.is_active ? t('brandsModels.active') : t('brandsModels.inactive')}
                    </Badge>
                  </div>
                </div>
                {isExpanded && holdingId && (
                  <div className="bg-surface border-b border-line">
                    <VariantSubRow modelId={model.id} holdingId={holdingId} />
                  </div>
                )}
              </>
            );
          }}
          enablePagination
          pageIndex={pageIndex}
          pageSize={pageSize}
          pageSizeOptions={[10, 25, 50]}
          rowCount={totalCount}
          onPageChange={({ pageIndex: pi, pageSize: ps }) => {
            setPageIndex(pi);
            setPageSize(ps);
          }}
          className={`flex-1 min-h-0 ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}
          noResults={
            <div className="p-8 text-center text-control-label">
              {t('models.noModels')}
            </div>
          }
        />
      )}
    </div>
  );
}
