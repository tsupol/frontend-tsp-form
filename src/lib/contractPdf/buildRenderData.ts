// Pure data-fetch + shape: contract id → ContractPdfInput. Used by both the
// PDF generator and the responsive preview modal. No I/O outside apiClient +
// fetchImageAsDataUrl; no UI concerns.

import { apiClient } from '../api';
import { fetchImageAsDataUrl } from './imageDataUrl';
import { toDateBE, toLongDateBE } from './dateBE';
import { CLAUSE_6_REPO_THRESHOLD_DAYS } from './constants';
import type { ContractPdfInput } from './types';

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

interface HandoverEmbed {
  has_box: boolean;
  has_charger_set: boolean;
  has_charger_cable: boolean;
  device_unlock_code: string | null;
  recorded_at: string | null;
}

interface SignatoryEmbed {
  slot: 'LESSOR' | 'WITNESS_1' | 'WITNESS_2';
  signatory_id: number;
  first_name: string;
  last_name: string;
  role: 'LESSOR' | 'WITNESS';
  signature_media_id: number;
}

interface BankAccountRow {
  bank_name: string;
  account_number: string;
  account_name: string;
}

interface CustomerRow {
  id: number;
  prefix: string | null;
  first_name: string;
  last_name: string;
  full_name: string;
  id_number: string;
  tel: string | null;
}

interface AddressRow {
  id: number;
  address_line1: string;
  address_line2: string | null;
  soi: string | null;
  road: string | null;
  sub_district: string;
  district: string;
  province: string;
  postal_code: string;
  address_type: string;
  is_default: boolean;
}

interface ReferenceRow {
  id: number;
  name: string;
  last_name: string | null;
  tel: string | null;
  relation: string | null;
}

interface AssetRow {
  asset_id: number;
  asset_code: string;
  variant_name: string;
  model_name: string;
  brand_name: string;
  family_name: string;
  manufacturer_color: string | null;
  physical_color: string | null;
  imei: string | null;
  serial_no: string | null;
  battery_health: number | null;
}

interface InstallmentRow {
  pay_no: number;
  due_date: string;
  due_amount: number;
}

function singleLineAddress(a: AddressRow): string {
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

function pickPrimaryAddress(rows: AddressRow[]): AddressRow | null {
  if (rows.length === 0) return null;
  return rows.find(r => r.is_default) ?? rows.find(r => r.address_type === 'HOME') ?? rows[0];
}

async function resolveMediaDataUrl(key: string | null): Promise<string | null> {
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

export class ContractRenderPrerequisiteError extends Error {
  readonly reason: 'no_bank_account' | 'no_lessor' | 'no_witnesses';
  constructor(reason: 'no_bank_account' | 'no_lessor' | 'no_witnesses') {
    super(`render prerequisite missing: ${reason}`);
    this.reason = reason;
  }
}

export async function buildContractRenderData(
  contract: ContractMin,
): Promise<ContractPdfInput> {
  if (contract.customer_id == null) {
    throw new Error('contract has no customer');
  }

  const [customers, addresses, references, assets, installments, sigDocs, idCardDocs, detailRows, bankAccounts, companyCfg, guarantorRows] = await Promise.all([
    apiClient.get<CustomerRow[]>(`/v_customers?id=eq.${contract.customer_id}&select=id,prefix,first_name,last_name,full_name,id_number,tel`),
    apiClient.get<AddressRow[]>(`/v_customer_addresses?customer_id=eq.${contract.customer_id}&order=is_default.desc,address_type`),
    apiClient.get<ReferenceRow[]>(`/v_customer_references?customer_id=eq.${contract.customer_id}&is_active=is.true&order=id&limit=2`),
    contract.device_id != null
      ? apiClient.get<AssetRow[]>(`/v_assets?asset_id=eq.${contract.device_id}&select=asset_id,asset_code,variant_name,model_name,brand_name,family_name,manufacturer_color,physical_color,imei,serial_no,battery_health&limit=1`)
      : Promise.resolve([] as AssetRow[]),
    apiClient.get<InstallmentRow[]>(`/v_installments?contract_id=eq.${contract.id}&order=pay_no&select=pay_no,due_date,due_amount`),
    apiClient.get<Array<{ id: number; file_url: string; customer_id: number }>>(
      `/v_contract_documents?contract_id=eq.${contract.id}&doc_type=eq.SIGNATURE_PAD&select=id,file_url,customer_id`,
    ),
    apiClient.get<Array<{ id: number; file_url: string }>>(
      `/v_customer_documents?customer_id=eq.${contract.customer_id}&doc_type=eq.ID_CARD_FRONT&is_active=eq.true&select=id,file_url`,
    ),
    apiClient.get<Array<{ handover: HandoverEmbed | null; signatories: SignatoryEmbed[] }>>(
      `/v_contract_detail?id=eq.${contract.id}&select=handover,signatories&limit=1`,
    ),
    apiClient.get<BankAccountRow[]>(
      `/v_bank_accounts?branch_id=eq.${contract.branch_id}&is_active=is.true&order=is_default.desc&select=bank_name,account_number,account_name&limit=1`,
    ).catch(() => [] as BankAccountRow[]),
    apiClient.get<Array<{ late_fee_per_day: number | null; late_fee_max_days: number | null; grace_period_days: number | null }>>(
      `/v_company_config?select=late_fee_per_day,late_fee_max_days,grace_period_days&limit=1`,
    ).catch(() => [] as Array<{ late_fee_per_day: number | null; late_fee_max_days: number | null; grace_period_days: number | null }>),
    apiClient.get<Array<{ customer_id: number; customer_name: string }>>(
      `/v_contract_customers?contract_id=eq.${contract.id}&role=eq.GUARANTOR&order=created_at&select=customer_id,customer_name`,
    ).catch(() => [] as Array<{ customer_id: number; customer_name: string }>),
  ]);

  const customer = customers[0];
  if (!customer) throw new Error('customer not found');
  const address = pickPrimaryAddress(addresses);
  const asset = assets[0] ?? null;

  const customerSigDoc = sigDocs.find(d => d.customer_id === contract.customer_id) ?? sigDocs[0] ?? null;

  const detail = detailRows[0];
  const handover = detail?.handover ?? null;
  const boundSigs = detail?.signatories ?? [];
  const boundBySlot = {
    LESSOR: boundSigs.find(s => s.slot === 'LESSOR') ?? null,
    WITNESS_1: boundSigs.find(s => s.slot === 'WITNESS_1') ?? null,
    WITNESS_2: boundSigs.find(s => s.slot === 'WITNESS_2') ?? null,
  };

  const lessorMediaId = boundBySlot.LESSOR?.signature_media_id ?? null;
  const w1MediaId = boundBySlot.WITNESS_1?.signature_media_id ?? null;
  const w2MediaId = boundBySlot.WITNESS_2?.signature_media_id ?? null;

  // Pair each guarantor with their signature row (if any) and resolve the
  // signature image to a data URL. The line stays blank when unsigned so
  // the contract can still be printed and signed by hand.
  const guarantorSigByCustomer = new Map<number, string>();
  for (const doc of sigDocs) {
    if (doc.customer_id !== contract.customer_id) {
      guarantorSigByCustomer.set(doc.customer_id, doc.file_url);
    }
  }

  const [lesseeSignatureDataUrl, lesseeIdCardDataUrl, lessorSig, w1Sig, w2Sig, guarantorSigs] = await Promise.all([
    resolveMediaDataUrl(customerSigDoc?.file_url ?? null),
    resolveMediaDataUrl(idCardDocs[0]?.file_url ?? null),
    resolveSignatureByMediaId(lessorMediaId),
    resolveSignatureByMediaId(w1MediaId),
    resolveSignatureByMediaId(w2MediaId),
    Promise.all(
      guarantorRows.map(async (g) => ({
        name: g.customer_name,
        signatureDataUrl: await resolveMediaDataUrl(guarantorSigByCustomer.get(g.customer_id) ?? null),
      })),
    ),
  ]);

  const lessorNameAuto = boundBySlot.LESSOR ? `${boundBySlot.LESSOR.first_name} ${boundBySlot.LESSOR.last_name}` : '';
  const witness1NameAuto = boundBySlot.WITNESS_1 ? `${boundBySlot.WITNESS_1.first_name} ${boundBySlot.WITNESS_1.last_name}` : '';
  const witness2NameAuto = boundBySlot.WITNESS_2 ? `${boundBySlot.WITNESS_2.first_name} ${boundBySlot.WITNESS_2.last_name}` : '';

  // Asset truth: handover row for accessories, asset row for battery.
  // Default the accessory booleans to true when the handover row is missing
  // (mirrors prior behaviour — pre-handover contracts assumed everything
  // included).
  const assetHasBox = handover?.has_box ?? true;
  const assetHasChargerSet = handover?.has_charger_set ?? true;
  const assetHasCable = handover?.has_charger_cable ?? true;
  const assetBatteryPct = asset?.battery_health ?? null;

  const bank = bankAccounts[0] ?? null;
  if (!bank) throw new ContractRenderPrerequisiteError('no_bank_account');
  const lateFeePerDay = companyCfg[0]?.late_fee_per_day ?? null;
  const lateFeeMaxDays = companyCfg[0]?.late_fee_max_days ?? null;
  const gracePeriodDays = companyCfg[0]?.grace_period_days ?? null;

  const lessorName = lessorNameAuto;
  const witness1Name = witness1NameAuto;
  const witness2Name = witness2NameAuto;
  if (!lessorName.trim()) throw new ContractRenderPrerequisiteError('no_lessor');
  if (!witness1Name.trim() || !witness2Name.trim()) throw new ContractRenderPrerequisiteError('no_witnesses');

  const ref1 = references[0] ?? null;
  const ref2 = references[1] ?? null;

  const monthly = contract.installment_amount ?? 0;
  const term = contract.value_month
    ?? contract.snapshot_term_months
    ?? contract.total_installments
    ?? installments.length;
  const upfront = (contract.down_payment ?? 0) + (contract.insurance_deposit ?? 0);

  const contractDateIso = contract.activated_at ?? contract.created_at;
  const dueDay = installments[0]?.due_date
    ? new Date(`${installments[0].due_date}T00:00:00+07:00`).getDate()
    : new Date(`${contractDateIso}`).getDate();

  // Draft contracts have no sale.installment rows yet (those are inserted by
  // fn_contract_activate). Synthesize a schedule from value_month × installment_amount
  // so the customer sees the same dates/amounts they'll get post-activation.
  const installmentRows = installments.length > 0
    ? installments.map(r => ({
        payNo: r.pay_no,
        amount: r.due_amount,
        dueDateBE: toDateBE(r.due_date),
      }))
    : Array.from({ length: term }, (_, i) => {
        const base = new Date(contractDateIso);
        const due = new Date(base);
        due.setMonth(due.getMonth() + i + 1);
        const iso = `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, '0')}-${String(due.getDate()).padStart(2, '0')}`;
        return { payNo: i + 1, amount: monthly, dueDateBE: toDateBE(iso) };
      });

  return {
    assetCode: asset?.asset_code ?? '—',
    assetSeq: '',
    contractCode: contract.code_display ?? contract.code,
    contractDateBE: toDateBE(contractDateIso),
    contractDateLongBE: toLongDateBE(contractDateIso),
    branchName: contract.branch_name,
    dueDayOfMonth: dueDay,

    lesseePrefix: customer.prefix ?? '',
    lesseeFirstName: customer.first_name,
    lesseeLastName: customer.last_name,
    lesseeIdNumber: customer.id_number,
    lesseeAddress: address ? singleLineAddress(address) : '',
    lesseeTel: customer.tel ?? '',

    ref1Label: ref1?.relation ?? '',
    ref1Name: ref1 ? `${ref1.name}${ref1.last_name ? ' ' + ref1.last_name : ''}` : '',
    ref1Tel: ref1?.tel ?? '',
    ref1Relation: ref1?.relation ?? '',
    ref2Label: ref2?.relation ?? '',
    ref2Name: ref2 ? `${ref2.name}${ref2.last_name ? ' ' + ref2.last_name : ''}` : '',
    ref2Tel: ref2?.tel ?? '',
    ref2Relation: ref2?.relation ?? '',

    deviceCategory: asset?.family_name ?? 'มือถือ',
    deviceBrand: asset?.brand_name ?? '',
    deviceModel: asset?.model_name ?? contract.model_name ?? '',
    deviceColor: asset?.physical_color ?? asset?.manufacturer_color ?? '',
    deviceStorage: asset?.variant_name ?? contract.variant_name ?? '',
    deviceImei: asset?.imei ?? (asset ? '' : (contract.device_identifier ?? '')),
    deviceSerial: asset?.serial_no ?? '',

    assetBatteryPct,
    assetHasBox,
    assetHasChargerSet,
    assetHasCable: assetHasCable,
    overrideBatteryPct: null,
    overrideHasBox: null,
    overrideHasChargerSet: null,
    overrideHasCable: null,

    upfrontAmount: upfront,
    monthlyAmount: monthly,
    termMonths: term,

    installments: installmentRows,

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
    lateFeePerDay: lateFeePerDay,
    lateFeeMaxDays: lateFeeMaxDays,
    gracePeriodDays: gracePeriodDays,
    repoThresholdDays: CLAUSE_6_REPO_THRESHOLD_DAYS,
  };
}
