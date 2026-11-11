import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Button } from 'tsp-form';
import { ExternalLink, MessageCircle } from 'lucide-react';
import { useChatDock } from '../../contexts/ChatDockContext';
import { collectorColor, situationColor, situationText } from '../../lib/situation';
import { SimWindow } from './SimWindow';
import type { PersonPick } from './SimulationScene';
import type { WindowStack } from './useWindowStack';
import {
  ageText, assetOf, baht, codeOf, downPct, flagColor, gradeLabel, plainNum, stateColor, stateLabel, termsOf,
  type SimBranch, type SimChat, type SimWaiting,
} from './simulationTypes';

/** A contract that isn't signed yet, as lines (NOTICE 1635 §1): the same lines as an opened
 *  contract, led by a flag in the person's status colour, ending with how long it has waited.
 *  A part whose field is 0 / "" (not priced yet) is left out. Used by the shop card's list and
 *  by the person window, so the two always say the same. */
export function SimWaitingLines({ w, isFund }: { w: SimWaiting; isFund: boolean }) {
  const { t } = useTranslation();
  const asset = assetOf(w.asset, w.serial ?? '');
  const grade = w.grade ? gradeLabel(t, w.grade) : '';
  const financed = isFund && w.financed ? `${t('simulation.financedShort')} ${baht(w.financed)}` : '';
  const terms = termsOf({ code: w.code, months: w.months, down: w.down ?? 0, installment: w.installment ?? 0 });
  return (
    <div className="sim__opened sim__opened--wait" data-testid="sim-waiting-row">
      <b><span className="sim__flag" style={{ background: flagColor(stateColor(w.state)) }}>{stateLabel(t, w.state)}</span>{w.product || '—'}</b>
      <span>{[grade, financed].filter(Boolean).join(' · ')}</span>
      {isFund && !!w.sale_price && (
        <small>{t('simulation.saleUplift', { sale: plainNum(w.sale_price), uplift: plainNum(w.uplift ?? 0) })}</small>
      )}
      <small>{isFund && w.down_pct != null ? `${terms} · ${t('simulation.downShort')} ${downPct(w.down_pct)}` : terms}</small>
      <small>{[asset, t('simulation.waitedFor', { age: ageText(t, w.age_min) })].filter(Boolean).join(' · ')}</small>
    </div>
  );
}

/**
 * The window a tapped person opens (owner 11-11) — like a shop opens its card: draggable,
 * remembered spot, several windows at once, the floor stays usable. It says what the tooltip
 * says in full and gives the way out: a waiting customer's contract page (new tab, so this
 * picture stays as it was), a chat customer's room (the floating chat window) and contract.
 * When the person leaves the picture (contract moved on, chat read) the window keeps the last
 * figures and says so, rather than vanishing under the reader.
 */
export function SimPersonWindow({ person, waiting, chat, branches, isFund, stack, onClose }: {
  person: PersonPick;
  waiting: SimWaiting | undefined;
  chat: SimChat | undefined;
  branches: SimBranch[];
  isFund: boolean;
  stack: WindowStack;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { openChat } = useChatDock();

  // The last row seen for this person, kept once they leave the live data.
  const last = useRef<{ key: string; waiting?: SimWaiting; chat?: SimChat } | null>(null);
  const key = `${person.kind}:${person.id}`;
  if (waiting || chat) last.current = { key, waiting, chat };
  const held = last.current?.key === key ? last.current : null;
  const w = waiting ?? held?.waiting;
  const c = chat ?? held?.chat;
  const gone = !waiting && !chat;

  const branchId = w?.branch_id ?? c?.branch_id;
  const branch = branches.find(b => b.id === branchId);
  const code = w ? codeOf(w.code, w.months) : c?.code ?? '';

  const contractLink = (
    <Link to={`/admin/contracts/search/${person.id}`} target="_blank" rel="noreferrer"
      className="btn btn-outline-default btn-sm inline-flex items-center gap-1.5 no-underline" data-testid="sim-person-open-contract">
      {t('simulation.openContract')}<ExternalLink size={14} />
    </Link>
  );

  return (
    <SimWindow id="person" stack={stack} onClose={onClose} className="sim__person" data-testid="sim-person-window"
      head={<h3>{code}{branch && <small>{branch.name}</small>}</h3>}>
      {gone && <p className="sim__person-gone">{t(person.kind === 'chat' ? 'simulation.person.goneChat' : 'simulation.person.goneWait')}</p>}

      {person.kind === 'wait' && w && <SimWaitingLines w={w} isFund={isFund} />}

      {person.kind === 'chat' && c && (
        <>
          <p className="sim__person-sit">
            <span className="sim__flag" style={{ background: flagColor(situationColor(c.situation_code)) }}>
              {situationText(t, c.situation_code ?? null, c.overdue_days)}
            </span>
          </p>
          <dl>
            <dt>{t('simulation.person.unread')}</dt><dd>{c.unread}</dd>
            <dt>{t('simulation.person.waited')}</dt><dd>{ageText(t, c.age_min)}</dd>
            {c.collector_name && (
              <><dt>{t('simulation.person.collector')}</dt><dd style={{ color: collectorColor(c.situation_code) }}>{c.collector_name}</dd></>
            )}
          </dl>
        </>
      )}

      <div className="sim__person-actions">
        {person.kind === 'chat' && (
          <Button size="sm" color="primary" startIcon={<MessageCircle size={14} />} onClick={() => openChat(person.id)} data-testid="sim-person-open-chat">
            {t('simulation.openChat')}
          </Button>
        )}
        {contractLink}
      </div>
    </SimWindow>
  );
}
