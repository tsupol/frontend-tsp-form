# Page Layout Patterns

This project has **two** top-level page layouts. Pick by whether the page needs a
persistent detail panel:

- **Single-column responsive page** (this section, below) — a list/table that fills
  the viewport; detail opens in a Drawer or a separate route. Most admin list pages.
- **PageNav two-panel** (list rail + detail panel) — see [§ PageNav two-panel](#pagenav-two-panel-list-rail--detail).
  Used **frequently** here: BuybackPage, BillsPage, ContractsPage, ApprovalsPage, …

Both layouts render their list with `<DataTable>` (+ `renderRow` for custom rows),
**never** a hand-rolled `divide-y` list with a separate `DataTableFooter` — DataTable
owns row borders (incl. the last row), selected-state, and pagination. Hand-rolling
those is the #1 way these pages come out subtly wrong (missing last-row divider,
mis-framed footer).

## Single-column responsive page

Standard pattern for admin table pages with dual mobile/desktop views.

### Structure

1. **MobileHeader** (`md:hidden`) — sticky header with menu toggle, page title, action button
2. **Desktop header** (`max-md:hidden`) — title + action button
3. **Container** — depends on page type (see MobileHeader variants below)
4. **Progressive filter collapse** — filters drop right-to-left as viewport narrows, popover appears with all filters + sort (with "Filters" / "Sort by" section headers)
5. **Desktop DataTable** (`hidden md:flex`) — sortable columns, pagination built-in
6. **Mobile card list** (`md:hidden`) — when the desktop uses a column `DataTable`
   and mobile needs cards, the card list is a `divide-y` list. **Add `border-b
   border-line` on the wrapper** so the last row draws a divider too (`divide-y`
   only borders *between* rows). Footer = `DataTableFooter` (standalone tsp-form
   component: pagination + page-size + row count).
   - Scroll container: `flex-1 overflow-auto better-scroll pb-8` — `pb-8` prevents content from sitting flush against the footer
   - See the global `tsp-form-guide.md` "Matching a custom mobile list to the desktop DataTable" for the exact border/padding rules.
7. **Action column** — `className: 'w-10'` to keep it tight

### MobileHeader variants

Choose the header style based on what sits directly below the header:

### `mobile-header-bordered` — for DataTable pages
- Use when the page has a filter bar or DataTable directly below the header
- The bottom border visually separates header from structured content
- Pair with `page-content responsive-dvh-mobile-header` container (full viewport height)
- Examples: BrandsPage, ModelsPage, Fin1RatesPage, UsersPage

### `mobile-header-scrolled-shadow` — for content pages
- Use when the page has freely scrollable content (forms, cards, text)
- Shows a subtle shadow when the user scrolls, no border at rest
- Pair with `page-content` container (no dvh, natural height)
- Also appropriate for tabbed pages where the tab bar provides visual separation
- Examples: DashboardPage, DiscountsPage

### When in doubt
- Does the page fill the full viewport with a DataTable? → `bordered` + `responsive-dvh-mobile-header`
- Is it scrollable content without a full-height table? → `scrolled-shadow` + plain `page-content`

### Filter bar variants

#### With multiple filters (e.g. UsersPage)
- Search + filters all `flex-1 min-w-0`, equal width
- Each filter gets its own visibility: `sm:block`, `md:block`, `lg:block`, `xl:block`
- Popover button is `xl:hidden shrink-0` (or whatever breakpoint shows all filters)
- Popover contains all filters + sort with section headers
- All filters share the same state so inline and popover stay in sync

#### With few controls (e.g. FamiliesPage — search + 1 filter)
- Both `flex-1 min-w-0 md:max-w-56` — capped at 14rem on desktop, uncapped when popover is visible (`<md`)
- Filter hides at `<sm`, search stays
- Popover (`md:hidden shrink-0`) contains filter + sort

#### Search only (e.g. BrandsPage)
- Search in `w-full max-w-56 min-w-0` (capped width, not full-span)
- `flex-1 md:hidden` spacer pushes popover button right on mobile
- Popover (`md:hidden shrink-0`) contains sort only

### Reference

- UsersPage — many filters, progressive collapse
- FamiliesPage — search + 1 filter, capped width
- BrandsPage — search only, sort popover
- Online-course project — original pattern source

## PageNav two-panel (list rail + detail)

A left **list rail** stays visible while the right **detail panel** shows the
selected item. On mobile the two collapse into a stack (rail → detail via `goTo`).
Used frequently in this project — it's a core layout, not an edge case. Reference
implementations: **BuybackPage**, **BillsPage**, **ContractsPage**.

### Shell

```tsx
<PageNav panels={['list', 'detail']} className="h-dvh">
  {({ isMobile, isRoot, goTo, goBack }) => (
    <>
      {isMobile && <MobileHeader className="mobile-header-bordered">…</MobileHeader>}
      {!isMobile && <div className="flex-none px-4 py-2.5 border-b border-line …"><h1 className="heading-2">…</h1></div>}

      <div className={isMobile ? 'pagenav-panels' : 'flex flex-1 min-h-0'}>
        <PageNavPanel id="list" className={isMobile ? '' : 'w-1/2 xl:w-5/12 border-r border-line flex flex-col'}>
          {/* filter row: flex-none p-2 border-b border-line */}
          {/* DataTable rail — see below */}
        </PageNavPanel>
        <PageNavPanel id="detail" className={isMobile ? '' : 'flex-1 min-w-0 flex flex-col'}>
          {/* selected ? <DetailPanel/> : empty state */}
        </PageNavPanel>
      </div>
    </>
  )}
</PageNav>
```

### The list rail — ALWAYS `DataTable` + `renderRow`

The rail is a `<DataTable>` with a custom `renderRow`, **not** a hand-rolled
`divide-y` list and **not** a separate `DataTableFooter`. DataTable owns the row
dividers (including the last row), selected-row highlight, and pagination.

```tsx
<DataTable<Row>
  data={rows}
  getRowProps={row => ({ 'data-state': row.original.id === selectedId ? 'selected' : undefined })}
  renderRow={row => (
    <button
      key={row.original.id}
      type="button"
      className="w-full text-left px-4 py-2.5 transition-colors cursor-pointer"
      onClick={() => select(row.original)}
    >
      {/* stacked content — badges line, label line, customer·branch + amount line */}
    </button>
  )}
  enablePagination
  pageIndex={pageIndex}
  pageSize={pageSize}
  pageSizeOptions={[15, 25, 50]}
  rowCount={totalCount}
  onPageChange={({ pageIndex: pi, pageSize: ps }) => { setPageIndex(pi); setPageSize(ps); }}
  className={`flex-1 min-h-0 panel-datatable ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}
  noResults={<div className="p-8 text-center text-subtler">{t('common.noData')}</div>}
/>
```

Non-negotiables:
- `className` includes **`panel-datatable`** (rail-specific table styling) + `flex-1 min-h-0`.
- Selected row via **`getRowProps` → `data-state="selected"`**, not a hand-rolled `bg-primary-soft` on the row.
- `getRowProps`/`renderRow` receive the row object — read `row.original`.
- Pagination is **built into the DataTable** (`enablePagination` + `rowCount` + `onPageChange`). Do not add a separate `DataTableFooter`.
- Narrow rail: rows stack vertically (column DataTable headers don't fit). That's what `renderRow` is for.

### Detail panel

- Header: `flex-none flex items-center h-panel-header-h px-4 border-b border-line gap-2`.
- Body: `flex-1 overflow-auto better-scroll px-4 py-3`.
- Sticky footer (actions): `flex-none border-t border-line px-4 py-3`.
- Empty state when nothing selected: centered icon + hint, `text-subtler`.
- Detail panels can be **extracted and reused** across pages — e.g. ApprovalsPage
  renders inventory's `BuybackDetailPanel` directly so the buyback approve flow
  lives in exactly one component. Keep panel props to `{ detail, loading, isMobile, t, onRefresh, addSnackbar }`-style boundaries to make this possible.
