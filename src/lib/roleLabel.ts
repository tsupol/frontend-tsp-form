import type { TFunction } from 'i18next';

// Translate a role_code to a display label. Falls back to the raw code so
// unknown roles (new backend role added before frontend ships translation)
// remain visible rather than blank.
export function getRoleLabel(t: TFunction, code: string | null | undefined): string {
  if (!code) return '—';
  return t(`role.${code}`, { defaultValue: code });
}
