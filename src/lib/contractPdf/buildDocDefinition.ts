// Pure builder: input data → pdfmake docDefinition. No I/O, no React.
//
// Layout follows the legacy sample contract:
//   Page 1 — clauses 1-8 with embedded parties + device + price.
//   Page 2 — รายการทรัพย์สิน, contact info, Apple ID, installment schedule, sigs.
//   Page 3 — สำเนาถูกต้อง (true copy).
//
// pdfmake quirks worth keeping in mind:
//   - `text` runs concatenate inline; use { text: [...] } for bold-mid-sentence.
//   - `pageBreak: 'before'` on the first node of a section forces a new page.
//   - All Thai text needs the `Sarabun` default font (see fonts.ts).

import type { TDocumentDefinitions, Content, Column } from 'pdfmake/interfaces';
type InlineRun = string | { text: string | InlineRun[]; [k: string]: unknown };
import { fmtCurrency } from '../format';
import { LESSOR,
  CLAUSE_2_1_BODY, CLAUSE_2_1_FOOTNOTE, CLAUSE_3, CLAUSE_4,
  CLAUSE_5_INTRO, CLAUSE_5_LATE_FEE_BAHT, buildClause6, CLAUSE_7, CLAUSE_8,
  FOOTER_PAYMENT_NOTE, FOOTER_RETURN_NOTE,
} from './constants';
import type { ContractPdfInput } from './types';

// ── Style tokens ─────────────────────────────────────────────────────────────
const FS_HEADER = 8.5;
const FS_BODY = 9;
const FS_SMALL = 8;
const SIG_W = 210;
const SIG_H = 70;

function fullName(prefix: string, first: string, last: string): string {
  return `${prefix} ${first} ${last}`.replace(/\s+/g, ' ').trim();
}

// Combine serial + IMEI for the "หมายเลขเครื่อง/หมายเลข IMEI" blank.
// Serial first (the physical engraving on the device), IMEI second.
// Empty when neither is present — the underline still renders blank.
function deviceIdentifier(imei: string, serial: string): string {
  const parts: string[] = [];
  if (serial) parts.push(`หมายเลขเครื่อง ${serial}`);
  if (imei) parts.push(`หมายเลข IMEI ${imei}`);
  return parts.join(' / ');
}

function lessorFullName(input?: { lessorName?: string }): string {
  if (input?.lessorName && input.lessorName.trim()) return input.lessorName.trim();
  return fullName(LESSOR.prefix, LESSOR.firstName, LESSOR.lastName);
}

// Renders an inline "fill-in blank" — bordered underline with the value above
// it. pdfmake doesn't support TextDecoration cleanly for non-Latin, so we use
// stacked text + a thin rule that looks like a printed form field.
function blank(value: string, opts: { width?: number; bold?: boolean } = {}): Content {
  return {
    text: ` ${value} `,
    decoration: 'underline',
    bold: opts.bold,
  };
}

// Inline "สุขภาพแบตเตอรี่ {value}" fragment — when battery is blank, omit
// both the label and the blank so the surrounding sentence reads naturally
// instead of leaving a stray label with an empty underline.
function batteryFragment(value: string): InlineRun[] {
  if (!value || !value.trim()) return [];
  return [' สุขภาพแบตเตอรี่ ', blank(value) as InlineRun];
}

function headerStrip(input: ContractPdfInput, pageLabel: string): Content {
  const assetCode = input.assetSeq
    ? `รหัสทรัพย์สิน: ${input.assetCode} / ${input.assetSeq}`
    : `รหัสทรัพย์สิน: ${input.assetCode}`;
  return {
    columns: [
      { text: assetCode, fontSize: FS_HEADER, bold: true },
      { text: `เลขที่สัญญา: ${input.contractCode}`, fontSize: FS_HEADER, alignment: 'center', bold: true },
      { text: pageLabel, fontSize: FS_HEADER, alignment: 'right' },
    ],
    margin: [0, 0, 0, 6],
  };
}

function paymentFooterLines(input: ContractPdfInput): Content {
  const bank = {
    bankName: input.bankName,
    accountNumber: input.bankAccountNumber,
    accountName: input.bankAccountName,
  };
  return {
    stack: [
      { text: FOOTER_PAYMENT_NOTE(bank), fontSize: FS_SMALL, alignment: 'center', bold: true, margin: [0, 8, 0, 2] },
      { text: FOOTER_RETURN_NOTE, fontSize: FS_SMALL, alignment: 'center', bold: true },
    ],
  };
}

// Signature cell — used inside an equal-width column grid so both parties'
// "ลงชื่อ ........." lines sit at the SAME vertical position on the page,
// whether or not a signature image is present.
//
// Layout (top → bottom):
//   1. Fixed-height reserved slot (SIG_H high). If a signature exists it's
//      drawn inside; otherwise the slot is empty space. Either way the next
//      element starts at the same y-offset.
//   2. "ลงชื่อ ........." line.
//   3. "(name)" line.
//
// We avoid negative margins because they desync left/right when only one
// side has an image.
function signatureCell(role: string, name: string, dataUrl: string | null): Column {
  // Reserve a fixed-height slot so the underline + role text line up between
  // left/right cells whether or not a signature exists.
  const sigSlot: Content = dataUrl
    ? { image: dataUrl, width: SIG_W, height: SIG_H, alignment: 'center' }
    : { canvas: [{ type: 'rect', x: 0, y: 0, w: 1, h: SIG_H, color: 'white', lineColor: 'white' }], alignment: 'center' };
  // Draw a thin horizontal rule across the cell width as the underline,
  // anchored just below the signature slot. SIG_LINE_W must match the
  // signatureRow layout width — using SIG_W keeps the line under any drawn
  // signature image.
  return {
    width: '*',
    stack: [
      sigSlot,
      {
        canvas: [{ type: 'line', x1: 0, y1: 0, x2: SIG_W, y2: 0, lineWidth: 0.5, lineColor: '#000' }],
        alignment: 'center',
        margin: [0, 0, 0, 1],
      },
      { text: `ลงชื่อ ${role}`, fontSize: FS_SMALL, alignment: 'center' },
      { text: `(${name})`, fontSize: FS_SMALL, alignment: 'center' },
    ],
  };
}

function signatureRow(left: Column, right: Column): Content {
  return {
    stack: [{ columns: [left, right], columnGap: 24 }],
    unbreakable: true,
    margin: [0, 8, 0, 0],
  };
}

// ── Page 1 — clauses ─────────────────────────────────────────────────────────
function buildPage1(input: ContractPdfInput): Content[] {
  const lessee = fullName(input.lesseePrefix, input.lesseeFirstName, input.lesseeLastName);
  return [
    headerStrip(input, 'หน้า 1 / 3'),
    { text: 'หนังสือสัญญาเช่า', fontSize: 15, bold: true, alignment: 'center', margin: [0, 0, 0, 4] },
    {
      columns: [
        { text: [{ text: 'วันที่ทำสัญญา: ', bold: true }, input.contractDateBE], fontSize: FS_SMALL },
        { text: [{ text: 'ทำที่: ', bold: true }, input.branchName], fontSize: FS_SMALL, alignment: 'right' },
      ],
      margin: [0, 0, 0, 4],
    },
    {
      text: [
        'ระหว่าง ข้าพเจ้า ',
        blank(lessorFullName(input), { bold: true }),
        ' บัตรประชาชนเลขที่ ',
        blank(LESSOR.idNumber),
        ' ที่อยู่ตามบัตรประชาชน ',
        blank(LESSOR.address),
        ' ซึ่งต่อไปในสัญญานี้เรียกว่า "ผู้ให้เช่า" ฝ่ายหนึ่ง กับ ข้าพเจ้า ',
        blank(lessee, { bold: true }),
        ' อยู่บ้านเลขที่ ',
        blank(input.lesseeAddress),
        ' ถือบัตรประชาชนเลขที่ ',
        blank(input.lesseeIdNumber),
        ' ซึ่งในสัญญานี้เรียกว่า "ผู้เช่า" อีกฝ่ายหนึ่ง ทั้งสองฝ่ายตกลงทำสัญญากันดังมีข้อความต่อไปนี้',
      ],
      fontSize: FS_BODY,
      margin: [0, 0, 0, 4],
    },
    {
      text: [
        { text: 'ข้อ 1. ', bold: true },
        '"ผู้เช่า" ตกลงเช่าและ "ผู้ให้เช่า" ตกลงให้เช่า ',
        blank(input.deviceCategory),
        ' ยี่ห้อ ',
        blank(input.deviceBrand),
        ' รุ่น ',
        blank(input.deviceModel),
        ' สี ',
        blank(input.deviceColor),
        ' ความจุตัวเครื่อง ',
        blank(input.deviceStorage),
        ' ',
        blank(deviceIdentifier(input.deviceImei, input.deviceSerial)),
        ...batteryFragment(input.deviceBattery),
        ' ของ "ผู้ให้เช่า" ให้กับ "ผู้เช่า" โดย "ผู้เช่า" ได้ชำระเงินค่าเปิดใช้เครื่อง ค่าดำเนินการระบบติดตามระยะไกล และค่าความเสื่อมสภาพขณะใช้งานทรัพย์สิน ให้แก่ "ผู้ให้เช่า" ในวันทำสัญญานี้เป็นเงิน ',
        blank(`${fmtCurrency(input.upfrontAmount)} บาท`, { bold: true }),
      ],
      fontSize: FS_BODY,
      margin: [0, 0, 0, 3],
    },
    {
      text: [
        { text: 'ข้อ 2. ', bold: true },
        'ผู้เช่าตกลงชำระค่าเช่าและค่าบริการดูแลรายเดือน โดยชำระเดือนละ ',
        blank(`${fmtCurrency(input.monthlyAmount)} บาท`, { bold: true }),
        ' เป็นจำนวน ',
        blank(`${input.termMonths}`, { bold: true }),
        ' เดือน ภายในวันที่ ',
        blank(`${input.dueDayOfMonth}`, { bold: true }),
        ' ของทุกๆ เดือน',
      ],
      fontSize: FS_BODY,
      margin: [0, 0, 0, 3],
    },
    {
      text: [{ text: 'ข้อ 2.1 ', bold: true }, CLAUSE_2_1_BODY],
      fontSize: FS_BODY,
      margin: [0, 0, 0, 3],
    },
    { text: CLAUSE_2_1_FOOTNOTE, fontSize: FS_SMALL, bold: true, margin: [0, 0, 0, 3] },
    { text: [{ text: 'ข้อ 3. ', bold: true }, CLAUSE_3], fontSize: FS_BODY, margin: [0, 0, 0, 3] },
    { text: [{ text: 'ข้อ 4. ', bold: true }, CLAUSE_4], fontSize: FS_BODY, margin: [0, 0, 0, 3] },
    (() => {
      const lateFee = input.lateFeePerDay ?? CLAUSE_5_LATE_FEE_BAHT;
      const grace = input.gracePeriodDays;
      const maxDays = input.lateFeeMaxDays;
      const graceSuffix = grace != null && grace > 0
        ? ` โดยจะเริ่มคิดค่าธรรมเนียมหลังพ้น ${grace} วันนับจากวันครบกำหนดชำระ`
        : '';
      const maxSuffix = maxDays != null && maxDays > 0
        ? ` (สูงสุดไม่เกิน ${maxDays} วัน)`
        : '';
      return [
        { text: [{ text: 'ข้อ 5. ', bold: true }, CLAUSE_5_INTRO + graceSuffix], fontSize: FS_BODY, margin: [0, 0, 0, 1] as [number, number, number, number] },
        {
          ul: [
            `ไม่เกิน ${lateFee} บาท ต่อวันหรือต่อรอบการทวงถาม กรณีค้างชำระหนึ่งเดือน${maxSuffix}`,
            `ไม่เกิน ${lateFee} บาท ต่อวันหรือต่อรอบการทวงถาม กรณีค้างชำระมากกว่าหนึ่งเดือน${maxSuffix}`,
          ],
          fontSize: FS_BODY,
          margin: [12, 0, 0, 3] as [number, number, number, number],
        },
      ];
    })(),
    { text: [{ text: 'ข้อ 6. ', bold: true }, buildClause6(input.repoThresholdDays)], fontSize: FS_BODY, margin: [0, 0, 0, 3] },
    { text: [{ text: 'ข้อ 7. ', bold: true }, CLAUSE_7], fontSize: FS_BODY, margin: [0, 0, 0, 3] },
    { text: [{ text: 'ข้อ 8. ', bold: true }, CLAUSE_8], fontSize: FS_BODY, margin: [0, 0, 0, 4] },
    { text: 'คู่สัญญาได้อ่านและเข้าใจข้อความดีแล้ว จึงได้ลงลายมือชื่อไว้เป็นสำคัญต่อหน้าพยาน', fontSize: FS_BODY, alignment: 'center', margin: [0, 2, 0, 0] },
    signatureRow(
      signatureCell('ผู้เช่า', lessee, input.lesseeSignatureDataUrl),
      signatureCell('ผู้ให้เช่า', lessorFullName(input), input.lessorSignatureDataUrl),
    ),
    paymentFooterLines(input),
  ];
}

// ── Page 2 — schedule, contacts, signatures ─────────────────────────────────
function buildPage2(input: ContractPdfInput): Content[] {
  const lesseeFull = fullName(input.lesseePrefix, input.lesseeFirstName, input.lesseeLastName);
  const witness1 = input.witness1Name.trim();
  const witness2 = input.witness2Name.trim();

  // Reference list — omit ref2 row entirely when blank.
  const hasRef2 = !!(input.ref2Name?.trim() || input.ref2Tel?.trim() || input.ref2Relation?.trim());
  const refBlocks: Content[] = [
    {
      text: [
        `ญาติผู้เช่า${hasRef2 ? ' 1' : ''} ชื่อ `, blank(input.ref1Name || ' '),
        ' เบอร์ติดต่อ ', blank(input.ref1Tel || ' '),
        ' ความเกี่ยวข้องเป็น ', blank(input.ref1Relation || ' '),
      ],
      fontSize: FS_BODY, margin: [0, 0, 0, hasRef2 ? 2 : 6],
    },
    ...(hasRef2 ? [{
      text: [
        `ญาติผู้เช่า 2 ชื่อ `, blank(input.ref2Name || ' '),
        ' เบอร์ติดต่อ ', blank(input.ref2Tel || ' '),
        ' ความเกี่ยวข้องเป็น ', blank(input.ref2Relation || ' '),
      ],
      fontSize: FS_BODY, margin: [0, 0, 0, 6] as [number, number, number, number],
    } as Content] : []),
  ];

  // Two-column schedule layout to mirror the original — left col rows 1-6, right rows 7-12
  const half = Math.ceil(input.installments.length / 2);
  const leftRows = input.installments.slice(0, half);
  const rightRows = input.installments.slice(half);
  while (leftRows.length < rightRows.length) leftRows.push({ payNo: 0, amount: 0, dueDateBE: '' });
  while (rightRows.length < leftRows.length) rightRows.push({ payNo: 0, amount: 0, dueDateBE: '' });

  const scheduleColumn = (rows: typeof leftRows): Column => ({
    width: '*',
    table: {
      widths: [32, '*', '*'],
      headerRows: 1,
      body: [
        [
          { text: 'งวดที่', fontSize: FS_SMALL, bold: true, alignment: 'center', margin: [0, 2, 0, 2] },
          { text: 'จำนวนเงิน (บาท)', fontSize: FS_SMALL, bold: true, alignment: 'right', margin: [0, 2, 4, 2] },
          { text: 'วันที่ชำระ', fontSize: FS_SMALL, bold: true, alignment: 'center', margin: [0, 2, 0, 2] },
        ],
        ...rows.map((row): Content[] => [
          { text: row.payNo ? String(row.payNo) : '', fontSize: FS_SMALL, alignment: 'center', margin: [0, 1.5, 0, 1.5] },
          { text: row.amount ? fmtCurrency(row.amount) : '', fontSize: FS_SMALL, alignment: 'right', margin: [0, 1.5, 4, 1.5] },
          { text: row.dueDateBE, fontSize: FS_SMALL, alignment: 'center', margin: [0, 1.5, 0, 1.5] },
        ]),
      ],
    },
    layout: {
      hLineWidth: () => 0.5,
      vLineWidth: () => 0.5,
      hLineColor: () => '#000',
      vLineColor: () => '#000',
      paddingLeft: () => 4,
      paddingRight: () => 4,
      paddingTop: () => 0,
      paddingBottom: () => 0,
    },
  });

  return [
    { text: '', pageBreak: 'before' },
    headerStrip(input, 'หน้า 2 / 3'),
    { text: 'รายการทรัพย์สินที่เช่า', fontSize: 13, bold: true, alignment: 'center', margin: [0, 0, 0, 4] },
    {
      text: [
        'ทรัพย์สินประเภท ', blank(input.deviceCategory),
        ' ยี่ห้อ ', blank(input.deviceBrand),
        ' รุ่น ', blank(input.deviceModel),
        ' สี ', blank(input.deviceColor),
        ' ความจุตัวเครื่อง ', blank(input.deviceStorage),
        ...batteryFragment(input.deviceBattery),
      ],
      fontSize: FS_BODY,
      margin: [0, 0, 0, 2],
    },
    {
      text: [
        blank(deviceIdentifier(input.deviceImei, input.deviceSerial)),
        ' กล่องตัวเครื่อง ', blank(input.deviceBoxNote),
        ' ชุดชาร์จ ', blank(input.deviceChargerBlockNote),
        ' สายชาร์จ ', blank(input.deviceChargerCableNote),
      ],
      fontSize: FS_BODY,
      margin: [0, 0, 0, 6],
    },

    { text: 'ข้อมูลและเบอร์ติดต่อของ "ผู้เช่า"', fontSize: 11, bold: true, margin: [0, 0, 0, 2] },
    {
      text: ['ข้าพเจ้า ', blank(lesseeFull), ' เบอร์ติดต่อ ', blank(input.lesseeTel)],
      fontSize: FS_BODY, margin: [0, 0, 0, 2],
    },
    ...refBlocks,

    { text: 'ตารางการชำระค่าเช่าและค่าบริการดูแลรายเดือนของทุกๆ เดือน', fontSize: 11, bold: true, alignment: 'center', margin: [0, 0, 0, 4] },
    {
      text: [
        'โดย "ผู้เช่า" ได้ชำระเงินค่าเปิดใช้เครื่อง, ค่าดำเนินการระบบติดตามระยะไกล, และค่าความเสื่อมสภาพขณะใช้งานทรัพย์สินให้แก่ "ผู้ให้เช่า" ในวันทำสัญญานี้เป็นเงิน ',
        blank(`${fmtCurrency(input.upfrontAmount)} บาท`, { bold: true }),
      ],
      fontSize: FS_BODY, margin: [0, 0, 0, 2],
    },
    {
      text: [
        'ส่วนค่าเช่าและค่าบริการดูแลรายเดือน ตกลงที่เดือนละ ',
        blank(`${fmtCurrency(input.monthlyAmount)} บาท`, { bold: true }),
        ' เป็นจำนวน ',
        blank(`${input.termMonths}`, { bold: true }),
        ' เดือน ในวันที่ ',
        blank(`${input.dueDayOfMonth}`, { bold: true }),
        ' ของทุกเดือน',
      ],
      fontSize: FS_BODY, margin: [0, 0, 0, 6],
    },

    {
      columns: [scheduleColumn(leftRows), { text: '', width: 12 }, scheduleColumn(rightRows)],
      margin: [0, 0, 0, 8],
    },

    { text: 'คู่สัญญาได้อ่านและเข้าใจข้อความดีแล้ว จึงได้ลงลายมือชื่อไว้เป็นสำคัญต่อหน้าพยาน', fontSize: FS_BODY, alignment: 'center', margin: [0, 0, 0, 0] },
    signatureRow(
      signatureCell('ผู้เช่า', lesseeFull, input.lesseeSignatureDataUrl),
      signatureCell('ผู้ให้เช่า', lessorFullName(input), input.lessorSignatureDataUrl),
    ),
    signatureRow(
      signatureCell('พยาน', witness1, input.witness1SignatureDataUrl),
      signatureCell('พยาน', witness2, input.witness2SignatureDataUrl),
    ),
    paymentFooterLines(input),
  ];
}

// ── Page 3 — สำเนาถูกต้อง ──────────────────────────────────────────────────
function buildPage3(input: ContractPdfInput): Content[] {
  const lesseeFull = fullName(input.lesseePrefix, input.lesseeFirstName, input.lesseeLastName);
  const idCardBlock: Content = input.lesseeIdCardDataUrl
    ? { image: input.lesseeIdCardDataUrl, width: 320, alignment: 'center', margin: [0, 8, 0, 12] }
    : { text: '', margin: [0, 0, 0, 0] };
  const centeredSigCell = signatureCell('', lesseeFull, input.lesseeSignatureDataUrl);
  (centeredSigCell as { width: number | string }).width = SIG_W;
  return [
    { text: '', pageBreak: 'before' },
    headerStrip(input, 'หน้า 3 / 3'),
    idCardBlock,
    { text: 'สำเนาถูกต้อง', fontSize: 14, bold: true, alignment: 'center', margin: [0, 4, 0, 8] },
    {
      columns: [
        { text: '', width: '*' },
        centeredSigCell,
        { text: '', width: '*' },
      ],
      margin: [0, 0, 0, 20],
    },
    {
      text: [
        'เอกสารใช้สำหรับเช่า ', blank(input.deviceCategory),
        ' ยี่ห้อ ', blank(input.deviceBrand),
        ' รุ่น ', blank(input.deviceModel),
        ' สี ', blank(input.deviceColor),
        ' ความจุตัวเครื่อง ', blank(input.deviceStorage),
      ],
      fontSize: FS_BODY, margin: [0, 0, 0, 4],
    },
    {
      text: [
        blank(deviceIdentifier(input.deviceImei, input.deviceSerial)),
        ...batteryFragment(input.deviceBattery),
      ],
      fontSize: FS_BODY, margin: [0, 0, 0, 4],
    },
    {
      text:
        'โดย "ผู้เช่า" ได้ชำระเงินค่าเปิดใช้เครื่อง, ค่าดำเนินการระบบติดตามระยะไกล, และค่าความเสื่อมสภาพขณะใช้งานทรัพย์สินให้แก่ "ผู้ให้เช่า" ในวันทำสัญญาเป็นเงิน ',
      fontSize: FS_BODY,
    },
    {
      text: [blank(`${fmtCurrency(input.upfrontAmount)} บาท`, { bold: true })],
      fontSize: FS_BODY, alignment: 'center', margin: [0, 0, 0, 4],
    },
    {
      text: ['วันที่ทำสัญญา ', blank(input.contractDateLongBE, { bold: true })],
      fontSize: FS_BODY, alignment: 'center', margin: [0, 0, 0, 8],
    },
    {
      text: [
        'ส่วนค่าเช่าและค่าบริการดูแลรายเดือน ตกลงที่เดือนละ ',
        blank(`${fmtCurrency(input.monthlyAmount)} บาท`, { bold: true }),
        ' เป็นจำนวน ',
        blank(`${input.termMonths}`, { bold: true }),
        ' เดือน ในวันที่ ',
        blank(`${input.dueDayOfMonth}`, { bold: true }),
        ' ของทุกเดือน',
      ],
      fontSize: FS_BODY, alignment: 'center', margin: [0, 0, 0, 16],
    },
    {
      text: `*** หากชำระค่าเช่าและค่าบริการดูแลรายเดือนทั้ง ${input.termMonths} เดือนแล้ว รวมถึงไม่มียอดค้างทวงถาม หรือค่าใช้จ่ายใดๆ (ถ้ามี) ครบถ้วนแล้ว ***`,
      fontSize: FS_SMALL, bold: true, alignment: 'center', margin: [0, 0, 0, 4],
    },
    {
      text: '*** รายการทรัพย์สินดังกล่าวนี้จึงจะถือว่าเป็นกรรมสิทธิ์ของผู้เช่า ***',
      fontSize: FS_SMALL, bold: true, alignment: 'center',
    },
  ];
}

export function buildContractDocDefinition(input: ContractPdfInput): TDocumentDefinitions {
  return {
    pageSize: 'A4',
    pageMargins: [36, 28, 36, 28],
    defaultStyle: { font: 'Sarabun', fontSize: FS_BODY, lineHeight: 1.15 },
    content: [
      ...buildPage1(input),
      ...buildPage2(input),
      ...buildPage3(input),
    ],
  };
}
