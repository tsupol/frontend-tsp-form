# Responsive Page Pattern

Standard pattern for admin table pages with dual mobile/desktop views.

## Structure

1. **MobileHeader** (`md:hidden`) — sticky header with menu toggle, page title, action button
2. **Desktop header** (`max-md:hidden`) — title + action button
3. **Container** — `page-content responsive-dvh-mobile-header`
4. **Progressive filter collapse** — filters drop right-to-left as viewport narrows, popover appears with all filters + sort (with "Filters" / "Sort by" section headers)
5. **Desktop DataTable** (`hidden md:flex`) — sortable columns, pagination built-in
6. **Mobile card list** (`md:hidden`) — divide-y list with `DataTableFooter` at bottom
   - Scroll container: `flex-1 overflow-auto better-scroll pb-8` — `pb-8` prevents content from sitting flush against the footer
   - `DataTableFooter` is a standalone component from tsp-form — provides pagination, page size selector, and row count with responsive mobile popover
7. **Action column** — `className: 'w-10'` to keep it tight

## Filter bar variants

### With multiple filters (e.g. UsersPage)
- Search + filters all `flex-1 min-w-0`, equal width
- Each filter gets its own visibility: `sm:block`, `md:block`, `lg:block`, `xl:block`
- Popover button is `xl:hidden shrink-0` (or whatever breakpoint shows all filters)
- Popover contains all filters + sort with section headers
- All filters share the same state so inline and popover stay in sync

### With few controls (e.g. FamiliesPage — search + 1 filter)
- Both `flex-1 min-w-0 md:max-w-56` — capped at 14rem on desktop, uncapped when popover is visible (`<md`)
- Filter hides at `<sm`, search stays
- Popover (`md:hidden shrink-0`) contains filter + sort

### Search only (e.g. BrandsPage)
- Search in `w-full max-w-56 min-w-0` (capped width, not full-span)
- `flex-1 md:hidden` spacer pushes popover button right on mobile
- Popover (`md:hidden shrink-0`) contains sort only

## Reference

- UsersPage — many filters, progressive collapse
- FamiliesPage — search + 1 filter, capped width
- BrandsPage — search only, sort popover
- Online-course project — original pattern source
