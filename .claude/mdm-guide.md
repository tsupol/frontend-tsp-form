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
    DeviceProfilesApps.tsx        ← the sub-tab-2 accordion: IMEI/SIM + profiles + apps (collapsible,
                                    each with count+staleness+Pull, poll-until-observed_at-moves)
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

7. **Alerts use tsp-form `.alert`** (`alert alert-{info|success|warning|danger}` + `.alert-title` /
   `.alert-description`), not hand-rolled tone boxes. Radios use tsp-form `RadioGroup`/`RadioCircle`.
   The user flagged both during review — match the component library.

## Data-contract quick reference (verify live before trusting; see §-numbers in 131)
- `v_asset_mdm_status?asset_id=eq.<id>` — one row, everything: hardware, enforcement, pause, the
  `may_*` flags, `activity_code`, pending/last command. `enforcement_level_commanded` (was `_expected`,
  renamed mig 914). `overdue_days_raw` added mig 921 (was an accidental drop).
- `v_mdm_device_profiles_current?device_id=eq.<id>` (device_id == asset id here)
- `v_mdm_device_apps_current?asset_id=eq.<id>&is_user_app=is.true` — filter drops OS poster/proxy
  pseudo-apps (mig 905). App Store stays but has no fetchable icon → monogram fallback.
- `v_asset_cellular?asset_id=eq.<id>&order=sim_kind` — ONE ROW PER SIM SLOT (PHYSICAL + ESIM), each
  with its own IMEI (both correct — dual-SIM is normal).
- `v_mdm_enforcement_pauses?asset_id=eq.<id>` — asset-scoped (mig 220 added asset_id + mode).
  `pause_id` NOT unique (contract pause covering a loaner = 2 rows) → dedupe before display.
- `v_mdm_active_loops?device_id=eq.<id>` — location loop status; poll by `next_poll_at`, not fixed.
- App icons: `https://be-media.czynet.dev/api/v1/mdm/app-icon?bundle_id=X` — 302→Apple CDN (TH→US
  fallback), 404 = no icon → draw a monogram of `app_name`. No token. App NAME always from the view.

## Verifying live
- Test users have NO enrolled devices. Verify against **production** as `tpa_czynet` (password
  rotates — ask the user for the current one; it changed twice mid-session). Test asset = **3091**
  (branch 8, in MDM, ENFORCED level 1, no SIM, release=STAFF_MUST_RELEASE — dunning ladder is in
  shadow mode). Dev server: `https://localhost:5173` (HTTPS). Log in via the plain username/password
  form (quick-login buttons are test users only).
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
