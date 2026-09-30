# tsp-form — Project-Specific Patterns

Supplements `C:\Users\tonsu\.claude\tsp-form-guide.md` with patterns specific to this project:
conventions on top of library components, and the project's own components built on tsp-form
(`ActionDoneView`, `ModalErrorBand`, `BranchPinInput`, backend-driven action footers).
Both files are injected together by the global tsp-form hook on the first `.tsx`/`.css` edit
of a session. Page-level nav guarding is its own doc (`.claude/nav-guard-pattern.md`).

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
- **Hide when no suggestion:** pass `undefined` for both `endIcon` and `onEndIconClick` — don't show a disabled icon. This is for a suggestion that may not exist at all (no catalog price, no default).
- **Grey + tooltip when the fill waits on a sibling field** (a calculator: "term from installment", "installment from term"). The fill always exists, it just needs another field first, so hiding it would flicker as the user types and nobody learns the field can be derived. Keep the icon visible: live = `text-primary-fg` with the result previewed in the tooltip ("→ 14 months"); inert = `text-subtler cursor-not-allowed` with the tooltip naming the field to fill first. The icon slot is `pointer-events:none` unless clickable, so wrap the inert icon in a `pointer-events-auto` span for the tooltip to open. Reference: `PanelProductPlan` FIN2 calculator.
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

The theme defines the muted ramps. Use the named token; **never** punch alpha on a color — `text-subtle/70`, `bg-primary/15`, `text-fg/40` are all wrong. No exceptions, including `text-fg/NN`.

- **Muted text:** `text-subtle` (primary muted) → `text-subtler` (lighter). That's the whole ramp — there is no `text-muted`.
- **Muted/tinted background:** every color has a `-soft` token — `bg-primary-soft`, `bg-danger-soft`, `bg-success-soft`, `bg-warning-soft`, `bg-info-soft`, `bg-surface-soft`. Use these for soft fills, never `bg-{color}/15`.
- **`/NN` in existing code is wrong code, not a pattern.** It's pollution from past edits. When copying how something's done, ignore any `/NN` color and look elsewhere for the correct token.
- If a case truly seems to need `/NN`, stop and ask first — discouraged, not a normal path.

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

## Branch PIN input

Always use `<BranchPinInput>` (`src/components/BranchPinInput.tsx`) for any PIN authorization field — never raw `<Input type="password">`. It enforces 6-digit numeric input, shows password dots, and includes its own label + `FormErrorMessage`.

- Props: `value`, `onChange` (string), `label?` (defaults to `t('contract.pin')`), `required?`, `error?`, `disabled?`
- Usage: `<BranchPinInput value={pin} onChange={setPin} required />`

## API error display

For an API error shown in a form/modal, use `<div className="alert alert-danger">` with an `XCircle` icon — never a hand-rolled `bg-danger/10 border border-danger` div. (See the catch-block translation pattern under API error handling in the project CLAUDE.md.)

## ActionDoneView — the shared modal success view

`src/pages/contracts/ActionDoneView.tsx`. The one component every data-mutating
modal uses for its success step (the `view === 'done'` branch of the write-modal
checklist in `.claude/CLAUDE.md`; the pattern itself is "Form modals: success step
+ nav guard" in the global guide). Renders both the `modal-content` body and the
`modal-footer` — the host drops it inside its modal and stops there. Do NOT
hand-roll a success screen; use this so all modals look and behave the same.

**When:** any modal that creates/edits data, after the mutation resolves. Set
`view='done'`, stash the result, render `<ActionDoneView .../>` instead of the
form. The user reads the result and closes the modal themselves (never auto-close).

| prop | type | purpose |
|---|---|---|
| `headline` | string | big bold line, e.g. "Late fee collected". Translate it. |
| `contractCode` | string | subtitle under headline — contract/PO/asset code. |
| `tone` | `'success'｜'warning'｜'danger'｜'neutral'` | icon + accent. Default `success`. |
| `stateTransition` | `{from,to,fromColor?,toColor?}` | optional from→to badge pair (e.g. ACTIVE→TERMINATED). |
| `detailRows` | `{label,value,emphasis?}[]` | receipt-style key/value list. `emphasis` bolds the value. |
| `extras` | ReactNode | free slot below the rows (banners, lists). |
| `billId` | number｜null | **if set, the footer shows Download + Print bill-receipt buttons** (print uses `.claude/in-app-print-pattern.md`). Takes precedence over `secondaryAction`. |
| `secondaryAction` | `{label,onClick,startIcon?,endIcon?}` | one extra footer button (e.g. "Open PO"). Ignored if `billId` is set. |
| `doneLabel` | string | Done-button label override. Default `t('common.done')`. |
| `doneColor` | `'primary'｜'danger'` | Done-button color. Default `primary`. |
| `onClose` | () => void | **required** — closes the host modal. |

```tsx
{view === 'done' && result && (
  <ActionDoneView
    headline={t('lateFee.done')}
    contractCode={contractCode}
    billId={result.bill_id}          // → receipt Download + Print in footer
    detailRows={[
      { label: t('lateFee.collected'), value: fmtCurrency(amount) },
      { label: t('lateFee.netCharged'), value: fmtCurrency(net), emphasis: true },
    ]}
    onClose={forceClose}
  />
)}
```

Bill print works for any bill the print pattern can fetch — including bills that end
PAID via a ledger drain (no cash step), e.g. `fn_bill_late_fee_collect`.

Reference implementations: `ContractFeeModal.tsx` (cart, `billId`),
`LateFeeCollectModal.tsx` (single RPC, `billId` + waive rows). Copy either.

## ModalErrorBand — where a submit error goes

`src/components/ModalErrorBand.tsx`. The failure-side counterpart to
`ActionDoneView`: the one place a write-modal renders its submit error. Render it
**between** `.modal-content` and `.modal-footer` — a sibling, never a child of
`modal-content`:

```tsx
<div className="modal-content">…fields…</div>
<ModalErrorBand message={error} />
<div className="modal-footer">…buttons…</div>
```

Why not inside `modal-content`: it is the scrolling element (`overflow-y:auto; flex:1`)
between a static header and footer. An alert placed inside it scrolls with the form,
so on any modal taller than the viewport the error renders below the fold and the
modal does not scroll to it — the user presses Save and sees **nothing happen**.
Measured on CreateExpenseModal at 390×844 before the fix: error at y=966, content
viewport ending at 740, `scrollTop: 0`. After: y=694, flush above the footer, visible
at every scroll position. Putting it at the *top* of `modal-content` is not a fix
either — it scrolls away as soon as the user scrolls down, far from the button that
produced it.

| prop | type | purpose |
|---|---|---|
| `message` | string｜null | falsy renders nothing (no wasted space) |
| `variant` | `'danger'｜'warning'` | default `danger`; `warning` for known backend gaps |
| `onDismiss` | () => void | shows an × that clears the parent's error state. Omit for a non-dismissable band. Pass `() => setError(null)`. |

Translate the message before passing it — `translateApiError(err, t)` for
`ApiError`, per the API error handling rules in `.claude/CLAUDE.md`.

**Migration:** most modals still render `alert alert-danger` inline. Migrate a modal
to the band when you touch it for another reason; no bulk sweep.

## Detail-panel buttons are `size="sm"` — all of them

Every button inside a detail panel takes `size="sm"`: the action footer, the panel
header, and any action sitting in the panel body. No exceptions for the primary
action — a default-size button beside small ones is the mistake, not the emphasis.
Emphasis comes from `variant="primary"`, never from size.

Icons in those buttons are `size={14}` to match. (16 belongs to a default-size
button and looks oversized at sm.)

Repeatedly corrected. When adding or rebuilding a panel's actions, measure before
claiming done: every button in the panel should report the same height.

## Action button end-icons — `elsewhere`, `not_wired`, gated

Convention for backend-driven action footers (`ContractActions.tsx`,
`AssetsPage.tsx` — anything rendered from a `fn_*_available_actions` allowlist) so
users can tell at a glance which buttons do something *here*.

| Icon | Meaning | Tooltip line | When |
|------|---------|--------------|------|
| `<ExternalLink size={12} />` | **Lives elsewhere** | `Use: <where>` | Implemented on another tab/page. Keep the button (so users know the capability exists) but point them to the real surface. |
| `<Wrench size={12} />` | **Not yet wired** | `Not yet wired in this page` | In the allowlist but no FE handler/modal exists. Auto-applied to any allowlisted action missing from the page's wired-actions map (`SIMPLE_ACTIONS` / `BACKEND_TO_FE_ACTION` / dedicated-modal set). |
| `<Lock size={12} />` | **FE permission gate** (AssetsPage) | the gate's reason | The action is permission-gated in the FE and the user fails it. Shown disabled with the reason — never hidden. |

Plain wired actions get **no end-icon**. Always render every allowlisted action —
the old "Show hidden" dev toggle is gone; the icon + tooltip carries the routing info.

**Tooltip is a stack of lines**, not one winning over the others:
1. action label (bold) — always;
2. placement note — "Use: …" / "Not yet wired …" / gate reason (when applicable);
3. blocking reason — translated `blockingReason.<code>` (only when `is_available === false` and `blocking_reason` is set).

Single line → plain string; multi-line → vertical flex column, `font-medium` on line 1,
`text-xs opacity-90` on the rest.

Per-page configuration — two small maps near the top of the file:

```ts
type ActionPlacement =
  | { kind: 'elsewhere'; where: string }
  | { kind: 'not_wired' };

const ACTION_PLACEMENT: Record<string, ActionPlacement> = {
  SAVING_DEPOSIT: { kind: 'elsewhere', where: 'Wallets tab → Saving' },
  // …
};

// Optional: regroup an action under a different category in the popover
// (backend may tag SAVING_DEDUCT as FEE; we show it under WALLET).
const CATEGORY_OVERRIDE: Record<string, string> = { SAVING_DEDUCT: 'WALLET' };
```

`renderActionButton` skeleton:

```tsx
const placement = ACTION_PLACEMENT[a.action_code];
let endIcon: React.ReactNode = undefined;
const lines: string[] = [label];

if (placement?.kind === 'elsewhere') {
  endIcon = <ExternalLink size={12} />;
  lines.push(`${t('contract.actionElsewhere', { defaultValue: 'Use' })}: ${placement.where}`);
} else if (placement?.kind === 'not_wired' || !wired) {
  endIcon = <Wrench size={12} />;
  lines.push(t('contract.actionNotImplemented', { defaultValue: 'Not yet wired in this page' }));
}
if (!a.is_available && a.blocking_reason) {
  lines.push(t(`blockingReason.${a.blocking_reason}`, { ns: 'apiErrors', defaultValue: a.blocking_reason }));
}

const tooltipContent = lines.length === 1 ? lines[0] : (
  <div className="flex flex-col gap-0.5">
    {lines.map((line, i) => <div key={i} className={i === 0 ? 'font-medium' : 'text-xs opacity-90'}>{line}</div>)}
  </div>
);
// <Tooltip content={tooltipContent}><Button endIcon={endIcon} …/></Tooltip>
```

(AssetsPage keeps the same keys in its own `assetActions` namespace:
`actionElsewhere`, `notImplemented`.) `size={12}` matches the other small button
end-icons. When you add a new backend-driven action surface, copy this pattern and
keep icons + tooltip composition consistent across pages.
