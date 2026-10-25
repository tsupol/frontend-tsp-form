// Reviewer's "approve this request" dialog.
//
// There is no PIN on this flow, so the guard against a mis-click is a typed
// confirmation: the dialog shows four digits and the reviewer types them back.
// The digits are generated once per opening (never from Math.random inside
// render, which would change on every keystroke).
//
// Approve with adjustments (migs 1472-1475): when credit disagrees with the
// shop's figures it calls the shop, agrees new ones, and changes them here
// instead of sending the request back. Four inputs can change — the used
// device's price, the uplift, the down payment, the term — and nothing else:
// the monthly payment and the money due at signing are the system's to work
// out. The preview comes from fn_contract_set_fin1_plan's dry run (the same
// gate approve itself calls), so the controls' bounds and every figure shown
// are the backend's. Changing anything makes the note mandatory, and the shop
// then has to acknowledge before it can bill or sign.

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Modal, Button, TextArea, Input, MaskedInput, Select, LabeledCheckbox, Badge } from 'tsp-form';
import { Info, AlertTriangle, Loader2 } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import { ModalErrorBand } from '../../components/ModalErrorBand';
import { ActionDoneView } from '../contracts/ActionDoneView';
import { DateTime } from '../../components/DateTime';
import { fmtCurrency } from '../../lib/format';
import type { Fin1PlanResponse } from '../contracts/workspace/Fin1PlanEditor';
import { usePartnerCaseInvalidate, useAssetEvidence } from './usePartnerCases';
import { adjustLabel, adjustValue, adjustmentRows } from './adjustFormat';
import { PlanCompareTable } from './PlanCompareTable';
import type {
  PartnerCaseAdjustKey,
  PartnerCaseApproveResult,
  PartnerCaseDetail,
} from './partnerCaseTypes';

interface PartnerCaseApproveModalProps {
  open: boolean;
  detail: PartnerCaseDetail | null;
  onClose: () => void;
  /** Called after a successful approval so the queue page can move on. */
  onApproved?: () => void;
}

const randomFourDigits = () => String(Math.floor(1000 + Math.random() * 9000));

/** Uplift steps the plan gate accepts (see Fin1PlanEditor's UPLIFT_STEP). */
const UPLIFT_STEP = 500;

const num = (s: string) => (s === '' ? null : Number(s));

export function PartnerCaseApproveModal({ open, detail, onClose, onApproved }: PartnerCaseApproveModalProps) {
  const { t } = useTranslation();
  const invalidate = usePartnerCaseInvalidate();

  const [view, setView] = useState<'form' | 'done'>('form');
  const [challenge, setChallenge] = useState('');
  const [typed, setTyped] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PartnerCaseApproveResult | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  // ── Adjustments ──
  const [adjustOn, setAdjustOn] = useState(false);
  const [priceStr, setPriceStr] = useState('');
  const [uplift, setUplift] = useState(0);
  const [downStr, setDownStr] = useState('');
  const [term, setTerm] = useState<number | null>(null);
  const [preview, setPreview] = useState<Fin1PlanResponse | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [previewing, setPreviewing] = useState(false);

  const isUsed = detail?.is_used_asset ?? false;

  // What the shop asked for. The used device's price lives on the contract
  // (the shop's own pick, the same figure approve compares against); the rest
  // is frozen on the request.
  const { data: requestedPrice = null } = useQuery({
    queryKey: ['partner-case-list-price', detail?.contract_id],
    queryFn: async () => (await apiClient.get<Array<{ list_price: number | null }>>(
      `/v_contract_detail?id=eq.${detail!.contract_id}&select=list_price`,
    ))[0]?.list_price ?? null,
    enabled: open && isUsed && detail != null,
    staleTime: 60 * 1000,
  });
  const requested = {
    price: requestedPrice,
    uplift: detail?.uplift_amount ?? 0,
    down_amount: detail?.down_payment ?? null,
    term_months: detail?.term_months ?? null,
  };

  useEffect(() => {
    if (!open) return;
    setView('form');
    setChallenge(randomFourDigits());
    setTyped('');
    setNote('');
    setSaving(false);
    setError(null);
    setResult(null);
    setConfirmClose(false);
    setAdjustOn(false);
    setPreview(null);
    setPreviewError('');
  }, [open]);

  // Seed the four inputs from the request whenever the section is opened, so
  // switching it off and on again starts from what the shop asked for.
  useEffect(() => {
    if (!adjustOn || !detail) return;
    setUplift(detail.uplift_amount ?? 0);
    setDownStr(detail.down_payment != null ? String(detail.down_payment) : '');
    setTerm(detail.term_months);
    setPreview(null);
    setPreviewError('');
  }, [adjustOn, detail?.case_id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (adjustOn && isUsed) setPriceStr(requestedPrice != null ? String(requestedPrice) : '');
  }, [adjustOn, isUsed, requestedPrice]);

  // Only the fields that differ from the request go to the backend.
  const current: Record<PartnerCaseAdjustKey, number | null> = {
    price: isUsed ? num(priceStr) : null,
    uplift,
    down_amount: num(downStr),
    term_months: term,
  };
  const changedKeys = (['price', 'uplift', 'down_amount', 'term_months'] as PartnerCaseAdjustKey[])
    .filter(k => adjustOn && (k !== 'price' || isUsed) && current[k] != null && Number(current[k]) !== Number(requested[k]));
  const changed = changedKeys.length > 0;

  // Dry run on every change — the same gate approve calls. Its policy gives
  // the controls their bounds, its figures fill the comparison.
  const inputsReady = adjustOn && detail != null && term != null
    && (current.down_amount ?? 0) > 0 && (!isUsed || (current.price ?? 0) > 0);
  useEffect(() => {
    if (!inputsReady || !detail) return;
    let cancelled = false;
    setPreviewing(true);
    const timer = setTimeout(async () => {
      try {
        const res = await apiClient.rpc<Fin1PlanResponse>('fn_contract_set_fin1_plan', {
          p_contract_id: detail.contract_id,
          p_term_months: term,
          p_uplift: uplift,
          p_down_amount: current.down_amount,
          ...(isUsed ? { p_price: current.price } : {}),
          p_dry_run: true,
        });
        if (cancelled) return;
        setPreview(res);
        setPreviewError('');
      } catch (err) {
        if (cancelled) return;
        setPreviewError(translateApiError(err, t));
      } finally {
        if (!cancelled) setPreviewing(false);
      }
    }, 350);
    return () => { cancelled = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputsReady, detail?.contract_id, term, uplift, downStr, priceStr, isUsed]);

  // The branch's bounds before any preview (policy-only dry run, HANDOFF
  // 2026-10-25) — a used device with no saved price can't preview until a
  // price is typed, and the price box must say what range it accepts.
  const { data: basePolicy = null } = useQuery({
    queryKey: ['fin1-plan-policy', detail?.contract_id],
    queryFn: async () => (await apiClient.rpc<Fin1PlanResponse>('fn_contract_set_fin1_plan', {
      p_contract_id: detail!.contract_id,
      p_dry_run: true,
    })).policy,
    enabled: open && adjustOn && detail != null,
    staleTime: 60 * 1000,
    retry: false,
  });
  const policy = preview?.policy ?? basePolicy;
  const upliftMax = policy?.uplift_max ?? 0;
  const upliftOptions = useMemo(() => {
    const steps = new Set<number>([uplift, requested.uplift ?? 0]);
    for (let v = 0; v <= upliftMax; v += UPLIFT_STEP) steps.add(v);
    return [...steps].sort((a, b) => a - b).map(v => ({ value: String(v), label: v > 0 ? `+${fmtCurrency(v)}` : '0' }));
  }, [upliftMax, uplift, requested.uplift]);
  const termOptions = useMemo(() => {
    const terms = new Set<number>(policy?.terms ?? []);
    if (term != null) terms.add(term);
    return [...terms].sort((a, b) => a - b).map(n => ({ value: String(n), label: t('partnerCase.termValue', { count: n }) }));
  }, [policy?.terms, term, t]);

  // The modal keeps rendering through its close transition, so hold the last
  // request rather than blanking when the parent clears its selection.
  const contractCode = detail?.contract_code ?? '';
  const { data: evidence = [] } = useAssetEvidence(detail?.target_asset_id);
  const devicePhotoCount = evidence.reduce((n, s) => n + s.photo_count, 0);

  const forceClose = () => { setConfirmClose(false); onClose(); };

  const handleClose = () => {
    if (view === 'done') { forceClose(); return; }
    if (note.trim() || typed || changed) { setConfirmClose(true); return; }
    forceClose();
  };

  const matches = typed === challenge;
  // With changes, the backend needs a note and a plan its gate accepts.
  const adjustReady = !changed || (!!note.trim() && !!preview && !previewing && !previewError);

  const handleApprove = async () => {
    if (!detail || !matches || !adjustReady) return;
    setSaving(true);
    setError(null);
    try {
      const res = await apiClient.rpc<PartnerCaseApproveResult>('fn_partner_case_approve', {
        p_case_id: detail.case_id,
        p_note: note.trim() || null,
        ...(changed ? { p_adjustments: Object.fromEntries(changedKeys.map(k => [k, current[k]])) } : {}),
      });
      setResult(res);
      setView('done');
      invalidate(detail.contract_id);
    } catch (err) {
      setError(err instanceof ApiError ? translateApiError(err, t) : String(err));
    } finally {
      setSaving(false);
    }
  };

  const withAdjust = !!result?.requires_acknowledge;

  return (
    <>
      <Modal
        open={open}
        onClose={handleClose}
        maxWidth="34rem"
        width="100%"
        ariaLabel={t('partnerCase.approve')}
      >
        <div className="modal-header">
          <h2 className="modal-title">{t('partnerCase.approve')}</h2>
          <button type="button" className="modal-close-btn" onClick={handleClose}>&times;</button>
        </div>

        {view === 'form' ? (
          <>
            <div className="modal-content">
              <div className="px-3 py-2.5 rounded-md bg-surface border border-line">
                <div className="font-medium text-sm">{contractCode}</div>
                <div className="text-xs text-subtle mt-0.5">
                  {detail?.customer_name}
                  {detail?.financed_amount != null && <> · {fmtCurrency(detail.financed_amount)}</>}
                </div>
              </div>

              <div className="alert alert-info mt-3">
                <Info size={16} className="shrink-0" />
                <span>{t('partnerCase.approveHint')}</span>
              </div>

              {/* ── Change the figures agreed with the shop ── */}
              <div className="mt-4 rounded-md border border-line px-3 py-3">
                <LabeledCheckbox
                  label={<>
                    <span className="font-medium">{t('partnerCase.adjustToggle')}</span>
                    <span className="block text-xs text-subtle">{t('partnerCase.adjustToggleHint')}</span>
                  </>}
                  checked={adjustOn}
                  onChange={e => setAdjustOn(e.target.checked)}
                />

                {adjustOn && (
                  <div className="mt-3 flex flex-col gap-4">
                    <div className="grid grid-cols-2 gap-x-3 gap-y-4">
                      {/* Device price: only a used device's is the shop's pick.
                          A new one comes from the price table, case by case it
                          can't change. */}
                      <div className="flex flex-col col-span-2">
                        <label className="form-label">{adjustLabel('price', t)}</label>
                        {isUsed ? (
                          <>
                            <MaskedInput
                              mask="number"
                              decimalScale={0}
                              size="sm"
                              value={priceStr}
                              onChange={raw => setPriceStr(raw)}
                              className="w-full"
                            />
                            <FieldHint
                              requested={requested.price}
                              changed={changedKeys.includes('price')}
                              k="price"
                              range={policy?.used_retail_min != null && policy?.used_retail_max != null
                                ? t('fin1Plan.downAmountHint', {
                                  min: fmtCurrency(policy.used_retail_min),
                                  max: fmtCurrency(policy.used_retail_max),
                                  unit: policy.used_price_rounding_unit ?? 100,
                                })
                                : null}
                            />
                          </>
                        ) : (
                          <div className="flex items-center gap-2 text-sm">
                            <span className="tabular-nums">{fmtCurrency(preview?.base_price ?? null)}</span>
                            <Badge size="sm">{t('partnerCase.priceFromPricebook')}</Badge>
                          </div>
                        )}
                      </div>

                      <div className="flex flex-col">
                        <label className="form-label">{adjustLabel('uplift', t)}</label>
                        <Select
                          options={upliftOptions}
                          value={String(uplift)}
                          onChange={v => setUplift(Number(v ?? 0))}
                          searchable={false}
                          size="sm"
                        />
                        <FieldHint requested={requested.uplift} changed={changedKeys.includes('uplift')} k="uplift" />
                      </div>

                      <div className="flex flex-col">
                        <label className="form-label">{adjustLabel('term_months', t)}</label>
                        <Select
                          options={termOptions}
                          value={term != null ? String(term) : null}
                          onChange={v => setTerm(v ? Number(v) : null)}
                          searchable={false}
                          size="sm"
                        />
                        <FieldHint requested={requested.term_months} changed={changedKeys.includes('term_months')} k="term_months" />
                      </div>

                      <div className="flex flex-col col-span-2">
                        <label className="form-label">{adjustLabel('down_amount', t)}</label>
                        <MaskedInput
                          mask="number"
                          decimalScale={0}
                          size="sm"
                          value={downStr}
                          onChange={raw => setDownStr(raw)}
                          className="w-full"
                        />
                        <FieldHint
                          requested={requested.down_amount}
                          changed={changedKeys.includes('down_amount')}
                          k="down_amount"
                          range={policy?.min_down_amount != null && policy.max_down_amount != null
                            ? t('fin1Plan.downAmountHint', {
                              min: fmtCurrency(policy.min_down_amount),
                              max: fmtCurrency(policy.max_down_amount),
                              unit: policy.rounding_unit,
                            })
                            : null}
                        />
                      </div>
                    </div>

                    {previewError && (
                      <div className="alert alert-warning">
                        <AlertTriangle size={16} className="shrink-0" />
                        <span>{previewError}</span>
                      </div>
                    )}

                    {changed && preview && !previewError && (
                      <PlanCompareTable
                        requested={{
                          installment: detail?.installment_amount ?? null,
                          lastInstallment: detail?.last_installment_amount ?? null,
                          dueAtSigning: detail?.requested_due_at_signing ?? null,
                        }}
                        approved={{
                          installment: preview.installment_amount,
                          lastInstallment: preview.last_installment_amount,
                          dueAtSigning: preview.due_at_signing,
                        }}
                        changes={changedKeys.map(k => ({ key: k, requested: requested[k], approved: current[k] }))}
                        pending={previewing}
                      />
                    )}
                    {changed && !preview && previewing && (
                      <div className="flex items-center gap-2 text-sm text-subtle">
                        <Loader2 size={14} className="animate-spin" />
                        <span>{t('common.loading')}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="form-grid mt-4">
                <div className="flex flex-col">
                  <label className="form-label">
                    {changed ? t('partnerCase.adjustNoteLabel') : t('partnerCase.approveNote')}
                    {changed && <span className="text-danger-fg"> *</span>}
                  </label>
                  <TextArea
                    value={note}
                    onChange={e => setNote(e.target.value)}
                    rows={2}
                    placeholder={changed ? t('partnerCase.adjustNotePlaceholder') : t('partnerCase.approveNotePlaceholder')}
                  />
                </div>

                <div className="flex flex-col">
                  <label className="form-label">
                    {t('partnerCase.confirmDigits', { digits: challenge })}
                  </label>
                  <Input
                    value={typed}
                    onChange={e => setTyped(e.target.value.replace(/\D/g, '').slice(0, 4))}
                    inputMode="numeric"
                    autoComplete="off"
                    className="w-full tabular-nums"
                    placeholder={challenge}
                    error={typed.length === 4 && !matches}
                  />
                </div>
              </div>
            </div>

            <ModalErrorBand message={error} onDismiss={() => setError(null)} />

            <div className="modal-footer">
              <Button variant="ghost" onClick={handleClose} disabled={saving}>
                {t('common.cancel')}
              </Button>
              <Button color="primary" onClick={handleApprove} disabled={saving || !matches || !detail || !adjustReady}>
                {changed ? t('partnerCase.approveWithAdjust') : t('partnerCase.approve')}
              </Button>
            </div>
          </>
        ) : result && (
          <ActionDoneView
            headline={withAdjust ? t('partnerCase.approveAdjustDone') : t('partnerCase.approveDone')}
            contractCode={contractCode}
            contractLink={detail ? { to: `/admin/contracts/search/${detail.contract_id}` } : undefined}
            stateTransition={{
              from: t('contract.state_PENDING_APPROVAL'),
              to: t('contract.state_APPROVED'),
              toColor: 'success',
            }}
            detailRows={[
              {
                label: t('partnerCase.usableUntil'),
                value: <DateTime value={result.approved_expires_at} showTime />,
                emphasis: true,
              },
              ...adjustmentRows(result.adjustments).map(r => ({
                label: adjustLabel(r.key, t),
                value: `${adjustValue(r.key, r.requested, t)} → ${adjustValue(r.key, r.approved, t)}`,
              })),
              // Approving freezes the device's photos. The result's own number
              // counts photo groups, not photos — say how many photos, or
              // nothing when the device has none.
              ...(devicePhotoCount > 0
                ? [{ label: t('partnerCase.photosLocked'), value: t('partnerCase.photosLockedValue', { count: devicePhotoCount }) }]
                : []),
            ]}
            extras={withAdjust ? (
              <div className="alert alert-warning">
                <AlertTriangle size={16} className="shrink-0" />
                <span>{t('partnerCase.approveAdjustDoneHint')}</span>
              </div>
            ) : undefined}
            onClose={() => { onApproved?.(); forceClose(); }}
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

/** Under each input: what the shop asked for once it differs, else the allowed range. */
function FieldHint({ requested, changed, k, range }: {
  requested: number | null;
  changed: boolean;
  k: PartnerCaseAdjustKey;
  range?: string | null;
}) {
  const { t } = useTranslation();
  if (changed) {
    return (
      <span className="text-xs text-warning-fg mt-1 tabular-nums">
        {t('partnerCase.requestedValue', { value: adjustValue(k, requested, t) })}
      </span>
    );
  }
  return range ? <span className="text-xs text-subtle mt-1 tabular-nums">{range}</span> : null;
}
