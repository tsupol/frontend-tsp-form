# ActionDoneView — the shared modal success view

`src/pages/contracts/ActionDoneView.tsx`. The one component every data-mutating
modal uses for its success step (the `view==='done'` branch of the write-modal
checklist). Renders both the `modal-content` body and the `modal-footer` — the host
just drops it inside its modal and stops there. Do NOT hand-roll a success screen;
use this so all modals look and behave the same.

## When to use

Any modal that creates/edits data, after the mutation resolves. Set `view='done'`,
stash the result, render `<ActionDoneView .../>` instead of the form. The user reads
the result and closes the modal themselves (never auto-close). See the write-modal
checklist in `.claude/CLAUDE.md` and the Modal section of the tsp-form guide.

## Props

| prop | type | purpose |
|---|---|---|
| `headline` | string | big bold line, e.g. "Late fee collected". Translate it. |
| `contractCode` | string | subtitle under headline — contract/PO/asset code. |
| `tone` | `'success'｜'warning'｜'danger'｜'neutral'` | icon + accent. Default `success`. |
| `stateTransition` | `{from,to,fromColor?,toColor?}` | optional from→to badge pair (e.g. ACTIVE→TERMINATED). |
| `detailRows` | `{label,value,emphasis?}[]` | receipt-style key/value list. `emphasis` bolds the value. |
| `extras` | ReactNode | free slot below the rows (banners, lists). |
| `billId` | number｜null | **if set, the footer shows Download + Print bill-receipt buttons** (print uses the in-app print pattern — see `.claude/in-app-print-pattern.md`). Takes precedence over `secondaryAction`. |
| `secondaryAction` | `{label,onClick,startIcon?,endIcon?}` | one extra footer button (e.g. "Open PO"). Ignored if `billId` is set. |
| `doneLabel` | string | Done-button label override. Default `t('common.done')`. |
| `doneColor` | `'primary'｜'danger'` | Done-button color. Default `primary`. |
| `onClose` | () => void | **required** — closes the host modal. |

## Shape

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

## Reference implementations

`ContractFeeModal.tsx` (cart, `billId`), `LateFeeCollectModal.tsx` (single RPC,
`billId` + waive rows). Copy either.

---

# ModalErrorBand — where a submit error goes

`src/components/ModalErrorBand.tsx`. The failure-side counterpart to
`ActionDoneView`: the one place a write-modal renders its submit error.

## The rule

Render it **between** `.modal-content` and `.modal-footer` — as a sibling, never
a child of `modal-content`:

```tsx
<div className="modal-content">…fields…</div>
<ModalErrorBand message={error} />
<div className="modal-footer">…buttons…</div>
```

## Why not inside modal-content

`.modal-content` is the scrolling element (`overflow-y:auto; flex:1`) between a
static header and footer. An alert placed inside it scrolls with the form, so on
any modal taller than the viewport the error renders below the fold — and the
modal does not scroll to it. The user presses Save and sees **nothing happen**.

Measured on CreateExpenseModal at 390×844 before the fix: error at y=966, content
viewport ending at 740, `scrollTop: 0`. After: y=694, flush above the footer,
still visible at every scroll position.

Putting it at the *top* of `modal-content` is not a fix either — it scrolls away
just as fast once the user has scrolled down, and it sits far from the button
that produced it.

## Props

| prop | type | purpose |
|---|---|---|
| `message` | string｜null | falsy renders nothing (no wasted space) |
| `variant` | `'danger'｜'warning'` | default `danger`; `warning` for known backend gaps |
| `onDismiss` | () => void | shows an × that clears the parent's error state. Omit for a non-dismissable band. Pass `() => setError(null)`. |

Translate the message before passing it — use `translateApiError(err, t)` for
`ApiError`, per the API error handling rules in `.claude/CLAUDE.md`.

## Migration

~157 files still render `alert alert-danger` inline. Migrate a modal to the band
when you touch it for another reason; no bulk sweep.
