# tsp-form — Project-Specific Patterns

Supplements `C:\Users\tonsu\.claude\tsp-form-guide.md` with patterns specific to this project.

## Never use native HTML controls

- **Checkbox:** Never use `<input type="checkbox">`. Use `Checkbox` or `LabeledCheckbox` from tsp-form.
- **Number input:** Never use `<input type="number">`. Use `MaskedInput mask="number"` from tsp-form.
- **Phone input:** Never use plain `Input` for phone numbers. Use `MaskedInput` with `dynamicMask={thaiPhoneMask}`:
  ```ts
  const thaiPhoneMask = (digits: string) => {
    if (digits.startsWith('02')) return '##-###-####';
    const prefix = digits.slice(0, 2);
    if (['03','04','05','07'].includes(prefix)) return '###-###-###';
    return '###-###-####'; // mobile 06x, 08x, 09x
  };
  ```

## Display formatting

For **read-only display** of phone numbers and citizen IDs, use the global formatters from `src/lib/format.ts`:
- `formatTel(tel)` → `0xx-xxx-xxxx` or `0x-xxx-xxxx`
- `formatCid(cid)` → `X-XXXX-XXXXX-XX-X`

## MaskedInput for numeric fields

- **Price/amount fields (THB):** `mask="number" decimalScale={2}` — no prefix, no placeholder
- **Percentage fields:** `mask="number" decimalScale={1} suffix="%"` — no placeholder (suffix provides context)
- **Integer fields (term months, rounding unit):** `mask="number" decimalScale={0}` — placeholder OK for hints like "12"

When using `MaskedInput` with `react-hook-form`, use `Controller` (not `register`) since `onChange` returns `(raw, formatted)`.

## InputDatePicker — always include typing mode

Every `InputDatePicker` must include:
- `dateFormat={makeDatePickerFormat(i18n.language)}` from `src/lib/format.ts`
- `locale={i18n.language}` and `calendar="gregorian"`
- Typing mode: `typingMode`, `onTypingModeChange`, `typingMask="##/##/####"`, `typingPlaceholder="DD/MM/YYYY"`
- `parseTypedDate` with Buddhist Era support (`if (year > 2400) year -= 543`)
- `endIcon={<Keyboard size={16} />}` with `onEndIconClick` to toggle typing mode

For `InputDateRangePicker`, use `makeDateRangePickerFormat` and `parseTypedDates` (returns `{ from, to }`).

## List row interaction

- **No edit icon button** on desktop list rows — single click opens the editor/detail panel
- Mobile: single tap navigates to detail panel
