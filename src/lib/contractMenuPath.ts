// The contract-opening screen (/admin/contracts/new/<id>) is reached from
// several menus: a fresh contract from "Create", a draft from "Draft", an
// approved shop contract from "Pending Pay & Sign". The address carries the
// menu it was opened from (?from=<section>), so the menus highlight that entry
// instead of "Create" — continuing a contract is not creating one.
export function contractMenuActivePath(pathname: string, search: string): string {
  if (!/^\/admin\/contracts\/new\/\d+/.test(pathname)) return pathname;
  const from = new URLSearchParams(search).get('from');
  if (from && /^[a-z-]+$/.test(from) && from !== 'new') return `/admin/contracts/${from}`;
  return '/admin/contracts';
}

/** The `?from=` value for a link into the opening screen from the current page. */
export function contractMenuFrom(pathname: string): string {
  const section = pathname.split('/')[3] ?? '';
  return /^[a-z-]+$/.test(section) && section !== 'new' ? `?from=${section}` : '';
}
