# Action Button End-Icons — `elsewhere` and `not_wired`

> Convention used in backend-driven action footers (Contract, Asset, …) so users
> can tell at a glance which buttons actually do something *here* vs. which are
> placeholders or live somewhere else in the UI.

## Two icons, one rule

| Icon | Meaning | Tooltip line | When to use |
|------|---------|--------------|-------------|
| `<ExternalLink size={12} />` | **Lives elsewhere** | `Use: <where>` | Action is implemented on another tab/page. Footer keeps the button (so users know the capability exists) but points them to the real surface. |
| `<Wrench size={12} />` | **Not yet wired** | `Not yet wired in this page` | Action is in the allowlist but no FE handler/modal exists. Auto-applied to any allowlisted action that has no entry in the page's wired-actions map. |

Plain wired actions get **no end-icon**.

## Tooltip composition

Tooltip is a **stack of lines**, not one of them winning over the others. Order:

1. **Action label** (bold) — always.
2. **Placement note** — "Use: …" or "Not yet wired …" (only when applicable).
3. **Blocking reason** — translated `blockingReason.<code>` (only when `is_available === false` and `blocking_reason` is set).

Single-line tooltips render as a plain string; multi-line use a vertical flex
column with `font-medium` on line 1 and `text-xs opacity-90` on the rest.

## Per-page configuration

Each page that drives buttons from `fn_*_available_actions` keeps two small
maps near the top of the file:

```ts
type ActionPlacement =
  | { kind: 'elsewhere'; where: string }
  | { kind: 'not_wired' };

// Override the surface where an action lives.
const ACTION_PLACEMENT: Record<string, ActionPlacement> = {
  SAVING_DEPOSIT:    { kind: 'elsewhere', where: 'Wallets tab → Saving' },
  SAVING_CASHOUT:    { kind: 'elsewhere', where: 'Wallets tab → Saving' },
  SAVING_DEDUCT:     { kind: 'elsewhere', where: 'Wallets tab → Saving' },
  // …
};

// Optional: regroup an action under a different category in the popover.
// Backend may tag SAVING_DEDUCT as FEE; we want it under WALLET visually.
const CATEGORY_OVERRIDE: Record<string, string> = {
  SAVING_DEDUCT: 'WALLET',
};
```

`not_wired` does **not** need to be listed explicitly — any allowlisted action
missing from the page's `SIMPLE_ACTIONS` / `BACKEND_TO_FE_ACTION` map is treated
as not-wired automatically.

## `renderActionButton` skeleton

```tsx
const placement = ACTION_PLACEMENT[a.action_code];
let endIcon: React.ReactNode = undefined;
const lines: string[] = [label];

if (placement?.kind === 'elsewhere') {
  endIcon = <ExternalLink size={12} />;
  lines.push(`${t('actionElsewhere', { defaultValue: 'Use' })}: ${placement.where}`);
} else if (placement?.kind === 'not_wired' || !wired) {
  endIcon = <Wrench size={12} />;
  lines.push(t('actionNotImplemented', { defaultValue: 'Not yet wired in this page' }));
}
if (!a.is_available && a.blocking_reason) {
  lines.push(t(`blockingReason.${a.blocking_reason}`, { ns: 'apiErrors', defaultValue: a.blocking_reason }));
}

const tooltipContent = lines.length === 1
  ? lines[0]
  : (
    <div className="flex flex-col gap-0.5">
      {lines.map((line, i) => (
        <div key={i} className={i === 0 ? 'font-medium' : 'text-xs opacity-90'}>{line}</div>
      ))}
    </div>
  );
```

Then on the `<Button>`: `endIcon={endIcon}`. Wrap in `<Tooltip content={tooltipContent}>`.

## Show all actions, no toggle

We previously had a "Show hidden" dev toggle for `elsewhere` actions. **Removed.**
Always render every allowlisted action. The icon + tooltip carries the routing
info; no need to hide and require a click to discover.

## Where this is implemented

- `src/pages/contracts/ContractActions.tsx` — contract footer
- `src/pages/inventory/AssetsPage.tsx` — asset detail action bar

When you add a new backend-driven action surface, copy the same pattern and
keep the icons + tooltip composition consistent across pages.

## Lucide imports

```ts
import { ExternalLink, Wrench } from 'lucide-react';
```

Use `size={12}` to match other small button end-icons (chevrons, etc.).
