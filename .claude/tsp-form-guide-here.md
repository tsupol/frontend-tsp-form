p# tsp-form — Project-Specific Patterns

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

## Auto-fill end-icon (`>>`)

When an input can be auto-filled from a related value (e.g. catalog price, default amount, suggested value), put a clickable `ChevronsRight` end-icon on the input. Click = fill the field with the suggested value.

- **Icon:** `<ChevronsRight size={14} />` from `lucide-react` — looks like `»`
- **Usage:**
  ```tsx
  <CurrencyInput
    value={cost}
    onChange={setCost}
    endIcon={suggested !== null ? <ChevronsRight size={14} /> : undefined}
    onEndIconClick={suggested !== null ? () => setCost(String(suggested)) : undefined}
  />
  ```
- **Hide when no suggestion:** pass `undefined` for both `endIcon` and `onEndIconClick` — don't show a disabled icon.
- **Reference uses:** `DayClosePage`, `ContractActions`, `RetailBillsPage`, `CompleteContractModal`, `CreateRetailBillModal`, `CardPayment`, `PanelReviewPay`, `PurchaseOrdersPage` (add-line modal).

Don't substitute `Wand2`, `Sparkles`, `RefreshCw`, etc. — keep the convention.

## Clearable filter Select — empty-string convention

This project uses **Shape B** (empty-string sentinel) for filter Selects, not `T | null`. Match it everywhere so filter wiring is consistent across pages.

```tsx
const [filterBrand, setFilterBrand] = useState<string>('');

<Select
  options={brandOptions}
  value={filterBrand || null}
  onChange={(val) => { setFilterBrand((val as string) ?? ''); setPageIndex(0); }}
  placeholder={t('pricing.brand')}
  size="sm"
  showChevron
  clearable
/>
```

- State is `useState<string>('')` — empty string = no filter applied.
- `value={filterBrand || null}` — coerce `''` → `null` so the Select renders the placeholder, not a phantom blank option.
- `onChange={(val) => setX((val as string) ?? '')}` — clearing yields `''`, never `'ALL'` / `'ANY'` / any sentinel value.
- Always set `placeholder` to the cleared-state label ("All brands", "All statuses").
- In the query builder, only push the param when truthy: `if (filterBrand) params.push(\`brand_id=eq.${filterBrand}\`)`.

**Do not** invent a sentinel like `'ALL'`. It produces a Select that looks broken when cleared (× button visible with no apparent value) and forces ugly `value={x === 'ALL' ? null : x}` mappings. The empty string is the cleared state — let the placeholder name it.

Reference implementations: `src/pages/pricing/PricebookPage.tsx` (brand / family / base-model filters), `src/pages/call-center/TicketQueuePage.tsx` (mode filter).

**Sort Selects are not clearable.** A sort selector always needs a value — omit `clearable` and don't add a "no sort" option.

## List row interaction

- **No edit icon button** on desktop list rows — single click opens the editor/detail panel
- Mobile: single tap navigates to detail panel

## Color tokens — never fake a shade with `/opacity`

The theme defines the muted ramps. Use the named token; never punch alpha on a color (`text-subtle/70`, `bg-primary/15`).

- **Muted text:** `text-subtle` (primary muted) → `text-subtler` (lighter). That's the whole ramp — there is no `text-muted`.
- **Muted/tinted background:** every color has a `-soft` token — `bg-primary-soft`, `bg-danger-soft`, `bg-success-soft`, `bg-warning-soft`, `bg-info-soft`, `bg-surface-soft`. Use these for soft fills, never `bg-{color}/15`.
- `text-fg/NN` (dimming the foreground for disabled placeholders / faint icons) is the one accepted opacity use — it's not a named-token case.

## Inline links

Inline navigation links (clickable codes, IDs, references that route to another page) use **`text-primary-fg hover:underline`**. Never use `text-primary` — that's the brand fill color, not the link color.

```tsx
<button
  type="button"
  onClick={() => navigate(`/admin/contracts/search/${c.id}`)}
  className="text-sm font-medium text-primary-fg hover:underline inline-flex items-center gap-1 bg-transparent border-none p-0 cursor-pointer"
>
  {c.code_display}
  <ExternalLink size={12} />
</button>
```

- Pair with a trailing `<ExternalLink size={12} />` when the target opens a different section/page so the affordance is obvious.
- Don't substitute a separate icon `<Button>` next to a non-link label — make the label itself the link. Saves a column of action buttons in dense tables/lists.
