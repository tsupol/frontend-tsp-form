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

  // Apple ID / passcode panel — left blank for non-iOS devices
  appleId: string;
  applePassword: string;
  passcode: string;

  // Device
  deviceCategory: string;     // "มือถือ"
  deviceBrand: string;        // "Apple"
  deviceModel: string;        // "iPhone 17"
  deviceColor: string;        // "ม่วง"
  deviceStorage: string;      // "256 GB"
  deviceImei: string;         // "358883220481763"
  deviceBattery: string;      // "100%"
  deviceBoxNote: string;      // "มีกล่อง"
  deviceChargerBlockNote: string; // "ชุดชาร์จ"
  deviceChargerCableNote: string; // "สายชาร์จ"

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

  // ID-card image embedded on page 3 above the "สำเนาถูกต้อง" heading
  lesseeIdCardDataUrl: string | null;
}
