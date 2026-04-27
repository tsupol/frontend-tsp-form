import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { InputDatePicker, type InputDatePickerProps } from 'tsp-form';
import { Keyboard } from 'lucide-react';
import { makeDatePickerFormat } from '../lib/format';

type DatePickerProps = Omit<
  InputDatePickerProps,
  'typingMode' | 'onTypingModeChange' | 'typingMask' | 'typingPlaceholder' | 'parseTypedDate' | 'endIcon' | 'onEndIconClick' | 'locale' | 'calendar' | 'dateFormat'
>;

const parseTypedDate = (raw: string): Date | null => {
  if (raw.length !== 8) return null;
  const day = parseInt(raw.slice(0, 2), 10);
  const month = parseInt(raw.slice(2, 4), 10);
  let year = parseInt(raw.slice(4, 8), 10);
  if (year > 2400) year -= 543; // Buddhist Era → Gregorian
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return d;
};

/**
 * Project-standard DatePicker — wraps tsp-form's InputDatePicker with
 * typing mode, locale, calendar, and dateFormat baked in.
 */
export function DatePicker(props: DatePickerProps) {
  const { i18n } = useTranslation();
  const [isTyping, setIsTyping] = useState(false);

  return (
    <InputDatePicker
      {...props}
      locale={i18n.language}
      calendar="gregorian"
      dateFormat={makeDatePickerFormat(i18n.language)}
      endIcon={<Keyboard size={16} />}
      onEndIconClick={() => setIsTyping(t => !t)}
      typingMode={isTyping}
      onTypingModeChange={setIsTyping}
      typingMask="##/##/####"
      typingPlaceholder="DD/MM/YYYY"
      parseTypedDate={parseTypedDate}
    />
  );
}
