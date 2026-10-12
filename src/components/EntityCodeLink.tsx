// A code (contract, bill, fund document, payment request, …) shown as a link to
// the page that opens it. One component so every screen links a code the same
// way and — the reason it exists — as a real <a>, which a plain button calling
// navigate() is not: only an <a href> gives the browser something to ctrl-click,
// middle-click, hover for the address, or copy. The project rule
// (.claude/tsp-form-guide-here.md "Anything that opens another page honours
// ctrl/middle click") applies to every code on screen; this makes following it
// the default instead of something each caller has to remember.
//
// No target → plain text (a code with nowhere to go is not a link). Inside a
// clickable row, pass stopPropagation so the link wins the click.
import type { ReactNode, MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import { formatEntityCode } from '../lib/format';

interface EntityCodeLinkProps {
  /** Where the code opens. Null renders the code as plain text. */
  to: string | null | undefined;
  /** The raw code; run through formatEntityCode for display. */
  code: string | null | undefined;
  /** Trailing icon. Defaults to ExternalLink; pass null for none. */
  icon?: ReactNode;
  /** Icon size, matched to the text size. */
  iconSize?: number;
  /** Placeholder when there is no code at all. */
  fallback?: string;
  /** Extra classes on the link / span (sizing, weight, truncate). */
  className?: string;
  /** Stop a parent row's onClick from also firing. */
  stopPropagation?: boolean;
}

export function EntityCodeLink({
  to,
  code,
  icon,
  iconSize = 12,
  fallback = '—',
  className,
  stopPropagation,
}: EntityCodeLinkProps) {
  const label = code ? formatEntityCode(code) : fallback;
  const end = icon === undefined ? <ExternalLink size={iconSize} className="shrink-0" /> : icon;

  if (!to || !code) {
    return <span className={className}>{label}</span>;
  }

  return (
    <Link
      to={to}
      onClick={stopPropagation ? (e: MouseEvent) => e.stopPropagation() : undefined}
      className={`text-primary-fg hover:underline inline-flex items-center gap-1 ${className ?? ''}`}
    >
      {label}
      {end}
    </Link>
  );
}
