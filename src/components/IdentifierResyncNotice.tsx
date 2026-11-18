import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ExternalLink, Printer } from 'lucide-react';
import type { ActionDoneSecondaryAction } from '../pages/contracts/ActionDoneView';

// fn_inv_identifier_correct (mig 1722) rewrites the sealed documents of any
// unfinished contract the device is bound to, in the same call, and lists them
// in `resynced_signings`. The customer's paper copy still shows the old number,
// so the shop prints the document again from the contract's signing tab.
export interface ResyncedSigning {
  contract_id: number;
  contract_code: string;
  signing_id: number;
  signing_type: string;
}

const signingTab = (contractId: number) => `/admin/contracts/search/${contractId}?tab=signing`;

// One entry per contract, even when several of its documents were updated.
function contractsOf(signings: ResyncedSigning[] | null | undefined): ResyncedSigning[] {
  return [...new Map((signings ?? []).map(s => [s.contract_id, s])).values()];
}

/** The done view's next-step button ("print the signed document again"), when
 *  exactly one contract was updated — the normal case: a device is bound to one
 *  unfinished contract at a time. Several contracts fall back to links in the notice. */
export function resyncPrintAction(
  signings: ResyncedSigning[] | null | undefined,
  t: TFunction,
  go: (path: string) => void,
): ActionDoneSecondaryAction | undefined {
  const contracts = contractsOf(signings);
  if (contracts.length !== 1) return undefined;
  const to = signingTab(contracts[0].contract_id);
  return {
    label: t('contract.identifierResyncPrint'),
    to,
    onClick: () => go(to),
    startIcon: <Printer size={16} />,
    isNextStep: true,
  };
}

export function IdentifierResyncNotice({
  signings,
  onNavigate,
}: {
  signings: ResyncedSigning[] | null | undefined;
  /** Plain click on a fallback link (ctrl/middle-click opens a new tab) — use it to close the host modal. */
  onNavigate?: () => void;
}) {
  const { t } = useTranslation();
  const contracts = contractsOf(signings);
  if (!contracts.length) return null;
  return (
    <div className="alert alert-warning items-start">
      <Printer size={16} className="shrink-0 mt-0.5" />
      <div className="flex flex-col gap-1 min-w-0">
        <span className="font-medium">{t('contract.identifierResyncTitle', { code: contracts[0].contract_code })}</span>
        <span className="text-xs">{t('contract.identifierResyncHint')}</span>
        {contracts.length > 1 && contracts.map(c => (
          <Link
            key={c.contract_id}
            to={signingTab(c.contract_id)}
            onClick={(e) => { if (!e.ctrlKey && !e.metaKey) onNavigate?.(); }}
            className="text-sm font-medium text-primary-fg hover:underline inline-flex items-center gap-1"
          >
            {t('contract.identifierResyncOpen', { code: c.contract_code })}
            <ExternalLink size={12} />
          </Link>
        ))}
      </div>
    </div>
  );
}
