import { ExternalLink } from 'lucide-react';
import { contactHref } from '../lib/contactLink';

/**
 * A customer contact value as it reads on screen: a web address (Facebook
 * page, LINE link…) is a link that opens in a new tab; anything else is plain
 * text. `text` overrides what is shown (e.g. a label) while the value stays
 * the address.
 */
export function ContactValue({ value, text, className = '' }: {
  value: string;
  text?: string;
  className?: string;
}) {
  const href = contactHref(value);
  if (!href) return <span className={`truncate ${className}`}>{text ?? value}</span>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      // Rows around contacts are often clickable themselves.
      onClick={(e) => e.stopPropagation()}
      className={`min-w-0 inline-flex items-center gap-1 text-primary-fg hover:underline ${className}`}
    >
      <span className="truncate">{text ?? value}</span>
      <ExternalLink size={12} className="shrink-0" />
    </a>
  );
}
