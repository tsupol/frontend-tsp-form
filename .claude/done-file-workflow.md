# DONE-file workflow — answering BE work orders

BE (DB) sends work orders as `UI_FEEDBACK/` NOTICE/MESSAGE/DELIVERY docs in the
nnf repo. Every completed work order gets a short DONE file back in the same
folder. This doc is the loop: how to track the work, when to draft, and what
ships. **This flow IS the standing permission for DONE files** — a DONE that
answers a BE work order may be committed to nnf on the "ส่ง BE" trigger without
a separate propose-in-chat cycle. NOTICEs raising *new* issues are unchanged:
propose first, get a yes, then file.

## The loop

1. **Work starts on a NOTICE** → create `outbox/testlog_<topic>.md` in this
   repo (gitignored). First line: the work order's filename + current HEAD hash.
2. **During work** → append every test run to the log as it happens: user
   account, entities touched, values changed, reset yes/no, result. Append-only;
   never reorder. Retests just add entries.
3. **Ton says "done"** → generate the DONE draft into `outbox/` under its final
   filename (`YYYY-MM-DD_DONE_<topic>.md`). Sources: git commits since the
   log's start hash (what was built) + the log's *latest green* run per item
   (how it was tested). Show the draft in chat.
4. **Ton corrects something** → fix, retest (log grows), then **rewrite the
   draft from scratch** against current reality. Never patch sentences, never
   narrate iterations — the draft is a snapshot of now, not a history.
5. **Ton says "ส่ง BE"** (or "deploy and respond") → for each draft in outbox:
   quick re-verify of its claims against current DEV (values still match? no
   new mig landed on top — the mig-1192 lesson). Clean drafts: copy to
   `D:\dev\nnf\UI_FEEDBACK\`, commit, push. A stale draft is held back with a
   one-line reason; the rest still ship. Then delete the shipped drafts, their
   test logs, and the review screenshots — all scaffolding.

If work predates its test log (an old page needing a retroactive DONE), run a
real verification round-trip *now* and write that — never recall or assume a
past test. A claim in a DONE file is a claim about DEV today.

## What a DONE file contains — and nothing else

Answer exactly what BE asks (their own words: ทำอะไร · ทดสอบด้วย user ไหนบน
DEV · ติดอะไรฝั่ง BE ไหม), plus findings BE needs to act on. 5–15 lines, Thai,
matching the house style of existing `UI_FEEDBACK/*_DONE_*.md` files:

```markdown
# DONE — <what, one line>

> YYYY-MM-DD · FE · ตอบ `UI_FEEDBACK/<work-order-file>.md`

## ที่ทำ
- behavior shipped, in terms of the shared API surface (RPC/view names, params)

## ทดสอบ (DEV)
- `mcp_*` user · what was exercised · error paths hit · data reset ✅

## ติดฝั่ง BE ไหม
- ไม่ติด  ← write explicitly when nothing blocks
```

**Never expose FE internals.** No FE file paths, component names, hook names,
commit hashes, i18n keys, screenshot references, or iteration history. RPC and
view names are the shared contract — those are fine. If BE needs to act on a
finding (a mig landed without a NOTICE, an RPC drifted), state *what* and
*why it matters to FE* — never *how* to fix it (per the UI_FEEDBACK rule).

## Ground rules

- **Ton does not edit drafts** — corrections come through chat; the draft is
  regenerated, so hand-edits would be overwritten by design.
- **Code truth = git, test truth = the log.** The draft owns nothing; it is
  derived. That is why redoing work three times costs zero bookkeeping.
- Multiple parallel agents: one test log per work order, each agent appends to
  its own topic's log. Outbox drafts use final filenames so collisions are
  visible immediately.
- Deploy: if a deploy step belongs before responding (bundle must match the
  DONE), it runs first on the same trigger. Command TBD — ask Ton once, then
  record it here.
