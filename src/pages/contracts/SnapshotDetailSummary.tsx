// Post-fact "what this signing was" summary for the signing-detail modal.
//
// Frame: this is NOT a diff. The detail modal shows a single sealed snapshot;
// the reader wants "what did this signing do", not "what changed vs. the
// previous version". A comparison here is actively misleading — since mig 227
// amendment snapshots store a DELTA payload (only the field that changed), a
// naive diff against the prior FULL snapshot reads every absent field as
// "removed" and strikes through the lessee + agreed terms that never moved.
//
// So we render straight from THIS snapshot's payload, keyed on change_reason:
//   - BIND               → the device that was handed over (bound_asset).
//   - UNBIND             → device released (no device to show).
//   - ADD_CO_LESSEE      → the co-lessee that was added (added_party).
//   - REMOVE_CO_LESSEE   → the co-lessee that was released (removed_customer_id).
//   - CONTRACT_OPEN / other FULL payloads → the full agreement: lessee,
//     co-lessees, device, agreed terms — all plain, no marks.
//
// Nothing is ever struck through. Nothing is labelled "removed" unless the
// signing's whole purpose was a removal (and then it names who, plainly).

import { useTranslation } from 'react-i18next';
import { Minus } from 'lucide-react';
import { fmtCurrency, formatAssetCode, formatCid, formatTel } from '../../lib/format';

// ─── Payload shapes (loose — payloads are FULL or DELTA) ────────────────

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
  asset_code: string | null;
  brand_name?: string | null;
  model_name?: string | null;
  variant_name?: string | null;
  serial_no?: string | null;
  imei?: string | null;
}

interface AgreedEntry {
  value_month: number | null;
  agreed_price: number | null;
  down_payment: number | null;
  insurance_deposit: number | null;
  installment_amount: number | null;
}

interface SnapshotShape {
  kind?: string;
  change_reason?: string;
  parties?: PartyEntry[];
  asset?: AssetEntry | null;
  agreed?: AgreedEntry | null;
  bound_asset?: AssetEntry | null;
  added_party?: PartyEntry | null;
  removed_customer_id?: number | null;
}

interface Props {
  changeReason: string | null;
  payload: unknown;
}

function asSnapshot(x: unknown): SnapshotShape {
  if (x && typeof x === 'object') return x as SnapshotShape;
  return {};
}

function partyName(p: PartyEntry): string {
  return [p.prefix, p.first_name, p.last_name].filter(Boolean).join(' ').trim() || '—';
}

function assetLabel(a: AssetEntry | null | undefined): string | null {
  if (!a) return null;
  if (a.asset_code) return formatAssetCode(a.asset_code);
  if (a.device_id != null) return `#${a.device_id}`;
  return null;
}

// ─── Component ──────────────────────────────────────────────────────────

export function SnapshotDetailSummary({ changeReason, payload }: Props) {
  const { t } = useTranslation();
  const snap = asSnapshot(payload);
  const reason = changeReason ?? snap.change_reason ?? null;

  // ── DELTA reasons: show only the one thing this signing did ──────────

  if (reason === 'BIND') {
    const asset = snap.bound_asset ?? snap.asset ?? null;
    return (
      <SummaryBlock title={t('signing.change_BIND_title')}>
        {asset ? (
          <AssetLine asset={asset} />
        ) : (
          <EmptyNote>{t('signing.change_BIND_noAsset')}</EmptyNote>
        )}
      </SummaryBlock>
    );
  }

  if (reason === 'UNBIND') {
    return (
      <SummaryBlock title={t('signing.change_UNBIND_title')}>
        <div className="flex items-center gap-2 text-sm text-subtle">
          <Minus size={14} className="shrink-0" />
          <span>{t('signing.change_UNBIND_noPrev')}</span>
        </div>
      </SummaryBlock>
    );
  }

  if (reason === 'ADD_CO_LESSEE' && snap.added_party) {
    return (
      <SummaryBlock title={t('signing.change_ADD_CO_LESSEE_title')}>
        <PartyLine party={snap.added_party} />
      </SummaryBlock>
    );
  }

  if (reason === 'REMOVE_CO_LESSEE') {
    return (
      <SummaryBlock title={t('signing.change_REMOVE_CO_LESSEE_title')}>
        {snap.removed_customer_id != null ? (
          <div className="text-sm text-subtle">
            {t('signing.change_customerId')} #{snap.removed_customer_id}
          </div>
        ) : (
          <EmptyNote>{t('signing.change_unknownParty')}</EmptyNote>
        )}
      </SummaryBlock>
    );
  }

  // ── FULL payloads (CONTRACT_OPEN, PRIMARY_SWAP, forced FULL, legacy) ──
  // Show the whole agreement plainly. No diff, no marks.

  const lessee = (snap.parties ?? []).find(p => p.role === 'LESSEE') ?? null;
  const coLessees = (snap.parties ?? []).filter(p => p.role === 'CO_LESSEE');
  const asset = snap.asset ?? null;
  const agreed = snap.agreed ?? null;

  const hasAnyFull = lessee || coLessees.length > 0 || asset || agreed;
  if (!hasAnyFull) {
    // No usable payload sections — name the change and stop, don't invent a diff.
    return (
      <SummaryBlock title={t(`signing.reason_${reason}`, { defaultValue: t('signing.change_genericTitle') })}>
        <EmptyNote>{t('signing.detail_noPayloadAgreed')}</EmptyNote>
      </SummaryBlock>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {lessee && (
        <SummaryBlock title={t('signing.role_LESSEE')}>
          <PartyLine party={lessee} />
        </SummaryBlock>
      )}

      {coLessees.length > 0 && (
        <SummaryBlock title={t('signing.role_CO_LESSEE')}>
          <ul className="flex flex-col gap-1.5">
            {coLessees.map(p => (
              <PartyLine key={p.customer_id ?? `${p.role}#${p.index}`} party={p} />
            ))}
          </ul>
        </SummaryBlock>
      )}

      {assetLabel(asset) && (
        <SummaryBlock title={t('signing.previewAssetTitle')}>
          <AssetLine asset={asset!} />
        </SummaryBlock>
      )}

      {agreed && (
        <SummaryBlock title={t('signing.previewAgreedTitle')}>
          <dl className="flex flex-col gap-1.5">
            <TermLine label={t('contract.downPayment')} value={fmtMoney(agreed.down_payment)} />
            <TermLine label={t('contract.insuranceDeposit')} value={fmtMoney(agreed.insurance_deposit)} />
            <TermLine label={t('contract.installmentAmount')} value={fmtMoney(agreed.installment_amount)} />
            <TermLine label={t('contract.installments')} value={agreed.value_month != null ? String(agreed.value_month) : '—'} />
          </dl>
        </SummaryBlock>
      )}
    </div>
  );
}

// ─── Building blocks ────────────────────────────────────────────────────

function SummaryBlock({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="border border-line rounded-md px-3 py-2.5">
      <h3 className="text-[11px] font-semibold text-subtle uppercase tracking-wider mb-1.5">{title}</h3>
      {children}
    </section>
  );
}

function PartyLine({ party }: { party: PartyEntry }) {
  return (
    <div className="flex items-start gap-2 text-sm">
      <div className="min-w-0 flex-1">
        <div className="font-medium">{partyName(party)}</div>
        {(party.id_number || party.tel) && (
          <div className="text-[11px] text-subtle mt-0.5 flex flex-wrap gap-x-3">
            {party.id_number && <span className="font-mono">{formatCid(party.id_number)}</span>}
            {party.tel && <span>{formatTel(party.tel)}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

function AssetLine({ asset }: { asset: AssetEntry }) {
  const { t } = useTranslation();
  const code = assetLabel(asset);
  const name = [asset.brand_name, asset.model_name, asset.variant_name].filter(Boolean).join(' ').trim();
  return (
    <div className="flex flex-col gap-0.5 text-sm">
      <div className="flex items-center gap-2">
        {code && <span className="font-mono">{code}</span>}
        {name && <span className="text-subtle">{name}</span>}
      </div>
      {(asset.serial_no || asset.imei) && (
        <div className="text-[11px] text-subtle flex flex-wrap gap-x-3">
          {asset.serial_no && <span>{t('asset.serial', { defaultValue: 'Serial' })}: {asset.serial_no}</span>}
          {asset.imei && <span>IMEI: {asset.imei}</span>}
        </div>
      )}
    </div>
  );
}

function TermLine({ label, value }: { label: React.ReactNode; value: string }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="text-subtle min-w-[8rem]">{label}</span>
      <span>{value}</span>
    </div>
  );
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-subtler">{children}</p>;
}

function fmtMoney(v: number | null): string {
  if (v == null) return '—';
  return fmtCurrency(v);
}
