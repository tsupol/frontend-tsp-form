import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiClient, ApiError } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';

// ข้อความ + เบอร์ Lost Mode (UI_SUMMARY/157, mig 1608). The branch form and the
// fund's company settings edit the same two fields under the same rules, so the
// draft lives here. The screen never builds the sentence or picks the phone:
// it shows `*_effective` or the preview answer, nothing else (157 §5).

export type LostModeTarget = { branchId: number } | { companyId: number };

export interface LostModeValues {
  lost_mode_message: string | null;
  lost_mode_phone: string | null;
  lost_mode_message_effective: string | null;
  lost_mode_phone_effective: string | null;
}

export interface LostModePreview {
  message: string;
  phone_number: string | null;
  phone_missing: boolean;
  footnote: string | null;
  footnote_is_sample: boolean;
}

type LostModeField = 'message' | 'phone';

function targetParams(target: LostModeTarget) {
  return 'branchId' in target ? { p_branch_id: target.branchId } : { p_company_id: target.companyId };
}

/** Which field a refusal belongs under (157 §6). Anything else has no field. */
function fieldOfError(code: string): LostModeField | null {
  const c = code.toUpperCase();
  if (c === 'CORE.VALIDATION.LOST_MODE_MESSAGE_TOO_LONG' || c === 'CORE.VALIDATION.LOST_MODE_MESSAGE_HAS_PHONE') return 'message';
  if (c === 'CORE.VALIDATION.LOST_MODE_PHONE_INVALID') return 'phone';
  return null;
}

export function useLostModeDraft({ target, values, editable, seedKey }: {
  target: LostModeTarget | null;
  values: LostModeValues | null;
  /** false = shops under a fund: preview only, a draft would be refused. */
  editable: boolean;
  /** Re-seeds the fields when it changes. null = the form is closed, keep what is on screen. */
  seedKey: string | number | null;
}) {
  const { t } = useTranslation();
  const initialMessage = values?.lost_mode_message_effective ?? '';
  const initialPhone = (values?.lost_mode_phone_effective ?? '').replace(/\D/g, '');

  const [message, setMessageState] = useState('');
  const [phone, setPhoneState] = useState('');
  const [messageError, setMessageError] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const [generalError, setGeneralError] = useState('');
  const [previewing, setPreviewing] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  // Kept after closing so the picture does not blank out during the exit transition.
  const [previewData, setPreviewData] = useState<LostModePreview | null>(null);

  const clearErrors = () => { setMessageError(''); setPhoneError(''); setGeneralError(''); };

  const revert = () => {
    setMessageState(initialMessage);
    setPhoneState(initialPhone);
    clearErrors();
  };

  useEffect(() => {
    if (seedKey == null) return;
    revert();
    setPreviewOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedKey, initialMessage, initialPhone]);

  const messageChanged = editable && message.trim() !== initialMessage.trim();
  const phoneChanged = editable && phone !== initialPhone;
  const isDirty = messageChanged || phoneChanged;

  // Only what the user touched: an omitted field is left alone by the RPC, '' sends it back to the default.
  const changes = {
    ...(messageChanged ? { p_message: message.trim() } : {}),
    ...(phoneChanged ? { p_phone: phone } : {}),
  };

  const showError = (err: unknown) => {
    clearErrors();
    if (!(err instanceof ApiError)) { setGeneralError(String(err)); return; }
    const text = translateApiError(err, t) || err.message;
    const field = fieldOfError(err.code);
    if (field === 'message') setMessageError(text);
    else if (field === 'phone') setPhoneError(text);
    else setGeneralError(text);
  };

  const preview = async () => {
    if (!target) return;
    clearErrors();
    setPreviewing(true);
    try {
      const data = await apiClient.rpc<LostModePreview>('fn_lost_mode_preview', { ...targetParams(target), ...changes });
      setPreviewData(data);
      setPreviewOpen(true);
    } catch (err) {
      showError(err);
    } finally {
      setPreviewing(false);
    }
  };

  /** Writes the changed fields. Refusals land under their field, then rethrow so the caller stops. */
  const save = async () => {
    if (!target || !isDirty) return;
    clearErrors();
    try {
      await apiClient.rpc(
        'branchId' in target ? 'fn_branch_lost_mode_set' : 'fn_company_lost_mode_set',
        { ...targetParams(target), ...changes },
      );
    } catch (err) {
      showError(err);
      throw err;
    }
  };

  return {
    message,
    phone,
    setMessage: (v: string) => { setMessageState(v); setMessageError(''); },
    setPhone: (v: string) => { setPhoneState(v); setPhoneError(''); },
    // Nothing stored: the starting value IS the default, so go back to it.
    // Something stored: empty, which saves as '' and the system fills the default.
    resetMessage: () => { setMessageState(values?.lost_mode_message == null ? initialMessage : ''); setMessageError(''); },
    resetPhone: () => { setPhoneState(values?.lost_mode_phone == null ? initialPhone : ''); setPhoneError(''); },
    messageIsDefault: message.trim() === '' || (values?.lost_mode_message == null && !messageChanged),
    phoneIsDefault: phone === '' || (values?.lost_mode_phone == null && !phoneChanged),
    canResetMessage: message.trim() !== '' && (values?.lost_mode_message != null || messageChanged),
    canResetPhone: phone !== '' && (values?.lost_mode_phone != null || phoneChanged),
    messageError,
    phoneError,
    generalError,
    isDirty,
    revert,
    preview,
    previewing,
    previewOpen,
    previewData,
    closePreview: () => setPreviewOpen(false),
    save,
  };
}

export type LostModeDraft = ReturnType<typeof useLostModeDraft>;
