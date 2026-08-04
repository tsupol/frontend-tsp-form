import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  MobileHeader, Button, Input, Modal, Switch, useSnackbarContext,
} from 'tsp-form';
import {
  ArrowRightFromLine, Plus, Pencil, CheckCircle, XCircle, ChevronRight, ChevronDown,
} from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import type { ExpenseCategory, ExpenseItem } from './branchExpenseTypes';
import { translateApiError } from '../../lib/apiErrors';

export function CategoriesPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const qc = useQueryClient();
  const { addSnackbar } = useSnackbarContext();
  const companyId = user?.company_id ?? null;

  const [editingCat, setEditingCat] = useState<ExpenseCategory | null>(null);
  const [creatingCat, setCreatingCat] = useState(false);
  // Item form: editing an existing item, or creating under a given category.
  const [editingItem, setEditingItem] = useState<ExpenseItem | null>(null);
  const [creatingItemForCat, setCreatingItemForCat] = useState<ExpenseCategory | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const { data: categories = [], isLoading } = useQuery({
    queryKey: ['branch-expense', 'categories', companyId],
    queryFn: () => apiClient.get<ExpenseCategory[]>(
      `/v_branch_expense_categories?company_id=eq.${companyId}&order=sort_order,name_th`
    ),
    enabled: companyId !== null,
  });

  // All items incl. disabled (omit is_selectable filter) so they can be re-enabled.
  const { data: items = [] } = useQuery({
    queryKey: ['branch-expense', 'items', companyId, 'all'],
    queryFn: () => apiClient.get<ExpenseItem[]>(
      `/v_branch_expense_items?company_id=eq.${companyId}&order=category_sort_order,item_sort_order`
    ),
    enabled: companyId !== null,
  });

  const itemsByCat = useMemo(() => {
    const m = new Map<number, ExpenseItem[]>();
    for (const it of items) {
      if (!m.has(it.category_id)) m.set(it.category_id, []);
      m.get(it.category_id)!.push(it);
    }
    return m;
  }, [items]);

  const toggle = (id: number) => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const onSavedSnack = (message: string) => {
    qc.invalidateQueries({ queryKey: ['branch-expense', 'categories'] });
    qc.invalidateQueries({ queryKey: ['branch-expense', 'items'] });
    addSnackbar({
      message: (
        <div className="alert alert-success">
          <CheckCircle size={16} />
          <span>{message}</span>
        </div>
      ),
      duration: 2500,
    });
  };

  return (
    <>
      <MobileHeader className="mobile-header-bordered md:hidden">
        <div className="mobile-header-start">
          <button
            className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current"
            aria-label="Open menu"
            onClick={() => window.dispatchEvent(new CustomEvent('sidemenu:open'))}
          >
            <ArrowRightFromLine size={18} />
          </button>
        </div>
        <div className="mobile-header-title mobile-header-title-truncate">
          {t('branchExpense.categories')}
        </div>
        <div className="mobile-header-end w-nav">
          <button
            className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current"
            aria-label={t('branchExpense.addCategory')}
            onClick={() => setCreatingCat(true)}
          >
            <Plus size={18} />
          </button>
        </div>
      </MobileHeader>

      <div className="page-content responsive-dvh-mobile-header">
        <div className="flex items-center justify-between mb-4 max-md:hidden">
          <div>
            <h1 className="heading-2">{t('branchExpense.categories')}</h1>
            <p className="text-sm text-subtle mt-1">{t('branchExpense.categoriesDescription')}</p>
          </div>
          <Button color="primary" size="sm" startIcon={<Plus size={16} />} onClick={() => setCreatingCat(true)}>
            {t('branchExpense.addCategory')}
          </Button>
        </div>

        {isLoading ? (
          <div className="text-sm text-subtle py-12 text-center">{t('common.loading')}</div>
        ) : categories.length === 0 ? (
          <div className="text-sm text-subtle py-12 text-center">{t('branchExpense.noCategories')}</div>
        ) : (
          <div className="border border-line rounded-lg divide-y divide-line bg-surface overflow-hidden">
            {categories.map(cat => {
              const catItems = itemsByCat.get(cat.id) ?? [];
              const isOpen = expanded.has(cat.id);
              return (
                <div key={cat.id}>
                  {/* Category row (Lv-1) */}
                  <div className={`flex items-center gap-2 px-3 py-2.5 ${!cat.is_active ? 'opacity-60' : ''}`}>
                    <button
                      type="button"
                      onClick={() => toggle(cat.id)}
                      className="shrink-0 w-6 h-6 flex items-center justify-center rounded hover:bg-surface-hover cursor-pointer bg-transparent border-none text-subtle"
                      aria-label={isOpen ? t('common.collapse') : t('common.expand')}
                    >
                      {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm font-medium truncate">{cat.name_th}</span>
                        {!cat.is_active && (
                          <span className="text-[11px] text-subtle shrink-0">{t('branchExpense.disabled')}</span>
                        )}
                      </div>
                      <div className="text-xs text-subtler truncate">{cat.code} · {catItems.length} {t('branchExpense.itemsCount')}</div>
                    </div>
                    <Button size="sm" variant="ghost" className="btn-icon-sm" startIcon={<Pencil size={14} />} onClick={() => setEditingCat(cat)} aria-label={t('common.edit')} />
                    <Button size="sm" variant="outline" startIcon={<Plus size={14} />} onClick={() => setCreatingItemForCat(cat)}>
                      {t('branchExpense.addItem')}
                    </Button>
                  </div>

                  {/* Item rows (Lv-2) */}
                  {isOpen && (
                    <div className="bg-surface-soft border-t border-line divide-y divide-line">
                      {catItems.length === 0 ? (
                        <div className="pl-11 pr-3 py-2.5 text-xs text-subtler">{t('branchExpense.noItemsInCategory')}</div>
                      ) : catItems.map(it => (
                        <button
                          key={it.item_id}
                          type="button"
                          onClick={() => setEditingItem(it)}
                          className={`w-full flex items-center gap-2 pl-11 pr-3 py-2 text-left hover:bg-surface-hover cursor-pointer bg-transparent border-none ${!it.is_active ? 'opacity-60' : ''}`}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="text-sm truncate">{it.item_name_th}</span>
                              {it.old_code && (
                                <span className="text-[11px] text-subtler shrink-0">{t('branchExpense.oldCode', { code: it.old_code })}</span>
                              )}
                              {!it.is_active && (
                                <span className="text-[11px] text-subtle shrink-0">{t('branchExpense.disabled')}</span>
                              )}
                            </div>
                          </div>
                          <Pencil size={13} className="shrink-0 text-subtle" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <CategoryFormModal
        open={creatingCat || editingCat !== null}
        editing={editingCat}
        onClose={() => { setCreatingCat(false); setEditingCat(null); }}
        onSaved={onSavedSnack}
      />

      <ItemFormModal
        open={editingItem !== null || creatingItemForCat !== null}
        editing={editingItem}
        category={creatingItemForCat}
        onClose={() => { setEditingItem(null); setCreatingItemForCat(null); }}
        onSaved={onSavedSnack}
      />
    </>
  );
}

// ── Category form ────────────────────────────────────────────────────────────

function CategoryFormModal({
  open, editing, onClose, onSaved,
}: {
  open: boolean;
  editing: ExpenseCategory | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [code, setCode] = useState('');
  const [nameTh, setNameTh] = useState('');
  const [sortOrder, setSortOrder] = useState<string>('100');
  const [isActive, setIsActive] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const lastOpenedFor = useState<number | null>(null);
  if (open && lastOpenedFor[0] !== (editing?.id ?? -1)) {
    lastOpenedFor[1](editing?.id ?? -1);
    setCode(editing?.code ?? '');
    setNameTh(editing?.name_th ?? '');
    setSortOrder(String(editing?.sort_order ?? 100));
    setIsActive(editing?.is_active ?? true);
    setError(null);
  }

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      if (editing) {
        await apiClient.rpc('fn_branch_expense_category_update', {
          p_id: editing.id,
          p_name_th: nameTh !== editing.name_th ? nameTh : null,
          p_is_active: isActive !== editing.is_active ? isActive : null,
          p_sort_order: Number(sortOrder) !== editing.sort_order ? Number(sortOrder) : null,
        });
        onSaved(t('branchExpense.categorySaved'));
      } else {
        await apiClient.rpc('fn_branch_expense_category_create', {
          p_company_id: user?.company_id,
          p_code: code.trim().toUpperCase(),
          p_name_th: nameTh.trim(),
          p_sort_order: Number(sortOrder) || 100,
        });
        onSaved(t('branchExpense.categoryCreated'));
      }
      onClose();
    } catch (e) {
      if (e instanceof ApiError) {
        const translated = translateApiError(e, t);
        setError(translated || e.message);
      } else if (e instanceof Error) {
        setError(e.message);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} maxWidth="28rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">
          {editing ? t('branchExpense.editCategory') : t('branchExpense.addCategory')}
        </h2>
        <button type="button" className="modal-close-btn" onClick={onClose}>×</button>
      </div>
      <div className="modal-content">
        <div className="form-grid">
          <div className="flex flex-col">
            <label className="form-label">{t('branchExpense.code')}</label>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder={t('branchExpense.codePlaceholder')}
              disabled={editing !== null}
              className="w-full"
            />
          </div>
          <div className="flex flex-col">
            <label className="form-label">{t('branchExpense.nameTh')}</label>
            <Input
              value={nameTh}
              onChange={(e) => setNameTh(e.target.value)}
              placeholder={t('branchExpense.nameTh')}
              className="w-full"
            />
          </div>
          <div className="flex flex-col">
            <label className="form-label">{t('branchExpense.sortOrder')}</label>
            <Input
              type="text"
              inputMode="numeric"
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value.replace(/[^0-9]/g, ''))}
              className="w-full"
            />
          </div>
          {editing && (
            <div className="flex items-center justify-between">
              <span className="text-sm">{t('branchExpense.active')}</span>
              <Switch checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            </div>
          )}
          {error && (
            <div className="alert alert-danger">
              <XCircle size={16} />
              <span>{error}</span>
            </div>
          )}
        </div>
      </div>
      <div className="modal-footer">
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          {t('common.cancel')}
        </Button>
        <Button
          color="primary"
          onClick={submit}
          disabled={busy || (!editing && (!code.trim() || !nameTh.trim())) || (editing !== null && !nameTh.trim())}
        >
          {busy ? t('common.saving') : t('common.save')}
        </Button>
      </div>
    </Modal>
  );
}

// ── Item form ────────────────────────────────────────────────────────────────

function ItemFormModal({
  open, editing, category, onClose, onSaved,
}: {
  open: boolean;
  editing: ExpenseItem | null;
  category: ExpenseCategory | null; // set when creating a new item under this category
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { t } = useTranslation();
  const [code, setCode] = useState('');
  const [nameTh, setNameTh] = useState('');
  const [oldCode, setOldCode] = useState('');
  const [sortOrder, setSortOrder] = useState<string>('100');
  const [isActive, setIsActive] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const lastOpenedFor = useState<number | null>(null);
  if (open && lastOpenedFor[0] !== (editing?.item_id ?? -1)) {
    lastOpenedFor[1](editing?.item_id ?? -1);
    setCode(editing?.item_code ?? '');
    setNameTh(editing?.item_name_th ?? '');
    setOldCode(editing?.old_code ?? '');
    setSortOrder(String(editing?.item_sort_order ?? 100));
    setIsActive(editing?.is_active ?? true);
    setError(null);
  }

  const catName = editing?.category_name_th ?? category?.name_th ?? '';

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      if (editing) {
        // No re-parent — only name / old_code / sort / active are editable.
        await apiClient.rpc('fn_branch_expense_item_update', {
          p_id: editing.item_id,
          p_name_th: nameTh !== editing.item_name_th ? nameTh : null,
          p_old_code: oldCode !== (editing.old_code ?? '') ? (oldCode.trim() || null) : null,
          p_is_active: isActive !== editing.is_active ? isActive : null,
          p_sort_order: Number(sortOrder) !== editing.item_sort_order ? Number(sortOrder) : null,
        });
        onSaved(t('branchExpense.itemSaved'));
      } else if (category) {
        await apiClient.rpc('fn_branch_expense_item_create', {
          p_category_id: category.id,
          p_code: code.trim().toUpperCase(),
          p_name_th: nameTh.trim(),
          p_old_code: oldCode.trim() || null,
          p_sort_order: Number(sortOrder) || 100,
        });
        onSaved(t('branchExpense.itemCreated'));
      }
      onClose();
    } catch (e) {
      if (e instanceof ApiError) {
        const translated = translateApiError(e, t);
        setError(translated || e.message);
      } else if (e instanceof Error) {
        setError(e.message);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} maxWidth="28rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">
          {editing ? t('branchExpense.editItem') : t('branchExpense.addItem')}
        </h2>
        <button type="button" className="modal-close-btn" onClick={onClose}>×</button>
      </div>
      <div className="modal-content">
        {catName && (
          <div className="px-3 py-2 rounded-md bg-surface border border-line mb-4 text-sm">
            <span className="text-subtle">{t('branchExpense.category')}: </span>{catName}
          </div>
        )}
        <div className="form-grid">
          <div className="flex flex-col">
            <label className="form-label">{t('branchExpense.code')}</label>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder={t('branchExpense.codePlaceholder')}
              disabled={editing !== null}
              className="w-full"
            />
          </div>
          <div className="flex flex-col">
            <label className="form-label">{t('branchExpense.nameTh')}</label>
            <Input value={nameTh} onChange={(e) => setNameTh(e.target.value)} className="w-full" />
          </div>
          <div className="flex flex-col">
            <label className="form-label">{t('branchExpense.oldCodeLabel')}</label>
            <Input
              value={oldCode}
              onChange={(e) => setOldCode(e.target.value)}
              placeholder={t('branchExpense.oldCodePlaceholder')}
              className="w-full"
            />
          </div>
          <div className="flex flex-col">
            <label className="form-label">{t('branchExpense.sortOrder')}</label>
            <Input
              type="text"
              inputMode="numeric"
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value.replace(/[^0-9]/g, ''))}
              className="w-full"
            />
          </div>
          {editing && (
            <div className="flex items-center justify-between">
              <span className="text-sm">{t('branchExpense.active')}</span>
              <Switch checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            </div>
          )}
          {error && (
            <div className="alert alert-danger">
              <XCircle size={16} />
              <span>{error}</span>
            </div>
          )}
        </div>
      </div>
      <div className="modal-footer">
        <Button variant="ghost" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
        <Button
          color="primary"
          onClick={submit}
          disabled={busy || (!editing && (!code.trim() || !nameTh.trim())) || (editing !== null && !nameTh.trim())}
        >
          {busy ? t('common.saving') : t('common.save')}
        </Button>
      </div>
    </Modal>
  );
}
