# HANDOFF — make the public enrollment page render the SHARED tab-1 component

> Written 2026-08-17 at the end of a long session. **Temporary working document**
> — delete it once the work lands. Everything here was verified against the live
> API and the current repo, not recalled.

## The task in one sentence

`/mdm-enroll` (the QR page, branch B) must render **the same component MDM tab-1
renders**, so a change in one place changes both screens.

That is the user's stated goal, in their words: *"i want to reuse the component,
so when i need to change only one place."* Do not build a lookalike. A parallel
implementation already exists (see "What is there now") and duplicating the
markup is exactly the mistake being corrected.

## Why this is only now possible

The original BE contract (2026-08-15) gave the token page a deliberately reduced
subset: no permission fields, no enforcement buttons, 5 of the 7 steps. The FE
was built to that and shipped.

The owner overruled it. **`UI_FEEDBACK/2026-08-17_ANSWER_remote_enroll_full_tab1_parity.md`
in the nnf repo is the authoritative answer — read it first.** mig 251 is
deployed, smoke 24/24. Summary of what changed:

- `fn_mdm_remote_enroll_status` now returns **the full `v_asset_mdm_status` row**,
  same field names — including `may_apply_light`, `apply_light_blocked_reason`,
  `enforcement_badge`, `nnf_app_installed` (+`_checked_at`) — plus
  `link_expires_at`. Permissions are evaluated **as the link issuer**.
- New: `POST /rpc/fn_mdm_remote_enroll_apply_light {p_token, p_preview}` —
  **same shape as `fn_mdm_apply_template`** (preview → `restrictions` for the
  dialog; `p_preview:false` → intent). Template is LIGHT, fixed.
- `fn_mdm_remote_enroll_retry {p_token}` unchanged.
- Only block absent from `data`: `may_enroll_delegate` + `enroll_link_*`
  (issuer-side, tab-1 only).

Verified live 2026-08-17: `fn_mdm_remote_enroll_apply_light` exists and returns
`403 MDM.AUTH.ENROLL_LINK_INVALID reason=NOT_FOUND` for a bogus token.

## ⚠️ Two things on production are now WRONG

1. **`completed` was removed from the response.** The shipped page stops polling
   on it and shows a success screen — that field is now permanently `undefined`,
   so the finished state never appears. Replace with
   `lock_ready && enforcement_badge !== 'NONE'` → "✅ พร้อมส่งมอบ", and keep
   polling until the link expires. There is no auto-revoke by status any more;
   links die only by 3h expiry, revoke, or replace.
2. **`PREPARE_FAILED` / `NOT_ON_SERVER` is no longer a dead end.** The shipped
   page says "ติดต่อสาขา" because the old contract said B could not reach ABM.
   The owner clarified: B **is** staff at another branch on the **same ABM**.
   Use tab-1's wording — "สแกนเครื่องเข้า ABM แล้วเลือก MDM server: NNF-MDM-1" —
   with "หรือติดต่อสาขาผู้ออกลิงก์" appended.

## What is there now (all committed, tree clean)

```
enroll.html                     ← 2nd Vite entry; inline boot splash (this path only)
vite.config.ts                  ← rollupOptions.input {main, enroll}
                                   + enrollStringsPlugin (build-time locale slice)
                                   + enrollPageRewrite (/mdm-enroll → enroll.html in DEV)
nginx.conf                      ← `location = /mdm-enroll` → enroll.html (PROD; already deployed)
src/enroll/
  main.tsx                      ← no providers; imports app-theme/typography/layout/app css
  EnrollApp.tsx                 ← ⚠️ THE DUPLICATE. Own Steps/StatusBand/KeyBanner/SerialHero
  api.ts                        ← plain fetch; EnrollLinkDead; reads the NESTED error envelope
  usePoll.ts                    ← setTimeout port of the 5s/30s cadence
  strings.ts                    ← reads `virtual:enroll-strings`
  enrollStringKeys.ts           ← the key allowlist (build fails on a missing key)
  Controls.tsx                  ← language + theme, stored under enroll-specific keys
  mockScenarios.tsx             ← ?mock floating picker, DEV + isLocalDev only
src/pages/inventory/mdm/shared/
  EnrollChecklist.tsx           ← ⭐ THE SHARED ONE. Steps 1–5 + bands + wait hints + KeyBanner
  SerialDisplay.tsx             ← SerialHero + SerialZoomModal
  enrollView.ts                 ← EnrollView type + fromAssetStatus/fromRemoteStatus + waitStage
  useEnrollPoll.ts              ← React Query version (tab-1 uses this)
  useTicker.ts
src/pages/inventory/mdm/
  SubTabEnroll.tsx              ← tab-1; hosts EnrollChecklist + steps 6/7 as children
  EnrollDelegationPanel.tsx     ← issuer side (tab-1). Not affected by this work.
```

## The plan

1. **Move steps 6 and 7 into `EnrollChecklist`** (out of `SubTabEnroll`), so both
   screens get them from one place. Step 6 = NNF-app badge + the two key badges;
   step 7 = the lock badge + button + its preview→confirm dialog.
2. **Delete the duplicates** in `EnrollApp.tsx` (`Steps`, `StatusBand`,
   `KeyBanner`, `SerialHero`, `bandKey`, `waitStage`, `fmtWait`, `doneCount`)
   and render `EnrollChecklist` + `SerialZoomModal` instead.
3. **Drop the `audience` prop's divergences.** BE is explicit: no subset, nothing
   read-only, and `PREPARE_FAILED` now uses tab-1's wording. Whether the prop
   survives at all is a judgement call — if nothing differs, delete it.
4. **Extend `EnrollView`** (`enrollView.ts`) with the fields that now arrive:
   `may_apply_light`, `apply_light_blocked_reason`, `enforcement_badge`,
   `nnf_app_installed`, `nnf_app_checked_at`, `enforcement_verify_state`,
   `escrow_*`. `fromRemoteStatus` can now copy them — but **keep it
   field-by-field**; it is the guard that stops `enroll_link_*` /
   `issued_to_note` reaching the public DOM.
5. **Add `remoteEnrollApplyLight(token, preview)`** to `src/enroll/api.ts`.
6. **The lock button needs an RPC-agnostic host.** `EnrollChecklist` must not
   know which endpoint it is calling: pass `onApplyLight(preview)` down, tab-1
   wires `fn_mdm_apply_template`, the token page wires
   `fn_mdm_remote_enroll_apply_light`. Same for prepare (already the pattern).
7. **i18next on the standalone page.** `EnrollChecklist` and `SerialDisplay` call
   `useTranslation` in three places. The standalone page currently has its own
   `makeT`. Cleanest: initialise a small i18next instance in `src/enroll/main.tsx`
   seeded from `virtual:enroll-strings` and wrap in `I18nextProvider`, then
   `Controls.tsx` switches language through it. `i18next@24` and
   `react-i18next@15` are already dependencies.
   ⚠️ Do **not** let it write `i18nextLng` to localStorage — a staffer opening the
   QR link must not have their admin app's language changed. `Controls.tsx`
   documents this trap.
8. **Extend `enrollStringKeys.ts`** with every key steps 6/7 introduce
   (`asset.mdm.step6.*`, `asset.mdm.step7.*`, `asset.mdm.lock.*`, blocked reasons,
   `asset.mdm.band.PREPARE_FAILED.*` now that the remote variant is gone). A
   missing key **fails the build** — that is intended.

## Traps that already cost time in this session

- **`src/enroll` must not import the whole locale JSON.** It was 810kB and ~90%
  of the bundle. The slice plugin exists for this; add keys to the allowlist
  instead of reaching for `en.json`.
- **`layout.css` is load-bearing** for the standalone entry — it carries the
  `body` rule with background, default text colour and Noto Sans Thai. Without it
  everything renders browser-default black on the dark background in a system
  font. Do not "tidy" it out of `main.tsx`.
- **The error envelope nests under `error`**: `{ok:false, error:{code,
  message_key, params:{reason}}}`. Reading the root silently never matches and a
  dead link renders as "check your internet".
- **The reveal animation is paused** until `.enroll-revealing` lands on `<html>`
  (set when the splash starts lifting). If a code path skips
  `useDismissSplash`, content stays invisible.
- **`?mock` reloads the page** on every pick, by design — the point is to see the
  splash and reveal each time. Scenario lives in the URL.
- **tsp-form Modal**: always mounted, `open` prop only. Step 7's confirm dialog
  is a Modal — see the rule in `.claude/CLAUDE.md`.

## How to verify

- States without a device: `https://localhost:5173/mdm-enroll?mock` (or the LAN
  IP). 🎛 top-left. Add scenarios in `mockScenarios.tsx` for step 6/7 states.
- Real device: asset **6290** / serial `DJKPHM9LG3` — enrolled, LIGHT lock, both
  keys, `may_enroll_delegate: true`. Issue a link from tab-1
  (`/admin/inventory/assets/6290?tab=mdm`, search the serial — a cold URL does
  not select the row), then open it.
  ⚠️ Production data, user `tpa_czynet`. **Logging in as that user kicks the
  user's own browser session** — ask before doing it.
- `npx tsc -b` (NOT `--noEmit`), then `npm run build`.
- Deploy is `just deploy` alone; the nginx rule is already on the server, so
  `just serve` is not needed again. **Ask before deploying.**

## Open item, unrelated

`in_abm_now: false` on asset 6290 (enrolled + LIGHT) — BE confirmed this is
normal: a device can drop out of ABM after enrolling. The dialog warning is
correct and means "if this device is wiped it cannot re-enter MDM until it is
scanned into ABM again". Nothing to do.
