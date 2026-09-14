import { useState, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useForm, Controller } from 'react-hook-form';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DataTable, DataTableColumnHeader, DataTableFooter, MobileHeader,
  Button, Select, Modal, Badge, TextArea, MaskedInput, FormErrorMessage,
  type ColumnDef, type SortingState,
} from 'tsp-form';
import { ArrowRightFromLine, Pencil, Undo2, ChevronsRight, Receipt, ShieldCheck, Undo, Landmark } from 'lucide-react';
import { apiClient } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { translateApiError } from '../../lib/apiErrors';
import { ModalErrorBand } from '../../components/ModalErrorBand';
import { ActionDoneView } from '../contracts/ActionDoneView';
import {
  ClawbackTiersEditor, validateClawbackTiers, renumberTiers, type ClawbackTier,
} from '../../components/ClawbackTiersEditor';
import {
  DealPartnerPayoutAccountField, useRefBanks, validatePayoutAccount,
  payoutAccountDigits, EMPTY_PAYOUT_VALUE, type DealPartnerPayoutValue,
} from '../../components/DealPartnerPayoutAccountField';
import { DealPartnerCompanySection } from '../../components/DealPartnerCompanySection';

// ============================================================================
// Deal partner terms — mig 1154/1155 model, extended by migs 1173/1191/1192.
//
// The page is named "เงื่อนไข Deal Partner" (owner 09-09) rather than
// "ค่าคอม …" because it now carries four separate terms of the deal:
// commission, contract fee (ค่าทำสัญญา), the guarantee return fee
// (ค่าคืนเครื่องในระยะประกัน), and the return branch.
//
// Two levels, nothing in between:
//   1. Holding policy (v_deal_partner_policy, 1 row): allowed range for the
//      TOTAL commission (branch % + company %) plus the defaults a brand-new
//      DEAL_PARTNER branch is seeded with (trigger-side, no FE involvement).
//      mig 1173 adds the same shape for the contract fee — doc_fee_min/max/
//      default, in whole baht — and mig 1191 repeats it once more for the
//      guarantee return fee. Edited via fn_deal_partner_policy_set {p_patch}.
//   2. Per-branch config (v_deal_partner_branch_configs, 1 row per partner
//      branch): branch % + company %, whose sum must stay inside the policy
//      range, plus that shop's own doc_fee_amount and guarantee_return_fee_
//      amount, each inside its matching policy band.
//      company % > 0 derives risk_party = COMPANY — display-only fact,
//      never a separate input. Edited via fn_deal_partner_branch_config_set.
//
// The contract fee is the shop's, not the customer's discount: the shop
// collects it on signing day and remits it to the company (bill line, phase 3).
// Internal branches have none — this page only lists DEAL_PARTNER branches.
//
// The guarantee return fee goes the other way: if the customer returns the
// device inside the guarantee window (30 days, 60 with an uplift), they get
// every baht back AND the branch pays this on top. Stored as policy rather
// than hardcoded. mig 1191 first put it on the FIN1 policy; mig 1192 moved it
// here days later — along with the window itself (guarantee_days /
// guarantee_days_uplift) and approved_ttl_days — because internal branches
// have no device guarantee: these are terms of the deal-partner arrangement,
// not FIN1 policy. Price/plan RPCs answer guarantee_days: null for internal
// branches and the UI hides the line. The return flow is not built yet.
//
// The old scoped rates (fn_deal_partner_rate_upsert / set_active) are
// deprecated — any p_scope other than HOLDING now answers DEPRECATED_SCOPE.
// ============================================================================

interface PolicyRow {
  holding_id: number;
  holding_name: string;
  total_min: number;
  total_max: number;
  branch_rate_default: number;
  company_rate_default: number;
  total_default: number;
  doc_fee_min: number;
  doc_fee_max: number;
  doc_fee_default: number;
  guarantee_return_fee_min: number;
  guarantee_return_fee_max: number;
  guarantee_return_fee_default: number;
  guarantee_days: number;
  guarantee_days_uplift: number;
  approved_ttl_days: number;
  // Clawback defaults (mig 1217) — the commission on a FIN1 contract written
  // through a deal partner shop is taken back when the customer stops paying
  // early. These four are the seed every new shop starts from; each shop can
  // then override the first two plus its own tiers (§6b).
  clawback_by_branch_default: boolean;
  clawback_check_days: number;
  clawback_notice_days: number;
  clawback_tiers_default: ClawbackTier[];
  updated_at: string;
}

interface BranchConfigRow {
  branch_id: number;
  branch_name: string;
  company_id: number;
  company_name: string | null;
  branch_rate_percent: number;
  company_rate_percent: number;
  total_rate_percent: number;
  risk_party: 'BRANCH' | 'COMPANY';
  total_min: number;
  total_max: number;
  // Fee bounds ride along on the branch row, so the modal doesn't have to wait
  // for the policy query to know what range to validate against.
  doc_fee_amount: number;
  doc_fee_min: number;
  doc_fee_max: number;
  doc_fee_default: number;
  guarantee_return_fee_amount: number;
  guarantee_return_fee_min: number;
  guarantee_return_fee_max: number;
  guarantee_return_fee_default: number;
  return_to_branch_id: number | null;
  return_to_branch_name: string | null;
  is_active: boolean;
  note: string | null;
  updated_at: string;
  // Clawback, per shop (mig 1217). The `_default` triplet is the holding's
  // value, carried along so the modal can show "same as default" and offer to
  // put it back without a second query.
  clawback_by_branch: boolean;
  clawback_check_days: number;
  clawback_tiers: ClawbackTier[];
  clawback_by_branch_default: boolean;
  clawback_check_days_default: number;
  clawback_tiers_default: ClawbackTier[];
  // Payout account — where the holding transfers this shop's money. The DB
  // nulls all four for a viewer without the permission, so `has_payout_account`
  // is the only honest way to tell "no account" from "not allowed to see it".
  payout_bank_code: string | null;
  payout_bank_name: string | null;
  payout_account_no: string | null;
  payout_account_name: string | null;
  has_payout_account: boolean;
}

/** v_deal_partner_warehouses — every internal branch in the holding, flagged.
 *  Not pre-filtered, so a shop's return-branch options must be narrowed to
 *  `is_company_warehouse` within that shop's own company. */
interface WarehouseRow {
  branch_id: number;
  branch_code: string;
  branch_name: string;
  company_id: number;
  company_name: string;
  is_active: boolean;
  is_company_warehouse: boolean;
  return_shop_count: number;
  return_shops: Array<{ branch_id: number; branch_name: string }> | null;
}

const fmtPct = (n: number) => `${Number(n)}%`;
const fmtBaht = (n: number) => `฿${Number(n).toLocaleString('en-US')}`;

// ── Policy modal ─────────────────────────────────────────────────────────────

interface PolicyFormData {
  total_min: string;
  total_max: string;
  branch_rate_default: string;
  company_rate_default: string;
  doc_fee_min: string;
  doc_fee_max: string;
  doc_fee_default: string;
  guarantee_return_fee_min: string;
  guarantee_return_fee_max: string;
  guarantee_return_fee_default: string;
  guarantee_days: string;
  guarantee_days_uplift: string;
  approved_ttl_days: string;
  clawback_check_days: string;
  clawback_notice_days: string;
}

const EMPTY_POLICY_FORM: PolicyFormData = {
  total_min: '', total_max: '', branch_rate_default: '', company_rate_default: '',
  doc_fee_min: '', doc_fee_max: '', doc_fee_default: '',
  guarantee_return_fee_min: '', guarantee_return_fee_max: '', guarantee_return_fee_default: '',
  guarantee_days: '', guarantee_days_uplift: '', approved_ttl_days: '',
  clawback_check_days: '', clawback_notice_days: '',
};

/** Who repays the deal partner commission. Stored as a boolean on the row
 *  (true = the shop), shown as a two-way choice. */
const clawbackPartyOptions = (t: (k: string) => string) => [
  { value: 'BRANCH', label: t('dealPartnerRate.clawbackPartyBranch') },
  { value: 'COMPANY', label: t('dealPartnerRate.clawbackPartyCompany') },
];

const tiersEqual = (a: ClawbackTier[], b: ClawbackTier[]) =>
  a.length === b.length && a.every((tier, i) => tier.paid === b[i].paid && tier.pct === b[i].pct);

function PolicyModal({ open, onClose, policy, onSaved }: {
  open: boolean;
  onClose: () => void;
  policy: PolicyRow | null;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [view, setView] = useState<'form' | 'done'>('form');
  const [result, setResult] = useState<PolicyRow | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);
  // The tier table and the who-repays choice are not text fields, so they sit
  // outside react-hook-form; `seededTiers` is what the modal opened with, which
  // is what makes "is this dirty?" answerable for them.
  const [clawbackByBranch, setClawbackByBranch] = useState(true);
  const [tiers, setTiers] = useState<ClawbackTier[]>([]);
  const [seededTiers, setSeededTiers] = useState<ClawbackTier[]>([]);
  const [seededByBranch, setSeededByBranch] = useState(true);

  const { handleSubmit, control, formState: { errors, isDirty }, reset, watch } = useForm<PolicyFormData>({
    defaultValues: EMPTY_POLICY_FORM,
  });

  // Seed only when the modal opens (or the holding changes) — NOT on every
  // `policy` object identity change: saving invalidates the query, the refetch
  // produces a new object, and a dep on it would reset view='done' back to the
  // form the moment the save lands.
  const policyRef = useRef(policy);
  policyRef.current = policy;
  useEffect(() => {
    if (open) {
      const p = policyRef.current;
      reset(p ? {
        total_min: String(p.total_min),
        total_max: String(p.total_max),
        branch_rate_default: String(p.branch_rate_default),
        company_rate_default: String(p.company_rate_default),
        doc_fee_min: String(p.doc_fee_min),
        doc_fee_max: String(p.doc_fee_max),
        doc_fee_default: String(p.doc_fee_default),
        guarantee_return_fee_min: String(p.guarantee_return_fee_min),
        guarantee_return_fee_max: String(p.guarantee_return_fee_max),
        guarantee_return_fee_default: String(p.guarantee_return_fee_default),
        guarantee_days: String(p.guarantee_days),
        guarantee_days_uplift: String(p.guarantee_days_uplift),
        approved_ttl_days: String(p.approved_ttl_days),
        clawback_check_days: String(p.clawback_check_days),
        clawback_notice_days: String(p.clawback_notice_days),
      } : EMPTY_POLICY_FORM);
      const seedTiers = renumberTiers(p?.clawback_tiers_default ?? []);
      const seedByBranch = p?.clawback_by_branch_default ?? true;
      setTiers(seedTiers);
      setSeededTiers(seedTiers);
      setClawbackByBranch(seedByBranch);
      setSeededByBranch(seedByBranch);
      setView('form');
      setResult(null);
      setErrorMessage('');
    }
  }, [open, policy?.holding_id, reset]);

  const vMin = parseFloat(watch('total_min'));
  const vMax = parseFloat(watch('total_max'));
  const vBr = parseFloat(watch('branch_rate_default'));
  const vCo = parseFloat(watch('company_rate_default'));
  const allFilled = [vMin, vMax, vBr, vCo].every(n => !Number.isNaN(n));
  const defaultTotal = allFilled ? vBr + vCo : null;
  const rangeInvalid = allFilled && vMax < vMin;
  const totalInvalid = allFilled && !rangeInvalid && (defaultTotal! < vMin || defaultTotal! > vMax);

  // Contract fee mirrors the commission shape: a min/max band plus the default
  // a new shop is seeded with, which must itself sit inside that band. Same two
  // failure modes, checked separately so the message points at the right pair.
  const vFeeMin = parseFloat(watch('doc_fee_min'));
  const vFeeMax = parseFloat(watch('doc_fee_max'));
  const vFeeDef = parseFloat(watch('doc_fee_default'));
  const feeFilled = [vFeeMin, vFeeMax, vFeeDef].every(n => !Number.isNaN(n));
  const feeRangeInvalid = feeFilled && vFeeMax < vFeeMin;
  const feeDefaultInvalid = feeFilled && !feeRangeInvalid && (vFeeDef < vFeeMin || vFeeDef > vFeeMax);

  // Guarantee return fee (mig 1191) — same band-plus-default shape again.
  const vGrtMin = parseFloat(watch('guarantee_return_fee_min'));
  const vGrtMax = parseFloat(watch('guarantee_return_fee_max'));
  const vGrtDef = parseFloat(watch('guarantee_return_fee_default'));
  const grtFilled = [vGrtMin, vGrtMax, vGrtDef].every(n => !Number.isNaN(n));
  const grtRangeInvalid = grtFilled && vGrtMax < vGrtMin;
  const grtDefaultInvalid = grtFilled && !grtRangeInvalid && (vGrtDef < vGrtMin || vGrtDef > vGrtMax);

  // Clawback (mig 1217). The tier shape is checked here only to save a round
  // trip — the DB is still the one that decides.
  const tiersErrorKey = validateClawbackTiers(tiers);
  const tiersIncomplete = tiers.some(tier => Number.isNaN(tier.pct));
  const clawbackDirty = !tiersEqual(tiers, seededTiers) || clawbackByBranch !== seededByBranch;

  const onSubmit = async (data: PolicyFormData) => {
    setIsSaving(true);
    setErrorMessage('');
    try {
      const saved = await apiClient.rpc<PolicyRow>('fn_deal_partner_policy_set', {
        p_patch: {
          total_min: parseFloat(data.total_min),
          total_max: parseFloat(data.total_max),
          branch_rate_default: parseFloat(data.branch_rate_default),
          company_rate_default: parseFloat(data.company_rate_default),
          doc_fee_min: parseFloat(data.doc_fee_min),
          doc_fee_max: parseFloat(data.doc_fee_max),
          doc_fee_default: parseFloat(data.doc_fee_default),
          guarantee_return_fee_min: parseFloat(data.guarantee_return_fee_min),
          guarantee_return_fee_max: parseFloat(data.guarantee_return_fee_max),
          guarantee_return_fee_default: parseFloat(data.guarantee_return_fee_default),
          guarantee_days: parseInt(data.guarantee_days),
          guarantee_days_uplift: parseInt(data.guarantee_days_uplift),
          approved_ttl_days: parseInt(data.approved_ttl_days),
          clawback_by_branch_default: clawbackByBranch,
          clawback_check_days: parseInt(data.clawback_check_days),
          clawback_notice_days: parseInt(data.clawback_notice_days),
          clawback_tiers_default: renumberTiers(tiers),
        },
      });
      setResult(saved);
      setView('done');
      onSaved();
    } catch (err) {
      setErrorMessage(translateApiError(err, t));
    } finally {
      setIsSaving(false);
    }
  };

  const handleClose = () => {
    if (view === 'done') { forceClose(); return; }
    if (isDirty || clawbackDirty) { setConfirmCloseOpen(true); return; }
    forceClose();
  };
  const forceClose = () => {
    setConfirmCloseOpen(false);
    onClose();
  };

  const pctField = (name: keyof PolicyFormData, label: string) => (
    <div className="flex flex-col">
      <label className="form-label">{label}</label>
      <Controller
        name={name}
        control={control}
        rules={{ required: t('dealPartnerRate.rateRequired') }}
        render={({ field }) => (
          <MaskedInput
            mask="number"
            decimalScale={2}
            value={field.value}
            onChange={(raw) => field.onChange(raw)}
            suffix="%"
          />
        )}
      />
      <FormErrorMessage error={errors[name]} />
    </div>
  );

  // Whole days — guarantee window / approval TTL.
  const dayField = (name: keyof PolicyFormData, label: string) => (
    <div className="flex flex-col">
      <label className="form-label">{label}</label>
      <Controller
        name={name}
        control={control}
        rules={{ required: t('dealPartnerRate.valueRequired') }}
        render={({ field }) => (
          <MaskedInput
            mask="number"
            decimalScale={0}
            value={field.value}
            onChange={(raw) => field.onChange(raw)}
          />
        )}
      />
      <FormErrorMessage error={errors[name]} />
    </div>
  );

  // Whole baht — the fee is a flat charge, never a fraction of one.
  const bahtField = (name: keyof PolicyFormData, label: string) => (
    <div className="flex flex-col">
      <label className="form-label">{label}</label>
      <Controller
        name={name}
        control={control}
        rules={{ required: t('dealPartnerRate.amountRequired') }}
        render={({ field }) => (
          <MaskedInput
            mask="number"
            decimalScale={0}
            value={field.value}
            onChange={(raw) => field.onChange(raw)}
          />
        )}
      />
      <FormErrorMessage error={errors[name]} />
    </div>
  );

  return (
    <>
    <Modal open={open} onClose={handleClose} maxWidth="26rem" width="100%">
      {view === 'done' && result ? (
        <>
          <div className="modal-header">
            <h2 className="modal-title">{t('dealPartnerRate.editPolicy')}</h2>
            <button type="button" className="modal-close-btn" onClick={forceClose} aria-label="Close">&times;</button>
          </div>
          <ActionDoneView
            headline={t('dealPartnerRate.policySaved')}
            contractCode={policy?.holding_name ?? ''}
            detailRows={[
              { label: t('dealPartnerRate.totalRange'), value: `${fmtPct(result.total_min)} – ${fmtPct(result.total_max)}` },
              { label: t('dealPartnerRate.branchDefault'), value: fmtPct(result.branch_rate_default) },
              { label: t('dealPartnerRate.companyDefault'), value: fmtPct(result.company_rate_default) },
              { label: t('dealPartnerRate.totalDefault'), value: fmtPct(result.branch_rate_default + result.company_rate_default), emphasis: true },
              { label: t('dealPartnerRate.docFeeRange'), value: `${fmtBaht(result.doc_fee_min)} – ${fmtBaht(result.doc_fee_max)}` },
              { label: t('dealPartnerRate.docFeeDefault'), value: fmtBaht(result.doc_fee_default) },
              { label: t('dealPartnerRate.guaranteeFeeRange'), value: `${fmtBaht(result.guarantee_return_fee_min)} – ${fmtBaht(result.guarantee_return_fee_max)}` },
              { label: t('dealPartnerRate.guaranteeFeeDefault'), value: fmtBaht(result.guarantee_return_fee_default) },
              { label: t('dealPartnerRate.guaranteeDays'), value: t('dealPartnerRate.daysValue', { days: result.guarantee_days }) },
              { label: t('dealPartnerRate.guaranteeDaysUplift'), value: t('dealPartnerRate.daysValue', { days: result.guarantee_days_uplift }) },
              { label: t('dealPartnerRate.approvedTtlDays'), value: t('dealPartnerRate.daysValue', { days: result.approved_ttl_days }) },
              { label: t('dealPartnerRate.clawbackByBranchDefault'), value: result.clawback_by_branch_default ? t('dealPartnerRate.clawbackPartyBranch') : t('dealPartnerRate.clawbackPartyCompany') },
              { label: t('dealPartnerRate.clawbackCheckDays'), value: t('dealPartnerRate.daysValue', { days: result.clawback_check_days }) },
              { label: t('dealPartnerRate.clawbackNoticeDays'), value: t('dealPartnerRate.daysValue', { days: result.clawback_notice_days }) },
              { label: t('dealPartnerRate.clawbackTiersLabel'), value: t('dealPartnerRate.clawbackTiersSummary', { count: (result.clawback_tiers_default ?? []).length }) },
            ]}
            onClose={forceClose}
          />
        </>
      ) : (
        <form className="flex flex-col overflow-hidden" onSubmit={handleSubmit(onSubmit)}>
          <div className="modal-header">
            <h2 className="modal-title">{t('dealPartnerRate.editPolicy')}</h2>
            <button type="button" className="modal-close-btn" onClick={handleClose} aria-label="Close">&times;</button>
          </div>
          <div className="modal-content">
            <div className="form-grid">
              <div className="px-3 py-2.5 rounded-md bg-surface border border-line">
                <div className="font-medium text-sm">{policy?.holding_name ?? '—'}</div>
                <div className="text-xs text-subtle">{t('dealPartnerRate.defaultsHint')}</div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {pctField('total_min', t('dealPartnerRate.totalMin'))}
                {pctField('total_max', t('dealPartnerRate.totalMax'))}
              </div>
              <div className="grid grid-cols-2 gap-3">
                {pctField('branch_rate_default', t('dealPartnerRate.branchDefault'))}
                {pctField('company_rate_default', t('dealPartnerRate.companyDefault'))}
              </div>

              <div className={`text-sm flex items-center justify-between px-3 py-2 rounded-md border ${
                rangeInvalid || totalInvalid
                  ? 'bg-danger-soft border-danger-border text-danger-fg'
                  : 'bg-surface border-line'
              }`}>
                <span>{t('dealPartnerRate.totalDefault')}</span>
                <span className="tabular-nums font-medium">
                  {defaultTotal !== null ? fmtPct(defaultTotal) : '—'}
                </span>
              </div>
              {rangeInvalid && (
                <p className="text-xs text-danger-fg -mt-3">{t('dealPartnerRate.maxBelowMin')}</p>
              )}
              {totalInvalid && (
                <p className="text-xs text-danger-fg -mt-3">
                  {t('dealPartnerRate.rangeHint', { min: vMin, max: vMax })}
                </p>
              )}

              {/* Contract fee (mig 1173) — a separate term of the deal, so it
                  gets its own labelled block rather than more loose fields. */}
              <div className="border-t border-line pt-4 -mb-1">
                <div className="text-sm font-medium">{t('dealPartnerRate.docFeeSection')}</div>
                <div className="text-xs text-subtle mt-0.5">{t('dealPartnerRate.docFeeHint')}</div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {bahtField('doc_fee_min', t('dealPartnerRate.docFeeMin'))}
                {bahtField('doc_fee_max', t('dealPartnerRate.docFeeMax'))}
              </div>
              <div className="grid grid-cols-2 gap-3">
                {bahtField('doc_fee_default', t('dealPartnerRate.docFeeDefault'))}
              </div>
              {feeRangeInvalid && (
                <p className="text-xs text-danger-fg -mt-3">{t('dealPartnerRate.maxBelowMin')}</p>
              )}
              {feeDefaultInvalid && (
                <p className="text-xs text-danger-fg -mt-3">
                  {t('dealPartnerRate.docFeeRangeHint', { min: vFeeMin, max: vFeeMax })}
                </p>
              )}

              {/* Guarantee window + approval TTL (mig 1192) — moved here from
                  the FIN1 policy: internal branches have no device guarantee,
                  so these are terms of the deal-partner arrangement. */}
              <div className="border-t border-line pt-4 -mb-1">
                <div className="text-sm font-medium">{t('dealPartnerRate.guaranteeDaysSection')}</div>
                <div className="text-xs text-subtle mt-0.5">{t('dealPartnerRate.guaranteeDaysHint')}</div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {dayField('guarantee_days', t('dealPartnerRate.guaranteeDays'))}
                {dayField('guarantee_days_uplift', t('dealPartnerRate.guaranteeDaysUplift'))}
              </div>
              <div className="grid grid-cols-2 gap-3">
                {dayField('approved_ttl_days', t('dealPartnerRate.approvedTtlDays'))}
              </div>

              {/* Guarantee return fee (mig 1191) — the extra the branch pays a
                  customer who returns the device inside the guarantee window. */}
              <div className="border-t border-line pt-4 -mb-1">
                <div className="text-sm font-medium">{t('dealPartnerRate.guaranteeFeeSection')}</div>
                <div className="text-xs text-subtle mt-0.5">{t('dealPartnerRate.guaranteeFeeHint')}</div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {bahtField('guarantee_return_fee_min', t('dealPartnerRate.guaranteeFeeMin'))}
                {bahtField('guarantee_return_fee_max', t('dealPartnerRate.guaranteeFeeMax'))}
              </div>
              <div className="grid grid-cols-2 gap-3">
                {bahtField('guarantee_return_fee_default', t('dealPartnerRate.guaranteeFeeDefault'))}
              </div>
              {grtRangeInvalid && (
                <p className="text-xs text-danger-fg -mt-3">{t('dealPartnerRate.maxBelowMin')}</p>
              )}
              {grtDefaultInvalid && (
                <p className="text-xs text-danger-fg -mt-3">
                  {t('dealPartnerRate.guaranteeFeeRangeHint', { min: vGrtMin, max: vGrtMax })}
                </p>
              )}

              {/* Clawback defaults (mig 1217) — the commission taken back when a
                  FIN1 contract written through a deal partner shop stops being
                  paid early. Owner 09-14 insists the wording names the deal
                  partner, so it is not read as staff commission. */}
              <div className="border-t border-line pt-4 -mb-1">
                <div className="text-sm font-medium">{t('dealPartnerRate.clawbackSection')}</div>
                <div className="text-xs text-subtle mt-0.5">{t('dealPartnerRate.clawbackSectionHint')}</div>
              </div>

              <div className="flex flex-col">
                <label className="form-label">{t('dealPartnerRate.clawbackByBranchDefault')}</label>
                <Select
                  options={clawbackPartyOptions(t)}
                  value={clawbackByBranch ? 'BRANCH' : 'COMPANY'}
                  onChange={val => setClawbackByBranch(val === 'BRANCH')}
                  searchable={false}
                  showChevron
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                {dayField('clawback_check_days', t('dealPartnerRate.clawbackCheckDays'))}
                {dayField('clawback_notice_days', t('dealPartnerRate.clawbackNoticeDays'))}
              </div>

              <div className="flex flex-col">
                <label className="form-label">{t('dealPartnerRate.clawbackTiersLabel')}</label>
                <ClawbackTiersEditor value={tiers} onChange={setTiers} />
              </div>
            </div>
          </div>
          <ModalErrorBand message={errorMessage} onDismiss={() => setErrorMessage('')} />
          <div className="modal-footer">
            <Button variant="outline" onClick={handleClose} type="button">{t('common.cancel')}</Button>
            <Button color="primary" type="submit" disabled={isSaving || rangeInvalid || totalInvalid || feeRangeInvalid || feeDefaultInvalid || grtRangeInvalid || grtDefaultInvalid || tiersErrorKey !== null || tiersIncomplete}>
              {isSaving ? t('pricing.saving') : t('common.save')}
            </Button>
          </div>
        </form>
      )}
    </Modal>

    <Modal open={confirmCloseOpen} onClose={() => setConfirmCloseOpen(false)} maxWidth="24rem" width="100%">
      <div className="modal-header"><h2 className="modal-title">{t('common.unsavedChanges')}</h2></div>
      <div className="modal-content"><p>{t('common.unsavedChangesMessage')}</p></div>
      <div className="modal-footer">
        <Button variant="ghost" onClick={() => setConfirmCloseOpen(false)}>{t('common.cancel')}</Button>
        <Button color="danger" onClick={forceClose}>{t('common.discard')}</Button>
      </div>
    </Modal>
    </>
  );
}

// ── Branch config modal ──────────────────────────────────────────────────────

interface ConfigFormData {
  branch_rate_percent: string;
  company_rate_percent: string;
  doc_fee_amount: string;
  guarantee_return_fee_amount: string;
  return_to_branch_id: string;
  clawback_check_days: string;
  note: string;
}

const EMPTY_CONFIG_FORM: ConfigFormData = {
  branch_rate_percent: '', company_rate_percent: '', doc_fee_amount: '',
  guarantee_return_fee_amount: '',
  return_to_branch_id: '', clawback_check_days: '', note: '',
};

function BranchConfigModal({ open, onClose, config, warehouses, onSaved }: {
  open: boolean;
  onClose: () => void;
  config: BranchConfigRow | null;
  warehouses: WarehouseRow[];
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [view, setView] = useState<'form' | 'done'>('form');
  const [result, setResult] = useState<BranchConfigRow | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);
  // Non-text-field state, same reasoning as the policy modal: these are not
  // inputs react-hook-form can track, so their "opened with" values are kept
  // alongside to answer the dirty check.
  const [clawbackByBranch, setClawbackByBranch] = useState(true);
  const [tiers, setTiers] = useState<ClawbackTier[]>([]);
  const [seededTiers, setSeededTiers] = useState<ClawbackTier[]>([]);
  const [seededByBranch, setSeededByBranch] = useState(true);
  const [payout, setPayout] = useState<DealPartnerPayoutValue>(EMPTY_PAYOUT_VALUE);
  const [payoutCleared, setPayoutCleared] = useState(false);
  const { data: banks = [] } = useRefBanks();

  const { handleSubmit, control, formState: { errors, isDirty }, reset, watch, setValue } = useForm<ConfigFormData>({
    defaultValues: EMPTY_CONFIG_FORM,
  });

  useEffect(() => {
    if (open) {
      reset(config ? {
        branch_rate_percent: String(config.branch_rate_percent),
        company_rate_percent: String(config.company_rate_percent),
        doc_fee_amount: String(config.doc_fee_amount),
        guarantee_return_fee_amount: String(config.guarantee_return_fee_amount),
        return_to_branch_id: config.return_to_branch_id ? String(config.return_to_branch_id) : '',
        clawback_check_days: String(config.clawback_check_days),
        note: config.note ?? '',
      } : EMPTY_CONFIG_FORM);
      const seedTiers = renumberTiers(config?.clawback_tiers ?? []);
      const seedByBranch = config?.clawback_by_branch ?? true;
      setTiers(seedTiers);
      setSeededTiers(seedTiers);
      setClawbackByBranch(seedByBranch);
      setSeededByBranch(seedByBranch);
      // The account number is write-only for a viewer without the permission
      // (the DB nulls it), so an empty form here means "not shown", never
      // "cleared" — which is why clearing needs its own explicit flag.
      setPayout({
        bank_code: config?.payout_bank_code ?? '',
        account_no: config?.payout_account_no ?? '',
        account_name: config?.payout_account_name ?? '',
      });
      setPayoutCleared(false);
      setView('form');
      setResult(null);
      setErrorMessage('');
    }
  }, [open, config, reset]);

  const vBr = parseFloat(watch('branch_rate_percent'));
  const vCo = parseFloat(watch('company_rate_percent'));
  const bothFilled = !Number.isNaN(vBr) && !Number.isNaN(vCo);
  const total = bothFilled ? vBr + vCo : null;
  const outOfRange = config != null && total !== null && (total < config.total_min || total > config.total_max);

  // Only this company's ticked warehouses can receive this shop's returns.
  const branchOptions = useMemo(
    () => warehouses
      .filter(w => w.is_company_warehouse && w.is_active && w.company_id === config?.company_id)
      .map(w => ({ value: String(w.branch_id), label: w.branch_name })),
    [warehouses, config?.company_id],
  );

  // A company with exactly one warehouse has nothing to choose — fill it in
  // rather than making the user open a one-option dropdown (work order §2).
  const returnBranchId = watch('return_to_branch_id');
  useEffect(() => {
    if (!open || returnBranchId || branchOptions.length !== 1) return;
    setValue('return_to_branch_id', branchOptions[0].value, { shouldDirty: true });
  }, [open, returnBranchId, branchOptions, setValue]);

  const vFee = parseFloat(watch('doc_fee_amount'));
  const feeOutOfRange = config != null && !Number.isNaN(vFee)
    && (vFee < config.doc_fee_min || vFee > config.doc_fee_max);

  const vGrt = parseFloat(watch('guarantee_return_fee_amount'));
  const grtOutOfRange = config != null && !Number.isNaN(vGrt)
    && (vGrt < config.guarantee_return_fee_min || vGrt > config.guarantee_return_fee_max);

  const tiersErrorKey = validateClawbackTiers(tiers);
  const tiersIncomplete = tiers.some(tier => Number.isNaN(tier.pct));
  const payoutErrorKey = payoutCleared ? null : validatePayoutAccount(payout, banks);
  const payoutDirty = payoutCleared
    || payout.bank_code !== (config?.payout_bank_code ?? '')
    || payout.account_no !== (config?.payout_account_no ?? '')
    || payout.account_name !== (config?.payout_account_name ?? '');
  const clawbackDirty = !tiersEqual(tiers, seededTiers) || clawbackByBranch !== seededByBranch;

  // "Same as the holding default" is the question the user actually asks here,
  // so it is answered rather than left to be worked out from two screens.
  const matchesDefault = config != null
    && clawbackByBranch === config.clawback_by_branch_default
    && parseInt(watch('clawback_check_days')) === config.clawback_check_days_default
    && tiersEqual(tiers, renumberTiers(config.clawback_tiers_default ?? []));

  const restoreClawbackDefaults = () => {
    if (!config) return;
    setClawbackByBranch(config.clawback_by_branch_default);
    setValue('clawback_check_days', String(config.clawback_check_days_default), { shouldDirty: true });
    setTiers(renumberTiers(config.clawback_tiers_default ?? []));
  };

  const onSubmit = async (data: ConfigFormData) => {
    if (!config) return;
    setIsSaving(true);
    setErrorMessage('');
    try {
      const retId = data.return_to_branch_id ? parseInt(data.return_to_branch_id) : null;
      // The three payout params are all-or-none: once any one of them is sent,
      // an omitted sibling reads as empty (not "keep current") and the DB
      // answers INCOMPLETE. Omitting all three is the only "don't touch" form.
      const hasPayoutInput = payout.bank_code !== ''
        || payoutAccountDigits(payout.account_no) !== ''
        || payout.account_name.trim() !== '';
      const saved = await apiClient.rpc<BranchConfigRow>('fn_deal_partner_branch_config_set', {
        p_branch_id: config.branch_id,
        p_branch_rate_percent: parseFloat(data.branch_rate_percent),
        p_company_rate_percent: parseFloat(data.company_rate_percent),
        p_doc_fee_amount: parseFloat(data.doc_fee_amount),
        p_guarantee_return_fee_amount: parseFloat(data.guarantee_return_fee_amount),
        p_return_to_branch_id: retId,
        // NULL params mean "keep current" on the BE, so clearing the Select
        // needs the explicit flag.
        p_clear_return_branch: retId === null && config.return_to_branch_id !== null,
        p_clawback_by_branch: clawbackByBranch,
        p_clawback_check_days: parseInt(data.clawback_check_days),
        p_clawback_tiers: renumberTiers(tiers),
        ...(payoutCleared
          ? { p_clear_payout_account: true }
          : hasPayoutInput
            ? {
                p_payout_bank_code: payout.bank_code,
                p_payout_account_no: payout.account_no,
                p_payout_account_name: payout.account_name.trim(),
              }
            : {}),
        p_note: data.note.trim(),
      });
      setResult(saved);
      setView('done');
      onSaved();
    } catch (err) {
      setErrorMessage(translateApiError(err, t));
    } finally {
      setIsSaving(false);
    }
  };

  const handleClose = () => {
    if (view === 'done') { forceClose(); return; }
    if (isDirty || clawbackDirty || payoutDirty) { setConfirmCloseOpen(true); return; }
    forceClose();
  };
  const forceClose = () => {
    setConfirmCloseOpen(false);
    onClose();
  };

  const riskLabel = (p: 'BRANCH' | 'COMPANY') =>
    p === 'COMPANY' ? t('dealPartnerRate.riskCompany') : t('dealPartnerRate.riskBranch');

  return (
    <>
    <Modal open={open} onClose={handleClose} maxWidth="26rem" width="100%">
      {view === 'done' && result ? (
        <>
          <div className="modal-header">
            <h2 className="modal-title">{t('dealPartnerRate.editConfig')}</h2>
            <button type="button" className="modal-close-btn" onClick={forceClose} aria-label="Close">&times;</button>
          </div>
          <ActionDoneView
            headline={t('dealPartnerRate.configSaved')}
            contractCode={config?.branch_name ?? ''}
            detailRows={[
              { label: t('dealPartnerRate.branchRate'), value: fmtPct(result.branch_rate_percent) },
              { label: t('dealPartnerRate.companyRate'), value: fmtPct(result.company_rate_percent) },
              { label: t('dealPartnerRate.totalRate'), value: fmtPct(result.total_rate_percent), emphasis: true },
              { label: t('dealPartnerRate.riskParty'), value: riskLabel(result.risk_party) },
              { label: t('dealPartnerRate.docFeeAmount'), value: fmtBaht(result.doc_fee_amount) },
              { label: t('dealPartnerRate.guaranteeFeeAmount'), value: fmtBaht(result.guarantee_return_fee_amount) },
              { label: t('dealPartnerRate.returnBranch'), value: result.return_to_branch_name ?? '—' },
              { label: t('dealPartnerRate.clawbackCheckDays'), value: t('dealPartnerRate.daysValue', { days: result.clawback_check_days }) },
              { label: t('dealPartnerRate.clawbackTiersLabel'), value: t('dealPartnerRate.clawbackTiersSummary', { count: (result.clawback_tiers ?? []).length }) },
              { label: t('dealPartnerRate.payoutSection'), value: result.has_payout_account ? (result.payout_bank_name ?? t('common.yes')) : '—' },
            ]}
            onClose={forceClose}
          />
        </>
      ) : (
        <form className="flex flex-col overflow-hidden" onSubmit={handleSubmit(onSubmit)}>
          <div className="modal-header">
            <h2 className="modal-title">{t('dealPartnerRate.editConfig')}</h2>
            <button type="button" className="modal-close-btn" onClick={handleClose} aria-label="Close">&times;</button>
          </div>
          <div className="modal-content">
            <div className="form-grid">
              <div className="px-3 py-2.5 rounded-md bg-surface border border-line">
                <div className="font-medium text-sm">{config?.branch_name ?? '—'}</div>
                <div className="text-xs text-subtle">
                  {config?.company_name}
                  {config && ` · ${t('dealPartnerRate.rangeHint', { min: config.total_min, max: config.total_max })}`}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col">
                  <label className="form-label">{t('dealPartnerRate.branchRate')}</label>
                  <Controller
                    name="branch_rate_percent"
                    control={control}
                    rules={{ required: t('dealPartnerRate.rateRequired') }}
                    render={({ field }) => (
                      <MaskedInput mask="number" decimalScale={2} value={field.value} onChange={(raw) => field.onChange(raw)} suffix="%" />
                    )}
                  />
                  <FormErrorMessage error={errors.branch_rate_percent} />
                </div>
                <div className="flex flex-col">
                  <label className="form-label">{t('dealPartnerRate.companyRate')}</label>
                  <Controller
                    name="company_rate_percent"
                    control={control}
                    rules={{ required: t('dealPartnerRate.rateRequired') }}
                    render={({ field }) => (
                      <MaskedInput mask="number" decimalScale={2} value={field.value} onChange={(raw) => field.onChange(raw)} suffix="%" />
                    )}
                  />
                  <FormErrorMessage error={errors.company_rate_percent} />
                </div>
              </div>

              <div className={`text-sm px-3 py-2 rounded-md border ${
                outOfRange ? 'bg-danger-soft border-danger-border text-danger-fg' : 'bg-surface border-line'
              }`}>
                <div className="flex items-center justify-between">
                  <span>{t('dealPartnerRate.totalRate')}</span>
                  <span className="tabular-nums font-medium">{total !== null ? fmtPct(total) : '—'}</span>
                </div>
              </div>
              {outOfRange && config && (
                <p className="text-xs text-danger-fg -mt-3">
                  {t('dealPartnerRate.rangeHint', { min: config.total_min, max: config.total_max })}
                </p>
              )}

              {/* This shop's contract fee, inside the holding band (mig 1173). */}
              <div className="flex flex-col">
                <label className="form-label">{t('dealPartnerRate.docFeeAmount')}</label>
                <Controller
                  name="doc_fee_amount"
                  control={control}
                  rules={{ required: t('dealPartnerRate.docFeeRequired') }}
                  render={({ field }) => (
                    <MaskedInput
                      mask="number"
                      decimalScale={0}
                      value={field.value}
                      onChange={(raw) => field.onChange(raw)}
                      error={feeOutOfRange}
                      endIcon={config ? <ChevronsRight size={14} /> : undefined}
                      onEndIconClick={config ? () => setValue('doc_fee_amount', String(config.doc_fee_default), { shouldDirty: true }) : undefined}
                    />
                  )}
                />
                <FormErrorMessage error={errors.doc_fee_amount} />
                <p className={`text-xs mt-1 ${feeOutOfRange ? 'text-danger-fg' : 'text-subtle'}`}>
                  {config
                    ? t('dealPartnerRate.docFeeRangeHint', { min: config.doc_fee_min, max: config.doc_fee_max })
                    : t('dealPartnerRate.docFeeHint')}
                </p>
              </div>

              {/* This shop's guarantee return fee, inside the holding band (mig 1191). */}
              <div className="flex flex-col">
                <label className="form-label">{t('dealPartnerRate.guaranteeFeeAmount')}</label>
                <Controller
                  name="guarantee_return_fee_amount"
                  control={control}
                  rules={{ required: t('dealPartnerRate.amountRequired') }}
                  render={({ field }) => (
                    <MaskedInput
                      mask="number"
                      decimalScale={0}
                      value={field.value}
                      onChange={(raw) => field.onChange(raw)}
                      error={grtOutOfRange}
                      endIcon={config ? <ChevronsRight size={14} /> : undefined}
                      onEndIconClick={config ? () => setValue('guarantee_return_fee_amount', String(config.guarantee_return_fee_default), { shouldDirty: true }) : undefined}
                    />
                  )}
                />
                <FormErrorMessage error={errors.guarantee_return_fee_amount} />
                <p className={`text-xs mt-1 ${grtOutOfRange ? 'text-danger-fg' : 'text-subtle'}`}>
                  {config
                    ? t('dealPartnerRate.guaranteeFeeRangeHint', { min: config.guarantee_return_fee_min, max: config.guarantee_return_fee_max })
                    : t('dealPartnerRate.guaranteeFeeHint')}
                </p>
              </div>

              <div className="flex flex-col">
                <label className="form-label">{t('dealPartnerRate.returnBranch')}</label>
                <Select
                  options={branchOptions}
                  value={watch('return_to_branch_id') || null}
                  onChange={val => setValue('return_to_branch_id', (val as string) ?? '', { shouldDirty: true })}
                  placeholder={t('dealPartnerRate.noReturnBranch')}
                  searchable
                  showChevron
                  clearable
                  disabled={branchOptions.length === 0}
                />
                <p className={`text-xs mt-1 ${branchOptions.length === 0 ? 'text-warning-fg' : 'text-subtle'}`}>
                  {branchOptions.length === 0
                    ? t('dealPartnerRate.noWarehouseForCompany')
                    : t('dealPartnerRate.returnBranchHint')}
                </p>
              </div>

              {/* Per-shop clawback (mig 1217). Seeded from the holding default
                  but owned by the shop from then on, so the default is shown
                  alongside with a way back to it. */}
              <div className="border-t border-line pt-4 -mb-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{t('dealPartnerRate.clawbackSection')}</div>
                    <div className="text-xs text-subtle mt-0.5">{t('dealPartnerRate.clawbackShopHint')}</div>
                  </div>
                  {!matchesDefault && (
                    <Button
                      variant="ghost"
                      size="sm"
                      type="button"
                      startIcon={<Undo2 size={14} />}
                      onClick={restoreClawbackDefaults}
                    >
                      {t('dealPartnerRate.clawbackRestoreDefault')}
                    </Button>
                  )}
                </div>
              </div>

              <div className="flex flex-col">
                <label className="form-label">{t('dealPartnerRate.clawbackByBranch')}</label>
                <Select
                  options={clawbackPartyOptions(t)}
                  value={clawbackByBranch ? 'BRANCH' : 'COMPANY'}
                  onChange={val => setClawbackByBranch(val === 'BRANCH')}
                  searchable={false}
                  showChevron
                />
                <p className="text-xs text-subtle mt-1">
                  {t('dealPartnerRate.clawbackDefaultIs', {
                    value: config?.clawback_by_branch_default
                      ? t('dealPartnerRate.clawbackPartyBranch')
                      : t('dealPartnerRate.clawbackPartyCompany'),
                  })}
                </p>
              </div>

              <div className="flex flex-col">
                <label className="form-label">{t('dealPartnerRate.clawbackCheckDays')}</label>
                <Controller
                  name="clawback_check_days"
                  control={control}
                  rules={{ required: t('dealPartnerRate.valueRequired') }}
                  render={({ field }) => (
                    <MaskedInput
                      mask="number"
                      decimalScale={0}
                      value={field.value}
                      onChange={raw => field.onChange(raw)}
                      endIcon={config ? <ChevronsRight size={14} /> : undefined}
                      onEndIconClick={config ? () => setValue('clawback_check_days', String(config.clawback_check_days_default), { shouldDirty: true }) : undefined}
                    />
                  )}
                />
                <FormErrorMessage error={errors.clawback_check_days} />
                <p className="text-xs text-subtle mt-1">
                  {t('dealPartnerRate.clawbackDefaultIs', {
                    value: t('dealPartnerRate.daysValue', { days: config?.clawback_check_days_default ?? 0 }),
                  })}
                </p>
              </div>

              <div className="flex flex-col">
                <label className="form-label">{t('dealPartnerRate.clawbackTiersLabel')}</label>
                <ClawbackTiersEditor value={tiers} onChange={setTiers} />
              </div>

              {/* Payout account — where the holding transfers this shop's
                  money. The field carries its own heading, so this is only the
                  separator that sets it apart from the clawback block above. */}
              <div className="border-t border-line pt-1" />
              <DealPartnerPayoutAccountField
                value={payout}
                onChange={setPayout}
                hasExistingAccount={config?.has_payout_account ?? false}
                cleared={payoutCleared}
                onClearedChange={setPayoutCleared}
              />

              <div className="flex flex-col">
                <label className="form-label">{t('dealPartnerRate.note')}</label>
                <Controller
                  name="note"
                  control={control}
                  render={({ field }) => (
                    <TextArea rows={2} value={field.value} onChange={field.onChange} placeholder={t('dealPartnerRate.notePlaceholder')} />
                  )}
                />
              </div>
            </div>
          </div>
          <ModalErrorBand message={errorMessage} onDismiss={() => setErrorMessage('')} />
          <div className="modal-footer">
            <Button variant="outline" onClick={handleClose} type="button">{t('common.cancel')}</Button>
            <Button color="primary" type="submit" disabled={isSaving || outOfRange || feeOutOfRange || grtOutOfRange || tiersErrorKey !== null || tiersIncomplete || payoutErrorKey !== null}>
              {isSaving ? t('pricing.saving') : t('common.save')}
            </Button>
          </div>
        </form>
      )}
    </Modal>

    <Modal open={confirmCloseOpen} onClose={() => setConfirmCloseOpen(false)} maxWidth="24rem" width="100%">
      <div className="modal-header"><h2 className="modal-title">{t('common.unsavedChanges')}</h2></div>
      <div className="modal-content"><p>{t('common.unsavedChangesMessage')}</p></div>
      <div className="modal-footer">
        <Button variant="ghost" onClick={() => setConfirmCloseOpen(false)}>{t('common.cancel')}</Button>
        <Button color="danger" onClick={forceClose}>{t('common.discard')}</Button>
      </div>
    </Modal>
    </>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export function DealPartnerRatesPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const canManage = ['COMPANY_ADMIN', 'HOLDING_ADMIN', 'SYSTEM_DEV'].includes(user?.role_code ?? '');

  const [sorting, setSorting] = useState<SortingState>([]);
  const [policyModalOpen, setPolicyModalOpen] = useState(false);
  const [editConfig, setEditConfig] = useState<BranchConfigRow | null>(null);
  const [configModalOpen, setConfigModalOpen] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(10);

  const { data: policies = [] } = useQuery({
    queryKey: ['deal-partner-policy'],
    queryFn: () => apiClient.get<PolicyRow[]>('/v_deal_partner_policy'),
    staleTime: 30 * 1000,
  });
  const policy = policies[0] ?? null;

  const { data: configs = [], isFetching } = useQuery({
    queryKey: ['deal-partner-branch-configs'],
    queryFn: () => apiClient.get<BranchConfigRow[]>('/v_deal_partner_branch_configs?order=branch_name'),
    staleTime: 30 * 1000,
  });

  // Return-branch options come from the warehouse view, not the full branch
  // list: only a branch ticked as a company warehouse may receive returns, and
  // only within the shop's own company (work order §2). Shared with §6c below.
  const { data: warehouses = [] } = useQuery({
    queryKey: ['deal-partner-warehouses'],
    queryFn: () => apiClient.get<WarehouseRow[]>('/v_deal_partner_warehouses'),
    staleTime: 5 * 60 * 1000,
  });

  const totalCount = configs.length;
  const paginated = configs.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize);

  const handleEdit = (row: BranchConfigRow) => {
    setEditConfig(row);
    setConfigModalOpen(true);
  };

  const handleSaved = () => {
    queryClient.invalidateQueries({ queryKey: ['deal-partner-policy'] });
    queryClient.invalidateQueries({ queryKey: ['deal-partner-branch-configs'] });
  };

  const riskBadge = (p: 'BRANCH' | 'COMPANY') => (
    <Badge size="sm" color={p === 'COMPANY' ? 'warning' : 'info'}>
      {p === 'COMPANY' ? t('dealPartnerRate.riskCompany') : t('dealPartnerRate.riskBranch')}
    </Badge>
  );

  const columns: ColumnDef<BranchConfigRow>[] = [
    {
      accessorKey: 'branch_name',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('dealPartnerRate.branch')} />,
      cell: ({ row }) => (
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">{row.original.branch_name}</div>
          <div className="text-xs text-subtle truncate">{row.original.company_name ?? '—'}</div>
        </div>
      ),
    },
    {
      accessorKey: 'branch_rate_percent',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('dealPartnerRate.branchRate')} />,
      cell: ({ row }) => <span className="text-sm tabular-nums">{fmtPct(row.original.branch_rate_percent)}</span>,
      className: 'w-24',
    },
    {
      accessorKey: 'company_rate_percent',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('dealPartnerRate.companyRate')} />,
      cell: ({ row }) => <span className="text-sm tabular-nums">{fmtPct(row.original.company_rate_percent)}</span>,
      className: 'w-24',
    },
    {
      accessorKey: 'total_rate_percent',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('dealPartnerRate.totalRate')} />,
      cell: ({ row }) => <span className="text-sm tabular-nums font-medium">{fmtPct(row.original.total_rate_percent)}</span>,
      className: 'w-24',
    },
    {
      accessorKey: 'doc_fee_amount',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('dealPartnerRate.docFeeAmount')} />,
      cell: ({ row }) => <span className="text-sm tabular-nums">{fmtBaht(row.original.doc_fee_amount)}</span>,
      className: 'w-28 max-md:hidden',
    },
    {
      accessorKey: 'guarantee_return_fee_amount',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('dealPartnerRate.guaranteeFeeAmount')} />,
      cell: ({ row }) => <span className="text-sm tabular-nums">{fmtBaht(row.original.guarantee_return_fee_amount)}</span>,
      className: 'w-28 max-lg:hidden',
    },
    {
      // Since mig 1217 this reflects `clawback_by_branch` — who repays the
      // commission — rather than being inferred from a non-zero company rate.
      accessorKey: 'risk_party',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('dealPartnerRate.riskParty')} />,
      cell: ({ row }) => riskBadge(row.original.risk_party),
      className: 'w-28 max-md:hidden',
    },
    {
      accessorKey: 'has_payout_account',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('dealPartnerRate.payoutColumn')} />,
      cell: ({ row }) => (
        row.original.has_payout_account
          ? <span className="text-sm text-subtle truncate block">{row.original.payout_bank_name ?? t('common.yes')}</span>
          : <span className="text-sm text-warning-fg">{t('dealPartnerRate.payoutMissing')}</span>
      ),
      className: 'w-32 max-lg:hidden',
    },
    {
      accessorKey: 'return_to_branch_name',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('dealPartnerRate.returnBranch')} />,
      cell: ({ row }) => (
        <span className="text-sm text-subtle truncate max-w-36 block">
          {row.original.return_to_branch_name ?? '—'}
        </span>
      ),
      className: 'max-lg:hidden',
    },
    ...(canManage ? [{
      id: 'actions',
      header: () => null,
      cell: ({ row }: { row: { original: BranchConfigRow } }) => (
        <button
          className="flex items-center justify-center w-8 h-8 rounded hover:bg-surface-hover cursor-pointer text-subtle hover:text-fg"
          onClick={() => handleEdit(row.original)}
          aria-label={t('common.edit')}
        >
          <Pencil size={14} />
        </button>
      ),
      enableSorting: false,
      className: 'w-10',
    }] : []),
  ];

  const policyStat = (label: string, value: string, emphasis = false) => (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span className="text-xs text-subtle truncate">{label}</span>
      <span className={`text-sm tabular-nums ${emphasis ? 'font-semibold' : 'font-medium'}`}>{value}</span>
    </div>
  );

  return (
    <>
      <MobileHeader className="mobile-header-bordered md:hidden">
        <div className="mobile-header-start">
          <button
            className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current"
            onClick={() => window.dispatchEvent(new CustomEvent('sidemenu:open'))}
          >
            <ArrowRightFromLine size={18} />
          </button>
        </div>
        <div className="mobile-header-title mobile-header-title-truncate">
          {t('dealPartnerRate.title')}
        </div>
        <div className="mobile-header-end w-nav" />
      </MobileHeader>

      <div className="page-content responsive-dvh-mobile-header">
        <div className="flex items-center justify-between mb-4 flex-none max-md:hidden">
          <h1 className="heading-2">{t('dealPartnerRate.title')}</h1>
        </div>

        {/* Holding policy — the default every new deal partner branch starts from */}
        <div className="flex-none rounded-lg border border-line p-4 mb-4 max-md:mt-3">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="min-w-0">
              <div className="font-medium">{t('dealPartnerRate.policyTitle')}</div>
              <div className="text-xs text-subtle mt-0.5">{t('dealPartnerRate.defaultsHint')}</div>
            </div>
            {canManage && (
              <Button variant="outline" size="sm" startIcon={<Pencil size={14} />} onClick={() => setPolicyModalOpen(true)}>
                {t('common.edit')}
              </Button>
            )}
          </div>
          {policy ? (
            <div className="flex flex-col gap-3">
              <div>
                <div className="text-xs font-medium text-subtle mb-2">{t('dealPartnerRate.commissionSection')}</div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {policyStat(t('dealPartnerRate.totalRange'), `${fmtPct(policy.total_min)} – ${fmtPct(policy.total_max)}`)}
                  {policyStat(t('dealPartnerRate.branchDefault'), fmtPct(policy.branch_rate_default))}
                  {policyStat(t('dealPartnerRate.companyDefault'), fmtPct(policy.company_rate_default))}
                  {policyStat(t('dealPartnerRate.totalDefault'), fmtPct(policy.total_default), true)}
                </div>
              </div>
              <div className="border-t border-line pt-3">
                <div className="text-xs font-medium text-subtle mb-2 flex items-center gap-1">
                  <Receipt size={12} />{t('dealPartnerRate.docFeeSection')}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {policyStat(t('dealPartnerRate.docFeeRange'), `${fmtBaht(policy.doc_fee_min)} – ${fmtBaht(policy.doc_fee_max)}`)}
                  {policyStat(t('dealPartnerRate.docFeeDefault'), fmtBaht(policy.doc_fee_default), true)}
                </div>
              </div>
              <div className="border-t border-line pt-3">
                <div className="text-xs font-medium text-subtle mb-2 flex items-center gap-1">
                  <ShieldCheck size={12} />{t('dealPartnerRate.guaranteeDaysSection')}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {policyStat(t('dealPartnerRate.guaranteeDays'), t('dealPartnerRate.daysValue', { days: policy.guarantee_days }))}
                  {policyStat(t('dealPartnerRate.guaranteeDaysUplift'), t('dealPartnerRate.daysValue', { days: policy.guarantee_days_uplift }))}
                  {policyStat(t('dealPartnerRate.approvedTtlDays'), t('dealPartnerRate.daysValue', { days: policy.approved_ttl_days }))}
                </div>
              </div>
              <div className="border-t border-line pt-3">
                <div className="text-xs font-medium text-subtle mb-2 flex items-center gap-1">
                  <ShieldCheck size={12} />{t('dealPartnerRate.guaranteeFeeSection')}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {policyStat(t('dealPartnerRate.guaranteeFeeRange'), `${fmtBaht(policy.guarantee_return_fee_min)} – ${fmtBaht(policy.guarantee_return_fee_max)}`)}
                  {policyStat(t('dealPartnerRate.guaranteeFeeDefault'), fmtBaht(policy.guarantee_return_fee_default), true)}
                </div>
              </div>
              <div className="border-t border-line pt-3">
                <div className="text-xs font-medium text-subtle mb-2 flex items-center gap-1">
                  <Undo size={12} />{t('dealPartnerRate.clawbackSection')}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {policyStat(
                    t('dealPartnerRate.clawbackByBranchDefault'),
                    policy.clawback_by_branch_default ? t('dealPartnerRate.clawbackPartyBranch') : t('dealPartnerRate.clawbackPartyCompany'),
                  )}
                  {policyStat(t('dealPartnerRate.clawbackCheckDays'), t('dealPartnerRate.daysValue', { days: policy.clawback_check_days }))}
                  {policyStat(t('dealPartnerRate.clawbackNoticeDays'), t('dealPartnerRate.daysValue', { days: policy.clawback_notice_days }))}
                </div>
                {/* The tiers are the actual rule, so they are spelled out rather
                    than counted — "จ่าย 1 งวด → คืน 50%" is the thing to check. */}
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {(policy.clawback_tiers_default ?? []).length === 0 ? (
                    <span className="text-xs text-subtle">{t('dealPartnerRate.clawbackNoTiers')}</span>
                  ) : (
                    (policy.clawback_tiers_default ?? []).map(tier => (
                      <Badge key={tier.paid} size="sm" color="default">
                        {t('dealPartnerRate.clawbackTierRow', { paid: tier.paid })} {tier.pct}%
                      </Badge>
                    ))
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="text-sm text-subtle">—</div>
          )}
        </div>

        {/* §6c — company-level terms: who owns the contract-fee revenue, and
            which internal branches may receive returned devices. */}
        <DealPartnerCompanySection canManage={canManage} />

        <div className="flex-none text-sm font-medium mb-2">{t('dealPartnerRate.branchConfigs')}</div>

        <DataTable<BranchConfigRow>
          data={paginated}
          columns={columns}
          sorting={sorting}
          onSortingChange={setSorting}
          enablePagination
          pageIndex={pageIndex}
          pageSize={pageSize}
          pageSizeOptions={[10, 25, 50]}
          rowCount={totalCount}
          onPageChange={({ pageIndex: pi, pageSize: ps }) => { setPageIndex(pi); setPageSize(ps); }}
          className={`flex-1 min-h-0 hidden md:flex ${isFetching ? 'opacity-60' : ''} transition-opacity`}
          noResults={<div className="p-8 text-center text-subtle">{t('dealPartnerRate.empty')}</div>}
        />

        {/* Mobile cards */}
        <div className={`flex-1 min-h-0 flex flex-col md:hidden ${isFetching ? 'opacity-60' : ''} transition-opacity`}>
          <div className="flex-1 overflow-auto better-scroll pb-8">
            {configs.length === 0 ? (
              <div className="p-8 text-center text-subtle">{t('dealPartnerRate.empty')}</div>
            ) : (
              <div className="flex flex-col divide-y divide-line border-b border-line">
                {paginated.map(row => (
                  <div
                    key={row.branch_id}
                    className="px-1 py-3 cursor-pointer active:bg-surface-hover"
                    onClick={() => canManage && handleEdit(row)}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{row.branch_name}</div>
                        <div className="text-xs text-subtle truncate">{row.company_name ?? '—'}</div>
                      </div>
                      {riskBadge(row.risk_party)}
                    </div>
                    <div className="flex items-center justify-between mt-1.5 text-sm">
                      <span className="text-xs text-subtle">
                        {t('dealPartnerRate.branchRate')} {fmtPct(row.branch_rate_percent)}
                        {' · '}
                        {t('dealPartnerRate.companyRate')} {fmtPct(row.company_rate_percent)}
                      </span>
                      <span className="tabular-nums font-medium">{fmtPct(row.total_rate_percent)}</span>
                    </div>
                    <div className="flex items-center gap-1 text-xs text-subtle mt-1">
                      <Receipt size={12} />
                      <span>{t('dealPartnerRate.docFeeAmount')} {fmtBaht(row.doc_fee_amount)}</span>
                    </div>
                    <div className="flex items-center gap-1 text-xs text-subtle mt-1">
                      <ShieldCheck size={12} />
                      <span>{t('dealPartnerRate.guaranteeFeeAmount')} {fmtBaht(row.guarantee_return_fee_amount)}</span>
                    </div>
                    {row.return_to_branch_name && (
                      <div className="flex items-center gap-1 text-xs text-subtle mt-1">
                        <Undo2 size={12} />
                        <span className="truncate">{row.return_to_branch_name}</span>
                      </div>
                    )}
                    {!row.has_payout_account && (
                      <div className="flex items-center gap-1 text-xs text-warning-fg mt-1">
                        <Landmark size={12} />
                        <span>{t('dealPartnerRate.payoutColumn')} · {t('dealPartnerRate.payoutMissing')}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
          {totalCount > 0 && (
            <DataTableFooter
              currentPage={pageIndex + 1}
              totalPages={Math.ceil(totalCount / pageSize)}
              onPageChange={p => setPageIndex(p - 1)}
              pageSize={pageSize}
              pageSizeOptions={[10, 25, 50]}
              onPageSizeChange={ps => { setPageSize(ps); setPageIndex(0); }}
              totalRows={totalCount}
            />
          )}
        </div>
      </div>

      <PolicyModal
        open={policyModalOpen}
        onClose={() => setPolicyModalOpen(false)}
        policy={policy}
        onSaved={handleSaved}
      />
      <BranchConfigModal
        open={configModalOpen}
        onClose={() => setConfigModalOpen(false)}
        config={editConfig}
        warehouses={warehouses}
        onSaved={handleSaved}
      />
    </>
  );
}
