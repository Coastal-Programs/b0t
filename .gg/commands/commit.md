---
name: commit
description: Gate on /fix, review, commit with AI message, and push
---

1. Quality gate — execute the protocol in `.gg/commands/fix.md` with scope `changed`.
   If its final report shows any **residual**, **regressed**, or **escalated** diagnostics, STOP. Surface them and do not commit.

2. Review changes: `git status`, `git diff --staged`, `git diff`.

3. Stage relevant files explicitly with `git add <file>` (never `-A`).

4. Draft a commit message:
   - Verb-led, present tense (Add/Update/Fix/Remove/Refactor).
   - ≤72 chars, one line, specific — WHAT and WHY.

5. Commit and push: `git commit -m "<message>"` then `git push`.
