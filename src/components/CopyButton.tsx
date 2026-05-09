import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Check } from 'lucide-react';

interface Props {
  value: string;
  size?: number;
  className?: string;
}

export function CopyButton({ value, size = 14, className }: Props) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const handleClick = () => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`p-1 rounded hover:bg-surface-hover transition-colors cursor-pointer text-subtle hover:text-fg ${className ?? ''}`}
      aria-label={t('common.copy')}
      title={copied ? t('common.copied') : t('common.copy')}
    >
      {copied ? <Check size={size} className="text-success" /> : <Copy size={size} />}
    </button>
  );
}
