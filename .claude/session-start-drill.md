BE work-order drill (full spec: `.claude/done-file-workflow.md`):

- Working on a BE work order (nnf `UI_FEEDBACK/` NOTICE/MESSAGE/DELIVERY, or forwarded owner messages that will be answered back to BE)? BEFORE writing code, create `outbox/testlog_<topic>.md` (gitignored). First line: the work-order filename + current HEAD hash. Append every test run as it happens: user account, entities touched, values changed, reset yes/no, result. Append-only — never reorder or rewrite.
- Every subagent brief for such work MUST include the append-to-test-log paragraph from `.claude/done-file-workflow.md` §Subagent briefs. A subagent's final report is not a test log — evidence that only lives there gets re-verified from scratch at DONE time.
- Ton says "done" → invoke the `done` skill. Ton says "ส่ง BE" → invoke the `done` skill with args `send`.
