// Intake Owner Config — admin sets the DEFAULT owner (HOLDING / COMPANY / BRANCH) per
// intake channel, at two levels:
//   Panel A — company template: branch_type × channel grid (15 cells). Applies to NEW branches.
//   Panel B — branch override: one branch × 5 channels, owner_type limited to the branch's
//             allowed set. "Reset to template" re-pulls the company template into the branch.
//
// Doc: UI_SUMMARY/125_INTAKE_OWNER_CONFIG.md · work order: UI_FEEDBACK/2026-07-10_IMPLEMENT_intake_owner_config.md
// Each cell autosaves on change (per-cell RPC). This is a settings grid, not a form — no dirty guard.
//
// NOTE: channel labels come from i18n (channel.*), not v_ref_intake_channels — that view is 403
// for COMPANY_ADMIN (BE grant gap, UI_FEEDBACK/2026-07-11_NOTICE_intake_channels_view_403.md).

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Select, Switch, Button, MobileHeader, useSnackbarContext } from 'tsp-form';
import { ArrowRightFromLine, CheckCircle, XCircle, RotateCcw, Info } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { translateApiError } from '../../lib/apiErrors';
import {
  INTAKE_CHANNELS, BRANCH_TYPES, type OwnerType, type IntakeChannel, type BranchType,
} from '../../lib/ownerTypes';

const ADMIN_ROLES = ['COMPANY_ADMIN', 'HOLDING_ADMIN', 'SYSTEM_DEV'];

interface CompanyLookup { id: number; name: string; }
interface BranchLookup { id: number; name: string; branch_type: BranchType; company_id: number; }
interface RefOwnerType { code: OwnerType; name_th: string; name_en: string; sort_order: number; is_active: boolean; }

interface TemplateCell { branch_type: BranchType; channel: IntakeChannel; default_owner_type: OwnerType; allow_user_override: boolean; }
interface BranchCell { channel: IntakeChannel; default_owner_type: OwnerType; allow_user_override: boolean; }
interface BranchConfig { branch_id: number; branch_type: BranchType; allowed_owner_types: OwnerType[]; cells: BranchCell[]; }

// Channel × branch_type combos that don't make sense are hidden in the grid.
// (doc §5: e.g. channel DEAL_PARTNER only on branch_type DEAL_PARTNER.)
function channelApplies(channel: IntakeChannel, branchType: BranchType): boolean {
  if (channel === 'DEAL_PARTNER') return branchType === 'DEAL_PARTNER';
  return true;
}

export function OwnerConfigPage() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();
  const { user } = useAuth();
  const canEdit = ADMIN_ROLES.includes(user?.role_code ?? '');

  const [companyId, setCompanyId] = useState<number | null>(user?.company_id ?? null);
  const [branchId, setBranchId] = useState<number | null>(null);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<'template' | 'branch'>('template');

  // ── lookups ──
  const { data: companies = [] } = useQuery({
    queryKey: ['owner-config-companies'],
    queryFn: () => apiClient.get<CompanyLookup[]>('/v_companies?select=id,name&is_active=is.true&order=name'),
  });
  const { data: ownerTypeRefs = [] } = useQuery({
    queryKey: ['ref-owner-types'],
    queryFn: () => apiClient.get<RefOwnerType[]>('/v_ref_owner_types?is_active=is.true&order=sort_order'),
  });

  const effectiveCompanyId = companyId ?? companies[0]?.id ?? null;

  const { data: branches = [] } = useQuery({
    queryKey: ['owner-config-branches', effectiveCompanyId],
    queryFn: () => apiClient.get<BranchLookup[]>(
      `/v_branches?select=id,name,branch_type,company_id&is_active=is.true&company_id=eq.${effectiveCompanyId}&order=name`,
    ),
    enabled: effectiveCompanyId != null,
  });

  // ── panel A: company template ──
  const { data: template } = useQuery({
    queryKey: ['owner-template', effectiveCompanyId],
    queryFn: () => apiClient.rpc<{ company_id: number; cells: TemplateCell[] }>(
      'fn_get_company_owner_template', { p_company_id: effectiveCompanyId },
    ),
    enabled: effectiveCompanyId != null,
  });

  // ── panel B: branch config ──
  const { data: branchConfig } = useQuery({
    queryKey: ['owner-branch-config', branchId],
    queryFn: () => apiClient.rpc<BranchConfig>('fn_get_branch_owner_config', { p_branch_id: branchId }),
    enabled: branchId != null,
  });

  const ownerLabel = (code: OwnerType): string => {
    const ref = ownerTypeRefs.find(r => r.code === code);
    if (ref) return i18n.language === 'th' ? ref.name_th : ref.name_en;
    return t(`ownerType.${code}`);
  };
  const ownerOptions = (allowed: OwnerType[]) =>
    allowed.map(code => ({ value: code, label: ownerLabel(code) }));

  const companyOptions = useMemo(() => companies.map(c => ({ value: String(c.id), label: c.name })), [companies]);
  const branchOptions = useMemo(
    () => branches.map(b => ({ value: String(b.id), label: `${b.name} · ${t(`branchType.${b.branch_type}`)}` })),
    [branches, t],
  );

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
      const translated = translateApiError(err, t);
      return translated || err.message;
    }
    return t('common.error');
  };

  // ── template cell save ──
  const saveTemplateCell = async (
    branchType: BranchType, channel: IntakeChannel, ownerType: OwnerType, override: boolean,
  ) => {
    const k = `t:${branchType}:${channel}`;
    setPending(p => new Set(p).add(k));
    try {
      await apiClient.rpc('fn_set_company_owner_template', {
        p_company_id: effectiveCompanyId,
        p_branch_type: branchType,
        p_channel: channel,
        p_owner_type: ownerType,
        p_allow_user_override: override,
      });
      await queryClient.invalidateQueries({ queryKey: ['owner-template', effectiveCompanyId] });
      notify(true, t('ownerConfig.saved'));
    } catch (err) {
      notify(false, translateErr(err));
    } finally {
      setPending(p => { const n = new Set(p); n.delete(k); return n; });
    }
  };

  // ── branch cell save ──
  const saveBranchCell = async (channel: IntakeChannel, ownerType: OwnerType, override: boolean) => {
    const k = `b:${channel}`;
    setPending(p => new Set(p).add(k));
    try {
      await apiClient.rpc('fn_set_branch_owner_config', {
        p_branch_id: branchId,
        p_channel: channel,
        p_owner_type: ownerType,
        p_allow_user_override: override,
      });
      await queryClient.invalidateQueries({ queryKey: ['owner-branch-config', branchId] });
      notify(true, t('ownerConfig.saved'));
    } catch (err) {
      notify(false, translateErr(err));
    } finally {
      setPending(p => { const n = new Set(p); n.delete(k); return n; });
    }
  };

  const resyncBranch = async () => {
    setPending(p => new Set(p).add('resync'));
    try {
      await apiClient.rpc('fn_resync_branch_owner_config', { p_branch_id: branchId });
      await queryClient.invalidateQueries({ queryKey: ['owner-branch-config', branchId] });
      notify(true, t('ownerConfig.resyncDone'));
    } catch (err) {
      notify(false, translateErr(err));
    } finally {
      setPending(p => { const n = new Set(p); n.delete('resync'); return n; });
    }
  };

  const templateCell = (branchType: BranchType, channel: IntakeChannel) =>
    template?.cells.find(c => c.branch_type === branchType && c.channel === channel);

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
        <div className="mobile-header-title mobile-header-title-truncate">{t('ownerConfig.title')}</div>
        <div className="mobile-header-end w-nav" />
      </MobileHeader>

      <div className="page-content responsive-dvh-mobile-header overflow-auto better-scroll">
        {/* Header */}
        <div className="mb-4 flex-none max-md:hidden">
          <h1 className="heading-2">{t('ownerConfig.title')}</h1>
          <p className="text-sm text-subtle mt-1">{t('ownerConfig.description')}</p>
        </div>

        {/* Company selector */}
        <div className="flex items-end gap-3 pb-5 flex-wrap">
          <div className="flex flex-col">
            <span className="form-label">{t('ownerConfig.company')}</span>
            <div style={{ width: '18rem' }}>
              <Select
                options={companyOptions}
                value={effectiveCompanyId != null ? String(effectiveCompanyId) : null}
                onChange={(v) => { setCompanyId(v ? Number(v as string) : null); setBranchId(null); }}
                size="sm"
                searchable={companyOptions.length > 6}
              />
            </div>
          </div>
        </div>

        {/* Tabs — template vs per-branch override */}
        <div className="flex items-center gap-1 border-b border-line mb-5">
          {(['template', 'branch'] as const).map((tk) => (
            <button
              key={tk}
              type="button"
              onClick={() => setTab(tk)}
              className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors cursor-pointer bg-transparent ${
                tab === tk ? 'border-primary text-primary-fg' : 'border-transparent text-subtle hover:text-fg'
              }`}
            >
              {tk === 'template' ? t('ownerConfig.templateTitle') : t('ownerConfig.branchTitle')}
            </button>
          ))}
        </div>

        {/* ── Panel A: company template ── */}
        {tab === 'template' && (
        <section className="pb-8">
          <div className="mb-2">
            <p className="text-sm text-subtle flex items-start gap-1.5">
              <Info size={14} className="mt-0.5 shrink-0" />
              <span>{t('ownerConfig.templateHint')}</span>
            </p>
          </div>

          {/* One card (row) per branch-type; channels inside flow as a responsive grid. */}
          <div className="flex flex-col gap-4">
            {BRANCH_TYPES.map(bt => (
              <div key={bt} className="border border-line rounded-lg overflow-hidden">
                <div className="px-4 py-2.5 bg-surface-soft border-b border-line font-medium">
                  {t(`branchType.${bt}`)}
                </div>
                <div className="grid gap-x-6 gap-y-4 p-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                  {INTAKE_CHANNELS.filter(ch => channelApplies(ch, bt)).map(ch => {
                    const cell = templateCell(bt, ch);
                    const busy = pending.has(`t:${bt}:${ch}`);
                    return (
                      <ChannelRow
                        key={ch}
                        label={t(`channel.${ch}`)}
                        ownerOptions={ownerOptions(['HOLDING', 'COMPANY', 'BRANCH'])}
                        ownerType={cell?.default_owner_type ?? null}
                        override={cell?.allow_user_override ?? false}
                        busy={busy}
                        disabled={!canEdit || !cell}
                        overrideLabel={t('ownerConfig.allowOverride')}
                        onOwnerChange={(v) => cell && saveTemplateCell(bt, ch, v, cell.allow_user_override)}
                        onOverrideChange={(next) => cell && saveTemplateCell(bt, ch, cell.default_owner_type, next)}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>
        )}

        {/* ── Panel B: branch override ── */}
        {tab === 'branch' && (
        <section className="pb-8">
          <div className="mb-2">
            <p className="text-sm text-subtle">{t('ownerConfig.branchHint')}</p>
          </div>

          <div className="flex items-end gap-3 pb-4 flex-wrap">
            <div className="flex flex-col">
              <span className="form-label">{t('ownerConfig.branch')}</span>
              <div style={{ width: '20rem' }}>
                <Select
                  options={branchOptions}
                  value={branchId != null ? String(branchId) : null}
                  onChange={(v) => setBranchId(v ? Number(v as string) : null)}
                  size="sm"
                  clearable
                  placeholder={t('ownerConfig.selectBranch')}
                  searchable={branchOptions.length > 6}
                />
              </div>
            </div>
            {branchId != null && (
              <Button
                variant="outline"
                size="sm"
                startIcon={<RotateCcw size={14} />}
                onClick={resyncBranch}
                disabled={!canEdit || pending.has('resync')}
              >
                {t('ownerConfig.resetToTemplate')}
              </Button>
            )}
          </div>

          {branchId != null && branchConfig && (
            <div className="border border-line rounded-lg grid gap-x-6 gap-y-4 p-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              {INTAKE_CHANNELS
                .filter(ch => channelApplies(ch, branchConfig.branch_type))
                .map(ch => {
                  const cell = branchConfig.cells.find(c => c.channel === ch);
                  const busy = pending.has(`b:${ch}`);
                  return (
                    <ChannelRow
                      key={ch}
                      label={t(`channel.${ch}`)}
                      ownerOptions={ownerOptions(branchConfig.allowed_owner_types)}
                      ownerType={cell?.default_owner_type ?? null}
                      override={cell?.allow_user_override ?? false}
                      busy={busy}
                      disabled={!canEdit || !cell}
                      overrideLabel={t('ownerConfig.allowOverride')}
                      onOwnerChange={(v) => cell && saveBranchCell(ch, v, cell.allow_user_override)}
                      onOverrideChange={(next) => cell && saveBranchCell(ch, cell.default_owner_type, next)}
                    />
                  );
                })}
            </div>
          )}
        </section>
        )}
      </div>
    </>
  );
}

// One channel's config: label + owner dropdown + "let staff choose" toggle.
// Stacks vertically inside a branch-type card so it never needs horizontal scroll.
function ChannelRow({
  label, ownerOptions, ownerType, override, busy, disabled, overrideLabel,
  onOwnerChange, onOverrideChange,
}: {
  label: string;
  ownerOptions: { value: string; label: string }[];
  ownerType: OwnerType | null;
  override: boolean;
  busy: boolean;
  disabled: boolean;
  overrideLabel: string;
  onOwnerChange: (v: OwnerType) => void;
  onOverrideChange: (next: boolean) => void;
}) {
  return (
    <div className={`flex flex-col gap-2 ${busy ? 'opacity-50' : ''}`}>
      <div className="text-sm font-medium">{label}</div>
      <Select
        options={ownerOptions}
        value={ownerType}
        onChange={(v) => onOwnerChange(v as OwnerType)}
        size="sm"
        searchable={false}
        disabled={disabled || busy}
      />
      <label className="flex items-center gap-2 text-xs text-subtle cursor-pointer">
        <Switch
          size="sm"
          checked={override}
          onChange={(e) => onOverrideChange(e.target.checked)}
          disabled={disabled || busy}
        />
        {overrideLabel}
      </label>
    </div>
  );
}
