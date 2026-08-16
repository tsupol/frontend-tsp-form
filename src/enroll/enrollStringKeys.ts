// The exact set of locale keys the enrollment page renders.
//
// WHY A LIST INSTEAD OF IMPORTING THE LOCALE FILES: en.json + th.json are ~810kB
// of raw JSON between them. A runtime lookup keeps the whole object reachable,
// so nothing tree-shakes and the entire admin vocabulary — day-close, contracts,
// dunning — ships to a page that displays a serial number and a status line.
// Measured: it was ~90% of the bundle. (The page runs i18next since 2026-08-17,
// but it is seeded from THIS slice, not from the locale files.)
//
// The build plugin in vite.config.ts reads this list, pulls just these keys out
// of the SAME locale files the admin app uses, and inlines the result. So the
// single-source guarantee holds — branch A and the link holder still read
// identical sentences — but only these strings travel.
//
// ⛔ A key here that does not exist in en.json/th.json FAILS THE BUILD. That is
//    the point: it catches a rename in the shared files immediately, instead of
//    shipping a raw dotted key to a stranger's phone.
//
// ⚠️ THE INVERSE IS NOT CHECKED. A key the shared components render but that is
//    MISSING from this list renders as the raw dotted key at runtime, silently.
//    Since the page now renders the same components as tab-1, adding any t()
//    call to shared/EnrollChecklist, shared/EnrollReadinessSteps,
//    shared/SerialDisplay or shared/StepRow means adding its key HERE too.

export const ENROLL_STRING_KEYS = [
  // Page chrome
  'remoteEnroll.serialLabel',
  'remoteEnroll.serialHint',
  // SerialZoomModal's two keys. The page currently renders only SerialHero, but
  // both live in the same shared module — listing them means reaching for the
  // zoom modal here is a one-line change rather than a silent raw-key bug.
  'asset.mdm.serialCheck.title',
  'asset.mdm.serialCheck.hint',
  'remoteEnroll.watching',
  'remoteEnroll.updatedJustNow',
  'remoteEnroll.updatedAgo',
  'remoteEnroll.expiresInHm',
  'remoteEnroll.expiresInM',

  // Terminal screens + the handover banner
  'remoteEnroll.done.title',
  'remoteEnroll.done.body',
  'remoteEnroll.done.tellBranch',
  'remoteEnroll.offline.title',
  'remoteEnroll.offline.body',
  'remoteEnroll.dead.NOT_FOUND.title',
  'remoteEnroll.dead.NOT_FOUND.body',
  'remoteEnroll.dead.EXPIRED.title',
  'remoteEnroll.dead.EXPIRED.body',
  'remoteEnroll.dead.REVOKED.title',
  'remoteEnroll.dead.REVOKED.body',

  'common.refresh',
  'common.cancel',
  'common.close',
  'common.loading',

  // The status band — one title/body pair per state.
  // PREPARE_FAILED is the SHARED wording now (it names MDM server NNF-MDM-1):
  // the link holder is on the same ABM and can scan the device in themselves.
  'asset.mdm.band.NO_SERIAL.title',
  'asset.mdm.band.NO_SERIAL.body',
  'asset.mdm.band.NOT_STARTED.title',
  'asset.mdm.band.NOT_STARTED.body',
  'asset.mdm.band.PREPARING.title',
  'asset.mdm.band.PREPARING.body',
  'asset.mdm.band.PROFILE_READY.title',
  'asset.mdm.band.PROFILE_READY.body',
  'asset.mdm.band.PREPARE_FAILED.title',
  'asset.mdm.band.PREPARE_FAILED.body',
  'asset.mdm.band.IN_MDM.title',
  'asset.mdm.band.IN_MDM.body',
  'asset.mdm.band.REENROLL_READY.title',
  'asset.mdm.band.REENROLL_READY.body',

  // The wipe instructions
  'asset.mdm.wipeSteps.s1',
  'asset.mdm.wipeSteps.s2',
  'asset.mdm.wipeSteps.s3',

  // Escalating wait hints
  'asset.mdm.waitHint.waiting',
  'asset.mdm.waitHint.PROBABLY_NOT_WIPED.title',
  'asset.mdm.waitHint.PROBABLY_NOT_WIPED.body',
  'asset.mdm.waitHint.CHECK_SERIAL.title',
  'asset.mdm.waitHint.CHECK_SERIAL.body',

  // Steps 1–5
  'asset.mdm.step.serial',
  'asset.mdm.step.scan',
  'asset.mdm.step.send',
  'asset.mdm.step.wipe',
  'asset.mdm.step.enrolled',
  'asset.mdm.stepWhere.system',
  'asset.mdm.stepWhere.device',
  'asset.mdm.stepWhere.auto',

  // Prepare button
  'asset.mdm.button.prepare',
  'asset.mdm.button.reenroll',
  'asset.mdm.button.retry',
  'asset.mdm.button.reenrollHint',
  'asset.mdm.noPermission',

  // The two-key banner
  'asset.mdm.keys.readyTitle',
  'asset.mdm.keys.notReadyTitle',
  'asset.mdm.keys.appleShort',
  'asset.mdm.keys.orgShort',
  'asset.mdm.lockVerdict.PROTECTED',
  'asset.mdm.lockVerdict.ORG_KEY_NOT_APPLIED',
  'asset.mdm.lockVerdict.NO_ORG_LOCK_IN_ABM',
  'asset.mdm.lockVerdict.NO_ORG_LOCK_OUT_OF_ABM',
  'asset.mdm.lockVerdict.NOT_SUPERVISED',

  // ── Step 6 — the auto-detected readouts ───────────────────────────────────
  'asset.mdm.step6.title',
  'asset.mdm.step6.nnfAppLabel',
  'asset.mdm.step6.nnfInstalled',
  'asset.mdm.step6.nnfNotInstalled',
  'asset.mdm.step6.nnfUnknown',
  'asset.mdm.step6.pullKeyLabel',
  'asset.mdm.step6.pushKeyLabel',
  'asset.mdm.step6.escrowNotEnrolled',
  'asset.mdm.step6.escrowHasKey',
  'asset.mdm.step6.escrowRacing',
  'asset.mdm.step6.escrowMissed',
  'asset.mdm.step6.orgKeyMissing',
  'asset.mdm.step6.orgKeyInstalling',
  'asset.mdm.step6.orgKeyOk',

  // ── Step 7 — the baseline lock ────────────────────────────────────────────
  'asset.mdm.step7.title',
  'asset.mdm.step7.desc',
  'asset.mdm.step7.button',
  'asset.mdm.step7.lockLabel',
  'asset.mdm.step7.wallpaperOnlyWarn',
  'asset.mdm.step7.verifyPending',
  'asset.mdm.step7.applied',
  'asset.mdm.step7.confirmTitle',
  'asset.mdm.step7.confirmBody',
  'asset.mdm.step7.confirmButton',
  'asset.mdm.step7.reminderTitle',
  'asset.mdm.step7.reminderIcloud',
  'asset.mdm.step7.reminderFindMy',
  'asset.mdm.step7.reminderNnfApp',
  'asset.mdm.dunning.deviceLabel',

  // Why the lock button is unavailable
  'asset.mdm.step7.blocked.NOT_IN_MDM',
  'asset.mdm.step7.blocked.NO_PERMISSION',
  'asset.mdm.step7.blocked.COMMAND_IN_FLIGHT',
  'asset.mdm.step7.blocked.ENFORCEMENT_PAUSED',
  'asset.mdm.step7.blocked.ALREADY_ENFORCED',
  'asset.mdm.step7.blocked.HIGHER_LEVEL_ACTIVE',

  // The restrictions listed in the confirm dialog. Each falls back to its raw
  // key if BE adds a flag we don't have wording for, so a new one degrades to
  // "allowFooBar" rather than blanking the list.
  'asset.mdm.step7.flag.allowAccountModification',
  'asset.mdm.step7.flag.allowModifyFindMy',
  'asset.mdm.step7.flag.allowHostPairing',
  'asset.mdm.step7.flag.allowProfileInstallation',
  'asset.mdm.step7.flag.allowEraseContentAndSettings',
  'asset.mdm.step7.flag.allowSystemAppRemoval',
  'asset.mdm.step7.flag.allowAppRemoval',
  'asset.mdm.step7.flag.allowCloudPrivateRelay',
  'asset.mdm.step7.flag.allowESIMOutgoingTransfers',

  // The lock badge
  'asset.mdm.lock.NOT_IN_MDM',
  'asset.mdm.lock.APPLYING',
  'asset.mdm.lock.NONE',
  'asset.mdm.lock.WALLPAPER_ONLY',
  'asset.mdm.lock.LIGHT',
  'asset.mdm.lock.MEDIUM',
  'asset.mdm.lock.HARD',
  'asset.mdm.lock.PAUSED',
] as const;
