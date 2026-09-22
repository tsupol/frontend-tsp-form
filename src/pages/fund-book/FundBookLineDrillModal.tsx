// The third level of the money book: what is inside one document.
//
// The book answers "how much", the statement answers "from which document", and
// this answers "why that document came to that". It exists because the first two
// levels cannot explain the one thing people keep asking about — a book total
// that does not match the bank.
//
// The rows are grouped by whose money each one is, because that grouping IS the
// explanation: the fund's own rows are what moved through a bank account, the
// company's rows were withheld from that same transfer. Two groups, one payment.
//
// ⛔ Every figure here is the signed amount the backend sends. The plain amount
// is an absolute value, so adding those up gives a total that is wrong in a way
// that looks plausible — deductions counted as receipts.
//
// ⛔ A row's direction on the document and its direction in the book can disagree,
// and that is correct rather than a fault: the document looks at the money from
// the shop's end, the book from the end of whoever owns it. The contract fee is
// taken FROM the shop and is income TO the company. Nothing here tries to
// reconcile the two, and nothing should.

import { useTranslation } from 'react-i18next';
import { Badge, Button, Modal } from 'tsp-form';
import { useNavigate } from 'react-router-dom';
import { Building2, ExternalLink, Wallet } from 'lucide-react';
import { DateTime } from '../../components/DateTime';
import { fmtCurrency, formatEntityCode } from '../../lib/format';
import { useFundBill, useFundBillLines } from '../fund-bills/useFundBills';
import { fundBillStatusColor, type FundBillLine } from '../fund-bills/fundBillTypes';

/** A line's contribution, from the document's end. Memo rows carry no money. */
function signedAmount(line: FundBillLine): number {
  if (line.direction === 'MEMO') return 0;
  return line.direction === 'TO_PARTY' ? line.amount : -line.amount;
}

/** One owner's rows and what they come to. */
interface OwnerGroup {
  owner: string;
  lines: FundBillLine[];
  net: number;
}

interface FundBookLineDrillModalProps {
  open: boolean;
  /** Null while the modal animates shut — the body keeps the last document. */
  billId: number | null;
  onClose: () => void;
}

export function FundBookLineDrillModal({ open, billId, onClose }: FundBookLineDrillModalProps) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();

  const { bill } = useFundBill(billId);
  const lines = useFundBillLines(billId);

  /**
   * The rows in owner order, the fund's first.
   *
   * Insertion order would follow whatever the backend happened to write first,
   * which puts the explanation in a different place on different documents.
   */
  const groups: OwnerGroup[] = [];
  for (const line of lines.rows) {
    let group = groups.find(g => g.owner === line.owner_type);
    if (!group) {
      group = { owner: line.owner_type, lines: [], net: 0 };
      groups.push(group);
    }
    group.lines.push(line);
    group.net += signedAmount(line);
  }
  groups.sort((a, b) => (a.owner === 'HOLDING' ? -1 : b.owner === 'HOLDING' ? 1 : 0));

  const documentNet = groups.reduce((sum, g) => sum + g.net, 0);

  return (
    <Modal open={open} onClose={onClose} maxWidth="38rem" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">{t('fundBook.drillTitle')}</h2>
        <button type="button" className="modal-close-btn" onClick={onClose}>&times;</button>
      </div>

      <div className="modal-content min-w-0">
        <div className="flex flex-col gap-3">
          {/* Which document this is. The code is the link out, so there is no
           *  separate button for "open it properly". */}
          {/* Said before any figure is read, because the first one is often the
           *  surprise: a top-up is money the fund receives, yet the document
           *  writes it as coming FROM the holding, so it reads negative here
           *  while the book above reads positive. Both are right — they look at
           *  the same money from opposite ends — and a reader who meets the two
           *  signs with no warning concludes the screen is broken. */}
          <div className="alert alert-info">
            <span>{t('fundBook.drillViewpoint')}</span>
          </div>

          <div className="px-3 py-2.5 rounded-md bg-surface border border-line">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-sm">{bill?.bill_code ?? '—'}</span>
              {bill && (
                <Badge color={fundBillStatusColor(bill.status)} size="sm">
                  {(i18n.language === 'th' && bill.status_name)
                    ? bill.status_name
                    : t(`fundBill.status_${bill.status}`, { defaultValue: bill.status })}
                </Badge>
              )}
              <span className="flex-1" />
              {bill && (
                <span className="text-xs text-subtle">
                  <DateTime value={bill.bill_date} showTime={false} />
                </span>
              )}
            </div>
            {bill?.branch_name && (
              <div className="text-xs text-subtle mt-0.5">{bill.branch_name}</div>
            )}
          </div>

          {lines.rows.length === 0 ? (
            <div className="p-6 text-center text-subtler text-sm">
              {t('fundBill.noLinesYet')}
            </div>
          ) : (
            groups.map(group => (
              <div key={group.owner} className="rounded-md border border-line overflow-hidden">
                <div className="px-3 py-2 bg-surface flex items-center gap-2">
                  {group.owner === 'COMPANY'
                    ? <Building2 size={14} className="text-subtle shrink-0" />
                    : <Wallet size={14} className="text-subtle shrink-0" />}
                  <span className="text-sm font-medium truncate">
                    {t(`fundBill.ownerShare_${group.owner}`, { defaultValue: group.owner })}
                  </span>
                  <span className="flex-1" />
                  <span className="text-sm font-semibold tabular-nums shrink-0">
                    {group.net > 0 ? '+' : ''}{fmtCurrency(group.net)}
                  </span>
                </div>

                {group.lines.map(line => (
                  <div key={line.line_id} className="px-3 py-2 border-t border-line-subtle">
                    <div className="flex items-center gap-2">
                      <span className="text-sm truncate flex-1 min-w-0">
                        {(i18n.language === 'th' && line.line_type_name)
                          ? line.line_type_name
                          : t(`fundBill.lineType_${line.line_type}`, { defaultValue: line.line_type })}
                      </span>
                      {line.is_manual && (
                        <Badge color="warning" size="sm">{t('fundBill.manualLine')}</Badge>
                      )}
                      <span
                        className={`text-sm tabular-nums shrink-0 ${
                          signedAmount(line) < 0 ? 'text-danger-fg' : ''
                        }`}
                      >
                        {signedAmount(line) > 0 ? '+' : ''}{fmtCurrency(signedAmount(line))}
                      </span>
                    </div>
                    {line.contract_code && (
                      <div className="text-xs text-subtle mt-0.5">
                        {formatEntityCode(line.contract_code)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ))
          )}

          {/* The point of the whole modal: the groups above add up to one
           *  transfer, and the company's share never left on its own. */}
          {lines.rows.length > 0 && (
            <div className="rounded-md border border-line overflow-hidden">
              <div className="px-3 py-2 bg-surface flex items-center gap-2">
                <span className="text-sm font-medium">{t('fundBill.documentTotal')}</span>
                <span className="flex-1" />
                <span className="text-sm font-semibold tabular-nums">{fmtCurrency(documentNet)}</span>
              </div>
              {groups.length > 1 && (
                <div className="px-3 py-2 border-t border-line-subtle text-xs text-subtle">
                  {t('fundBill.ownerShareHint')}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="modal-footer">
        <Button variant="ghost" onClick={onClose}>{t('common.close', { defaultValue: 'Close' })}</Button>
        {/* Close first, then navigate. Navigating straight from here unmounts
         *  the dialog while it is still on the modal stack, so it never
         *  deregisters: the backdrop is left behind at full opacity, swallowing
         *  every click on the page underneath. */}
        {billId != null && (
          <Button
            variant="outline"
            endIcon={<ExternalLink size={14} />}
            onClick={() => {
              const target = `/admin/fund-bills/${billId}`;
              onClose();
              navigate(target);
            }}
          >
            {t('fundBook.openDocument')}
          </Button>
        )}
      </div>
    </Modal>
  );
}
