// The exact set of locale keys the enrollment page renders.
//
// WHY A LIST INSTEAD OF IMPORTING THE LOCALE FILES: en.json + th.json are ~810kB
// of raw JSON between them. A runtime lookup (`walk(root, 'a.b.c')`) keeps the
// whole object reachable, so nothing tree-shakes and the entire admin
// vocabulary — day-close, contracts, dunning — ships to a page that displays a
// serial number and a status line. Measured: it was ~90% of the bundle.
//
// The build plugin in vite.config.ts reads this list, pulls just these keys out
// of the SAME locale files the admin app uses, and inlines the result. So the
// single-source guarantee holds — branch A and branch B still read identical
// sentences — but only these strings travel.
//
// ⛔ A key here that does not exist in en.json/th.json FAILS THE BUILD. That is
//    the point: it catches a rename in the shared files immediately, instead of
//    shipping a raw dotted key to a stranger's phone.

export const ENROLL_STRING_KEYS = [
  // Page chrome
  'remoteEnroll.serialLabel',
  'remoteEnroll.serialHint',
  'remoteEnroll.watching',
  'remoteEnroll.updatedJustNow',
  'remoteEnroll.updatedAgo',
  'remoteEnroll.expiresInHm',
  'remoteEnroll.expiresInM',

  // Terminal screens
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

  // The status band — one title/body pair per state
  'asset.mdm.band.NO_SERIAL.title',
  'asset.mdm.band.NO_SERIAL.body',
  'asset.mdm.band.NOT_STARTED.title',
  'asset.mdm.band.NOT_STARTED.body',
  'asset.mdm.band.PREPARING.title',
  'asset.mdm.band.PREPARING.body',
  'asset.mdm.band.PROFILE_READY.title',
  'asset.mdm.band.PROFILE_READY.body',
  'asset.mdm.band.PREPARE_FAILED_REMOTE.title',
  'asset.mdm.band.PREPARE_FAILED_REMOTE.body',
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
  'asset.mdm.waitHint.CHECK_SERIAL.bodyRemote',

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
] as const;
