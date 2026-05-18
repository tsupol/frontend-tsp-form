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

interface BuildOptions {
  /** When true, every blank line in the PDF gets filled with " " so it prints empty (default). */
  blankBattery?: string;       // override placeholder if you have battery data elsewhere
}

async function buildInput(contract: ContractMin, opts: BuildOptions = {}): Promise<ContractPdfInput> {
  if (contract.customer_id == null) {
    throw new Error('contract has no customer');
  }

  const [customers, addresses, references, assets, installments, sigDocs, idCardDocs] = await Promise.all([
    apiClient.get<CustomerRow[]>(`/v_customers?id=eq.${contract.customer_id}&select=id,prefix,first_name,last_name,full_name,id_number,tel`),
    apiClient.get<AddressRow[]>(`/v_customer_addresses?customer_id=eq.${contract.customer_id}&order=is_default.desc,address_type`),
    apiClient.get<ReferenceRow[]>(`/v_customer_references?customer_id=eq.${contract.customer_id}&is_active=is.true&order=id&limit=2`),
    contract.device_id != null
      ? apiClient.get<AssetRow[]>(`/v_assets?asset_id=eq.${contract.device_id}&select=asset_id,asset_code,variant_name,model_name,brand_name,family_name,manufacturer_color,physical_color,imei,serial_no&limit=1`)
      : Promise.resolve([] as AssetRow[]),
    apiClient.get<InstallmentRow[]>(`/v_installments?contract_id=eq.${contract.id}&order=pay_no&select=pay_no,due_date,due_amount`),
    apiClient.get<Array<{ id: number; file_url: string; customer_id: number }>>(
      `/v_contract_documents?contract_id=eq.${contract.id}&doc_type=eq.SIGNATURE_PAD&select=id,file_url,customer_id`,
    ),
    apiClient.get<Array<{ id: number; file_url: string }>>(
      `/v_customer_documents?customer_id=eq.${contract.customer_id}&doc_type=eq.ID_CARD_FRONT&is_active=eq.true&select=id,file_url`,
    ),
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
  const [lesseeSignatureDataUrl, lesseeIdCardDataUrl] = await Promise.all([
    resolveMediaDataUrl(customerSigDoc?.file_url ?? null),
    resolveMediaDataUrl(idCardDocs[0]?.file_url ?? null),
  ]);

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

    appleId: '',         // TODO(BE): no contract field for this yet
    applePassword: '',   // TODO(BE)
    passcode: '',        // TODO(BE)

    deviceCategory: asset?.family_name ?? 'มือถือ',
    deviceBrand: asset?.brand_name ?? '',
    deviceModel: asset?.model_name ?? contract.model_name ?? '',
    deviceColor: asset?.physical_color ?? asset?.manufacturer_color ?? '',
    deviceStorage: asset?.variant_name ?? contract.variant_name ?? '',
    deviceImei: asset?.imei ?? asset?.serial_no ?? contract.device_identifier ?? '',
    deviceBattery: opts.blankBattery ?? '100%',  // TODO(BE): no battery_health field on v_assets
    deviceBoxNote: 'มีกล่อง',           // TODO(BE): contract accessories table
    deviceChargerBlockNote: 'ชุดชาร์จ',
    deviceChargerCableNote: 'สายชาร์จ',

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
    lessorSignatureDataUrl: null,    // TODO(BE): static lessor signature image
    witness1SignatureDataUrl: null,
    witness2SignatureDataUrl: null,
  };
}

export interface UseGenerateContractPdf {
  generating: boolean;
  generate: (contract: ContractMin) => Promise<void>;
  error: string | null;
}

export function useGenerateContractPdf(): UseGenerateContractPdf {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(async (contract: ContractMin) => {
    setError(null);
    setGenerating(true);
    try {
      const input = await buildInput(contract);
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
