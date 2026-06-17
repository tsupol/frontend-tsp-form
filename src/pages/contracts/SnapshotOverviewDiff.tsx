// Snapshot diff: "what changed in the contract since the previous version".
//
// Frame: this is NOT "what this signing was about" — it's "differences in
// contract state between the previous non-VOIDED snapshot and this one".
// A change can show up here that didn't originate in a signing ceremony
// (the contract table has mutable fields that can drift between SEALs).
// That's correct, not a bug — it tells the truth about state. The
// change_reason label at the top frames the user's expectation.
//
// Rendering:
//   - Lessee block: highlights success/danger when the lessee identity
//     changed (PRIMARY_SWAP / ATTACH_PRIMARY_CUSTOMER); plain otherwise.
//   - Guarantors block: list, with added (success border + Plus) and
//     removed (danger border + Minus) called out. Unchanged guarantors
//     render plain.
//   - Device block: success border if a device was newly bound, danger
//     if released, warning if changed device. Plain if unchanged.
//   - Agreed terms block: warning border + warning row highlight when
//     any field changed; plain if all match.

import { useTranslation } from 'react-i18next';
import { Badge } from 'tsp-form';
import { Minus, Plus } from 'lucide-react';
import { fmtCurrency, formatAssetCode } from '../../lib/format';

interface PartyEntry {
  role: string;
  index: number;
  customer_id: number | null;
  prefix: string | null;
  first_name: string | null;
  last_name: string | null;
  id_type: string | null;
  id_number: string | null;
  tel: string | null;
}

interface AssetEntry {
  device_id: number | null;
  model_id: number | null;
  variant_id: number | null;
  asset_code: string | null;
  is_specific_unit: boolean;
}

interface AgreedEntry {
  value_month: number | null;
  agreed_price: number | null;
  down_payment: number | null;
  insurance_deposit: number | null;
  installment_amount: number | null;
}

interface SnapshotShape {
  parties?: PartyEntry[];
  asset?: AssetEntry | null;
  agreed?: AgreedEntry | null;
}

interface Props {
  changeReason: string | null;
  stateBefore: unknown;
  stateAfter: unknown;
}

function asSnapshot(x: unknown): SnapshotShape {
  if (x && typeof x === 'object') return x as SnapshotShape;
  return {};
}

function partyKey(p: PartyEntry): string {
  if (p.customer_id != null) return `c:${p.customer_id}`;
  return `${p.role}#${p.index}`;
}

function partyName(p: PartyEntry): string {
  return [p.prefix, p.first_name, p.last_name].filter(Boolean).join(' ').trim() || '—';
}

type ChangeKind = 'added' | 'removed' | 'changed' | 'unchanged';

function borderClass(kind: ChangeKind): string {
  switch (kind) {
    case 'added':     return 'border-success';
    case 'removed':   return 'border-danger';
    case 'changed':   return 'border-warning';
    case 'unchanged': return 'border-line';
  }
}

export function SnapshotOverviewDiff({ changeReason, stateBefore, stateAfter }: Props) {
  const { t } = useTranslation();
  const before = asSnapshot(stateBefore);
  const after = asSnapshot(stateAfter);

  // ─── Lessee ─────────────────────────────────────────────────────────
  const lesseeBefore = (before.parties ?? []).find(p => p.role === 'LESSEE') ?? null;
  const lesseeAfter = (after.parties ?? []).find(p => p.role === 'LESSEE') ?? null;
  const lesseeKindRaw: ChangeKind =
    !lesseeBefore && lesseeAfter ? 'added' :
    lesseeBefore && !lesseeAfter ? 'removed' :
    lesseeBefore && lesseeAfter && partyKey(lesseeBefore) !== partyKey(lesseeAfter) ? 'changed' :
    'unchanged';

  // ─── Guarantors ─────────────────────────────────────────────────────
  const beforeGs = (before.parties ?? []).filter(p => p.role === 'GUARANTOR');
  const afterGs  = (after.parties  ?? []).filter(p => p.role === 'GUARANTOR');
  const beforeGKeys = new Set(beforeGs.map(partyKey));
  const afterGKeys  = new Set(afterGs.map(partyKey));
  const addedGs   = afterGs.filter(p => !beforeGKeys.has(partyKey(p)));
  const removedGs = beforeGs.filter(p => !afterGKeys.has(partyKey(p)));
  const guarantorKind: ChangeKind =
    addedGs.length && !removedGs.length ? 'added' :
    removedGs.length && !addedGs.length ? 'removed' :
    addedGs.length || removedGs.length ? 'changed' :
    'unchanged';

  // ─── Device ─────────────────────────────────────────────────────────
  const beforeAsset = before.asset ?? null;
  const afterAsset  = after.asset  ?? null;
  const beforeAssetId = beforeAsset?.asset_code ? formatAssetCode(beforeAsset.asset_code) : (beforeAsset?.device_id != null ? `#${beforeAsset.device_id}` : null);
  const afterAssetId  = afterAsset?.asset_code  ? formatAssetCode(afterAsset.asset_code)  : (afterAsset?.device_id  != null ? `#${afterAsset.device_id}`  : null);
  const deviceKind: ChangeKind =
    !beforeAssetId && afterAssetId ? 'added' :
    beforeAssetId && !afterAssetId ? 'removed' :
    beforeAssetId !== afterAssetId ? 'changed' :
    'unchanged';

  // ─── Agreed terms ───────────────────────────────────────────────────
  const agreedFields: Array<{ key: keyof AgreedEntry; labelKey: string; fmt: (v: number | null) => string }> = [
    { key: 'agreed_price',       labelKey: 'contract.agreedPrice',       fmt: fmtMoney },
    { key: 'down_payment',       labelKey: 'contract.downPayment',       fmt: fmtMoney },
    { key: 'insurance_deposit',  labelKey: 'contract.insuranceDeposit',  fmt: fmtMoney },
    { key: 'installment_amount', labelKey: 'contract.installmentAmount', fmt: fmtMoney },
    { key: 'value_month',        labelKey: 'contract.installments',     fmt: fmtMonths },
  ];
  const agreedDiffs = agreedFields.map(f => {
    const b = before.agreed?.[f.key] ?? null;
    const a = after.agreed?.[f.key] ?? null;
    return { ...f, before: b, after: a, changed: a !== b };
  });
  const anyAgreedChanged = agreedDiffs.some(d => d.changed);
  const agreedKind: ChangeKind = anyAgreedChanged ? 'changed' : 'unchanged';

  return (
    <div className="flex flex-col gap-3">
      {changeReason && (
        <div className="flex items-center gap-2 text-xs text-subtle">
          <span className="uppercase tracking-wider">
            {t('signing.diffOriginatingReason', { defaultValue: 'For signing' })}
          </span>
          <Badge size="xs" color="default">
            {t(`signing.reason_${changeReason}`, { defaultValue: changeReason })}
          </Badge>
        </div>
      )}

      {/* Lessee */}
      {(lesseeBefore || lesseeAfter) && (
        <OverviewBlock title={t('signing.role_LESSEE')} kind={lesseeKindRaw}>
          {lesseeAfter && (
            <PartyLine party={lesseeAfter} mark={lesseeKindRaw === 'added' || lesseeKindRaw === 'changed' ? 'added' : 'none'} />
          )}
          {lesseeBefore && lesseeKindRaw === 'changed' && (
            <PartyLine party={lesseeBefore} mark="removed" />
          )}
          {lesseeBefore && lesseeKindRaw === 'removed' && (
            <PartyLine party={lesseeBefore} mark="removed" />
          )}
        </OverviewBlock>
      )}

      {/* Guarantors */}
      {(afterGs.length > 0 || removedGs.length > 0) && (
        <OverviewBlock title={t('signing.role_GUARANTOR')} kind={guarantorKind}>
          <ul className="flex flex-col gap-1.5">
            {afterGs.map(p => (
              <PartyLine
                key={`a-${partyKey(p)}`}
                party={p}
                mark={!beforeGKeys.has(partyKey(p)) ? 'added' : 'none'}
              />
            ))}
            {removedGs.map(p => (
              <PartyLine key={`r-${partyKey(p)}`} party={p} mark="removed" />
            ))}
          </ul>
        </OverviewBlock>
      )}

      {/* Device */}
      {(beforeAssetId || afterAssetId) && (
        <OverviewBlock title={t('signing.previewAssetTitle')} kind={deviceKind}>
          <div className="flex items-center gap-2 text-sm">
            {deviceKind === 'added' && <Plus size={14} className="text-success shrink-0" />}
            {deviceKind === 'removed' && <Minus size={14} className="text-danger shrink-0" />}
            {deviceKind === 'unchanged' && <span className="w-[14px]" />}
            {deviceKind === 'changed' && <span className="w-[14px]" />}
            <span className={deviceKind === 'removed' ? 'font-mono line-through text-subtle' : 'font-mono'}>
              {(deviceKind === 'removed' ? beforeAssetId : afterAssetId) ?? '—'}
            </span>
            {deviceKind === 'changed' && beforeAssetId && (
              <span className="ml-auto text-[11px] text-subtle">
                {t('signing.diffWas', { defaultValue: 'was' })}{' '}
                <span className="font-mono line-through">{beforeAssetId}</span>
              </span>
            )}
          </div>
        </OverviewBlock>
      )}

      {/* Agreed terms */}
      {(after.agreed || before.agreed) && (
        <OverviewBlock title={t('signing.previewAgreedTitle')} kind={agreedKind}>
          <dl className="flex flex-col gap-1.5">
            {agreedDiffs.map(d => {
              if (d.after == null && d.before == null) return null;
              return (
                <DiffLine
                  key={d.key}
                  label={t(d.labelKey, { defaultValue: d.labelKey })}
                  before={d.fmt(d.before)}
                  after={d.fmt(d.after)}
                  changed={d.changed}
                />
              );
            })}
          </dl>
        </OverviewBlock>
      )}
    </div>
  );
}

function OverviewBlock({ title, kind, children }: {
  title: React.ReactNode;
  kind: ChangeKind;
  children: React.ReactNode;
}) {
  return (
    <section className={`border ${borderClass(kind)} rounded-md px-3 py-2.5`}>
      <h3 className="text-[11px] font-semibold text-subtle uppercase tracking-wider mb-1.5">{title}</h3>
      {children}
    </section>
  );
}

function PartyLine({ party, mark }: { party: PartyEntry; mark: 'added' | 'removed' | 'none' }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-start gap-2 text-sm">
      <span className="shrink-0 w-4 mt-0.5">
        {mark === 'added' && <Plus size={14} className="text-success" />}
        {mark === 'removed' && <Minus size={14} className="text-danger" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={mark === 'removed' ? 'font-medium line-through text-subtle' : 'font-medium'}>
            {partyName(party)}
          </span>
          {mark === 'added' && (
            <Badge size="xs" color="success">{t('signing.diffAdded', { defaultValue: 'New' })}</Badge>
          )}
          {mark === 'removed' && (
            <Badge size="xs" color="default">{t('signing.diffRemoved', { defaultValue: 'Removed' })}</Badge>
          )}
        </div>
        {(party.id_number || party.tel) && (
          <div className="text-[11px] text-subtle mt-0.5 flex flex-wrap gap-x-3">
            {party.id_number && <span className="font-mono">{party.id_number}</span>}
            {party.tel && <span>{party.tel}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

function DiffLine({ label, before, after, changed }: {
  label: React.ReactNode;
  before: string;
  after: string;
  changed: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className={`flex items-center gap-3 text-sm ${changed ? 'text-warning-fg' : ''}`}>
      <span className="text-subtle min-w-[8rem]">{label}</span>
      <span className={changed ? 'font-medium' : ''}>{after}</span>
      {changed && (
        <span className="ml-auto text-[11px] text-subtle">
          {t('signing.diffWas', { defaultValue: 'was' })}{' '}
          <span className="line-through">{before}</span>
        </span>
      )}
    </div>
  );
}

function fmtMoney(v: number | null): string {
  if (v == null) return '—';
  return fmtCurrency(v);
}

function fmtMonths(v: number | null): string {
  if (v == null) return '—';
  return String(v);
}
