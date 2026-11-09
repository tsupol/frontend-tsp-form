// ============================================================================
// The user picker for handing out a permission grant.
//
// Shared by the per-user window (opened from the page's "Grant" button) and
// the add-person window on one permission, so both offer the same people in
// the same order: fuzzy on name / company / branch, grouped under a divider
// and the company name, closest match first.
//
// The caller decides who is offered (`candidates`) — the permission page also
// leaves out the people who already hold the permission.
// ============================================================================

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Select, type SelectItem } from 'tsp-form';
import { Search } from 'lucide-react';
import { fuzzyRank } from '../../lib/fuzzy';
import { getRoleLabel } from '../../lib/roleLabel';
import { UserOptionLine } from '../../components/UserOptionLine';
import type { GrantUser } from './permissionGrants';

export function GrantUserPicker({ candidates, value, onChange, loading }: {
  candidates: GrantUser[];
  value: GrantUser | null;
  onChange: (user: GrantUser | null) => void;
  loading?: boolean;
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');

  // One line for the closed field; the dropdown rows get UserOptionLine.
  const label = (u: GrantUser) =>
    [u.username, getRoleLabel(t, u.role_code), u.company_name].filter(Boolean).join(' · ');
  const byId = useMemo(() => new Map(candidates.map(u => [String(u.id), u])), [candidates]);

  // Groups keep the search's order — the group holding the closest match comes
  // first, and inside a group people stay closest-first. A company admin only
  // ever sees one company, so a lone group gets no heading.
  const options = useMemo((): SelectItem[] => {
    const ranked = fuzzyRank(candidates, search, u => `${u.username} ${u.company_name ?? ''} ${u.branch_name ?? ''}`);
    const groups = new Map<string, GrantUser[]>();
    for (const u of ranked) {
      const key = u.company_name ?? '';
      const list = groups.get(key);
      if (list) list.push(u); else groups.set(key, [u]);
    }
    const items: SelectItem[] = [];
    // Keep the picked person in the list while the search narrows past them.
    if (value && !ranked.some(u => u.id === value.id)) {
      items.push({ value: String(value.id), label: label(value) });
    }
    const showHeadings = groups.size > 1;
    for (const [company, people] of groups) {
      if (showHeadings) {
        if (items.length > 0) items.push({ type: 'separator' });
        items.push({ type: 'group', label: company || t('permissionGrants.noCompanyGroup') });
      }
      for (const u of people) items.push({ value: String(u.id), label: label(u) });
    }
    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates, search, value, t]);
  const grouped = options.some(o => 'type' in o && o.type === 'group');

  return (
    <Select
      options={options}
      value={value ? String(value.id) : null}
      onChange={(v) => onChange(byId.get(String(v)) ?? null)}
      renderOption={(opt) => {
        const u = byId.get(String(opt.value));
        // keyed: tsp-form puts this next to its check mark in a children array
        return u ? <UserOptionLine key={opt.value} user={u} hideCompany={grouped} /> : opt.label;
      }}
      onSearchChange={setSearch}
      filterOptions={false}
      loading={loading}
      placeholder={t('permissionGrants.pickUserPlaceholder')}
      startIcon={<Search size={16} />}
      showChevron
      // The list is as wide as the field, but the library caps it at 400px and
      // right-aligns it, so it sat offset under a wider field. Cap at the
      // window's own width instead.
      popoverProps={{ maxWidth: '34rem' }}
    />
  );
}
