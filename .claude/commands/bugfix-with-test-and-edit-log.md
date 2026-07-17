---
name: bugfix-with-test-and-edit-log
description: Workflow command scaffold for bugfix-with-test-and-edit-log in XQAP-XRay-Quality-Assurance-Platform.
allowed_tools: ["Bash", "Read", "Write", "Grep", "Glob"]
---

# /bugfix-with-test-and-edit-log

Use this workflow when working on **bugfix-with-test-and-edit-log** in `XQAP-XRay-Quality-Assurance-Platform`.

## Goal

Fixes a bug in a component or data module, updates or adds a corresponding test, and records the change in docs/EDIT_LOG.md.

## Common Files

- `docs/EDIT_LOG.md`
- `src/components/Sidebar/Tabs/Population/index.tsx`
- `src/components/Sidebar/Tabs/Population/populationLoadRace.test.tsx`
- `src/components/Sidebar/Tabs/Reports/index.tsx`
- `src/components/Sidebar/Tabs/Reports/index.test.tsx`
- `src/data/reportDesigner/storage/reportDesignStorage.ts`

## Suggested Sequence

1. Understand the current state and failure mode before editing.
2. Make the smallest coherent change that satisfies the workflow goal.
3. Run the most relevant verification for touched files.
4. Summarize what changed and what still needs review.

## Typical Commit Signals

- Edit the source file to fix the bug.
- Update or add a test file for the affected module/component.
- Update docs/EDIT_LOG.md to record the change.

## Notes

- Treat this as a scaffold, not a hard-coded script.
- Update the command if the workflow evolves materially.