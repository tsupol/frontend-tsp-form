---
name: done
description: DONE-file workflow for BE work orders. "done" drafts ONE batch DONE file (one line per work order) into outbox/ from git commits + the outbox test logs; "ส่ง BE" / args "send" re-verifies it against DEV, ships it to nnf UI_FEEDBACK/, and cleans up scaffolding. Invoke whenever Ton says "done" or "ส่ง BE" after work on a BE work order.
---

Read `D:\dev\frontend-tsp-form\.claude\done-file-workflow.md` IN FULL, then execute the stage matching the trigger. This skill is the entry point only — the workflow doc is the spec and wins on any conflict.

## Trigger "done" (no args, or anything other than "send")

Stage 3–4 of the loop:
- Generate ONE draft covering every work order with a test log in `outbox/`, under its final filename (`YYYY-MM-DD_DONE_batch.md`): one table row per work order (file · DEV user ✅ · a phrase only if BE must know something), then a "ต้องให้ BE ทำ / ตอบ" list. Sources: git commits since each log's start hash + each log's latest green run. Show the draft in chat.
- A missing or empty test log means the tests are NOT citable — a subagent's final report does not count. Run a real verification round-trip now, log it in the test log, then draft from that.
- On corrections: fix, retest (log grows), regenerate the draft from scratch. Never patch sentences or narrate iterations.

## Trigger "ส่ง BE" / args "send"

Stage 5–6 of the loop:
- Quick re-verify of each line's claim against current DEV (values still match? no newer mig landed on top). A stale or unfinished line is dropped from the file and reported to Ton with a one-line reason; the rest still ship. Copy the file to `D:\dev\nnf\UI_FEEDBACK\`, commit, push.
- Delete the draft, the shipped lines' test logs, and review screenshots — all scaffolding.
- If any shipped DONE claims behavior DB will verify live, deploy first (`just deploy`, then confirm https://nnfui.czynet.dev serves the fresh main-*.js hash).
- End with the copy-paste block: one `UI_FEEDBACK/<filename>.md` path per line for every doc shipped, nothing else in the block.

## Always

A DONE answers only: live in which bundle · which DEV user tested it ✅ · what BE must do or answer. Never retell what was built (BE wrote the work order). Full evidence only where a work order explicitly asks for it. Before asking BE for anything, check no existing view/RPC already gives it. Never expose FE internals — no FE file paths, component/hook names, commit hashes, i18n keys, or screenshot references. RPC and view names are fine.
