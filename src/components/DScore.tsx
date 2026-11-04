// D-score: the backend's 0–5 rating in half steps, drawn as five stars. The number always
// comes from a view or RPC (UI_SUMMARY/158) — never work it out here, and never
// say what it is calculated from: the owner asked for the name only, no tooltip,
// no legend. Null means "no plan yet" and draws nothing; 0 is a real score and
// draws five unlit stars.

import { Star } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const STARS = [1, 2, 3, 4, 5];

export function DScoreStars({ score, size = 14 }: { score: number | null | undefined; size?: number }) {
  const { t } = useTranslation();
  if (score == null) return null;
  // Half steps since mig 1611. The view sends 2.0 and an RPC sends 2, so read it
  // as a number and never compare it as text.
  const value = Number(score);
  return (
    <span role="img" aria-label={`${t('dScore.label')} ${value}/5`} className="inline-flex items-center gap-0.5 align-middle shrink-0">
      {STARS.map(n => {
        if (n - 0.5 === value) {
          // Yellow on the left half, black on the right.
          return (
            <span key={n} className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
              <Star size={size} className="d-score-star-off" />
              <Star size={size} className="d-score-star-on absolute inset-0" style={{ clipPath: 'inset(0 50% 0 0)' }} />
            </span>
          );
        }
        return <Star key={n} size={size} className={n <= value ? 'd-score-star-on' : 'd-score-star-off'} />;
      })}
    </span>
  );
}

/** "D-score ★★★☆☆" on one line, for a row that has no label of its own. */
export function DScoreLine({ score, size = 12, label }: {
  score: number | null | undefined;
  size?: number;
  /** Replaces the plain name, where two scores sit side by side. */
  label?: string;
}) {
  const { t } = useTranslation();
  if (score == null) return null;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-subtle whitespace-nowrap">
      {label ?? t('dScore.label')}
      <DScoreStars score={score} size={size} />
    </span>
  );
}
