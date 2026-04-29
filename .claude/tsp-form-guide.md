# tsp-form Usage Guide

Universal guide for any project consuming the `tsp-form` component library.

## Lookup Order

1. **Current project first:** Check existing usage in `src/` — reuse the same patterns
2. **Examples:** `C:\Users\tonsu\PhpstormProjects\tsp-form\src\example\` — usage patterns
3. **Component source:** `C:\Users\tonsu\PhpstormProjects\tsp-form\src\components\`
4. **Context/hooks:** `C:\Users\tonsu\PhpstormProjects\tsp-form\src\context\`
5. **Library CLAUDE.md:** `C:\Users\tonsu\PhpstormProjects\tsp-form\.claude\CLAUDE.md`

**Always read examples before implementing.** Don't guess at component APIs — check how they're actually used.

## Consumer Integration (Tailwind 4)

Add this to `index.html` `<head>` **before** any CSS loads:
```html
<style>@layer theme, base, components, utilities;</style>
```

## CSS Setup

- **`src/index.css`** — tsp-form theme only (copy from `example.css`, change `@import` line to `@import "tailwindcss"`)
- **`src/app.css`** — app-specific styles (`.page-content`, layout utilities, overrides)
- Theme uses `data-theme` attribute on `<html>` (`light` / `dark`), not CSS classes

## Consistent Props

All form controls share a consistent `size?: "sm" | "md" | "lg"` prop: `Input`, `Select`, `InputDatePicker`, `InputDateRangePicker`, `Button`, `TextArea`, `MaskedInput`, `Switch`. Filter bars should use `size="sm"`.

Many controls share: `error?: boolean` for error border styling, `disabled` for disabled state.

## Form Patterns

- Form field container: use `.form-grid` class — provides `grid`, `gap-5`, and `pb-7`. Apply to the `<div>` wrapping form fields, not the `<form>` itself or buttons. Tailwind can override (e.g. `form-grid gap-3`).
- Each field: `flex flex-col` (no gap) — label, input, and error message handle their own spacing
- Labels: use `form-label` class
- Error display: `FormErrorMessage` after each input
- Forms in modals: `form-grid` goes inside `modal-content`, never on the same element
- **Select in flex rows:** Wrap `Select` in a `<div>` with fixed width — without a container the Select width is buggy
- **Input width:** `Input` does NOT auto-fill — add `className="w-full"` when inside flex/input-group containers

## Input Group

CSS class `input-group` — groups controls side-by-side with connected borders. Use `input-group-divider` between controls.

```tsx
<div className="input-group">
  <div className="w-28 shrink-0">
    <Select options={currencies} value={currency} onChange={setCurrency} searchable={false} />
  </div>
  <div className="input-group-divider" />
  <Input placeholder="Amount" className="w-full" />
</div>
```

## Button Patterns

### Icon-only buttons
Use `startIcon` prop with **no children** — the button auto-sizes to square:
```tsx
<Button variant="outline" size="sm" startIcon={<Plus size={16} />} onClick={...} />
```
Do NOT put icons as children of Button. Do NOT use raw `<button>` elements for icon actions.

### Buttons with text + icon
```tsx
<Button color="primary" startIcon={<Plus size={16} />}>Create</Button>
```

### `btn-icon-sm` class
Only use `className="btn-icon-sm"` when you need extra elements inside (e.g. absolute-positioned badge overlay). Otherwise use `startIcon`.

## Checkbox & LabeledCheckbox

```tsx
// Standalone checkbox
<Checkbox checked={value} onChange={e => setValue(e.target.checked)} />

// Checkbox with label — handles htmlFor/id, use this when you have label text
<LabeledCheckbox label="Subscribe to newsletter" checked={agreed} onChange={...} />
```

**Never use native `<input type="checkbox">`.** Always use `Checkbox` or `LabeledCheckbox`.

## Switch

Toggle switch control. Same `size` prop as other controls.

```tsx
<Switch size="sm" />
<Switch checked={enabled} onChange={e => setEnabled(e.target.checked)} />
<Switch disabled />
```

See example: `src/example/pages/SwitchPage.tsx`

## RadioGroup

```tsx
<RadioGroup
  name="plan"
  value={selected}
  onChange={val => setSelected(val)}
  options={[
    { value: 'basic', label: 'Basic' },
    { value: 'pro', label: 'Pro' },
  ]}
/>
```

## MaskedInput

Single input with formatting. Two modes: pattern mask and number formatting.

```tsx
// Pattern mode — fixed mask, # = digit
<MaskedInput mask="###-###-####" value={phone} onChange={(raw, formatted) => setPhone(raw)} />
<MaskedInput mask="###-##-####" />           // SSN
<MaskedInput mask="#### #### #### ####" />   // Credit card

// Number mode — thousand separators
<MaskedInput mask="number" value={amount} onChange={(raw) => setAmount(raw)} decimalScale={0} />
<MaskedInput mask="number" decimalScale={2} prefix="฿ " />
```

Props: `mask`, `maskChar` (default `#`), `thousandSeparator` (default `,`), `decimalSeparator` (default `.`), `decimalScale`, `allowNegative`, `prefix`, `suffix`. `onChange` returns `(rawValue, formattedValue)`.

See example: `src/example/pages/MaskedInputPage.tsx`

## InputDatePicker / InputDateRangePicker

- Value type: `Date | null` — NOT a string.
- **NEVER use `date.toISOString().slice(0, 10)` to convert Date → string.** `toISOString()` converts to UTC, shifting the day in non-UTC timezones. Use local fields:
  ```tsx
  function toLocalDateStr(d: Date | null): string {
    if (!d) return '';
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  ```
- **Locale & calendar — always pass both.** `calendar="locale"` (default) switches Thai to Buddhist calendar (year 2569). Almost never what you want. Pass `calendar="gregorian"` and `locale={i18n.language}`.
- Always include `endIcon={<Calendar size={14} />}`.

```tsx
<InputDatePicker
  value={dateStr ? new Date(dateStr + 'T00:00:00') : null}
  onChange={v => setDateStr(toLocalDateStr(v))}
  endIcon={<Calendar size={14} />}
  size="sm"
  locale={i18n.language}
  calendar="gregorian"
/>
```

### Typing Mode

Allows users to type a date directly via keyboard. Pressing a digit key activates typing mode automatically. Consumer controls the mask format and parsing.

```tsx
const [date, setDate] = useState<Date | null>(null);
const [isTyping, setIsTyping] = useState(false);

<InputDatePicker
  value={date}
  onChange={setDate}
  endIcon={<Keyboard size={18} />}
  onEndIconClick={() => setIsTyping(t => !t)}
  typingMode={isTyping}
  onTypingModeChange={setIsTyping}
  typingMask="##/##/####"
  typingPlaceholder="DD/MM/YYYY"
  parseTypedDate={(raw) => {
    if (raw.length !== 8) return null;
    const day = parseInt(raw.slice(0, 2), 10);
    const month = parseInt(raw.slice(2, 4), 10);
    let year = parseInt(raw.slice(4, 8), 10);
    if (year > 2400) year -= 543; // Buddhist Era → Gregorian
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const d = new Date(year, month - 1, day);
    if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
    return d;
  }}
/>
```

**InputDateRangePicker** typing mode uses `parseTypedDates` (returns `{ from, to }`):

```tsx
const [from, setFrom] = useState<Date | null>(null);
const [to, setTo] = useState<Date | null>(null);
const [isTyping, setIsTyping] = useState(false);

<InputDateRangePicker
  fromDate={from}
  toDate={to}
  onFromDateChange={setFrom}
  onToDateChange={setTo}
  endIcon={<Keyboard size={18} />}
  onEndIconClick={() => setIsTyping(t => !t)}
  typingMode={isTyping}
  onTypingModeChange={setIsTyping}
  typingMask="##/##/#### - ##/##/####"
  typingPlaceholder="DD/MM/YYYY - DD/MM/YYYY"
  parseTypedDates={(raw) => {
    const parseDate = (digits: string) => {
      if (digits.length !== 8) return null;
      const day = parseInt(digits.slice(0, 2), 10);
      const month = parseInt(digits.slice(2, 4), 10);
      let year = parseInt(digits.slice(4, 8), 10);
      if (year > 2400) year -= 543;
      if (month < 1 || month > 12 || day < 1 || day > 31) return null;
      const d = new Date(year, month - 1, day);
      if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
      return d;
    };
    return {
      from: parseDate(raw.slice(0, 8)),
      to: raw.length >= 16 ? parseDate(raw.slice(8, 16)) : null,
    };
  }}
/>
```

Typing props: `typingMode`, `onTypingModeChange`, `typingMask`, `typingPlaceholder`, `parseTypedDate` / `parseTypedDates`, `onEndIconClick`. Enter commits, Escape cancels.

### i18n setup for locale

Consumer projects need `i18next` + `react-i18next` for the `i18n.language` value. Minimal setup:

```tsx
// src/i18n/config.ts
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

i18n.use(LanguageDetector).use(initReactI18next).init({
  resources: { /* ... */ },
  fallbackLng: 'en',
  detection: { order: ['localStorage', 'navigator'], caches: ['localStorage'] },
});
```

Then `import './i18n/config'` in your entry point. The tsp-form example app has a reference setup in `src/example/i18n/config.ts`.

## Select

```tsx
<Select options={options} value={value} onChange={setValue} />
<Select clearable value={filter || null} />   // null hides clear button, '' shows it
<Select renderOption={(opt) => <div className="min-w-0"><div className="truncate">{opt.label}</div></div>} />
```

**Filter Selects default to `clearable`.** When a Select acts as a list filter (status, type, branch, date scope, etc.), users expect to remove it. Always wire it as:

```tsx
const [filter, setFilter] = useState<MyType | null>(initialValue ?? null);

<Select
  options={options}
  value={filter}
  onChange={(v) => setFilter((v as MyType) || null)}
  placeholder={t('filter.allX')}
  clearable
  size="sm"
/>
```

- State type is `T | null`, **not** `T` — clearing must be representable.
- `onChange` coerces to `null`: `(v as T) || null` (not `?? defaultValue` — that defeats clearing).
- Pair with a placeholder that names the cleared state ("All branches", "All statuses").
- In the query, only apply the filter when truthy: `if (filter) params.set('x', \`eq.${filter}\`)`.

**When to omit `clearable`:** the filter must always have a value (required scope picker, mandatory tenant select, single-tab control). These are rare — when in doubt, make it clearable.



## MobileHeader

Sticky top header for mobile views. Three slots: `mobile-header-start`, `mobile-header-title`, `mobile-header-end`. The title has `text-align: center` and `flex: 1`, so it **only appears centered when the start and end slots have equal width**.

```tsx
<MobileHeader className="mobile-header-bordered">
  <div className="mobile-header-start">
    <button className="w-nav h-nav ...">{/* menu / back */}</button>
  </div>
  <div className="mobile-header-title mobile-header-title-truncate">
    {title}
  </div>
  <div className="mobile-header-end w-nav">
    {/* optional action button — same w-nav width keeps title centered */}
  </div>
</MobileHeader>
```

- **Always reserve `w-nav` (or matching width) on `mobile-header-end`**, even when empty (`<div className="mobile-header-end w-nav" />`). Without it the title drifts off-center because the end slot collapses to its content.
- Action buttons in start/end use `w-nav h-nav` to match the header height.

## Modal

- **Always render Modal in the tree** — control with `open` prop. Do NOT conditionally mount/unmount.
  ```tsx
  // WRONG — won't trigger transition
  {showModal && <Modal open={true} ...>...</Modal>}

  // CORRECT
  <Modal open={showModal} onClose={() => setShowModal(false)} ...>...</Modal>
  ```
- Close button: `<button type="button" className="modal-close-btn" onClick={handleClose}>×</button>`

## Drawer

Right-side panel — keeps list context visible.

```tsx
<Drawer open={open} onClose={onClose} side="right" ariaLabel="Title">
  <div className="drawer-header">
    <h2 className="drawer-title">Title</h2>
    <button className="drawer-close-btn" onClick={onClose}>&times;</button>
  </div>
  <div className="drawer-content">{/* scrollable */}</div>
  <div className="drawer-footer">{/* sticky actions */}</div>
</Drawer>
```

## PopOver & Row Actions

- `PopOver`: portal-based, auto-flips. Props: `isOpen`, `onClose`, `trigger`, `placement`, `align`, `maxWidth`, `maxHeight`, `offset`
- Row actions pattern: PopOver with `MoreHorizontal` trigger, containing `MenuItem` / `MenuSeparator`

## DataTable & DataTableFooter

`DataTable` is the full-featured table with sorting, pagination, and column definitions.

`DataTableFooter` is a standalone pagination footer — use it for mobile card lists or custom layouts:

```tsx
<DataTableFooter
  currentPage={pageIndex}
  totalPages={Math.ceil(totalCount / pageSize)}
  onPageChange={setPageIndex}
  pageSize={pageSize}
  pageSizeOptions={[10, 25, 50]}
  onPageSizeChange={setPageSize}
  totalRows={totalCount}
  controlSize="sm"
/>
```

See example: `src/example/pages/TablePage.tsx`

## Alert & Snackbar

- Alert is CSS-only: `<div className="alert alert-{variant}">` — variants: `info`, `success`, `warning`, `danger`
- Snackbar: `addSnackbar({ message: <div className="alert alert-success"><CheckCircle size={16} /><span>Done</span></div> })`

## Badge

Valid colors: `default`, `primary`, `secondary`, `success`, `danger`, `warning`, `info`.

## Other Components

These components are available — check the example pages and source for API details:

- **CollapsiblePanel** — expandable section with title and chevron. Props: `title`, `defaultOpen`, `chevronProps`
- **Carousel** — image/content slider with dots, arrows, swipe, autoplay. See `src/example/pages/CarouselPage.tsx`
- **ImageUploader** — drag-and-drop image upload with optional resize. See `src/example/pages/ImageUploaderPage.tsx`
- **ImageCropper** — crop/zoom UI for images. Props: `src`, `aspectRatio`, `outputWidth`
- **FileUploader** — drag-and-drop file upload with validation. See `src/example/pages/FileUploaderPage.tsx`
- **Slider** — range input. Props: `value`, `onChange`, `min`, `max`, `step`, `showValue`, `showMinMax`, `scale`
- **Skeleton** — loading placeholder. Props: `variant` (`text`|`circular`|`rectangular`), `width`, `height`, `animation`
- **ProgressBar** — progress indicator. Props: `value`, `max`, `color`, `size`, `showLabel`, `striped`, `animated`
- **Tooltip** — hover tooltip, portal-based. Props: `content`, `placement`, `delay`, `disabled`. **Never use native `title` attribute.**
- **AnimatedOutlet** — animated route transitions for nested routes. Props: `fallback`, `mobileBreakpoint`
- **NumberSpinner** — numeric input with +/- buttons. See `src/example/pages/NumberSpinnerPage.tsx`

## Scrollable Containers

- `.better-scroll` — styled thin scrollbar on any scrollable container
- `.modal-content` — already has thin scrollbar built in
- `.hidden-scroll` — hides scrollbar, keeps scroll

## SideMenu & SideMenuItems

### Key props
- `SideMenu`: `isCollapsed`, `onToggleCollapse`, `linkFn`, `titleRenderer`, `items`, `mobileToggleRenderer`
- `SideMenuItems`: `items` (`SideMenuItemData[]` — uses `key` not `id`), `activePath`, `collapsed`, `isMobile`, `onSelect`, `onCloseMobile`
- `titleRenderer` return **must have `key="title"`**

See the tsp-form example app `src/example/index.tsx` for the full SideMenu + UserMenu pattern.

## AdminLayout

```tsx
<div className="flex h-dvh">
  <AppSideNav />
  <div className="flex-grow w-full better-scroll">{children}</div>
</div>
```

## Example App CSS Classes

These are in the tsp-form example app — copy into consumer projects as needed:

- `src/example/styles/typography.css` — `.heading-1`–`.heading-4`, `.text-muted`, `.text-small`
- `src/example/styles/layout.css` — `.card`, `.divider`, `.divider-sm`

## Project-Specific Patterns

Consumer projects may have their own patterns not part of tsp-form (e.g. `NavGuardContext`, `useFormSnapshot`, filter bar layouts, debounced search). Check the consumer project's own documentation or CLAUDE.md for these.
