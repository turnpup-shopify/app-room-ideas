---
name: pin-creation
description: Write or review Pinterest pin copy for HTGT Furniture (titles, descriptions, overlay text, topic tags, hashtags, board assignment, bulk CSV rows), or change how the app drafts pin copy. Use for any pin writing, pin QA, or edits to lib/pinCopy.js.
---

# Pin creation

The rules live in this repo so the app and Claude Code use the same text:

- `prompts/pinterest-pin-guide.md`: the HTGT pin guide. Title patterns A/B/C, three sentence descriptions, topic tags, boards, QA list.
- `prompts/no-ai-slop.md` and `prompts/no-ai-slop-eval.md`: a copy of the no-ai-slop skill and its checklist.

When writing or reviewing pins:

1. Read `prompts/pinterest-pin-guide.md` and follow it. Where it conflicts with anything else, it wins.
2. Write with the no-ai-slop skill in tandem. Run each draft through its checklist.
3. Never use an em dash, en dash, hyphen, semicolon, colon, or exclamation mark in pin copy. Use "timeless" rarely.
4. Run the guide's QA list (section 11) on every pin before returning it.

When changing the app:

- `lib/pinCopy.js` sends the three prompt files as the system prompt on every pin copy and overlay headline call (`pinSystemPrompt()`), checks the result with `checkCopy()`, retries once with the problems, then `scrub()` removes banned punctuation.
- Edit the rules in `prompts/`, not in `lib/pinCopy.js`. The files are read on every call, so changes apply without a restart.
- `lib/pinHistory.js` enforces the repeat rules (no reused images, earlier titles per product, 70/30 pattern mix, per-product warnings). Posted pins are logged in `pinterest-posted.json`.
- If the user's no-ai-slop skill changes (`~/.claude/skills/no-ai-slop/`), copy `SKILL.md` and `eval.md` over the files in `prompts/`.
