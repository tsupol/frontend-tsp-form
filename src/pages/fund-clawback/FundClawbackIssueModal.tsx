// Issue a commission clawback for one or more contracts.
//
// Several contracts can go on one document, but only if they were paid on the
// same payout — one clawback settles one payout, so a second payout means a
// second document. The page only ever hands this modal rows that share one, and
// the modal says which payout it is.
//
// The amount is the backend's. It comes straight off the queue rows, which use
// the same calculator the issue call runs, so there is nothing to add up here
// beyond showing the rows' own totals.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Button, TextArea } from 'tsp-form';
import { apiClient, ApiError } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import { ModalErrorBand } from '../../components/ModalErrorBand';
import { ActionDoneView } from '../contracts/ActionDoneView';
import { fmtCurrency, formatEntityCode } from '../../lib/format';
import { useFundClawbackInvalidate } from './useFundClawback';
import type { FundClawbackCandidate, FundClawbackCreateResult } from './fundClawbackTypes';

interface FundClawbackIssueModalProps {
  open: boolean;
  /** The rows to put on the document. All share one payout. */
  rows: FundClawbackCandidate[];
  onClose: () => void;
  onIssued?: (billId: number) => void;
}

export function FundClawbackIssueModal({
  open, rows, onClose, onIssued,
}: FundClawbackIssueModalProps) {
  const { t } = useTranslation();
  const invalidate = useFundClawbackInvalidate();

  const [view, setView] = useState<'form' | 'done'>('form');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<FundClawbackCreateResult | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  // The page clears its selection as this closes, so keep the last rows for the
  // duration of the close transition or the body empties mid-animation.
  const [shown, setShown] = useState<FundClawbackCandidate[]>(rows);
  useEffect(() => { if (rows.length > 0) setShown(rows); }, [rows]);

  useEffect(() => {
    if (!open) return;
    setView('form');
    setNote('');
    setSaving(false);
    setError(null);
    setResult(null);
    setConfirmClose(false);
  }, [open]);

  const total = shown.reduce((sum, r) => sum + r.claw_total, 0);
  const first = shown[0] ?? null;
  const liableIsShop = first?.liable_party_type === 'BRANCH';

  const forceClose = () => { setConfirmClose(false); onClose(); };
  const handleClose = () => {
    if (view === 'done') { forceClose(); return; }
    if (note.trim()) { setConfirmClose(true); return; }
    forceClose();
  };

  const handleSubmit = async () => {
    if (shown.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      const res = await apiClient.rpc<FundClawbackCreateResult>('fn_fund_clawback_create', {
        p_settlement_ids: shown.map(r => r.settlement_id),
        p_note: note.trim() || null,
      });
      setResult(res);
      setView('done');
      invalidate();
      onIssued?.(res.bill_id);
    } catch (err) {
      setError(err instanceof ApiError ? translateApiError(err, t) : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Modal
        open={open}
        onClose={handleClose}
        maxWidth="32rem"
        width="100%"
        ariaLabel={t('fundClawback.issueAction')}
      >
        <div className="modal-header">
          <h2 className="modal-title">{t('fundClawback.issueAction')}</h2>
          <button type="button" className="modal-close-btn" onClick={handleClose}>&times;</button>
        </div>

        {view === 'form' ? (
          <>
            <div className="modal-content min-w-0">
              <div className="px-3 py-2.5 rounded-md bg-surface border border-line">
                <div className="font-medium text-sm">{first?.branch_name ?? '—'}</div>
                <div className="text-xs text-subtle mt-0.5">
                  {t('fundClawback.againstPayout')}: {first?.payout_bill_code ?? '—'}
                </div>
              </div>

              {/* Who owes it back was decided when the contract went live, and it
               *  changes what lands on the document — worth saying plainly. */}
              <div className="mt-3 alert alert-info">
                <span>
                  {liableIsShop
                    ? t('fundClawback.liableShopHint')
                    : t('fundClawback.liableCompanyHint')}
                </span>
              </div>

              <div className="mt-3 rounded-md border border-line overflow-hidden">
                {shown.map(r => (
                  <div key={r.settlement_id} className="px-3 py-2 border-b border-line last:border-b-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">
                        {formatEntityCode(r.contract_code)}
                      </span>
                      <span className="flex-1" />
                      <span className="text-sm tabular-nums shrink-0">{fmtCurrency(r.claw_total)}</span>
                    </div>
                    <div className="text-xs text-subtle mt-0.5">
                      {t('fundClawback.paidCount', { count: r.paid_count })}
                      {r.tier_pct != null && <> · {t('fundClawback.tierPct', { pct: r.tier_pct })}</>}
                    </div>
                  </div>
                ))}
                <div className="px-3 py-2 bg-surface flex items-center">
                  <span className="text-sm text-subtle">{t('fundClawback.total')}</span>
                  <span className="flex-1" />
                  <span className="text-sm font-semibold tabular-nums">{fmtCurrency(total)}</span>
                </div>
              </div>

              <div className="form-grid mt-4">
                <div className="flex flex-col">
                  <label className="form-label">{t('fundClawback.note')}</label>
                  <TextArea value={note} onChange={e => setNote(e.target.value)} rows={2} />
                </div>
              </div>
            </div>

            <ModalErrorBand message={error} onDismiss={() => setError(null)} />

            <div className="modal-footer">
              <Button variant="ghost" onClick={handleClose} disabled={saving}>{t('common.cancel')}</Button>
              <Button color="primary" onClick={handleSubmit} disabled={saving || shown.length === 0}>
                {t('fundClawback.issueAction')}
              </Button>
            </div>
          </>
        ) : result && (
          <ActionDoneView
            headline={t('fundClawback.issuedHeadline')}
            contractCode={result.bill_code}
            detailRows={[
              ...(result.settles_bill_code
                ? [{ label: t('fundClawback.againstPayout'), value: result.settles_bill_code }]
                : []),
              {
                label: t('fundClawback.liableParty'),
                value: t(`fundClawback.party_${result.liable_party_type}`),
              },
              { label: t('fundClawback.lineCount'), value: String(result.line_count) },
              { label: t('fundClawback.total'), value: fmtCurrency(result.net_amount), emphasis: true },
            ]}
            extras={
              <div className="alert alert-info">
                <span>{t('fundClawback.nextCollect')}</span>
              </div>
            }
            onClose={forceClose}
          />
        )}
      </Modal>

      <Modal
        open={confirmClose}
        onClose={() => setConfirmClose(false)}
        maxWidth="24rem"
        width="100%"
        ariaLabel={t('common.unsavedChanges')}
      >
        <div className="modal-header"><h2 className="modal-title">{t('common.unsavedChanges')}</h2></div>
        <div className="modal-content"><p>{t('common.unsavedChangesMessage')}</p></div>
        <div className="modal-footer">
          <Button variant="ghost" onClick={() => setConfirmClose(false)}>{t('common.cancel')}</Button>
          <Button color="danger" onClick={forceClose}>{t('common.discard')}</Button>
        </div>
      </Modal>
    </>
  );
}
