# DONE-file workflow — answering BE work orders

BE (DB) sends work orders as `UI_FEEDBACK/` NOTICE/MESSAGE/DELIVERY docs in the
nnf repo. Completed work orders are answered with **one short DONE file per
send** in the same folder — one line per work order, not one file each
(Ton 2026-11-02: eleven per-order files mostly retold BE its own work orders). This doc is the loop: how to track the work, when to draft, and what
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
3. **Ton says "done"** → generate ONE draft into `outbox/` covering every work
   order that has a test log, under its final filename
   (`YYYY-MM-DD_DONE_batch.md`; add a suffix if one of that name already exists
   in nnf). Sources: git commits since each log's start hash (what was built) +
   each log's *latest green* run (how it was tested). Show the draft in chat.
4. **Ton corrects something** → fix, retest (log grows), then **rewrite the
   draft from scratch** against current reality. Never patch sentences, never
   narrate iterations — the draft is a snapshot of now, not a history.
5. **Ton says "ส่ง BE"** (or "deploy and respond") → quick re-verify of each
   line's claim against current DEV (values still match? no new mig landed on
   top — the mig-1192 lesson). A stale or unfinished line is dropped from the
   file and reported to Ton with a one-line reason; the rest still ship. Copy
   the file to `D:\dev\nnf\UI_FEEDBACK\`, commit, push. Then delete the draft,
   the shipped lines' test logs, and the review screenshots — all scaffolding.
6. **Hand Ton the paste block.** End the ส่ง-BE report with a copy-paste-ready
   block — one `UI_FEEDBACK/<filename>.md` path per line for every doc just
   shipped, nothing else in the block — so Ton can paste it straight into the
   chat with DB to say "read these".

If work predates its test log (an old page needing a retroactive DONE), run a
real verification round-trip *now* and write that — never recall or assume a
past test. A claim in a DONE file is a claim about DEV today.

## What a DONE file contains — and nothing else

BE uses a DONE for three things only: is it live (they check the deployed
bundle themselves), which DEV user tested it and did it pass, and what they
must act on. They wrote the work order, so **never retell what was built** —
no "ที่ทำ" section. Thai, one file per send:

```markdown
# DONE — <วันที่> · <N> ใบ

> YYYY-MM-DD · FE · deploy แล้ว nnfui.czynet.dev `main-<hash>.js`

| ใบงาน | ทดสอบ (DEV) |
|---|---|
| `<work-order-file>.md` | `<user>` ✅ |
| `<work-order-file>.md` | `<user>` ✅ · ข้อมูลที่ทิ้งไว้: <one phrase> |

## ต้องให้ BE ทำ / ตอบ
- `<work-order-file>.md`: <what FE needs and why — one or two lines>
```

- One table row per work order. Add a short phrase only for something BE must
  know: data left on DEV, a check that could not run and why ("ไม่มีเครื่อง
  in_mdm บน DEV"), "รอ owner เปิดดู".
- The "ต้องให้ BE" section lists only items that need BE. If none, write
  `- ไม่มี` and nothing else.
- **Full evidence only where the work order explicitly asks for it** (e.g. "ใบ
  DONE ขอให้แนบ: bundle · ผล 5 บัญชี"). Put it under its own `## <work-order>`
  heading after the table, as short as the ask allows.
- Before asking BE for anything, check that no existing view/RPC already gives
  it (2026-11-02: a DONE asked BE to add `account_number_display` to a view
  while `v_fund_shop_payout_accounts` already returned it).

**Never expose FE internals.** No FE file paths, component names, hook names,
commit hashes, i18n keys, screenshot references, or iteration history. RPC and
view names are the shared contract — those are fine. If BE needs to act on a
finding (a mig landed without a NOTICE, an RPC drifted), state *what* and
*why it matters to FE* — never *how* to fix it (per the UI_FEEDBACK rule).

## Subagent briefs

The orchestrating session — the one that read the work order — creates the test
log itself, before spawning any agents; log creation is never delegated. Every
brief for an agent doing work-order work then includes this paragraph verbatim:

> Append every test run to `outbox/testlog_<topic>.md` as it happens: user
> account, entities touched, values changed, reset yes/no, result. Append-only —
> never reorder or rewrite earlier entries. Your final report is not a test
> log; verification evidence that only lives in the report gets re-run from
> scratch at DONE time.

## Ground rules

- **Ton does not edit drafts** — corrections come through chat; the draft is
  regenerated, so hand-edits would be overwritten by design.
- **Code truth = git, test truth = the log.** The draft owns nothing; it is
  derived. That is why redoing work three times costs zero bookkeeping.
- Multiple parallel agents: one test log per work order, each agent appends to
  its own topic's log. Outbox drafts use final filenames so collisions are
  visible immediately.
- Deploy: `just deploy` (builds, ships dist/ over ssh; nginx serves it at
  once — no restart). Verify after: the live index at https://nnfui.czynet.dev
  must reference the freshly built main-*.js hash. Run it when Ton says
  "deploy"; when DONE files claim behavior DB will check on POP, deploy
  before or together with "ส่ง BE" so the bundle matches the claims.
