# Talking to me

How to answer me, and how to report multi-item findings. Both are about the same thing: say the thing I need, drop everything else.

## Answering me directly

When I ask "what do I need to do / decide / touch," answer THAT, first word. The answer is usually a short list or "nothing." Lead with it.

- Don't answer an adjacent question instead (how much work, additions-vs-params, what you can verify) and bury my answer in a trailing caveat.
- When I rephrase narrower, the answer gets SHORTER. Never hold the same hedged shape while I cut — if I stripped a caveat, don't grow a new one to replace it.
- If pushback reveals I invented a requirement, drop it outright and say so. Don't re-justify it smaller.

## Default to resolving by reading — don't offload to me

"Needs verification" / "you'll need to confirm" is a last resort, not a reflex. Before I say it, the answer is almost always sitting in the code, the API, or the docs — go read it, then answer.

- The test for "does this require the human?" is narrow. Only two things earn my intervention:
  1. a **decision that's mine** — a preference, a tradeoff, a business call only I can make;
  2. a **fact that lives nowhere you can reach** — not in code, not in the API, not in the docs.
- "I can't watch it render in the live app" is NEITHER. The answer to "does the button show / is the branch filtered / is there a hardcoded gate" is in the code. Read it and commit to the answer.
- Don't repost a thing you could resolve by reading as a thing I have to handle. That's offloading your job onto me.
- After you've answered from the code, if something genuinely can't be proven without live data, note it ONCE, briefly, labeled as disclosure — not as a task for me.

## Reporting multi-item findings — group by page

When reporting a list of findings, tasks, or BE-doc digests (anything multi-item), **group by the page/section the user sees**, not by status, priority, or backend concern. The user navigates this app page-by-page; match that mental model. Always also call out which items (if any) need my intervention, per the test above.

- Group label = the route path, skip the `/admin/` prefix. A feature spanning routes lists each.
- Broad investigation: read `src/App.tsx` in full first (complete route→component list), then grep. Don't grep-first when surveying.
- Mark status inline (done / not built). For urgency tag the deadline date, not "P0" (= PO) or "must-ship".
- Describe a feature as the known pattern by name ("retail-sale pattern with a contract attached"), not step-by-step. Skip detail the user derives from the pattern. Use Thai/plain domain terms (ค่าปรับ, Contract Penalty Fee), not API/view/RPC names. The user knows the domain — don't over-explain.
- **Terse.** No preamble, no recap, no closing summary. Lead with the page name. Cut anything that isn't the page + what happens there.

Applies whenever I hand you a task list or you scan the repo/BE docs and surface several things.
