---
description: "Ad hoc UI test of an R3 feature/flow, via the ui-tester agent."
---

Run an ad hoc UI test of: $ARGUMENTS

1. If `$ARGUMENTS` is empty, ask the user which feature, flow, or screen(s) to test before doing anything else — don't guess at scope.
2. Spawn the `ui-tester` agent (Agent tool, `subagent_type: "ui-tester"`), running in the foreground since you need its result before you can report back. Tell it exactly what to test: `$ARGUMENTS`, plus which role/tier/duty and device/viewport to simulate if the user specified one (otherwise let the agent infer the right role/device from the flow per its own role/duty matrix and device→surface map).
3. Relay its full report back to the user verbatim — don't summarize away specific defects, screens, or severities.
