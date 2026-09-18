// One device-return document, as the shop sees it — UI_SUMMARY/146,
// work order §2 steps 2-4.
//
// Two tabs: the document itself, and its history (the shared timeline).
//
// The buttons come from `fn_partner_return_available_actions` and nowhere else
// (146 §3). A button the RPC never mentions is not rendered; one it mentions
// but refuses is rendered disabled with the backend's own sentence on it, the
// same way the contract footer already does it. Hidden outright: reasons that
// mean "not for you" or "not now" — permission and status.
//
// The two return photo slots are the contract album's own RETURN_* groups, so
// the album component is reused whole rather than re-implemented: it already
// reads the slot list from the backend and freezes a group when the backend
// says so.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Badge, Button, Tooltip } from 'tsp-form';
import {
  ArrowLeft, Camera, CheckCircle2, ExternalLink, FileSignature, History, Info, PenLine,
  Send, Trash2, XCircle,
} from 'lucide-react';
import { DateTime } from '../../components/DateTime';
import { PartnerReturnTimeline } from '../../components/PartnerReturnTimeline';
import { ContractPhotoGroups } from '../contracts/ContractPhotoGroups';
import { blockingReasonText } from '../../lib/apiErrors';
import {
  usePartnerReturnDetail, usePartnerReturnActions, usePartnerReturnTimeline,
  useReturnStatuses, useReturnReasons, useReturnReceivePoints,
} from './usePartnerReturn';
import { returnBadgeColor, type PartnerReturnAction } from './partnerReturnTypes';
import { ReturnActionModal, type ReturnActionCode } from './ReturnActionModal';

type ReturnTab = 'detail' | 'history';

const TABS: ReturnTab[] = ['detail', 'history'];

/** Buttons the shop may see, in the order they read on screen. */
const SHOP_ACTION_ORDER: ReturnActionCode[] = ['SIGNING_REISSUE', 'SHIP', 'VOID'];

const ACTION_ICON: Record<ReturnActionCode, typeof Send> = {
  SIGNING_REISSUE: FileSignature,
  SHIP: Send,
  VOID: Trash2,
};

/** A reason that means "this is not yours / not now" — the button just goes away. */
const HIDE_REASONS = new Set(['permission_denied', 'status_not_allowed', 'not_in_pool']);

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-1.5 border-b border-line-subtle last:border-b-0">
      <span className="text-sm text-subtle w-40 shrink-0">{label}</span>
      <span className="text-sm min-w-0 flex-1 break-words">{children}</span>
    </div>
  );
}

export function ReturnDetailPanel({ returnId, isMobile, onBack }: {
  returnId: number;
  isMobile: boolean;
  onBack?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const isThai = i18n.language === 'th';

  const [tab, setTab] = useState<ReturnTab>('detail');
  const [action, setAction] = useState<ReturnActionCode | null>(null);
  const [lastAction, setLastAction] = useState<ReturnActionCode>('VOID');

  const { detail, isLoading } = usePartnerReturnDetail(returnId);
  const { caps } = usePartnerReturnActions(returnId);
  const timeline = usePartnerReturnTimeline(returnId, tab === 'history');
  const statuses = useReturnStatuses();
  const reasons = useReturnReasons();
  const receivePoints = useReturnReceivePoints();

  const refLabel = (
    list: Array<{ code: string; name_th: string; name_en: string }>,
    code: string | null | undefined,
  ) => {
    if (!code) return '—';
    const row = list.find(r => r.code === code);
    if (!row) return code;
    return (isThai ? row.name_th : row.name_en) || code;
  };

  if (isLoading && !detail) {
    return <div className="p-8 text-center text-subtler">{t('common.loading')}</div>;
  }
  if (!detail) {
    return <div className="p-8 text-center text-subtler">{t('partnerReturn.notFound')}</div>;
  }

  const statusLabel = refLabel(statuses, detail.status);

  // The capability RPC decides everything; a button with no entry is not drawn.
  const byCode = new Map<string, PartnerReturnAction>(
    (caps?.actions ?? []).map(a => [a.action_code, a]),
  );
  const buttons = SHOP_ACTION_ORDER
    .map(code => ({ code, a: byCode.get(code) }))
    .filter((x): x is { code: ReturnActionCode; a: PartnerReturnAction } => !!x.a)
    .filter(x => x.a.is_available || !HIDE_REASONS.has(x.a.blocking_reason ?? ''));

  // "Let the customer sign" is not one of the RPC's actions — it is a jump to
  // the contract's signing tab, and it exists exactly while the backend still
  // names a receipt to sign on an open document.
  const signingId = caps?.signing_id ?? detail.signing_id;
  const canSign = detail.is_open && !detail.device_received && signingId != null;

  const openAction = (code: ReturnActionCode) => { setLastAction(code); setAction(code); };

  return (
    <>
      <div className="flex-none flex items-center h-panel-header-h px-4 border-b border-line gap-2">
        {isMobile && onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label={t('common.back')}
            className="flex items-center justify-center w-7 h-7 bg-transparent border-none cursor-pointer text-current"
          >
            <ArrowLeft size={18} />
          </button>
        )}
        <span className="font-medium text-sm truncate">{detail.return_code}</span>
        <Badge color={returnBadgeColor(detail.status)} size="sm">{statusLabel}</Badge>
      </div>

      <div className="flex-none flex px-2 border-b border-line">
        {TABS.map(x => (
          <button
            key={x}
            className={`py-2 px-3 text-sm font-medium transition-colors cursor-pointer border-b-2 whitespace-nowrap bg-transparent ${
              tab === x ? 'border-primary-fg text-primary-fg' : 'border-transparent text-fg'
            }`}
            onClick={() => setTab(x)}
          >
            <span className="inline-flex items-center gap-1.5">
              {x === 'history' ? <History size={14} /> : <Info size={14} />}
              {t(`partnerReturn.tab_${x}`)}
            </span>
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto better-scroll px-4 py-3">
        {tab === 'detail' ? (
          <div className="flex flex-col gap-4">
            {/* The one line that tells the shop whose move it is. */}
            {detail.status === 'RECEIVED' && (
              <div className="alert alert-success">
                <CheckCircle2 size={16} className="shrink-0" />
                <span>{t('partnerReturn.receivedWaitingFund')}</span>
              </div>
            )}
            {detail.status === 'OPEN' && detail.requires_customer_signing && (
              <div className="alert alert-info">
                <PenLine size={16} className="shrink-0" />
                <span>{t('partnerReturn.waitingCustomerSignature')}</span>
              </div>
            )}

            <div>
              <Row label={t('partnerReturn.statusLabel')}>{statusLabel}</Row>
              <Row label={t('partnerReturn.reason')}>
                {refLabel(reasons, detail.reason_code)}
                {detail.note && <span className="text-subtle"> · {detail.note}</span>}
              </Row>
              <Row label={t('partnerReturn.receivePoint')}>
                {refLabel(receivePoints, detail.receive_point)}
              </Row>
              <Row label={t('partnerReturn.contract')}>
                <button
                  type="button"
                  onClick={() => navigate(`/admin/contracts/search/${detail.contract_id}`)}
                  className="text-primary-fg hover:underline inline-flex items-center gap-1 bg-transparent border-none p-0 cursor-pointer"
                >
                  {detail.contract_code ?? detail.contract_id}
                  <ExternalLink size={12} />
                </button>
              </Row>
              <Row label={t('partnerReturn.customer')}>{detail.customer_name ?? '—'}</Row>
              <Row label={t('partnerReturn.device')}>
                {detail.device_code ?? '—'}
                {detail.device_bucket && (
                  <span className="text-subtle">
                    {' · '}
                    {t(`asset.bucket.${detail.device_bucket}`, { defaultValue: detail.device_bucket })}
                  </span>
                )}
              </Row>
              <Row label={t('partnerReturn.openedAt')}>
                <DateTime value={detail.created_at} showTime />
                {detail.created_by_name && <span className="text-subtle"> · {detail.created_by_name}</span>}
              </Row>
              {detail.received_at && (
                <Row label={t('partnerReturn.receivedAt')}>
                  <DateTime value={detail.received_at} showTime />
                </Row>
              )}
              {detail.voided_at && (
                <Row label={t('partnerReturn.voidedAt')}>
                  <DateTime value={detail.voided_at} showTime />
                  {detail.void_reason && <span className="text-subtle"> · {detail.void_reason}</span>}
                </Row>
              )}
            </div>

            <div>
              <div className="flex items-center gap-2 mb-2">
                <Camera size={14} className="text-subtle" />
                <h3 className="text-sm font-medium">{t('partnerReturn.photos')}</h3>
                {!detail.allows_photo_edit && (
                  <span className="text-xs text-subtle">{t('partnerReturn.photosLocked')}</span>
                )}
              </div>
              {/* The album owns which groups exist and which are frozen; this
                  page only says which contract to draw. */}
              <ContractPhotoGroups contractId={detail.contract_id} />
            </div>
          </div>
        ) : (
          <PartnerReturnTimeline rows={timeline.rows} contractId={detail.contract_id} />
        )}
      </div>

      {(canSign || buttons.length > 0) && (
        <div className="flex-none border-t border-line px-4 py-3 flex flex-wrap gap-2">
          {canSign && (
            <Button
              size="sm"
              color="primary"
              startIcon={<PenLine size={14} />}
              onClick={() => navigate(`/admin/contracts/search/${detail.contract_id}?tab=signing`)}
              data-action="RETURN_CUSTOMER_SIGN"
            >
              {t('partnerReturn.action_CUSTOMER_SIGN')}
            </Button>
          )}
          {buttons.map(({ code, a }) => {
            const Icon = ACTION_ICON[code];
            const label = t(`partnerReturn.action_${code}`);
            const reason = a.is_available ? '' : blockingReasonText(a, t);
            const btn = (
              <Button
                key={code}
                size="sm"
                variant="outline"
                color={code === 'VOID' ? 'danger' : undefined}
                startIcon={<Icon size={14} />}
                disabled={!a.is_available}
                onClick={() => openAction(code)}
                data-action={code}
                data-blocked-reason={a.is_available ? undefined : (a.blocking_reason ?? 'unavailable')}
              >
                {label}
              </Button>
            );
            return reason
              ? <Tooltip key={code} content={reason} placement="top">{btn}</Tooltip>
              : btn;
          })}
        </div>
      )}

      <ReturnActionModal
        open={action !== null}
        action={action ?? lastAction}
        returnId={returnId}
        returnCode={detail.return_code}
        contractId={detail.contract_id}
        onClose={() => setAction(null)}
      />
    </>
  );
}

/** Small helper so a caller can render a "nothing here" panel consistently. */
export function ReturnDetailEmpty({ message }: { message: string }) {
  return (
    <div className="flex-1 h-full flex items-center justify-center text-subtler">
      <div className="text-center">
        <XCircle size={32} className="mx-auto mb-2 opacity-40" />
        {message}
      </div>
    </div>
  );
}
