# No Hardcoded English in User-Facing Strings

Anything a user reads — Select `label`, Badge text, button labels, modal titles, table headers, placeholders, toast/snackbar messages — must come from `t('...')`. Add both `en.json` and `th.json` entries in the **same commit**; a `t()` call missing either file is not done.

> UI text lives in `src/i18n/locales/en.json` / `th.json` (namespace `translation`). API-error text lives in `errors.en.json` / `errors.th.json` (namespace `apiErrors`) — see the API error handling section in CLAUDE.md.

## Forbidden patterns

1. **Select options with literal labels** — `[{value: 'DRAFT', label: 'Draft'}]`.
   Instead keep a `_VALUES` const of codes and resolve at the call site:
   ```ts
   VALUES.map(v => ({ value: v, label: t(`section.status_${v}`) }))
   ```
   The `status_*` keys for inventory (po, receiving, transfer, repair, buyback) and contracts already exist in both locale files — reuse them.

2. **Badges rendering raw enum values** — `<Badge>{row.status}</Badge>` or `<Badge>{id.type}</Badge>`.
   Wrap: `t(`section.status_${row.status}`, { defaultValue: row.status })` so Thai users never see `PENDING_APPROVAL`. `defaultValue` is a safety net for unknown new codes, not the primary path.

3. **String concatenation that includes a raw enum** — `{contract.state} · {something}`. Translate the enum portion first.

4. **Field labels mid-render** — `<span>{k}:</span>` where `k` is a JSON key (`OVERALL_CONDITION`, `BATTERY_HEALTH`). Map through `t(`section.field.${k}`, { defaultValue: k })`.

## Before adding a key

If unsure whether a key exists, grep `src/i18n/locales/en.json` for `status_<CODE>` before defaulting to a literal.

## Completion gate

Before claiming any UI work done, re-scan **every string you added or touched** for literals — **button labels and Select options are the most-missed**. This is a hard gate, not a nice-to-have: missed literals get blamed on the user, not the model.
