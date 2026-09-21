// One contract's money, gathered into a summary and a timeline.
//
// The money for a single contract lives across four or five documents, created
// weeks apart by different people. This panel answers "what has happened to the
// money on this contract?" without anyone opening each one in turn.
//
// The summary reads as three stages, because that is the order things happen in:
// what was expected, what was actually paid, and what came back afterwards. The
// timeline underneath is the same story with dates and names against it.
//
// ⛔ The customer's own instalments are not here. A 24-instalment contract would
// bury every other row; the contract page itself is where those belong.
//
// The panel takes its data by prop rather than fetching, so the same component
// serves a staff session and a shop session — the shop passes its own pair of
// views, which carry nothing of the fund company's.

import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Badge } from 'tsp-form';
import { ArrowDownLeft, ArrowUpRight, Circle, ExternalLink } from 'lucide-react';
import { DateTime } from '../../components/DateTime';
import { fmtCurrency } from '../../lib/format';
import type { PartnerContractMoney, PartnerContractMoneyEvent } from './contractMoneyTypes';

/** Colour per source, so the eye can follow one thread down the timeline. */
const SOURCE_COLOR: Record<string, string> = {
  SETTLEMENT: 'text-info-fg',
  FUND_BILL: 'text-primary-fg',
  MONEY: 'text-success-fg',
  RETURN: 'text-warning-fg',
};

interface ContractMoneyPanelProps {
  money: PartnerContractMoney | null;
  events: PartnerContractMoneyEvent[];
  loading?: boolean;
  /** False on a shop session: the fund company's own figures are not theirs. */
  showCompanySide?: boolean;
}

export function ContractMoneyPanel({
  money, events, loading, showCompanySide = true,
}: ContractMoneyPanelProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  if (loading && !money) {
    return (
      <div className="p-8 text-center text-subtler">
        {t('common.loading', { defaultValue: 'Loading…' })}
      </div>
    );
  }

  if (!money) {
    return (
      <div className="p-8 text-center text-subtler">{t('contractMoney.noMoneyYet')}</div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Three stages, in the order they happen. */}
      <div className="rounded-md border border-line overflow-hidden">
        <div className="px-3 py-2 bg-surface text-sm font-medium">
          {t('contractMoney.summary')}
        </div>

        <div className="px-3 py-2.5 border-t border-line grid gap-3 sm:grid-cols-3">
          <div>
            <div className="text-xs text-subtle">{t('contractMoney.expected')}</div>
            <div className="text-base font-semibold tabular-nums">
              {fmtCurrency(money.expected_net)}
            </div>
            <div className="text-xs text-subtler">
              {t('contractMoney.toBranch')} {fmtCurrency(money.expected_to_branch)} ·{' '}
              {t('contractMoney.fromBranch')} {fmtCurrency(money.expected_from_branch)}
            </div>
          </div>

          <div>
            <div className="text-xs text-subtle">{t('contractMoney.paidToBranch')}</div>
            <div className="text-base font-semibold tabular-nums">
              {fmtCurrency(money.paid_to_branch)}
            </div>
            {money.paid_date && (
              <div className="text-xs text-subtler">
                <DateTime value={money.paid_date} showTime={false} />
              </div>
            )}
          </div>

          <div>
            <div className="text-xs text-subtle">{t('contractMoney.netAfterReturns')}</div>
            <div className="text-base font-semibold tabular-nums">
              {fmtCurrency(money.net_after_returns)}
            </div>
            {(money.returned_net ?? 0) !== 0 && (
              <div className="text-xs text-warning-fg">
                {t('contractMoney.returned')}: {fmtCurrency(money.returned_net)}
              </div>
            )}
          </div>
        </div>

        {/* The fund company's own cut sits on the same payout but is not the
         *  shop's money, so it is its own line and hidden from a shop. */}
        {showCompanySide && (money.company_commission ?? 0) !== 0 && (
          <div className="px-3 py-2 border-t border-line flex items-center gap-2 text-sm">
            <span className="text-subtle">{t('contractMoney.companyCommission')}</span>
            <span className="flex-1" />
            <span className="tabular-nums">{fmtCurrency(money.company_commission)}</span>
            {money.company_commission_paid && (
              <Badge color="success" size="sm">{t('contractMoney.recorded')}</Badge>
            )}
          </div>
        )}

        {/* The documents behind those figures, each a link. */}
        <div className="px-3 py-2.5 border-t border-line flex flex-col gap-1.5">
          {money.settlement_code && (
            <DocLine
              label={t('contractMoney.settlement')}
              code={money.settlement_code}
              status={money.settlement_status}
              onOpen={() => navigate('/admin/partner-settlements')}
            />
          )}
          {money.payout_bill_code && money.payout_bill_id && (
            <DocLine
              label={t('contractMoney.payout')}
              code={money.payout_bill_code}
              status={money.payout_status}
              onOpen={() => navigate(`/admin/fund-bills/${money.payout_bill_id}`)}
            />
          )}
          {money.return_code && (
            <DocLine
              label={t('contractMoney.return')}
              code={money.return_code}
              status={money.return_status}
              onOpen={() => navigate('/admin/partner-returns')}
            />
          )}
          {money.buyback_bill_id && (
            <DocLine
              label={t('contractMoney.buyback')}
              code={`#${money.buyback_bill_id}`}
              status={null}
              onOpen={() => navigate(`/admin/fund-bills/${money.buyback_bill_id}`)}
            />
          )}
          {money.clawback_bill_code && money.clawback_bill_id && (
            <DocLine
              label={t('contractMoney.clawback')}
              code={money.clawback_bill_code}
              status={money.clawback_status}
              onOpen={() => navigate(`/admin/fund-bills/${money.clawback_bill_id}`)}
            />
          )}
        </div>

        {/* Not a document yet, but the date someone has to look at. */}
        {money.clawback_check_due_date && !money.clawback_bill_id && (
          <div className="px-3 py-2 border-t border-line text-xs text-subtle">
            {t('contractMoney.clawbackCheckDue')}:{' '}
            <DateTime value={money.clawback_check_due_date} showTime={false} />
            {money.clawback_by_branch != null && (
              <> · {money.clawback_by_branch
                ? t('contractMoney.liableShop')
                : t('contractMoney.liableCompany')}</>
            )}
          </div>
        )}
      </div>

      {/* The same story with dates and names. */}
      <div className="rounded-md border border-line overflow-hidden">
        <div className="px-3 py-2 bg-surface text-sm font-medium">
          {t('contractMoney.timeline')}
        </div>

        {events.length === 0 ? (
          <div className="px-3 py-6 text-center text-subtler text-sm">
            {t('contractMoney.noEvents')}
          </div>
        ) : (
          <ol className="list-none p-0 m-0">
            {events.map((e, i) => (
              <li
                key={`${e.source}-${e.ref_id}-${e.event}-${i}`}
                className="px-3 py-2 border-t border-line flex items-start gap-2"
              >
                <span className={`pt-1 shrink-0 ${SOURCE_COLOR[e.source] ?? 'text-subtle'}`}>
                  {e.amount == null
                    ? <Circle size={10} />
                    : e.event === 'IN'
                      ? <ArrowDownLeft size={12} />
                      : <ArrowUpRight size={12} />}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium">
                      {t(`contractMoney.event_${e.event}`, { defaultValue: e.event })}
                    </span>
                    {e.doc_code && (
                      <span className="text-xs text-subtle">{e.doc_code}</span>
                    )}
                    <span className="flex-1" />
                    {e.amount != null && (
                      <span
                        className={`text-sm tabular-nums shrink-0 ${
                          e.event === 'IN' ? 'text-success-fg' : 'text-danger-fg'
                        }`}
                      >
                        {e.event === 'IN' ? '+' : '−'}{fmtCurrency(e.amount)}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-subtle mt-0.5">
                    {t(`contractMoney.source_${e.source}`, { defaultValue: e.source })}
                    {e.actor_name && <> · {e.actor_name}</>}
                    {' · '}<DateTime value={e.at} showTime />
                  </div>
                  {e.note && <div className="text-xs text-subtler mt-0.5">{e.note}</div>}
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

function DocLine({ label, code, status, onOpen }: {
  label: string;
  code: string;
  status: string | null;
  onOpen: () => void;
}) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-subtle w-28 shrink-0">{label}</span>
      <button
        type="button"
        onClick={onOpen}
        className="text-primary-fg hover:underline inline-flex items-center gap-1 bg-transparent border-none p-0 cursor-pointer truncate"
      >
        {code}
        <ExternalLink size={12} />
      </button>
      {status && <Badge color="default" size="sm">{status}</Badge>}
    </div>
  );
}
