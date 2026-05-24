// Fullscreen modal that renders a responsive web view of the contract for
// staff to show the customer before signing/printing. Same source data as the
// pdfmake PDF (buildContractRenderData) so the customer sees the same numbers
// and clauses they'll get in print — layout is responsive instead of A4.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Button } from 'tsp-form';
import { Loader2, X, AlertTriangle } from 'lucide-react';
import {
  buildContractRenderData,
  ContractRenderPrerequisiteError,
  type ContractMin,
  type ContractRenderOverrides,
} from '../../lib/contractPdf/buildRenderData';
import {
  LESSOR,
  CLAUSE_2_1_BODY,
  CLAUSE_2_1_FOOTNOTE,
  CLAUSE_3,
  CLAUSE_4,
  CLAUSE_5_INTRO,
  CLAUSE_5_LATE_FEE_BAHT,
  buildClause6,
  CLAUSE_7,
  CLAUSE_8,
  FOOTER_PAYMENT_NOTE,
  FOOTER_RETURN_NOTE,
} from '../../lib/contractPdf/constants';
import type { ContractPdfInput } from '../../lib/contractPdf/types';
import { fmtCurrency } from '../../lib/format';
import './contractPreview.css';

interface Props {
  open: boolean;
  onClose: () => void;
  contract: ContractMin | null;
  overrides: ContractRenderOverrides;
}

export function ContractPreviewModal({ open, onClose, contract, overrides }: Props) {
  const { t } = useTranslation();
  const [data, setData] = useState<ContractPdfInput | null>(null);
  const [loading, setLoading] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !contract) return;
    let cancelled = false;
    setLoading(true);
    setErrMsg(null);
    setData(null);
    buildContractRenderData(contract, { overrides })
      .then((d) => { if (!cancelled) setData(d); })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ContractRenderPrerequisiteError) {
          setErrMsg(prerequisiteMsg(err.reason, t));
        } else {
          setErrMsg(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, contract, overrides, t]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      width="100vw"
      height="100vh"
      maxWidth="100vw"
      maxHeight="100vh"
      ariaLabel={t('contract.previewModalTitle', { defaultValue: 'Contract preview' })}
    >
      <div className="modal-header">
        <h2 className="modal-title">
          {t('contract.previewModalTitle', { defaultValue: 'Contract preview' })}
          {data && (
            <span className="ml-2 text-sm font-normal text-subtle">
              {data.contractCode}
            </span>
          )}
        </h2>
        <button type="button" className="modal-close-btn" onClick={onClose} aria-label={t('common.close')}>
          <X size={20} />
        </button>
      </div>

      <div className="modal-content contract-preview-content">
        {loading && (
          <div className="flex items-center justify-center py-10 text-subtle">
            <Loader2 size={20} className="animate-spin mr-2" />
            <span>{t('common.loading')}</span>
          </div>
        )}
        {errMsg && !loading && (
          <div className="max-w-2xl mx-auto mt-8 alert alert-danger">
            <AlertTriangle size={16} />
            <span>{errMsg}</span>
          </div>
        )}
        {data && !loading && (
          <div className="contract-paper">
            <PreviewBanner t={t} />
            <PartiesSection input={data} />
            <ClausesSection input={data} />
            <AssetSection input={data} />
            <ContactsSection input={data} />
            <ScheduleSection input={data} />
            <SignaturesSection input={data} />
            <PaymentFooter input={data} />
            <TrueCopySection input={data} />
          </div>
        )}
      </div>

      <div className="modal-footer">
        <Button onClick={onClose}>{t('common.close')}</Button>
      </div>
    </Modal>
  );
}

function prerequisiteMsg(reason: string, t: (k: string, opts?: Record<string, unknown>) => string): string {
  switch (reason) {
    case 'no_bank_account':
      return t('contract.printBlock_noBankAccount', { defaultValue: 'Branch has no active bank account set.' });
    case 'no_lessor':
      return t('contract.printBlock_noLessorInBook', { defaultValue: 'Branch signatory book has no active lessor.' });
    case 'no_witnesses':
      return t('contract.printBlock_notEnoughWitnesses', { defaultValue: 'Branch signatory book needs at least 2 active witnesses.' });
    default:
      return reason;
  }
}

// ── Components ──────────────────────────────────────────────────────────────

function PreviewBanner({ t }: { t: (k: string, opts?: Record<string, unknown>) => string }) {
  return (
    <div className="preview-banner">
      {t('contract.previewBanner', { defaultValue: 'Preview — pending signature' })}
    </div>
  );
}

function fullName(prefix: string, first: string, last: string): string {
  return `${prefix} ${first} ${last}`.replace(/\s+/g, ' ').trim();
}

function deviceIdentifier(imei: string, serial: string): string {
  const parts: string[] = [];
  if (serial) parts.push(`หมายเลขเครื่อง ${serial}`);
  if (imei) parts.push(`หมายเลข IMEI ${imei}`);
  return parts.join(' / ');
}

// Underlined fill-in-the-blank inline span, matching the PDF look.
function Fill({ children, bold }: { children: React.ReactNode; bold?: boolean }) {
  return <span className={`fill ${bold ? 'fill-bold' : ''}`}>{children}</span>;
}

function PartiesSection({ input }: { input: ContractPdfInput }) {
  const lessee = fullName(input.lesseePrefix, input.lesseeFirstName, input.lesseeLastName);
  const lessorName = input.lessorName.trim() || fullName(LESSOR.prefix, LESSOR.firstName, LESSOR.lastName);
  return (
    <section className="cp-section">
      <h1 className="cp-title">หนังสือสัญญาเช่า</h1>
      <div className="cp-meta">
        <div><b>วันที่ทำสัญญา:</b> {input.contractDateBE}</div>
        <div><b>ทำที่:</b> {input.branchName}</div>
        <div><b>เลขที่สัญญา:</b> {input.contractCode}</div>
        <div><b>รหัสทรัพย์สิน:</b> {input.assetCode}</div>
      </div>
      <p className="cp-body">
        ระหว่าง ข้าพเจ้า <Fill bold>{lessorName}</Fill> บัตรประชาชนเลขที่ <Fill>{LESSOR.idNumber}</Fill>{' '}
        ที่อยู่ตามบัตรประชาชน <Fill>{LESSOR.address}</Fill> ซึ่งต่อไปในสัญญานี้เรียกว่า "ผู้ให้เช่า" ฝ่ายหนึ่ง กับ ข้าพเจ้า{' '}
        <Fill bold>{lessee}</Fill> อยู่บ้านเลขที่ <Fill>{input.lesseeAddress}</Fill>{' '}
        ถือบัตรประชาชนเลขที่ <Fill>{input.lesseeIdNumber}</Fill> ซึ่งในสัญญานี้เรียกว่า "ผู้เช่า" อีกฝ่ายหนึ่ง
        ทั้งสองฝ่ายตกลงทำสัญญากันดังมีข้อความต่อไปนี้
      </p>
    </section>
  );
}

function ClausesSection({ input }: { input: ContractPdfInput }) {
  const lateFee = input.lateFeePerDay ?? CLAUSE_5_LATE_FEE_BAHT;
  const grace = input.gracePeriodDays;
  const maxDays = input.lateFeeMaxDays;
  const graceSuffix = grace != null && grace > 0
    ? ` โดยจะเริ่มคิดค่าธรรมเนียมหลังพ้น ${grace} วันนับจากวันครบกำหนดชำระ`
    : '';
  const maxSuffix = maxDays != null && maxDays > 0 ? ` (สูงสุดไม่เกิน ${maxDays} วัน)` : '';

  return (
    <section className="cp-section">
      <p className="cp-clause">
        <b>ข้อ 1.</b> "ผู้เช่า" ตกลงเช่าและ "ผู้ให้เช่า" ตกลงให้เช่า <Fill>{input.deviceCategory}</Fill>{' '}
        ยี่ห้อ <Fill>{input.deviceBrand}</Fill> รุ่น <Fill>{input.deviceModel}</Fill>{' '}
        สี <Fill>{input.deviceColor}</Fill> ความจุตัวเครื่อง <Fill>{input.deviceStorage}</Fill>{' '}
        <Fill>{deviceIdentifier(input.deviceImei, input.deviceSerial)}</Fill>
        {input.deviceBattery && <> สุขภาพแบตเตอรี่ <Fill>{input.deviceBattery}</Fill></>}
        {' '}ของ "ผู้ให้เช่า" ให้กับ "ผู้เช่า" โดย "ผู้เช่า" ได้ชำระเงินค่าเปิดใช้เครื่อง ค่าดำเนินการระบบติดตามระยะไกล
        และค่าความเสื่อมสภาพขณะใช้งานทรัพย์สิน ให้แก่ "ผู้ให้เช่า" ในวันทำสัญญานี้เป็นเงิน{' '}
        <Fill bold>{fmtCurrency(input.upfrontAmount)} บาท</Fill>
      </p>

      <p className="cp-clause">
        <b>ข้อ 2.</b> ผู้เช่าตกลงชำระค่าเช่าและค่าบริการดูแลรายเดือน โดยชำระเดือนละ{' '}
        <Fill bold>{fmtCurrency(input.monthlyAmount)} บาท</Fill> เป็นจำนวน{' '}
        <Fill bold>{input.termMonths}</Fill> เดือน ภายในวันที่{' '}
        <Fill bold>{input.dueDayOfMonth}</Fill> ของทุกๆ เดือน
      </p>

      <p className="cp-clause"><b>ข้อ 2.1</b> {CLAUSE_2_1_BODY}</p>
      <p className="cp-small cp-bold">{CLAUSE_2_1_FOOTNOTE.replace(/^\*\*|\*\*$/g, '')}</p>

      <p className="cp-clause"><b>ข้อ 3.</b> {CLAUSE_3}</p>
      <p className="cp-clause"><b>ข้อ 4.</b> {CLAUSE_4}</p>

      <p className="cp-clause"><b>ข้อ 5.</b> {CLAUSE_5_INTRO + graceSuffix}</p>
      <ul className="cp-list">
        <li>ไม่เกิน {lateFee} บาท ต่อวันหรือต่อรอบการทวงถาม กรณีค้างชำระหนึ่งเดือน{maxSuffix}</li>
        <li>ไม่เกิน {lateFee} บาท ต่อวันหรือต่อรอบการทวงถาม กรณีค้างชำระมากกว่าหนึ่งเดือน{maxSuffix}</li>
      </ul>

      <p className="cp-clause"><b>ข้อ 6.</b> {buildClause6(input.repoThresholdDays)}</p>
      <p className="cp-clause"><b>ข้อ 7.</b> {CLAUSE_7}</p>
      <p className="cp-clause"><b>ข้อ 8.</b> {CLAUSE_8}</p>

      <p className="cp-center cp-mt">คู่สัญญาได้อ่านและเข้าใจข้อความดีแล้ว จึงได้ลงลายมือชื่อไว้เป็นสำคัญต่อหน้าพยาน</p>
    </section>
  );
}

function AssetSection({ input }: { input: ContractPdfInput }) {
  return (
    <section className="cp-section">
      <h2 className="cp-heading">รายการทรัพย์สินที่เช่า</h2>
      <p className="cp-body">
        ทรัพย์สินประเภท <Fill>{input.deviceCategory}</Fill>{' '}
        ยี่ห้อ <Fill>{input.deviceBrand}</Fill>{' '}
        รุ่น <Fill>{input.deviceModel}</Fill>{' '}
        สี <Fill>{input.deviceColor}</Fill>{' '}
        ความจุตัวเครื่อง <Fill>{input.deviceStorage}</Fill>
        {input.deviceBattery && <> สุขภาพแบตเตอรี่ <Fill>{input.deviceBattery}</Fill></>}
      </p>
      <p className="cp-body">
        <Fill>{deviceIdentifier(input.deviceImei, input.deviceSerial)}</Fill>{' '}
        กล่องตัวเครื่อง <Fill>{input.deviceBoxNote}</Fill>{' '}
        ชุดชาร์จ <Fill>{input.deviceChargerBlockNote}</Fill>{' '}
        สายชาร์จ <Fill>{input.deviceChargerCableNote}</Fill>
      </p>
    </section>
  );
}

function ContactsSection({ input }: { input: ContractPdfInput }) {
  const lesseeFull = fullName(input.lesseePrefix, input.lesseeFirstName, input.lesseeLastName);
  const hasRef2 = !!(input.ref2Name?.trim() || input.ref2Tel?.trim() || input.ref2Relation?.trim());
  return (
    <section className="cp-section">
      <h2 className="cp-heading">ข้อมูลและเบอร์ติดต่อของ "ผู้เช่า"</h2>
      <p className="cp-body">ข้าพเจ้า <Fill>{lesseeFull}</Fill> เบอร์ติดต่อ <Fill>{input.lesseeTel}</Fill></p>
      <p className="cp-body">
        ญาติผู้เช่า{hasRef2 ? ' 1' : ''} ชื่อ <Fill>{input.ref1Name || ' '}</Fill>{' '}
        เบอร์ติดต่อ <Fill>{input.ref1Tel || ' '}</Fill>{' '}
        ความเกี่ยวข้องเป็น <Fill>{input.ref1Relation || ' '}</Fill>
      </p>
      {hasRef2 && (
        <p className="cp-body">
          ญาติผู้เช่า 2 ชื่อ <Fill>{input.ref2Name || ' '}</Fill>{' '}
          เบอร์ติดต่อ <Fill>{input.ref2Tel || ' '}</Fill>{' '}
          ความเกี่ยวข้องเป็น <Fill>{input.ref2Relation || ' '}</Fill>
        </p>
      )}
    </section>
  );
}

function ScheduleSection({ input }: { input: ContractPdfInput }) {
  return (
    <section className="cp-section">
      <h2 className="cp-heading cp-center">ตารางการชำระค่าเช่าและค่าบริการดูแลรายเดือนของทุกๆ เดือน</h2>
      <p className="cp-body">
        โดย "ผู้เช่า" ได้ชำระเงินค่าเปิดใช้เครื่อง, ค่าดำเนินการระบบติดตามระยะไกล,
        และค่าความเสื่อมสภาพขณะใช้งานทรัพย์สินให้แก่ "ผู้ให้เช่า" ในวันทำสัญญานี้เป็นเงิน{' '}
        <Fill bold>{fmtCurrency(input.upfrontAmount)} บาท</Fill>
      </p>
      <p className="cp-body">
        ส่วนค่าเช่าและค่าบริการดูแลรายเดือน ตกลงที่เดือนละ{' '}
        <Fill bold>{fmtCurrency(input.monthlyAmount)} บาท</Fill> เป็นจำนวน{' '}
        <Fill bold>{input.termMonths}</Fill> เดือน ในวันที่{' '}
        <Fill bold>{input.dueDayOfMonth}</Fill> ของทุกเดือน
      </p>
      <table className="cp-schedule">
        <thead>
          <tr>
            <th>งวดที่</th>
            <th>จำนวนเงิน (บาท)</th>
            <th>วันที่ชำระ</th>
          </tr>
        </thead>
        <tbody>
          {input.installments.map((row) => (
            <tr key={row.payNo}>
              <td className="cp-center">{row.payNo}</td>
              <td className="cp-right">{fmtCurrency(row.amount)}</td>
              <td className="cp-center">{row.dueDateBE}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function SignatureCell({ role, name }: { role: string; name: string }) {
  return (
    <div className="cp-sig-cell">
      <div className="cp-sig-slot" />
      <div className="cp-sig-line" />
      <div className="cp-sig-role">ลงชื่อ {role}</div>
      <div className="cp-sig-name">({name})</div>
    </div>
  );
}

function SignaturesSection({ input }: { input: ContractPdfInput }) {
  const lesseeFull = fullName(input.lesseePrefix, input.lesseeFirstName, input.lesseeLastName);
  const lessorName = input.lessorName.trim() || fullName(LESSOR.prefix, LESSOR.firstName, LESSOR.lastName);
  return (
    <section className="cp-section">
      <p className="cp-center">คู่สัญญาได้อ่านและเข้าใจข้อความดีแล้ว จึงได้ลงลายมือชื่อไว้เป็นสำคัญต่อหน้าพยาน</p>
      <div className="cp-sig-row">
        <SignatureCell role="ผู้เช่า" name={lesseeFull} />
        <SignatureCell role="ผู้ให้เช่า" name={lessorName} />
      </div>
      <div className="cp-sig-row">
        <SignatureCell role="พยาน" name={input.witness1Name} />
        <SignatureCell role="พยาน" name={input.witness2Name} />
      </div>
    </section>
  );
}

function PaymentFooter({ input }: { input: ContractPdfInput }) {
  const bank = {
    bankName: input.bankName,
    accountNumber: input.bankAccountNumber,
    accountName: input.bankAccountName,
  };
  return (
    <section className="cp-section cp-footer-notes">
      <p className="cp-small cp-bold cp-center">{FOOTER_PAYMENT_NOTE(bank)}</p>
      <p className="cp-small cp-bold cp-center">{FOOTER_RETURN_NOTE}</p>
    </section>
  );
}

function TrueCopySection({ input }: { input: ContractPdfInput }) {
  const lesseeFull = fullName(input.lesseePrefix, input.lesseeFirstName, input.lesseeLastName);
  return (
    <section className="cp-section">
      <h2 className="cp-heading cp-center">สำเนาถูกต้อง</h2>
      <div className="cp-sig-row cp-sig-row-center">
        <SignatureCell role="" name={lesseeFull} />
      </div>
      <p className="cp-body">
        เอกสารใช้สำหรับเช่า <Fill>{input.deviceCategory}</Fill>{' '}
        ยี่ห้อ <Fill>{input.deviceBrand}</Fill>{' '}
        รุ่น <Fill>{input.deviceModel}</Fill>{' '}
        สี <Fill>{input.deviceColor}</Fill>{' '}
        ความจุตัวเครื่อง <Fill>{input.deviceStorage}</Fill>
      </p>
      <p className="cp-body">
        <Fill>{deviceIdentifier(input.deviceImei, input.deviceSerial)}</Fill>
        {input.deviceBattery && <> สุขภาพแบตเตอรี่ <Fill>{input.deviceBattery}</Fill></>}
      </p>
      <p className="cp-body">
        โดย "ผู้เช่า" ได้ชำระเงินค่าเปิดใช้เครื่อง, ค่าดำเนินการระบบติดตามระยะไกล,
        และค่าความเสื่อมสภาพขณะใช้งานทรัพย์สินให้แก่ "ผู้ให้เช่า" ในวันทำสัญญาเป็นเงิน{' '}
      </p>
      <p className="cp-center"><Fill bold>{fmtCurrency(input.upfrontAmount)} บาท</Fill></p>
      <p className="cp-center">วันที่ทำสัญญา <Fill bold>{input.contractDateLongBE}</Fill></p>
      <p className="cp-body cp-center">
        ส่วนค่าเช่าและค่าบริการดูแลรายเดือน ตกลงที่เดือนละ{' '}
        <Fill bold>{fmtCurrency(input.monthlyAmount)} บาท</Fill> เป็นจำนวน{' '}
        <Fill bold>{input.termMonths}</Fill> เดือน ในวันที่{' '}
        <Fill bold>{input.dueDayOfMonth}</Fill> ของทุกเดือน
      </p>
      <p className="cp-small cp-bold cp-center">
        *** หากชำระค่าเช่าและค่าบริการดูแลรายเดือนทั้ง {input.termMonths} เดือนแล้ว
        รวมถึงไม่มียอดค้างทวงถาม หรือค่าใช้จ่ายใดๆ (ถ้ามี) ครบถ้วนแล้ว ***
      </p>
      <p className="cp-small cp-bold cp-center">
        *** รายการทรัพย์สินดังกล่าวนี้จึงจะถือว่าเป็นกรรมสิทธิ์ของผู้เช่า ***
      </p>
    </section>
  );
}
