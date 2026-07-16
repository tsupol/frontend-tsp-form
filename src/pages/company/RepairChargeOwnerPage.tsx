// Repair Charge-Owner Config — company sets who recognizes repair-payment revenue:
//   COMPANY (default) or HOLDING (central fund). Optionally lets each branch override.
// Drives sale.company_charge_owner_config + core.branch_charge_owner_config.
//
// Doc: UI_FEEDBACK/2026-07-15_REPAIR_OWNER_CONFIG.md · design: DB_DEV/2026-07-15_BE6_REPAIR_OWNER_CONFIG_DESIGN.md
// v1 owner options are COMPANY / HOLDING only — BRANCH is rejected by the setter
// (SALE.VALIDATION.OWNER_TYPE_NOT_ENABLED). charge_type = REPAIR_PAYMENT (REPAIR_REFUND follows automatically).
//
// Autosaves per control (settings screen, not a form) — no dirty guard. Gate: COMPANY.UPDATE
// (COMPANY_ADMIN / HOLDING_ADMIN / SYSTEM_DEV). HOLDING_ADMIN has no company in JWT, so a
// company selector is shown when the user is holding-scoped.

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Select, Switch, MobileHeader, useSnackbarContext } from 'tsp-form';
import { ArrowRightFromLine, CheckCircle, XCircle, Info } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';

const ADMIN_ROLES = ['COMPANY_ADMIN', 'HOLDING_ADMIN', 'SYSTEM_DEV'];
const CHARGE_TYPE = 'REPAIR_PAYMENT';

// v1: BRANCH is intentionally absent — the setter rejects it until branch buckets ship.
type ChargeOwnerType = 'COMPANY' | 'HOLDING';
const OWNER_OPTIONS: ChargeOwnerType[] = ['COMPANY', 'HOLDING'];

interface CompanyLookup { id: number; name: string; }
interface BranchLookup { id: number; name: string; company_id: number; }
interface BranchOverride { branch_id: number; owner_type: ChargeOwnerType; }
interface ChargeOwnerConfig {
  company_id: number;
  company_name: string;
  charge_type: string;
  default_owner_type: ChargeOwnerType;
  allow_branch_override: boolean;
  branch_overrides: BranchOverride[];
}

export function RepairChargeOwnerPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();
  const { user } = useAuth();
  const canEdit = ADMIN_ROLES.includes(user?.role_code ?? '');

  const [companyId, setCompanyId] = useState<number | null>(user?.company_id ?? null);
  const [pending, setPending] = useState<Set<string>>(new Set());

  // Company selector — only needed when the user isn't already scoped to one company
  // (HOLDING_ADMIN / SYSTEM_DEV). COMPANY_ADMIN sees their own company only.
  const showCompanyPicker = user?.company_id == null;

  const { data: companies = [] } = useQuery({
    queryKey: ['charge-owner-companies'],
    queryFn: () => apiClient.get<CompanyLookup[]>('/v_companies?select=id,name&is_active=is.true&order=name'),
    enabled: showCompanyPicker,
  });

  const effectiveCompanyId = companyId ?? (showCompanyPicker ? companies[0]?.id ?? null : user?.company_id ?? null);

  const { data: config } = useQuery({
    queryKey: ['charge-owner-config', effectiveCompanyId],
    queryFn: async () => {
      const rows = await apiClient.get<ChargeOwnerConfig[]>(
        `/v_charge_owner_config?charge_type=eq.${CHARGE_TYPE}&company_id=eq.${effectiveCompanyId}&limit=1`,
      );
      return rows[0] ?? null;
    },
    enabled: effectiveCompanyId != null,
  });

  const { data: branches = [] } = useQuery({
    queryKey: ['charge-owner-branches', effectiveCompanyId],
    queryFn: () => apiClient.get<BranchLookup[]>(
      `/v_branches?select=id,name,company_id&is_active=is.true&company_id=eq.${effectiveCompanyId}&order=name`,
    ),
    enabled: effectiveCompanyId != null && !!config?.allow_branch_override,
  });

  const companyOptions = useMemo(() => companies.map(c => ({ value: String(c.id), label: c.name })), [companies]);
  const ownerOptions = useMemo(
    () => OWNER_OPTIONS.map(code => ({ value: code, label: t(`owners.${code}`) })),
    [t],
  );

  const overrideByBranch = useMemo(() => {
    const m = new Map<number, ChargeOwnerType>();
    (config?.branch_overrides ?? []).forEach(o => m.set(o.branch_id, o.owner_type));
    return m;
  }, [config]);

  const notify = (ok: boolean, msg: string) =>
    addSnackbar({
      message: (
        <div className={`alert alert-${ok ? 'success' : 'danger'}`}>
          {ok ? <CheckCircle size={16} /> : <XCircle size={16} />}
          <span>{msg}</span>
        </div>
      ),
    });

  const translateErr = (err: unknown): string => {
    if (err instanceof ApiError) {
      const translated = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
        || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
      return translated || err.message;
    }
    return t('common.error');
  };

  // Company default + allow-branch-override both go through the one setter.
  const saveCompany = async (ownerType: ChargeOwnerType, allowOverride: boolean) => {
    if (effectiveCompanyId == null) return;
    setPending(p => new Set(p).add('company'));
    try {
      await apiClient.rpc('fn_set_company_charge_owner', {
        p_company_id: effectiveCompanyId,
        p_charge_type: CHARGE_TYPE,
        p_owner_type: ownerType,
        p_allow_branch_override: allowOverride,
      });
      await queryClient.invalidateQueries({ queryKey: ['charge-owner-config', effectiveCompanyId] });
      notify(true, t('repairChargeOwner.saved'));
    } catch (err) {
      notify(false, translateErr(err));
    } finally {
      setPending(p => { const n = new Set(p); n.delete('company'); return n; });
    }
  };

  const saveBranch = async (branchId: number, ownerType: ChargeOwnerType) => {
    const k = `b:${branchId}`;
    setPending(p => new Set(p).add(k));
    try {
      await apiClient.rpc('fn_set_branch_charge_owner', {
        p_branch_id: branchId,
        p_charge_type: CHARGE_TYPE,
        p_owner_type: ownerType,
      });
      await queryClient.invalidateQueries({ queryKey: ['charge-owner-config', effectiveCompanyId] });
      notify(true, t('repairChargeOwner.saved'));
    } catch (err) {
      notify(false, translateErr(err));
    } finally {
      setPending(p => { const n = new Set(p); n.delete(k); return n; });
    }
  };

  const companyBusy = pending.has('company');

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
        <div className="mobile-header-title mobile-header-title-truncate">{t('repairChargeOwner.title')}</div>
        <div className="mobile-header-end w-nav" />
      </MobileHeader>

      <div className="page-content responsive-dvh-mobile-header overflow-auto better-scroll">
        <div className="mb-4 flex-none max-md:hidden">
          <h1 className="heading-2">{t('repairChargeOwner.title')}</h1>
          <p className="text-sm text-subtle mt-1">{t('repairChargeOwner.description')}</p>
        </div>

        {showCompanyPicker && (
          <div className="flex items-end gap-3 pb-5 flex-wrap">
            <div className="flex flex-col">
              <span className="form-label">{t('repairChargeOwner.company')}</span>
              <div style={{ width: '18rem' }}>
                <Select
                  options={companyOptions}
                  value={effectiveCompanyId != null ? String(effectiveCompanyId) : null}
                  onChange={(v) => setCompanyId(v ? Number(v as string) : null)}
                  size="sm"
                  searchable={companyOptions.length > 6}
                />
              </div>
            </div>
          </div>
        )}

        {config && (
          <div className="max-w-xl flex flex-col gap-5">
            {/* Company default owner */}
            <section className="border border-line rounded-lg p-4">
              <div className="text-sm font-medium mb-1">{t('repairChargeOwner.defaultOwner')}</div>
              <p className="text-xs text-subtle mb-3">{t('repairChargeOwner.defaultOwnerHint')}</p>
              <div style={{ width: '18rem' }}>
                <Select
                  options={ownerOptions}
                  value={config.default_owner_type}
                  onChange={(v) => saveCompany(v as ChargeOwnerType, config.allow_branch_override)}
                  size="sm"
                  searchable={false}
                  disabled={!canEdit || companyBusy}
                />
              </div>
            </section>

            {/* Allow branch override */}
            <section className="border border-line rounded-lg p-4">
              <label className="flex items-start gap-3 cursor-pointer">
                <Switch
                  size="sm"
                  checked={config.allow_branch_override}
                  onChange={(e) => saveCompany(config.default_owner_type, e.target.checked)}
                  disabled={!canEdit || companyBusy}
                />
                <span className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">{t('repairChargeOwner.allowBranchOverride')}</span>
                  <span className="text-xs text-subtle">{t('repairChargeOwner.allowBranchOverrideHint')}</span>
                </span>
              </label>

              {/* Per-branch override list — only when the company allows it */}
              {config.allow_branch_override && (
                <div className="mt-4 pt-4 border-t border-line flex flex-col gap-3">
                  {branches.length === 0 ? (
                    <p className="text-xs text-subtler flex items-center gap-1.5">
                      <Info size={14} className="shrink-0" />
                      {t('repairChargeOwner.noBranches')}
                    </p>
                  ) : (
                    branches.map(b => {
                      const busy = pending.has(`b:${b.id}`);
                      // No override row → branch inherits company default.
                      const value = overrideByBranch.get(b.id) ?? config.default_owner_type;
                      return (
                        <div key={b.id} className={`flex items-center justify-between gap-3 ${busy ? 'opacity-50' : ''}`}>
                          <span className="text-sm truncate">{b.name}</span>
                          <div style={{ width: '12rem' }} className="shrink-0">
                            <Select
                              options={ownerOptions}
                              value={value}
                              onChange={(v) => saveBranch(b.id, v as ChargeOwnerType)}
                              size="sm"
                              searchable={false}
                              disabled={!canEdit || busy}
                            />
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </>
  );
}
