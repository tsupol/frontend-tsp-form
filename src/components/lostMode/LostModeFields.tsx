import { useTranslation } from 'react-i18next';
import { Button, FormErrorMessage, TextArea } from 'tsp-form';
import { Smartphone } from 'lucide-react';
import { PhoneInput } from '../PhoneInput';
import { formatTel } from '../../lib/format';
import type { LostModeDraft } from './useLostModeDraft';

const MESSAGE_MAX = 100;

function ResetLink({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-xs text-primary-fg hover:underline bg-transparent border-none p-0 cursor-pointer"
    >
      {t('lostMode.resetDefault')}
    </button>
  );
}

/** The two editable fields. Validation is the backend's: errors come from preview or save. */
export function LostModeFields({ draft, phoneEmptyHint, disabled }: {
  draft: LostModeDraft;
  /** What an empty phone falls back to — differs between a branch and a fund. */
  phoneEmptyHint: string;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const count = draft.message.trim().length;
  return (
    <>
      <div className="flex flex-col">
        <div className="flex items-baseline justify-between gap-2">
          <label className="form-label">{t('lostMode.message')}</label>
          <div className="flex items-baseline gap-3 shrink-0">
            {draft.canResetMessage && <ResetLink onClick={draft.resetMessage} />}
            <span className={`text-xs tabular-nums ${count > MESSAGE_MAX ? 'text-danger-fg' : 'text-subtler'}`}>
              {count}/{MESSAGE_MAX}
            </span>
          </div>
        </div>
        <TextArea
          value={draft.message}
          onChange={(e) => draft.setMessage(e.target.value)}
          rows={2}
          className="w-full"
          disabled={disabled}
          error={!!draft.messageError}
        />
        {draft.messageError
          ? <FormErrorMessage error={{ message: draft.messageError }} />
          : (
            <span className="text-xs text-subtler mt-1">
              {draft.messageIsDefault ? t('lostMode.usesDefault') : t('lostMode.messageHint')}
            </span>
          )}
      </div>
      <div className="flex flex-col">
        <div className="flex items-baseline justify-between gap-2">
          <label className="form-label">{t('lostMode.phone')}</label>
          {draft.canResetPhone && <ResetLink onClick={draft.resetPhone} />}
        </div>
        <PhoneInput
          value={draft.phone}
          onChange={(raw) => draft.setPhone(raw)}
          size="md"
          className="w-full"
          disabled={disabled}
          error={!!draft.phoneError}
        />
        {draft.phoneError
          ? <FormErrorMessage error={{ message: draft.phoneError }} />
          : (
            <span className="text-xs text-subtler mt-1">
              {draft.phoneIsDefault ? `${t('lostMode.usesDefault')} · ${phoneEmptyHint}` : phoneEmptyHint}
            </span>
          )}
      </div>
    </>
  );
}

export function LostModePreviewButton({ draft, disabled }: { draft: LostModeDraft; disabled?: boolean }) {
  const { t } = useTranslation();
  return (
    <Button
      size="sm"
      variant="outline"
      startIcon={<Smartphone size={14} />}
      onClick={draft.preview}
      disabled={disabled || draft.previewing}
    >
      {draft.previewing ? t('common.loading') : t('lostMode.preview')}
    </Button>
  );
}

/** A shop under a fund: the fund's values, no inputs and no save (157 §1a). */
export function LostModeReadOnly({ message, phone }: { message: string | null; phone: string | null }) {
  const { t } = useTranslation();
  return (
    <>
      <div className="flex flex-col">
        <span className="form-label">{t('lostMode.message')}</span>
        <span className="text-sm pl-1">{message ?? '—'}</span>
      </div>
      <div className="flex flex-col">
        <span className="form-label">{t('lostMode.phone')}</span>
        <span className="text-sm tabular-nums pl-1">{formatTel(phone)}</span>
      </div>
      <span className="text-xs text-subtler">{t('lostMode.setAtFund')}</span>
    </>
  );
}
