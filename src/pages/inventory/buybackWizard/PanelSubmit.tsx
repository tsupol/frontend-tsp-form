import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, keepPreviousData } from '@tanstack/react-query';
import { Input, Button } from 'tsp-form';
import { XCircle, CheckCircle, Circle, Check } from 'lucide-react';
import { apiClient, ApiError } from '../../../lib/api';
import { validateIMEI, validateiPhoneSerial } from '../../../lib/validators';
import { ImeiInput } from '../../../components/ImeiInput';
import { getLine } from './useBuyback';
import type { BuybackDraft } from './types';
import { translateApiError } from '../../../lib/apiErrors';

// fn_inv_buyback_validate is codes-only now (no Thai label) — each check is
// { code, passed, reason, params }. UI translates code → label, reason → detail.
interface ValidateCheck {
  code: string;
  passed: boolean;
  reason: string | null;
  params: Record<string, unknown> | null;
}

interface ValidateResult {
  po_id: number;
  ready: boolean;
  checks: ValidateCheck[];
}

export function PanelSubmit({
  draft,
  onSubmitted,
  onClose,
}: {
  draft: BuybackDraft;
  onSubmitted: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const line = getLine(draft);

  const existing = line?.attempted_identifiers_json ?? [];
  const [imei, setImei] = useState<string>(existing.find(i => i.type === 'IMEI')?.value ?? '');
  const [serial, setSerial] = useState<string>(existing.find(i => i.type === 'SERIAL_NO')?.value ?? '');
  const [error, setError] = useState('');

  useEffect(() => {
    const ex = getLine(draft)?.attempted_identifiers_json ?? [];
    setImei(ex.find(i => i.type === 'IMEI')?.value ?? '');
    setSerial(ex.find(i => i.type === 'SERIAL_NO')?.value ?? '');
  }, [draft]);

  // Validate the draft's non-identifier checks (price, condition, product type,
  // …). These don't depend on the typed IMEI/Serial, so key only on the draft —
  // re-validating per keystroke caused the checklist to flash. The one
  // identifier check (IDENTIFIERS_PROVIDED) is hidden and gated client-side
  // below; the backend still re-checks identifiers at submit time.
  const validate = useQuery<ValidateResult>({
    queryKey: ['buyback-validate', draft.po_id],
    queryFn: () => apiClient.rpc<ValidateResult>('fn_inv_buyback_validate', {
      p_po_id: draft.po_id,
      p_identifiers: [],
      p_branch_id: null,
    }),
    enabled: draft.status === 'DRAFT',
    placeholderData: keepPreviousData,
  });

  const submit = useMutation({
    mutationFn: async () => {
      if (!line) throw new Error('No line');
      await apiClient.rpc('fn_inv_buyback_submit', {
        p_po_id: draft.po_id,
        p_identifiers: buildIdentifiers(imei, serial, line.po_line_id),
        p_branch_id: null,
      });
    },
    onSuccess: () => { setError(''); onSubmitted(); },
    onError: (err) => {
      if (err instanceof ApiError) {
        const translated = translateApiError(err, t);
        setError(translated || err.message);
      } else {
        setError(String(err));
      }
    },
  });

  const imeiTrimmed = imei.trim();
  const serialTrimmed = serial.trim();
  const haveIdentifier = imeiTrimmed.length > 0 || serialTrimmed.length > 0;

  // Client-side identifier validation — catch malformed IMEI/Serial before the
  // round-trip (backend still re-checks). Either field is optional, so only
  // validate the ones that were actually typed. The Apple serial rule (11/12
  // chars, no O/I) only fits Apple products — gate it on the line's brand;
  // non-Apple serials are left as free text.
  const isApple = /apple/i.test(line?.brand_name ?? '');

  const imeiErrorKey = (() => {
    if (!imeiTrimmed) return null;
    const r = validateIMEI(imeiTrimmed);
    if (r.valid) return null;
    return imeiTrimmed.replace(/[\s-]/g, '').length === 15
      ? 'buyback.imeiInvalidChecksum'
      : 'buyback.imeiInvalidLength';
  })();

  const serialErrorKey = (() => {
    if (!serialTrimmed || !isApple) return null;
    const r = validateiPhoneSerial(serialTrimmed);
    if (r.valid) return null;
    return /[OI]/.test(serialTrimmed.toUpperCase()) || !/^[A-Za-z0-9]+$/.test(serialTrimmed)
      ? 'buyback.serialInvalidChars'
      : 'buyback.serialInvalidLength';
  })();

  const identifiersValid = !imeiErrorKey && !serialErrorKey;

  // All non-identifier checks must pass (the identifier check is gated by
  // haveIdentifier instead, since we validate without identifiers above). The
  // backend re-validates everything at submit, so this is just the button gate.
  const nonIdChecksPass = (validate.data?.checks ?? [])
    .filter(c => c.code !== 'IDENTIFIERS_PROVIDED')
    .every(c => c.passed);
  const canSubmit = haveIdentifier && identifiersValid && nonIdChecksPass && !!validate.data && !submit.isPending;

  return (
    <div className="flex flex-col h-full min-w-0 overflow-hidden">
      <div className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden better-scroll">
        <div className="p-4 max-w-2xl min-w-0">
          <h2 className="heading-3 mb-4">{t('buybackWizard.cardSubmit', { defaultValue: 'Submit' })}</h2>

          {error && (
            <div className="alert alert-danger mb-4">
              <XCircle size={16} />
              <span>{error}</span>
            </div>
          )}

          <div className="form-grid gap-4">
            <div className="alert alert-info">
              <span>{t('buyback.submitIdentifierHint')}</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex flex-col">
                <label className="form-label">{t('asset.imei')}</label>
                <ImeiInput
                  value={imei}
                  onChange={setImei}
                  placeholder={t('buyback.imeiPlaceholder')}
                  className="w-full"
                  error={!!imeiErrorKey}
                  endIcon={imeiTrimmed && !imeiErrorKey ? <Check size={16} className="text-success" /> : undefined}
                  autoFocus
                />
                {imeiErrorKey && (
                  <span className="text-xs text-danger mt-1">{t(imeiErrorKey)}</span>
                )}
              </div>
              <div className="flex flex-col">
                <label className="form-label">{t('asset.serialNo')}</label>
                <Input
                  value={serial}
                  onChange={(e) => setSerial(e.target.value)}
                  placeholder={t('buyback.serialPlaceholder')}
                  className="w-full"
                  error={!!serialErrorKey}
                  endIcon={serialTrimmed && isApple && !serialErrorKey ? <Check size={16} className="text-success" /> : undefined}
                />
                {serialErrorKey && (
                  <span className="text-xs text-danger mt-1">{t(serialErrorKey)}</span>
                )}
              </div>
            </div>

            {/* Validate checklist — codes-only from the backend (UI translates).
                The IDENTIFIERS_PROVIDED check is hidden: it always fails until the
                IMEI/Serial above is scanned, which is what this very panel does. */}
            <div className="border border-line rounded-md p-3 bg-surface">
              <div className="text-xs text-subtle mb-2">
                {t('buybackWizard.checklist', { defaultValue: 'Pre-submit checklist' })}
                {validate.isFetching && <span className="ml-2 italic">{t('common.loading')}</span>}
              </div>
              {(() => {
                const HIDDEN = new Set(['IDENTIFIERS_PROVIDED', 'IDENTIFIERS_SCANNED', 'IMEI_LUHN_VALID', 'NO_CONFLICT']);
                const visible = (validate.data?.checks ?? []).filter(c => !HIDDEN.has(c.code));
                if (visible.length === 0) {
                  return <div className="text-xs text-subtler italic">{validate.isLoading ? t('common.loading') : '—'}</div>;
                }
                return (
                  <ul className="flex flex-col gap-1.5">
                    {visible.map((c) => (
                      <li key={c.code} className="flex items-start gap-2 text-xs">
                        {c.passed
                          ? <CheckCircle size={14} className="text-success shrink-0 mt-0.5" />
                          : <Circle size={14} className="text-fg/30 shrink-0 mt-0.5" />}
                        <div className="flex-1 min-w-0">
                          <div className="text-fg">{t(`buybackWizard.check.${c.code}`, { defaultValue: c.code })}</div>
                          {!c.passed && c.reason && (
                            <div className="text-subtle text-[11px]">
                              {t(`buybackWizard.checkReason.${c.reason}`, { defaultValue: c.reason })}
                            </div>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                );
              })()}
            </div>
          </div>
        </div>
      </div>

      <div className="flex-none border-t border-line px-4 py-3 flex justify-end gap-2">
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button color="primary" disabled={!canSubmit} onClick={() => submit.mutate()}>
          {submit.isPending ? t('common.loading') : t('buyback.submit')}
        </Button>
      </div>
    </div>
  );
}

function buildIdentifiers(imei: string, serial: string, lineId: number | null) {
  if (lineId == null) return [];
  const identifiers: { type: string; value: string }[] = [];
  if (imei.trim()) identifiers.push({ type: 'IMEI', value: imei.trim() });
  if (serial.trim()) identifiers.push({ type: 'SERIAL_NO', value: serial.trim() });
  return [{ line_id: lineId, identifiers }];
}
