// Pure data-fetch + shape: contract id → ContractPdfInput. Used by both the
// PDF generator and the responsive preview modal. No UI concerns.
//
// Data source (2026-06-17): ONE phase-aware RPC, api.fn_contract_render.
// It auto-detects phase — DRAFT returns a live-computed legal_core (same
// builder as fn_contract_signing_full_contract_preview, validate_ready-gated),
// signed returns the FROZEN snapshot. This replaces the old ~10-query
// client-side assembly (v_customers / addresses / references / assets /
// installments / signatures / handover / bank / company_config …).
//
//   legal_core  = the legally-binding part (terms / asset identity / parties).
//                 FROZEN once signed — used for the document's binding numbers.
//   reference   = branch / signatures / pools / asset condition — always live.
//   contract    = v_contract_detail meta — live current status.
//
// Images (signatures / ID cards) come back as file_url (NOT base64), exactly
// as before — we resolve them to data URLs here via fetchImageAsDataUrl.

import { apiClient } from '../api';
import { fetchImageAsDataUrl } from './imageDataUrl';
import { toDateBE, toLongDateBE, toDateTimeBE } from './dateBE';
import { CLAUSE_6_REPO_THRESHOLD_DAYS } from './constants';
import type { ContractPdfInput } from './types';

// Caller-supplied handle. Only `id` is required to drive the render RPC; the
// other fields are accepted for backward compatibility with existing call
// sites (they pass a v_contract_detail row) and used as display fallbacks.
export interface ContractMin {
  id: number;
  code: string;
  code_display: string | null;
  holding_id?: number;
  company_id?: number;
  branch_id: number;
  branch_name: string;
  customer_id: number | null;
  device_id: number | null;
  device_identifier: string | null;
  model_name: string | null;
  variant_name: string | null;
  brand_name?: string | null;
  family_name?: string | null;
  base_model_name?: string | null;
  manufacturer_color?: string | null;
  variant_sku_code?: string | null;
  category_name?: string | null;
  down_payment: number | null;
  insurance_deposit: number | null;
  installment_amount: number | null;
  value_month?: number | null;
  snapshot_installment_amount: number | null;
  snapshot_term_months: number | null;
  total_installments: number | null;
  activated_at: string | null;
  created_at: string;
}

// ── fn_contract_render response (subset we read) ──────────────────────────

interface RenderAsset {
  brand_name?: string | null;
  family_name?: string | null;
  model_name?: string | null;
  variant_name?: string | null;
  color?: string | null;
  sku_code?: string | null;
}

interface RenderParty {
  role: string;            // LESSEE / GUARANTOR
  prefix?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  id_number?: string | null;
  tel?: string | null;
}

interface RenderLegalCore {
  asset?: RenderAsset | null;
  agreed?: {
    agreed_price?: number | null;
    down_payment?: number | null;
    insurance_deposit?: number | null;
    installment_amount?: number | null;
    value_month?: number | null;
  } | null;
  parties?: RenderParty[] | null;
}

interface RenderAddress {
  address_line1?: string | null;
  address_line2?: string | null;
  soi?: string | null;
  road?: string | null;
  sub_district?: string | null;
  district?: string | null;
  province?: string | null;
  postal_code?: string | null;
}

interface RenderReference {
  name?: string | null;
  last_name?: string | null;
  tel?: string | null;
  relation?: string | null;
}

interface RenderIdDocument {
  doc_type: string;
  file_url: string;
}

interface RenderLessee {
  prefix?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  id_number?: string | null;
  tel?: string | null;
  address?: RenderAddress | null;
  references?: RenderReference[] | null;
  id_documents?: RenderIdDocument[] | null;
}

interface RenderGuarantor {
  customer_id: number;
  full_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  signature?: string | null;            // file_url
  id_documents?: RenderIdDocument[] | null;
}

interface RenderSignatory {
  slot?: 'LESSOR' | 'WITNESS_1' | 'WITNESS_2' | null;
  first_name?: string | null;
  last_name?: string | null;
  signature_media_id?: number | null;
}

interface RenderSignature {
  customer_id: number;
  customer_name?: string | null;
  file_url: string;
}

interface RenderAssetLive {
  asset_code?: string | null;
  family_name?: string | null;
  brand_name?: string | null;
  model_name?: string | null;
  manufacturer_color?: string | null;
  physical_color?: string | null;
  imei?: string | null;
  serial_no?: string | null;
  battery_health?: number | null;
}

interface RenderInstallment {
  pay_no: number;
  due_date?: string | null;
  due_amount?: number | null;
  paid_amount?: number | null;
  status?: string | null;
}

interface RenderBankAccount {
  bank_name: string;
  account_number: string;
  account_name: string;
}

interface RenderBranch {
  name?: string | null;
}

interface RenderHandover {
  has_box?: boolean | null;
  has_charger_set?: boolean | null;
  has_charger_cable?: boolean | null;
}

interface RenderCompanyConfig {
  late_fee_per_day?: number | null;
  late_fee_max_days?: number | null;
  grace_period_days?: number | null;
}

interface RenderContract {
  code?: string | null;
  code_display?: string | null;
  activated_at?: string | null;
  created_at?: string | null;
}

interface ContractRenderResponse {
  contract_id: number;
  state: string;
  is_signed: boolean;
  hash: string | null;
  legal_core: RenderLegalCore | null;
  contract: RenderContract | null;
  branch: RenderBranch | null;
  lessee: RenderLessee | null;
  guarantors: RenderGuarantor[];
  signatories: RenderSignatory[];
  signatures: RenderSignature[];
  asset: RenderAssetLive | null;
  installments: RenderInstallment[];
  bank_accounts: RenderBankAccount[];
  company_config: RenderCompanyConfig | null;
  handover: RenderHandover | null;
}

function singleLineAddress(a: RenderAddress): string {
  const parts: string[] = [];
  if (a.address_line1) parts.push(a.address_line1);
  if (a.address_line2) parts.push(a.address_line2);
  if (a.soi) parts.push(`ซ.${a.soi}`);
  if (a.road) parts.push(`ถ.${a.road}`);
  if (a.sub_district) parts.push(`ต.${a.sub_district}`);
  if (a.district) parts.push(`อ.${a.district}`);
  if (a.province) parts.push(`จ.${a.province}`);
  if (a.postal_code) parts.push(a.postal_code);
  return parts.join(' ');
}

// Catalog has no first-class "storage" attribute (see filing 2026-06-02). The
// capacity is baked into model_name (e.g. "Base 256GB"). Strip a base-model
// prefix when present, else fall back to a "###[ ]?(GB|TB|MB)" token.
function extractStorage(modelName: string | null | undefined, baseModelName: string | null | undefined): string {
  if (!modelName) return '';
  if (baseModelName && modelName.startsWith(baseModelName)) {
    const tail = modelName.slice(baseModelName.length).trim();
    if (tail) return tail;
  }
  const m = modelName.match(/\d+\s?(?:GB|TB|MB)\b/i);
  return m ? m[0].replace(/\s+/g, '') : '';
}

async function resolveMediaDataUrl(key: string | null | undefined): Promise<string | null> {
  if (!key) return null;
  try {
    return await fetchImageAsDataUrl(key);
  } catch {
    return null;
  }
}

async function resolveSignatureByMediaId(mediaId: number | null | undefined): Promise<string | null> {
  if (!mediaId) return null;
  try {
    const rows = await apiClient.get<Array<{ storage_path: string }>>(
      `/v_entity_media?media_id=eq.${mediaId}&select=storage_path&limit=1`,
    );
    if (!rows[0]) return null;
    return await fetchImageAsDataUrl(rows[0].storage_path);
  } catch {
    return null;
  }
}

// Reasons preserved from the old assembly so the modals' prerequisite UI
// keeps working — surfaced via the bank/lessor/witness checks below.
export class ContractRenderPrerequisiteError extends Error {
  readonly reason: 'no_bank_account' | 'no_lessor' | 'no_witnesses';
  constructor(reason: 'no_bank_account' | 'no_lessor' | 'no_witnesses') {
    super(`render prerequisite missing: ${reason}`);
    this.reason = reason;
  }
}

function composeName(prefix: string | null | undefined, first: string | null | undefined, last: string | null | undefined): string {
  return [prefix, first, last].filter(Boolean).join(' ').trim();
}

export async function buildContractRenderData(
  contract: ContractMin,
): Promise<ContractPdfInput> {
  const res = await apiClient.rpc<ContractRenderResponse>('fn_contract_render', {
    p_contract_id: contract.id,
    p_signing_id: null,
  });

  const legal = res.legal_core;
  // legal_core is populated even for incomplete drafts (the render is
  // readiness-gated separately, surfaced in the document step). A null here is
  // a genuine exceptional case — the server's payload builder threw — not a
  // user-facing prerequisite, so fail loudly rather than mislead.
  if (!legal) {
    throw new Error('fn_contract_render returned no legal_core');
  }

  const agreed = legal.agreed ?? {};
  const legalAsset = legal.asset ?? {};
  const liveAsset = res.asset;
  const lessee = res.lessee;
  const branch = res.branch;
  const contractMeta = res.contract;

  // ── Bank account (required) ──
  const bank = res.bank_accounts[0] ?? null;
  if (!bank) throw new ContractRenderPrerequisiteError('no_bank_account');

  // ── Signatories: contract binding wins; resolve signature media ──
  const sigBySlot = {
    LESSOR: res.signatories.find(s => s.slot === 'LESSOR') ?? null,
    WITNESS_1: res.signatories.find(s => s.slot === 'WITNESS_1') ?? null,
    WITNESS_2: res.signatories.find(s => s.slot === 'WITNESS_2') ?? null,
  };
  const lessorName = sigBySlot.LESSOR ? composeName(null, sigBySlot.LESSOR.first_name, sigBySlot.LESSOR.last_name) : '';
  const witness1Name = sigBySlot.WITNESS_1 ? composeName(null, sigBySlot.WITNESS_1.first_name, sigBySlot.WITNESS_1.last_name) : '';
  const witness2Name = sigBySlot.WITNESS_2 ? composeName(null, sigBySlot.WITNESS_2.first_name, sigBySlot.WITNESS_2.last_name) : '';
  if (!lessorName) throw new ContractRenderPrerequisiteError('no_lessor');
  if (!witness1Name || !witness2Name) throw new ContractRenderPrerequisiteError('no_witnesses');

  // ── Parties (frozen identity) — prefer legal_core.parties for the LESSEE ──
  const lesseeParty = (legal.parties ?? []).find(p => p.role === 'LESSEE') ?? null;

  // ── Lessee signature + ID card (file_url → data URL) ──
  const lesseeSigDoc = res.signatures.find(s => s.customer_id === contract.customer_id) ?? res.signatures[0] ?? null;
  const lesseeIdDoc = (lessee?.id_documents ?? []).find(d => d.doc_type === 'ID_CARD_FRONT')
    ?? (lessee?.id_documents ?? [])[0]
    ?? null;

  // ── Guarantors: name + signature + ID card ──
  const guarantorSigByCustomer = new Map<number, string>();
  for (const sig of res.signatures) {
    if (sig.customer_id !== contract.customer_id) {
      guarantorSigByCustomer.set(sig.customer_id, sig.file_url);
    }
  }

  const [
    lesseeSignatureDataUrl,
    lesseeIdCardDataUrl,
    lessorSig,
    w1Sig,
    w2Sig,
    guarantorSigs,
  ] = await Promise.all([
    resolveMediaDataUrl(lesseeSigDoc?.file_url),
    resolveMediaDataUrl(lesseeIdDoc?.file_url),
    resolveSignatureByMediaId(sigBySlot.LESSOR?.signature_media_id),
    resolveSignatureByMediaId(sigBySlot.WITNESS_1?.signature_media_id),
    resolveSignatureByMediaId(sigBySlot.WITNESS_2?.signature_media_id),
    Promise.all((res.guarantors ?? []).map(async (g) => {
      const idDoc = (g.id_documents ?? []).find(d => d.doc_type === 'ID_CARD_FRONT') ?? (g.id_documents ?? [])[0] ?? null;
      const [signatureDataUrl, idCardDataUrl] = await Promise.all([
        resolveMediaDataUrl(g.signature ?? guarantorSigByCustomer.get(g.customer_id)),
        resolveMediaDataUrl(idDoc?.file_url),
      ]);
      const name = g.full_name || composeName(null, g.first_name, g.last_name);
      return { name, signatureDataUrl, idCardDataUrl };
    })),
  ]);

  // ── Handover (default true when absent — mirrors prior behaviour) ──
  const handover = res.handover;
  const assetHasBox = handover?.has_box ?? true;
  const assetHasChargerSet = handover?.has_charger_set ?? true;
  const assetHasCable = handover?.has_charger_cable ?? true;
  const assetBatteryPct = liveAsset?.battery_health ?? null;

  // ── References (lessee) ──
  const ref1 = (lessee?.references ?? [])[0] ?? null;
  const ref2 = (lessee?.references ?? [])[1] ?? null;

  // ── Money / terms (binding numbers from legal_core) ──
  const monthly = agreed.installment_amount ?? contract.installment_amount ?? 0;
  const term = agreed.value_month
    ?? contract.value_month
    ?? contract.snapshot_term_months
    ?? contract.total_installments
    ?? res.installments.length;
  const upfront = agreed.down_payment ?? contract.down_payment ?? 0;
  const insuranceDeposit = agreed.insurance_deposit ?? contract.insurance_deposit ?? 0;

  const contractDateIso = contractMeta?.activated_at ?? contract.activated_at
    ?? contractMeta?.created_at ?? contract.created_at;

  // ── Installment schedule (real rows, or server-synthesized for a draft) ──
  const realRows = res.installments.filter(r => r.due_date != null);
  const installmentRows = realRows.length > 0
    ? realRows.map(r => ({
        payNo: r.pay_no,
        amount: r.due_amount ?? 0,
        paidAmount: r.paid_amount ?? 0,
        dueDateBE: toDateBE(r.due_date),
      }))
    : Array.from({ length: term }, (_, i) => {
        const base = new Date(contractDateIso);
        const due = new Date(base);
        due.setMonth(due.getMonth() + i + 1);
        const iso = `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, '0')}-${String(due.getDate()).padStart(2, '0')}`;
        return { payNo: i + 1, amount: monthly, paidAmount: 0, dueDateBE: toDateBE(iso) };
      });

  const dueDay = realRows[0]?.due_date
    ? new Date(`${realRows[0].due_date}T00:00:00+07:00`).getDate()
    : new Date(`${contractDateIso}`).getDate();

  const latestPaidIso = res.installments
    .map(r => (r.paid_amount && r.paid_amount > 0 && r.due_date) ? r.due_date : null)
    .filter((v): v is string => !!v)
    .sort()
    .pop() ?? null;
  const scheduleUpdatedAtBE = latestPaidIso ? toDateTimeBE(latestPaidIso) : '';

  // ── Device display: live asset wins, else frozen legal_core.asset names ──
  const modelNameForStorage = legalAsset.model_name ?? liveAsset?.model_name ?? contract.model_name ?? null;

  return {
    assetCode: liveAsset?.asset_code ?? '—',
    assetSeq: '',
    contractCode: contractMeta?.code_display ?? contract.code_display ?? contract.code,
    contractDateBE: toDateBE(contractDateIso),
    contractDateLongBE: toLongDateBE(contractDateIso),
    branchName: branch?.name ?? contract.branch_name,
    dueDayOfMonth: dueDay,

    lesseePrefix: lesseeParty?.prefix ?? lessee?.prefix ?? '',
    lesseeFirstName: lesseeParty?.first_name ?? lessee?.first_name ?? '',
    lesseeLastName: lesseeParty?.last_name ?? lessee?.last_name ?? '',
    lesseeIdNumber: lesseeParty?.id_number ?? lessee?.id_number ?? '',
    lesseeAddress: lessee?.address ? singleLineAddress(lessee.address) : '',
    lesseeTel: lesseeParty?.tel ?? lessee?.tel ?? '',

    ref1Label: ref1?.relation ?? '',
    ref1Name: ref1 ? `${ref1.name ?? ''}${ref1.last_name ? ' ' + ref1.last_name : ''}`.trim() : '',
    ref1Tel: ref1?.tel ?? '',
    ref1Relation: ref1?.relation ?? '',
    ref2Label: ref2?.relation ?? '',
    ref2Name: ref2 ? `${ref2.name ?? ''}${ref2.last_name ? ' ' + ref2.last_name : ''}`.trim() : '',
    ref2Tel: ref2?.tel ?? '',
    ref2Relation: ref2?.relation ?? '',

    deviceCategory: legalAsset.family_name ?? liveAsset?.family_name ?? contract.family_name ?? contract.category_name ?? 'มือถือ',
    deviceBrand: legalAsset.brand_name ?? liveAsset?.brand_name ?? contract.brand_name ?? '',
    deviceModel: contract.base_model_name ?? legalAsset.model_name ?? liveAsset?.model_name ?? contract.model_name ?? '',
    deviceColor: legalAsset.color ?? liveAsset?.physical_color ?? liveAsset?.manufacturer_color ?? contract.manufacturer_color ?? '',
    deviceStorage: extractStorage(modelNameForStorage, contract.base_model_name),
    deviceImei: liveAsset?.imei ?? (liveAsset ? '' : (contract.device_identifier ?? '')),
    deviceSerial: liveAsset?.serial_no ?? '',

    assetBatteryPct,
    assetHasBox,
    assetHasChargerSet,
    assetHasCable,
    overrideBatteryPct: null,
    overrideHasBox: null,
    overrideHasChargerSet: null,
    overrideHasCable: null,

    upfrontAmount: upfront,
    insuranceDeposit,
    monthlyAmount: monthly,
    termMonths: term,

    installments: installmentRows,
    scheduleUpdatedAtBE,

    lesseeSignatureDataUrl,
    lesseeIdCardDataUrl,
    lessorSignatureDataUrl: lessorSig,
    witness1SignatureDataUrl: w1Sig,
    witness2SignatureDataUrl: w2Sig,
    lessorName,
    witness1Name,
    witness2Name,
    guarantors: guarantorSigs,

    bankName: bank.bank_name,
    bankAccountNumber: bank.account_number,
    bankAccountName: bank.account_name,
    lateFeePerDay: res.company_config?.late_fee_per_day ?? null,
    lateFeeMaxDays: res.company_config?.late_fee_max_days ?? null,
    gracePeriodDays: res.company_config?.grace_period_days ?? null,
    repoThresholdDays: CLAUSE_6_REPO_THRESHOLD_DAYS,

    // Verification anchor — printed in the PDF footer (first 16 chars). Null
    // for drafts; the server omits the hash from the footer when empty.
    hash: res.hash ?? undefined,
  };
}
