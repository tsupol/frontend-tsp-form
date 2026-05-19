// React hook: triggers contract PDF generation by gathering every piece of
// data the document definition needs, then handing off to the pdfmake-based
// downloader.
//
// Data sources:
//   - v_contract_detail (already in caller's hand, passed in)
//   - v_customers       (lessee prefix, names, ID number)
//   - v_customer_addresses (single line address; default → home → first)
//   - v_customer_references (up to 2 active references)
//   - v_assets           (asset_code, IMEI, color, storage, variant_name)
//   - v_installments     (full schedule with due_date and due_amount)
//   - v_contract_documents + privateMediaUrl (customer signature → data URL)
//
// Battery health and accessory tick-boxes are not in the BE yet; we fall back
// to sensible defaults and TODO(BE).

import { useCallback, useState } from 'react';
import { apiClient } from '../../lib/api';
import { fetchImageAsDataUrl } from '../../lib/contractPdf/imageDataUrl';
import { toDateBE, toLongDateBE } from '../../lib/contractPdf/dateBE';
import { downloadContractPdf } from '../../lib/contractPdf/generate';
import type { ContractPdfInput } from '../../lib/contractPdf/types';

interface ContractMin {
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

export interface PdfOverrides {
  // Signatory render-only overrides (do not write back to contract_signatory)
  lessorMediaId?: number | null;
  lessorName?: string;
  witness1MediaId?: number | null;
  witness1Name?: string;
  witness2MediaId?: number | null;
  witness2Name?: string;

  // Apple ID / device fields (no BE columns — render-only)
  appleId?: string;
  applePassword?: string;
  passcode?: string;
  battery?: string;

  // Handover ticks (UI may pre-set these from v_contract_handover; up to caller
  // to also persist via fn_contract_set_handover before generating)
  hasBox?: boolean;
  hasChargerSet?: boolean;
  hasChargerCable?: boolean;
}

interface BuildOptions {
  /** When true, every blank line in the PDF gets filled with " " so it prints empty (default). */
  blankBattery?: string;       // override placeholder if you have battery data elsewhere
  overrides?: PdfOverrides;
}

async function buildInput(contract: ContractMin, opts: BuildOptions = {}): Promise<ContractPdfInput> {
  if (contract.customer_id == null) {
    throw new Error('contract has no customer');
  }

  const [customers, addresses, references, assets, installments, sigDocs, idCardDocs, detailRows, bankAccounts, companyCfg] = await Promise.all([
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
    apiClient.get<Array<{ late_fee_per_day: number | null }>>(
      `/v_company_config?select=late_fee_per_day&limit=1`,
    ).catch(() => [] as Array<{ late_fee_per_day: number | null }>),
  ]);

  const customer = customers[0];
  if (!customer) throw new Error('customer not found');
  const address = pickPrimaryAddress(addresses);
  const asset = assets[0] ?? null;

  // Signatures live alongside guarantor signatures in v_contract_documents,
  // distinguished by customer_id. Pull both the lessee signature and the
  // ID-card image in parallel via the misc-go /proxy/s3 endpoint (R2 CORS
  // doesn't allow direct browser fetches).
  const customerSigDoc = sigDocs.find(d => d.customer_id === contract.customer_id) ?? sigDocs[0] ?? null;
  const ov = opts.overrides ?? {};

  // ── Resolve handover + signatories from v_contract_detail (embedded jsonb) ──
  // Overrides take precedence; if absent, fall back to the persisted snapshot.
  const detail = detailRows[0];
  const handover = detail?.handover ?? null;
  const boundSigs = detail?.signatories ?? [];
  const boundBySlot = {
    LESSOR: boundSigs.find(s => s.slot === 'LESSOR') ?? null,
    WITNESS_1: boundSigs.find(s => s.slot === 'WITNESS_1') ?? null,
    WITNESS_2: boundSigs.find(s => s.slot === 'WITNESS_2') ?? null,
  };

  const lessorMediaId = ov.lessorMediaId ?? boundBySlot.LESSOR?.signature_media_id ?? null;
  const w1MediaId = ov.witness1MediaId ?? boundBySlot.WITNESS_1?.signature_media_id ?? null;
  const w2MediaId = ov.witness2MediaId ?? boundBySlot.WITNESS_2?.signature_media_id ?? null;

  const [lesseeSignatureDataUrl, lesseeIdCardDataUrl, lessorSig, w1Sig, w2Sig] = await Promise.all([
    resolveMediaDataUrl(customerSigDoc?.file_url ?? null),
    resolveMediaDataUrl(idCardDocs[0]?.file_url ?? null),
    resolveSignatureByMediaId(lessorMediaId),
    resolveSignatureByMediaId(w1MediaId),
    resolveSignatureByMediaId(w2MediaId),
  ]);

  const lessorNameAuto = boundBySlot.LESSOR ? `${boundBySlot.LESSOR.first_name} ${boundBySlot.LESSOR.last_name}` : '';
  const witness1NameAuto = boundBySlot.WITNESS_1 ? `${boundBySlot.WITNESS_1.first_name} ${boundBySlot.WITNESS_1.last_name}` : '';
  const witness2NameAuto = boundBySlot.WITNESS_2 ? `${boundBySlot.WITNESS_2.first_name} ${boundBySlot.WITNESS_2.last_name}` : '';

  // ── Handover ticks: override > persisted snapshot > true (legacy default) ──
  const hasBox = ov.hasBox ?? handover?.has_box ?? true;
  const hasChargerSet = ov.hasChargerSet ?? handover?.has_charger_set ?? true;
  const hasChargerCable = ov.hasChargerCable ?? handover?.has_charger_cable ?? true;
  const passcode = ov.passcode ?? handover?.device_unlock_code ?? '';

  // Battery: override > asset.battery_health > legacy fallback
  const batteryAuto = asset?.battery_health != null ? `${asset.battery_health}%` : '';
  const battery = ov.battery ?? batteryAuto ?? opts.blankBattery ?? '';

  // Bank + late fee from BE; fall back to constants in the builder if empty
  const bank = bankAccounts[0] ?? null;
  const lateFeePerDay = companyCfg[0]?.late_fee_per_day ?? null;

  const ref1 = references[0] ?? null;
  const ref2 = references[1] ?? null;

  const monthly = contract.snapshot_installment_amount ?? contract.installment_amount ?? 0;
  const term = contract.snapshot_term_months ?? contract.total_installments ?? installments.length;
  const upfront = (contract.down_payment ?? 0) + (contract.insurance_deposit ?? 0);

  const contractDateIso = contract.activated_at ?? contract.created_at;
  const dueDay = installments[0]?.due_date
    ? new Date(`${installments[0].due_date}T00:00:00+07:00`).getDate()
    : new Date(`${contractDateIso}`).getDate();

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

    appleId: ov.appleId ?? '',
    applePassword: ov.applePassword ?? '',
    passcode,

    deviceCategory: asset?.family_name ?? 'มือถือ',
    deviceBrand: asset?.brand_name ?? '',
    deviceModel: asset?.model_name ?? contract.model_name ?? '',
    deviceColor: asset?.physical_color ?? asset?.manufacturer_color ?? '',
    deviceStorage: asset?.variant_name ?? contract.variant_name ?? '',
    deviceImei: asset?.imei ?? (asset ? '' : (contract.device_identifier ?? '')),
    deviceSerial: asset?.serial_no ?? '',
    deviceBattery: battery,
    deviceBoxNote: hasBox ? 'มีกล่อง' : '',
    deviceChargerBlockNote: hasChargerSet ? 'ชุดชาร์จ' : '',
    deviceChargerCableNote: hasChargerCable ? 'สายชาร์จ' : '',

    upfrontAmount: upfront,
    monthlyAmount: monthly,
    termMonths: term,

    installments: installments.map(r => ({
      payNo: r.pay_no,
      amount: r.due_amount,
      dueDateBE: toDateBE(r.due_date),
    })),

    lesseeSignatureDataUrl,
    lesseeIdCardDataUrl,
    lessorSignatureDataUrl: lessorSig,
    witness1SignatureDataUrl: w1Sig,
    witness2SignatureDataUrl: w2Sig,
    lessorName: ov.lessorName || lessorNameAuto,
    witness1Name: ov.witness1Name || witness1NameAuto,
    witness2Name: ov.witness2Name || witness2NameAuto,

    bankName: bank?.bank_name ?? '',
    bankAccountNumber: bank?.account_number ?? '',
    bankAccountName: bank?.account_name ?? '',
    lateFeePerDay: lateFeePerDay,
  };
}

export interface UseGenerateContractPdf {
  generating: boolean;
  generate: (contract: ContractMin, overrides?: PdfOverrides) => Promise<void>;
  error: string | null;
}

export function useGenerateContractPdf(): UseGenerateContractPdf {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(async (contract: ContractMin, overrides?: PdfOverrides) => {
    setError(null);
    setGenerating(true);
    try {
      const input = await buildInput(contract, { overrides });
      const code = contract.code_display ?? contract.code;
      await downloadContractPdf(input, `${code}.pdf`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'pdf generation failed');
      throw err;
    } finally {
      setGenerating(false);
    }
  }, []);

  return { generating, generate, error };
}
