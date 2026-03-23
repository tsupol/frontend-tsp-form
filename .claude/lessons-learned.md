# Lessons Learned

## 1. Stop when the foundation is missing

When a proper API/view doesn't exist, do NOT hack around it (fetch thousands of rows and dedup client-side, aggregate in JS, use the wrong view). Stop and report the gap. A page built on the wrong data source is worse than no page — it hides the problem and creates debt.

## 2. Investigate before implementing

Before writing any code, audit what the backend actually provides. Check the views, RPCs, columns, GRANTs. If something is missing or broken, report it first and ask how to proceed. Don't discover gaps mid-implementation and silently work around them.

## 3. Think from the user's perspective

Ask: who is sitting in front of this screen? What are they trying to do? A branch staff checking prices with a customer is not the same as an admin configuring rate cards. Don't treat specs as checklists — understand the workflow. If two things aren't part of the same workflow, they don't belong on the same page.

## 4. Report problems instead of hiding them

When hitting a gap, the honest response is: "here's what's missing, here's what's blocked, here's what we can build right now." Don't deliver something that looks functional but is fundamentally wrong. The cost of hiding a problem is always higher than the cost of raising it.

## 5. Study existing patterns before writing code

Read existing pages in the project to learn how things are done: column definitions, snackbar types, modal patterns, component props. Don't guess or assume — the codebase is the source of truth. Follow the patterns exactly.
