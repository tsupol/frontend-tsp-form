// Simulation-only number marks (owner 11-07). Not tsp-form's Badge on purpose: a badge pads its
// text, so a bigger number made a bigger, louder pill. Here only the number sits in a box that hugs
// the digits; the word stays outside in plain text.
//
// Both take the translated sentence the screen already had ("ค้าง {{n}}", "{{n}} รอตรวจ") and split it
// around the number, so word order follows each language and no new keys are needed.

const MARK = '⁣';

function splitAround(label: (n: string) => string) {
  const [before = '', after = ''] = label(MARK).split(MARK);
  return [before.trim(), after.trim()] as const;
}

export type TileKind = 'stale' | 'chat' | 'wait';

/** A1 · small solid number tile + the word beside it. 0 turns slate whatever the kind. */
export function SimTile({ n, kind, label }: { n: number; kind: TileKind; label: (n: string) => string }) {
  const [before, after] = splitAround(label);
  return (
    <i className={`sim__tile sim__tile--${n === 0 ? 'zero' : kind}`} data-n={n}>
      {before && <span className="sim__tile-w">{before}</span>}
      <b><span>{n}</span></b>
      {after && <span className="sim__tile-w">{after}</span>}
    </i>
  );
}

/** B · the contract count as a fixed-width score column on a shop tag's left edge. */
export function SimScore({ n, label }: { n: number; label: (n: string) => string }) {
  const [before, after] = splitAround(label);
  return (
    <span className={`sim__score${n === 0 ? ' sim__score--zero' : ''}`} data-deals={n}>
      <b data-d={String(n).length}>{n}</b>
      <i>{before || after}</i>
    </span>
  );
}
