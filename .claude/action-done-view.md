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
