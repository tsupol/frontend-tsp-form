import { useTranslation } from 'react-i18next';
import type { RepoState } from './queueApi';
import { REPO_LOOK } from './repoLook';

/** The round chip in the row over a head (same size as the relief hourglass). */
export function RepoBadge({ state }: { state: RepoState }) {
  const { t } = useTranslation();
  if (state === 'NONE') return null;
  const { color, Icon } = REPO_LOOK[state];
  return (
    <i className="dq-tag-repo" style={{ background: color }} aria-label={t(`dunningQueue.repoState.${state}`)}>
      <Icon size={9} strokeWidth={2.6} />
    </i>
  );
}

/** Chip + words, for the legend and the work panel. */
export function RepoLabel({ state }: { state: RepoState }) {
  const { t } = useTranslation();
  if (state === 'NONE') return null;
  const { color, Icon } = REPO_LOOK[state];
  return (
    <span className="dq-repo-label" style={{ color }}>
      <i className="dq-tag-repo" style={{ background: color }}><Icon size={9} strokeWidth={2.6} /></i>
      {t(`dunningQueue.repoState.${state}`)}
    </span>
  );
}
