# Reporting style — group by page

When reporting a list of findings, tasks, or BE-doc digests (anything multi-item), **group by the page/section the user sees**, not by status, priority, or backend concern. The user navigates this app page-by-page; match that mental model.

- Group label = the route path, skip the `/admin/` prefix. A feature spanning routes lists each.

Broad investigation: read `src/App.tsx` in full first (complete route→component list), then grep. Don't grep-first when surveying.
- Mark status inline (done / not built). For urgency tag the deadline date, not "P0" (= PO) or "must-ship".
- Describe a feature as the known pattern by name ("retail-sale pattern with a contract attached"), not step-by-step. Skip detail the user derives from the pattern. Use Thai/plain domain terms (ค่าปรับ, Contract Penalty Fee), not API/view/RPC names. The user knows the domain — don't over-explain.
- **Terse.** No preamble, no recap, no closing summary. Lead with the page name. Cut anything that isn't the page + what happens there.

Applies whenever I hand you a task list or you scan the repo/BE docs and surface several things.
