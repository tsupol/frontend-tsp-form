// "อัปเดต 15 พ.ย. 19:57" at the end of a scene's toolbar. When the row has room it reads as text;
// when it would drop onto a line of its own, it folds into an icon whose tooltip says the same
// (owner 11-15). The check is measured, not a breakpoint: the room left after the last button
// in the row against the text's own width.

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Tooltip } from 'tsp-form';
import { AlertTriangle, Info } from 'lucide-react';
import { DateTime } from '../../../components/DateTime';

export function UpdatedStatus({ error, fetching, updatedAt, extra }: {
  error: boolean;
  fetching: boolean;
  /** ms epoch of the last good answer, 0 = none yet. */
  updatedAt: number;
  /** Shown after the status either way (e.g. a reload button). */
  extra?: ReactNode;
}) {
  const { t } = useTranslation();
  const wrap = useRef<HTMLDivElement>(null);
  const probe = useRef<HTMLSpanElement>(null);
  const extraRef = useRef<HTMLSpanElement>(null);
  const [compact, setCompact] = useState(false);

  const text = error
    ? <span className="text-warning-fg inline-flex items-center gap-1"><AlertTriangle size={13} /><span className="dq-shift">{t('dunningQueue.refreshFailed')}</span></span>
    : updatedAt
      ? <span className={`dq-shift${fetching ? ' opacity-60' : ''}`}>{t('dunningQueue.updatedAt')} <DateTime value={new Date(updatedAt).toISOString()} /></span>
      : null;

  useLayoutEffect(() => {
    const el = wrap.current;
    const bar = el?.parentElement;
    if (!el || !bar) return;
    const check = () => {
      const prev = el.previousElementSibling as HTMLElement | null;
      if (!prev) { setCompact(false); return; }
      const extraW = extraRef.current?.offsetWidth ?? 0;
      const need = (probe.current?.offsetWidth ?? 0) + (extraW ? extraW + 8 : 0);
      const bs = getComputedStyle(bar);
      const room = bar.getBoundingClientRect().right - parseFloat(bs.paddingRight) - prev.getBoundingClientRect().right - parseFloat(bs.columnGap || '0');
      setCompact(need > room);
    };
    check();
    // The bar's width and every button in it: a count growing or a button hiding moves the room.
    const ro = new ResizeObserver(check);
    ro.observe(bar);
    for (const child of Array.from(bar.children)) if (child !== el) ro.observe(child);
    return () => ro.disconnect();
  }, [error, updatedAt]);

  return (
    <div ref={wrap} className="dq-updated inline-flex items-center gap-2">
      {/* Off-screen copy of the text, always laid out, so its width is known in both modes. */}
      <span ref={probe} className="dq-updated-probe" aria-hidden>{text}</span>
      <span data-status>
        {compact && text
          ? (
            <Tooltip content={text}>
              <Button size="sm" variant="ghost" aria-label={error ? t('dunningQueue.refreshFailed') : t('dunningQueue.updatedAt')}
                startIcon={error ? <AlertTriangle size={14} className="text-warning-fg" /> : <Info size={14} />} />
            </Tooltip>
          )
          : text}
      </span>
      {extra && <span ref={extraRef} className="inline-flex">{extra}</span>}
    </div>
  );
}
