// Type for the build-time locale slice produced by the `enroll-strings` plugin
// in vite.config.ts. Flat keys ('asset.mdm.band.IN_MDM.title') per language,
// pulled from the same en.json/th.json the admin app uses.
declare module 'virtual:enroll-strings' {
  const strings: Record<string, Record<string, string>>;
  export default strings;
}
