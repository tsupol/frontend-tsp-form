import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Input, Button } from 'tsp-form';
import { XCircle, CheckCircle, Circle } from 'lucide-react';
import { apiClient, ApiError } from '../../../lib/api';
import { getLine } from './useBuyback';
import type { BuybackDraft } from './types';

interface ValidateCheck {
  code: string;
  label: string;
  passed: boolean;
  detail: string | null;
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

  // Live validate with the typed identifiers
  const validate = useQuery<ValidateResult>({
    queryKey: ['buyback-validate', draft.po_id, imei.trim(), serial.trim()],
    queryFn: () => apiClient.rpc<ValidateResult>('fn_inv_buyback_validate', {
      p_po_id: draft.po_id,
      p_identifiers: buildIdentifiers(imei, serial, line?.po_line_id ?? null),
      p_branch_id: null,
    }),
    enabled: draft.status === 'DRAFT',
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
        const translated = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
          || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
        setError(translated || err.message);
      } else {
        setError(String(err));
      }
    },
  });

  const haveIdentifier = imei.trim().length > 0 || serial.trim().length > 0;
  const ready = validate.data?.ready ?? false;
  const canSubmit = haveIdentifier && ready && !submit.isPending;

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-auto better-scroll">
        <div className="p-4 max-w-2xl">
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
                <label className="form-label">IMEI</label>
                <Input
                  value={imei}
                  onChange={(e) => setImei(e.target.value)}
                  placeholder={t('buyback.imeiPlaceholder')}
                  className="w-full"
                  autoFocus
                />
              </div>
              <div className="flex flex-col">
                <label className="form-label">Serial No.</label>
                <Input
                  value={serial}
                  onChange={(e) => setSerial(e.target.value)}
                  placeholder={t('buyback.serialPlaceholder')}
                  className="w-full"
                />
              </div>
            </div>

            {/* Validate checklist — identifier-related checks (IDENTIFIERS_SCANNED,
                IMEI_LUHN_VALID, NO_CONFLICT) are dropped: they vacuously pass on
                empty input, and backend returns specific errors at submit time. */}
            <div className="border border-line rounded-md p-3 bg-surface">
              <div className="text-xs text-subtle mb-2">
                {t('buybackWizard.checklist', { defaultValue: 'Pre-submit checklist' })}
                {validate.isFetching && <span className="ml-2 italic">{t('common.loading')}</span>}
              </div>
              {(() => {
                const HIDDEN = new Set(['IDENTIFIERS_SCANNED', 'IMEI_LUHN_VALID', 'NO_CONFLICT']);
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
                          <div className={c.passed ? 'text-fg' : 'text-fg'}>{stripParenthetical(c.label)}</div>
                          {c.detail && <div className="text-subtle text-[11px]">{c.detail}</div>}
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

// Strip a trailing parenthetical from a backend check label.
// Example: "สินค้าประเภทเช่าซื้อ (is_contractable)" → "สินค้าประเภทเช่าซื้อ"
function stripParenthetical(label: string): string {
  return label.replace(/\s*\([^)]*\)\s*$/, '').trim();
}

function buildIdentifiers(imei: string, serial: string, lineId: number | null) {
  if (lineId == null) return [];
  const identifiers: { type: string; value: string }[] = [];
  if (imei.trim()) identifiers.push({ type: 'IMEI', value: imei.trim() });
  if (serial.trim()) identifiers.push({ type: 'SERIAL_NO', value: serial.trim() });
  return [{ line_id: lineId, identifiers }];
}
