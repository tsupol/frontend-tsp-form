import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Select } from 'tsp-form';
import { apiClient } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { canPickScope, type Scope } from '../lib/scope';

interface CompanyLookup { id: number; name: string; holding_id: number }
interface BranchLookup  { id: number; name: string; company_id: number }

interface Props {
  scope: Scope;
  onChange: (scope: Scope) => void;
}

export function DashboardScopePicker({ scope, onChange }: Props) {
  const { t } = useTranslation();
  const { user } = useAuth();

  const role = user?.role_code;
  const showPicker = canPickScope(user);

  // For HA/SYSTEM_DEV: list of companies in their holding (RLS scopes for HA).
  const companiesQuery = useQuery({
    queryKey: ['scope-picker', 'companies', user?.holding_id ?? 'all'],
    queryFn: () => apiClient.get<CompanyLookup[]>('/v_companies?select=id,name,holding_id&is_active=is.true&order=name'),
    enabled: showPicker && (role === 'HOLDING_ADMIN' || role === 'SYSTEM_DEV'),
  });

  // For CA/HA/SYSTEM_DEV: list of branches in their visible scope.
  const branchesQuery = useQuery({
    queryKey: ['scope-picker', 'branches'],
    queryFn: () => apiClient.get<BranchLookup[]>('/v_branches?select=id,name,company_id&is_active=is.true&branch_type=eq.INTERNAL&order=name'),
    enabled: showPicker,
  });

  const options = useMemo(() => {
    const opts: Array<{ value: string; label: string }> = [];
    if (role === 'COMPANY_ADMIN' && user?.company_id != null) {
      opts.push({ value: `c${user.company_id}`, label: t('dashboard.scope.wholeCompany') });
      for (const b of branchesQuery.data ?? []) {
        if (b.company_id === user.company_id) {
          opts.push({ value: `b${b.id}`, label: b.name });
        }
      }
    } else if (role === 'HOLDING_ADMIN' && user?.holding_id != null) {
      opts.push({ value: `h${user.holding_id}`, label: t('dashboard.scope.wholeHolding') });
      for (const c of companiesQuery.data ?? []) {
        opts.push({ value: `c${c.id}`, label: c.name });
      }
      for (const b of branchesQuery.data ?? []) {
        opts.push({ value: `b${b.id}`, label: `— ${b.name}` });
      }
    } else if (role === 'SYSTEM_DEV') {
      opts.push({ value: 'all', label: t('dashboard.scope.all') });
      for (const c of companiesQuery.data ?? []) {
        opts.push({ value: `c${c.id}`, label: c.name });
      }
      for (const b of branchesQuery.data ?? []) {
        opts.push({ value: `b${b.id}`, label: `— ${b.name}` });
      }
    }
    return opts;
  }, [role, user, companiesQuery.data, branchesQuery.data, t]);

  if (!showPicker) return null;

  const value = scopeToValue(scope);

  return (
    <div style={{ width: '16rem' }}>
      <Select
        size="sm"
        options={options}
        value={value}
        onChange={(v) => onChange(valueToScope(v as string))}
        searchable
      />
    </div>
  );
}

function scopeToValue(scope: Scope): string {
  switch (scope.kind) {
    case 'branch':  return `b${scope.branchId}`;
    case 'company': return `c${scope.companyId}`;
    case 'holding': return `h${scope.holdingId}`;
    case 'all':     return 'all';
  }
}

function valueToScope(v: string): Scope {
  if (v === 'all') return { kind: 'all' };
  const id = parseInt(v.slice(1), 10);
  if (v.startsWith('b')) return { kind: 'branch',  branchId: id };
  if (v.startsWith('c')) return { kind: 'company', companyId: id };
  if (v.startsWith('h')) return { kind: 'holding', holdingId: id };
  return { kind: 'all' };
}
