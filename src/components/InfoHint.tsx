import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Info } from 'lucide-react';
import { PopOver } from 'tsp-form';

/* ───────────────────────────────────────────────────────────────────────────
 * InfoHint — the small ⓘ next to a figure or badge the screen cannot explain
 * by itself ("where does this come from / what happens next").
 *
 * Click / tap opens it and it stays until a click elsewhere or Esc — never
 * hover: a hover popover vanishes the moment the pointer leaves the icon for
 * the text or the link inside it (Ton 2026-10-31), and the iPad has no hover
 * anyway. One answer line in bold, up to three short lines under it, an
 * optional link as the last line.
 *
 * Put one only where the screen does not already say it — a card that carries
 * an inline "ยังไม่บังคับ" band needs no ⓘ on top.
 * ─────────────────────────────────────────────────────────────────────────── */

export type InfoHintProps = {
  /** The answer, one line. */
  title: ReactNode;
  /** Up to three short expansion lines. */
  lines?: ReactNode[];
  /** Where to go next, if there is a place. */
  link?: { to: string; label: ReactNode };
  placement?: 'bottom' | 'top' | 'left' | 'right';
  align?: 'start' | 'center' | 'end';
  /** Icon size in px (default 14). */
  size?: number;
  className?: string;
};

export function InfoHint({ title, lines, link, placement = 'bottom', align = 'start', size = 14, className = '' }: InfoHintProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <PopOver
      isOpen={open}
      onClose={close}
      placement={placement}
      align={align}
      maxWidth="320px"
      minWidth="200px"
      maxHeight="400px"
      triggerClassName={`inline-flex ${className}`}
      trigger={
        <button
          type="button"
          aria-label={t('common.moreInfo')}
          aria-expanded={open}
          className="inline-flex items-center justify-center rounded-full cursor-pointer text-subtle hover:text-fg focus-visible:outline-2 focus-visible:outline-primary"
          onClick={(e) => {
            // The ⓘ often sits inside a clickable card — the card must not open.
            e.stopPropagation();
            e.preventDefault();
            setOpen((v) => !v);
          }}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') e.stopPropagation(); }}
        >
          <Info size={size} />
        </button>
      }
    >
      <div className="px-3 py-2.5 text-sm flex flex-col gap-1.5" onClick={(e) => e.stopPropagation()}>
        <div className="font-medium leading-snug">{title}</div>
        {lines && lines.length > 0 && (
          <ul className="list-disc pl-4 text-xs text-subtle flex flex-col gap-0.5 leading-snug">
            {lines.map((l, i) => <li key={i}>{l}</li>)}
          </ul>
        )}
        {link && (
          <Link to={link.to} className="text-xs text-primary-fg hover:underline self-start" onClick={close}>
            {link.label} →
          </Link>
        )}
      </div>
    </PopOver>
  );
}
