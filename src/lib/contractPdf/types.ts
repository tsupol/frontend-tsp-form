// Data shape fed into the docDefinition builder. All formatting (BE dates,
// currency, full name) happens before the builder runs — the builder is pure.

export interface ContractPdfInput {
  // Header
  assetCode: string;          // "ATPA1202604280003"
  assetSeq: string;           // legacy short asset code printed after slash, "59579"; pass '' if none
  contractCode: string;       // "20260518ST3TPA10002"
  contractDateBE: string;     // "18/05/2569"  (Buddhist Era, DD/MM/YYYY)
  contractDateLongBE: string; // "18 พฤษภาคม พ.ศ. 2569"
  branchName: string;         // "ทำที่" — branch where contract was signed
  dueDayOfMonth: number;      // 18

  // Lessee (customer)
  lesseePrefix: string;       // "น.ส." (already includes the dot)
  lesseeFirstName: string;
  lesseeLastName: string;
  lesseeIdNumber: string;
  lesseeAddress: string;      // formatted single-line address
  lesseeTel: string;          // primary phone

  // References (relatives) — exactly 2 slots; empty if not provided
  ref1Label: string;          // "แฟน"  (role / relation)
  ref1Name: string;
  ref1Tel: string;
  ref1Relation: string;
  ref2Label: string;
  ref2Name: string;
  ref2Tel: string;
  ref2Relation: string;

  // Device
  deviceCategory: string;     // "มือถือ"
  deviceBrand: string;        // "Apple"
  deviceModel: string;        // "iPhone 17"
  deviceColor: string;        // "ม่วง"
  deviceStorage: string;      // "256 GB"
  deviceImei: string;         // "358883220481763" — empty if none
  deviceSerial: string;       // "F2LZK1ABCD" — empty if none

  // Asset-derived condition. asset* = inventory truth; override* wins when
  // non-null. misc-go renders Thai labels (มีกล่อง / ไม่มีกล่อง, …).
  assetBatteryPct: number | null;     // 0–100, null = unknown
  assetHasBox: boolean;
  assetHasChargerSet: boolean;
  assetHasCable: boolean;
  overrideBatteryPct: number | null;
  overrideHasBox: boolean | null;
  overrideHasChargerSet: boolean | null;
  overrideHasCable: boolean | null;

  // Money
  upfrontAmount: number;      // 7,900 — ค่าเปิดใช้/ค่าดำเนินการ/ค่าเสื่อม
  monthlyAmount: number;      // 2,800
  termMonths: number;         // 12

  // Installment schedule — already converted to BE
  installments: Array<{
    payNo: number;
    amount: number;
    dueDateBE: string;        // "18/06/2569"
  }>;

  // Signatures — base64 data URLs (or null for blank-line placeholder)
  lesseeSignatureDataUrl: string | null;
  lessorSignatureDataUrl: string | null;
  witness1SignatureDataUrl: string | null;
  witness2SignatureDataUrl: string | null;

  // Override names for lessor / witnesses (empty string → fall back to constants.ts)
  lessorName: string;
  witness1Name: string;
  witness2Name: string;

  // Bank / company config — pulled from BE; builder falls back to constants if empty
  bankName: string;
  bankAccountNumber: string;
  bankAccountName: string;
  lateFeePerDay: number | null;
  lateFeeMaxDays: number | null;
  gracePeriodDays: number | null;
  repoThresholdDays: number;

  // ID-card image embedded on page 3 above the "สำเนาถูกต้อง" heading
  lesseeIdCardDataUrl: string | null;

  // Preview mode: server skips the lessee signature when true. Used for the
  // staff "show the customer before signing" flow.
  preview?: boolean;
}

// Resolve asset-vs-override into the values the renderer actually prints.
// Mirrors misc-go's template helpers so the local pdfmake / preview render
// matches the server PDF.
export function resolveBattery(input: ContractPdfInput): string {
  const pct = input.overrideBatteryPct ?? input.assetBatteryPct;
  return pct == null ? '' : `${pct}%`;
}
export function resolveHasBox(input: ContractPdfInput): boolean {
  return input.overrideHasBox ?? input.assetHasBox;
}
export function resolveHasChargerSet(input: ContractPdfInput): boolean {
  return input.overrideHasChargerSet ?? input.assetHasChargerSet;
}
export function resolveHasCable(input: ContractPdfInput): boolean {
  return input.overrideHasCable ?? input.assetHasCable;
}
export function thaiYesNo(b: boolean, noun: string): string {
  return (b ? 'มี' : 'ไม่มี') + noun;
}
