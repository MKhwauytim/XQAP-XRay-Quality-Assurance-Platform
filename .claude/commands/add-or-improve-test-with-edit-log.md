---
name: add-or-improve-test-with-edit-log
description: Workflow command scaffold for add-or-improve-test-with-edit-log in XQAP-XRay-Quality-Assurance-Platform.
allowed_tools: ["Bash", "Read", "Write", "Grep", "Glob"]
---

# /add-or-improve-test-with-edit-log

Use this workflow when working on **add-or-improve-test-with-edit-log** in `XQAP-XRay-Quality-Assurance-Platform`.

## Goal

Adds missing test coverage or improves tests for a data or component module, and records the change in docs/EDIT_LOG.md.

## Common Files

- `docs/EDIT_LOG.md`
- `src/data/reporting/reportBuilders.xss.test.ts`
- `src/data/answers/employeeXlsx.test.ts`
- `src/data/templates/templateSelectionStorage.test.ts`

## Suggested Sequence

1. Understand the current state and failure mode before editing.
2. Make the smallest coherent change that satisfies the workflow goal.
3. Run the most relevant verification for touched files.
4. Summarize what changed and what still needs review.

## Typical Commit Signals

- Add or update test file(s) for the relevant module.
- Update docs/EDIT_LOG.md to record the addition or improvement.

## Notes

- Treat this as a scaffold, not a hard-coded script.
- Update the command if the workflow evolves materially.