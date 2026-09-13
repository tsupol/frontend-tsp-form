---
name: done
description: DONE-file workflow for BE work orders. "done" drafts the DONE file(s) into outbox/ from git commits + the outbox test logs; "ส่ง BE" / args "send" re-verifies drafts against DEV, ships them to nnf UI_FEEDBACK/, and cleans up scaffolding. Invoke whenever Ton says "done" or "ส่ง BE" after work on a BE work order.
---

Read `D:\dev\frontend-tsp-form\.claude\done-file-workflow.md` IN FULL, then execute the stage matching the trigger. This skill is the entry point only — the workflow doc is the spec and wins on any conflict.

## Trigger "done" (no args, or anything other than "send")

Stage 3–4 of the loop:
- For each work order with a test log in `outbox/`, generate the DONE draft into `outbox/` under its final filename (`YYYY-MM-DD_DONE_<topic>.md`). Sources: git commits since the log's start hash (what was built) + the log's latest green run per item (how it was tested). Show each draft in chat.
- A missing or empty test log means the tests are NOT citable — a subagent's final report does not count. Run a real verification round-trip now, log it in the test log, then draft from that.
- On corrections: fix, retest (log grows), regenerate the draft from scratch. Never patch sentences or narrate iterations.

## Trigger "ส่ง BE" / args "send"

Stage 5–6 of the loop:
- Per draft in `outbox/`: quick re-verify of its claims against current DEV (values still match? no newer mig landed on top). Clean drafts → copy to `D:\dev\nnf\UI_FEEDBACK\`, commit, push. A stale draft is held back with a one-line reason; the rest still ship.
- Delete shipped drafts, their test logs, and review screenshots — all scaffolding.
- If any shipped DONE claims behavior DB will verify live, deploy first (`just deploy`, then confirm https://nnfui.czynet.dev serves the fresh main-*.js hash).
- End with the copy-paste block: one `UI_FEEDBACK/<filename>.md` path per line for every doc shipped, nothing else in the block.

## Always

DONE files answer only what BE asks (ทำอะไร · ทดสอบด้วย user ไหนบน DEV · ติดฝั่ง BE ไหม) in 5–15 Thai lines. Never expose FE internals — no FE file paths, component/hook names, commit hashes, i18n keys, or screenshot references. RPC and view names are fine.
