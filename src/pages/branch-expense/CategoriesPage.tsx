import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  MobileHeader, Button, Input, Modal, Switch, useSnackbarContext,
} from 'tsp-form';
import {
  ArrowRightFromLine, Plus, Tag, Pencil, CheckCircle, XCircle,
} from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import type { ExpenseCategory } from './branchExpenseTypes';

export function CategoriesPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const qc = useQueryClient();
  const { addSnackbar } = useSnackbarContext();
  const companyId = user?.company_id ?? null;

  const [editing, setEditing] = useState<ExpenseCategory | null>(null);
  const [creating, setCreating] = useState(false);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['branch-expense', 'categories', companyId],
    queryFn: () => apiClient.get<ExpenseCategory[]>(
      `/v_branch_expense_categories?company_id=eq.${companyId}&order=sort_order,name_th`
    ),
    enabled: companyId !== null,
  });

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
            onClick={() => setCreating(true)}
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
          <Button color="primary" size="sm" startIcon={<Plus size={16} />} onClick={() => setCreating(true)}>
            {t('branchExpense.addCategory')}
          </Button>
        </div>

        {isLoading ? (
          <div className="text-sm text-subtle py-12 text-center">{t('common.loading')}</div>
        ) : rows.length === 0 ? (
          <div className="text-sm text-subtle py-12 text-center">{t('branchExpense.noCategories')}</div>
        ) : (
          <div className="border border-line rounded-lg divide-y divide-line bg-surface">
            {rows.map(r => (
              <button
                key={r.id}
                type="button"
                onClick={() => setEditing(r)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-item-hover-bg cursor-pointer bg-transparent border-none"
              >
                <Tag size={16} className="shrink-0 text-subtle" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{r.name_th}</div>
                  <div className="text-xs text-subtle truncate">{r.code}</div>
                </div>
                {!r.is_active && (
                  <span className="text-xs text-subtle">{t('branchExpense.inactive')}</span>
                )}
                <Pencil size={14} className="shrink-0 text-subtle" />
              </button>
            ))}
          </div>
        )}
      </div>

      <CategoryFormModal
        open={creating || editing !== null}
        editing={editing}
        onClose={() => { setCreating(false); setEditing(null); }}
        onSaved={(message) => {
          qc.invalidateQueries({ queryKey: ['branch-expense', 'categories'] });
          addSnackbar({
            message: (
              <div className="alert alert-success">
                <CheckCircle size={16} />
                <span>{message}</span>
              </div>
            ),
            duration: 2500,
          });
        }}
      />
    </>
  );
}

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

  // Reset on open
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
        const translated = (e.messageKey ? t(e.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
          || (e.code ? t(e.code, { ns: 'apiErrors', defaultValue: '' }) : '');
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
