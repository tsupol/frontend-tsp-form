# MDM device-control — orientation for future work

The MDM feature is **built and shipped** (Ohm's 8-item v2 review + follow-ups, done 2026-07). This
is the durable map: how it's structured, the load-bearing rules, and the traps. Read this before
touching any MDM screen. For a NEW capability, still read the canonical BE docs (below) first.

## Canonical sources (BE — `git pull` D:\dev\nnf first, it changes often)
- **`database/UI_SUMMARY/131_MDM_DEVICE_CONTROL.md`** — the permanent reference. Section numbers
  (§3.0, §8.1, §9.1, …) are cited throughout the FE code comments. This is the source of truth for
  view columns, RPC shapes, and the display rules.
- `UI_FEEDBACK_RESPONSE/*_DONE_*.md` — dated delivery notes answering specific asks. Historical, but
  each explains *why* a rule exists.
- BE replies land in `nnf/UI_FEEDBACK_RESPONSE/`. Our asks go in `nnf/UI_FEEDBACK/` (commit to main,
  never branch; **ask the user before filing** — see the CLAUDE.md rule).

## Where things live (frontend)
```
src/pages/inventory/
  AssetMdmTab.tsx                 ← the tab SHELL. Owns sub-tab visibility (may_* flags), the
                                    shared status query, the pause bar, manual refresh.
  mdm/
    useMdmStatus.ts               ← the ONE shared v_asset_mdm_status query + MDM_NO_CACHE config
    mdmApi.ts                     ← ALL types + RPC wrappers + parseMdmError. One file, one import.
    useMdmCommand.ts              ← the async fire→ack→error contract every action button uses
    MdmActivityCard.tsx           ← §3.0 "what's happening now" box (full) + MdmActivityLine (compact)
    DeviceProfilesApps.tsx        ← the sub-tab-2 accordion: IMEI/SIM + profiles (collapsible,
                                    each with count+staleness+Pull, poll-until-observed_at-moves).
                                    The APPS section used to be here too — it moved to sub-tab 5.
    MdmSectionHeader.tsx          ← that accordion's header row (count + staleness + Pull), shared
    mdmSectionBits.ts             ← newestObserved + usePullPoll, shared by both accordions
    MdmDeviceAppsSection.tsx      ← sub-tab 5: the installed-app list + the per-row remove ritual
    MdmAppGatePanel.tsx           ← sub-tab 5, top: "ให้ลูกค้าลบแอปเอง" (the time-boxed window)
    MdmChallengeDialog.tsx        ← the shared 5s-countdown + 4-digit-OTP gate for destructive acts
    MdmDangerZone.tsx             ← sub-tab 7: remove enforcement · erase · reveal activation lock
    MdmSharedBits.tsx             ← EnforcementPausedBar, MdmErrorAlert, CommandAckNote, AppIcon
    RelativeDateTime.tsx          ← §3.2 time rule: absolute + "(N ago)", warn-colour past staleAfterDays
    RecentIntentsPanel.tsx        ← the shared command queue (§4)
    OverflowTabs.tsx              ← the sub-tab strip with a "More ▾" overflow popover
    SubTab{Enroll,Status,Dunning,Wallpaper,AppControl,LostMode,Pause}.tsx  ← the 7 sub-tabs
    wallpaperImage.ts             ← client-side crop→1170×2532→JPEG≤500KB (used by BranchWallpaperPage)
  settings/BranchWallpaperPage.tsx ← branch wallpaper library (OUTSIDE the asset tab; §10)
```
Sub-tab order (131 §0): 1 Enroll · 2 Status & queue · 3 Dunning · 4 Wallpaper · 5 App control ·
6 Lost mode & location · 7 Pause. Route: `/admin/inventory/assets/<id>?tab=mdm`.

**Sub-tab 5 holds everything about apps** (2026-08-14): the customer-self-removal window on top,
then the installed-app list with its per-row remove, then the whitelist presets. The list lived in
sub-tab 2 until then. Two removal features that read alike but are opposites — the window lets the
*customer* delete (their finger, their responsibility), the row button has *staff* delete on their
behalf (ours). Showing both together is the point: it's how the operator picks the right one.

## Load-bearing rules — break these and the screen lies

1. **No cache, ever (§0.25).** This screen is a remote control for a device elsewhere; the row
   changes without the user acting (device checks in, cron runs, another staffer acts, automation
   lifts/releases). Every MDM query spreads `MDM_NO_CACHE` (staleTime 0, refetchOnMount 'always',
   refetchOnWindowFocus). Every tab has a manual refresh button. NEVER add caching.

2. **Every command is async (§0.3, §2).** A 2xx means QUEUED (`state: READY_TO_SEND`), NOT done.
   Route all action buttons through `useMdmCommand` — it shows "acknowledged, not done", never
   "success" off the RPC return. After firing, track the `intent_id` in the queue; poll the relevant
   view until the awaited value flips (profiles/apps: `observed_at`; lost mode: overview flag; loop:
   a row in `v_mdm_active_loops`). On timeout say "device hasn't answered", NEVER "error".

3. **`enforcement_level = 0` IS the baseline `light` lock** (applied at handover step 7, stays the
   whole contract) — NOT "no restriction". Dunning is levels 1–3. Verified live: a device carrying
   the baseline profile reports level **1** (so step-7-done = `enforcement_level >= 1`). The §3.0
   ladder table's "0 = light" row is the theoretical dunning ladder, not what a handed-over device
   shows. Don't render level 0 as a dunning rung.

4. **"How it unlocks" comes ONLY from `release_condition_code`** — never composed from
   `enforcement_origin_code` (they contradicted on real hardware). `null` ≠ unrestricted → hide the
   line. Values: CUSTOMER_PAYS / STAFF_MUST_RELEASE / AUTOMATION_WILL_REVERT / null.

5. **null is a real answer — hide the line, never render "0 days".** The why/next columns
   (`overdue_days_effective`, `next_level`, `days_until_next_level`, …) are null when the device
   isn't under a live contract (stock, repair, closed). Same for `phone_number`/`carrier_network`
   (no active SIM → "No active SIM", not blank) and `nnf_app_installed`/`app_whitelist_active`
   (`null` = never pulled, ≠ `false` = pulled-and-absent — different messages).

6. **Sub-tab visibility from per-device `may_*` flags, NOT role_code.** `may_dunning`, `may_wallpaper`,
   `may_app_control`, `may_lost_mode`/`may_location`, `may_pause`, `may_profile` — these are
   permission AND territory (a device in another branch returns all-false → no dead-end 403s).
   `AssetMdmTab.visibleSubTabs()` owns this. Don't gate on role.

7. **Error codes arrive in BOTH casings — keep both in the catalogue.** `parseMdmError` prefers
   `messageKey`, which the BE sends **lowercase** (`mdm.state.gate_already_open`), while a raw
   type-B code arrives UPPER. The i18n lookup is by exact key, so an entry filed only in upper case
   silently never matches and the user gets the BE's raw English. Add every new MDM code to
   `errors.{en,th}.json` in both cases, and compare codes with `.toUpperCase()` in FE branching.
   (This bit three pre-existing codes as well as the 2026-08-13 app-removal set.)

8. **Alerts use tsp-form `.alert`** (`alert alert-{info|success|warning|danger}` + `.alert-title` /
   `.alert-description`), not hand-rolled tone boxes. Radios use tsp-form `RadioGroup`/`RadioCircle`.
   The user flagged both during review — match the component library.

## Data-contract quick reference (verify live before trusting; see §-numbers in 131)
- `v_asset_mdm_status?asset_id=eq.<id>` — one row, everything: hardware, enforcement, pause, the
  `may_*` flags, `activity_code`, pending/last command. `enforcement_level_commanded` (was `_expected`,
  renamed mig 914). `overdue_days_raw` added mig 921 (was an accidental drop).
- `v_mdm_device_profiles_current?device_id=eq.<id>` (device_id == asset id here)
- `v_mdm_device_apps_current?asset_id=eq.<id>&is_user_app=is.true` — filter drops OS poster/proxy
  pseudo-apps (mig 905). App Store stays but has no fetchable icon → monogram fallback.
  `is_protected` (mig 232-235) = the DB forbids removing it (the NNF app today) → show a padlock,
  no button. **Never test the bundle id in the UI** — the DB owns that list, and hardcoding it
  means the next protected app ships with a working delete button.
  ⛔ `is_user_app` is a display-noise filter ONLY — never read it as "the customer installed this".
  ⛔ `is_managed: false` means "not MDM-managed", which is equally true of Apple's preinstalled
  apps (our fleet has almost no managed apps). BE ruled the boolean correct and stays; the SCREEN
  silences the "ลูกค้าติดตั้งเอง" warning for `com.apple.*`.
- `POST /rpc/fn_mdm_app_gate_status {p_serial}` (mig 243) — the app-removal window's real state.
  Read permission is **`MDM.APP_CONTROL`**, deliberately wider than the `MDM.APP_REMOVE` needed to
  open/close it: an open window is live state everyone viewing the device must see. Gives
  `can_open` + `block_code` (disable the button AND say why, without probing) and
  `open_apply_state` (the profile swap is async — only `EXECUTED` means the customer can actually
  delete anything).
- `v_asset_cellular?asset_id=eq.<id>&order=sim_kind` — ONE ROW PER SIM SLOT (PHYSICAL + ESIM), each
  with its own IMEI (both correct — dual-SIM is normal).
- `v_mdm_enforcement_pauses?asset_id=eq.<id>` — asset-scoped (mig 220 added asset_id + mode).
  `pause_id` NOT unique (contract pause covering a loaner = 2 rows) → dedupe before display.
- `v_mdm_active_loops?device_id=eq.<id>` — location loop status; poll by `next_poll_at`, not fixed.
- App icons: `https://be-media.czynet.dev/api/v1/mdm/app-icon?bundle_id=X` — 302→Apple CDN (TH→US
  fallback), 404 = no icon → draw a monogram of `app_name`. No token. App NAME always from the view.

## Verifying live
- Test users have NO enrolled devices. Verify against **production** as `tpa_czynet` (password
  rotates — ask the user for the current one; it changed twice mid-session). Dev server:
  `https://localhost:5173` (HTTPS).
- **Don't hardcode a test asset — enrollment changes under you.** Asset 3091, named here for
  months, went `in_mdm: false` by 2026-08-14 and now shows only 2 sub-tabs; anything past
  enrollment is untestable on it. **`in_mdm` (not the `may_*` flags) is what gates sub-tabs 2-7**,
  so a device with `may_app_control: true` can still have no App-control tab. Pick a live one:
  ```
  /v_asset_mdm_status?in_mdm=is.true&may_app_control=is.true&select=asset_id,serial_number&limit=10
  ```
  Then find it in the UI by **searching its serial** — `/admin/inventory/assets/<id>?tab=mdm`
  does NOT select the asset on a cold load (the list renders and the detail panel shows row 1);
  type the serial into the search box and click the row. Working example 2026-08-14:
  **asset 3200 / `DFD74Q7F7Y`** (42 apps incl. the protected NNF app).
- **The app-removal window's open state is hard to see in production.** Every enrolled device
  visible to `tpa_czynet` returns `can_open: false` / `GATE_DEVICE_NOT_WITH_CUSTOMER`, so the
  panel's *open* branch (countdown · "opened by" · หยุดอนุญาตตอนนี้ · the `open_apply_state`
  "still sending" line) has never been seen on screen — only verified against the RPC contract.
  Opening one for real changes a customer's device. To exercise it, ask the owner for a device
  that is actually with its customer, or stub `fn_mdm_app_gate_status` in the browser.
- `dev-api` MCP works too: `POST /rpc/login {p_username,p_password}` → `set_token` → query. The token
  expires/gets revoked often — re-login freely.
- Overflow tab strip renders labels twice (off-screen measurement rail) → Playwright
  `getByText(exact)` hits 2 elements; use `getByRole('button',{name})`. The "More ▾" trigger is
  `button[aria-label="More tabs"]`.

## Build & deploy
- Build check is **`npx tsc -b`** — NOT `tsc --noEmit`. Production build has `noUnusedLocals`, which
  `--noEmit` misses (broke a deploy once).
- Deploy: `just deploy` from repo root (static tar-ship of dist/) → https://nnfui.czynet.dev. Never
  commit/push/deploy unprompted.
- i18n: both `en.json` + `th.json` in the same commit; keep parity. Error keys go in `errors.*.json`
  (namespace `apiErrors`) via `parseMdmError`.

## Known open BE items
- Pending-command count vs queue mismatch: `v_asset_mdm_status` can report a pending
  `REQUEST_LOCATION` (spinner shows) that has no matching pending row in `v_mdm_recent_intents`.
  Suspected: either filtered out of the queue view, or a stale pending count. FE now shows
  "Waiting for the device: <cmd>" instead of a bare spinner. Not yet filed — confirm before filing.
