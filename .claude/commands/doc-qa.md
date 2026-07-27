---
description: "Spec-driven QA gate — checks a diff against R3's foundation docs before you commit, via the doc-qa agent."
---

Run R3's doc-QA gate on: $ARGUMENTS

1. Work out the diff scope:
   - If `$ARGUMENTS` is empty, the scope is staged changes: `git diff --cached`.
   - If `$ARGUMENTS` is given, treat it as a ref range or git-diff argument (e.g. `main...HEAD`, a commit SHA range) and use `git diff $ARGUMENTS` instead.
2. Check the scope isn't empty (e.g. `git diff --cached --stat`). If there's nothing there, tell the user and stop — don't spawn the agent for no reason.
3. Spawn the `doc-qa` agent (Agent tool, `subagent_type: "doc-qa"`), running in the foreground since its findings gate the commit. Tell it exactly which git command defines the diff scope so it runs the same one itself.
4. Relay its full report back to the user verbatim — don't summarize away specific findings, don't soften the verdict. This command exists to be the gate; skip nothing.
