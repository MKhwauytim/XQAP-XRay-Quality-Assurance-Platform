---
name: feature-or-bugfix-in-report-designer-with-edit-log-and-tests
description: Workflow command scaffold for feature-or-bugfix-in-report-designer-with-edit-log-and-tests in XQAP-XRay-Quality-Assurance-Platform.
allowed_tools: ["Bash", "Read", "Write", "Grep", "Glob"]
---

# /feature-or-bugfix-in-report-designer-with-edit-log-and-tests

Use this workflow when working on **feature-or-bugfix-in-report-designer-with-edit-log-and-tests** in `XQAP-XRay-Quality-Assurance-Platform`.

## Goal

Implements a feature or fixes a bug in the report designer storage, updates or adds tests, and records the change in docs/EDIT_LOG.md.

## Common Files

- `docs/EDIT_LOG.md`
- `src/data/reportDesigner/storage/reportDesignStorage.ts`
- `src/data/reportDesigner/storage/reportDesignStorage.test.ts`

## Suggested Sequence

1. Understand the current state and failure mode before editing.
2. Make the smallest coherent change that satisfies the workflow goal.
3. Run the most relevant verification for touched files.
4. Summarize what changed and what still needs review.

## Typical Commit Signals

- Edit src/data/reportDesigner/storage/reportDesignStorage.ts to implement feature or fix.
- Update or add src/data/reportDesigner/storage/reportDesignStorage.test.ts.
- Update docs/EDIT_LOG.md.

## Notes

- Treat this as a scaffold, not a hard-coded script.
- Update the command if the workflow evolves materially.